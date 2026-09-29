import {
  BadRequestException,
  Injectable,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { and, eq } from 'drizzle-orm';
import * as schema from '../../db/schema.js';
import { DRIZZLE } from '../../db/db.module.js';

type TriggerConfig = Record<string, unknown>;

function configText(config: unknown, key: string) {
  if (!config || typeof config !== 'object') return '';
  const value = (config as TriggerConfig)[key];
  return typeof value === 'string' ? value.trim() : '';
}

function classifyTrigger(
  trigger: typeof schema.automationTriggers.$inferSelect,
) {
  if (trigger.type === 'rss') return 'rss';
  if (trigger.type === 'webhook') {
    return configText(trigger.config, 'sourceType').toLowerCase() === 'wordpress'
      ? 'wordpress'
      : 'webhook';
  }
  return null;
}

@Injectable()
export class IntegrationsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async overview(workspaceId: number) {
    const automations = await this.db.query.automations.findMany({
      where: eq(schema.automations.workspaceId, workspaceId),
      with: {
        triggers: {
          with: {
            events: {
              orderBy: (fields, { desc }) => [desc(fields.createdAt)],
              limit: 5,
            },
          },
        },
      },
      orderBy: (fields, { desc }) => [desc(fields.updatedAt)],
    });

    const legacyRecords = await this.db.query.integrations.findMany({
      where: eq(schema.integrations.workspaceId, workspaceId),
      columns: { id: true },
      limit: 1000,
    });

    const instances = automations.flatMap((automation) =>
      automation.triggers
        .map((trigger) => {
          const kind = classifyTrigger(trigger);
          if (!kind) return null;

          const activityAt =
            trigger.lastTriggeredAt ||
            trigger.lastReceivedAt ||
            trigger.lastPolledAt ||
            trigger.updatedAt;

          return {
            kind,
            triggerId: trigger.id,
            automationId: automation.id,
            automationName: automation.name,
            automationStatus: automation.status,
            triggerStatus: trigger.status,
            feedUrl:
              kind === 'rss' ? configText(trigger.config, 'feedUrl') : null,
            sourceType:
              trigger.type === 'webhook'
                ? configText(trigger.config, 'sourceType') || 'generic'
                : null,
            eventName:
              trigger.type === 'webhook'
                ? configText(trigger.config, 'eventName')
                : null,
            publicId: trigger.publicId,
            nextPollAt: trigger.nextPollAt,
            lastPolledAt: trigger.lastPolledAt,
            lastReceivedAt: trigger.lastReceivedAt,
            lastTriggeredAt: trigger.lastTriggeredAt,
            lastError: trigger.lastError,
            recentEventCount: trigger.events.length,
            lastEventAt: trigger.events[0]?.createdAt || null,
            activityAt,
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item)),
    );

    const catalog = [
      {
        key: 'rss',
        name: 'RSS',
        mode: 'polling',
        description:
          'Poll a public RSS/Atom feed with SSRF-safe fetching, dedupe and persisted trigger events.',
      },
      {
        key: 'wordpress',
        name: 'WordPress',
        mode: 'signed_webhook',
        description:
          'Receive WordPress publish events through the signed automation webhook runtime.',
      },
      {
        key: 'webhook',
        name: 'Signed webhook',
        mode: 'signed_webhook',
        description:
          'Receive generic HMAC-signed external events with replay protection and persisted dedupe.',
      },
    ].map((entry) => {
      const configured = instances.filter((item) => item.kind === entry.key);
      const active = configured.filter(
        (item) =>
          item.triggerStatus === 'active' &&
          item.automationStatus === 'active',
      );
      const errors = configured.filter((item) => Boolean(item.lastError));
      const latestActivity = configured
        .map((item) => item.activityAt)
        .filter((value): value is Date => Boolean(value))
        .sort((a, b) => b.getTime() - a.getTime())[0];

      return {
        ...entry,
        supported: true,
        configuredCount: configured.length,
        activeCount: active.length,
        errorCount: errors.length,
        latestActivityAt: latestActivity || null,
      };
    });

    return {
      workspaceId,
      catalog,
      instances,
      legacyRecordCount: legacyRecords.length,
      productBoundary: {
        configurationOwner: 'automations',
        secretsReadableAfterCreation: false,
        wordpressMode: 'signed_webhook',
        rssMode: 'polling',
      },
    };
  }

  findAll(workspaceId: number) {
    return this.db.query.integrations.findMany({
      where: eq(schema.integrations.workspaceId, workspaceId),
    });
  }

  async findOne(workspaceId: number, id: number) {
    const integration = await this.db.query.integrations.findFirst({
      where: and(
        eq(schema.integrations.id, id),
        eq(schema.integrations.workspaceId, workspaceId),
      ),
    });

    if (!integration) throw new NotFoundException('Integration not found');
    return integration;
  }

  async create(
    _workspaceId: number,
    _data: { type: string; config: Record<string, unknown> },
  ) {
    throw new BadRequestException(
      'Generic integration records are not runtime-backed. Configure RSS, WordPress, or signed webhook triggers in Automations.',
    );
  }

  async update(
    workspaceId: number,
    id: number,
    data: { config?: Record<string, unknown>; status?: string },
  ) {
    await this.findOne(workspaceId, id);

    const [updated] = await this.db
      .update(schema.integrations)
      .set({ ...data, updatedAt: new Date() })
      .where(
        and(
          eq(schema.integrations.id, id),
          eq(schema.integrations.workspaceId, workspaceId),
        ),
      )
      .returning();

    return updated;
  }

  async remove(workspaceId: number, id: number) {
    await this.findOne(workspaceId, id);
    await this.db
      .delete(schema.integrations)
      .where(
        and(
          eq(schema.integrations.id, id),
          eq(schema.integrations.workspaceId, workspaceId),
        ),
      );

    return { success: true };
  }

  async syncIntegration(_workspaceId: number, _id: number) {
    throw new BadRequestException(
      'Legacy generic integration sync is disabled because it does not execute the production automation runtime.',
    );
  }
}
