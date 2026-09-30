import { eq } from 'drizzle-orm';
import type postgres from 'postgres';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../src/db/schema.js';

export type SeededChannel = {
  workspaceId: number;
  brandId: number;
  socialAccountId: number;
  contentItemId: number;
};

let counter = 0;

export async function seedChannel(
  sql: postgres.Sql,
  provider = 'x',
): Promise<SeededChannel> {
  counter += 1;
  const key = `${process.pid}-${Date.now()}-${counter}`;
  const [workspace] = await sql<{ id: number }[]>`
    insert into workspaces (name, slug) values (${`Workspace ${key}`}, ${`ws-${key}`}) returning id`;
  const [brand] = await sql<{ id: number }[]>`
    insert into brands (workspace_id, name) values (${workspace.id}, 'Brand') returning id`;
  const [account] = await sql<{ id: number }[]>`
    insert into social_accounts (workspace_id, brand_id, provider, provider_account_id, access_token, status)
    values (${workspace.id}, ${brand.id}, ${provider}, ${`acct-${key}`}, 'not-a-real-token', 'active')
    returning id`;
  const [content] = await sql<{ id: number }[]>`
    insert into content_items (workspace_id, brand_id, title, description, status)
    values (${workspace.id}, ${brand.id}, 'Launch', 'Launch day', 'approved')
    returning id`;
  return {
    workspaceId: workspace.id,
    brandId: brand.id,
    socialAccountId: account.id,
    contentItemId: content.id,
  };
}

export async function createPublication(
  db: PostgresJsDatabase<typeof schema>,
  seeded: SeededChannel,
  overrides: Partial<typeof schema.scheduledPublications.$inferInsert> = {},
) {
  const [row] = await db
    .insert(schema.scheduledPublications)
    .values({
      workspaceId: seeded.workspaceId,
      contentItemId: seeded.contentItemId,
      socialAccountId: seeded.socialAccountId,
      scheduledAt: new Date(Date.now() - 1_000),
      status: 'scheduled',
      ...overrides,
    })
    .returning();
  return row;
}

/** An `unknown` / `needs_review` publication, optionally with its one attempt row. */
export async function createAmbiguousPublication(
  db: PostgresJsDatabase<typeof schema>,
  seeded: SeededChannel,
  options: {
    status: 'unknown' | 'needs_review';
    reconcileAfter?: Date | null;
    updatedAt?: Date;
    scheduledAt?: Date;
    /** `null`: no attempt row at all (R8). */
    attempt?: {
      operationType?: string;
      operationId?: string | null;
      checkpoint?: Record<string, unknown> | null;
      postIds?: string[];
    } | null;
  },
) {
  const publication = await createPublication(db, seeded, {
    status: options.status,
    reconcileAfter: options.reconcileAfter ?? null,
    ...(options.scheduledAt ? { scheduledAt: options.scheduledAt } : {}),
  });
  let attemptId: number | null = null;
  if (options.attempt !== null) {
    const attempt = options.attempt ?? {};
    const [job] = await db
      .insert(schema.publicationJobs)
      .values({
        scheduledPublicationId: publication.id,
        status: 'unknown',
        attempts: 1,
        attemptNumber: 1,
        lastAttemptAt: new Date(),
        providerRequestStartedAt: new Date(),
        providerOperationType:
          attempt.operationType ?? 'instagram_media_publish',
        providerOperationId:
          attempt.operationId === undefined ? 'container-1' : attempt.operationId,
        providerCheckpoint: attempt.checkpoint ?? null,
      })
      .returning({ id: schema.publicationJobs.id });
    attemptId = job.id;
    for (const platformPostId of attempt.postIds ?? []) {
      await db
        .insert(schema.publicationResults)
        .values({ publicationJobId: job.id, platformPostId });
    }
  }
  const [row] = await db
    .update(schema.scheduledPublications)
    .set({
      activeAttemptId: attemptId,
      ...(options.updatedAt ? { updatedAt: options.updatedAt } : {}),
    })
    .where(eq(schema.scheduledPublications.id, publication.id))
    .returning();
  return row;
}

/** Audit actions enqueued for one publication, oldest first. */
export async function auditActions(sql: postgres.Sql, publicationId: number) {
  const rows = await sql<{ action: string }[]>`
    select payload->>'action' as action from outbox_events
    where topic = 'audit.append'
      and payload->>'targetType' = 'scheduled_publication'
      and payload->>'targetId' = ${String(publicationId)}
    order by id`;
  return rows.map((row) => row.action);
}

export function reconciliationsOf(
  db: PostgresJsDatabase<typeof schema>,
  publicationId: number,
) {
  return db
    .select()
    .from(schema.publicationReconciliations)
    .where(
      eq(schema.publicationReconciliations.scheduledPublicationId, publicationId),
    )
    .orderBy(schema.publicationReconciliations.id);
}
