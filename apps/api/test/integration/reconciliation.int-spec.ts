import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '../../src/db/schema.js';
import type {
  PublicationLookup,
  SocialPublisherPort,
} from '../../src/modules/channels/ports/SocialPublisherPort.js';
import type { ChannelCredentialService } from '../../src/modules/channels/channel-credential.service.js';
import { createTestDatabase, type TestDatabase } from './test-database.js';
import {
  auditActions,
  createAmbiguousPublication,
  reconciliationsOf,
  seedChannel,
} from './seed.js';
import { buildReconciler, deferred, lookupAdapter } from './publishing-support.js';

const sp = schema.scheduledPublications;
const pj = schema.publicationJobs;
const pr = schema.publicationResults;
const past = () => new Date(Date.now() - 1_000);
const PUBLISHED: PublicationLookup = {
  kind: 'confirmed',
  evidenceType: 'instagram_container_published',
};
const NOT_PUBLISHED: PublicationLookup = {
  kind: 'inconclusive',
  reason: 'container_not_published',
};
const never = lookupAdapter(async () => {
  throw new Error('lookup must not be called');
});

describe('automatic reconciliation (32B-1 §4)', () => {
  let database: TestDatabase;

  beforeEach(async () => {
    database = await createTestDatabase();
  });
  afterEach(async () => {
    await database.drop();
  });

  const reload = async (id: number) =>
    (await database.db.select().from(sp).where(eq(sp.id, id)))[0]!;
  const jobOf = async (id: number) =>
    (await database.db.select().from(pj).where(eq(pj.id, id)))[0]!;
  const resultsOf = (attemptId: number) =>
    database.db.select().from(pr).where(eq(pr.publicationJobId, attemptId));
  async function ambiguous(
    options: Parameters<typeof createAmbiguousPublication>[2],
  ) {
    return createAmbiguousPublication(
      database.db,
      await seedChannel(database.sql, 'instagram'),
      options,
    );
  }

  it('publishes an unknown row with a confirmed id in its checkpoint, without a provider call', async () => {
    const row = await ambiguous({
      status: 'unknown',
      reconcileAfter: past(),
      attempt: {
        checkpoint: {
          confirmedPlatformPostId: 'ig-77',
          confirmedPlatformPostUrl: 'https://instagram.example/p/77',
        },
      },
    });

    const summary = await buildReconciler(database.db, never).service.reconcileDue();

    expect(summary.results).toEqual([
      { publicationId: row.id, outcome: 'published', evidenceType: 'confirmed_post_id' },
    ]);
    expect(await reload(row.id)).toMatchObject({ status: 'published', reconcileAfter: null });
    expect(await jobOf(row.activeAttemptId!)).toMatchObject({ status: 'unknown' }); // R3
    expect(await resultsOf(row.activeAttemptId!)).toEqual([
      expect.objectContaining({
        platformPostId: 'ig-77',
        platformPostUrl: 'https://instagram.example/p/77',
      }),
    ]);
    expect(await reconciliationsOf(database.db, row.id)).toEqual([
      expect.objectContaining({
        source: 'automatic',
        outcome: 'confirmed_published',
        evidenceType: 'confirmed_post_id',
        platformPostId: 'ig-77',
        actorUserId: null,
      }),
    ]);
    expect(await auditActions(database.sql, row.id)).toEqual([
      'publication.reconciled_published',
    ]);
  });

  it('reuses an existing result post id instead of inserting a duplicate', async () => {
    const row = await ambiguous({
      status: 'unknown',
      reconcileAfter: past(),
      attempt: { postIds: ['ig-1'] },
    });

    await buildReconciler(database.db, never).service.reconcileDue();

    expect((await reload(row.id)).status).toBe('published');
    expect(await resultsOf(row.activeAttemptId!)).toHaveLength(1);
    expect(await reconciliationsOf(database.db, row.id)).toEqual([
      expect.objectContaining({
        evidenceType: 'existing_result_post_id',
        platformPostId: 'ig-1',
      }),
    ]);
  });

  it('resolves historical duplicates with the latest id and records every distinct id', async () => {
    const row = await ambiguous({
      status: 'unknown',
      reconcileAfter: past(),
      attempt: { postIds: ['ig-old'] },
    });
    const [second] = await database.db
      .insert(pj)
      .values({ scheduledPublicationId: row.id, status: 'unknown', attemptNumber: 2, attempts: 2 })
      .returning();
    await database.db.insert(pr).values({ publicationJobId: second!.id, platformPostId: 'ig-new' });

    await buildReconciler(database.db, never).service.reconcileDue();

    const [entry] = await reconciliationsOf(database.db, row.id);
    expect(entry).toMatchObject({
      outcome: 'confirmed_published',
      platformPostId: 'ig-new',
      attemptId: second!.id,
    });
    expect([...(entry!.evidence.duplicatePlatformPostIds ?? [])].sort()).toEqual([
      'ig-new',
      'ig-old',
    ]);
  });

  it('publishes on an exact Instagram PUBLISHED without inventing a post id', async () => {
    const row = await ambiguous({ status: 'unknown', reconcileAfter: past() });
    const calls: unknown[] = [];
    const adapter = lookupAdapter(async (attempt) => {
      calls.push(attempt);
      return PUBLISHED;
    });

    await buildReconciler(database.db, adapter).service.reconcileDue();

    expect(calls).toEqual([
      { operationType: 'instagram_media_publish', operationId: 'container-1' },
    ]);
    expect((await reload(row.id)).status).toBe('published');
    expect(await resultsOf(row.activeAttemptId!)).toEqual([]);
    expect(await reconciliationsOf(database.db, row.id)).toEqual([
      expect.objectContaining({
        evidenceType: 'instagram_container_published',
        platformPostId: null,
      }),
    ]);
  });

  async function expectEscalatesAfterGrace(
    lookup: NonNullable<SocialPublisherPort['lookupPublication']>,
    reason: string,
    credentials?: Partial<ChannelCredentialService>,
  ) {
    const row = await ambiguous({
      status: 'unknown',
      reconcileAfter: new Date(Date.now() + 600_000),
    });
    const { service } = buildReconciler(database.db, lookupAdapter(lookup), {
      config: { reconcileLookupBudgetMs: 50 },
      credentials,
    });

    expect((await service.reconcileDue()).selected).toBe(0); // still inside grace
    expect((await reload(row.id)).status).toBe('unknown');

    await database.db.update(sp).set({ reconcileAfter: past() }).where(eq(sp.id, row.id));
    const before = await reload(row.id);
    const summary = await service.reconcileDue();

    expect(summary.results).toEqual([
      { publicationId: row.id, outcome: 'needs_review', evidenceType: reason },
    ]);
    expect(await reload(row.id)).toMatchObject({
      status: 'needs_review',
      reconcileAfter: null,
      dispatchGeneration: before.dispatchGeneration,
      activeAttemptId: before.activeAttemptId,
      attemptCount: before.attemptCount,
    });
    expect(await jobOf(row.activeAttemptId!)).toMatchObject({ status: 'unknown' });
    expect(await reconciliationsOf(database.db, row.id)).toEqual([
      expect.objectContaining({ outcome: 'inconclusive', evidenceType: reason }),
    ]);
    expect(await auditActions(database.sql, row.id)).toEqual([
      'publication.reconciliation_escalated',
    ]);
  }

  it('escalates Instagram FINISHED to needs_review only after grace', () =>
    expectEscalatesAfterGrace(async () => NOT_PUBLISHED, 'container_not_published'));

  it('escalates a failing lookup only after grace', () =>
    expectEscalatesAfterGrace(async () => {
      throw new Error('socket hang up');
    }, 'lookup_failed'));

  it('escalates a lookup that exceeds its budget', () =>
    expectEscalatesAfterGrace(
      (_attempt, _token, signal) =>
        new Promise<PublicationLookup>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason));
        }),
      'lookup_failed',
    ));

  it('escalates a disconnected channel without calling the provider', () =>
    expectEscalatesAfterGrace(
      async () => {
        throw new Error('lookup must not be called');
      },
      'credentials_unavailable',
      {
        getValidAccessToken: async () => {
          throw new Error('Connected channel is unavailable');
        },
      },
    ));

  it('gives needs_review exactly one inconclusive pass (R7)', async () => {
    const row = await ambiguous({ status: 'needs_review', reconcileAfter: past() });
    let lookups = 0;
    const { service } = buildReconciler(
      database.db,
      lookupAdapter(async () => {
        lookups += 1;
        return NOT_PUBLISHED;
      }),
    );

    expect((await service.reconcileDue()).results).toEqual([
      { publicationId: row.id, outcome: 'needs_review', evidenceType: 'container_not_published' },
    ]);
    for (let poll = 0; poll < 3; poll += 1) {
      expect((await service.reconcileDue()).selected).toBe(0);
    }

    expect(lookups).toBe(1);
    expect(await reload(row.id)).toMatchObject({ status: 'needs_review', reconcileAfter: null });
    expect(await reconciliationsOf(database.db, row.id)).toHaveLength(1);
    expect(await auditActions(database.sql, row.id)).toEqual([
      'publication.reconciliation_inconclusive',
    ]);
  });

  it('lets concurrent reconcilers look up twice but transition once (R2)', async () => {
    const row = await ambiguous({ status: 'unknown', reconcileAfter: past() });
    const bothLookedUp = deferred();
    let lookups = 0;
    const adapter = lookupAdapter(async () => {
      lookups += 1;
      if (lookups === 2) bothLookedUp.resolve();
      await bothLookedUp.promise;
      return PUBLISHED;
    });
    const first = buildReconciler(database.db, adapter).service;
    const second = buildReconciler(database.db, adapter).service;

    const summaries = await Promise.all([first.reconcileDue(), second.reconcileDue()]);

    expect(lookups).toBe(2);
    expect(
      summaries.flatMap((summary) => summary.results.map((result) => result.outcome)).sort(),
    ).toEqual(['lost', 'published']);
    expect(await reconciliationsOf(database.db, row.id)).toHaveLength(1);
    expect(await auditActions(database.sql, row.id)).toEqual([
      'publication.reconciled_published',
    ]);
  });

  it("never duplicates the success result when reconciliation races the same attempt's late success", async () => {
    for (let round = 0; round < 10; round += 1) {
      const postId = `race-${round}`;
      const url = `https://instagram.example/p/${postId}`;
      const row = await ambiguous({
        status: 'unknown',
        reconcileAfter: past(),
        attempt: {
          checkpoint: { confirmedPlatformPostId: postId, confirmedPlatformPostUrl: url },
        },
      });
      const { service, ledger } = buildReconciler(database.db, never);
      const claim = {
        publicationId: row.id,
        attemptId: row.activeAttemptId!,
        attemptNumber: 1,
        attemptCount: 1,
        dispatchGeneration: row.dispatchGeneration,
      };

      const [, late] = await Promise.all([
        service.reconcileDue(),
        ledger.recordSuccess(claim, { postId, url }),
      ]);

      // The same outcome whichever transaction commits first.
      expect(late).toBe(true);
      expect(await reload(row.id)).toMatchObject({ status: 'published', reconcileAfter: null });
      expect(await jobOf(row.activeAttemptId!)).toMatchObject({ status: 'completed' });
      expect(
        (await resultsOf(row.activeAttemptId!)).filter(
          (result) => result.platformPostId === postId,
        ),
      ).toHaveLength(1);
      expect(await reconciliationsOf(database.db, row.id)).toHaveLength(1);
      expect(await auditActions(database.sql, row.id)).toEqual([
        'publication.reconciled_published',
      ]);
    }
  });

  it('escalates an unknown row with no attempt without creating one (R8)', async () => {
    const row = await ambiguous({ status: 'unknown', reconcileAfter: past(), attempt: null });

    await buildReconciler(database.db, never).service.reconcileDue();

    expect((await reload(row.id)).status).toBe('needs_review');
    expect(
      await database.db.select().from(pj).where(eq(pj.scheduledPublicationId, row.id)),
    ).toEqual([]);
    expect(await reconciliationsOf(database.db, row.id)).toEqual([
      expect.objectContaining({ attemptId: null, evidenceType: 'lookup_unavailable' }),
    ]);
  });

  it('rolls the transition back when the audit event cannot be written (R5)', async () => {
    const row = await ambiguous({
      status: 'unknown',
      reconcileAfter: past(),
      attempt: { postIds: ['ig-5'] },
    });
    const { service } = buildReconciler(database.db, never, {
      audit: {
        enqueue: async () => {
          throw new Error('audit unavailable');
        },
      },
    });

    const summary = await service.reconcileDue();

    expect(summary.results).toEqual([
      { publicationId: row.id, outcome: 'error', evidenceType: null },
    ]);
    const after = await reload(row.id);
    expect(after.status).toBe('unknown');
    expect(after.reconcileAfter).not.toBeNull();
    expect(await reconciliationsOf(database.db, row.id)).toEqual([]);
  });

  it('recovers null reconcile_after unknown rows after grace and never selects null needs_review (§4.1)', async () => {
    const fresh = await ambiguous({ status: 'unknown', reconcileAfter: null });
    const stale = await ambiguous({
      status: 'unknown',
      reconcileAfter: null,
      updatedAt: new Date(Date.now() - 601_000),
    });
    const frozen = await ambiguous({
      status: 'needs_review',
      reconcileAfter: null,
      updatedAt: new Date(Date.now() - 86_400_000),
    });
    const { service } = buildReconciler(database.db, lookupAdapter(async () => NOT_PUBLISHED));

    const summary = await service.reconcileDue();

    expect(summary.results.map((result) => result.publicationId)).toEqual([stale.id]);
    expect(await reload(stale.id)).toMatchObject({ status: 'needs_review', reconcileAfter: null });
    expect((await service.reconcileDue()).selected).toBe(0);
    expect((await reload(fresh.id)).status).toBe('unknown');
    expect((await reload(frozen.id)).status).toBe('needs_review');
  });

  it('refuses a confirmation when the active attempt changed after observation', async () => {
    const row = await ambiguous({ status: 'unknown', reconcileAfter: past() });
    const { ledger } = buildReconciler(database.db, never);

    await expect(
      ledger.reconcile(
        {
          publicationId: row.id,
          status: 'unknown',
          reconcileAfter: row.reconcileAfter,
          activeAttemptId: row.activeAttemptId! + 1_000,
        },
        {
          kind: 'confirmed',
          evidenceType: 'instagram_container_published',
          attemptId: row.activeAttemptId!,
          platformPostId: null,
          platformPostUrl: null,
          duplicatePlatformPostIds: [],
        },
      ),
    ).resolves.toBeNull();
    expect((await reload(row.id)).status).toBe('unknown');
    expect(await reconciliationsOf(database.db, row.id)).toEqual([]);
  });
});

