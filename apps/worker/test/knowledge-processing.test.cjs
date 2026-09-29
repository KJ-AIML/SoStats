const test = require('node:test');
const assert = require('node:assert/strict');
const {
  chunkBatches,
  validateProcessedKnowledge,
} = require('../dist/knowledge/knowledge-result.js');

test('batches knowledge chunks under the internal API batch limit', () => {
  const batches = chunkBatches(Array.from({ length: 19 }, (_, index) => index), 8);
  assert.deepEqual(batches.map((batch) => batch.length), [8, 8, 3]);
});

test('validates embedding dimensions and duplicate chunk indexes', () => {
  const embedding = Array.from({ length: 1536 }, () => 0.01);
  const valid = validateProcessedKnowledge({
    text_length: 100,
    chunk_count: 1,
    embedding_model: 'text-embedding-3-small',
    dimensions: 1536,
    chunks: [{ index: 0, content: 'Brand evidence', embedding }],
  });
  assert.equal(valid.chunks.length, 1);

  assert.throws(() =>
    validateProcessedKnowledge({
      text_length: 100,
      chunk_count: 2,
      embedding_model: 'text-embedding-3-small',
      dimensions: 1536,
      chunks: [
        { index: 0, content: 'A', embedding },
        { index: 0, content: 'B', embedding },
      ],
    }),
  );
});
