import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';

// Establish Redis connection
const connection = new IORedis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  maxRetriesPerRequest: null,
});

interface PublishingJobData {
  postId: string;
  provider: string;
  content: string;
  idempotencyKey: string;
}

// Emulate a Set for idempotency key tracking (in memory for mock purposes)
const processedKeys = new Set<string>();

const publishingWorker = new Worker<PublishingJobData>(
  'publishing',
  async (job: Job<PublishingJobData>) => {
    console.log(`[PublishingProcessor] Started processing job ${job.id} for post ${job.data.postId}`);

    const { provider, content, idempotencyKey } = job.data;

    // Idempotency check
    if (processedKeys.has(idempotencyKey)) {
      console.log(`[PublishingProcessor] Job ${job.id} skipped. Idempotency key ${idempotencyKey} already processed.`);
      return { success: true, message: 'Already processed', skipped: true };
    }

    // Delay emulation
    console.log(`[PublishingProcessor] Emulating processing delay...`);
    await new Promise(resolve => setTimeout(resolve, 1500));

    // Provider rate limit simulation (e.g. 10% chance to fail with rate limit error)
    if (Math.random() < 0.1) {
      console.log(`[PublishingProcessor] Rate limit hit for provider ${provider}!`);
      throw new Error(`Rate limit exceeded for provider: ${provider}`);
    }

    // Success simulation
    processedKeys.add(idempotencyKey);
    console.log(`[PublishingProcessor] Successfully published to ${provider}: ${content.substring(0, 20)}...`);
    
    // Mock writing publication_result
    console.log(`[PublishingProcessor] Mock writing publication_result to DB for post ${job.data.postId}`);

    return { success: true, message: 'Publishing complete', url: `https://${provider}.com/post/${job.data.postId}` };
  },
  {
    connection,
  }
);

publishingWorker.on('completed', (job) => {
  console.log(`[PublishingProcessor] Job ${job.id} has completed!`);
});

publishingWorker.on('failed', (job, err) => {
  console.log(`[PublishingProcessor] Job ${job?.id} has failed with ${err.message}`);
  // Mock sending to a dead-letter queue
  console.log(`[PublishingProcessor] Sending job ${job?.id} to dead-letter queue (mock)...`);
});

console.log('[PublishingProcessor] Worker is running and listening to "publishing" queue...');
