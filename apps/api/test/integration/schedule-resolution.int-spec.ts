import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../src/db/schema.js';
import type { AuditLogService } from '../../src/common/audit/audit-log.service.js';
import { WorkspaceAccessService } from '../../src/common/workspace/workspace-access.service.js';
import type { MediaService } from '../../src/modules/media/media.service.js';
import type { ProviderRegistry } from '../../src/modules/channels/ProviderRegistry.js';
import { PublicationLedger } from '../../src/modules/publishing/publication-ledger.js';
import { loadPublishingConfig } from '../../src/modules/publishing/publishing.config.js';
import { ScheduleResolutionService } from '../../src/modules/scheduling/schedule-resolution.js';
import {
  ScheduleIdentityConflict,
  SchedulingService,
} from '../../src/modules/scheduling/scheduling.service.js';
import { createTestDatabase, type TestDatabase } from './test-database.js';
import {
  auditActions,
  createAmbiguousPublication,
  createPublication,
  reconciliationsOf,
  seedChannel,
  seedMember,
} from './seed.js';
import { testAudit } from './publishing-support.js';

const sp = schema.scheduledPublications;
const pj = schema.publicationJobs;
const pr = schema.publicationResults;

function buildResolution(
  db: PostgresJsDatabase<typeof schema>,
  audit: Pick<AuditLogService, 'enqueue'> = testAudit(db),
) {
  const ledger = new PublicationLedger(db, loadPublishingConfig({}), audit as AuditLogService);
  const scheduling = new SchedulingService(db, {} as ProviderRegistry, {} as MediaService);
  const resolution = new ScheduleResolutionService(
    db,
    new WorkspaceAccessService(db),
    ledger,
    scheduling,
  );
  return { ledger, scheduling, resolution };
}

