import './media/media.processor';
import './publishing/publishing.processor';
import './analytics/analytics.processor';
import {
  startPublishingDispatcher,
  stopPublishingDispatcher,
} from './publishing/publishing.dispatcher';

startPublishingDispatcher();

async function shutdown(signal: string) {
  console.log(`[Worker] Received ${signal}; shutting down dispatcher`);
  await stopPublishingDispatcher();
  process.exit(0);
}

process.once('SIGINT', () => {
  void shutdown('SIGINT');
});
process.once('SIGTERM', () => {
  void shutdown('SIGTERM');
});

console.log('Worker application started.');
