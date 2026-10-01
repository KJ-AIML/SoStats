import { describe, expect, it } from 'vitest';
import { loadPublishingConfig, retryDelayMs } from './publishing.config.js';

describe('loadPublishingConfig', () => {
  it('uses the spec defaults', () => {
    expect(loadPublishingConfig({})).toEqual({
      providerHttpTimeoutMs: 30_000,
      providerBudgetMs: 120_000,
      leaseMs: 300_000,
      maxAttempts: 5,
      reconcileGraceMs: 600_000,
      reconcileBatchLimit: 5,
      reconcileLookupBudgetMs: 45_000,
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

describe('reconciliation settings (32B-1 §11)', () => {
  it('rejects a lookup budget below the provider request timeout', () => {
    expect(() =>
      loadPublishingConfig({
        PROVIDER_HTTP_TIMEOUT_MS: '30000',
        RECONCILE_LOOKUP_BUDGET_MS: '29999',
      }),
    ).toThrow(/RECONCILE_LOOKUP_BUDGET_MS/);
  });

  it('accepts a lookup budget equal to the provider request timeout', () => {
    expect(
      loadPublishingConfig({
        PROVIDER_HTTP_TIMEOUT_MS: '30000',
        RECONCILE_LOOKUP_BUDGET_MS: '30000',
      }).reconcileLookupBudgetMs,
    ).toBe(30_000);
  });

  it('accepts any grace of at least 1 s, independent of the publish lease', () => {
    expect(
      loadPublishingConfig({
        RECONCILE_GRACE_SECONDS: '1',
        PUBLISH_LEASE_SECONDS: '300',
      }).reconcileGraceMs,
    ).toBe(1_000);
    expect(() => loadPublishingConfig({ RECONCILE_GRACE_SECONDS: '0' })).toThrow(
      /RECONCILE_GRACE_SECONDS/,
    );
  });

  it('caps the batch limit at 20', () => {
    expect(
      loadPublishingConfig({ RECONCILE_BATCH_LIMIT: '50' }).reconcileBatchLimit,
    ).toBe(20);
  });
});

describe('retryDelayMs', () => {
  it('doubles from 30 s and caps at 15 min', () => {
    expect([1, 2, 3, 10].map(retryDelayMs)).toEqual([
      30_000, 60_000, 120_000, 900_000,
    ]);
  });
});
