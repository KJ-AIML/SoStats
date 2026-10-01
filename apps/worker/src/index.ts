import {
  startOutboxDispatcher,
  stopOutboxDispatcher,
} from './outbox/outbox.dispatcher';
import { stopOutboxWorker } from './outbox/outbox.processor';
import {
  startKnowledgeDispatcher,
  stopKnowledgeDispatcher,
} from './knowledge/knowledge.dispatcher';
import {
  stopKnowledgeWorker,
} from './knowledge/knowledge.processor';
import {
  startRssTriggerDispatcher,
  stopRssTriggerDispatcher,
} from './triggers/rss-trigger.dispatcher';
import {
  stopRssTriggerWorker,
} from './triggers/rss-trigger.processor';
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
  startReconciliationDispatcher,
  stopReconciliationDispatcher,
} from './publishing/reconciliation.dispatcher';
import {
  startAutomationDispatcher,
  stopAutomationDispatcher,
} from './automations/automation.dispatcher';
import {
  stopAutomationWorker,
} from './automations/automation.processor';

startOutboxDispatcher();
startPublishingDispatcher();
startReconciliationDispatcher();
startAutomationDispatcher();
startAnalyticsDispatcher();
startMediaDispatcher();
startRssTriggerDispatcher();
startKnowledgeDispatcher();

let stopping = false;

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;

  console.log(`[Worker] Received ${signal}; draining background runtimes`);
  await Promise.all([
    stopOutboxDispatcher(),
    stopOutboxWorker(),
    stopPublishingDispatcher(),
    stopPublishingWorker(),
    stopReconciliationDispatcher(),
    stopAutomationDispatcher(),
    stopAutomationWorker(),
    stopAnalyticsDispatcher(),
    stopAnalyticsWorker(),
    stopMediaDispatcher(),
    stopMediaWorker(),
    stopRssTriggerDispatcher(),
    stopRssTriggerWorker(),
    stopKnowledgeDispatcher(),
    stopKnowledgeWorker(),
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
