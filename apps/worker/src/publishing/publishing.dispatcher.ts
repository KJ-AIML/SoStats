import { Queue } from 'bullmq';
import { createRedisConnection } from '../queue/redis';
import {
  getDispatchablePublications,
  type PublishingJobData,
} from './publishing.api';
import { buildPublicationJob } from './publishing.jobs';

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
let polling = false;
let timer: NodeJS.Timeout | undefined;

export async function dispatchOnce() {
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
      const job = buildPublicationJob(publication, Date.now());
      await publishingQueue.add(job.name, job.data, job.opts);
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
