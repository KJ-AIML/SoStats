import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';

// Establish Redis connection
const connection = new IORedis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  maxRetriesPerRequest: null,
});

interface AnalyticsJobData {
  contentItemId: number;
  socialAccountId: number;
  platformPostId: string;
  provider: string;
}

const analyticsWorker = new Worker<AnalyticsJobData>(
  'analytics',
  async (job: Job<AnalyticsJobData>) => {
    console.log(`[AnalyticsProcessor] Started processing job ${job.id} for content item ${job.data.contentItemId}`);

    const { provider, platformPostId } = job.data;

    // Delay emulation to simulate fetching metrics from an external API
    console.log(`[AnalyticsProcessor] Fetching metrics from ${provider} API for post ${platformPostId}...`);
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Simulate API errors
    if (Math.random() < 0.05) {
      console.log(`[AnalyticsProcessor] API error for provider ${provider}!`);
      throw new Error(`API fetch failed for provider: ${provider}`);
    }

    // Mock fetched metrics
    const metrics = {
      likes: Math.floor(Math.random() * 1000),
      shares: Math.floor(Math.random() * 200),
      comments: Math.floor(Math.random() * 50),
      views: Math.floor(Math.random() * 10000),
    };

    console.log(`[AnalyticsProcessor] Successfully fetched metrics from ${provider}:`, metrics);
    
    // Simulate inserting metric snapshot and updating daily analytics in DB
    console.log(`[AnalyticsProcessor] Mock writing metric_snapshot to DB for contentItem ${job.data.contentItemId}`);
    console.log(`[AnalyticsProcessor] Mock updating analytics_daily in DB`);

    return { success: true, metrics };
  },
  {
    connection,
  }
);

analyticsWorker.on('completed', (job) => {
  console.log(`[AnalyticsProcessor] Job ${job.id} has completed!`);
});

analyticsWorker.on('failed', (job, err) => {
  console.log(`[AnalyticsProcessor] Job ${job?.id} has failed with ${err.message}`);
});

console.log('[AnalyticsProcessor] Worker is running and listening to "analytics" queue...');
