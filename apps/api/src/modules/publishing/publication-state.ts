import { sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
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
