import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import type {
  AuditActor,
  AuditLogService,
} from '../../common/audit/audit-log.service.js';
import type { Tx } from './publication-rollup.js';

const pj = schema.publicationJobs;
const pr = schema.publicationResults;

export const SYSTEM_ACTOR: AuditActor = {
  userId: null,
  email: null,
  authMethod: 'system',
};

/** Strong positive evidence (32B-1 §4.2). */
export type ConfirmedEvidence = {
  kind: 'confirmed';
  evidenceType: string;
  attemptId: number;
  platformPostId: string | null;
  platformPostUrl: string | null;
  duplicatePlatformPostIds: string[];
};

/** Everything else (R1). `evidenceType` is a fixed reason code. */
export type InconclusiveEvidence = {
  kind: 'inconclusive';
  evidenceType: string;
  attemptId: number | null;
};

export type ReconcileEvidence = ConfirmedEvidence | InconclusiveEvidence;

/** Spec 32B-1 §7.1, after validation. */
export type ResolutionAction =
  | {
      action: 'mark_published';
      platformPostId?: string;
      platformPostUrl?: string;
      note?: string;
    }
  | { action: 'confirm_absent'; scheduledAt: Date; note?: string }
  | { action: 'cancel'; note?: string };

type ReadExecutor = Pick<PostgresJsDatabase<typeof schema>, 'select'>;

/** §4.2 sources 1–2: local proof that the post is live, or null. */
export async function loadLocalEvidence(
  executor: ReadExecutor,
  publicationId: number,
): Promise<ConfirmedEvidence | null> {
  const posted = await executor
    .select({
      attemptId: pr.publicationJobId,
      platformPostId: pr.platformPostId,
      platformPostUrl: pr.platformPostUrl,
    })
    .from(pr)
    .innerJoin(pj, eq(pj.id, pr.publicationJobId))
    .where(
      and(
        eq(pj.scheduledPublicationId, publicationId),
        isNotNull(pr.platformPostId),
      ),
    )
    .orderBy(desc(pr.createdAt), desc(pr.id));
  const latest = posted[0];
  if (latest?.platformPostId) {
    const ids = [...new Set(posted.map((row) => row.platformPostId as string))];
    return {
      kind: 'confirmed',
      evidenceType: 'existing_result_post_id',
      attemptId: latest.attemptId,
      platformPostId: latest.platformPostId,
      platformPostUrl: latest.platformPostUrl,
      duplicatePlatformPostIds: ids.length > 1 ? ids : [],
    };
  }

  const [job] = await executor
    .select({ id: pj.id, checkpoint: pj.providerCheckpoint })
    .from(pj)
    .where(
      and(
        eq(pj.scheduledPublicationId, publicationId),
        sql`${pj.providerCheckpoint} ->> 'confirmedPlatformPostId' is not null`,
      ),
    )
    .orderBy(desc(pj.createdAt), desc(pj.id))
    .limit(1);
  const id = job?.checkpoint?.confirmedPlatformPostId;
  if (!job || typeof id !== 'string' || !id) return null;
  const url = job.checkpoint?.confirmedPlatformPostUrl;
  return {
    kind: 'confirmed',
    evidenceType: 'confirmed_post_id',
    attemptId: job.id,
    platformPostId: id,
    platformPostUrl: typeof url === 'string' ? url : null,
    duplicatePlatformPostIds: [],
  };
}

/**
 * Reuses this publication's result that carries the same post id, and never
 * another publication's. Otherwise inserts one on `attemptId`, which must be
 * a real attempt (R8).
 */
export async function reuseOrInsertResult(
  tx: Tx,
  publicationId: number,
  attemptId: number,
  platformPostId: string,
  platformPostUrl: string | null,
) {
  const [existing] = await tx
    .select({ id: pr.id })
    .from(pr)
    .innerJoin(pj, eq(pj.id, pr.publicationJobId))
    .where(
      and(
        eq(pj.scheduledPublicationId, publicationId),
        eq(pr.platformPostId, platformPostId),
      ),
    )
    .limit(1);
  if (existing) return existing.id;
  const [inserted] = await tx
    .insert(pr)
    .values({ publicationJobId: attemptId, platformPostId, platformPostUrl })
    .returning({ id: pr.id });
  return inserted.id;
}

export type ReconciliationEntry = {
  publicationId: number;
  workspaceId: number;
  attemptId: number | null;
  source: 'automatic' | 'operator';
  outcome: 'confirmed_published' | 'inconclusive' | 'confirmed_absent' | 'cancelled';
  evidenceType: string;
  previousStatus: string;
  platformPostId?: string | null;
  platformPostUrl?: string | null;
  duplicatePlatformPostIds?: string[];
  scheduledAt?: Date;
  note?: string | null;
  actor: AuditActor;
  auditAction: string;
};

/** R5: one history row plus its audit event, in the caller's transaction. */
export async function appendReconciliation(
  tx: Tx,
  audit: Pick<AuditLogService, 'enqueue'>,
  entry: ReconciliationEntry,
) {
  const evidenceType = entry.evidenceType.slice(0, 60);
  const [row] = await tx
    .insert(schema.publicationReconciliations)
    .values({
      scheduledPublicationId: entry.publicationId,
      attemptId: entry.attemptId,
      source: entry.source,
      outcome: entry.outcome,
      evidenceType,
      platformPostId: entry.platformPostId ?? null,
      platformPostUrl: entry.platformPostUrl ?? null,
      evidence: {
        previousStatus: entry.previousStatus,
        ...(entry.duplicatePlatformPostIds?.length
          ? { duplicatePlatformPostIds: entry.duplicatePlatformPostIds }
          : {}),
        ...(entry.scheduledAt
          ? { scheduledAt: entry.scheduledAt.toISOString() }
          : {}),
      },
      actorUserId: entry.actor.userId ?? null,
      note: entry.note ?? null,
    })
    .returning({ id: schema.publicationReconciliations.id });

  await audit.enqueue(
    tx,
    {
      workspaceId: entry.workspaceId,
      actor: entry.actor,
      action: entry.auditAction,
      targetType: 'scheduled_publication',
      targetId: entry.publicationId,
      metadata: {
        reconciliationId: row.id,
        attemptId: entry.attemptId,
        outcome: entry.outcome,
        evidenceType,
        platformPostId: entry.platformPostId ?? null,
        previousStatus: entry.previousStatus,
      },
    },
    `audit:${entry.auditAction}:${entry.workspaceId}:${entry.publicationId}:${row.id}`,
  );
  return row.id;
}
