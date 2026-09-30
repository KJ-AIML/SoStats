import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '../../src/db/schema.js';
import { PublicationLedger } from '../../src/modules/publishing/publication-ledger.js';
import { LeaseLostError } from '../../src/modules/publishing/publication-outcome.js';
import { loadPublishingConfig } from '../../src/modules/publishing/publishing.config.js';
import { createTestDatabase, type TestDatabase } from './test-database.js';
import {
  auditActions,
  createAmbiguousPublication,
  createPublication,
  reconciliationsOf,
  seedChannel,
} from './seed.js';
import { testAudit } from './publishing-support.js';

const sp = schema.scheduledPublications;
const pj = schema.publicationJobs;

describe('PublicationLedger', () => {
  let database: TestDatabase;
  let ledger: PublicationLedger;

  beforeAll(async () => {
    database = await createTestDatabase();
    ledger = new PublicationLedger(
      database.db,
      { ...loadPublishingConfig({}), maxAttempts: 2 },
      testAudit(database.db),
    );
  });

  afterAll(async () => {
    await database.drop();
  });

  async function scheduled() {
    return createPublication(database.db, await seedChannel(database.sql));
  }
  async function reload(id: number) {
    const [row] = await database.db.select().from(sp).where(eq(sp.id, id));
    return row;
  }
  async function attempt(id: number) {
    const [row] = await database.db.select().from(pj).where(eq(pj.id, id));
    return row;
  }
  async function results(attemptId: number) {
    return database.db
      .select()
      .from(schema.publicationResults)
      .where(eq(schema.publicationResults.publicationJobId, attemptId));
  }
  async function expireLease(id: number) {
    await database.db
      .update(sp)
      .set({ leaseExpiresAt: new Date(Date.now() - 1_000) })
      .where(eq(sp.id, id));
  }
  function claimOf(publication: typeof sp.$inferSelect) {
    return ledger.claim({
      publicationId: publication.id,
      expectedVersion: publication.updatedAt.toISOString(),
      expectedDispatchGeneration: publication.dispatchGeneration,
    });
  }

  it('lets exactly one of two concurrent claimers own the publication', async () => {
    const publication = await scheduled();
    const results = await Promise.all([
      claimOf(publication),
      claimOf(publication),
    ]);
    const winners = results.filter((result) => result !== null);

    expect(winners).toHaveLength(1);
    expect(await reload(publication.id)).toMatchObject({
      status: 'publishing',
      activeAttemptId: winners[0]!.attemptId,
      attemptCount: 1,
    });
    expect((await attempt(winners[0]!.attemptId)).status).toBe('processing');
  });

  it('claims a scheduled row still carrying a stale attempt pointer exactly once and fences the stale attempt', async () => {
    const publication = await scheduled();
    // Rollback residue: pre-32A code rescheduled an unknown row to scheduled
    // without clearing active_attempt_id.
    const [stale] = await database.db
      .insert(pj)
      .values({
        scheduledPublicationId: publication.id,
        status: 'unknown',
        attemptNumber: 1,
        providerRequestStartedAt: new Date(Date.now() - 60_000),
      })
      .returning();
    await database.db
      .update(sp)
      .set({ activeAttemptId: stale.id })
      .where(eq(sp.id, publication.id));
    const residue = await reload(publication.id);

    const claims = await Promise.all([claimOf(residue), claimOf(residue)]);
    const winners = claims.filter((claim) => claim !== null);

    expect(winners).toHaveLength(1);
    const winner = winners[0]!;
    expect(winner.attemptNumber).toBe(2);
    expect(await reload(publication.id)).toMatchObject({
      status: 'publishing',
      activeAttemptId: winner.attemptId,
    });

    const staleClaim = { ...winner, attemptId: stale.id, attemptNumber: 1 };
    await expect(
      ledger.markSideEffect(staleClaim, { operationType: 'x_create_post' }),
    ).rejects.toBeInstanceOf(LeaseLostError);
    await expect(
      ledger.recordSuccess(staleClaim, { postId: 'ghost' }),
    ).resolves.toBe(false);
    await expect(
      ledger.recordFailure(staleClaim, 'terminal', 'invalid_request', 'late'),
    ).resolves.toBe('ownership_lost');
    expect(await reload(publication.id)).toMatchObject({
      status: 'publishing',
      activeAttemptId: winner.attemptId,
    });
    expect((await attempt(winner.attemptId)).status).toBe('processing');
    expect((await attempt(stale.id)).status).toBe('unknown');
  });

  it('rejects a claim for a stale dispatch generation', async () => {
    const publication = await scheduled();
    await expect(
      ledger.claim({
        publicationId: publication.id,
        expectedVersion: publication.updatedAt.toISOString(),
        expectedDispatchGeneration: publication.dispatchGeneration + 1,
      }),
    ).resolves.toBeNull();
  });

  it('claims legacy jobs by version when no generation is supplied', async () => {
    const publication = await scheduled();
    await expect(
      ledger.claim({
        publicationId: publication.id,
        expectedVersion: new Date(0).toISOString(),
      }),
    ).resolves.toBeNull();
    await expect(
      ledger.claim({
        publicationId: publication.id,
        expectedVersion: publication.updatedAt.toISOString(),
      }),
    ).resolves.not.toBeNull();
  });

  it('records the request marker and checkpoint while the lease is held', async () => {
    const claim = (await claimOf(await scheduled()))!;
    await ledger.markSideEffect(claim, {
      operationType: 'instagram_media_publish',
      operationId: 'container-1',
      data: { step: 'publish' },
    });

    const row = await attempt(claim.attemptId);
    expect(row.providerRequestStartedAt).toBeInstanceOf(Date);
    expect(row.providerOperationType).toBe('instagram_media_publish');
    expect(row.providerOperationId).toBe('container-1');
    expect(row.providerCheckpoint).toEqual({ step: 'publish' });
  });

  it('refuses the marker once the lease has expired', async () => {
    const claim = (await claimOf(await scheduled()))!;
    await expireLease(claim.publicationId);

    await expect(
      ledger.markSideEffect(claim, { operationType: 'x_create_post' }),
    ).rejects.toBeInstanceOf(LeaseLostError);
    expect(
      (await attempt(claim.attemptId)).providerRequestStartedAt,
    ).toBeNull();
  });

  it('refuses the marker when a sweeper took the row while the marker waited for the lock', async () => {
    const claim = (await claimOf(await scheduled()))!;
    let markerOutcome: Promise<unknown> = Promise.resolve();

    await database.sql.begin(async (tx) => {
      await tx`select id from scheduled_publications where id = ${claim.publicationId} for update`;
      markerOutcome = ledger
        .markSideEffect(claim, { operationType: 'x_create_post' })
        .then(
          () => 'marked',
          (error: unknown) => error,
        );
      await new Promise((resolve) => setTimeout(resolve, 100));
      await tx`update scheduled_publications
               set status = 'scheduled', active_attempt_id = null, lease_expires_at = null
               where id = ${claim.publicationId}`;
    });

    expect(await markerOutcome).toBeInstanceOf(LeaseLostError);
  });

  it('re-arms an expired claim that never reached the provider, then fails it at the cap', async () => {
    const publication = await scheduled();
    const first = (await claimOf(publication))!;
    await expireLease(publication.id);

    expect(await ledger.sweepExpiredLeases()).toContainEqual(
      expect.objectContaining({
        publicationId: publication.id,
        outcome: 'retry_scheduled',
      }),
    );
    const rearmed = await reload(publication.id);
    expect(rearmed).toMatchObject({
      status: 'scheduled',
      activeAttemptId: null,
      dispatchGeneration: publication.dispatchGeneration + 1,
    });
    expect(rearmed.nextAttemptAt).toBeInstanceOf(Date);
    expect((await attempt(first.attemptId)).status).toBe('abandoned');

    const second = (await claimOf(rearmed))!;
    expect(second.attemptNumber).toBe(2);
    await expireLease(publication.id);
    await ledger.sweepExpiredLeases();
    expect((await reload(publication.id)).status).toBe('failed');
    expect(
      (await results(second.attemptId)).map((row) => row.errorType),
    ).toContain('retry_exhausted');
  });

  it('moves an expired claim with a request marker to unknown and never re-arms it', async () => {
    const claim = (await claimOf(await scheduled()))!;
    await ledger.markSideEffect(claim, { operationType: 'x_create_post' });
    await expireLease(claim.publicationId);

    await ledger.sweepExpiredLeases();
    await ledger.sweepExpiredLeases();

    expect(await reload(claim.publicationId)).toMatchObject({
      status: 'unknown',
      activeAttemptId: claim.attemptId,
    });
    expect((await attempt(claim.attemptId)).status).toBe('unknown');
  });

  it('publishes a late success from the attempt that went unknown', async () => {
    const claim = (await claimOf(await scheduled()))!;
    await ledger.markSideEffect(claim, { operationType: 'x_create_post' });
    await expireLease(claim.publicationId);
    await ledger.sweepExpiredLeases();

    await expect(
      ledger.recordSuccess(claim, {
        postId: 'post-1',
        url: 'https://x.com/i/web/status/post-1',
      }),
    ).resolves.toBe(true);
    expect((await reload(claim.publicationId)).status).toBe('published');
    expect((await attempt(claim.attemptId)).status).toBe('completed');
  });

  it('ignores writes from an attempt that no longer owns the publication', async () => {
    const publication = await scheduled();
    const stale = (await claimOf(publication))!;
    await expireLease(publication.id);
    await ledger.sweepExpiredLeases();
    const current = (await claimOf(await reload(publication.id)))!;

    await expect(
      ledger.recordSuccess(stale, { postId: 'ghost' }),
    ).resolves.toBe(false);
    await expect(
      ledger.recordFailure(stale, 'terminal', 'invalid_request', 'late'),
    ).resolves.toBe('ownership_lost');
    expect(await reload(publication.id)).toMatchObject({
      status: 'publishing',
      activeAttemptId: current.attemptId,
    });
    expect((await attempt(stale.attemptId)).status).toBe('abandoned');
    expect((await attempt(current.attemptId)).status).toBe('processing');
  });

  it('does not overwrite a publication that became published while the sweeper waited', async () => {
    const claim = (await claimOf(await scheduled()))!;
    await expireLease(claim.publicationId);
    let sweep: Promise<unknown> = Promise.resolve();

    await database.sql.begin(async (tx) => {
      await tx`select id from scheduled_publications where id = ${claim.publicationId} for update`;
      sweep = ledger.sweepExpiredLeases();
      await new Promise((resolve) => setTimeout(resolve, 100));
      await tx`update scheduled_publications set status = 'published' where id = ${claim.publicationId}`;
    });
    await sweep;

    expect((await reload(claim.publicationId)).status).toBe('published');
  });

  it('re-arms a retryable failure under a new generation and fails it at the cap', async () => {
    const publication = await scheduled();
    const first = (await claimOf(publication))!;

    await expect(
      ledger.recordFailure(first, 'retry', 'rate_limit', 'HTTP 429'),
    ).resolves.toBe('retry_scheduled');
    const rearmed = await reload(publication.id);
    expect(rearmed).toMatchObject({
      status: 'scheduled',
      activeAttemptId: null,
      dispatchGeneration: publication.dispatchGeneration + 1,
    });
    expect(rearmed.updatedAt.getTime()).not.toBe(
      publication.updatedAt.getTime(),
    );

    const second = (await claimOf(rearmed))!;
    await expect(
      ledger.recordFailure(second, 'retry', 'rate_limit', 'HTTP 429'),
    ).resolves.toBe('retry_exhausted');
    expect((await reload(publication.id)).status).toBe('failed');

    const attempts = await database.db
      .select()
      .from(pj)
      .where(eq(pj.scheduledPublicationId, publication.id))
      .orderBy(pj.attemptNumber);
    expect(attempts.map((row) => [row.attemptNumber, row.status])).toEqual([
      [1, 'failed'],
      [2, 'failed'],
    ]);
  });

  it('moves an unconfirmed outcome to unknown', async () => {
    const claim = (await claimOf(await scheduled()))!;
    await expect(
      ledger.recordFailure(claim, 'unknown', 'network_transient', 'reset'),
    ).resolves.toBe('unknown');
    expect(await reload(claim.publicationId)).toMatchObject({
      status: 'unknown',
      activeAttemptId: claim.attemptId,
    });
    expect((await attempt(claim.attemptId)).status).toBe('unknown');
  });

  it('counts the retry cap by attempt_count, not by dispatch generation', async () => {
    const publication = await createPublication(
      database.db,
      await seedChannel(database.sql),
      { dispatchGeneration: 9 },
    );
    const claim = (await claimOf(publication))!;
    expect(claim.attemptCount).toBe(1);
    await expect(
      ledger.recordFailure(claim, 'retry', 'rate_limit', 'HTTP 429'),
    ).resolves.toBe('retry_scheduled');
    expect((await reload(publication.id)).dispatchGeneration).toBe(10);
  });

  it('records a terminal failure from the owner', async () => {
    const claim = (await claimOf(await scheduled()))!;
    await expect(
      ledger.recordFailure(claim, 'terminal', 'invalid_request', 'bad media'),
    ).resolves.toBe('failed');
    expect(await reload(claim.publicationId)).toMatchObject({
      status: 'failed',
      leaseExpiresAt: null,
    });
    expect(await attempt(claim.attemptId)).toMatchObject({
      status: 'failed',
      errorClass: 'invalid_request',
    });
    expect(await results(claim.attemptId)).toEqual([
      expect.objectContaining({
        errorType: 'invalid_request',
        errorMessage: 'bad media',
      }),
    ]);
  });

  it('publishes from publishing and rolls up the variant and content item', async () => {
    const seeded = await seedChannel(database.sql);
    const [variant] = await database.db
      .insert(schema.contentVariants)
      .values({ contentItemId: seeded.contentItemId, content: 'Hello' })
      .returning();
    const publication = await createPublication(database.db, seeded, {
      variantId: variant.id,
    });
    const claim = (await claimOf(publication))!;

    await expect(
      ledger.recordSuccess(claim, { postId: 'p-1', url: 'https://x.test/p-1' }),
    ).resolves.toBe(true);

    expect(await reload(publication.id)).toMatchObject({
      status: 'published',
      leaseExpiresAt: null,
    });
    expect((await attempt(claim.attemptId)).status).toBe('completed');
    expect(await results(claim.attemptId)).toEqual([
      expect.objectContaining({
        platformPostId: 'p-1',
        platformPostUrl: 'https://x.test/p-1',
      }),
    ]);
    const [variantRow] = await database.db
      .select()
      .from(schema.contentVariants)
      .where(eq(schema.contentVariants.id, variant.id));
    expect(variantRow.status).toBe('published');
    expect(variantRow.publishedAt).toBeInstanceOf(Date);
    const [item] = await database.db
      .select()
      .from(schema.contentItems)
      .where(eq(schema.contentItems.id, seeded.contentItemId));
    expect(item.status).toBe('published');
  });

  it('does not publish the content item while a sibling publication is still scheduled', async () => {
    const seeded = await seedChannel(database.sql);
    const publication = await createPublication(database.db, seeded);
    await createPublication(database.db, seeded, {
      scheduledAt: new Date(Date.now() + 3_600_000),
    });
    const claim = (await claimOf(publication))!;

    await expect(ledger.recordSuccess(claim, { postId: 'p-2' })).resolves.toBe(
      true,
    );

    const [item] = await database.db
      .select()
      .from(schema.contentItems)
      .where(eq(schema.contentItems.id, seeded.contentItemId));
    expect(item.status).not.toBe('published');
  });

  it('does not complete an unknown attempt that no longer owns the publication', async () => {
    const claim = (await claimOf(await scheduled()))!;
    await ledger.markSideEffect(claim, { operationType: 'x_create_post' });
    await expireLease(claim.publicationId);
    await ledger.sweepExpiredLeases();
    const [other] = await database.db
      .insert(pj)
      .values({
        scheduledPublicationId: claim.publicationId,
        status: 'processing',
        attemptNumber: 2,
      })
      .returning();
    await database.db
      .update(sp)
      .set({ activeAttemptId: other.id })
      .where(eq(sp.id, claim.publicationId));

    await expect(
      ledger.recordSuccess(claim, { postId: 'orphan' }),
    ).resolves.toBe(false);

    expect((await attempt(claim.attemptId)).status).toBe('unknown');
    expect(await results(claim.attemptId)).toContainEqual(
      expect.objectContaining({ platformPostId: 'orphan' }),
    );
    expect(await reload(claim.publicationId)).toMatchObject({
      status: 'unknown',
      activeAttemptId: other.id,
    });
  });

  it('takes the publication lock before the attempt lock in recordSuccess', async () => {
    const claim = (await claimOf(await scheduled()))!;
    let success: Promise<boolean> = Promise.resolve(false);

    await database.sql.begin(async (tx) => {
      await tx`select id from scheduled_publications where id = ${claim.publicationId} for update`;
      success = ledger.recordSuccess(claim, { postId: 'lock-order' });
      await new Promise((resolve) => setTimeout(resolve, 100));
      // If recordSuccess had already locked the attempt row this would fail.
      await database.sql.begin(async (probe) => {
        await probe`select id from publication_jobs where id = ${claim.attemptId} for update nowait`;
      });
    });

    await expect(success).resolves.toBe(true);
  });

  it('locks the content item before the variant in recordSuccess', async () => {
    const seeded = await seedChannel(database.sql);
    const [variant] = await database.db
      .insert(schema.contentVariants)
      .values({ contentItemId: seeded.contentItemId, content: 'Hello' })
      .returning();
    const claim = (await claimOf(
      await createPublication(database.db, seeded, { variantId: variant.id }),
    ))!;
    let success: Promise<boolean> = Promise.resolve(false);

    await database.sql.begin(async (tx) => {
      await tx`select id from content_items where id = ${seeded.contentItemId} for update`;
      success = ledger.recordSuccess(claim, { postId: 'lock-order-2' });
      await new Promise((resolve) => setTimeout(resolve, 100));
      // SchedulingService locks content_items then content_variants; if
      // recordSuccess had already locked the variant this would fail.
      await database.sql.begin(async (probe) => {
        await probe`select id from content_variants where id = ${variant.id} for update nowait`;
      });
    });

    await expect(success).resolves.toBe(true);
  });

  it('keeps confirmed post evidence on an attempt that no longer owns the publication', async () => {
    const claim = (await claimOf(await scheduled()))!;
    await ledger.markSideEffect(claim, {
      operationType: 'x_create_post',
      data: { step: 'publish' },
    });
    await expireLease(claim.publicationId);
    await ledger.sweepExpiredLeases();

    await expect(
      ledger.recordFailure(claim, 'unknown', 'internal', 'db down', {
        platformPostId: 'live-1',
      }),
    ).resolves.toBe('ownership_lost');

    expect((await attempt(claim.attemptId)).providerCheckpoint).toEqual({
      step: 'publish',
      confirmedPlatformPostId: 'live-1',
      confirmedPlatformPostUrl: null,
    });
    expect(
      (await results(claim.attemptId)).map((row) => row.platformPostId),
    ).not.toContain('live-1');
  });

  it('survives a sweeper and a late success crossing on an expired marked lease', async () => {
    const claim = (await claimOf(await scheduled()))!;
    await ledger.markSideEffect(claim, { operationType: 'x_create_post' });
    await expireLease(claim.publicationId);
    let sweep: Promise<unknown> = Promise.resolve();
    let success: Promise<boolean> = Promise.resolve(false);

    await database.sql.begin(async (tx) => {
      await tx`select id from publication_jobs where id = ${claim.attemptId} for update`;
      // The sweeper locks the publication, then waits for the attempt row.
      sweep = ledger.sweepExpiredLeases();
      await new Promise((resolve) => setTimeout(resolve, 100));
      // The late success then queues behind the sweeper's publication lock.
      success = ledger.recordSuccess(claim, { postId: 'late' });
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    await sweep;
    await expect(success).resolves.toBe(true);
    expect(await reload(claim.publicationId)).toMatchObject({
      status: 'published',
      activeAttemptId: claim.attemptId,
    });
    expect((await attempt(claim.attemptId)).status).toBe('completed');
  });

  it('skips a sweep when the marker renewed the lease while the sweeper waited for the lock', async () => {
    const claim = (await claimOf(await scheduled()))!;
    await expireLease(claim.publicationId);
    let sweep: Promise<{ publicationId: number }[]> = Promise.resolve([]);

    await database.sql.begin(async (tx) => {
      await tx`select id from scheduled_publications where id = ${claim.publicationId} for update`;
      sweep = ledger.sweepExpiredLeases();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const renewed = new Date(Date.now() + 60_000).toISOString();
      const started = new Date().toISOString();
      await tx`update scheduled_publications set lease_expires_at = ${renewed} where id = ${claim.publicationId}`;
      await tx`update publication_jobs set provider_request_started_at = ${started} where id = ${claim.attemptId}`;
    });

    const decisions = await sweep;
    expect(
      decisions.filter((row) => row.publicationId === claim.publicationId),
    ).toEqual([]);
    expect((await reload(claim.publicationId)).status).toBe('publishing');
    expect((await attempt(claim.attemptId)).status).toBe('processing');
  });

  describe('32B-1: entering unknown, late success, rollups', () => {
    it('sets reconcile_after to now + grace when the outcome is unknown without local proof', async () => {
      const claim = (await claimOf(await scheduled()))!;
      await ledger.markSideEffect(claim, { operationType: 'test_create_post' });
      const before = Date.now();

      await ledger.recordFailure(claim, 'unknown', 'network_transient', 'socket hang up');

      const row = await reload(claim.publicationId);
      expect(row.status).toBe('unknown');
      expect(row.reconcileAfter!.getTime()).toBeGreaterThanOrEqual(before + 600_000);
      expect(row.reconcileAfter!.getTime()).toBeLessThanOrEqual(Date.now() + 600_000);
    });

    it('makes a provider-confirmed post id due immediately', async () => {
      const claim = (await claimOf(await scheduled()))!;
      await ledger.markSideEffect(claim, { operationType: 'test_create_post' });

      await ledger.recordFailure(claim, 'unknown', 'internal', 'write failed', {
        platformPostId: 'post-9',
      });

      const row = await reload(claim.publicationId);
      expect(row.status).toBe('unknown');
      expect(row.reconcileAfter!.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('sets reconcile_after when the sweeper finds a started request', async () => {
      const claim = (await claimOf(await scheduled()))!;
      await ledger.markSideEffect(claim, { operationType: 'test_create_post' });
      await expireLease(claim.publicationId);

      await ledger.sweepExpiredLeases();

      const row = await reload(claim.publicationId);
      expect(row.status).toBe('unknown');
      expect(row.reconcileAfter).not.toBeNull();
    });

    it('publishes a late success from needs_review and records it once (§6)', async () => {
      const seeded = await seedChannel(database.sql);
      const row = await createAmbiguousPublication(database.db, seeded, {
        status: 'needs_review',
        reconcileAfter: new Date(),
      });
      const claim = {
        publicationId: row.id,
        attemptId: row.activeAttemptId!,
        attemptNumber: 1,
        attemptCount: 1,
        dispatchGeneration: row.dispatchGeneration,
      };

      await expect(
        ledger.recordSuccess(claim, { postId: 'late-1', url: 'https://x.example/late-1' }),
      ).resolves.toBe(true);

      expect(await reload(row.id)).toMatchObject({ status: 'published', reconcileAfter: null });
      expect(await attempt(claim.attemptId)).toMatchObject({ status: 'completed' });
      expect(await reconciliationsOf(database.db, row.id)).toEqual([
        expect.objectContaining({
          source: 'automatic',
          outcome: 'confirmed_published',
          evidenceType: 'late_confirmed_post_id',
          platformPostId: 'late-1',
          attemptId: claim.attemptId,
          actorUserId: null,
        }),
      ]);
      expect(await auditActions(database.sql, row.id)).toEqual([
        'publication.reconciled_published',
      ]);
    });

    it('keeps an operator decision when the late success arrives afterwards', async () => {
      for (const status of ['cancelled', 'scheduled'] as const) {
        const seeded = await seedChannel(database.sql);
        const row = await createAmbiguousPublication(database.db, seeded, {
          status: 'needs_review',
        });
        await database.db
          .update(sp)
          .set({ status, activeAttemptId: status === 'scheduled' ? null : row.activeAttemptId })
          .where(eq(sp.id, row.id));
        const claim = {
          publicationId: row.id,
          attemptId: row.activeAttemptId!,
          attemptNumber: 1,
          attemptCount: 1,
          dispatchGeneration: row.dispatchGeneration,
        };

        await expect(ledger.recordSuccess(claim, { postId: `late-${status}` })).resolves.toBe(false);

        expect((await reload(row.id)).status).toBe(status);
        expect(await results(claim.attemptId)).toEqual([
          expect.objectContaining({ platformPostId: `late-${status}` }),
        ]);
        expect(await reconciliationsOf(database.db, row.id)).toEqual([]);
      }
    });

    it('completes the attempt without a second result when reconciliation already published its post', async () => {
      const seeded = await seedChannel(database.sql);
      const row = await createAmbiguousPublication(database.db, seeded, {
        status: 'unknown',
        attempt: { postIds: ['same-1'] },
      });
      // What an accepted reconciliation leaves: published, still owned by the attempt.
      await database.db
        .update(sp)
        .set({ status: 'published', reconcileAfter: null })
        .where(eq(sp.id, row.id));
      const claim = {
        publicationId: row.id,
        attemptId: row.activeAttemptId!,
        attemptNumber: 1,
        attemptCount: 1,
        dispatchGeneration: row.dispatchGeneration,
      };

      await expect(ledger.recordSuccess(claim, { postId: 'same-1' })).resolves.toBe(true);

      expect((await reload(row.id)).status).toBe('published');
      expect(await attempt(claim.attemptId)).toMatchObject({ status: 'completed' });
      expect(await results(claim.attemptId)).toHaveLength(1);
      expect(await reconciliationsOf(database.db, row.id)).toEqual([]);
      expect(await auditActions(database.sql, row.id)).toEqual([]);
    });

    it('rolls a content item up to published when sibling publications succeed concurrently', async () => {
      for (let round = 0; round < 10; round += 1) {
        const seeded = await seedChannel(database.sql);
        const first = await createPublication(database.db, seeded, {
          scheduledAt: new Date(Date.now() - 60_000),
        });
        const second = await createPublication(database.db, seeded, {
          scheduledAt: new Date(Date.now() - 120_000),
        });
        const claims = [(await claimOf(first))!, (await claimOf(second))!];

        await Promise.all(
          claims.map((claim, index) =>
            ledger.recordSuccess(claim, { postId: `sibling-${round}-${index}` }),
          ),
        );

        const [content] = await database.db
          .select()
          .from(schema.contentItems)
          .where(eq(schema.contentItems.id, seeded.contentItemId));
        expect(content!.status).toBe('published');
      }
    });
  });
});
