export type ClaimedOutboxEvent = {
  id: number;
  workspaceId: number | null;
  topic: string;
  leaseToken: string;
  leaseExpiresAt: string;
};

export type OutboxJobData = {
  outboxEventId: number;
  leaseToken: string;
};

export type OutboxExecuteResponse = {
  status: 'completed' | 'dead' | 'stale_lease' | 'retry_scheduled';
  outboxEventId: number;
  attempts?: number;
  error?: string;
};

class OutboxApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload?: unknown,
  ) {
    super(message);
    this.name = 'OutboxApiError';
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
    throw new OutboxApiError(
      `Outbox API returned HTTP ${response.status}`,
      response.status,
      payload,
    );
  }

  return payload as T;
}

export function claimOutbox(limit = 100) {
  return request<ClaimedOutboxEvent[]>('/internal/outbox/claim', {
    method: 'POST',
    body: JSON.stringify({ limit }),
  });
}

export function executeOutbox(
  outboxEventId: number,
  leaseToken: string,
) {
  return request<OutboxExecuteResponse>(
    `/internal/outbox/${outboxEventId}/execute`,
    {
      method: 'POST',
      body: JSON.stringify({ leaseToken }),
    },
  );
}
