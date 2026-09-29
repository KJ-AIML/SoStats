import { Job, Worker } from 'bullmq';
import { createRedisConnection } from '../queue/redis';
import {
  executeOutbox,
  type OutboxJobData,
} from './outbox.api';

const connection = createRedisConnection();
const concurrency = Number.parseInt(
  process.env.OUTBOX_CONCURRENCY || '10',
  10,
);

const outboxWorker = new Worker<OutboxJobData>(
  'outbox',
  async (job: Job<OutboxJobData>) => {
    const result = await executeOutbox(
      job.data.outboxEventId,
      job.data.leaseToken,
    );

    if (result.status === 'dead') {
      console.error(
        `[OutboxProcessor] Event ${job.data.outboxEventId} is dead after ${result.attempts || 'max'} attempt(s): ${result.error || 'unknown error'}`,
      );
    } else if (result.status === 'retry_scheduled') {
      console.warn(
        `[OutboxProcessor] Event ${job.data.outboxEventId} scheduled for retry after attempt ${result.attempts || 'unknown'}`,
      );
    } else {
      console.log(
        `[OutboxProcessor] Event ${job.data.outboxEventId} finished with status ${result.status}`,
      );
    }

    return result;
  },
  {
    connection,
    concurrency: Math.max(1, concurrency),
  },
);

outboxWorker.on('failed', (job, error) => {
  console.error(
    `[OutboxProcessor] Transport job ${job?.id || 'unknown'} failed: ${error.message}`,
  );
});

outboxWorker.on('error', (error) => {
  console.error('[OutboxProcessor] Worker error:', error);
});

export async function stopOutboxWorker() {
  await outboxWorker.close();
  await connection.quit();
}

console.log(
  `[OutboxProcessor] Listening to "outbox" with concurrency ${Math.max(1, concurrency)}`,
);
