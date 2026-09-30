import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDatabase, type TestDatabase } from './test-database.js';

describe('integration harness', () => {
  let database: TestDatabase;

  beforeAll(async () => {
    database = await createTestDatabase();
  });

  afterAll(async () => {
    await database?.drop();
  });

  it('builds the pre-007 baseline schema in a throwaway database', async () => {
    const [row] = await database.sql<{ count: number }[]>`
      select count(*)::int as count
      from information_schema.tables
      where table_schema = 'public'
        and table_name in ('scheduled_publications', 'publication_jobs', 'publication_results', 'outbox_events')
    `;
    expect(row.count).toBe(4);
  });
});
