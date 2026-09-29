import {
  startMediaDispatcher,
  stopMediaDispatcher,
} from './media/media.dispatcher';
import {
  stopMediaWorker,
} from './media/media.processor';
import {
  startAnalyticsDispatcher,
  stopAnalyticsDispatcher,
} from './analytics/analytics.dispatcher';
import {
  stopAnalyticsWorker,
} from './analytics/analytics.processor';
import {
  startPublishingDispatcher,
  stopPublishingDispatcher,
} from './publishing/publishing.dispatcher';
import {
  stopPublishingWorker,
} from './publishing/publishing.processor';
import {
  startAutomationDispatcher,
  stopAutomationDispatcher,
} from './automations/automation.dispatcher';
import {
  stopAutomationWorker,
} from './automations/automation.processor';

startPublishingDispatcher();
startAutomationDispatcher();
startAnalyticsDispatcher();
startMediaDispatcher();

let stopping = false;

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;

  console.log(`[Worker] Received ${signal}; draining background runtimes`);
  await Promise.all([
    stopPublishingDispatcher(),
    stopPublishingWorker(),
    stopAutomationDispatcher(),
    stopAutomationWorker(),
    stopAnalyticsDispatcher(),
    stopAnalyticsWorker(),
    stopMediaDispatcher(),
    stopMediaWorker(),
  ]);
  process.exit(0);
}

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});
process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});

console.log('Worker application started.');
