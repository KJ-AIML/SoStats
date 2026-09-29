import {
  Injectable,
  Inject,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { and, eq, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../db/db.module.js';
import * as schema from '../../db/schema.js';

export type OutboxTopic = 'audit.append';

export type OutboxEnqueueInput = {
  workspaceId?: number | null;
  topic: OutboxTopic;
  dedupeKey: string;
  payload: Record<string, unknown>;
  availableAt?: Date;
};

type InsertExecutor = Pick<PostgresJsDatabase<typeof schema>, 'insert'>;

export type ClaimedOutboxEvent = {
  id: number;
  workspaceId: number | null;
  topic: string;
  leaseToken: string;
  leaseExpiresAt: Date;
};

function boundedLimit(value: number) {
  if (!Number.isFinite(value)) return 100;
  return Math.min(Math.max(Math.trunc(value), 1), 500);
}

function leaseSeconds() {
  const parsed = Number.parseInt(process.env.OUTBOX_LEASE_SECONDS || '120', 10);
  return Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, 30), 900)
    : 120;
}

function maxAttempts() {
  const parsed = Number.parseInt(process.env.OUTBOX_MAX_ATTEMPTS || '8', 10);
  return Number.isFinite(parsed)
    ? Math.min(Math.max(parsed, 1), 25)
    : 8;
}

function retryDelayMs(attempt: number) {
  const base = Number.parseInt(
    process.env.OUTBOX_RETRY_BASE_MS || '5000',
    10,
  );
  const safeBase = Number.isFinite(base)
    ? Math.min(Math.max(base, 1000), 300_000)
    : 5000;
  return Math.min(safeBase * 2 ** Math.max(0, attempt - 1), 60 * 60 * 1000);
}

function safeError(error: unknown) {
  return (
    error instanceof Error ? error.message : String(error || 'unknown error')
  ).slice(0, 1000);
}

function stringField(
  payload: Record<string, unknown>,
  key: string,
  max: number,
) {
  const value = payload[key];
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error('Outbox audit payload is missing ' + key);
  }
  return value.trim().slice(0, max);
}

function optionalStringField(
  payload: Record<string, unknown>,
  key: string,
  max: number,
) {
  const value = payload[key];
  return typeof value === 'string' && value
    ? value.slice(0, max)
    : null;
}

