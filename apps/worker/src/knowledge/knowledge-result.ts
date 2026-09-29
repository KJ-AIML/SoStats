import type { KnowledgeChunk } from './knowledge.api';

export type ProcessedKnowledgeResult = {
  text_length: number;
  chunk_count: number;
  embedding_model: string;
  dimensions: number;
  chunks: KnowledgeChunk[];
};

export function validateProcessedKnowledge(
  value: unknown,
): ProcessedKnowledgeResult {
  if (!value || typeof value !== 'object') {
    throw new Error('Knowledge AI response is not an object');
  }
  const payload = value as Partial<ProcessedKnowledgeResult>;
  if (
    payload.dimensions !== 1536 ||
    !Array.isArray(payload.chunks) ||
    payload.chunks.length < 1 ||
    payload.chunks.length > 100 ||
    payload.chunk_count !== payload.chunks.length ||
    typeof payload.embedding_model !== 'string' ||
    !payload.embedding_model.trim()
  ) {
    throw new Error('Knowledge AI response shape is invalid');
  }

  const indexes = new Set<number>();
  for (const chunk of payload.chunks) {
    if (
      !chunk ||
      !Number.isInteger(chunk.index) ||
      chunk.index < 0 ||
      indexes.has(chunk.index) ||
      typeof chunk.content !== 'string' ||
      !chunk.content.trim() ||
      chunk.content.length > 30_000 ||
      !Array.isArray(chunk.embedding) ||
      chunk.embedding.length !== 1536 ||
      chunk.embedding.some(
        (item) => typeof item !== 'number' || !Number.isFinite(item),
      )
    ) {
      throw new Error('Knowledge AI chunk is invalid');
    }
    indexes.add(chunk.index);
  }

  return payload as ProcessedKnowledgeResult;
}

export function chunkBatches<T>(items: T[], size = 8): T[][] {
  const safeSize = Math.max(1, Math.min(10, Math.floor(size)));
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += safeSize) {
    batches.push(items.slice(index, index + safeSize));
  }
  return batches;
}
