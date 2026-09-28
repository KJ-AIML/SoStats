import { Queue } from 'bullmq';
import { createRedisConnection } from '../queue/redis';
import {
  getDispatchableAutomationRuns,
  type AutomationJobData,
} from './automation.api';

const connection = createRedisConnection();
const automationQueue = new Queue<AutomationJobData>('automation-runs', {
  connection,
});

const pollMs = Number.parseInt(
  process.env.AUTOMATION_DISPATCH_POLL_MS || '5000',
  10,
);
const maxAttempts = Number.parseInt(
  process.env.AUTOMATION_MAX_ATTEMPTS || '5',
  10,
);

let polling = false;
let timer: NodeJS.Timeout | undefined;

async function dispatchOnce() {
  if (polling) return;
  polling = true;

  try {
    const pageSize = 250;
    const runs = [];

    for (let offset = 0; offset < 5_000; offset += pageSize) {
      const page = await getDispatchableAutomationRuns(offset, pageSize);
      runs.push(...page);
      if (page.length < pageSize) break;
    }

    for (const run of runs) {
      await automationQueue.add(
        'execute',
        {
          runId: run.id,
          expectedStepId: run.resumeToken,
        },
        {
          jobId: `automation-run-${run.id}-${run.resumeToken}`,
          attempts: Math.max(1, maxAttempts),
          backoff: {
            type: 'exponential',
            delay: 15_000,
          },
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

    if (runs.length) {
      console.log(
        `[AutomationDispatcher] Ensured ${runs.length} automation run(s) are queued`,
      );
    }
  } catch (error) {
    console.error(
      '[AutomationDispatcher] Poll failed:',
      error instanceof Error ? error.message : error,
    );
  } finally {
    polling = false;
  }
}

export function startAutomationDispatcher() {
  void dispatchOnce();
  timer = setInterval(() => {
    void dispatchOnce();
  }, Math.max(2_000, pollMs));

  console.log(
    `[AutomationDispatcher] Polling every ${Math.max(2_000, pollMs)}ms`,
  );
}

export async function stopAutomationDispatcher() {
  if (timer) clearInterval(timer);
  await automationQueue.close();
  await connection.quit();
}
