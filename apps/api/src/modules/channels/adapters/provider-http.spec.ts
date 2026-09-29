import { afterEach, describe, expect, it } from 'vitest';
import { httpErrorClass, providerSignal, readJson } from './provider-http.js';

describe('provider-http', () => {
  const original = process.env.PROVIDER_HTTP_TIMEOUT_MS;
  afterEach(() => {
    if (original === undefined) delete process.env.PROVIDER_HTTP_TIMEOUT_MS;
    else process.env.PROVIDER_HTTP_TIMEOUT_MS = original;
  });

  it.each([
    [401, 'authentication'],
    [403, 'authorization'],
    [404, 'resource_not_found'],
    [429, 'rate_limit'],
    [500, 'transient_provider'],
    [503, 'transient_provider'],
    [400, 'invalid_request'],
    [422, 'invalid_request'],
    [409, 'permanent_provider'],
  ])('classifies HTTP %i as %s', (status, expected) => {
    expect(httpErrorClass(status)).toBe(expected);
  });

  it('aborts after the per-request timeout', async () => {
    process.env.PROVIDER_HTTP_TIMEOUT_MS = '10';
    const signal = providerSignal();
    await new Promise((resolve) => signal.addEventListener('abort', resolve));
    expect(signal.aborted).toBe(true);
  });

  it('aborts when the parent budget aborts', () => {
    const parent = new AbortController();
    const signal = providerSignal(parent.signal);
    parent.abort();
    expect(signal.aborted).toBe(true);
  });

  it('returns undefined for an unparseable body', async () => {
    await expect(readJson(new Response('not json'))).resolves.toBeUndefined();
    await expect(readJson(new Response('{"id":"1"}'))).resolves.toEqual({
      id: '1',
    });
  });
});