describe('operator resolution (32B-1 §7)', () => {
  let database: TestDatabase;
  let built: ReturnType<typeof buildResolution>;

  beforeAll(async () => {
    database = await createTestDatabase();
    built = buildResolution(database.db);
  });
  afterAll(async () => {
    await database.drop();
  });

  const reload = async (id: number) =>
    (await database.db.select().from(sp).where(eq(sp.id, id)))[0]!;
  const jobOf = async (id: number) =>
    (await database.db.select().from(pj).where(eq(pj.id, id)))[0]!;
  const resultsOf = (attemptId: number) =>
    database.db.select().from(pr).where(eq(pr.publicationJobId, attemptId));
  const contentStatus = async (id: number) =>
    (
      await database.db
        .select({ status: schema.contentItems.status })
        .from(schema.contentItems)
        .where(eq(schema.contentItems.id, id))
    )[0]!.status;

  async function needsReview(
    options: Partial<Parameters<typeof createAmbiguousPublication>[2]> = {},
    provider = 'x',
  ) {
    const seeded = await seedChannel(database.sql, provider);
    const owner = await seedMember(database.sql, seeded.workspaceId, 'owner');
    const row = await createAmbiguousPublication(database.db, seeded, {
      status: 'needs_review',
      ...options,
    });
    return { seeded, owner, row };
  }

  it('marks published with a post id on the active attempt and records the operator', async () => {
    const { seeded, owner, row } = await needsReview();

    const view = await built.resolution.resolve(seeded.workspaceId, row.id, owner, {
      action: 'mark_published',
      platformPostId: 'x-123',
      platformPostUrl: 'https://x.com/a/status/123',
      note: 'Checked on X',
    });

    expect(view).toMatchObject({ id: row.id, status: 'published', reconcileAfter: null });
    expect(view.reconciliations[0]).toMatchObject({
      source: 'operator',
      outcome: 'confirmed_published',
      evidenceType: 'operator_attested',
      platformPostId: 'x-123',
      actor: { id: owner.id },
      note: 'Checked on X',
    });
    expect(await resultsOf(row.activeAttemptId!)).toEqual([
      expect.objectContaining({
        platformPostId: 'x-123',
        platformPostUrl: 'https://x.com/a/status/123',
      }),
    ]);
    expect(await jobOf(row.activeAttemptId!)).toMatchObject({ status: 'unknown' }); // R3
    expect(await contentStatus(seeded.contentItemId)).toBe('published');
    expect(await auditActions(database.sql, row.id)).toEqual([
      'publication.resolution_marked_published',
    ]);
  });

  it("reuses this publication's result with the same id, never another publication's (Review Focus 3)", async () => {
    const mine = await needsReview({ attempt: { postIds: ['shared-1'] } });
    const theirs = await needsReview({ attempt: { postIds: ['shared-2'] } });

    await built.resolution.resolve(mine.seeded.workspaceId, mine.row.id, mine.owner, {
      action: 'mark_published',
      platformPostId: 'shared-1',
    });
    await built.resolution.resolve(theirs.seeded.workspaceId, theirs.row.id, theirs.owner, {
      action: 'mark_published',
      platformPostId: 'shared-1',
    });

    expect(await resultsOf(mine.row.activeAttemptId!)).toHaveLength(1);
    expect(
      (await resultsOf(theirs.row.activeAttemptId!)).map((row) => row.platformPostId).sort(),
    ).toEqual(['shared-1', 'shared-2']);
  });

  it('marks published without an id and fabricates nothing', async () => {
    const { seeded, owner, row } = await needsReview();

    const view = await built.resolution.resolve(seeded.workspaceId, row.id, owner, {
      action: 'mark_published',
    });

    expect(view.status).toBe('published');
    expect(await resultsOf(row.activeAttemptId!)).toEqual([]);
  });

  it('marks a publication with no attempt published without creating one (R8)', async () => {
    const { seeded, owner, row } = await needsReview({ attempt: null });

    const view = await built.resolution.resolve(seeded.workspaceId, row.id, owner, {
      action: 'mark_published',
      platformPostId: 'orphan-1',
    });

    expect(view.status).toBe('published');
    expect(view.reconciliations[0]).toMatchObject({ platformPostId: 'orphan-1' });
    expect(
      await database.db.select().from(pj).where(eq(pj.scheduledPublicationId, row.id)),
    ).toEqual([]);
  });

  it('re-arms on confirm_absent with a fresh generation and the supplied time', async () => {
    const { seeded, owner, row } = await needsReview();
    await database.db
      .update(sp)
      .set({ attemptCount: 3, leaseExpiresAt: new Date() })
      .where(eq(sp.id, row.id));
    const scheduledAt = new Date('2026-11-05T08:30:00.000Z');

    const view = await built.resolution.resolve(seeded.workspaceId, row.id, owner, {
      action: 'confirm_absent',
      scheduledAt,
      note: 'Not on the channel',
    });

    const after = await reload(row.id);
    expect(after).toMatchObject({
      status: 'scheduled',
      dispatchGeneration: row.dispatchGeneration + 1,
      attemptCount: 0,
      activeAttemptId: null,
      leaseExpiresAt: null,
      nextAttemptAt: null,
      reconcileAfter: null,
      scheduledAt,
    });
    expect(view.reconciliations[0]).toMatchObject({ outcome: 'confirmed_absent' });
    const [entry] = await reconciliationsOf(database.db, row.id);
    expect(entry!.evidence).toEqual({
      previousStatus: 'needs_review',
      scheduledAt: scheduledAt.toISOString(),
    });
    expect(await jobOf(row.activeAttemptId!)).toMatchObject({ status: 'unknown' }); // R3
    expect(await contentStatus(seeded.contentItemId)).toBe('scheduled');
    expect(await auditActions(database.sql, row.id)).toEqual([
      'publication.resolution_confirmed_absent',
    ]);
    expect(
      await built.ledger.claim({
        publicationId: row.id,
        expectedVersion: after.updatedAt.toISOString(),
        expectedDispatchGeneration: after.dispatchGeneration,
      }),
    ).not.toBeNull();
  });

  it('refuses confirm_absent on an unusable channel and changes nothing', async () => {
    for (const breakChannel of [
      `status = 'disconnected'`,
      'access_token = null',
    ]) {
      const { seeded, owner, row } = await needsReview();
      await database.sql.unsafe(
        `update social_accounts set ${breakChannel} where id = ${seeded.socialAccountId}`,
      );

      await expect(
        built.resolution.resolve(seeded.workspaceId, row.id, owner, {
          action: 'confirm_absent',
          scheduledAt: new Date(),
        }),
      ).rejects.toThrow('Reconnect the channel before retrying');
      expect((await reload(row.id)).status).toBe('needs_review');
      expect(await reconciliationsOf(database.db, row.id)).toEqual([]);
    }
  });

  it('refuses confirm_absent into an occupied identity and commits nothing', async () => {
    const { seeded, owner, row } = await needsReview();
    const occupiedAt = new Date('2026-12-01T09:00:00.000Z');
    const occupant = await createPublication(database.db, seeded, { scheduledAt: occupiedAt });

    const error = await built.resolution
      .resolve(seeded.workspaceId, row.id, owner, {
        action: 'confirm_absent',
        scheduledAt: occupiedAt,
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ScheduleIdentityConflict);
    expect((error as ScheduleIdentityConflict).existingScheduleId).toBe(occupant.id);
    expect((await reload(row.id)).status).toBe('needs_review');
    expect(await reconciliationsOf(database.db, row.id)).toEqual([]);
    expect(await auditActions(database.sql, row.id)).toEqual([]);
  });

  it('lets an admin cancel on a disconnected channel', async () => {
    const { seeded, row } = await needsReview();
    const admin = await seedMember(database.sql, seeded.workspaceId, 'admin');
    await database.sql`
      update social_accounts set status = 'disconnected', access_token = null
      where id = ${seeded.socialAccountId}`;

    const view = await built.resolution.resolve(seeded.workspaceId, row.id, admin, {
      action: 'cancel',
    });

    expect(view.status).toBe('cancelled');
    expect(await contentStatus(seeded.contentItemId)).toBe('in_review');
    expect(await auditActions(database.sql, row.id)).toEqual([
      'publication.resolution_cancelled',
    ]);
  });

  it('rejects a member with 403 before reading anything, and hides other workspaces', async () => {
    const { seeded, row } = await needsReview();
    const member = await seedMember(database.sql, seeded.workspaceId, 'member');

    await expect(
      built.resolution.resolve(seeded.workspaceId, 999_999, member, { action: 'cancel' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      built.resolution.resolve(seeded.workspaceId, row.id, member, { action: 'cancel' }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect((await reload(row.id)).status).toBe('needs_review');

    const other = await seedChannel(database.sql);
    const outsider = await seedMember(database.sql, other.workspaceId, 'owner');
    await expect(
      built.resolution.resolve(other.workspaceId, row.id, outsider, { action: 'cancel' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('answers 409 with the current status outside needs_review', async () => {
    for (const status of ['unknown', 'scheduled', 'published'] as const) {
      const { seeded, owner, row } = await needsReview();
      await database.db.update(sp).set({ status }).where(eq(sp.id, row.id));

      const error = await built.resolution
        .resolve(seeded.workspaceId, row.id, owner, { action: 'cancel' })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(ConflictException);
      expect((error as ConflictException).getResponse()).toMatchObject({
        status,
        ...(status === 'unknown'
          ? { message: 'SoStats is still checking this publication' }
          : {}),
      });
    }
  });

  it('rolls an operator resolution back when its audit event cannot be written (R5)', async () => {
    const { seeded, owner, row } = await needsReview();
    const failing = buildResolution(database.db, {
      enqueue: async () => {
        throw new Error('audit unavailable');
      },
    }).resolution;

    await expect(
      failing.resolve(seeded.workspaceId, row.id, owner, { action: 'cancel' }),
    ).rejects.toThrow('audit unavailable');
    expect((await reload(row.id)).status).toBe('needs_review');
    expect(await reconciliationsOf(database.db, row.id)).toEqual([]);
  });

  it('still refuses PATCH reschedule and cancel on needs_review', async () => {
    const { seeded, row } = await needsReview();

    await expect(
      built.scheduling.updateSchedule(seeded.workspaceId, row.id, { status: 'cancelled' }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      built.scheduling.updateSchedule(seeded.workspaceId, row.id, {
        scheduledAt: new Date().toISOString(),
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('gives a confirming reconciler and an operator cancel exactly one winner (§7.3)', async () => {
    for (let round = 0; round < 10; round += 1) {
      const { seeded, owner, row } = await needsReview(
        { reconcileAfter: new Date(Date.now() - 1_000) },
        'instagram',
      );

      const [automatic, operator] = await Promise.allSettled([
        built.ledger.reconcile(
          {
            publicationId: row.id,
            status: 'needs_review',
            reconcileAfter: row.reconcileAfter,
            activeAttemptId: row.activeAttemptId,
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
        built.resolution.resolve(seeded.workspaceId, row.id, owner, { action: 'cancel' }),
      ]);

      const reconcilerWon = automatic.status === 'fulfilled' && automatic.value !== null;
      const operatorWon = operator.status === 'fulfilled';
      expect(reconcilerWon).not.toBe(operatorWon);
      expect((await reload(row.id)).status).toBe(reconcilerWon ? 'published' : 'cancelled');
      expect(await reconciliationsOf(database.db, row.id)).toHaveLength(1);
      expect(await auditActions(database.sql, row.id)).toHaveLength(1);
      if (!operatorWon) {
        expect((operator as PromiseRejectedResult).reason).toBeInstanceOf(ConflictException);
      }
    }
  });
});
