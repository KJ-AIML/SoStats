const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { executePublication } = require('../dist/publishing/publishing.api.js');

// Spec I7 / §9: the worker's execute call has its own deadline
// (PUBLISH_EXECUTE_TIMEOUT_MS), so a stalled API execution is a transport failure.
test('execute rejects as a transport failure once the API holds the response past PUBLISH_EXECUTE_TIMEOUT_MS', async (t) => {
  const held = [];
  const server = http.createServer((req, res) => {
    held.push(res); // never answered: the API execution is still "running"
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  const saved = {
    SOSTATS_API_URL: process.env.SOSTATS_API_URL,
    WORKER_API_TOKEN: process.env.WORKER_API_TOKEN,
    PUBLISH_EXECUTE_TIMEOUT_MS: process.env.PUBLISH_EXECUTE_TIMEOUT_MS,
  };
  process.env.SOSTATS_API_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.WORKER_API_TOKEN = 'test-token';
  process.env.PUBLISH_EXECUTE_TIMEOUT_MS = '100';
  t.after(async () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  const started = Date.now();
  const outcome = await Promise.race([
    executePublication(
      {
        scheduledPublicationId: 42,
        expectedVersion: '2026-09-30T00:00:00.000Z',
        expectedDispatchGeneration: 3,
      },
      'publication-42-dispatch-3',
    ).then(
      () => ({ settled: 'resolved' }),
      (error) => ({ settled: 'rejected', error }),
    ),
    new Promise((resolve) => {
      setTimeout(() => resolve({ settled: 'still pending' }), 2_000).unref();
    }),
  ]);
  const elapsed = Date.now() - started;

  assert.equal(held.length, 1, 'the execute request reached the API');
  assert.equal(outcome.settled, 'rejected');
  assert.equal(outcome.error.name, 'TimeoutError');
  assert.ok(elapsed < 2_000, `rejected after ${elapsed} ms`);
});
