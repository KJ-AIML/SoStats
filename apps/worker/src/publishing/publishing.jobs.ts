import type { JobsOptions } from 'bullmq';
import type {
  DispatchablePublication,
  PublishingJobData,
} from './publishing.api';

function positive(raw: string | undefined, fallback: number) {
  const value = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function isValidDispatchGeneration(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

export function publicationJobId(
  publication: Pick<DispatchablePublication, 'id' | 'dispatchGeneration'>,
) {
  return `publication-${publication.id}-dispatch-${publication.dispatchGeneration}`;
}

/** Spec §9: BullMQ only delivers; the database owns domain retries. */
export function buildPublicationJob(
  publication: DispatchablePublication,
  now: number,
  env: NodeJS.ProcessEnv = process.env,
): { name: 'publish'; data: PublishingJobData; opts: JobsOptions } {
  if (!isValidDispatchGeneration(publication.dispatchGeneration)) {
    throw new Error('invalid_dispatch_generation');
  }
  const dueAt = Math.max(
    new Date(publication.scheduledAt).getTime(),
    publication.nextAttemptAt ? new Date(publication.nextAttemptAt).getTime() : 0,
  );
  return {
    name: 'publish',
    data: {
      scheduledPublicationId: publication.id,
      expectedVersion: publication.updatedAt,
      expectedDispatchGeneration: publication.dispatchGeneration,
    },
    opts: {
      jobId: publicationJobId(publication),
      delay: Math.max(0, dueAt - now),
      attempts: positive(
        env.PUBLISH_TRANSPORT_ATTEMPTS ?? env.PUBLISH_MAX_ATTEMPTS,
        5,
      ),
      backoff: {
        type: 'exponential',
        delay: positive(env.PUBLISH_TRANSPORT_BACKOFF_MS, 30_000),
      },
      removeOnComplete: { age: 24 * 60 * 60, count: 5_000 },
      removeOnFail: true,
    },
  };
}
