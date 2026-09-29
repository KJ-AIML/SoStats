import { Queue } from 'bullmq';
import { createRedisConnection } from '../queue/redis';
import {
  getDispatchableKnowledge,
  type KnowledgeJobData,
} from './knowledge.api';

const connection = createRedisConnection();
const knowledgeQueue = new Queue<KnowledgeJobData>('knowledge-processing', {
  connection,
});

const pollMs = Number.parseInt(
  process.env.KNOWLEDGE_DISPATCH_POLL_MS || '5000',
  10,
);
const maxAttempts = Number.parseInt(
  process.env.KNOWLEDGE_MAX_ATTEMPTS || '4',
  10,
);

let polling = false;
let timer: NodeJS.Timeout | undefined;

async function dispatchOnce() {
  if (polling) return;
  polling = true;

  try {
    const sources = await getDispatchableKnowledge(500);
    for (const source of sources) {
      await knowledgeQueue.add(
        'process',
        {
          sourceId: source.sourceId,
          revision: source.revision,
        },
        {
          jobId: `knowledge-${source.sourceId}-${source.revision}`,
          attempts: Math.max(1, maxAttempts),
          backoff: { type: 'exponential', delay: 15_000 },
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

    if (sources.length) {
      console.log(
        `[KnowledgeDispatcher] Ensured ${sources.length} source job(s) are queued`,
      );
    }
  } catch (error) {
    console.error(
      '[KnowledgeDispatcher] Poll failed:',
      error instanceof Error ? error.message : error,
    );
  } finally {
    polling = false;
  }
}

export function startKnowledgeDispatcher() {
  void dispatchOnce();
  timer = setInterval(() => {
    void dispatchOnce();
  }, Math.max(2_000, pollMs));

  console.log(
    `[KnowledgeDispatcher] Polling every ${Math.max(2_000, pollMs)}ms`,
  );
}

export async function stopKnowledgeDispatcher() {
  if (timer) clearInterval(timer);
  await knowledgeQueue.close();
  await connection.quit();
}
