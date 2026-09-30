import { sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn, PgUpdateSetSource } from 'drizzle-orm/pg-core';
import * as schema from '../../db/schema.js';

export const ACTIVE_PUBLICATION_STATUSES = [
  'scheduled',
  'publishing',
  'unknown',
  'needs_review',
] as const;

/** Statuses a user may reschedule or cancel (spec §5.2). */
export const USER_MUTABLE_PUBLICATION_STATUSES = [
  'scheduled',
  'failed',
] as const;

/** Statuses that may still need the channel's credentials (spec §5.2). */
export const CREDENTIAL_DEPENDENT_PUBLICATION_STATUSES = [
  'scheduled',
  'publishing',
  'unknown',
] as const;

export const ACTIVE_IDENTITY_INDEX = 'scheduled_pub_active_identity_idx';

export function isStatusIn(status: string, statuses: readonly string[]) {
  return statuses.includes(status);
}

/** Back to `scheduled` under a new dispatch generation (spec §3.2 "re-armed"). */
export function rearmSet(
  now: Date,
  nextAttemptAt: Date | null,
): PgUpdateSetSource<typeof schema.scheduledPublications> {
  return {
    status: 'scheduled',
    dispatchGeneration: sql`${schema.scheduledPublications.dispatchGeneration} + 1`,
    activeAttemptId: null,
    leaseExpiresAt: null,
    nextAttemptAt,
    updatedAt: now,
  };
}

/**
 * Optimistic-lock predicate. Versions travel as JS Dates/ISO strings (ms
 * precision) while column defaults carry microseconds, so compare truncated.
 */
export function sameVersion(column: AnyPgColumn, version: Date | string): SQL {
  return sql`date_trunc('milliseconds', ${column}) = ${new Date(version).toISOString()}::timestamp`;
}

/** CAS on an observed `reconcile_after`, at millisecond precision like `sameVersion`. */
export function sameReconcileAfter(observed: Date | null): SQL {
  const column = schema.scheduledPublications.reconcileAfter;
  return observed === null ? sql`${column} is null` : sameVersion(column, observed);
}
