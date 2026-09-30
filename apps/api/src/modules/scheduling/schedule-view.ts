import type * as schema from '../../db/schema.js';

type Job = Pick<
  typeof schema.publicationJobs.$inferSelect,
  | 'id'
  | 'status'
  | 'attemptNumber'
  | 'attempts'
  | 'lastAttemptAt'
  | 'nextAttemptAt'
  | 'completedAt'
  | 'errorClass'
  | 'providerRequestStartedAt'
  | 'providerOperationType'
  | 'providerOperationId'
  | 'providerCheckpoint'
> & {
  results: Array<
    Pick<
      typeof schema.publicationResults.$inferSelect,
      'id' | 'platformPostId' | 'platformPostUrl' | 'errorType' | 'errorMessage' | 'createdAt'
    >
  >;
};

type Reconciliation = Pick<
  typeof schema.publicationReconciliations.$inferSelect,
  | 'source'
  | 'outcome'
  | 'evidenceType'
  | 'platformPostId'
  | 'platformPostUrl'
  | 'evidence'
  | 'note'
  | 'createdAt'
> & { actor: { id: number; name: string | null } | null };

const text = (value: unknown) =>
  typeof value === 'string' && value ? value : null;

/**
 * 32B-1 §8 / R6: explicit fields only. The raw checkpoint and the evidence
 * JSON are read here and never returned.
 */
export function toScheduleView<
  T extends {
    activeAttemptId: number | null;
    jobs: Job[];
    reconciliations: Reconciliation[];
  },
>(row: T) {
  const { jobs, reconciliations, ...schedule } = row;
  const active = jobs.find((job) => job.id === row.activeAttemptId);
  return {
    ...schedule,
    jobs: jobs.map((job) => ({
      id: job.id,
      status: job.status,
      attemptNumber: job.attemptNumber,
      attempts: job.attempts,
      lastAttemptAt: job.lastAttemptAt,
      nextAttemptAt: job.nextAttemptAt,
      completedAt: job.completedAt,
      errorClass: job.errorClass,
      results: job.results.map((result) => ({
        id: result.id,
        platformPostId: result.platformPostId,
        platformPostUrl: result.platformPostUrl,
        errorType: result.errorType,
        errorMessage: result.errorMessage,
        createdAt: result.createdAt,
      })),
    })),
    attemptEvidence: active
      ? {
          requestStartedAt: active.providerRequestStartedAt,
          operationType: active.providerOperationType,
          operationId: active.providerOperationId,
          confirmedPlatformPostId: text(
            active.providerCheckpoint?.confirmedPlatformPostId,
          ),
          confirmedPlatformPostUrl: text(
            active.providerCheckpoint?.confirmedPlatformPostUrl,
          ),
        }
      : null,
    reconciliations: reconciliations.map((entry) => ({
      source: entry.source,
      outcome: entry.outcome,
      evidenceType: entry.evidenceType,
      platformPostId: entry.platformPostId,
      platformPostUrl: entry.platformPostUrl,
      duplicatePlatformPostIds: Array.isArray(
        entry.evidence?.duplicatePlatformPostIds,
      )
        ? entry.evidence.duplicatePlatformPostIds.filter(
            (id): id is string => typeof id === 'string',
          )
        : [],
      actor: entry.actor ? { id: entry.actor.id, name: entry.actor.name } : null,
      note: entry.note,
      createdAt: entry.createdAt,
    })),
  };
}
