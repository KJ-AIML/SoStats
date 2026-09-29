import { Job, Worker } from 'bullmq';
import { createRedisConnection } from '../queue/redis';
import {
  claimMedia,
  completeMedia,
  failMedia,
  type MediaJobData,
} from './media.api';
import { extractMediaMetadata } from './media-metadata';

const connection = createRedisConnection();
const concurrency = Number.parseInt(
  process.env.MEDIA_CONCURRENCY || '3',
  10,
);
const maxBufferBytes = Number.parseInt(
  process.env.MEDIA_MAX_UPLOAD_BYTES || String(100 * 1024 * 1024),
  10,
);

async function downloadSource(url: string, declaredSize: number) {
  const response = await fetch(url);
  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500;
    const error = new Error(
      `Media source download failed with HTTP ${response.status}`,
    );
    if (!retryable) {
      Object.assign(error, { terminal: true });
    }
    throw error;
  }

  const contentLength = Number.parseInt(
    response.headers.get('content-length') || '',
    10,
  );
  if (
    Number.isFinite(contentLength) &&
    (contentLength > maxBufferBytes || contentLength !== declaredSize)
  ) {
    const error = new Error('Downloaded object size failed validation');
    Object.assign(error, { terminal: true });
    throw error;
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  if (
    buffer.length !== declaredSize ||
    buffer.length > maxBufferBytes
  ) {
    const error = new Error('Downloaded object size failed validation');
    Object.assign(error, { terminal: true });
    throw error;
  }

  return buffer;
}

const mediaWorker = new Worker<MediaJobData>(
  'media-processing',
  async (job: Job<MediaJobData>) => {
    const claim = await claimMedia(
      job.data.assetId,
      job.data.processingToken,
    );

    if (claim.status !== 'claimed') {
      console.log(
        `[MediaProcessor] Asset ${job.data.assetId} finished claim with ${claim.status}`,
      );
      return claim;
    }

    if (job.data.processingToken !== claim.processingToken) {
      await job.updateData({
        ...job.data,
        processingToken: claim.processingToken,
      });
    }

    try {
      const source = await downloadSource(
        claim.sourceUrl,
        claim.declaredSize,
      );
      const metadata = extractMediaMetadata(source, claim.mimeType);
      const completed = await completeMedia(
        claim.assetId,
        claim.processingToken,
        metadata,
      );

      console.log(
        `[MediaProcessor] Asset ${claim.assetId} completed with state ${completed.status}`,
      );
      return completed;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : String(error);
      const terminal =
        Boolean(
          error &&
          typeof error === 'object' &&
          'terminal' in error &&
          (error as { terminal?: boolean }).terminal,
        ) ||
        /Invalid|Unsupported|dimensions|metadata|header|signature|size failed/.test(
          message,
        );

      if (terminal) {
        await failMedia(
          claim.assetId,
          claim.processingToken,
          message,
        );
        return {
          status: 'failed_terminal',
          assetId: claim.assetId,
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

mediaWorker.on('failed', (job, error) => {
  console.error(
    `[MediaProcessor] Queue job ${job?.id || 'unknown'} failed: ${error.message}`,
  );

  if (!job?.data.processingToken) return;
  const allowedAttempts = Number(job.opts.attempts || 1);
  if (job.attemptsMade < allowedAttempts) return;

  void failMedia(
    job.data.assetId,
    job.data.processingToken,
    error.message,
  ).catch((failError) => {
    console.error(
      '[MediaProcessor] Failed to persist terminal media state:',
      failError instanceof Error ? failError.message : failError,
    );
  });
});

mediaWorker.on('error', (error) => {
  console.error('[MediaProcessor] Worker error:', error);
});

export async function stopMediaWorker() {
  await mediaWorker.close();
  await connection.quit();
}

console.log(
  `[MediaProcessor] Listening to "media-processing" with concurrency ${Math.max(1, concurrency)}`,
);
