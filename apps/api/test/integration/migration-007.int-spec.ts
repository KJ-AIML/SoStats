import { afterEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { createTestDatabase, type TestDatabase } from './test-database.js';
import { seedChannel, type SeededChannel } from './seed.js';

const at = (iso: string) => new Date(iso).toISOString();

describe('migration 007', () => {
  let database: TestDatabase | undefined;

  afterEach(async () => {
    await database?.drop();
    database = undefined;
  });

  async function legacyDatabase() {
    database = await createTestDatabase({ migrate: false });
    return database;
  }

  async function publication(
    sql: postgres.Sql,
    seeded: SeededChannel,
    status: string,
    scheduledAt = '2026-10-01T09:00:00.000Z',
  ) {
    const [row] = await sql<{ id: number }[]>`
      insert into scheduled_publications (content_item_id, workspace_id, social_account_id, scheduled_at, status)
      values (${seeded.contentItemId}, ${seeded.workspaceId}, ${seeded.socialAccountId}, ${at(scheduledAt)}, ${status})
      returning id`;
    return row.id;
  }

  async function job(
    sql: postgres.Sql,
    publicationId: number,
    status: string,
    createdAt: string,
    attempts = 1,
  ) {
    const [row] = await sql<{ id: number }[]>`
      insert into publication_jobs (scheduled_publication_id, status, attempts, last_attempt_at, created_at)
      values (${publicationId}, ${status}, ${attempts}, ${at(createdAt)}, ${at(createdAt)})
      returning id`;
    return row.id;
  }

  async function result(
    sql: postgres.Sql,
    jobId: number,
    errorType: string,
    createdAt: string,
  ) {
    await sql`
      insert into publication_results (publication_job_id, error_type, created_at)
      values (${jobId}, ${errorType}, ${at(createdAt)})`;
  }

  async function hasColumn(sql: postgres.Sql, table: string, column: string) {
    const [row] = await sql<{ count: number }[]>`
      select count(*)::int as count from information_schema.columns
      where table_name = ${table} and column_name = ${column}`;
    return row.count === 1;
  }

  it('applies to the pre-007 schema and creates every constraint and index', async () => {
    const { sql, applyPostBaselineMigrations } = await legacyDatabase();
    await applyPostBaselineMigrations();

    const constraints = await sql<{ conname: string }[]>`
      select conname from pg_constraint where conname in (
        'scheduled_publications_status_check',
        'publication_jobs_status_check',
        'scheduled_publications_active_attempt_id_publication_jobs_id_fk')`;
    expect(constraints).toHaveLength(3);

    const indexes = await sql<{ indexname: string }[]>`
      select indexname from pg_indexes where indexname in (
        'scheduled_pub_active_identity_idx', 'scheduled_pub_dispatch_idx',
        'scheduled_pub_lease_idx', 'publication_jobs_attempt_unique',
        'publication_jobs_publication_idx')`;
    expect(indexes).toHaveLength(5);
  });

  it('refuses to run while publication dispatch is not drained and changes nothing', async () => {
    const { sql, applyPostBaselineMigrations } = await legacyDatabase();
    const seeded = await seedChannel(sql);
    const id = await publication(sql, seeded, 'publishing');
    await job(sql, id, 'processing', '2026-09-30T00:00:00Z');

    await expect(applyPostBaselineMigrations()).rejects.toThrow(/not drained/);
    expect(
      await hasColumn(sql, 'scheduled_publications', 'active_attempt_id'),
    ).toBe(false);
    const [row] = await sql<
      { status: string }[]
    >`select status from scheduled_publications where id = ${id}`;
    expect(row.status).toBe('publishing');
  });

  it('marks undrained rows unknown only with the explicit mark_unknown opt-in', async () => {
    const { sql, applyPostBaselineMigrations } = await legacyDatabase();
    const seeded = await seedChannel(sql);
    const id = await publication(sql, seeded, 'publishing');
    const jobId = await job(sql, id, 'processing', '2026-09-30T00:00:00Z');

    await applyPostBaselineMigrations({ inflightPublications: 'mark_unknown' });

    const [pub] = await sql<{ status: string; active_attempt_id: number }[]>`
      select status, active_attempt_id from scheduled_publications where id = ${id}`;
    expect(pub).toEqual({ status: 'unknown', active_attempt_id: jobId });
    const [attempt] = await sql<{ status: string; marker: string | null }[]>`
      select status, provider_request_started_at as marker from publication_jobs where id = ${jobId}`;
    expect(attempt.status).toBe('unknown');
    expect(attempt.marker).not.toBeNull();
  });

  it('marks a scheduled publication that owns an in-flight attempt unknown with the opt-in', async () => {
    const { sql, applyPostBaselineMigrations } = await legacyDatabase();
    const seeded = await seedChannel(sql);
    const id = await publication(sql, seeded, 'scheduled');
    const jobId = await job(sql, id, 'processing', '2026-09-30T00:00:00Z');

    await applyPostBaselineMigrations({ inflightPublications: 'mark_unknown' });

    const [pub] = await sql<{ status: string; active_attempt_id: number }[]>`
      select status, active_attempt_id from scheduled_publications where id = ${id}`;
    expect(pub).toEqual({ status: 'unknown', active_attempt_id: jobId });
    const [attempt] = await sql<{ status: string; marker: string | null }[]>`
      select status, provider_request_started_at as marker from publication_jobs where id = ${jobId}`;
    expect(attempt.status).toBe('unknown');
    expect(attempt.marker).not.toBeNull();
  });

  it('keeps a published publication published but marks its orphan in-flight attempt unknown', async () => {
    const { sql, applyPostBaselineMigrations } = await legacyDatabase();
    const seeded = await seedChannel(sql);
    const id = await publication(sql, seeded, 'published');
    const jobId = await job(sql, id, 'processing', '2026-09-30T00:00:00Z');

    await applyPostBaselineMigrations({ inflightPublications: 'mark_unknown' });

    const [pub] = await sql<{ status: string }[]>`
      select status from scheduled_publications where id = ${id}`;
    expect(pub.status).toBe('published');
    const [attempt] = await sql<{ status: string }[]>`
      select status from publication_jobs where id = ${jobId}`;
    expect(attempt.status).toBe('unknown');
  });

  it.each(['pending', 'processing'])(
    'refuses to run for a lone %s attempt under a failed publication',
    async (attemptStatus) => {
      const { sql, applyPostBaselineMigrations } = await legacyDatabase();
      const seeded = await seedChannel(sql);
      const id = await publication(sql, seeded, 'failed');
      await job(sql, id, attemptStatus, '2026-09-30T00:00:00Z');

      await expect(applyPostBaselineMigrations()).rejects.toThrow(
        /not drained/,
      );
      expect(
        await hasColumn(sql, 'scheduled_publications', 'active_attempt_id'),
      ).toBe(false);
      const [row] = await sql<{ status: string }[]>`
        select status from publication_jobs where scheduled_publication_id = ${id}`;
      expect(row.status).toBe(attemptStatus);
    },
  );

  it('backfills attempt_count from the latest legacy job for scheduled publications only', async () => {
    const { sql, applyPostBaselineMigrations } = await legacyDatabase();
    const seeded = await seedChannel(sql);
    const scheduled = await publication(
      sql,
      seeded,
      'scheduled',
      '2026-10-01T09:00:00Z',
    );
    await job(sql, scheduled, 'failed', '2026-09-30T00:01:00Z', 3);
    await job(sql, scheduled, 'failed', '2026-09-30T00:00:00Z', 1);
    const published = await publication(
      sql,
      seeded,
      'published',
      '2026-10-02T09:00:00Z',
    );
    await job(sql, published, 'completed', '2026-09-30T00:00:00Z', 2);

    await applyPostBaselineMigrations();

    const rows = await sql<{ id: number; attempt_count: number }[]>`
      select id, attempt_count from scheduled_publications
      where id in (${scheduled}, ${published}) order by id`;
    expect(rows).toEqual([
      { id: scheduled, attempt_count: 3 },
      { id: published, attempt_count: 0 },
    ]);
  });

  it('fails loudly on duplicate active identities and lists them', async () => {
    const { sql, applyPostBaselineMigrations } = await legacyDatabase();
    const seeded = await seedChannel(sql);
    const a = await publication(sql, seeded, 'scheduled');
    const b = await publication(sql, seeded, 'scheduled');

    const error = (await applyPostBaselineMigrations().catch(
      (caught: unknown) => caught,
    )) as { message: string; detail?: string; hint?: string };
    expect(error.message).toMatch(/duplicate active publication identity/);
    expect(error.detail).toContain(`ids=[${a},${b}]`);
    const query = error.hint?.split(String.fromCharCode(10)).pop() ?? '';
    const groups = await sql.unsafe(query);
    expect(groups).toHaveLength(1);
    expect(groups[0].ids).toEqual([a, b]);
    const rows =
      await sql`select id from scheduled_publications where id in (${a}, ${b})`;
    expect(rows).toHaveLength(2);
  });

  it('counts failed publications whose latest outcome is unknown as active when checking duplicates', async () => {
    const { sql, applyPostBaselineMigrations } = await legacyDatabase();
    const seeded = await seedChannel(sql);
    const failed = await publication(sql, seeded, 'failed');
    const failedJob = await job(sql, failed, 'failed', '2026-09-30T00:00:00Z');
    await result(sql, failedJob, 'unknown_outcome', '2026-09-30T00:01:00Z');
    await publication(sql, seeded, 'scheduled');

    await expect(applyPostBaselineMigrations()).rejects.toThrow(
      /duplicate active publication identity/,
    );
  });

  it('reclassifies failed publications by their latest outcome only', async () => {
    const { sql, applyPostBaselineMigrations } = await legacyDatabase();
    const seeded = await seedChannel(sql);
    const laterRejected = await publication(
      sql,
      seeded,
      'failed',
      '2026-10-01T09:00:00Z',
    );
    const jobA = await job(
      sql,
      laterRejected,
      'failed',
      '2026-09-30T00:00:00Z',
    );
    await result(sql, jobA, 'unknown_outcome', '2026-09-30T00:01:00Z');
    await result(sql, jobA, 'provider_rejected', '2026-09-30T00:02:00Z');
    const laterUnknown = await publication(
      sql,
      seeded,
      'failed',
      '2026-10-02T09:00:00Z',
    );
    const jobB = await job(sql, laterUnknown, 'failed', '2026-09-30T00:00:00Z');
    await result(sql, jobB, 'provider_rejected', '2026-09-30T00:01:00Z');
    await result(sql, jobB, 'unknown_outcome', '2026-09-30T00:02:00Z');

    await applyPostBaselineMigrations();

    const rows = await sql<{ id: number; status: string }[]>`
      select id, status from scheduled_publications where id in (${laterRejected}, ${laterUnknown}) order by id`;
    expect(rows).toEqual([
      { id: laterRejected, status: 'failed' },
      { id: laterUnknown, status: 'needs_review' },
    ]);
  });

  it('leaves existing safe rows unchanged', async () => {
    const { sql, applyPostBaselineMigrations } = await legacyDatabase();
    const seeded = await seedChannel(sql);
    const kept = {
      scheduled: await publication(
        sql,
        seeded,
        'scheduled',
        '2026-10-01T09:00:00Z',
      ),
      published: await publication(
        sql,
        seeded,
        'published',
        '2026-10-02T09:00:00Z',
      ),
      cancelled: await publication(
        sql,
        seeded,
        'cancelled',
        '2026-10-03T09:00:00Z',
      ),
      failed: await publication(sql, seeded, 'failed', '2026-10-04T09:00:00Z'),
    };
    const failedJob = await job(
      sql,
      kept.failed,
      'failed',
      '2026-09-30T00:00:00Z',
    );
    await result(sql, failedJob, 'provider_rejected', '2026-09-30T00:01:00Z');
    const snapshot = () =>
      sql<
        {
          id: number;
          status: string;
          scheduled_at: string;
          updated_at: string;
        }[]
      >`
        select id, status, scheduled_at::text, updated_at::text
        from scheduled_publications order by id`;
    const before = await snapshot();

    await applyPostBaselineMigrations();

    expect(await snapshot()).toEqual(before);
  });

  it('backfills attempt numbers in creation order', async () => {
    const { sql, applyPostBaselineMigrations } = await legacyDatabase();
    const seeded = await seedChannel(sql);
    const id = await publication(sql, seeded, 'published');
    const second = await job(sql, id, 'completed', '2026-09-30T00:05:00Z');
    const first = await job(sql, id, 'failed', '2026-09-30T00:01:00Z');

    await applyPostBaselineMigrations();

    const rows = await sql<{ id: number; attempt_number: number }[]>`
      select id, attempt_number from publication_jobs where scheduled_publication_id = ${id} order by attempt_number`;
    expect(rows).toEqual([
      { id: first, attempt_number: 1 },
      { id: second, attempt_number: 2 },
    ]);
  });

  it('rejects statuses outside the new state model', async () => {
    const { sql, applyPostBaselineMigrations } = await legacyDatabase();
    const seeded = await seedChannel(sql);
    await applyPostBaselineMigrations();

    await expect(publication(sql, seeded, 'bogus')).rejects.toThrow(
      /scheduled_publications_status_check/,
    );
  });
});
