import { Queue } from 'bullmq';
import { createRedisConnection } from '../queue/redis';
import {
  getDispatchablePublications,
  type PublishingJobData,
} from './publishing.api';

const connection = createRedisConnection();
const publishingQueue = new Queue<PublishingJobData>('publishing', {
  connection,
});

const pollMs = Number.parseInt(
  process.env.PUBLISH_DISPATCH_POLL_MS || '15000',
  10,
);
const horizonMs = Number.parseInt(
  process.env.PUBLISH_DISPATCH_HORIZON_MS || '120000',
  10,
);
const maxAttempts = Number.parseInt(
  process.env.PUBLISH_MAX_ATTEMPTS || '5',
  10,
);

let polling = false;
let timer: NodeJS.Timeout | undefined;

async function dispatchOnce() {
  if (polling) return;
  polling = true;

  try {
    const horizon = new Date(Date.now() + horizonMs).toISOString();
    const pageSize = 250;
    const publications = [];

    for (let offset = 0; offset < 5_000; offset += pageSize) {
      const page = await getDispatchablePublications(
        horizon,
        offset,
        pageSize,
      );
      publications.push(...page);
      if (page.length < pageSize) break;
    }

    for (const publication of publications) {
      const scheduledAt = new Date(publication.scheduledAt).getTime();
      const version = new Date(publication.updatedAt).getTime();
      const delay = Math.max(0, scheduledAt - Date.now());

      await publishingQueue.add(
        'publish',
        {
          scheduledPublicationId: publication.id,
          expectedVersion: publication.updatedAt,
        },
        {
          jobId: `publication-${publication.id}-${version}`,
          delay,
          attempts: Math.max(1, maxAttempts),
          backoff: {
            type: 'exponential',
            delay: 30_000,
          },
          removeOnComplete: {
            age: 24 * 60 * 60,
            count: 5_000,
          },
          removeOnFail: {
            age: 7 * 24 * 60 * 60,
            count: 5_000,
          },
        },
      );
    }

    if (publications.length) {
      console.log(
        `[PublishingDispatcher] Ensured ${publications.length} publication job(s) are queued`,
      );
    }
  } catch (error) {
    console.error(
      '[PublishingDispatcher] Dispatch poll failed:',
      error instanceof Error ? error.message : error,
    );
  } finally {
    polling = false;
  }
}

export function startPublishingDispatcher() {
  void dispatchOnce();
  timer = setInterval(() => {
    void dispatchOnce();
  }, Math.max(5_000, pollMs));

  console.log(
    `[PublishingDispatcher] Polling every ${Math.max(5_000, pollMs)}ms with a ${horizonMs}ms scheduling horizon`,
  );
}

export async function stopPublishingDispatcher() {
  if (timer) clearInterval(timer);
  await publishingQueue.close();
  await connection.quit();
}
