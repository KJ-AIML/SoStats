export type DispatchableAutomationRun = {
  id: number;
  resumeToken: string;
};

export type AutomationJobData = {
  runId: number;
  expectedStepId: string;
};

export type ExecuteAutomationResponse = {
  status:
    | 'completed'
    | 'waiting_approval'
    | 'failed'
    | 'stale'
    | 'already_terminal';
  runId: number;
  stepId?: string;
  error?: string;
};

class AutomationApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload?: unknown,
  ) {
    super(message);
    this.name = 'AutomationApiError';
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
    throw new AutomationApiError(
      `Automation API returned HTTP ${response.status}`,
      response.status,
      payload,
    );
  }

  return payload as T;
}

export function getDispatchableAutomationRuns(
  offset = 0,
  limit = 250,
) {
  const query = new URLSearchParams({
    offset: String(offset),
    limit: String(limit),
  });

  return request<DispatchableAutomationRun[]>(
    `/internal/automation-runs/dispatchable?${query.toString()}`,
  );
}

export function executeAutomationRun(
  runId: number,
  expectedStepId: string,
) {
  return request<ExecuteAutomationResponse>(
    `/internal/automation-runs/${runId}/execute`,
    {
      method: 'POST',
      body: JSON.stringify({ expectedStepId }),
    },
  );
}

export function deadLetterAutomationRun(runId: number, reason: string) {
  return request<{ runId: number; status: string; stepId?: string }>(
    `/internal/automation-runs/${runId}/dead-letter`,
    {
      method: 'POST',
      body: JSON.stringify({ reason }),
    },
  );
}
