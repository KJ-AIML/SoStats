import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { MediaService } from '../../src/modules/media/media.service.js';
import type { ProviderRegistry } from '../../src/modules/channels/ProviderRegistry.js';
import { ContentService } from '../../src/modules/content/content.service.js';
import { SchedulingService } from '../../src/modules/scheduling/scheduling.service.js';
import { createTestDatabase, type TestDatabase } from './test-database.js';
import { createPublication, seedChannel } from './seed.js';

const CREDENTIAL_KEYS = ['accessToken', 'refreshToken'];

describe('social account projection in API responses', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });
  afterAll(async () => {
    await database.drop();
  });

  async function seededSchedule() {
    const seeded = await seedChannel(database.sql);
    await database.sql`
      update social_accounts
      set access_token = 'ciphertext-access', refresh_token = 'ciphertext-refresh'
      where id = ${seeded.socialAccountId}`;
    await createPublication(database.db, seeded);
    return seeded;
  }

  function expectNoCredentials(account: Record<string, unknown> | undefined) {
    expect(account).toBeDefined();
    for (const key of CREDENTIAL_KEYS) expect(account).not.toHaveProperty(key);
    expect(account).toMatchObject({ provider: 'x' });
    expect(account).toHaveProperty('accountName');
  }

  it('calendar schedules never carry account credentials', async () => {
    const seeded = await seededSchedule();
    const scheduling = new SchedulingService(
      database.db,
      {} as ProviderRegistry,
      {} as MediaService,
    );

    const schedules = await scheduling.getCalendar(seeded.workspaceId, {});

    expect(schedules).toHaveLength(1);
    expectNoCredentials(
      schedules[0].socialAccount as unknown as Record<string, unknown>,
    );
  });

  it('content list and detail never carry account credentials', async () => {
    const seeded = await seededSchedule();
    const content = new ContentService(database.db);

    const [listed] = await content.findAllForWorkspace(seeded.workspaceId);
    const detail = await content.findOne(
      seeded.workspaceId,
      seeded.contentItemId,
    );

    expectNoCredentials(
      listed.scheduledPublications[0].socialAccount as unknown as Record<
        string,
        unknown
      >,
    );
    expectNoCredentials(
      detail.scheduledPublications[0].socialAccount as unknown as Record<
        string,
        unknown
      >,
    );
  });
});
