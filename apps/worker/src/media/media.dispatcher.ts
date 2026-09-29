import { Queue } from 'bullmq';
import { createRedisConnection } from '../queue/redis';
import {
  getDispatchableMedia,
  type MediaJobData,
} from './media.api';

const connection = createRedisConnection();
const mediaQueue = new Queue<MediaJobData>('media-processing', {
  connection,
});

const pollMs = Number.parseInt(
  process.env.MEDIA_DISPATCH_POLL_MS || '5000',
  10,
);
const maxAttempts = Number.parseInt(
  process.env.MEDIA_MAX_ATTEMPTS || '4',
  10,
);

let polling = false;
let timer: NodeJS.Timeout | undefined;

async function dispatchOnce() {
  if (polling) return;
  polling = true;

  try {
    const assets = await getDispatchableMedia(500);
    for (const asset of assets) {
      await mediaQueue.add(
        'process',
        {
          assetId: asset.assetId,
          revision: asset.revision,
        },
        {
          jobId: `media-${asset.assetId}-${asset.revision}`,
          attempts: Math.max(1, maxAttempts),
          backoff: {
            type: 'exponential',
            delay: 15_000,
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

    if (assets.length) {
      console.log(
        `[MediaDispatcher] Ensured ${assets.length} asset job(s) are queued`,
      );
    }
  } catch (error) {
    console.error(
      '[MediaDispatcher] Poll failed:',
      error instanceof Error ? error.message : error,
    );
  } finally {
    polling = false;
  }
}

export function startMediaDispatcher() {
  void dispatchOnce();
  timer = setInterval(() => {
    void dispatchOnce();
  }, Math.max(2_000, pollMs));

  console.log(
    `[MediaDispatcher] Polling every ${Math.max(2_000, pollMs)}ms`,
  );
}

export async function stopMediaDispatcher() {
  if (timer) clearInterval(timer);
  await mediaQueue.close();
  await connection.quit();
}
