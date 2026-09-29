import type { ProviderErrorClass } from '../ports/SocialPublisherPort.js';
import { httpErrorClass } from './provider-http.js';

export type MetaErrorBody = {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
    is_transient?: boolean;
  };
};

const RATE_LIMIT_CODES = [4, 17, 32, 613];

export function metaRateLimited(status: number, body?: MetaErrorBody) {
  return status === 429 || RATE_LIMIT_CODES.includes(body?.error?.code ?? 0);
}

export function metaTransient(status: number, body?: MetaErrorBody) {
  return status >= 500 || body?.error?.is_transient === true;
}

/** Safe to retry for requests that cannot create a public post. */
export function retryableMetaError(status: number, body?: MetaErrorBody) {
  return metaRateLimited(status, body) || metaTransient(status, body);
}

export function metaErrorClass(
  status: number,
  body?: MetaErrorBody,
): ProviderErrorClass {
  if (metaRateLimited(status, body)) return 'rate_limit';
  if (metaTransient(status, body)) return 'transient_provider';
  const code = body?.error?.code ?? 0;
  if (code === 190) return 'authentication';
  if (code === 10 || (code >= 200 && code <= 299)) return 'authorization';
  return httpErrorClass(status);
}

export function metaMessage(
  prefix: string,
  status: number,
  body?: MetaErrorBody,
) {
  return `${prefix} (HTTP ${status}): ${body?.error?.message || 'Meta Graph API rejected the request'}`;
}
