import { positiveIntEnv } from '../../utils/env.util.js';
import { providerHttpTimeoutMs } from '../channels/adapters/provider-http.js';

export const PUBLISHING_CONFIG = Symbol('PUBLISHING_CONFIG');

export type PublishingConfig = {
  providerHttpTimeoutMs: number;
  providerBudgetMs: number;
  leaseMs: number;
  maxAttempts: number;
  reconcileGraceMs: number;
  reconcileBatchLimit: number;
  reconcileLookupBudgetMs: number;
};

/** Spec §8. Throws at boot on unsafe deadline ordering. */
export function loadPublishingConfig(
  env: NodeJS.ProcessEnv = process.env,
): PublishingConfig {
  const config = {
    providerHttpTimeoutMs: providerHttpTimeoutMs(env),
    providerBudgetMs: positiveIntEnv(
      env,
      'PUBLISH_PROVIDER_BUDGET_MS',
      120_000,
    ),
    leaseMs: positiveIntEnv(env, 'PUBLISH_LEASE_SECONDS', 300) * 1000,
    maxAttempts: positiveIntEnv(env, 'PUBLISH_MAX_ATTEMPTS', 5),
    reconcileGraceMs:
      positiveIntEnv(env, 'RECONCILE_GRACE_SECONDS', 600) * 1000,
    reconcileBatchLimit: Math.min(
      20,
      positiveIntEnv(env, 'RECONCILE_BATCH_LIMIT', 5),
    ),
    reconcileLookupBudgetMs: positiveIntEnv(
      env,
      'RECONCILE_LOOKUP_BUDGET_MS',
      45_000,
    ),
  };
  if (config.providerHttpTimeoutMs > config.providerBudgetMs) {
    throw new Error(
      'PROVIDER_HTTP_TIMEOUT_MS must not exceed PUBLISH_PROVIDER_BUDGET_MS',
    );
  }
  if (config.leaseMs < config.providerBudgetMs + 60_000) {
    throw new Error(
      'PUBLISH_LEASE_SECONDS must cover PUBLISH_PROVIDER_BUDGET_MS plus 60 seconds',
    );
  }
  if (config.reconcileLookupBudgetMs < config.providerHttpTimeoutMs) {
    throw new Error(
      'RECONCILE_LOOKUP_BUDGET_MS must be at least PROVIDER_HTTP_TIMEOUT_MS',
    );
  }
  return config;
}

export function retryDelayMs(attemptCount: number) {
  return Math.min(15 * 60_000, 30_000 * 2 ** Math.max(0, attemptCount - 1));
}
