export type DispatchableMedia = {
  assetId: number;
  revision: string;
  status: string;
};

export type MediaJobData = {
  assetId: number;
  revision: string;
  processingToken?: string;
};

export type MediaClaimResponse =
  | {
      status: 'claimed';
      assetId: number;
      processingToken: string;
      fileType: string;
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
      assetId: number;
    };

class MediaApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload?: unknown,
  ) {
    super(message);
    this.name = 'MediaApiError';
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
  if (!value) throw new Error('WORKER_API_TOKEN must be configured for the worker');
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
    throw new MediaApiError(
      `Media API returned HTTP ${response.status}`,
      response.status,
      payload,
    );
  }

  return payload as T;
}

export function getDispatchableMedia(limit = 250) {
  return request<DispatchableMedia[]>(
    `/internal/media/dispatchable?limit=${encodeURIComponent(String(limit))}`,
  );
}

export function claimMedia(
  assetId: number,
  processingToken?: string,
) {
  return request<MediaClaimResponse>(
    `/internal/media/${assetId}/claim`,
    {
      method: 'POST',
      body: JSON.stringify({ processingToken }),
    },
  );
}

export function completeMedia(
  assetId: number,
  processingToken: string,
  metadata: { width?: number; height?: number; durationMs?: number },
) {
  return request<{ status: string }>(
    `/internal/media/${assetId}/complete`,
    {
      method: 'POST',
      body: JSON.stringify({ processingToken, metadata }),
    },
  );
}

export function failMedia(
  assetId: number,
  processingToken: string,
  reason: string,
) {
  return request<{ status: string }>(
    `/internal/media/${assetId}/fail`,
    {
      method: 'POST',
      body: JSON.stringify({ processingToken, reason }),
    },
  );
}
