import { describe, expect, it } from 'vitest';
import { loadPublishingConfig, retryDelayMs } from './publishing.config.js';

describe('loadPublishingConfig', () => {
  it('uses the spec defaults', () => {
    expect(loadPublishingConfig({})).toEqual({
      providerHttpTimeoutMs: 30_000,
      providerBudgetMs: 120_000,
      leaseMs: 300_000,
      maxAttempts: 5,
    });
  });

  it('rejects non-numeric values and names the variable', () => {
    expect(() => loadPublishingConfig({ PUBLISH_LEASE_SECONDS: '5m' })).toThrow(
      /PUBLISH_LEASE_SECONDS must be a positive integer/,
    );
    expect(() => loadPublishingConfig({ PUBLISH_MAX_ATTEMPTS: '0' })).toThrow(
      /PUBLISH_MAX_ATTEMPTS must be a positive integer/,
    );
  });

  it('rejects a lease that does not cover the provider budget plus 60 s', () => {
    expect(() =>
      loadPublishingConfig({
        PUBLISH_PROVIDER_BUDGET_MS: '120000',
        PUBLISH_LEASE_SECONDS: '179',
      }),
    ).toThrow(/PUBLISH_LEASE_SECONDS/);
  });

  it('rejects a per-request timeout above the whole budget', () => {
    expect(() =>
      loadPublishingConfig({
        PROVIDER_HTTP_TIMEOUT_MS: '200000',
        PUBLISH_PROVIDER_BUDGET_MS: '120000',
      }),
    ).toThrow(/PROVIDER_HTTP_TIMEOUT_MS/);
  });
});

describe('retryDelayMs', () => {
  it('doubles from 30 s and caps at 15 min', () => {
    expect([1, 2, 3, 10].map(retryDelayMs)).toEqual([
      30_000, 60_000, 120_000, 900_000,
    ]);
  });
});