@Injectable()
export class OutboxService {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
  ) {}

  async enqueue(
    executor: InsertExecutor,
    input: OutboxEnqueueInput,
  ) {
    const dedupeKey = input.dedupeKey.trim().slice(0, 255);
    if (!dedupeKey) throw new Error('Outbox dedupe key is required');

    const [event] = await executor
      .insert(schema.outboxEvents)
      .values({
        workspaceId: input.workspaceId ?? null,
        topic: input.topic,
        dedupeKey,
        payload: input.payload,
        availableAt: input.availableAt || new Date(),
      })
      .onConflictDoNothing({
        target: schema.outboxEvents.dedupeKey,
      })
      .returning();

    if (event) return event;

    return this.db.query.outboxEvents.findFirst({
      where: eq(schema.outboxEvents.dedupeKey, dedupeKey),
    });
  }

  async claim(limit = 100): Promise<ClaimedOutboxEvent[]> {
    const token = randomBytes(24).toString('hex');
    const seconds = leaseSeconds();
    const count = boundedLimit(limit);

    return this.db.transaction(async (tx) => {
      const rows = await tx.execute(sql`
        with candidates as (
          select id
          from outbox_events
          where
            available_at <= now()
            and (
              status = 'pending'
              or (
                status = 'processing'
                and (lease_expires_at is null or lease_expires_at <= now())
              )
            )
          order by id
          for update skip locked
          limit ${count}
        )
        update outbox_events as event
        set
          status = 'processing',
          lease_token = ${token},
          lease_expires_at = now() + (${seconds} * interval '1 second'),
          updated_at = now()
        from candidates
        where event.id = candidates.id
        returning
          event.id,
          event.workspace_id as "workspaceId",
          event.topic,
          event.lease_token as "leaseToken",
          event.lease_expires_at as "leaseExpiresAt"
      `);

      return Array.from(
        rows as unknown as ArrayLike<ClaimedOutboxEvent>,
      );
    });
  }

  async execute(id: number, leaseToken: string) {
    if (!Number.isInteger(id) || id <= 0 || !leaseToken) {
      throw new NotFoundException('Outbox event not found');
    }

    const current = await this.db.query.outboxEvents.findFirst({
      where: and(
        eq(schema.outboxEvents.id, id),
        eq(schema.outboxEvents.leaseToken, leaseToken),
      ),
    });

    if (!current) throw new NotFoundException('Outbox event not found');
    if (current.status === 'completed') {
      return { status: 'completed', outboxEventId: id };
    }
    if (current.status === 'dead') {
      return { status: 'dead', outboxEventId: id };
    }
    if (
      current.status !== 'processing' ||
      !current.leaseExpiresAt ||
      current.leaseExpiresAt.getTime() <= Date.now()
    ) {
      return { status: 'stale_lease', outboxEventId: id };
    }

    try {
      await this.db.transaction(async (tx) => {
        const locked = await tx.query.outboxEvents.findFirst({
          where: and(
            eq(schema.outboxEvents.id, id),
            eq(schema.outboxEvents.leaseToken, leaseToken),
            eq(schema.outboxEvents.status, 'processing'),
          ),
        });
        if (!locked) throw new Error('Outbox lease is no longer active');

        switch (locked.topic) {
          case 'audit.append':
            await this.materializeAudit(tx, locked);
            break;
          default:
            throw new Error('Unsupported outbox topic: ' + locked.topic);
        }

        await tx
          .update(schema.outboxEvents)
          .set({
            status: 'completed',
            processedAt: new Date(),
            leaseToken: null,
            leaseExpiresAt: null,
            lastError: null,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(schema.outboxEvents.id, id),
              eq(schema.outboxEvents.leaseToken, leaseToken),
            ),
          );
      });

      return { status: 'completed', outboxEventId: id };
    } catch (error) {
      const attempt = current.attempts + 1;
      const dead = attempt >= maxAttempts();
      await this.db
        .update(schema.outboxEvents)
        .set({
          status: dead ? 'dead' : 'pending',
          attempts: attempt,
          availableAt: dead
            ? current.availableAt
            : new Date(Date.now() + retryDelayMs(attempt)),
          leaseToken: null,
          leaseExpiresAt: null,
          lastError: safeError(error),
          updatedAt: new Date(),
        })
        .where(eq(schema.outboxEvents.id, id));

      return {
        status: dead ? 'dead' : 'retry_scheduled',
        outboxEventId: id,
        attempts: attempt,
        error: safeError(error),
      };
    }
  }

  private async materializeAudit(
    tx: Parameters<
      Parameters<PostgresJsDatabase<typeof schema>['transaction']>[0]
    >[0],
    event: typeof schema.outboxEvents.$inferSelect,
  ) {
    const payload = event.payload || {};
    const workspaceId =
      typeof payload.workspaceId === 'number'
        ? payload.workspaceId
        : event.workspaceId;
    if (!workspaceId) {
      throw new Error('Audit outbox event is missing workspaceId');
    }

    const actorUserId =
      typeof payload.actorUserId === 'number' ? payload.actorUserId : null;
    const apiKeyId =
      typeof payload.apiKeyId === 'number' ? payload.apiKeyId : null;
    const metadata =
      payload.metadata &&
      typeof payload.metadata === 'object' &&
      !Array.isArray(payload.metadata)
        ? (payload.metadata as Record<string, unknown>)
        : {};

    await tx
      .insert(schema.workspaceAuditEvents)
      .values({
        workspaceId,
        actorUserId,
        actorEmail: optionalStringField(payload, 'actorEmail', 255),
        authMethod: stringField(payload, 'authMethod', 40),
        apiKeyId,
        sourceOutboxEventId: event.id,
        action: stringField(payload, 'action', 120),
        targetType: stringField(payload, 'targetType', 80),
        targetId: optionalStringField(payload, 'targetId', 120),
        metadata,
      })
      .onConflictDoNothing({
        target: schema.workspaceAuditEvents.sourceOutboxEventId,
      });
  }

  async stats() {
    const rows = await this.db
      .select({
        status: schema.outboxEvents.status,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.outboxEvents)
      .groupBy(schema.outboxEvents.status);

    return Object.fromEntries(
      rows.map((row) => [row.status, Number(row.count)]),
    );
  }
}
