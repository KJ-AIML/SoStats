export type DispatchablePublication = {
  id: number;
  scheduledAt: string;
  updatedAt: string;
};

export type PublishingJobData = {
  scheduledPublicationId: number;
  expectedVersion: string;
};

export type ExecutePublicationResponse = {
  status:
    | 'published'
    | 'already_published'
    | 'stale'
    | 'terminal'
    | 'in_progress'
    | 'failed_terminal';
  scheduledPublicationId: number;
  platformPostId?: string | null;
  platformPostUrl?: string | null;
  reason?: string;
};

export class PublishingApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload?: unknown,
  ) {
    super(message);
    this.name = 'PublishingApiError';
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
    throw new PublishingApiError(
      `Publishing API returned HTTP ${response.status}`,
      response.status,
      payload,
    );
  }

  return payload as T;
}

export function getDispatchablePublications(
  until: string,
  offset = 0,
  limit = 250,
) {
  const query = new URLSearchParams({
    until,
    offset: String(offset),
    limit: String(limit),
  });
  return request<DispatchablePublication[]>(
    `/internal/publications/dispatchable?${query.toString()}`,
  );
}

export function executePublication(
  scheduledPublicationId: number,
  expectedVersion: string,
) {
  return request<ExecutePublicationResponse>(
    `/internal/publications/${scheduledPublicationId}/execute`,
    {
      method: 'POST',
      body: JSON.stringify({ expectedVersion }),
    },
  );
}

export function deadLetterPublication(
  scheduledPublicationId: number,
  expectedVersion: string,
  reason: string,
) {
  return request<{ status: string; scheduledPublicationId: number }>(
    `/internal/publications/${scheduledPublicationId}/dead-letter`,
    {
      method: 'POST',
      body: JSON.stringify({ expectedVersion, reason }),
    },
  );
}
