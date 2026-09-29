export type DispatchableRssTrigger = {
  triggerId: number;
  automationId: number;
  revision: string;
};

export type RssTriggerJobData = {
  triggerId: number;
  revision: string;
  leaseToken?: string;
};

export type RssTriggerClaim =
  | {
      status: 'claimed';
      triggerId: number;
      leaseToken: string;
      feedUrl: string;
      pollMinutes: number;
      initialSync: 'baseline' | 'latest';
    }
  | {
      status: 'not_ready' | 'already_processing' | 'stale';
      triggerId: number;
    };

class TriggerApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload?: unknown,
  ) {
    super(message);
    this.name = 'TriggerApiError';
  }
}

function apiBaseUrl() {
  return (process.env.SOSTATS_API_URL || 'http://localhost:4000').replace(/\/$/, '');
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
    throw new TriggerApiError(
      `Automation trigger API returned HTTP ${response.status}`,
      response.status,
      payload,
    );
  }

  return payload as T;
}

export function getDispatchableRssTriggers(limit = 250) {
  return request<DispatchableRssTrigger[]>(
    `/internal/automation-triggers/rss/dispatchable?limit=${encodeURIComponent(String(limit))}`,
  );
}

export function claimRssTrigger(triggerId: number, leaseToken?: string) {
  return request<RssTriggerClaim>(
    `/internal/automation-triggers/${triggerId}/claim`,
    {
      method: 'POST',
      body: JSON.stringify({ leaseToken }),
    },
  );
}

export function completeRssTrigger(
  triggerId: number,
  leaseToken: string,
  payload: {
    feedTitle?: string;
    entries: Array<{
      externalId: string;
      title?: string;
      link?: string;
      publishedAt?: string;
      summary?: string;
    }>;
  },
) {
  return request<{
    status: string;
    triggerId: number;
    newEvents?: number;
    runCount?: number;
    runIds?: number[];
  }>(
    `/internal/automation-triggers/${triggerId}/complete`,
    {
      method: 'POST',
      body: JSON.stringify({ leaseToken, ...payload }),
    },
  );
}

export function failRssTrigger(
  triggerId: number,
  leaseToken: string,
  reason: string,
) {
  return request<{ status: string; triggerId: number }>(
    `/internal/automation-triggers/${triggerId}/fail`,
    {
      method: 'POST',
      body: JSON.stringify({ leaseToken, reason }),
    },
  );
}
