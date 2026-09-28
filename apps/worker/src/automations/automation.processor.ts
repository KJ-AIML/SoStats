import { Job, Worker } from 'bullmq';
import { createRedisConnection } from '../queue/redis';
import {
  deadLetterAutomationRun,
  executeAutomationRun,
  type AutomationJobData,
} from './automation.api';

const connection = createRedisConnection();
const concurrency = Number.parseInt(
  process.env.AUTOMATION_CONCURRENCY || '4',
  10,
);

const automationWorker = new Worker<AutomationJobData>(
  'automation-runs',
  async (job: Job<AutomationJobData>) => {
    console.log(
      `[AutomationProcessor] Run ${job.data.runId}, step ${job.data.expectedStepId}, attempt ${job.attemptsMade + 1}`,
    );

    const result = await executeAutomationRun(
      job.data.runId,
      job.data.expectedStepId,
    );

    console.log(
      `[AutomationProcessor] Run ${job.data.runId} finished queue attempt with domain state ${result.status}`,
    );

    return result;
  },
  {
    connection,
    concurrency: Math.max(1, concurrency),
  },
);

automationWorker.on('failed', (job, error) => {
  console.error(
    `[AutomationProcessor] Queue job ${job?.id || 'unknown'} failed: ${error.message}`,
  );

  if (!job) return;
  const allowedAttempts = Number(job.opts.attempts || 1);
  if (job.attemptsMade < allowedAttempts) return;

  void deadLetterAutomationRun(job.data.runId, error.message).catch(
    (deadLetterError) => {
      console.error(
        '[AutomationProcessor] Failed to persist dead-letter state:',
        deadLetterError instanceof Error
          ? deadLetterError.message
          : deadLetterError,
      );
    },
  );
});

automationWorker.on('error', (error) => {
  console.error('[AutomationProcessor] Worker error:', error);
});

export async function stopAutomationWorker() {
  await automationWorker.close();
  await connection.quit();
}

console.log(
  `[AutomationProcessor] Listening to "automation-runs" with concurrency ${Math.max(1, concurrency)}`,
);
