import { afterEach, describe, expect, it } from 'vitest';
import type postgres from 'postgres';
import { createTestDatabase, type TestDatabase } from './test-database.js';
import { seedChannel, type SeededChannel } from './seed.js';

describe('migration 008', () => {
  let database: TestDatabase | undefined;

  afterEach(async () => {
    await database?.drop();
    database = undefined;
  });

  async function legacyRow(
    sql: postgres.Sql,
    seeded: SeededChannel,
    status: string,
    jobStatus: string,
    scheduledAt: string,
    platformPostId: string | null,
  ) {
    const [publication] = await sql<{ id: number }[]>`
      insert into scheduled_publications (content_item_id, workspace_id, social_account_id, scheduled_at, status)
      values (${seeded.contentItemId}, ${seeded.workspaceId}, ${seeded.socialAccountId}, ${scheduledAt}, ${status})
      returning id`;
    const [job] = await sql<{ id: number }[]>`
      insert into publication_jobs (scheduled_publication_id, status, attempts, last_attempt_at)
      values (${publication.id}, ${jobStatus}, 1, now())
      returning id`;
    if (jobStatus === 'failed') {
      await sql`
        insert into publication_results (publication_job_id, error_type, platform_post_id)
        values (${job.id}, ${platformPostId ? null : 'provider_error'}, ${platformPostId})`;
    }
    return publication.id;
  }

  it('adds the reconciliation schema, backfills reconcile_after and changes no status', async () => {
    database = await createTestDatabase({ migrate: false });
    const { sql, applyPostBaselineMigrations } = database;
    const seeded = await seedChannel(sql);
    // 007 turns these into needs_review / unknown / failed; 008 must keep that.
    const live = await legacyRow(sql, seeded, 'failed', 'failed', '2026-10-01T09:00:00.000Z', 'post-1');
    const inflight = await legacyRow(sql, seeded, 'publishing', 'processing', '2026-10-01T10:00:00.000Z', null);
    const failed = await legacyRow(sql, seeded, 'failed', 'failed', '2026-10-01T11:00:00.000Z', null);

    await applyPostBaselineMigrations({ inflightPublications: 'mark_unknown' });

    const rows = await sql<{ id: number; status: string; reconcile_after: Date | null }[]>`
      select id, status, reconcile_after from scheduled_publications
      where id in (${live}, ${inflight}, ${failed}) order by id`;
    expect(rows.map((row) => [row.id, row.status, row.reconcile_after !== null])).toEqual([
      [live, 'needs_review', true],
      [inflight, 'unknown', true],
      [failed, 'failed', false],
    ]);
    const [{ count }] = await sql<{ count: number }[]>`
      select count(*)::int as count from publication_reconciliations`;
    expect(count).toBe(0);

    const constraints = await sql<{ conname: string }[]>`
      select conname from pg_constraint where conname in (
        'publication_reconciliations_source_check',
        'publication_reconciliations_outcome_check')`;
    expect(constraints).toHaveLength(2);
    const indexes = await sql<{ indexname: string }[]>`
      select indexname from pg_indexes where indexname in (
        'scheduled_pub_reconcile_idx',
        'publication_reconciliations_publication_idx',
        'publication_reconciliations_attempt_idx')`;
    expect(indexes).toHaveLength(3);
  });

  it('cascades with its publication, nulls a deleted attempt and rejects unknown enums', async () => {
    database = await createTestDatabase();
    const { sql } = database;
    const seeded = await seedChannel(sql);
    const [publication] = await sql<{ id: number }[]>`
      insert into scheduled_publications (content_item_id, workspace_id, social_account_id, scheduled_at, status)
      values (${seeded.contentItemId}, ${seeded.workspaceId}, ${seeded.socialAccountId}, now(), 'needs_review')
      returning id`;
    const [job] = await sql<{ id: number }[]>`
      insert into publication_jobs (scheduled_publication_id, status) values (${publication.id}, 'unknown')
      returning id`;
    const [entry] = await sql<{ id: number }[]>`
      insert into publication_reconciliations (scheduled_publication_id, attempt_id, source, outcome, evidence_type)
      values (${publication.id}, ${job.id}, 'automatic', 'inconclusive', 'lookup_unavailable')
      returning id`;

    await expect(sql`
      insert into publication_reconciliations (scheduled_publication_id, source, outcome, evidence_type)
      values (${publication.id}, 'robot', 'inconclusive', 'x')`).rejects.toThrow(
      /publication_reconciliations_source_check/,
    );
    await expect(sql`
      insert into publication_reconciliations (scheduled_publication_id, source, outcome, evidence_type)
      values (${publication.id}, 'operator', 'retried', 'x')`).rejects.toThrow(
      /publication_reconciliations_outcome_check/,
    );

    await sql`delete from publication_jobs where id = ${job.id}`;
    const [afterJob] = await sql<{ attempt_id: number | null }[]>`
      select attempt_id from publication_reconciliations where id = ${entry.id}`;
    expect(afterJob.attempt_id).toBeNull();

    await sql`delete from scheduled_publications where id = ${publication.id}`;
    expect(await sql`select id from publication_reconciliations where id = ${entry.id}`).toHaveLength(0);
  });
});
