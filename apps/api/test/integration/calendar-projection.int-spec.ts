import { NotFoundException } from '@nestjs/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.js';
import type { MediaService } from '../../src/modules/media/media.service.js';
import type { ProviderRegistry } from '../../src/modules/channels/ProviderRegistry.js';
import { SchedulingService } from '../../src/modules/scheduling/scheduling.service.js';
import { createTestDatabase, type TestDatabase } from './test-database.js';
import { createAmbiguousPublication, seedChannel } from './seed.js';

describe('calendar projection (32B-1 §8, R6)', () => {
  let database: TestDatabase;
  let scheduling: SchedulingService;

  beforeAll(async () => {
    database = await createTestDatabase();
    scheduling = new SchedulingService(
      database.db,
      {} as ProviderRegistry,
      {} as MediaService,
    );
  });
  afterAll(async () => {
    await database.drop();
  });

  async function reviewedWithHistory() {
    const seeded = await seedChannel(database.sql, 'instagram');
    const row = await createAmbiguousPublication(database.db, seeded, {
      status: 'needs_review',
      attempt: {
        checkpoint: {
          confirmedPlatformPostId: 'ig-9',
          confirmedPlatformPostUrl: 'https://instagram.example/p/9',
          internalNote: 'do-not-leak',
        },
      },
    });
    await database.db.insert(schema.publicationResults).values({
      publicationJobId: row.activeAttemptId!,
      errorType: 'unknown_outcome',
      errorMessage: 'Lease expired',
      rawResponse: 'RAW-PROVIDER-BODY',
    });
    const [user] = await database.sql<{ id: number }[]>`
      insert into users (email, name) values (${`op-${row.id}@example.test`}, 'Operator One')
      returning id`;
    for (let index = 0; index < 25; index += 1) {
      await database.db.insert(schema.publicationReconciliations).values({
        scheduledPublicationId: row.id,
        attemptId: row.activeAttemptId,
        source: 'operator',
        outcome: 'inconclusive',
        evidenceType: `pass_${index}`,
        evidence: {
          duplicatePlatformPostIds: ['ig-1', 'ig-2'],
          lookupReason: 'SECRET-REASON',
          previousStatus: 'needs_review',
        },
        actorUserId: user!.id,
        note: `note ${index}`,
        createdAt: new Date(Date.now() + index * 1_000),
      });
    }
    return { seeded, row, userId: user!.id };
  }

  it('exposes attempt evidence and the latest 20 reconciliations through explicit fields only', async () => {
    const { seeded, userId } = await reviewedWithHistory();

    const [schedule] = await scheduling.getCalendar(seeded.workspaceId, {});
    const json = JSON.stringify(schedule);

    for (const leak of [
      'providerCheckpoint',
      'rawResponse',
      'RAW-PROVIDER-BODY',
      'do-not-leak',
      'SECRET-REASON',
      'lookupReason',
      '"evidence"',
      'accessToken',
      'not-a-real-token',
    ]) {
      expect(json).not.toContain(leak);
    }
    expect(schedule!.attemptEvidence).toEqual({
      requestStartedAt: expect.any(Date),
      operationType: 'instagram_media_publish',
      operationId: 'container-1',
      confirmedPlatformPostId: 'ig-9',
      confirmedPlatformPostUrl: 'https://instagram.example/p/9',
    });
    expect(schedule!.reconciliations).toHaveLength(20);
    expect(schedule!.reconciliations[0]).toEqual({
      source: 'operator',
      outcome: 'inconclusive',
      evidenceType: 'pass_24',
      platformPostId: null,
      platformPostUrl: null,
      duplicatePlatformPostIds: ['ig-1', 'ig-2'],
      actor: { id: userId, name: 'Operator One' },
      note: 'note 24',
      createdAt: expect.any(Date),
    });
    expect(Object.keys(schedule!.jobs[0]!).sort()).toEqual([
      'attemptNumber',
      'attempts',
      'completedAt',
      'errorClass',
      'id',
      'lastAttemptAt',
      'nextAttemptAt',
      'results',
      'status',
    ]);
    expect(Object.keys(schedule!.jobs[0]!.results[0]!).sort()).toEqual([
      'createdAt',
      'errorMessage',
      'errorType',
      'id',
      'platformPostId',
      'platformPostUrl',
    ]);
  });

  it('returns one schedule in the same projection and hides it from other workspaces', async () => {
    const { seeded, row } = await reviewedWithHistory();
    const other = await seedChannel(database.sql);

    const schedule = await scheduling.getSchedule(seeded.workspaceId, row.id);

    expect(schedule).toMatchObject({ id: row.id, status: 'needs_review' });
    expect(schedule.reconciliations).toHaveLength(20);
    await expect(scheduling.getSchedule(other.workspaceId, row.id)).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
