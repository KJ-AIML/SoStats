import { createHash } from 'node:crypto';
import { Job, Worker } from 'bullmq';
import { createRedisConnection } from '../queue/redis';
import {
  appendKnowledgeChunks,
  claimKnowledge,
  completeKnowledge,
  failKnowledge,
  type KnowledgeJobData,
} from './knowledge.api';
import {
  chunkBatches,
  validateProcessedKnowledge,
} from './knowledge-result';

const connection = createRedisConnection();
const concurrency = Number.parseInt(
  process.env.KNOWLEDGE_CONCURRENCY || '2',
  10,
);
const maxBytes = Number.parseInt(
  process.env.KNOWLEDGE_MAX_UPLOAD_BYTES ||
    String(15 * 1024 * 1024),
  10,
);

function terminalError(message: string) {
  const error = new Error(message);
  Object.assign(error, { terminal: true });
  return error;
}

async function downloadSource(url: string, declaredSize: number) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    const retryable = response.status === 429 || response.status >= 500;
    const error = new Error(
      `Knowledge source download failed with HTTP ${response.status}`,
    );
    if (!retryable) Object.assign(error, { terminal: true });
    throw error;
  }

  const contentLength = Number.parseInt(
    response.headers.get('content-length') || '',
    10,
  );
  if (
    Number.isFinite(contentLength) &&
    (contentLength !== declaredSize || contentLength > maxBytes)
  ) {
    throw terminalError('Downloaded knowledge document size failed validation');
  }

  const body = Buffer.from(await response.arrayBuffer());
  if (body.length !== declaredSize || body.length > maxBytes) {
    throw terminalError('Downloaded knowledge document size failed validation');
  }
  return body;
}

async function processWithAi(source: Buffer, mimeType: string) {
  const baseUrl = (
    process.env.AI_SERVICE_URL || 'http://localhost:8000'
  ).replace(/\/$/, '');
  const response = await fetch(baseUrl + '/v1/knowledge/process', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      media_type: mimeType,
      content_base64: source.toString('base64'),
    }),
    signal: AbortSignal.timeout(90_000),
  });

  if (!response.ok) {
    const detail = (await response.text()).slice(0, 500);
    const error = new Error(
      `Knowledge AI processing returned HTTP ${response.status}: ${detail}`,
    );
    if (
      response.status >= 400 &&
      response.status < 500 &&
      response.status !== 408 &&
      response.status !== 429
    ) {
      Object.assign(error, { terminal: true });
    }
    throw error;
  }

  return validateProcessedKnowledge(await response.json());
}

const knowledgeWorker = new Worker<KnowledgeJobData>(
  'knowledge-processing',
  async (job: Job<KnowledgeJobData>) => {
    const claim = await claimKnowledge(
      job.data.sourceId,
      job.data.processingToken,
    );

    if (claim.status !== 'claimed') {
      console.log(
        `[KnowledgeProcessor] Source ${job.data.sourceId} claim ended with ${claim.status}`,
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
      const contentHash = createHash('sha256').update(source).digest('hex');
      const processed = await processWithAi(source, claim.mimeType);

      for (const batch of chunkBatches(processed.chunks, 8)) {
        const appended = await appendKnowledgeChunks(
          claim.sourceId,
          claim.processingToken,
          claim.versionNumber,
          batch,
        );
        if (appended.status === 'stale') return appended;
      }

      const completed = await completeKnowledge(
        claim.sourceId,
        claim.processingToken,
        {
          versionNumber: claim.versionNumber,
          chunkCount: processed.chunk_count,
          embeddingModel: processed.embedding_model,
          contentHash,
        },
      );

      console.log(
        `[KnowledgeProcessor] Source ${claim.sourceId} completed version ${claim.versionNumber} with ${processed.chunk_count} chunks`,
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
        await failKnowledge(
          claim.sourceId,
          claim.processingToken,
          message,
        );
        return {
          status: 'failed_terminal',
          sourceId: claim.sourceId,
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

knowledgeWorker.on('failed', (job, error) => {
  console.error(
    `[KnowledgeProcessor] Queue job ${job?.id || 'unknown'} failed: ${error.message}`,
  );

  if (!job?.data.processingToken) return;
  const allowedAttempts = Number(job.opts.attempts || 1);
  if (job.attemptsMade < allowedAttempts) return;

  void failKnowledge(
    job.data.sourceId,
    job.data.processingToken,
    error.message,
  ).catch((failError) => {
    console.error(
      '[KnowledgeProcessor] Failed to persist terminal knowledge state:',
      failError instanceof Error ? failError.message : failError,
    );
  });
});

knowledgeWorker.on('error', (error) => {
  console.error('[KnowledgeProcessor] Worker error:', error);
});

export async function stopKnowledgeWorker() {
  await knowledgeWorker.close();
  await connection.quit();
}

console.log(
  `[KnowledgeProcessor] Listening to "knowledge-processing" with concurrency ${Math.max(1, concurrency)}`,
);
