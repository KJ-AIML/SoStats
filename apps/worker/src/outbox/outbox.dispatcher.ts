import { Queue } from 'bullmq';
import { createRedisConnection } from '../queue/redis';
import {
  claimOutbox,
  type OutboxJobData,
} from './outbox.api';

const connection = createRedisConnection();
const outboxQueue = new Queue<OutboxJobData>('outbox', { connection });

const pollMs = Number.parseInt(
  process.env.OUTBOX_DISPATCH_POLL_MS || '5000',
  10,
);
const claimLimit = Number.parseInt(
  process.env.OUTBOX_CLAIM_LIMIT || '100',
  10,
);

let polling = false;
let timer: NodeJS.Timeout | undefined;

async function dispatchOnce() {
  if (polling) return;
  polling = true;

  try {
    const events = await claimOutbox(
      Math.min(Math.max(claimLimit, 1), 500),
    );

    for (const event of events) {
      await outboxQueue.add(
        'execute',
        {
          outboxEventId: event.id,
          leaseToken: event.leaseToken,
        },
        {
          jobId: `outbox-${event.id}-${event.leaseToken}`,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 2_000,
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

    if (events.length) {
      console.log(
        `[OutboxDispatcher] Claimed and queued ${events.length} event(s)`,
      );
    }
  } catch (error) {
    console.error(
      '[OutboxDispatcher] Poll failed:',
      error instanceof Error ? error.message : error,
    );
  } finally {
    polling = false;
  }
}

export function startOutboxDispatcher() {
  void dispatchOnce();
  timer = setInterval(() => {
    void dispatchOnce();
  }, Math.max(2_000, pollMs));

  console.log(
    `[OutboxDispatcher] Polling every ${Math.max(2_000, pollMs)}ms`,
  );
}

export async function stopOutboxDispatcher() {
  if (timer) clearInterval(timer);
  await outboxQueue.close();
  await connection.quit();
}
