import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import { ACTIVE_PUBLICATION_STATUSES, isStatusIn } from './publication-state.js';

const sp = schema.scheduledPublications;
const ci = schema.contentItems;
const cv = schema.contentVariants;

export type Tx = Parameters<
  Parameters<PostgresJsDatabase<typeof schema>['transaction']>[0]
>[0];

type RolledUp = { id: number; contentItemId: number; variantId: number | null };

/**
 * Lock order everywhere: publication row, then content item, then variant.
 * Locking the content item before reading siblings serializes concurrent
 * sibling transitions, so the last one to commit sees all the others.
 */
async function siblingsUnderLock(tx: Tx, contentItemId: number) {
  await tx
    .select({ id: ci.id })
    .from(ci)
    .where(eq(ci.id, contentItemId))
    .for('update');
  return tx
    .select({
      id: sp.id,
      status: sp.status,
      variantId: sp.variantId,
      scheduledAt: sp.scheduledAt,
    })
    .from(sp)
    .where(eq(sp.contentItemId, contentItemId));
}

/** The publication just became `published`. */
export async function rollupPublished(tx: Tx, row: RolledUp, now: Date) {
  const siblings = await siblingsUnderLock(tx, row.contentItemId);
  const allDone = siblings.every(
    (sibling) =>
      sibling.id === row.id ||
      ['published', 'cancelled'].includes(sibling.status),
  );
  if (allDone) {
    await tx
      .update(ci)
      .set({ status: 'published', updatedAt: now })
      .where(eq(ci.id, row.contentItemId));
  }
  if (row.variantId) {
    await tx
      .update(cv)
      .set({ status: 'published', publishedAt: now, updatedAt: now })
      .where(eq(cv.id, row.variantId));
  }
}

/** The publication was just cancelled. */
export async function rollupCancelled(tx: Tx, row: RolledUp, now: Date) {
  const siblings = await siblingsUnderLock(tx, row.contentItemId);
  const active = siblings.filter((sibling) =>
    isStatusIn(sibling.status, ACTIVE_PUBLICATION_STATUSES),
  );
  const anyPublished = siblings.some((sibling) => sibling.status === 'published');
  await tx
    .update(ci)
    .set({
      status: active.length ? 'scheduled' : anyPublished ? 'published' : 'in_review',
      updatedAt: now,
    })
    .where(eq(ci.id, row.contentItemId));

  if (row.variantId) {
    const variantSiblings = siblings.filter(
      (sibling) => sibling.variantId === row.variantId,
    );
    const nextActive = variantSiblings
      .filter((sibling) => isStatusIn(sibling.status, ACTIVE_PUBLICATION_STATUSES))
      .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())[0];
    const variantPublished = variantSiblings.some(
      (sibling) => sibling.status === 'published',
    );
    await tx
      .update(cv)
      .set({
        status: nextActive ? 'scheduled' : variantPublished ? 'published' : 'draft',
        scheduledAt: nextActive?.scheduledAt || null,
        updatedAt: now,
      })
      .where(eq(cv.id, row.variantId));
  }
}

/** The publication was just re-armed to `scheduled` at `scheduledAt`. */
export async function rollupRearmed(
  tx: Tx,
  row: RolledUp,
  scheduledAt: Date,
  now: Date,
) {
  await tx
    .update(ci)
    .set({ status: 'scheduled', updatedAt: now })
    .where(eq(ci.id, row.contentItemId));
  if (row.variantId) {
    await tx
      .update(cv)
      .set({ status: 'scheduled', scheduledAt, updatedAt: now })
      .where(eq(cv.id, row.variantId));
  }
}
