import { Job, Worker } from 'bullmq';
import { createRedisConnection } from '../queue/redis';
import {
  ingestPublicationAnalytics,
  type AnalyticsJobData,
} from './analytics.api';

const connection = createRedisConnection();
const concurrency = Number.parseInt(
  process.env.ANALYTICS_CONCURRENCY || '4',
  10,
);

const analyticsWorker = new Worker<AnalyticsJobData>(
  'analytics',
  async (job: Job<AnalyticsJobData>) => {
    const result = await ingestPublicationAnalytics(
      job.data.publicationResultId,
      job.data.expectedSnapshotAt,
    );

    if (result.status === 'ingested') {
      console.log(
        `[AnalyticsProcessor] Synced publication result ${job.data.publicationResultId} into snapshot ${result.snapshotId}`,
      );
    } else if (result.status === 'failed_terminal') {
      console.error(
        `[AnalyticsProcessor] Metric sync stopped for publication result ${job.data.publicationResultId}: ${result.reason || 'terminal provider error'}`,
      );
    } else {
      console.log(
        `[AnalyticsProcessor] Publication result ${job.data.publicationResultId} finished with domain state ${result.status}`,
      );
    }

    return result;
  },
  {
    connection,
    concurrency: Math.max(1, concurrency),
  },
);

analyticsWorker.on('failed', (job, error) => {
  console.error(
    `[AnalyticsProcessor] Queue job ${job?.id || 'unknown'} failed: ${error.message}`,
  );
});

analyticsWorker.on('error', (error) => {
  console.error('[AnalyticsProcessor] Worker error:', error);
});

export async function stopAnalyticsWorker() {
  await analyticsWorker.close();
  await connection.quit();
}

console.log(
  `[AnalyticsProcessor] Listening to "analytics" with concurrency ${Math.max(1, concurrency)}`,
);
