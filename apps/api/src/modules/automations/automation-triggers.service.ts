import {
  BadRequestException,
  Injectable,
  Inject,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { and, desc, eq, isNotNull } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../db/db.module.js';
import * as schema from '../../db/schema.js';
import { decrypt, encrypt } from '../../utils/encryption.util.js';
import { normalizeWebhookPayload } from './webhook-payload.js';
import { verifyWebhookSignature } from './webhook-signature.js';
import {
  orderWorkflow,
  validateWorkflowDefinition,
} from './workflow-definition.js';

type RssEntry = {
  externalId: string;
  title?: string;
  link?: string;
  publishedAt?: string;
  summary?: string;
};

type RssTriggerConfig = {
  feedUrl: string;
  pollMinutes: number;
  initialSync: 'baseline' | 'latest';
};

function rssConfig(value: unknown): RssTriggerConfig {
  const config =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};

  return {
    feedUrl:
      typeof config.feedUrl === 'string' ? config.feedUrl.trim() : '',
    pollMinutes:
      typeof config.pollMinutes === 'number' &&
      Number.isInteger(config.pollMinutes)
        ? config.pollMinutes
        : 15,
    initialSync:
      config.initialSync === 'latest' ? 'latest' : 'baseline',
  };
}

function sanitizeEntry(value: RssEntry): RssEntry | null {
  const externalId = String(value.externalId || '').trim().slice(0, 1024);
  if (!externalId) return null;

  const text = (input: unknown, max: number) =>
    typeof input === 'string' && input.trim()
      ? input.trim().slice(0, max)
      : undefined;

  return {
    externalId,
    title: text(value.title, 1000),
    link: text(value.link, 2048),
    publishedAt: text(value.publishedAt, 100),
    summary: text(value.summary, 12_000),
  };
}

type WebhookTriggerConfig = {
  sourceType: 'generic' | 'wordpress';
  eventName: string;
};

function webhookConfig(value: unknown): WebhookTriggerConfig {
  const config =
    value && typeof value === 'object'
      ? (value as Record<string, unknown>)
      : {};
  const sourceType =
    String(config.sourceType || 'generic').toLowerCase() === 'wordpress'
      ? 'wordpress'
      : 'generic';
  const eventName = String(
    config.eventName ||
      (sourceType === 'wordpress'
        ? 'wordpress.post.published'
        : 'content.published'),
  ).trim();

  return { sourceType, eventName };
}

function webhookBaseUrl() {
  const value =
    process.env.WEBHOOK_PUBLIC_BASE_URL ||
    process.env.PUBLIC_API_URL ||
    (process.env.NODE_ENV !== 'production'
      ? 'http://localhost:4000'
      : undefined);

  if (!value) {
    throw new BadRequestException(
      'WEBHOOK_PUBLIC_BASE_URL must be configured for webhook automations',
    );
  }
  return value.replace(/\/$/, '');
}

@Injectable()
export class AutomationTriggersService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async listDispatchable(limit = 250) {
    const safeLimit = Math.min(500, Math.max(1, limit));
    const now = new Date();

    const rows = await this.db.query.automationTriggers.findMany({
      where: and(
        eq(schema.automationTriggers.type, 'rss'),
        eq(schema.automationTriggers.status, 'active'),
      ),
      with: { automation: true },
      orderBy: (fields, { asc }) => [asc(fields.updatedAt)],
      limit: safeLimit * 4,
    });

