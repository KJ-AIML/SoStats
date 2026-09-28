import './media/media.processor';
import './analytics/analytics.processor';
import {
  startPublishingDispatcher,
  stopPublishingDispatcher,
} from './publishing/publishing.dispatcher';
import {
  stopPublishingWorker,
} from './publishing/publishing.processor';

startPublishingDispatcher();

let stopping = false;

async function shutdown(signal: string) {
  if (stopping) return;
  stopping = true;

  console.log(`[Worker] Received ${signal}; draining publishing runtime`);
  await Promise.all([
    stopPublishingDispatcher(),
    stopPublishingWorker(),
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
