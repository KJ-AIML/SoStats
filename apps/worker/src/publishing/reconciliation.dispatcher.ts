import { reconcileDue } from './publishing.api';

export type ReconciliationConfig = {
  pollMs: number;
  requestTimeoutMs: number;
};

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number) {
  const value = Number.parseInt(env[name] || '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** 32B-1 §11: the request must outlive one lookup budget plus 30 s of API overhead. */
export function reconciliationConfig(
  env: NodeJS.ProcessEnv = process.env,
): ReconciliationConfig {
  const lookupBudgetMs = positiveInt(env, 'RECONCILE_LOOKUP_BUDGET_MS', 45_000);
  const requestTimeoutMs = positiveInt(
    env,
    'RECONCILE_REQUEST_TIMEOUT_MS',
    120_000,
  );
  if (requestTimeoutMs < lookupBudgetMs + 30_000) {
    throw new Error(
      'RECONCILE_REQUEST_TIMEOUT_MS must be at least RECONCILE_LOOKUP_BUDGET_MS + 30000',
    );
  }
  return {
    pollMs: Math.max(5_000, positiveInt(env, 'RECONCILE_POLL_MS', 30_000)),
    requestTimeoutMs,
  };
}

let polling = false;
let timer: NodeJS.Timeout | undefined;

/** One poll. The worker holds no domain state: a failure is logged and the next poll retries. */
export async function reconcileOnce(config: ReconciliationConfig) {
  if (polling) return;
  polling = true;
  try {
    const summary = await reconcileDue(config.requestTimeoutMs);
    if (summary.selected) {
      const count = (outcome: string) =>
        summary.results.filter((result) => result.outcome === outcome).length;
      console.log(
        JSON.stringify({
          event: 'publication.reconciliation_batch',
          selected: summary.selected,
          published: count('published'),
          needs_review: count('needs_review'),
          lost: count('lost'),
          error: count('error'),
        }),
      );
    }
  } catch (error) {
    console.error(
      '[ReconciliationDispatcher] Poll failed:',
      error instanceof Error ? error.message : error,
    );
  } finally {
    polling = false;
  }
}

export function startReconciliationDispatcher() {
  let config: ReconciliationConfig;
  try {
    config = reconciliationConfig();
  } catch (error) {
    console.error(
      `[ReconciliationDispatcher] Not started: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }
  void reconcileOnce(config);
  timer = setInterval(() => {
    void reconcileOnce(config);
  }, config.pollMs);
  console.log(`[ReconciliationDispatcher] Polling every ${config.pollMs}ms`);
}

export async function stopReconciliationDispatcher() {
  if (timer) clearInterval(timer);
}
