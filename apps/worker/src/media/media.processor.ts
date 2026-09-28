import { Worker, Job } from 'bullmq';
import IORedis from 'ioredis';

// Establish Redis connection
const connection = new IORedis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379', 10),
  maxRetriesPerRequest: null,
});

// Define the job payload interface
interface MediaJobData {
  mediaId: string;
  type: 'image' | 'video';
  url: string;
}

const mediaWorker = new Worker<MediaJobData>(
  'media-processing',
  async (job: Job<MediaJobData>) => {
    console.log(`[MediaProcessor] Started processing job ${job.id} for media ${job.data.mediaId}`);

    const { type, url } = job.data;

    if (type === 'image') {
      console.log(`[MediaProcessor] Extracting image dimensions for ${url}...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log(`[MediaProcessor] Image dimensions: 1920x1080`);

      console.log(`[MediaProcessor] Generating image thumbnail...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      console.log(`[MediaProcessor] Thumbnail generated.`);
    } else if (type === 'video') {
      console.log(`[MediaProcessor] Extracting video duration for ${url}...`);
      await new Promise(resolve => setTimeout(resolve, 1500));
      console.log(`[MediaProcessor] Video duration: 120 seconds`);

      console.log(`[MediaProcessor] Generating video thumbnail...`);
      await new Promise(resolve => setTimeout(resolve, 2000));
      console.log(`[MediaProcessor] Thumbnail generated.`);
    } else {
      console.log(`[MediaProcessor] Unknown media type: ${type}`);
    }

    console.log(`[MediaProcessor] Completed processing job ${job.id}`);
    
    return { success: true, message: 'Processing complete' };
  },
  {
    connection,
  }
);

mediaWorker.on('completed', (job) => {
  console.log(`[MediaProcessor] Job ${job.id} has completed!`);
});

mediaWorker.on('failed', (job, err) => {
  console.log(`[MediaProcessor] Job ${job?.id} has failed with ${err.message}`);
});

console.log('[MediaProcessor] Worker is running and listening to "media-processing" queue...');
