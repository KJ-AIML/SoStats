const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildPublicationJob,
  publicationJobId,
} = require('../dist/publishing/publishing.jobs.js');

const publication = {
  id: 42,
  scheduledAt: '2026-10-01T09:00:00.000Z',
  nextAttemptAt: null,
  updatedAt: '2026-09-30T00:00:00.000Z',
  dispatchGeneration: 3,
};

test('job id is the persisted dispatch generation', () => {
  assert.equal(publicationJobId(publication), 'publication-42-dispatch-3');
});

test('delay falls back to scheduledAt when there is no retry time', () => {
  const now = Date.parse('2026-10-01T08:59:00.000Z');
  assert.equal(buildPublicationJob(publication, now, {}).opts.delay, 60_000);
});

test('delay honours next_attempt_at over scheduled_at', () => {
  const now = Date.parse('2026-10-01T09:00:00.000Z');
  const job = buildPublicationJob(
    { ...publication, nextAttemptAt: '2026-10-01T09:05:00.000Z' },
    now,
    {},
  );
  assert.equal(job.opts.delay, 300_000);
});

test('carries the generation and version for the API gates', () => {
  const job = buildPublicationJob(publication, 0, {});
  assert.deepEqual(job.data, {
    scheduledPublicationId: 42,
    expectedVersion: '2026-09-30T00:00:00.000Z',
    expectedDispatchGeneration: 3,
  });
});

test('removes failed transport envelopes so the generation can be re-dispatched', () => {
  assert.equal(buildPublicationJob(publication, 0, {}).opts.removeOnFail, true);
});

test('transport attempts fall back to PUBLISH_MAX_ATTEMPTS', () => {
  assert.equal(buildPublicationJob(publication, 0, { PUBLISH_MAX_ATTEMPTS: '7' }).opts.attempts, 7);
  assert.equal(
    buildPublicationJob(publication, 0, { PUBLISH_TRANSPORT_ATTEMPTS: '2', PUBLISH_MAX_ATTEMPTS: '7' }).opts.attempts,
    2,
  );
});
