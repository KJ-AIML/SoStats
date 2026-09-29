import { Job, Worker } from 'bullmq';
import { createRedisConnection } from '../queue/redis';
import {
  claimRssTrigger,
  completeRssTrigger,
  failRssTrigger,
  type RssTriggerJobData,
} from './rss-trigger.api';
import { fetchPublicFeed } from './safe-feed-fetch';
import { parseRssOrAtom } from './rss-feed';

const connection = createRedisConnection();
const concurrency = Number.parseInt(
  process.env.RSS_TRIGGER_CONCURRENCY || '3',
  10,
);

const rssWorker = new Worker<RssTriggerJobData>(
  'rss-triggers',
  async (job: Job<RssTriggerJobData>) => {
    const claim = await claimRssTrigger(
      job.data.triggerId,
      job.data.leaseToken,
    );

    if (claim.status !== 'claimed') {
      console.log(
        `[RssTriggerProcessor] Trigger ${job.data.triggerId} claim ended with ${claim.status}`,
      );
      return claim;
    }

    if (job.data.leaseToken !== claim.leaseToken) {
      await job.updateData({
        ...job.data,
        leaseToken: claim.leaseToken,
      });
    }

    try {
      const response = await fetchPublicFeed(claim.feedUrl);
      const feed = parseRssOrAtom(response.body);
      const completed = await completeRssTrigger(
        claim.triggerId,
        claim.leaseToken,
        {
          feedTitle: feed.title,
          entries: feed.entries,
        },
      );

      console.log(
        `[RssTriggerProcessor] Trigger ${claim.triggerId}: ${completed.newEvents || 0} new event(s), ${completed.runCount || 0} run(s)`,
      );
      return completed;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      const terminal = Boolean(
        error &&
        typeof error === 'object' &&
        'terminal' in error &&
        (error as { terminal?: boolean }).terminal,
      );

      if (terminal) {
        await failRssTrigger(
          claim.triggerId,
          claim.leaseToken,
          message,
        );
        return {
          status: 'failed_terminal',
          triggerId: claim.triggerId,
          reason: message,
        };
      }

      throw error;
    }
  },
  {
    connection,
    concurrency: Math.max(1, concurrency),
  },
);

rssWorker.on('failed', (job, error) => {
  console.error(
    `[RssTriggerProcessor] Queue job ${job?.id || 'unknown'} failed: ${error.message}`,
  );

  if (!job?.data.leaseToken) return;
  const allowedAttempts = Number(job.opts.attempts || 1);
  if (job.attemptsMade < allowedAttempts) return;

  void failRssTrigger(
    job.data.triggerId,
    job.data.leaseToken,
    error.message,
  ).catch((failError) => {
    console.error(
      '[RssTriggerProcessor] Failed to persist terminal trigger error:',
      failError instanceof Error ? failError.message : failError,
    );
  });
});

rssWorker.on('error', (error) => {
  console.error('[RssTriggerProcessor] Worker error:', error);
});

export async function stopRssTriggerWorker() {
  await rssWorker.close();
  await connection.quit();
}

console.log(
  `[RssTriggerProcessor] Listening to "rss-triggers" with concurrency ${Math.max(1, concurrency)}`,
);
