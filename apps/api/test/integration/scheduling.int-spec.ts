import { ConflictException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { claimScheduleStartAt } from '../../src/modules/automations/schedule-checkpoint.js';
import type { ChannelCredentialService } from '../../src/modules/channels/channel-credential.service.js';
import { ChannelsService } from '../../src/modules/channels/channels.service.js';
import type { OAuthStateService } from '../../src/modules/channels/oauth-state.service.js';
import type { ProviderRegistry } from '../../src/modules/channels/ProviderRegistry.js';
import type { MediaService } from '../../src/modules/media/media.service.js';
import { PublicationLedger } from '../../src/modules/publishing/publication-ledger.js';
import { loadPublishingConfig } from '../../src/modules/publishing/publishing.config.js';
import {
  ScheduleIdentityConflict,
  SchedulingService,
} from '../../src/modules/scheduling/scheduling.service.js';
import { createTestDatabase, type TestDatabase } from './test-database.js';
import { createPublication, seedChannel, type SeededChannel } from './seed.js';

const sp = schema.scheduledPublications;

describe('schedule mutations under concurrency', () => {
  let database: TestDatabase;
  let scheduling: SchedulingService;
  let ledger: PublicationLedger;

  beforeAll(async () => {
    database = await createTestDatabase();
    scheduling = new SchedulingService(
      database.db,
      {
        describeProvider: () => ({
          supported: true,
          capabilities: { text: true },
        }),
      } as unknown as ProviderRegistry,
      { listReadyContentMedia: async () => [] } as unknown as MediaService,
    );
    ledger = new PublicationLedger(database.db, loadPublishingConfig({}));
  });
  afterAll(async () => {
    await database.drop();
  });

  async function reload(id: number) {
    const [row] = await database.db.select().from(sp).where(eq(sp.id, id));
    return row;
  }
  const claimOf = (publication: typeof sp.$inferSelect) =>
    ledger.claim({
      publicationId: publication.id,
      expectedVersion: publication.updatedAt.toISOString(),
      expectedDispatchGeneration: publication.dispatchGeneration,
    });

  it('never lets a reschedule revert a claimed publication (D1)', async () => {
    for (let round = 0; round < 15; round += 1) {
      const seeded = await seedChannel(database.sql);
      const publication = await createPublication(database.db, seeded);
      const [claim, reschedule] = await Promise.allSettled([
        claimOf(publication),
        scheduling.updateSchedule(seeded.workspaceId, publication.id, {
          scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
        }),
      ]);
      const row = await reload(publication.id);

      if (claim.status === 'fulfilled' && claim.value) {
        expect(row.status).toBe('publishing');
        expect(reschedule.status).toBe('rejected');
      } else {
        expect(reschedule.status).toBe('fulfilled');
        expect(row).toMatchObject({
          status: 'scheduled',
          dispatchGeneration: publication.dispatchGeneration + 1,
        });
      }
    }
  });

  it('gives cancel versus claim exactly one winner', async () => {
    for (let round = 0; round < 15; round += 1) {
      const seeded = await seedChannel(database.sql);
      const publication = await createPublication(database.db, seeded);
      const [claim, cancel] = await Promise.allSettled([
        claimOf(publication),
        scheduling.updateSchedule(seeded.workspaceId, publication.id, {
          status: 'cancelled',
        }),
      ]);
      const row = await reload(publication.id);
      const claimed = claim.status === 'fulfilled' && claim.value !== null;

      expect(claimed !== (cancel.status === 'fulfilled')).toBe(true);
      expect(row.status).toBe(claimed ? 'publishing' : 'cancelled');
    }
  });

  it('maps a duplicate logical schedule to a 409 carrying the existing id (D3)', async () => {
    const seeded = await seedChannel(database.sql);
    const scheduledAt = new Date(Date.now() + 3_600_000).toISOString();
    const input = {
      contentItemId: seeded.contentItemId,
      socialAccountId: seeded.socialAccountId,
      scheduledAt,
    };
    const first = await scheduling.createSchedule(seeded.workspaceId, input);
    // createSchedule moves the content to `scheduled`; reset it so the second call reaches the insert.
    await database.sql`update content_items set status = 'approved' where id = ${seeded.contentItemId}`;

    const conflict = await scheduling
      .createSchedule(seeded.workspaceId, input)
      .catch((error: unknown) => error);
    expect(conflict).toBeInstanceOf(ScheduleIdentityConflict);
    expect((conflict as ScheduleIdentityConflict).existingScheduleId).toBe(
      first.id,
    );
  });

  it('keeps one row when identical schedules are created concurrently', async () => {
    const seeded = await seedChannel(database.sql);
    const input = {
      contentItemId: seeded.contentItemId,
      socialAccountId: seeded.socialAccountId,
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
    };
    const results = await Promise.allSettled([
      scheduling.createSchedule(seeded.workspaceId, input),
      scheduling.createSchedule(seeded.workspaceId, input),
    ]);
    const rows = await database.db
      .select()
      .from(sp)
      .where(eq(sp.contentItemId, seeded.contentItemId));
    expect(rows).toHaveLength(1);
    const loser = results.find(
      (result): result is PromiseRejectedResult => result.status === 'rejected',
    );
    expect(loser?.reason).toBeInstanceOf(ScheduleIdentityConflict);
    expect((loser!.reason as ScheduleIdentityConflict).existingScheduleId).toBe(
      rows[0].id,
    );
  });

  it('returns the identity conflict when the winner already scheduled the content (D3)', async () => {
    const seeded = await seedChannel(database.sql);
    const input = {
      contentItemId: seeded.contentItemId,
      socialAccountId: seeded.socialAccountId,
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
    };
    const first = await scheduling.createSchedule(seeded.workspaceId, input);
    const conflict = await scheduling
      .createSchedule(seeded.workspaceId, input)
      .catch((error: unknown) => error);
    expect(conflict).toBeInstanceOf(ScheduleIdentityConflict);
    expect((conflict as ScheduleIdentityConflict).existingScheduleId).toBe(
      first.id,
    );
  });

  it('still rejects scheduling already-scheduled content at a different time', async () => {
    const seeded = await seedChannel(database.sql);
    await scheduling.createSchedule(seeded.workspaceId, {
      contentItemId: seeded.contentItemId,
      socialAccountId: seeded.socialAccountId,
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
    });
    await expect(
      scheduling.createSchedule(seeded.workspaceId, {
        contentItemId: seeded.contentItemId,
        socialAccountId: seeded.socialAccountId,
        scheduledAt: new Date(Date.now() + 7_200_000).toISOString(),
      }),
    ).rejects.toThrow(/Content must be in review or approved/);
  });

  it('reports separate active and disconnect-blocking counts on the channel list', async () => {
    const channels = new ChannelsService(
      database.db,
      {
        describeProvider: () => ({
          supported: true,
          capabilities: { text: true },
        }),
      } as unknown as ProviderRegistry,
      {} as OAuthStateService,
      {} as ChannelCredentialService,
    );
    const seeded = await seedChannel(database.sql);
    await createPublication(database.db, seeded, { status: 'needs_review' });
    await createPublication(database.db, seeded, {
      status: 'scheduled',
      scheduledAt: new Date(Date.now() + 3_600_000),
    });
    const list = await channels.findAll(seeded.workspaceId);
    const channel = list.find((item) => item.id === seeded.socialAccountId);
    expect(channel).toMatchObject({
      activeScheduleCount: 2,
      disconnectBlockingScheduleCount: 1,
    });
  });

  it.each(['unknown', 'needs_review'])(
    'refuses to reschedule or cancel a %s publication (D2)',
    async (status) => {
      const seeded = await seedChannel(database.sql);
      const publication = await createPublication(database.db, seeded, {
        status,
      });
      await expect(
        scheduling.updateSchedule(seeded.workspaceId, publication.id, {
          scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      await expect(
        scheduling.updateSchedule(seeded.workspaceId, publication.id, {
          status: 'cancelled',
        }),
      ).rejects.toBeInstanceOf(ConflictException);
      expect((await reload(publication.id)).status).toBe(status);
    },
  );

  it('refuses to re-arm a failed publication into an occupied identity', async () => {
    const seeded = await seedChannel(database.sql);
    const occupiedAt = new Date(Date.now() + 3_600_000);
    const active = await createPublication(database.db, seeded, {
      scheduledAt: occupiedAt,
    });
    const failed = await createPublication(database.db, seeded, {
      status: 'failed',
      scheduledAt: new Date(Date.now() - 3_600_000),
    });
    const conflict = await scheduling
      .updateSchedule(seeded.workspaceId, failed.id, {
        scheduledAt: occupiedAt.toISOString(),
      })
      .catch((error: unknown) => error);
    expect(conflict).toBeInstanceOf(ScheduleIdentityConflict);
    expect((conflict as ScheduleIdentityConflict).existingScheduleId).toBe(
      active.id,
    );
  });

  it('blocks channel disconnect while a publication is unknown, not while it needs review', async () => {
    const channels = new ChannelsService(
      database.db,
      {} as ProviderRegistry,
      {} as OAuthStateService,
      {} as ChannelCredentialService,
    );
    const unknownChannel: SeededChannel = await seedChannel(database.sql);
    await createPublication(database.db, unknownChannel, { status: 'unknown' });
    await expect(
      channels.disconnect(
        unknownChannel.workspaceId,
        unknownChannel.socialAccountId,
      ),
    ).rejects.toThrow(/Cancel or move active scheduled publications/);

    const reviewChannel = await seedChannel(database.sql);
    await createPublication(database.db, reviewChannel, {
      status: 'needs_review',
    });
    await expect(
      channels.disconnect(
        reviewChannel.workspaceId,
        reviewChannel.socialAccountId,
      ),
    ).resolves.toBeDefined();
  });

  it('makes concurrent schedule-step executions agree on one startAt (D3)', async () => {
    const seeded = await seedChannel(database.sql);
    const [automation] = await database.sql<{ id: number }[]>`
      insert into automations (workspace_id, name, trigger_type) values (${seeded.workspaceId}, 'A', 'manual') returning id`;
    const [version] = await database.sql<{ id: number }[]>`
      insert into automation_versions (automation_id, version_number, workflow_definition)
      values (${automation.id}, 1, '{}'::jsonb) returning id`;
    const [run] = await database.sql<{ id: number }[]>`
      insert into automation_runs (automation_id, version_id) values (${automation.id}, ${version.id}) returning id`;
    const [step] = await database.sql<{ id: number }[]>`
      insert into automation_run_steps (run_id, step_id) values (${run.id}, 'schedule') returning id`;

    const [a, b] = await Promise.all([
      claimScheduleStartAt(
        database.db,
        { id: step.id, logs: null },
        new Date('2026-10-01T09:00:00Z'),
      ),
      claimScheduleStartAt(
        database.db,
        { id: step.id, logs: null },
        new Date('2026-10-01T09:00:05Z'),
      ),
    ]);
    expect(a.startAt.toISOString()).toBe(b.startAt.toISOString());
  });

  it('turns two concurrent schedule-step executions into one startAt and one publication (D3)', async () => {
    const seeded = await seedChannel(database.sql);
    const [automation] = await database.sql<{ id: number }[]>`
      insert into automations (workspace_id, name, trigger_type) values (${seeded.workspaceId}, 'B', 'manual') returning id`;
    const [version] = await database.sql<{ id: number }[]>`
      insert into automation_versions (automation_id, version_number, workflow_definition)
      values (${automation.id}, 1, '{}'::jsonb) returning id`;
    const [run] = await database.sql<{ id: number }[]>`
      insert into automation_runs (automation_id, version_id) values (${automation.id}, ${version.id}) returning id`;
    const [step] = await database.sql<{ id: number }[]>`
      insert into automation_run_steps (run_id, step_id) values (${run.id}, 'schedule') returning id`;

    // The two DB effects of executeSchedule, raced exactly as two concurrent executions would.
    // The loser may fail (e.g. content already `scheduled`); its run status is 32C scope.
    const execution = async (proposed: string) => {
      const { startAt } = await claimScheduleStartAt(
        database.db,
        { id: step.id, logs: null },
        new Date(proposed),
      );
      return scheduling
        .createSchedule(seeded.workspaceId, {
          contentItemId: seeded.contentItemId,
          socialAccountId: seeded.socialAccountId,
          scheduledAt: startAt.toISOString(),
        })
        .catch((error: unknown) => error);
    };
    await Promise.all([
      execution(new Date(Date.now() + 3_600_000).toISOString()),
      execution(new Date(Date.now() + 3_605_000).toISOString()),
    ]);

    const [persisted] = await database.sql<{ logs: string }[]>`
      select logs from automation_run_steps where id = ${step.id}`;
    const startAt = (
      JSON.parse(persisted.logs) as { checkpoint: { startAt: string } }
    ).checkpoint.startAt;
    const rows = await database.db
      .select()
      .from(sp)
      .where(eq(sp.contentItemId, seeded.contentItemId));
    expect(rows).toHaveLength(1);
    expect(rows[0].scheduledAt.toISOString()).toBe(startAt);
  });
});
