export type DispatchableAnalytics = {
  publicationResultId: number;
  contentItemId: number;
  socialAccountId: number;
  provider: string;
  platformPostId: string;
  expectedSnapshotAt: string | null;
  revision: string;
  dueAt: string;
};

export type AnalyticsJobData = {
  publicationResultId: number;
  expectedSnapshotAt: string | null;
};

export type IngestAnalyticsResponse = {
  status:
    | 'ingested'
    | 'stale'
    | 'not_due'
    | 'not_supported'
    | 'failed_terminal';
  publicationResultId: number;
  snapshotId?: number;
  metrics?: Record<string, number>;
  delta?: Record<string, number>;
  reason?: string;
  permissionDenied?: boolean;
};

class AnalyticsApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload?: unknown,
  ) {
    super(message);
    this.name = 'AnalyticsApiError';
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
  const bodyText = await response.text();

  let payload: unknown = null;
  if (bodyText) {
    try {
      payload = JSON.parse(bodyText);
    } catch {
      payload = bodyText;
    }
  }

  if (!response.ok) {
    throw new AnalyticsApiError(
      `Analytics API returned HTTP ${response.status}`,
      response.status,
      payload,
    );
  }

  return payload as T;
}

export function getDispatchableAnalytics(limit = 250) {
  const query = new URLSearchParams({ limit: String(limit) });
  return request<DispatchableAnalytics[]>(
    `/internal/analytics/dispatchable?${query.toString()}`,
  );
}

export function ingestPublicationAnalytics(
  publicationResultId: number,
  expectedSnapshotAt: string | null,
) {
  return request<IngestAnalyticsResponse>(
    `/internal/analytics/publication-results/${publicationResultId}/ingest`,
    {
      method: 'POST',
      body: JSON.stringify({ expectedSnapshotAt }),
    },
  );
}
