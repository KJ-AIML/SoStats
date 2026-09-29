import { NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { ProviderPublishError } from '../../src/modules/channels/ports/SocialPublisherPort.js';
import { createTestDatabase, type TestDatabase } from './test-database.js';
import { createPublication, seedChannel } from './seed.js';
import {
  buildPublishing,
  deferred,
  ScriptedAdapter,
} from './publishing-support.js';

const sp = schema.scheduledPublications;
const pj = schema.publicationJobs;

describe('PublishingService.execute', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.drop();
  });

  async function scheduled(overrides: Partial<typeof sp.$inferInsert> = {}) {
    return createPublication(
      database.db,
      await seedChannel(database.sql),
      overrides,
    );
  }
  async function reload(id: number) {
    const [row] = await database.db.select().from(sp).where(eq(sp.id, id));
    return row;
  }
  async function attempts(id: number) {
    return database.db
      .select()
      .from(pj)
      .where(eq(pj.scheduledPublicationId, id))
      .orderBy(pj.attemptNumber);
  }
  const request = (publication: typeof sp.$inferSelect) => ({
    expectedVersion: publication.updatedAt.toISOString(),
    expectedDispatchGeneration: publication.dispatchGeneration,
  });
  async function expireLease(id: number) {
    await database.db
      .update(sp)
      .set({ leaseExpiresAt: new Date(Date.now() - 1_000) })
      .where(eq(sp.id, id));
  }

  it('publishes once and records a completed attempt with a request marker', async () => {
    const adapter = new ScriptedAdapter(async (context, self) => {
      await self.send(context);
      return { postId: 'post-1', url: 'https://x.com/i/web/status/post-1' };
    });
    const { service, audit } = buildPublishing(database.db, adapter);
    const publication = await scheduled();

    await expect(
      service.execute(publication.id, request(publication)),
    ).resolves.toMatchObject({
      status: 'published',
      platformPostId: 'post-1',
    });
    const [attempt] = await attempts(publication.id);
    expect(attempt.status).toBe('completed');
    expect(attempt.providerRequestStartedAt).toBeInstanceOf(Date);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'publication.published' }),
    );
  });

  it('runs the adapter once when the same generation is executed concurrently', async () => {
    const gate = deferred();
    const adapter = new ScriptedAdapter(async (context, self) => {
      await gate.promise;
      await self.send(context);
      return { postId: 'post-2' };
    });
    const { service } = buildPublishing(database.db, adapter);
    const publication = await scheduled();

    const executions = [
      service.execute(publication.id, request(publication)),
      service.execute(publication.id, request(publication)),
    ];
    // The claimer is parked on the gate, so the first to settle is the loser.
    const loser = await Promise.race(executions);
    expect(['in_progress', 'stale']).toContain(loser.status);
    gate.resolve();

    const statuses = (await Promise.all(executions)).map(
      (result) => result.status,
    );
    expect(statuses).toContain('published');
    expect(adapter.calls).toBe(1);
  });

  it('re-arms an adapter-declared retry under a new generation; the old job is stale', async () => {
    const adapter = new ScriptedAdapter(async (context, self) => {
      await self.send(context);
      throw new ProviderPublishError('HTTP 429', {
        retryable: true,
        errorClass: 'rate_limit',
        statusCode: 429,
      });
    });
    const { service } = buildPublishing(database.db, adapter);
    const publication = await scheduled();

    await expect(
      service.execute(publication.id, request(publication)),
    ).resolves.toMatchObject({
      status: 'retry_scheduled',
    });
    const rearmed = await reload(publication.id);
    expect(rearmed.dispatchGeneration).toBe(publication.dispatchGeneration + 1);
    expect(rearmed.nextAttemptAt).toBeInstanceOf(Date);
    expect(rearmed.updatedAt.getTime()).toBeGreaterThan(
      publication.updatedAt.getTime(),
    );
    // A legacy job (no generation) carrying the old version is stale.
    await expect(
      service.execute(publication.id, {
        expectedVersion: publication.updatedAt.toISOString(),
      }),
    ).resolves.toMatchObject({ status: 'stale' });
    await expect(
      service.execute(publication.id, request(publication)),
    ).resolves.toMatchObject({
      status: 'stale',
    });
    expect(adapter.calls).toBe(1);
  });

  it('moves an adapter-declared unknown outcome to unknown and never runs it again', async () => {
    const adapter = new ScriptedAdapter(async (context, self) => {
      await self.send(context);
      throw new ProviderPublishError('reset', {
        outcomeUnknown: true,
        errorClass: 'network_transient',
      });
    });
    const { service, audit } = buildPublishing(database.db, adapter);
    const publication = await scheduled();

    await expect(
      service.execute(publication.id, request(publication)),
    ).resolves.toMatchObject({
      status: 'outcome_unknown',
    });
    await expect(
      service.execute(publication.id, request(publication)),
    ).resolves.toMatchObject({
      status: 'outcome_unknown',
    });
    expect(adapter.calls).toBe(1);
    expect(audit.record).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'publication.outcome_unknown' }),
    );
  });

  it('treats an internal error after the marker as unknown', async () => {
    const adapter = new ScriptedAdapter(async (context, self) => {
      await self.send(context);
      throw new TypeError('bug after the request');
    });
    const { service } = buildPublishing(database.db, adapter);
    const publication = await scheduled();

    await expect(
      service.execute(publication.id, request(publication)),
    ).resolves.toMatchObject({
      status: 'outcome_unknown',
    });
  });

  it('retries an internal error before the marker', async () => {
    const adapter = new ScriptedAdapter(async () => {
      throw new TypeError('bug before the request');
    });
    const { service } = buildPublishing(database.db, adapter);
    const publication = await scheduled();

    await expect(
      service.execute(publication.id, request(publication)),
    ).resolves.toMatchObject({
      status: 'retry_scheduled',
    });
  });

  it('fails without retry when channel credentials are unusable (Review Focus 1)', async () => {
    const adapter = new ScriptedAdapter(async () => ({ postId: 'never' }));
    const { service } = buildPublishing(database.db, adapter, {
      credentials: {
        getValidAccessToken: async () => {
          throw new ProviderPublishError('disconnected', {
            errorClass: 'authentication',
          });
        },
      },
    });
    const publication = await scheduled();

    await expect(
      service.execute(publication.id, request(publication)),
    ).resolves.toMatchObject({
      status: 'failed_terminal',
    });
    expect((await reload(publication.id)).status).toBe('failed');
    expect(adapter.calls).toBe(0);
  });

  it('fails without retry when media disappeared (Review Focus 2)', async () => {
    const adapter = new ScriptedAdapter(async () => ({ postId: 'never' }));
    const { service } = buildPublishing(database.db, adapter, {
      media: {
        getProviderPublishMedia: async () => {
          throw new NotFoundException('asset deleted');
        },
      },
    });
    const publication = await scheduled();

    await expect(
      service.execute(publication.id, request(publication)),
    ).resolves.toMatchObject({
      status: 'failed_terminal',
    });
    const [attempt] = await attempts(publication.id);
    expect(attempt.errorClass).toBe('invalid_request');
  });

  it('sends nothing when the lease was lost before the side effect', async () => {
    const reachedAdapter = deferred();
    const gate = deferred();
    const adapter = new ScriptedAdapter(async (context, self) => {
      reachedAdapter.resolve();
      await gate.promise;
      await self.send(context);
      return { postId: 'never' };
    });
    const { service } = buildPublishing(database.db, adapter);
    const publication = await scheduled();

    const pending = service.execute(publication.id, request(publication));
    await reachedAdapter.promise;
    await expireLease(publication.id);
    await service.listDispatchable();
    gate.resolve();

    await expect(pending).resolves.toMatchObject({ status: 'in_progress' });
    expect(adapter.sent).toBe(0);
    expect(await reload(publication.id)).toMatchObject({
      status: 'scheduled',
      dispatchGeneration: publication.dispatchGeneration + 1,
    });
    expect((await attempts(publication.id))[0].status).toBe('abandoned');
  });

  it('publishes a late success after the sweeper moved it to unknown', async () => {
    const marked = deferred();
    const gate = deferred();
    const adapter = new ScriptedAdapter(async (context, self) => {
      await self.send(context);
      marked.resolve();
      await gate.promise;
      return { postId: 'late-1' };
    });
    const { service } = buildPublishing(database.db, adapter);
    const publication = await scheduled();

    const pending = service.execute(publication.id, request(publication));
    await marked.promise;
    await expireLease(publication.id);
    await service.listDispatchable();
    expect((await reload(publication.id)).status).toBe('unknown');
    gate.resolve();

    await expect(pending).resolves.toMatchObject({ status: 'published' });
    expect((await reload(publication.id)).status).toBe('published');
  });

  it('stops at the retry cap with a known failure', async () => {
    const adapter = new ScriptedAdapter(async () => {
      throw new ProviderPublishError('HTTP 503 before send', {
        retryable: true,
        errorClass: 'transient_provider',
      });
    });
    const { service } = buildPublishing(database.db, adapter, {
      config: { maxAttempts: 2 },
    });
    const publication = await scheduled();

    await service.execute(publication.id, request(publication));
    const rearmed = await reload(publication.id);
    await database.db
      .update(sp)
      .set({ nextAttemptAt: null })
      .where(eq(sp.id, publication.id));
    await expect(
      service.execute(publication.id, request(rearmed)),
    ).resolves.toMatchObject({
      status: 'failed_terminal',
    });
    expect((await reload(publication.id)).status).toBe('failed');
  });

  it('treats an adapter declaring unknown without a marker as unknown (contract violation)', async () => {
    const adapter = new ScriptedAdapter(async () => {
      throw new ProviderPublishError('lost', { outcomeUnknown: true });
    });
    const { service } = buildPublishing(database.db, adapter);
    const publication = await scheduled();

    await expect(
      service.execute(publication.id, request(publication)),
    ).resolves.toMatchObject({
      status: 'outcome_unknown',
    });
  });

  it('lists only due publications with their dispatch generation', async () => {
    const { service } = buildPublishing(
      database.db,
      new ScriptedAdapter(async () => ({ postId: 'x' })),
    );
    const later = await scheduled({
      nextAttemptAt: new Date(Date.now() + 10 * 60_000),
    });

    const defaultHorizon = await service.listDispatchable(undefined, 0, 500);
    expect(defaultHorizon.map((row) => row.id)).not.toContain(later.id);

    const wide = await service.listDispatchable(
      new Date(Date.now() + 20 * 60_000).toISOString(),
      0,
      500,
    );
    expect(wide).toContainEqual(
      expect.objectContaining({
        id: later.id,
        dispatchGeneration: later.dispatchGeneration,
      }),
    );
  });

  it('makes the legacy dead-letter endpoint a no-op', async () => {
    const { service } = buildPublishing(
      database.db,
      new ScriptedAdapter(async () => ({ postId: 'x' })),
    );
    const publication = await scheduled();

    await expect(service.deadLetter(publication.id)).resolves.toEqual({
      status: 'scheduled',
      scheduledPublicationId: publication.id,
    });
    expect((await reload(publication.id)).status).toBe('scheduled');
  });

  it.each([
    ['calls the marker', true],
    ['never calls the marker', false],
  ])(
    'records unknown, never a retry, when the success write fails and the adapter %s',
    async (_label, callsMarker) => {
      const adapter = new ScriptedAdapter(async (context, self) => {
        if (callsMarker) await self.send(context);
        return { postId: 'landed' };
      });
      const { service, ledger } = buildPublishing(database.db, adapter);
      vi.spyOn(ledger, 'recordSuccess').mockRejectedValueOnce(
        new Error('db down'),
      );
      const publication = await scheduled();

      await expect(
        service.execute(publication.id, request(publication)),
      ).resolves.toMatchObject({ status: 'outcome_unknown' });
      expect((await reload(publication.id)).status).toBe('unknown');
      expect(adapter.calls).toBe(1);
    },
  );

  it('keeps the published outcome when the audit write rejects', async () => {
    const adapter = new ScriptedAdapter(async (context, self) => {
      await self.send(context);
      return { postId: 'audited' };
    });
    const { service, audit } = buildPublishing(database.db, adapter);
    audit.record.mockRejectedValue(new Error('audit down'));
    const publication = await scheduled();

    await expect(
      service.execute(publication.id, request(publication)),
    ).resolves.toMatchObject({ status: 'published' });
    expect((await reload(publication.id)).status).toBe('published');
    expect(audit.record).toHaveBeenCalled();
  });

  it.each([
    'scheduled',
    'publishing',
    'unknown',
    'failed',
    'published',
    'cancelled',
  ] as const)(
    'dead-letter leaves a %s publication unchanged',
    async (status) => {
      const { service, ledger } = buildPublishing(
        database.db,
        new ScriptedAdapter(async () => ({ postId: 'x' })),
      );
      const publication = await scheduled(
        status === 'publishing' ? {} : { status },
      );
      if (status === 'publishing') {
        const claim = await ledger.claim({
          publicationId: publication.id,
          expectedVersion: publication.updatedAt.toISOString(),
          expectedDispatchGeneration: publication.dispatchGeneration,
        });
        expect(claim).not.toBeNull();
      }
      const before = await reload(publication.id);

      await expect(service.deadLetter(publication.id)).resolves.toEqual({
        status,
        scheduledPublicationId: publication.id,
      });
      expect(await reload(publication.id)).toEqual(before);
    },
  );

  it('returns stale before the status decision', async () => {
    const { service } = buildPublishing(
      database.db,
      new ScriptedAdapter(async () => ({ postId: 'x' })),
    );
    const publication = await scheduled({ status: 'failed' });

    await expect(
      service.execute(publication.id, {
        expectedVersion: publication.updatedAt.toISOString(),
        expectedDispatchGeneration: publication.dispatchGeneration + 1,
      }),
    ).resolves.toMatchObject({ status: 'stale' });
  });
});
