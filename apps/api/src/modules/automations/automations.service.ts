import {
  BadRequestException,
  Injectable,
  Inject,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { and, desc, eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../db/db.module.js';
import * as schema from '../../db/schema.js';
import { encrypt } from '../../utils/encryption.util.js';
import {
  CreateAutomationDto,
  CreateAutomationVersionDto,
  RunAutomationDto,
  UpdateAutomationDto,
} from './automations.dto.js';
import {
  nodeConfig,
  orderWorkflow,
  validateWorkflowDefinition,
  workflowNodeKind,
  workflowTriggerMode,
} from './workflow-definition.js';

function recordText(
  value: Record<string, unknown>,
  key: string,
  fallback = '',
) {
  const candidate = value[key];
  return typeof candidate === 'string' ? candidate : fallback;
}

function webhookBaseUrl(required = false) {
  const configured =
    process.env.WEBHOOK_PUBLIC_BASE_URL ||
    process.env.PUBLIC_API_URL ||
    (process.env.NODE_ENV !== 'production'
      ? 'http://localhost:4000'
      : undefined);

  if (!configured) {
    if (required) {
      throw new ServiceUnavailableException(
        'WEBHOOK_PUBLIC_BASE_URL must be configured for webhook automations',
      );
    }
    return undefined;
  }

  try {
    const url = new URL(configured);
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      throw new Error('invalid webhook origin');
    }
    return url.origin;
  } catch {
    if (required) {
      throw new ServiceUnavailableException(
        'WEBHOOK_PUBLIC_BASE_URL must be an HTTP(S) origin without a path',
      );
    }
    return undefined;
  }
}

function webhookUrl(publicId?: string | null) {
  if (!publicId) return null;
  const base = webhookBaseUrl(false);
  return base ? `${base}/v1/automation-hooks/${publicId}` : null;
}

function safeTrigger(
  trigger: typeof schema.automationTriggers.$inferSelect,
) {
  const { secret: _secret, ...safe } = trigger;
  return {
    ...safe,
    endpointUrl: webhookUrl(trigger.publicId),
  };
}

@Injectable()
export class AutomationsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async findAll(workspaceId: number) {
    const records = await this.db.query.automations.findMany({
      where: eq(schema.automations.workspaceId, workspaceId),
      with: {
        versions: true,
        runs: {
          with: { steps: true, version: true },
          orderBy: (fields, { desc: orderDesc }) => [
            orderDesc(fields.createdAt),
          ],
          limit: 10,
        },
        triggers: true,
      },
      orderBy: (fields, { desc: orderDesc }) => [orderDesc(fields.updatedAt)],
    });

    return records.map((automation) => ({
      ...automation,
      triggers: automation.triggers.map(safeTrigger),
    }));
  }

  async create(workspaceId: number, dto: CreateAutomationDto) {
    const definition = validateWorkflowDefinition(dto.workflowDefinition);
    const triggerType = workflowTriggerMode(definition);
    if (dto.triggerType && dto.triggerType !== triggerType) {
      throw new BadRequestException(
        'triggerType must match the workflow trigger configuration',
      );
    }

    return this.db.transaction(async (tx) => {
      const [automation] = await tx
        .insert(schema.automations)
        .values({
          workspaceId,
          name: dto.name,
          description: dto.description,
          triggerType,
          status: 'draft',
        })
        .returning();

      const [version] = await tx
        .insert(schema.automationVersions)
        .values({
          automationId: automation.id,
          versionNumber: 1,
          workflowDefinition: definition,
        })
        .returning();

      return { ...automation, versions: [version], runs: [] };
    });
  }

  async update(
    workspaceId: number,
    automationId: number,
    dto: UpdateAutomationDto,
  ) {
    await this.requireAutomation(workspaceId, automationId);

    const values: { name?: string; description?: string; updatedAt: Date } = {
      updatedAt: new Date(),
    };
    if (typeof dto.name === 'string' && dto.name.trim()) {
      values.name = dto.name.trim();
    }
    if (typeof dto.description === 'string') {
      values.description = dto.description;
    }

    const [updated] = await this.db
      .update(schema.automations)
      .set(values)
      .where(
        and(
          eq(schema.automations.id, automationId),
          eq(schema.automations.workspaceId, workspaceId),
        ),
      )
      .returning();

    return updated;
  }

  async createVersion(
    workspaceId: number,
    automationId: number,
    dto: CreateAutomationVersionDto,
  ) {
    await this.requireAutomation(workspaceId, automationId);
    const definition = validateWorkflowDefinition(dto.workflowDefinition);
    workflowTriggerMode(definition);

    const [latest] = await this.db
      .select()
      .from(schema.automationVersions)
      .where(eq(schema.automationVersions.automationId, automationId))
      .orderBy(desc(schema.automationVersions.versionNumber))
      .limit(1);

    const [version] = await this.db
      .insert(schema.automationVersions)
      .values({
        automationId,
        versionNumber: (latest?.versionNumber || 0) + 1,
        workflowDefinition: definition,
      })
      .returning();

    await this.db
      .update(schema.automations)
      .set({ updatedAt: new Date() })
      .where(eq(schema.automations.id, automationId));

    return version;
  }

  async publish(workspaceId: number, automationId: number) {
    await this.requireAutomation(workspaceId, automationId);

    const [latest] = await this.db
      .select()
      .from(schema.automationVersions)
      .where(eq(schema.automationVersions.automationId, automationId))
      .orderBy(desc(schema.automationVersions.versionNumber))
      .limit(1);

    if (!latest) {
      throw new NotFoundException('Automation version not found');
    }

    const definition = validateWorkflowDefinition(
      latest.workflowDefinition,
    );
    const triggerType = workflowTriggerMode(definition);
    const triggerNode = definition.nodes.find(
      (node) => workflowNodeKind(node) === 'trigger',
    );
    const triggerConfig = triggerNode ? nodeConfig(triggerNode) : {};

    let webhookCredentials:
      | {
          endpointUrl: string;
          secret?: string;
          sourceType: string;
          eventName: string;
        }
      | undefined;

    await this.db.transaction(async (tx) => {
      await tx
        .update(schema.automationVersions)
        .set({ publishedAt: new Date() })
        .where(eq(schema.automationVersions.id, latest.id));

      await tx
        .update(schema.automations)
        .set({
          status: 'active',
          triggerType,
          updatedAt: new Date(),
        })
        .where(eq(schema.automations.id, automationId));

      const [existingTrigger] = await tx
        .select()
        .from(schema.automationTriggers)
        .where(eq(schema.automationTriggers.automationId, automationId))
        .limit(1);

      if (triggerType === 'rss') {
        const rssConfig = {
          feedUrl: recordText(triggerConfig, 'feedUrl').trim(),
          pollMinutes: Number(triggerConfig.pollMinutes ?? 15),
          initialSync: recordText(
            triggerConfig,
            'initialSync',
            'baseline',
          ),
        };

        if (existingTrigger) {
          const previousConfig =
            existingTrigger.config &&
            typeof existingTrigger.config === 'object'
              ? (existingTrigger.config as Record<string, unknown>)
              : {};
          const feedChanged =
            recordText(previousConfig, 'feedUrl').trim() !== rssConfig.feedUrl;

          await tx
            .update(schema.automationTriggers)
            .set({
              type: 'rss',
              config: rssConfig,
              status: 'active',
              publicId: null,
              secret: null,
              leaseToken: null,
              leaseExpiresAt: null,
              nextPollAt: new Date(),
              lastPolledAt: feedChanged
                ? null
                : existingTrigger.lastPolledAt,
              lastTriggeredAt: feedChanged
                ? null
                : existingTrigger.lastTriggeredAt,
              lastReceivedAt: null,
              lastError: null,
              updatedAt: new Date(),
            })
            .where(eq(schema.automationTriggers.id, existingTrigger.id));
        } else {
          await tx.insert(schema.automationTriggers).values({
            automationId,
            type: 'rss',
            config: rssConfig,
            status: 'active',
            nextPollAt: new Date(),
          });
        }
      } else if (triggerType === 'webhook') {
        const sourceType = recordText(
          triggerConfig,
          'sourceType',
          'generic',
        )
          .trim()
          .toLowerCase();
        const eventName = recordText(
          triggerConfig,
          'eventName',
          sourceType === 'wordpress'
            ? 'wordpress.post.published'
            : 'content.published',
        ).trim();
        const publicId =
          existingTrigger?.publicId ||
          randomBytes(18).toString('base64url');
        let secret = existingTrigger?.secret || null;
        let revealedSecret: string | undefined;

        if (!secret) {
          revealedSecret = randomBytes(32).toString('base64url');
          secret = encrypt(revealedSecret);
        }

        if (existingTrigger) {
          await tx
            .update(schema.automationTriggers)
            .set({
              type: 'webhook',
              config: { sourceType, eventName },
              status: 'active',
              publicId,
              secret,
              leaseToken: null,
              leaseExpiresAt: null,
              nextPollAt: null,
              lastPolledAt: null,
              lastReceivedAt:
                existingTrigger.type === 'webhook' &&
                Boolean(existingTrigger.publicId)
                  ? existingTrigger.lastReceivedAt
                  : null,
              lastTriggeredAt:
                existingTrigger.type === 'webhook' &&
                Boolean(existingTrigger.publicId)
                  ? existingTrigger.lastTriggeredAt
                  : null,
              lastError: null,
              updatedAt: new Date(),
            })
            .where(eq(schema.automationTriggers.id, existingTrigger.id));
        } else {
          await tx.insert(schema.automationTriggers).values({
            automationId,
            type: 'webhook',
            config: { sourceType, eventName },
            status: 'active',
            publicId,
            secret,
          });
        }

        webhookCredentials = {
          endpointUrl: `${webhookBaseUrl(true)}/v1/automation-hooks/${publicId}`,
          secret: revealedSecret,
          sourceType,
          eventName,
        };
      } else if (existingTrigger) {
        await tx
          .update(schema.automationTriggers)
          .set({
            status: 'paused',
            publicId: null,
            secret: null,
            leaseToken: null,
            lastReceivedAt: null,
            leaseExpiresAt: null,
            nextPollAt: null,
            lastError: null,
            updatedAt: new Date(),
          })
          .where(eq(schema.automationTriggers.id, existingTrigger.id));
      }
    });

    return {
      automationId,
      versionId: latest.id,
      versionNumber: latest.versionNumber,
      status: 'active',
      triggerType,
      webhook: webhookCredentials,
    };
  }

  async pause(workspaceId: number, automationId: number) {
    const automation = await this.requireAutomation(workspaceId, automationId);
    if (automation.status !== 'active') {
      throw new BadRequestException('Only an active automation can be paused');
    }

    return this.db.transaction(async (tx) => {
      const [updated] = await tx
        .update(schema.automations)
        .set({ status: 'paused', updatedAt: new Date() })
        .where(
          and(
            eq(schema.automations.id, automationId),
            eq(schema.automations.workspaceId, workspaceId),
          ),
        )
        .returning();

      await tx
        .update(schema.automationTriggers)
        .set({
          status: 'paused',
          leaseToken: null,
          leaseExpiresAt: null,
          nextPollAt: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.automationTriggers.automationId, automationId));

      return {
        automationId: updated.id,
        status: updated.status,
      };
    });
  }

  async run(
    workspaceId: number,
    automationId: number,
    dto: RunAutomationDto = {},
  ) {
    const automation = await this.requireAutomation(workspaceId, automationId);

    const versions = await this.db
      .select()
      .from(schema.automationVersions)
      .where(eq(schema.automationVersions.automationId, automationId))
      .orderBy(desc(schema.automationVersions.versionNumber));

    const version = versions[0];

    if (!version) {
      throw new NotFoundException('Automation version not found');
    }

    const definition = validateWorkflowDefinition(version.workflowDefinition);
    const orderedNodes = orderWorkflow(definition);

    return this.db.transaction(async (tx) => {
      const [run] = await tx
        .insert(schema.automationRuns)
        .values({
          automationId,
          versionId: version.id,
          status: 'pending',
        })
        .returning();

      await tx.insert(schema.automationRunSteps).values(
        orderedNodes.map((node, index) => ({
          runId: run.id,
          stepId: node.id,
          status: 'pending',
          logs:
            index === 0 && dto.triggerPayload
              ? JSON.stringify({ triggerPayload: dto.triggerPayload })
              : null,
        })),
      );

      return {
        ...run,
        automation: {
          id: automation.id,
          name: automation.name,
        },
        versionNumber: version.versionNumber,
      };
    });
  }

  async findRuns(workspaceId: number, automationId: number) {
    await this.requireAutomation(workspaceId, automationId);

    return this.db.query.automationRuns.findMany({
      where: eq(schema.automationRuns.automationId, automationId),
      with: { steps: true, version: true },
      orderBy: (fields, { desc: orderDesc }) => [orderDesc(fields.createdAt)],
      limit: 50,
    });
  }

  private async requireAutomation(workspaceId: number, automationId: number) {
    const automation = await this.db.query.automations.findFirst({
      where: and(
        eq(schema.automations.id, automationId),
        eq(schema.automations.workspaceId, workspaceId),
      ),
    });

    if (!automation) {
      throw new NotFoundException(
        `Automation with id ${automationId} not found`,
      );
    }

    return automation;
  }
}
