import { positiveIntEnv } from '../../../utils/env.util.js';
import type { ProviderErrorClass } from '../ports/SocialPublisherPort.js';

export function providerHttpTimeoutMs(env: NodeJS.ProcessEnv = process.env) {
  return positiveIntEnv(env, 'PROVIDER_HTTP_TIMEOUT_MS', 30_000);
}

/** Per-request deadline, also bounded by the whole publish budget when given. */
export function providerSignal(parent?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(providerHttpTimeoutMs());
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}

export function httpErrorClass(status: number): ProviderErrorClass {
  if (status === 401) return 'authentication';
  if (status === 403) return 'authorization';
  if (status === 404) return 'resource_not_found';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'transient_provider';
  if (status === 400 || status === 422) return 'invalid_request';
  return 'permanent_provider';
}

export async function readJson<T>(response: Response): Promise<T | undefined> {
  try {
    return (await response.json()) as T;
  } catch {
    return undefined;
  }
}
