import { Job, Worker } from 'bullmq';
import { createRedisConnection } from '../queue/redis';
import {
  deadLetterPublication,
  executePublication,
  type PublishingJobData,
} from './publishing.api';

const connection = createRedisConnection();
const concurrency = Number.parseInt(
  process.env.PUBLISH_CONCURRENCY || '5',
  10,
);

const publishingWorker = new Worker<PublishingJobData>(
  'publishing',
  async (job: Job<PublishingJobData>) => {
    const { scheduledPublicationId, expectedVersion } = job.data;

    console.log(
      `[PublishingProcessor] Executing schedule ${scheduledPublicationId}; attempt ${job.attemptsMade + 1}`,
    );

    const result = await executePublication(
      scheduledPublicationId,
      expectedVersion,
    );

    if (result.status === 'failed_terminal') {
      console.error(
        `[PublishingProcessor] Schedule ${scheduledPublicationId} failed terminally: ${result.reason || 'provider rejected publication'}`,
      );
    } else {
      console.log(
        `[PublishingProcessor] Schedule ${scheduledPublicationId} finished with domain status ${result.status}`,
      );
    }

    return result;
  },
  {
    connection,
    concurrency: Math.max(1, concurrency),
  },
);

publishingWorker.on('completed', (job, result) => {
  console.log(
    `[PublishingProcessor] Queue job ${job.id} completed (${String(result?.status || 'ok')})`,
  );
});

publishingWorker.on('failed', (job, error) => {
  console.error(
    `[PublishingProcessor] Queue job ${job?.id || 'unknown'} failed: ${error.message}`,
  );

  if (!job) return;

  const allowedAttempts = Number(job.opts.attempts || 1);
  if (job.attemptsMade < allowedAttempts) return;

  void deadLetterPublication(
    job.data.scheduledPublicationId,
    job.data.expectedVersion,
    error.message,
  ).catch((deadLetterError) => {
    console.error(
      '[PublishingProcessor] Failed to persist dead-letter state:',
      deadLetterError instanceof Error
        ? deadLetterError.message
        : deadLetterError,
    );
  });
});

publishingWorker.on('error', (error) => {
  console.error('[PublishingProcessor] Worker error:', error);
});

console.log(
  `[PublishingProcessor] Listening to "publishing" with concurrency ${Math.max(1, concurrency)}`,
);
