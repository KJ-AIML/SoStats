const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

async function startFakeApi() {
  const state = {
    executeMode: 'down',
    executeCalls: 0,
    deadLetterCalls: 0,
    generation: 1,
  };
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/internal/publications/dispatchable')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify([
          {
            id: 42,
            scheduledAt: new Date(Date.now() - 1_000).toISOString(),
            nextAttemptAt: null,
            updatedAt: '2026-09-30T00:00:00.000Z',
            dispatchGeneration: state.generation,
          },
        ]),
      );
      return;
    }
    if (req.url === '/internal/publications/42/execute') {
      state.executeCalls += 1;
      if (state.executeMode === 'down') {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end('{}');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'published', scheduledPublicationId: 42 }));
      return;
    }
    if (req.url === '/internal/publications/42/dead-letter') {
      state.deadLetterCalls += 1;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { state, server, url: `http://127.0.0.1:${server.address().port}` };
}

async function waitFor(predicate, timeoutMs = 15_000) {
  const started = Date.now();
  while (!(await predicate())) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

test('transport exhaustion leaves the domain alone and the generation is re-dispatched', async () => {
  if (!process.env.REDIS_HOST) throw new Error('REDIS_HOST is required for worker integration tests');
  const api = await startFakeApi();
  process.env.SOSTATS_API_URL = api.url;
  process.env.WORKER_API_TOKEN = 'test-token';
  process.env.REDIS_DB = process.env.REDIS_DB || '15';
  process.env.PUBLISH_TRANSPORT_ATTEMPTS = '2';
  process.env.PUBLISH_TRANSPORT_BACKOFF_MS = '50';

  const { createRedisConnection } = require('../dist/queue/redis.js');
  const admin = createRedisConnection();
  await admin.flushdb();

  const dispatcher = require('../dist/publishing/publishing.dispatcher.js');
  const processor = require('../dist/publishing/publishing.processor.js');
  const { Queue } = require('bullmq');
  const queueConnection = createRedisConnection();
  const queue = new Queue('publishing', { connection: queueConnection });

  try {
    await dispatcher.dispatchOnce();
    await waitFor(
      async () =>
        api.state.executeCalls >= 2 &&
        !(await queue.getJob('publication-42-dispatch-1')),
    );
    assert.equal(api.state.deadLetterCalls, 0, 'no domain call on transport exhaustion');

    api.state.executeMode = 'up';
    await dispatcher.dispatchOnce();
    await waitFor(async () => {
      const job = await queue.getJob('publication-42-dispatch-1');
      return Boolean(job) && (await job.getState()) === 'completed';
    });
    assert.equal(api.state.executeCalls, 3);

    await dispatcher.dispatchOnce();
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(api.state.executeCalls, 3, 'same generation is not delivered twice');

    api.state.generation = 2;
    await dispatcher.dispatchOnce();
    await waitFor(async () => api.state.executeCalls === 4);
  } finally {
    await queue.close();
    await queueConnection.quit();
    await processor.stopPublishingWorker();
    await dispatcher.stopPublishingDispatcher();
    await admin.quit();
    api.server.close();
  }
});
