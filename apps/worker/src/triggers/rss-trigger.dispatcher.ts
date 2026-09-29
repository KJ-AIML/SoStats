import { Queue } from 'bullmq';
import { createRedisConnection } from '../queue/redis';
import {
  getDispatchableRssTriggers,
  type RssTriggerJobData,
} from './rss-trigger.api';

const connection = createRedisConnection();
const rssQueue = new Queue<RssTriggerJobData>('rss-triggers', {
  connection,
});

const pollMs = Number.parseInt(
  process.env.RSS_TRIGGER_DISPATCH_POLL_MS || '15000',
  10,
);
const maxAttempts = Number.parseInt(
  process.env.RSS_TRIGGER_MAX_ATTEMPTS || '4',
  10,
);

let polling = false;
let timer: NodeJS.Timeout | undefined;

async function dispatchOnce() {
  if (polling) return;
  polling = true;
  try {
    const triggers = await getDispatchableRssTriggers(500);
    for (const trigger of triggers) {
      await rssQueue.add(
        'poll',
        {
          triggerId: trigger.triggerId,
          revision: trigger.revision,
        },
        {
          jobId: `rss-trigger-${trigger.triggerId}-${trigger.revision}`,
          attempts: Math.max(1, maxAttempts),
          backoff: { type: 'exponential', delay: 15_000 },
          removeOnComplete: { age: 24 * 60 * 60, count: 5_000 },
          removeOnFail: { age: 7 * 24 * 60 * 60, count: 5_000 },
        },
      );
    }

    if (triggers.length) {
      console.log(
        `[RssTriggerDispatcher] Ensured ${triggers.length} RSS poll job(s) are queued`,
      );
    }
  } catch (error) {
    console.error(
      '[RssTriggerDispatcher] Poll failed:',
      error instanceof Error ? error.message : error,
    );
  } finally {
    polling = false;
  }
}

export function startRssTriggerDispatcher() {
  void dispatchOnce();
  timer = setInterval(() => {
    void dispatchOnce();
  }, Math.max(5_000, pollMs));
}

export async function stopRssTriggerDispatcher() {
  if (timer) clearInterval(timer);
  await rssQueue.close();
  await connection.quit();
}
