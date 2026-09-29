export type DispatchablePublication = {
  id: number;
  scheduledAt: string;
  nextAttemptAt: string | null;
  updatedAt: string;
  dispatchGeneration: number;
};

export type PublishingJobData = {
  scheduledPublicationId: number;
  expectedVersion: string;
  expectedDispatchGeneration: number;
};

export type ExecutePublicationResponse = {
  status:
    | 'published'
    | 'already_published'
    | 'stale'
    | 'terminal'
    | 'in_progress'
    | 'outcome_unknown'
    | 'retry_scheduled'
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

async function request<T>(
  path: string,
  init: RequestInit = {},
  timeoutMs?: number,
): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set('x-worker-token', workerToken());
  if (init.body && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }

  const response = await fetch(`${apiBaseUrl()}${path}`, {
    ...init,
    headers,
    signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined,
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

function executeTimeoutMs() {
  const value = Number.parseInt(process.env.PUBLISH_EXECUTE_TIMEOUT_MS || '', 10);
  return Number.isFinite(value) && value > 0 ? value : 180_000;
}

const EXECUTE_STATUSES: readonly string[] = [
  'published',
  'already_published',
  'stale',
  'terminal',
  'in_progress',
  'outcome_unknown',
  'retry_scheduled',
  'failed_terminal',
];

export async function executePublication(
  data: PublishingJobData,
  queueJobId?: string,
) {
  const result = await request<ExecutePublicationResponse>(
    `/internal/publications/${data.scheduledPublicationId}/execute`,
    {
      method: 'POST',
      body: JSON.stringify({
        expectedVersion: data.expectedVersion,
        expectedDispatchGeneration: data.expectedDispatchGeneration,
        queueJobId,
      }),
    },
    executeTimeoutMs(),
  );
  // An unrecognised 200 means the protocol did not complete: treat it as a
  // transport failure so the job is retried/removed, never completed.
  const status = (result as { status?: unknown } | null)?.status;
  if (typeof status !== 'string' || !EXECUTE_STATUSES.includes(status)) {
    throw new PublishingApiError(
      'Publishing API returned an unrecognised execute response',
      200,
    );
  }
  return result;
}
