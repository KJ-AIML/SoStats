import { Queue } from 'bullmq';
import { createRedisConnection } from '../queue/redis';
import {
  getDispatchableAnalytics,
  type AnalyticsJobData,
} from './analytics.api';

const connection = createRedisConnection();
const analyticsQueue = new Queue<AnalyticsJobData>('analytics', {
  connection,
});

const pollMs = Number.parseInt(
  process.env.ANALYTICS_DISPATCH_POLL_MS || '60000',
  10,
);
const maxAttempts = Number.parseInt(
  process.env.ANALYTICS_MAX_ATTEMPTS || '4',
  10,
);

let polling = false;
let timer: NodeJS.Timeout | undefined;

async function dispatchOnce() {
  if (polling) return;
  polling = true;

  try {
    const rows = await getDispatchableAnalytics(500);

    for (const row of rows) {
      await analyticsQueue.add(
        'sync-post-metrics',
        {
          publicationResultId: row.publicationResultId,
          expectedSnapshotAt: row.expectedSnapshotAt,
        },
        {
          jobId: `analytics-${row.publicationResultId}-${row.revision}`,
          attempts: Math.max(1, maxAttempts),
          backoff: {
            type: 'exponential',
            delay: 30_000,
          },
          removeOnComplete: {
            age: 24 * 60 * 60,
            count: 10_000,
          },
          removeOnFail: {
            age: 7 * 24 * 60 * 60,
            count: 10_000,
          },
        },
      );
    }

    if (rows.length) {
      console.log(
        `[AnalyticsDispatcher] Ensured ${rows.length} metric sync job(s) are queued`,
      );
    }
  } catch (error) {
    console.error(
      '[AnalyticsDispatcher] Poll failed:',
      error instanceof Error ? error.message : error,
    );
  } finally {
    polling = false;
  }
}

export function startAnalyticsDispatcher() {
  void dispatchOnce();
  timer = setInterval(() => {
    void dispatchOnce();
  }, Math.max(10_000, pollMs));

  console.log(
    `[AnalyticsDispatcher] Polling every ${Math.max(10_000, pollMs)}ms`,
  );
}

export async function stopAnalyticsDispatcher() {
  if (timer) clearInterval(timer);
  await analyticsQueue.close();
  await connection.quit();
}
