const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { reconcileDue } = require('../dist/publishing/publishing.api.js');
const {
  reconciliationConfig,
  reconcileOnce,
} = require('../dist/publishing/reconciliation.dispatcher.js');

async function withApi(t, handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({
      method: req.method,
      url: req.url,
      token: req.headers['x-worker-token'],
    });
    handler(req, res, requests.length);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const saved = {
    SOSTATS_API_URL: process.env.SOSTATS_API_URL,
    WORKER_API_TOKEN: process.env.WORKER_API_TOKEN,
  };
  process.env.SOSTATS_API_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.WORKER_API_TOKEN = 'test-token';
  t.after(async () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return requests;
}

// 32B-1 §11: the request must outlive one lookup budget plus 30 s.
test('reconciliationConfig refuses a request timeout below the lookup budget plus 30 s', () => {
  assert.throws(
    () =>
      reconciliationConfig({
        RECONCILE_LOOKUP_BUDGET_MS: '45000',
        RECONCILE_REQUEST_TIMEOUT_MS: '74999',
      }),
    /RECONCILE_REQUEST_TIMEOUT_MS/,
  );
  assert.deepEqual(
    reconciliationConfig({
      RECONCILE_LOOKUP_BUDGET_MS: '45000',
      RECONCILE_REQUEST_TIMEOUT_MS: '75000',
    }),
    { pollMs: 30000, requestTimeoutMs: 75000 },
  );
  assert.deepEqual(reconciliationConfig({}), {
    pollMs: 30000,
    requestTimeoutMs: 120000,
  });
  assert.equal(reconciliationConfig({ RECONCILE_POLL_MS: '100' }).pollMs, 5000);
});

test('reconcileDue posts with the worker token and times out as a transport failure', async (t) => {
  const held = [];
  const requests = await withApi(t, (_req, res) => {
    held.push(res); // never answered
  });

  const outcome = await reconcileDue(100).then(
    () => ({ settled: 'resolved' }),
    (error) => ({ settled: 'rejected', error }),
  );

  assert.deepEqual(requests, [
    { method: 'POST', url: '/internal/publications/reconcile-due', token: 'test-token' },
  ]);
  assert.equal(outcome.settled, 'rejected');
  assert.equal(outcome.error.name, 'TimeoutError');
});

test('reconcileOnce logs a transport failure and the next poll tries again', async (t) => {
  const requests = await withApi(t, (_req, res, count) => {
    if (count === 1) {
      res.writeHead(503);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        selected: 1,
        results: [{ publicationId: 7, outcome: 'published', evidenceType: 'confirmed_post_id' }],
      }),
    );
  });
  const errors = [];
  const logs = [];
  t.mock.method(console, 'error', (...args) => errors.push(args.join(' ')));
  t.mock.method(console, 'log', (line) => logs.push(line));
  const config = { pollMs: 5000, requestTimeoutMs: 1000 };

  await reconcileOnce(config);
  await reconcileOnce(config);

  assert.equal(requests.length, 2);
  assert.match(errors[0], /HTTP 503/);
  assert.deepEqual(JSON.parse(logs[0]), {
    event: 'publication.reconciliation_batch',
    selected: 1,
    published: 1,
    needs_review: 0,
    lost: 0,
    error: 0,
  });
});