describe('legacy rows after migration 008 (Review Focus 1)', () => {
  it('publishes a legacy needs_review row that already holds a post id on the first pass', async () => {
    const legacy = await createTestDatabase({ migrate: false });
    try {
      const seeded = await seedChannel(legacy.sql, 'instagram');
      const [publication] = await legacy.sql<{ id: number }[]>`
        insert into scheduled_publications (content_item_id, workspace_id, social_account_id, scheduled_at, status)
        values (${seeded.contentItemId}, ${seeded.workspaceId}, ${seeded.socialAccountId}, now(), 'failed')
        returning id`;
      const [job] = await legacy.sql<{ id: number }[]>`
        insert into publication_jobs (scheduled_publication_id, status, attempts)
        values (${publication!.id}, 'failed', 1) returning id`;
      await legacy.sql`
        insert into publication_results (publication_job_id, platform_post_id)
        values (${job!.id}, 'legacy-post')`;
      // 007 turns it into needs_review; 008 backfills reconcile_after with microseconds.
      await legacy.applyPostBaselineMigrations();

      const summary = await buildReconciler(legacy.db, never).service.reconcileDue();

      expect(summary.results).toEqual([
        {
          publicationId: publication!.id,
          outcome: 'published',
          evidenceType: 'existing_result_post_id',
        },
      ]);
      expect(await auditActions(legacy.sql, publication!.id)).toEqual([
        'publication.reconciled_published',
      ]);
    } finally {
      await legacy.drop();
    }
  });
});