    return rows
      .filter((trigger) => {
        if (trigger.automation.status !== 'active') return false;
        if (trigger.nextPollAt && trigger.nextPollAt > now) return false;
        if (trigger.leaseExpiresAt && trigger.leaseExpiresAt > now) {
          return false;
        }
        return true;
      })
      .slice(0, safeLimit)
      .map((trigger) => ({
        triggerId: trigger.id,
        automationId: trigger.automationId,
        revision: String(trigger.updatedAt.getTime()),
      }));
  }

  async claim(triggerId: number, existingToken?: string) {
    const trigger = await this.db.query.automationTriggers.findFirst({
      where: eq(schema.automationTriggers.id, triggerId),
      with: { automation: true },
    });
    if (!trigger) throw new NotFoundException('Automation trigger not found');

    if (
      trigger.type !== 'rss' ||
      trigger.status !== 'active' ||
      trigger.automation.status !== 'active'
    ) {
      return { status: 'not_ready' as const, triggerId };
    }

    const now = Date.now();
    if (
      trigger.leaseToken &&
      existingToken === trigger.leaseToken &&
      trigger.leaseExpiresAt &&
      trigger.leaseExpiresAt.getTime() > now
    ) {
      const config = rssConfig(trigger.config);
      return {
        status: 'claimed' as const,
        triggerId,
        leaseToken: trigger.leaseToken,
        feedUrl: config.feedUrl,
        pollMinutes: config.pollMinutes,
        initialSync: config.initialSync,
      };
    }

    if (
      trigger.leaseToken &&
      trigger.leaseExpiresAt &&
      trigger.leaseExpiresAt.getTime() > now
    ) {
      return { status: 'already_processing' as const, triggerId };
    }

    const leaseToken = randomUUID();
    const leaseExpiresAt = new Date(now + 5 * 60_000);
    const [claimed] = await this.db
      .update(schema.automationTriggers)
      .set({
        leaseToken,
        leaseExpiresAt,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.automationTriggers.id, trigger.id),
          eq(schema.automationTriggers.updatedAt, trigger.updatedAt),
        ),
      )
      .returning();

    if (!claimed) {
      return { status: 'stale' as const, triggerId };
    }

    const config = rssConfig(claimed.config);
    return {
      status: 'claimed' as const,
      triggerId,
      leaseToken,
      feedUrl: config.feedUrl,
      pollMinutes: config.pollMinutes,
      initialSync: config.initialSync,
    };
  }

  async complete(
    triggerId: number,
    leaseToken: string,
    feedTitle: string | undefined,
    rawEntries: RssEntry[],
  ) {
    const trigger = await this.db.query.automationTriggers.findFirst({
      where: and(
        eq(schema.automationTriggers.id, triggerId),
        eq(schema.automationTriggers.leaseToken, leaseToken),
      ),
      with: { automation: true },
    });

    if (!trigger) {
      return { status: 'stale' as const, triggerId };
    }

    const config = rssConfig(trigger.config);
    const entries = rawEntries
      .map(sanitizeEntry)
      .filter((entry): entry is RssEntry => Boolean(entry))
      .slice(0, 50);

    const [publishedVersion] = await this.db
      .select()
      .from(schema.automationVersions)
      .where(
        and(
          eq(
            schema.automationVersions.automationId,
            trigger.automationId,
          ),
          isNotNull(schema.automationVersions.publishedAt),
        ),
      )
      .orderBy(desc(schema.automationVersions.versionNumber))
      .limit(1);

    if (!publishedVersion) {
      throw new BadRequestException(
        'RSS trigger has no published automation version',
      );
    }

    const definition = validateWorkflowDefinition(
      publishedVersion.workflowDefinition,
    );
    const orderedNodes = orderWorkflow(definition);
    const firstPoll = !trigger.lastPolledAt;
    const now = new Date();
    let newEvents = 0;
    let runCount = 0;
    const runIds: number[] = [];

    await this.db.transaction(async (tx) => {
      for (let index = 0; index < entries.length; index += 1) {
        const entry = entries[index];
        const eventKey = createHash('sha256')
          .update(
            `${trigger.id}:${config.feedUrl}:${entry.externalId}`,
            'utf8',
          )
          .digest('hex');

        const payload = {
          source: 'rss',
          feed: {
            title: feedTitle?.slice(0, 1000),
            url: config.feedUrl,
          },
          item: entry,
          receivedAt: now.toISOString(),
        };

        const [event] = await tx
          .insert(schema.automationTriggerEvents)
          .values({
            triggerId: trigger.id,
            automationId: trigger.automationId,
            eventKey,
            externalId: entry.externalId,
            payload,
          })
          .onConflictDoNothing({
            target: [
              schema.automationTriggerEvents.triggerId,
              schema.automationTriggerEvents.eventKey,
            ],
          })
          .returning();

        if (!event) continue;
        newEvents += 1;

        const shouldRun =
          !firstPoll ||
          (config.initialSync === 'latest' && index === 0);

        if (!shouldRun) continue;

        const [run] = await tx
          .insert(schema.automationRuns)
          .values({
            automationId: trigger.automationId,
            versionId: publishedVersion.id,
            status: 'pending',
          })
          .returning();

        await tx.insert(schema.automationRunSteps).values(
          orderedNodes.map((node, nodeIndex) => ({
            runId: run.id,
            stepId: node.id,
            status: 'pending',
            logs:
              nodeIndex === 0
                ? JSON.stringify({ triggerPayload: payload })
                : null,
          })),
        );

        await tx
          .update(schema.automationTriggerEvents)
          .set({ runId: run.id })
          .where(eq(schema.automationTriggerEvents.id, event.id));

        runIds.push(run.id);
        runCount += 1;
      }

      await tx
        .update(schema.automationTriggers)
        .set({
          leaseToken: null,
          leaseExpiresAt: null,
          lastPolledAt: now,
          lastTriggeredAt: runCount ? now : trigger.lastTriggeredAt,
          nextPollAt: new Date(
            now.getTime() + config.pollMinutes * 60_000,
          ),
          lastError: null,
          status: 'active',
          updatedAt: now,
        })
        .where(
          and(
            eq(schema.automationTriggers.id, trigger.id),
            eq(schema.automationTriggers.leaseToken, leaseToken),
          ),
        );
    });

    return {
      status: 'completed' as const,
      triggerId,
      firstPoll,
      newEvents,
      runCount,
      runIds,
    };
  }

  async fail(triggerId: number, leaseToken: string, reason: string) {
    const [failed] = await this.db
      .update(schema.automationTriggers)
      .set({
        status: 'error',
        leaseToken: null,
        leaseExpiresAt: null,
        nextPollAt: null,
        lastError: reason.slice(0, 2000),
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(schema.automationTriggers.id, triggerId),
          eq(schema.automationTriggers.leaseToken, leaseToken),
        ),
      )
      .returning();

    return failed
      ? { status: 'error' as const, triggerId }
      : { status: 'stale' as const, triggerId };
  }

  async ingestWebhook(
    publicId: string,
    input: {
      rawBody: Buffer;
      body: unknown;
      timestamp?: string;
      signature?: string;
      eventId?: string;
      eventName?: string;
    },
  ) {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(publicId)) {
      throw new NotFoundException('Automation webhook not found');
    }

    const trigger = await this.db.query.automationTriggers.findFirst({
      where: and(
        eq(schema.automationTriggers.publicId, publicId),
        eq(schema.automationTriggers.type, 'webhook'),
        eq(schema.automationTriggers.status, 'active'),
      ),
      with: { automation: true },
    });

    if (
      !trigger ||
      trigger.automation.status !== 'active' ||
      !trigger.secret
    ) {
      throw new NotFoundException('Automation webhook not found');
    }

    const config = webhookConfig(trigger.config);
    const incomingEvent = String(input.eventName || '').trim();
    if (!incomingEvent || incomingEvent !== config.eventName) {
      throw new BadRequestException('Webhook event does not match this trigger');
    }

    let secret: string;
    try {
      secret = decrypt(trigger.secret);
    } catch {
      throw new UnauthorizedException('Webhook secret is unavailable');
    }

    const verification = verifyWebhookSignature({
      secret,
      timestamp: input.timestamp,
      signature: input.signature,
      rawBody: input.rawBody,
      toleranceSeconds: 300,
    });
    if (!verification.ok) {
      throw new UnauthorizedException(verification.reason);
    }

    const item = normalizeWebhookPayload({
      sourceType: config.sourceType,
      body: input.body,
      rawBody: input.rawBody,
      eventId: input.eventId,
    });

    if (
      config.sourceType === 'wordpress' &&
      item.status &&
      item.status.toLowerCase() !== 'publish'
    ) {
      throw new BadRequestException(
        'WordPress webhook payload is not a published post',
      );
    }

    const [publishedVersion] = await this.db
      .select()
      .from(schema.automationVersions)
      .where(
        and(
          eq(
            schema.automationVersions.automationId,
            trigger.automationId,
          ),
          isNotNull(schema.automationVersions.publishedAt),
        ),
      )
      .orderBy(desc(schema.automationVersions.versionNumber))
      .limit(1);

    if (!publishedVersion) {
      throw new BadRequestException(
        'Webhook trigger has no published automation version',
      );
    }

    const definition = validateWorkflowDefinition(
      publishedVersion.workflowDefinition,
    );
    const orderedNodes = orderWorkflow(definition);
    const now = new Date();
    const eventKey = createHash('sha256')
      .update(
        `${trigger.id}:${config.eventName}:${item.externalId}`,
        'utf8',
      )
      .digest('hex');
    const payload = {
      source:
        config.sourceType === 'wordpress' ? 'wordpress' : 'webhook',
      event: {
        name: config.eventName,
        id: input.eventId?.slice(0, 1024),
      },
      item,
      receivedAt: now.toISOString(),
    };

    return this.db.transaction(async (tx) => {
      const [event] = await tx
        .insert(schema.automationTriggerEvents)
        .values({
          triggerId: trigger.id,
          automationId: trigger.automationId,
          eventKey,
          externalId: item.externalId,
          payload,
        })
        .onConflictDoNothing({
          target: [
            schema.automationTriggerEvents.triggerId,
            schema.automationTriggerEvents.eventKey,
          ],
        })
        .returning();

      if (!event) {
        await tx
          .update(schema.automationTriggers)
          .set({
            lastReceivedAt: now,
            lastError: null,
            updatedAt: now,
          })
          .where(eq(schema.automationTriggers.id, trigger.id));

        return {
          accepted: true,
          duplicate: true,
          eventName: config.eventName,
          runId: null,
        };
      }

      const [run] = await tx
        .insert(schema.automationRuns)
        .values({
          automationId: trigger.automationId,
          versionId: publishedVersion.id,
          status: 'pending',
        })
        .returning();

      await tx.insert(schema.automationRunSteps).values(
        orderedNodes.map((node, index) => ({
          runId: run.id,
          stepId: node.id,
          status: 'pending',
          logs:
            index === 0
              ? JSON.stringify({ triggerPayload: payload })
              : null,
        })),
      );

      await tx
        .update(schema.automationTriggerEvents)
        .set({ runId: run.id })
        .where(eq(schema.automationTriggerEvents.id, event.id));

      await tx
        .update(schema.automationTriggers)
        .set({
          lastReceivedAt: now,
          lastTriggeredAt: now,
          lastError: null,
          status: 'active',
          updatedAt: now,
        })
        .where(eq(schema.automationTriggers.id, trigger.id));

      return {
        accepted: true,
        duplicate: false,
        eventName: config.eventName,
        runId: run.id,
      };
    });
  }

  async rotateWebhookSecret(
    workspaceId: number,
    automationId: number,
  ) {
    const automation = await this.db.query.automations.findFirst({
      where: and(
        eq(schema.automations.id, automationId),
        eq(schema.automations.workspaceId, workspaceId),
      ),
      with: { triggers: true },
    });
    if (!automation) {
      throw new NotFoundException('Automation not found');
    }

    const trigger = automation.triggers.find(
      (candidate) => candidate.type === 'webhook',
    );
    if (!trigger || !trigger.publicId) {
      throw new NotFoundException('Webhook trigger not found');
    }

    const secret = randomBytes(32).toString('base64url');
    const [updated] = await this.db
      .update(schema.automationTriggers)
      .set({
        secret: encrypt(secret),
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.automationTriggers.id, trigger.id))
      .returning();

    return {
      triggerId: updated.id,
      endpointUrl: `${webhookBaseUrl()}/v1/automation-hooks/${updated.publicId}`,
      secret,
    };
  }

  async retry(workspaceId: number, automationId: number) {
    const automation = await this.db.query.automations.findFirst({
      where: and(
        eq(schema.automations.id, automationId),
        eq(schema.automations.workspaceId, workspaceId),
      ),
      with: { triggers: true },
    });
    if (!automation) {
      throw new NotFoundException('Automation not found');
    }

    const trigger = automation.triggers.find(
      (candidate) => candidate.type === 'rss',
    );
    if (!trigger) {
      throw new NotFoundException('RSS trigger not found');
    }

    const [updated] = await this.db
      .update(schema.automationTriggers)
      .set({
        status: 'active',
        leaseToken: null,
        leaseExpiresAt: null,
        nextPollAt: new Date(),
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(schema.automationTriggers.id, trigger.id))
      .returning();

    return updated;
  }
}
