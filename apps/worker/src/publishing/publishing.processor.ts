import { Job, Worker } from 'bullmq';
import { createRedisConnection } from '../queue/redis';
import {
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
    const { scheduledPublicationId, expectedDispatchGeneration } = job.data;

    console.log(
      `[PublishingProcessor] Executing schedule ${scheduledPublicationId} generation ${expectedDispatchGeneration}; transport attempt ${job.attemptsMade + 1}`,
    );

    const result = await executePublication(job.data, job.id);

    // Log the domain status only; the API's failure detail can carry provider text.
    console.log(
      JSON.stringify({
        event: 'publication.domain_result',
        status: result.status,
        publication_id: scheduledPublicationId,
        dispatch_generation: expectedDispatchGeneration,
        queue_job_id: job.id,
      }),
    );

    // Return only non-sensitive fields so provider text is not stored in Redis.
    return { status: result.status, scheduledPublicationId };
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
  if (job.attemptsMade < Number(job.opts.attempts || 1)) return;

  // Spec I8: transport exhaustion never changes publication state. removeOnFail
  // lets the next dispatch poll re-enqueue this generation once the API is back.
  console.error(
    JSON.stringify({
      event: 'publication.transport_exhausted',
      publication_id: job.data.scheduledPublicationId,
      dispatch_generation: job.data.expectedDispatchGeneration,
      queue_job_id: job.id,
    }),
  );
});

publishingWorker.on('error', (error) => {
  console.error('[PublishingProcessor] Worker error:', error);
});

export async function stopPublishingWorker() {
  await publishingWorker.close();
  await connection.quit();
}

console.log(
  `[PublishingProcessor] Listening to "publishing" with concurrency ${Math.max(1, concurrency)}`,
);
