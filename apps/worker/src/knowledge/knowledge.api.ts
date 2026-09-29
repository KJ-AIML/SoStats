export type DispatchableKnowledge = {
  sourceId: number;
  revision: string;
  status: string;
};

export type KnowledgeJobData = {
  sourceId: number;
  revision: string;
  processingToken?: string;
};

export type KnowledgeClaimResponse =
  | {
      status: 'claimed';
      sourceId: number;
      processingToken: string;
      versionNumber: number;
      mimeType: string;
      declaredSize: number;
      sourceUrl: string;
    }
  | {
      status:
        | 'already_terminal'
        | 'not_ready'
        | 'stale'
        | 'already_processing';
      sourceId: number;
    };

export type KnowledgeChunk = {
  index: number;
  content: string;
  embedding: number[];
};

class KnowledgeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload?: unknown,
  ) {
    super(message);
    this.name = 'KnowledgeApiError';
  }
}

function apiBaseUrl() {
  return (process.env.SOSTATS_API_URL || 'http://localhost:4000').replace(
    /\/$/,
    '',
  );
}

function workerToken() {
  const value = process.env.WORKER_API_TOKEN;
  if (!value) {
    throw new Error('WORKER_API_TOKEN must be configured for the worker');
  }
  return value;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('x-worker-token', workerToken());
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers,
  });
  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (!response.ok) {
    throw new KnowledgeApiError(
      `Knowledge API returned HTTP ${response.status}`,
      response.status,
      payload,
    );
  }

  return payload as T;
}

export function getDispatchableKnowledge(limit = 250) {
  return request<DispatchableKnowledge[]>(
    `/internal/knowledge/dispatchable?limit=${encodeURIComponent(String(limit))}`,
  );
}

export function claimKnowledge(
  sourceId: number,
  processingToken?: string,
) {
  return request<KnowledgeClaimResponse>(
    `/internal/knowledge/${sourceId}/claim`,
    {
      method: 'POST',
      body: JSON.stringify({ processingToken }),
    },
  );
}

export function appendKnowledgeChunks(
  sourceId: number,
  processingToken: string,
  versionNumber: number,
  chunks: KnowledgeChunk[],
) {
  return request<{ status: string; accepted?: number }>(
    `/internal/knowledge/${sourceId}/chunks`,
    {
      method: 'POST',
      body: JSON.stringify({
        processingToken,
        versionNumber,
        chunks,
      }),
    },
  );
}

export function completeKnowledge(
  sourceId: number,
  processingToken: string,
  input: {
    versionNumber: number;
    chunkCount: number;
    embeddingModel: string;
    contentHash: string;
  },
) {
  return request<{ status: string; sourceId: number; version?: number }>(
    `/internal/knowledge/${sourceId}/complete`,
    {
      method: 'POST',
      body: JSON.stringify({ processingToken, ...input }),
    },
  );
}

export function failKnowledge(
  sourceId: number,
  processingToken: string,
  reason: string,
) {
  return request<{ status: string; sourceId: number }>(
    `/internal/knowledge/${sourceId}/fail`,
    {
      method: 'POST',
      body: JSON.stringify({ processingToken, reason }),
    },
  );
}
