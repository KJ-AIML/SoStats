import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '../../src/db/schema.js';
import { PublicationLedger } from '../../src/modules/publishing/publication-ledger.js';
import { LeaseLostError } from '../../src/modules/publishing/publication-outcome.js';
import { loadPublishingConfig } from '../../src/modules/publishing/publishing.config.js';
import { createTestDatabase, type TestDatabase } from './test-database.js';
import { createPublication, seedChannel } from './seed.js';

const sp = schema.scheduledPublications;
const pj = schema.publicationJobs;

describe('PublicationLedger', () => {
  let database: TestDatabase;
  let ledger: PublicationLedger;

  beforeAll(async () => {
    database = await createTestDatabase();
    ledger = new PublicationLedger(database.db, {
      ...loadPublishingConfig({}),
      maxAttempts: 2,
    });
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
  });
});
