# Stage 15 · PR 32A — Publication Safety Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make publication execution safe to retry, crash and replay. No logical publication may produce more than one external post because of queue retry, worker crash, schedule mutation races or ambiguous provider outcomes.

**Architecture:**
- **Ownership.** A publication is owned by exactly one attempt row (`publication_jobs`) through `scheduled_publications.active_attempt_id` and a lease. Every state write is a compare-and-set on that ownership.
- **Side-effect boundary.** Adapters declare it with an awaited `beforeSideEffect` hook, which commits a durable request marker. An expired lease after the marker always resolves to `unknown`, never to a retry.
- **Retries.** The database owns domain retries (`next_attempt_at`, persisted `dispatch_generation`). BullMQ only delivers.

**Tech Stack:** NestJS 12 + Fastify, Drizzle ORM 0.45 over postgres-js, PostgreSQL 16 (pgvector image), BullMQ 6 + ioredis, Vitest 4, `node:test`, Next.js 16.

**Spec:** `docs/architecture/STAGE_15_32A_PUBLICATION_SAFETY_SPEC.md` (rev 2). Read it first; this plan implements it section by section.

## Global Constraints

- All paths are relative to the repo root `repos/SoStats`. Branch: `feat/stage-15-32a-publication-safety`.
- API (`apps/api`) is ESM: relative imports end in `.js`. Worker (`apps/worker`) is CommonJS: relative imports have no extension.
- API formatting: Prettier `singleQuote: true`, `trailingComma: "all"`. Web uses double quotes.
- **Timestamps:** these columns are `timestamp without time zone`, and Drizzle writes JS `Date` values as UTC wall-clock time.
  - Application code must write and compare them with JS `Date` values only; never SQL `now()`.
  - Migration SQL uses `now() at time zone 'utc'`.
  - Raw postgres-js test seeds pass ISO strings (`date.toISOString()`), never `Date` objects. Drizzle replaces postgres-js date serializers.
- No new runtime dependencies. Use `AbortSignal.timeout`, `AbortSignal.any` and `node:timers/promises` from the standard library.
- Status sets (verbatim from spec §3):
  - publication: `scheduled`, `publishing`, `published`, `failed`, `cancelled`, `unknown`, `needs_review`;
  - active: `scheduled`, `publishing`, `unknown`, `needs_review`;
  - user-mutable: `scheduled`, `failed`;
  - attempt: `processing`, `completed`, `failed`, `unknown`, `abandoned`.
- Env defaults (verbatim from spec §8): `PROVIDER_HTTP_TIMEOUT_MS=30000`, `PUBLISH_PROVIDER_BUDGET_MS=120000`, `PUBLISH_EXECUTE_TIMEOUT_MS=180000`, `PUBLISH_LEASE_SECONDS=300`, `PUBLISH_MAX_ATTEMPTS=5`, `PUBLISH_TRANSPORT_ATTEMPTS=5` (falls back to `PUBLISH_MAX_ATTEMPTS`), `PUBLISH_TRANSPORT_BACKOFF_MS=30000`.
- Never log provider error messages, response bodies, tokens or signed URLs. Log `error_class` and `status_code` only. Checkpoints carry no secrets.
- Migration file: `infra/postgres/migrations/007_stage15_publication_safety.sql`, wrapped in `begin; … commit;`, forward-only.
- `oxlint` rule `typescript/no-floating-promises` is an error: every promise is awaited, returned, or assigned.
- **Real infrastructure is a hard gate.** Task 1 and Task 2 (PostgreSQL) and Task 9 (Redis) are not complete until their integration tests actually execute and pass against real services. Never replace them with mocks to keep moving.
- **Terminology.** `dispatch_generation` is queue-delivery identity on `scheduled_publications`. `attempt_number` / `attempt_count` are provider attempts on `publication_jobs`. Never derive one from the other.
- **Ledger authority.** After Task 5, every write to publication execution state goes through `PublicationLedger`: `scheduled_publications.status` / `active_attempt_id` / `lease_expires_at` / `dispatch_generation` / `attempt_count` / `next_attempt_at`, and `publication_jobs.status`. Scheduling and channel code keep only their own compare-and-set user mutations (Task 6). Every task reviewer checks this.
- **Review scope.** Task reviewers review the accumulated branch state against the spec, not only their task's diff.
- Local integration prerequisites: Docker Desktop running, then `docker compose --env-file .env -f infra/docker-compose.yml up -d db redis`.
  - `TEST_DATABASE_URL=postgres://<POSTGRES_USER>:<POSTGRES_PASSWORD>@localhost:5432/postgres`, using the values from your local `.env`. Never paste them into commits.
  - `REDIS_HOST=localhost`.

## Review Focus

1. **Channel credentials unusable at execution time** (disconnected or expired account). Expected: the publication becomes `failed` (known, pre-marker), never `unknown`, and is not retried. Test: Task 5.
2. **Media asset deleted or not ready at execution time** (`MediaService` throws `NotFoundException`). Expected: `failed_terminal` with `invalid_request`, not retried until the cap. Test: Task 5.
3. **Non-numeric or inconsistent publishing env values** (`PUBLISH_LEASE_SECONDS=5m`, lease shorter than the budget). Expected: the API refuses to boot with a message naming the variable. Test: Task 3.
4. **Execute body variants.** Generation sent as the string `"3"`, generation absent (legacy worker), or garbage. Expected: `"3"` and absent are accepted; garbage is a 400, not a 500. Test: Task 5.
5. **Instagram container never ready within the publish budget.** Expected: an abort during polling gives a retryable pre-marker failure, and `beforeSideEffect` and `media_publish` are never called. Test: Task 8.

---

### Task 1: PostgreSQL integration harness and pre-007 fixture

**Files:**
- Create: `apps/api/test/integration/pre-007-schema.sql` (generated)
- Create: `apps/api/test/integration/test-database.ts`
- Create: `apps/api/test/integration/harness.int-spec.ts`
- Create: `apps/api/vitest.config.int.ts`
- Modify: `apps/api/package.json` (scripts)
- Modify: `.github/workflows/ci.yml` (node job)

**Interfaces:**
- Produces: `createTestDatabase(options?: { migrate?: boolean }): Promise<TestDatabase>` where `TestDatabase = { db: PostgresJsDatabase<typeof schema>; sql: postgres.Sql; applyPostBaselineMigrations(options?: { inflightPublications?: 'mark_unknown' }): Promise<void>; drop(): Promise<void> }`; `postBaselineMigrationFiles(): string[]`.

- [ ] **Step 1: Generate the pre-007 fixture from the baseline commit** (before any schema edit)

```bash
mkdir -p apps/api/test/integration
git show b5b9194:apps/api/src/db/schema.ts > apps/api/test/integration/schema-b5b9194.tmp.ts
{
  printf -- '-- Test fixture: SoStats schema at b5b9194 (pre-migration 007).\n'
  printf -- '-- Generated from git show b5b9194:apps/api/src/db/schema.ts with:\n'
  printf -- '--   pnpm exec drizzle-kit export --dialect=postgresql --schema=<that file> --sql\n'
  printf -- '-- NOT a production baseline; canonical from-zero bootstrap is ST15-36.1.\n'
  printf -- '-- Pinned to b5b9194 forever: NEVER regenerate from the current schema.ts, or the\n'
  printf -- '-- migration tests stop exercising the real pre-007 -> 007 upgrade path.\n\n'
  (cd apps/api && pnpm exec drizzle-kit export --dialect=postgresql --schema=./test/integration/schema-b5b9194.tmp.ts --sql)
} > apps/api/test/integration/pre-007-schema.sql
rm apps/api/test/integration/schema-b5b9194.tmp.ts
grep -c 'CREATE TABLE' apps/api/test/integration/pre-007-schema.sql
```

Expected: `48`.

- [ ] **Step 2: Write the failing harness test**

`apps/api/test/integration/harness.int-spec.ts`:

```ts
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
```

`apps/api/vitest.config.int.ts`:

```ts
import { defineConfig } from 'vitest/config';
import tsconfigPaths from 'vite-tsconfig-paths';

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    globals: true,
    root: './',
    include: ['**/*.int-spec.ts'],
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
```

In `apps/api/package.json` `scripts`, add after `"test:e2e"`:

```json
"test:int": "vitest run --config ./vitest.config.int.ts",
```

- [ ] **Step 3: Run it to verify it fails**

Run: `pnpm --filter api test:int`
Expected: FAIL — `Cannot find module './test-database.js'` (or similar resolution error).

- [ ] **Step 4: Implement the harness**

`apps/api/test/integration/test-database.ts`:

```ts
import { randomBytes } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import postgres from 'postgres';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../src/db/schema.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../../..');
const migrationsDir = path.join(repoRoot, 'infra/postgres/migrations');

export type TestDatabase = {
  db: PostgresJsDatabase<typeof schema>;
  sql: postgres.Sql;
  applyPostBaselineMigrations(options?: {
    inflightPublications?: 'mark_unknown';
  }): Promise<void>;
  drop(): Promise<void>;
};

function adminUrl() {
  const value = process.env.TEST_DATABASE_URL;
  if (!value) {
    throw new Error(
      'TEST_DATABASE_URL is required for integration tests, e.g. postgres://user:password@localhost:5432/postgres',
    );
  }
  return value;
}

function readSql(file: string) {
  return readFileSync(file, 'utf8');
}

// ponytail: pre-007 fixture + numbered deltas after 006; from-zero bootstrap is ST15-36.1
export function postBaselineMigrationFiles() {
  return readdirSync(migrationsDir)
    .filter((file) => /^\d{3}_[a-z0-9_]+\.sql$/.test(file))
    .filter((file) => Number.parseInt(file.slice(0, 3), 10) > 6)
    .sort()
    .map((file) => path.join(migrationsDir, file));
}

export async function createTestDatabase(
  options: { migrate?: boolean } = {},
): Promise<TestDatabase> {
  const name = `sostats_int_${randomBytes(6).toString('hex')}`;
  const admin = postgres(adminUrl(), { max: 1, onnotice: () => {} });
  try {
    await admin.unsafe(`create database ${name}`);
  } finally {
    await admin.end();
  }

  const url = new URL(adminUrl());
  url.pathname = `/${name}`;
  const sql = postgres(url.toString(), { max: 10, onnotice: () => {} });
  await sql
    .unsafe(readSql(path.join(repoRoot, 'infra/postgres/init/001-pgvector.sql')))
    .simple();
  await sql.unsafe(readSql(path.join(here, 'pre-007-schema.sql'))).simple();

  const applyPostBaselineMigrations: TestDatabase['applyPostBaselineMigrations'] =
    async (migrationOptions = {}) => {
      const connection = await sql.reserve();
      try {
        if (migrationOptions.inflightPublications) {
          await connection.unsafe(
            `set sostats.inflight_publications = '${migrationOptions.inflightPublications}'`,
          );
        }
        for (const file of postBaselineMigrationFiles()) {
          try {
            await connection.unsafe(readSql(file)).simple();
          } catch (error) {
            await connection.unsafe('rollback');
            throw error;
          }
        }
      } finally {
        if (migrationOptions.inflightPublications) {
          await connection.unsafe(`set sostats.inflight_publications = ''`);
        }
        connection.release();
      }
    };

  if (options.migrate !== false) await applyPostBaselineMigrations();

  return {
    db: drizzle(sql, { schema }),
    sql,
    applyPostBaselineMigrations,
    async drop() {
      await sql.end();
      const cleanup = postgres(adminUrl(), { max: 1, onnotice: () => {} });
      try {
        await cleanup.unsafe(`drop database if exists ${name} with (force)`);
      } finally {
        await cleanup.end();
      }
    },
  };
}
```

- [ ] **Step 5: Run it to verify it passes**

Run (with db up): `TEST_DATABASE_URL=postgres://<user>:<password>@localhost:5432/postgres pnpm --filter api test:int`
Expected: PASS, 1 test.
Then run without `TEST_DATABASE_URL`. Expected: FAIL with `TEST_DATABASE_URL is required` (never a silent skip).

- [ ] **Step 6: Wire CI**

In `.github/workflows/ci.yml`, give the `node` job a Postgres service and an integration step:

```yaml
  node:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: pgvector/pgvector:pg16
        env:
          POSTGRES_USER: postgres
          POSTGRES_PASSWORD: postgres
          POSTGRES_DB: postgres
        ports:
          - 5432:5432
        options: >-
          --health-cmd "pg_isready -U postgres"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
    steps:
      # …existing steps unchanged through "Test"…

      - name: API integration tests (PostgreSQL)
        run: pnpm --filter api test:int
        env:
          TEST_DATABASE_URL: postgres://postgres:postgres@localhost:5432/postgres
```

Place the new step after `Test` and before `Build`.

- [ ] **Step 7: Typecheck and lint**

Run: `pnpm --filter api exec tsc --noEmit && pnpm --filter api lint`
Expected: no errors (existing warnings only).

- [ ] **Step 8: Commit**

```bash
git add apps/api/test/integration apps/api/vitest.config.int.ts apps/api/package.json .github/workflows/ci.yml
git commit -m "test(api): add PostgreSQL integration harness with pre-007 schema fixture"
```

---

### Task 2: Migration 007 and Drizzle schema

**Files:**
- Create: `infra/postgres/migrations/007_stage15_publication_safety.sql`
- Create: `apps/api/test/integration/seed.ts`
- Create: `apps/api/test/integration/migration-007.int-spec.ts`
- Modify: `apps/api/src/db/schema.ts` (imports; `scheduledPublications` ≈ lines 772-803; `publicationJobs` ≈ lines 806-817)
- Modify: `infra/postgres/migrations/README.md` (chain list)

**Interfaces:**
- Consumes: `createTestDatabase`, `TestDatabase` (Task 1).
- Produces:
  - Drizzle columns `scheduledPublications.{activeAttemptId, leaseExpiresAt, dispatchGeneration, attemptCount, nextAttemptAt}` and `publicationJobs.{attemptNumber, providerRequestStartedAt, completedAt, errorClass, providerOperationType, providerOperationId, providerCheckpoint}`.
  - `seedChannel(sql, provider?): Promise<SeededChannel>` with `SeededChannel = { workspaceId; brandId; socialAccountId; contentItemId }` (all numbers).
  - `createPublication(db, seeded, overrides?): Promise<typeof schema.scheduledPublications.$inferSelect>`.

- [ ] **Step 1: Write the seed helper**

`apps/api/test/integration/seed.ts`:

```ts
import type postgres from 'postgres';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../src/db/schema.js';

export type SeededChannel = {
  workspaceId: number;
  brandId: number;
  socialAccountId: number;
  contentItemId: number;
};

let counter = 0;

export async function seedChannel(
  sql: postgres.Sql,
  provider = 'x',
): Promise<SeededChannel> {
  counter += 1;
  const key = `${process.pid}-${Date.now()}-${counter}`;
  const [workspace] = await sql<{ id: number }[]>`
    insert into workspaces (name, slug) values (${`Workspace ${key}`}, ${`ws-${key}`}) returning id`;
  const [brand] = await sql<{ id: number }[]>`
    insert into brands (workspace_id, name) values (${workspace.id}, 'Brand') returning id`;
  const [account] = await sql<{ id: number }[]>`
    insert into social_accounts (workspace_id, brand_id, provider, provider_account_id, access_token, status)
    values (${workspace.id}, ${brand.id}, ${provider}, ${`acct-${key}`}, 'not-a-real-token', 'active')
    returning id`;
  const [content] = await sql<{ id: number }[]>`
    insert into content_items (workspace_id, brand_id, title, description, status)
    values (${workspace.id}, ${brand.id}, 'Launch', 'Launch day', 'approved')
    returning id`;
  return {
    workspaceId: workspace.id,
    brandId: brand.id,
    socialAccountId: account.id,
    contentItemId: content.id,
  };
}

export async function createPublication(
  db: PostgresJsDatabase<typeof schema>,
  seeded: SeededChannel,
  overrides: Partial<typeof schema.scheduledPublications.$inferInsert> = {},
) {
  const [row] = await db
    .insert(schema.scheduledPublications)
    .values({
      workspaceId: seeded.workspaceId,
      contentItemId: seeded.contentItemId,
      socialAccountId: seeded.socialAccountId,
      scheduledAt: new Date(Date.now() - 1_000),
      status: 'scheduled',
      ...overrides,
    })
    .returning();
  return row;
}
```

- [ ] **Step 2: Write the failing migration tests**

`apps/api/test/integration/migration-007.int-spec.ts`:

```ts
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
  ) {
    const [row] = await sql<{ id: number }[]>`
      insert into publication_jobs (scheduled_publication_id, status, attempts, last_attempt_at, created_at)
      values (${publicationId}, ${status}, 1, ${at(createdAt)}, ${at(createdAt)})
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
    expect(await hasColumn(sql, 'scheduled_publications', 'active_attempt_id')).toBe(false);
    const [row] = await sql<{ status: string }[]>`select status from scheduled_publications where id = ${id}`;
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

  it('fails loudly on duplicate active identities and lists them', async () => {
    const { sql, applyPostBaselineMigrations } = await legacyDatabase();
    const seeded = await seedChannel(sql);
    const a = await publication(sql, seeded, 'scheduled');
    const b = await publication(sql, seeded, 'scheduled');

    const error = (await applyPostBaselineMigrations().catch(
      (caught: unknown) => caught,
    )) as { message: string; detail?: string };
    expect(error.message).toMatch(/duplicate active publication identity/);
    expect(error.detail).toContain(`ids=[${a},${b}]`);
    const rows = await sql`select id from scheduled_publications where id in (${a}, ${b})`;
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
    const laterRejected = await publication(sql, seeded, 'failed', '2026-10-01T09:00:00Z');
    const jobA = await job(sql, laterRejected, 'failed', '2026-09-30T00:00:00Z');
    await result(sql, jobA, 'unknown_outcome', '2026-09-30T00:01:00Z');
    await result(sql, jobA, 'provider_rejected', '2026-09-30T00:02:00Z');
    const laterUnknown = await publication(sql, seeded, 'failed', '2026-10-02T09:00:00Z');
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
      scheduled: await publication(sql, seeded, 'scheduled', '2026-10-01T09:00:00Z'),
      published: await publication(sql, seeded, 'published', '2026-10-02T09:00:00Z'),
      cancelled: await publication(sql, seeded, 'cancelled', '2026-10-03T09:00:00Z'),
      failed: await publication(sql, seeded, 'failed', '2026-10-04T09:00:00Z'),
    };
    const failedJob = await job(sql, kept.failed, 'failed', '2026-09-30T00:00:00Z');
    await result(sql, failedJob, 'provider_rejected', '2026-09-30T00:01:00Z');
    const snapshot = () =>
      sql<{ id: number; status: string; scheduled_at: string; updated_at: string }[]>`
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm --filter api test:int -- migration-007`
Expected: FAIL. The clean-apply test fails (no constraints). The "not drained" test fails because nothing rejects.

- [ ] **Step 4: Write the migration**

`infra/postgres/migrations/007_stage15_publication_safety.sql`:

```sql
-- Stage 15 PR 32A: publication safety core.
-- Spec: docs/architecture/STAGE_15_32A_PUBLICATION_SAFETY_SPEC.md (§4, §13).
-- Apply after 006_stage15_transactional_outbox.sql, with publication dispatch
-- paused and drained. Deliberate fallback for rows that cannot drain: run this
-- in the same session before the file
--   set sostats.inflight_publications = 'mark_unknown';

begin;

do $$
declare
  inflight_mode text := coalesce(current_setting('sostats.inflight_publications', true), '');
  inflight_publications integer;
  inflight_attempts integer;
  unexpected text;
  duplicate_groups integer;
  duplicate_detail text;
begin
  select count(*) into inflight_publications
    from scheduled_publications where status = 'publishing';
  select count(*) into inflight_attempts
    from publication_jobs where status in ('processing', 'pending');

  if (inflight_publications > 0 or inflight_attempts > 0)
     and inflight_mode <> 'mark_unknown' then
    raise exception '007: publication dispatch is not drained (% publishing publication(s), % in-flight attempt(s))',
      inflight_publications, inflight_attempts
      using hint = 'Stop the worker and wait for in-flight executions. For rows that cannot drain, verify them on the provider, or run "set sostats.inflight_publications = ''mark_unknown'';" in the same session before this migration.';
  end if;

  select string_agg(distinct status, ', ') into unexpected
    from scheduled_publications
    where status not in ('scheduled', 'publishing', 'published', 'failed', 'cancelled');
  if unexpected is not null then
    raise exception '007: unexpected scheduled_publications.status value(s): %', unexpected;
  end if;

  select string_agg(distinct status, ', ') into unexpected
    from publication_jobs
    where status not in ('pending', 'processing', 'completed', 'failed');
  if unexpected is not null then
    raise exception '007: unexpected publication_jobs.status value(s): %', unexpected;
  end if;

  with latest_result as (
    select distinct on (j.scheduled_publication_id)
      j.scheduled_publication_id, r.error_type
    from publication_results r
    join publication_jobs j on j.id = r.publication_job_id
    order by j.scheduled_publication_id, r.created_at desc, r.id desc
  ),
  future_active as (
    select sp.id, sp.workspace_id, sp.content_item_id, sp.social_account_id, sp.scheduled_at
    from scheduled_publications sp
    left join latest_result lr on lr.scheduled_publication_id = sp.id
    where sp.status in ('scheduled', 'publishing')
       or (sp.status = 'failed' and lr.error_type = 'unknown_outcome')
  ),
  groups as (
    select workspace_id, content_item_id, social_account_id, scheduled_at,
           string_agg(id::text, ',' order by id) as ids
    from future_active
    group by workspace_id, content_item_id, social_account_id, scheduled_at
    having count(*) > 1
  ),
  numbered as (
    select g.*, row_number() over (order by workspace_id, content_item_id, social_account_id, scheduled_at) as rn
    from groups g
  )
  select count(*),
         string_agg(
           format('(workspace=%s, content_item=%s, social_account=%s, scheduled_at=%s) ids=[%s]',
                  workspace_id, content_item_id, social_account_id, scheduled_at, ids),
           E'\n') filter (where rn <= 20)
    into duplicate_groups, duplicate_detail
  from numbered;

  if duplicate_groups > 0 then
    raise exception '007: % duplicate active publication identity group(s); no rows were changed', duplicate_groups
      using detail = duplicate_detail,
            hint = 'Cancel or reschedule all but one row per group, then re-run 007. The future_active query in this file lists them.';
  end if;
end $$;

alter table scheduled_publications
  add column if not exists active_attempt_id integer
    constraint scheduled_publications_active_attempt_id_publication_jobs_id_fk
    references publication_jobs (id) on delete set null,
  add column if not exists lease_expires_at timestamp,
  add column if not exists dispatch_generation integer not null default 1,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists next_attempt_at timestamp;

alter table publication_jobs
  add column if not exists attempt_number integer not null default 1,
  add column if not exists provider_request_started_at timestamp,
  add column if not exists completed_at timestamp,
  add column if not exists error_class varchar(40),
  add column if not exists provider_operation_type varchar(80),
  add column if not exists provider_operation_id varchar(255),
  add column if not exists provider_checkpoint jsonb;

alter table publication_jobs alter column status set default 'processing';

update publication_jobs j
set attempt_number = numbered.n
from (
  select id, row_number() over (partition by scheduled_publication_id order by created_at, id) as n
  from publication_jobs
) numbered
where j.id = numbered.id;

update scheduled_publications sp
set attempt_count = coalesce((
  select j.attempts from publication_jobs j
  where j.scheduled_publication_id = sp.id
  order by j.created_at desc, j.id desc
  limit 1
), 0)
where sp.status = 'scheduled';

-- Undrained rows exist here only with the explicit mark_unknown opt-in.
update publication_jobs
set status = 'unknown',
    provider_request_started_at = coalesce(last_attempt_at, updated_at),
    completed_at = now() at time zone 'utc',
    error_class = 'unknown_outcome',
    updated_at = now() at time zone 'utc'
where status in ('processing', 'pending');

update scheduled_publications sp
set status = 'unknown',
    active_attempt_id = (
      select j.id from publication_jobs j
      where j.scheduled_publication_id = sp.id
      order by j.created_at desc, j.id desc
      limit 1
    ),
    lease_expires_at = null
where sp.status = 'publishing';

update scheduled_publications sp
set status = 'needs_review'
where sp.status = 'failed'
  and (
    select r.error_type
    from publication_results r
    join publication_jobs j on j.id = r.publication_job_id
    where j.scheduled_publication_id = sp.id
    order by r.created_at desc, r.id desc
    limit 1
  ) = 'unknown_outcome';

alter table scheduled_publications
  add constraint scheduled_publications_status_check
  check (status in ('scheduled', 'publishing', 'published', 'failed', 'cancelled', 'unknown', 'needs_review'));

alter table publication_jobs
  add constraint publication_jobs_status_check
  check (status in ('processing', 'completed', 'failed', 'unknown', 'abandoned'));

create unique index if not exists publication_jobs_attempt_unique
  on publication_jobs (scheduled_publication_id, attempt_number);

create index if not exists publication_jobs_publication_idx
  on publication_jobs (scheduled_publication_id);

create unique index if not exists scheduled_pub_active_identity_idx
  on scheduled_publications (workspace_id, content_item_id, social_account_id, scheduled_at)
  where status in ('scheduled', 'publishing', 'unknown', 'needs_review');

create index if not exists scheduled_pub_dispatch_idx
  on scheduled_publications (status, scheduled_at);

create index if not exists scheduled_pub_lease_idx
  on scheduled_publications (lease_expires_at)
  where status = 'publishing';

commit;
```

- [ ] **Step 5: Mirror the migration in the Drizzle schema**

In `apps/api/src/db/schema.ts` add `type AnyPgColumn` to the `drizzle-orm/pg-core` import list. Replace the `scheduledPublications` and `publicationJobs` definitions with:

```ts
export const scheduledPublications = pgTable(
  'scheduled_publications',
  {
    id: serial('id').primaryKey(),
    contentItemId: integer('content_item_id')
      .notNull()
      .references(() => contentItems.id, { onDelete: 'cascade' }),
    variantId: integer('variant_id').references(() => contentVariants.id, {
      onDelete: 'cascade',
    }),
    workspaceId: integer('workspace_id')
      .notNull()
      .references(() => workspaces.id, { onDelete: 'cascade' }),
    socialAccountId: integer('social_account_id')
      .notNull()
      .references(() => socialAccounts.id, { onDelete: 'cascade' }),
    scheduledAt: timestamp('scheduled_at').notNull(),
    // scheduled, publishing, published, failed, cancelled, unknown, needs_review (spec 32A §3.1)
    status: varchar('status', { length: 50 }).notNull().default('scheduled'),
    activeAttemptId: integer('active_attempt_id').references(
      (): AnyPgColumn => publicationJobs.id,
      { onDelete: 'set null' },
    ),
    leaseExpiresAt: timestamp('lease_expires_at'),
    dispatchGeneration: integer('dispatch_generation').notNull().default(1),
    attemptCount: integer('attempt_count').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at'),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => {
    return {
      scheduledPubWorkspaceIdx: index('scheduled_pub_workspace_idx').on(
        table.workspaceId,
      ),
      scheduledPubDateIdx: index('scheduled_pub_date_idx').on(
        table.scheduledAt,
      ),
      scheduledPubActiveIdentityIdx: uniqueIndex(
        'scheduled_pub_active_identity_idx',
      )
        .on(
          table.workspaceId,
          table.contentItemId,
          table.socialAccountId,
          table.scheduledAt,
        )
        .where(
          sql`${table.status} in ('scheduled', 'publishing', 'unknown', 'needs_review')`,
        ),
      scheduledPubDispatchIdx: index('scheduled_pub_dispatch_idx').on(
        table.status,
        table.scheduledAt,
      ),
      scheduledPubLeaseIdx: index('scheduled_pub_lease_idx')
        .on(table.leaseExpiresAt)
        .where(sql`${table.status} = 'publishing'`),
      scheduledPublicationsStatusCheck: check(
        'scheduled_publications_status_check',
        sql`${table.status} in ('scheduled', 'publishing', 'published', 'failed', 'cancelled', 'unknown', 'needs_review')`,
      ),
    };
  },
);

// publication_jobs — one row per provider attempt (spec 32A §4.2)
export const publicationJobs = pgTable(
  'publication_jobs',
  {
    id: serial('id').primaryKey(),
    scheduledPublicationId: integer('scheduled_publication_id')
      .notNull()
      .references(() => scheduledPublications.id, { onDelete: 'cascade' }),
    // processing, completed, failed, unknown, abandoned
    status: varchar('status', { length: 50 }).notNull().default('processing'),
    attempts: integer('attempts').notNull().default(0),
    lastAttemptAt: timestamp('last_attempt_at'),
    nextAttemptAt: timestamp('next_attempt_at'),
    attemptNumber: integer('attempt_number').notNull().default(1),
    providerRequestStartedAt: timestamp('provider_request_started_at'),
    completedAt: timestamp('completed_at'),
    errorClass: varchar('error_class', { length: 40 }),
    providerOperationType: varchar('provider_operation_type', { length: 80 }),
    providerOperationId: varchar('provider_operation_id', { length: 255 }),
    providerCheckpoint: jsonb('provider_checkpoint').$type<
      Record<string, unknown>
    >(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => ({
    publicationJobsAttemptUnique: uniqueIndex(
      'publication_jobs_attempt_unique',
    ).on(table.scheduledPublicationId, table.attemptNumber),
    publicationJobsPublicationIdx: index('publication_jobs_publication_idx').on(
      table.scheduledPublicationId,
    ),
    publicationJobsStatusCheck: check(
      'publication_jobs_status_check',
      sql`${table.status} in ('processing', 'completed', 'failed', 'unknown', 'abandoned')`,
    ),
  }),
);
```

In `infra/postgres/migrations/README.md`, append `007_stage15_publication_safety.sql` to the "Current chain" block.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter api test:int && pnpm migrations:check && pnpm --filter api exec tsc --noEmit && pnpm --filter api test`
Expected:
- all integration tests PASS, including the harness test, which now applies 007;
- `Migration chain OK: 7 file(s), 001–007`;
- no type errors;
- 75 unit tests still pass.

- [ ] **Step 7: Commit**

```bash
git add infra/postgres/migrations apps/api/src/db/schema.ts apps/api/test/integration
git commit -m "feat(db): add migration 007 publication safety schema"
```

---

### Task 3: Port contract and pure publishing primitives

**Files:**
- Create: `apps/api/src/utils/env.util.ts`
- Create: `apps/api/src/modules/channels/adapters/provider-http.ts`
- Create: `apps/api/src/modules/channels/adapters/provider-http.spec.ts`
- Create: `apps/api/src/modules/publishing/publication-state.ts`
- Create: `apps/api/src/modules/publishing/publication-outcome.ts`
- Create: `apps/api/src/modules/publishing/publication-outcome.spec.ts`
- Create: `apps/api/src/modules/publishing/publishing.config.ts`
- Create: `apps/api/src/modules/publishing/publishing.config.spec.ts`
- Modify: `apps/api/src/modules/channels/ports/SocialPublisherPort.ts`
- Modify: `apps/api/src/modules/publishing/publishing.service.ts:328-335` (transitional call site only)

**Interfaces:**
- Produces:
  - `ProviderErrorClass` (the 11 literals); `ProviderCheckpoint = { operationType: string; operationId?: string; data?: Record<string, unknown> }`.
  - `PublishContext = { providerAccountId?: string; media?: PublishMedia[]; signal: AbortSignal; beforeSideEffect(checkpoint: ProviderCheckpoint): Promise<void> }`.
  - `ProviderPublishError` gains `readonly errorClass: ProviderErrorClass` (constructor option `errorClass?`, derived when absent).
  - `positiveIntEnv(env, name, fallback): number`.
  - `providerHttpTimeoutMs(env?)`, `providerSignal(parent?: AbortSignal): AbortSignal`, `httpErrorClass(status: number): ProviderErrorClass`, `readJson<T>(response: Response): Promise<T | undefined>`.
  - Status constants and `rearmSet(now: Date, nextAttemptAt: Date | null)` from `publication-state.ts`.
  - `LeaseLostError`, `FailureDecision`, `decideFailure(error: unknown, markerSet: boolean): FailureDecision`, `failureMessage(error: unknown): string`.
  - `PUBLISHING_CONFIG`, `PublishingConfig = { providerHttpTimeoutMs; providerBudgetMs; leaseMs; maxAttempts }` (numbers), `loadPublishingConfig(env?)`, `retryDelayMs(attemptCount)`.

- [ ] **Step 1: Write the failing tests**

`apps/api/src/modules/publishing/publication-outcome.spec.ts`:

```ts
import { NotFoundException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { ProviderPublishError } from '../channels/ports/SocialPublisherPort.js';
import { decideFailure, LeaseLostError } from './publication-outcome.js';

describe('decideFailure (spec §6.1)', () => {
  const unknown = new ProviderPublishError('lost', {
    outcomeUnknown: true,
    errorClass: 'network_transient',
  });
  const retryable = new ProviderPublishError('slow down', {
    retryable: true,
    errorClass: 'rate_limit',
  });
  const terminal = new ProviderPublishError('bad', {
    errorClass: 'invalid_request',
  });

  it.each([
    [unknown, true, { kind: 'unknown', errorClass: 'network_transient', contractViolation: false }],
    [unknown, false, { kind: 'unknown', errorClass: 'network_transient', contractViolation: true }],
    [retryable, true, { kind: 'retry', errorClass: 'rate_limit' }],
    [retryable, false, { kind: 'retry', errorClass: 'rate_limit' }],
    [terminal, true, { kind: 'terminal', errorClass: 'invalid_request' }],
    [terminal, false, { kind: 'terminal', errorClass: 'invalid_request' }],
    [new TypeError('boom'), true, { kind: 'unknown', errorClass: 'internal', contractViolation: false }],
    [new TypeError('boom'), false, { kind: 'retry', errorClass: 'internal' }],
    [new NotFoundException('asset gone'), false, { kind: 'terminal', errorClass: 'invalid_request' }],
    [new NotFoundException('asset gone'), true, { kind: 'unknown', errorClass: 'internal', contractViolation: false }],
    [new LeaseLostError(1, 2), false, { kind: 'lease_lost' }],
  ])('%s with marker=%s', (error, markerSet, expected) => {
    expect(decideFailure(error, markerSet)).toEqual(expected);
  });

  it('derives an error class when an adapter omits one', () => {
    expect(new ProviderPublishError('x', { outcomeUnknown: true }).errorClass).toBe('unknown_outcome');
    expect(new ProviderPublishError('x', { retryable: true }).errorClass).toBe('transient_provider');
    expect(new ProviderPublishError('x').errorClass).toBe('permanent_provider');
  });
});
```

`apps/api/src/modules/publishing/publishing.config.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { loadPublishingConfig, retryDelayMs } from './publishing.config.js';

describe('loadPublishingConfig', () => {
  it('uses the spec defaults', () => {
    expect(loadPublishingConfig({})).toEqual({
      providerHttpTimeoutMs: 30_000,
      providerBudgetMs: 120_000,
      leaseMs: 300_000,
      maxAttempts: 5,
    });
  });

  it('rejects non-numeric values and names the variable', () => {
    expect(() => loadPublishingConfig({ PUBLISH_LEASE_SECONDS: '5m' })).toThrow(
      /PUBLISH_LEASE_SECONDS must be a positive integer/,
    );
    expect(() => loadPublishingConfig({ PUBLISH_MAX_ATTEMPTS: '0' })).toThrow(
      /PUBLISH_MAX_ATTEMPTS must be a positive integer/,
    );
  });

  it('rejects a lease that does not cover the provider budget plus 60 s', () => {
    expect(() =>
      loadPublishingConfig({
        PUBLISH_PROVIDER_BUDGET_MS: '120000',
        PUBLISH_LEASE_SECONDS: '179',
      }),
    ).toThrow(/PUBLISH_LEASE_SECONDS/);
  });

  it('rejects a per-request timeout above the whole budget', () => {
    expect(() =>
      loadPublishingConfig({
        PROVIDER_HTTP_TIMEOUT_MS: '200000',
        PUBLISH_PROVIDER_BUDGET_MS: '120000',
      }),
    ).toThrow(/PROVIDER_HTTP_TIMEOUT_MS/);
  });
});

describe('retryDelayMs', () => {
  it('doubles from 30 s and caps at 15 min', () => {
    expect([1, 2, 3, 10].map(retryDelayMs)).toEqual([
      30_000, 60_000, 120_000, 900_000,
    ]);
  });
});
```

`apps/api/src/modules/channels/adapters/provider-http.spec.ts`:

```ts
import { afterEach, describe, expect, it } from 'vitest';
import { httpErrorClass, providerSignal, readJson } from './provider-http.js';

describe('provider-http', () => {
  const original = process.env.PROVIDER_HTTP_TIMEOUT_MS;
  afterEach(() => {
    if (original === undefined) delete process.env.PROVIDER_HTTP_TIMEOUT_MS;
    else process.env.PROVIDER_HTTP_TIMEOUT_MS = original;
  });

  it.each([
    [401, 'authentication'],
    [403, 'authorization'],
    [404, 'resource_not_found'],
    [429, 'rate_limit'],
    [500, 'transient_provider'],
    [503, 'transient_provider'],
    [400, 'invalid_request'],
    [422, 'invalid_request'],
    [409, 'permanent_provider'],
  ])('classifies HTTP %i as %s', (status, expected) => {
    expect(httpErrorClass(status)).toBe(expected);
  });

  it('aborts after the per-request timeout', async () => {
    process.env.PROVIDER_HTTP_TIMEOUT_MS = '10';
    const signal = providerSignal();
    await new Promise((resolve) => signal.addEventListener('abort', resolve));
    expect(signal.aborted).toBe(true);
  });

  it('aborts when the parent budget aborts', () => {
    const parent = new AbortController();
    const signal = providerSignal(parent.signal);
    parent.abort();
    expect(signal.aborted).toBe(true);
  });

  it('returns undefined for an unparseable body', async () => {
    await expect(readJson(new Response('not json'))).resolves.toBeUndefined();
    await expect(readJson(new Response('{"id":"1"}'))).resolves.toEqual({ id: '1' });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter api exec vitest run src/modules/publishing src/modules/channels/adapters/provider-http.spec.ts`
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement**

`apps/api/src/utils/env.util.ts`:

```ts
export function positiveIntEnv(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const raw = env[name]?.trim();
  if (!raw) return fallback;
  if (!/^\d+$/.test(raw) || Number(raw) < 1) {
    throw new Error(`${name} must be a positive integer (got "${raw}")`);
  }
  return Number(raw);
}
```

In `apps/api/src/modules/channels/ports/SocialPublisherPort.ts`, replace `PublishContext` and `ProviderPublishError`, and make `publishPost`'s context required:

```ts
export type ProviderErrorClass =
  | 'authentication'
  | 'authorization'
  | 'rate_limit'
  | 'transient_provider'
  | 'network_transient'
  | 'invalid_request'
  | 'content_rejected'
  | 'resource_not_found'
  | 'unknown_outcome'
  | 'permanent_provider'
  | 'internal';

export type ProviderCheckpoint = {
  operationType: string;
  operationId?: string;
  data?: Record<string, unknown>; // non-secret only
};

export type PublishContext = {
  providerAccountId?: string;
  media?: PublishMedia[];
  signal: AbortSignal;
  /** Await immediately before the one request that can create a public post. */
  beforeSideEffect(checkpoint: ProviderCheckpoint): Promise<void>;
};

export class ProviderPublishError extends Error {
  readonly errorClass: ProviderErrorClass;
  readonly retryable: boolean;
  readonly outcomeUnknown: boolean;
  readonly statusCode?: number;

  constructor(
    message: string,
    options: {
      errorClass?: ProviderErrorClass;
      retryable?: boolean;
      outcomeUnknown?: boolean;
      statusCode?: number;
    } = {},
  ) {
    super(message);
    this.name = 'ProviderPublishError';
    this.retryable = options.retryable ?? false;
    this.outcomeUnknown = options.outcomeUnknown ?? false;
    this.statusCode = options.statusCode;
    this.errorClass =
      options.errorClass ??
      (this.outcomeUnknown
        ? 'unknown_outcome'
        : this.retryable
          ? 'transient_provider'
          : 'permanent_provider');
  }
}
```

and in `SocialPublisherPort`:

```ts
  publishPost(
    content: string,
    accessToken: string,
    context: PublishContext,
  ): Promise<PublishResult>;
```

`apps/api/src/modules/channels/adapters/provider-http.ts`:

```ts
import { positiveIntEnv } from '../../../utils/env.util.js';
import type { ProviderErrorClass } from '../ports/SocialPublisherPort.js';

export function providerHttpTimeoutMs(env: NodeJS.ProcessEnv = process.env) {
  return positiveIntEnv(env, 'PROVIDER_HTTP_TIMEOUT_MS', 30_000);
}

/** Per-request deadline, also bounded by the whole publish budget when given. */
export function providerSignal(parent?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(providerHttpTimeoutMs());
  return parent ? AbortSignal.any([parent, timeout]) : timeout;
}

export function httpErrorClass(status: number): ProviderErrorClass {
  if (status === 401) return 'authentication';
  if (status === 403) return 'authorization';
  if (status === 404) return 'resource_not_found';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'transient_provider';
  if (status === 400 || status === 422) return 'invalid_request';
  return 'permanent_provider';
}

export async function readJson<T>(response: Response): Promise<T | undefined> {
  try {
    return (await response.json()) as T;
  } catch {
    return undefined;
  }
}
```

`apps/api/src/modules/publishing/publication-state.ts`:

```ts
import { sql } from 'drizzle-orm';
import type { PgUpdateSetSource } from 'drizzle-orm/pg-core';
import * as schema from '../../db/schema.js';

export const ACTIVE_PUBLICATION_STATUSES = [
  'scheduled',
  'publishing',
  'unknown',
  'needs_review',
] as const;

/** Statuses a user may reschedule or cancel (spec §5.2). */
export const USER_MUTABLE_PUBLICATION_STATUSES = ['scheduled', 'failed'] as const;

/** Statuses that may still need the channel's credentials (spec §5.2). */
export const CREDENTIAL_DEPENDENT_PUBLICATION_STATUSES = [
  'scheduled',
  'publishing',
  'unknown',
] as const;

export const ACTIVE_IDENTITY_INDEX = 'scheduled_pub_active_identity_idx';

export function isStatusIn(status: string, statuses: readonly string[]) {
  return statuses.includes(status);
}

/** Back to `scheduled` under a new dispatch generation (spec §3.2 "re-armed"). */
export function rearmSet(
  now: Date,
  nextAttemptAt: Date | null,
): PgUpdateSetSource<typeof schema.scheduledPublications> {
  return {
    status: 'scheduled',
    dispatchGeneration: sql`${schema.scheduledPublications.dispatchGeneration} + 1`,
    activeAttemptId: null,
    leaseExpiresAt: null,
    nextAttemptAt,
    updatedAt: now,
  };
}
```

`apps/api/src/modules/publishing/publication-outcome.ts`:

```ts
import { HttpException } from '@nestjs/common';
import {
  ProviderPublishError,
  type ProviderErrorClass,
} from '../channels/ports/SocialPublisherPort.js';

export class LeaseLostError extends Error {
  constructor(
    readonly publicationId: number,
    readonly attemptId: number,
  ) {
    super(`Attempt ${attemptId} no longer owns publication ${publicationId}`);
    this.name = 'LeaseLostError';
  }
}

export type FailureDecision =
  | { kind: 'retry'; errorClass: ProviderErrorClass }
  | { kind: 'terminal'; errorClass: ProviderErrorClass }
  | {
      kind: 'unknown';
      errorClass: ProviderErrorClass;
      contractViolation: boolean;
    }
  | { kind: 'lease_lost' };

/** Spec §6.1: adapters declare semantics; the marker decides non-provider errors. */
export function decideFailure(
  error: unknown,
  markerSet: boolean,
): FailureDecision {
  if (error instanceof LeaseLostError) return { kind: 'lease_lost' };

  if (error instanceof ProviderPublishError) {
    if (error.outcomeUnknown) {
      return {
        kind: 'unknown',
        errorClass: error.errorClass,
        contractViolation: !markerSet,
      };
    }
    if (error.retryable) return { kind: 'retry', errorClass: error.errorClass };
    return { kind: 'terminal', errorClass: error.errorClass };
  }

  if (markerSet) {
    return { kind: 'unknown', errorClass: 'internal', contractViolation: false };
  }
  if (
    error instanceof HttpException &&
    error.getStatus() >= 400 &&
    error.getStatus() < 500
  ) {
    return { kind: 'terminal', errorClass: 'invalid_request' };
  }
  return { kind: 'retry', errorClass: 'internal' };
}

export function failureMessage(error: unknown) {
  return (error instanceof Error ? error.message : String(error)).slice(0, 1500);
}
```

`apps/api/src/modules/publishing/publishing.config.ts`:

```ts
import { positiveIntEnv } from '../../utils/env.util.js';
import { providerHttpTimeoutMs } from '../channels/adapters/provider-http.js';

export const PUBLISHING_CONFIG = Symbol('PUBLISHING_CONFIG');

export type PublishingConfig = {
  providerHttpTimeoutMs: number;
  providerBudgetMs: number;
  leaseMs: number;
  maxAttempts: number;
};

/** Spec §8. Throws at boot on unsafe deadline ordering. */
export function loadPublishingConfig(
  env: NodeJS.ProcessEnv = process.env,
): PublishingConfig {
  const config = {
    providerHttpTimeoutMs: providerHttpTimeoutMs(env),
    providerBudgetMs: positiveIntEnv(env, 'PUBLISH_PROVIDER_BUDGET_MS', 120_000),
    leaseMs: positiveIntEnv(env, 'PUBLISH_LEASE_SECONDS', 300) * 1000,
    maxAttempts: positiveIntEnv(env, 'PUBLISH_MAX_ATTEMPTS', 5),
  };
  if (config.providerHttpTimeoutMs > config.providerBudgetMs) {
    throw new Error(
      'PROVIDER_HTTP_TIMEOUT_MS must not exceed PUBLISH_PROVIDER_BUDGET_MS',
    );
  }
  if (config.leaseMs < config.providerBudgetMs + 60_000) {
    throw new Error(
      'PUBLISH_LEASE_SECONDS must cover PUBLISH_PROVIDER_BUDGET_MS plus 60 seconds',
    );
  }
  return config;
}

export function retryDelayMs(attemptCount: number) {
  return Math.min(15 * 60_000, 30_000 * 2 ** Math.max(0, attemptCount - 1));
}
```

In `apps/api/src/modules/publishing/publishing.service.ts`, change only the `adapter.publishPost(...)` call so it compiles against the new port. Task 5 replaces this file.

```ts
      const result = await adapter.publishPost(content, accessToken, {
        providerAccountId: account.providerAccountId,
        media,
        signal: AbortSignal.timeout(120_000),
        // Transitional (Task 3 → Task 5): Task 5 replaces this with the lease-checked marker.
        beforeSideEffect: () => Promise.resolve(),
      });
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter api test && pnpm --filter api exec tsc --noEmit && pnpm --filter api lint`
Expected: all unit tests pass (75 existing + new); no type errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/utils/env.util.ts apps/api/src/modules/channels apps/api/src/modules/publishing
git commit -m "feat(publishing): add side-effect port contract, outcome rules and deadline config"
```

---

### Task 4: PublicationLedger — ownership and state transitions

**Files:**
- Create: `apps/api/src/modules/publishing/publication-ledger.ts`
- Create: `apps/api/test/integration/publication-ledger.int-spec.ts`

**Interfaces:**
- Consumes: the Task 2 schema columns; `rearmSet`, `LeaseLostError`, `PUBLISHING_CONFIG`, `PublishingConfig`, `retryDelayMs` (Task 3); `seedChannel`, `createPublication` (Task 2).
- Produces the `PublicationLedger` class with:
  - `claim(request: ClaimRequest): Promise<ClaimedAttempt | null>`
  - `markSideEffect(claim: ClaimedAttempt, checkpoint: ProviderCheckpoint): Promise<void>` (throws `LeaseLostError`)
  - `recordSuccess(claim: ClaimedAttempt, result: PublishResult): Promise<boolean>`
  - `recordFailure(claim: ClaimedAttempt, kind: 'retry' | 'terminal' | 'unknown', errorClass: ProviderErrorClass, message: string): Promise<FailureRecord>`
  - `sweepExpiredLeases(limit?: number): Promise<SweepDecision[]>`

  Types:
  - `ClaimRequest = { publicationId: number; expectedVersion: string; expectedDispatchGeneration?: number }`
  - `ClaimedAttempt = { publicationId: number; attemptId: number; attemptNumber: number; attemptCount: number; dispatchGeneration: number }`
  - `FailureRecord = 'retry_scheduled' | 'retry_exhausted' | 'failed' | 'unknown' | 'ownership_lost'`
  - `SweepDecision = { publicationId: number; workspaceId: number; attemptId: number | null; outcome: 'unknown' | 'retry_scheduled' | 'retry_exhausted' }`

- [ ] **Step 1: Write the failing integration tests**

`apps/api/test/integration/publication-ledger.int-spec.ts`:

```ts
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
    const results = await Promise.all([claimOf(publication), claimOf(publication)]);
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
    expect((await attempt(claim.attemptId)).providerRequestStartedAt).toBeNull();
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
      ledger.recordSuccess(claim, { postId: 'post-1', url: 'https://x.com/i/web/status/post-1' }),
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

    await expect(ledger.recordSuccess(stale, { postId: 'ghost' })).resolves.toBe(false);
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
    expect(rearmed.updatedAt.getTime()).not.toBe(publication.updatedAt.getTime());

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
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter api test:int -- publication-ledger`
Expected: FAIL — `Cannot find module '../../src/modules/publishing/publication-ledger.js'`.

- [ ] **Step 3: Implement the ledger**

`apps/api/src/modules/publishing/publication-ledger.ts`:

```ts
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, gt, inArray, isNull, lte, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../db/db.module.js';
import * as schema from '../../db/schema.js';
import type {
  ProviderCheckpoint,
  ProviderErrorClass,
  PublishResult,
} from '../channels/ports/SocialPublisherPort.js';
import { LeaseLostError } from './publication-outcome.js';
import { rearmSet } from './publication-state.js';
import {
  PUBLISHING_CONFIG,
  retryDelayMs,
  type PublishingConfig,
} from './publishing.config.js';

const sp = schema.scheduledPublications;
const pj = schema.publicationJobs;
const pr = schema.publicationResults;

export type ClaimRequest = {
  publicationId: number;
  expectedVersion: string;
  expectedDispatchGeneration?: number;
};

export type ClaimedAttempt = {
  publicationId: number;
  attemptId: number;
  attemptNumber: number;
  attemptCount: number;
  dispatchGeneration: number;
};

export type FailureRecord =
  | 'retry_scheduled'
  | 'retry_exhausted'
  | 'failed'
  | 'unknown'
  | 'ownership_lost';

export type SweepDecision = {
  publicationId: number;
  workspaceId: number;
  attemptId: number | null;
  outcome: 'unknown' | 'retry_scheduled' | 'retry_exhausted';
};

/** Every publication state write for execution lives here (spec §5, I1/I4). */
@Injectable()
export class PublicationLedger {
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    @Inject(PUBLISHING_CONFIG) private readonly config: PublishingConfig,
  ) {}

  claim(request: ClaimRequest): Promise<ClaimedAttempt | null> {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const [claimed] = await tx
        .update(sp)
        .set({
          status: 'publishing',
          attemptCount: sql`${sp.attemptCount} + 1`,
          leaseExpiresAt: new Date(now.getTime() + this.config.leaseMs),
          nextAttemptAt: null,
        })
        .where(
          and(
            eq(sp.id, request.publicationId),
            eq(sp.status, 'scheduled'),
            isNull(sp.activeAttemptId),
            request.expectedDispatchGeneration === undefined
              ? eq(sp.updatedAt, new Date(request.expectedVersion))
              : eq(sp.dispatchGeneration, request.expectedDispatchGeneration),
          ),
        )
        .returning({
          attemptCount: sp.attemptCount,
          dispatchGeneration: sp.dispatchGeneration,
        });
      if (!claimed) return null;

      // The update above holds the row lock, so max+1 cannot race.
      const [{ next }] = await tx
        .select({ next: sql<number>`coalesce(max(${pj.attemptNumber}), 0) + 1` })
        .from(pj)
        .where(eq(pj.scheduledPublicationId, request.publicationId));
      const attemptNumber = Number(next);
      const [attempt] = await tx
        .insert(pj)
        .values({
          scheduledPublicationId: request.publicationId,
          status: 'processing',
          attempts: claimed.attemptCount,
          attemptNumber,
          lastAttemptAt: now,
        })
        .returning({ id: pj.id });
      await tx
        .update(sp)
        .set({ activeAttemptId: attempt.id })
        .where(eq(sp.id, request.publicationId));

      return {
        publicationId: request.publicationId,
        attemptId: attempt.id,
        attemptNumber,
        attemptCount: claimed.attemptCount,
        dispatchGeneration: claimed.dispatchGeneration,
      };
    });
  }

  /** Spec §5 step 4: durable marker, only while this attempt still holds the lease. */
  async markSideEffect(
    claim: ClaimedAttempt,
    checkpoint: ProviderCheckpoint,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const now = new Date();
      const [owned] = await tx
        .update(sp)
        .set({ leaseExpiresAt: new Date(now.getTime() + this.config.leaseMs) })
        .where(
          and(
            eq(sp.id, claim.publicationId),
            eq(sp.status, 'publishing'),
            eq(sp.activeAttemptId, claim.attemptId),
            gt(sp.leaseExpiresAt, now),
          ),
        )
        .returning({ id: sp.id });
      if (!owned) throw new LeaseLostError(claim.publicationId, claim.attemptId);

      await tx
        .update(pj)
        .set({
          providerRequestStartedAt: now,
          providerOperationType: checkpoint.operationType.slice(0, 80),
          providerOperationId: checkpoint.operationId?.slice(0, 255) ?? null,
          providerCheckpoint: checkpoint.data ?? null,
          updatedAt: now,
        })
        .where(and(eq(pj.id, claim.attemptId), eq(pj.status, 'processing')));
    });
  }

  recordSuccess(claim: ClaimedAttempt, result: PublishResult): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      await tx
        .update(pj)
        .set({ status: 'completed', completedAt: now, updatedAt: now })
        .where(
          and(
            eq(pj.id, claim.attemptId),
            inArray(pj.status, ['processing', 'unknown']),
          ),
        );
      await tx.insert(pr).values({
        publicationJobId: claim.attemptId,
        platformPostId: result.postId,
        platformPostUrl: result.url ?? null,
      });

      const [published] = await tx
        .update(sp)
        .set({ status: 'published', leaseExpiresAt: null, updatedAt: now })
        .where(
          and(
            eq(sp.id, claim.publicationId),
            inArray(sp.status, ['publishing', 'unknown']),
            eq(sp.activeAttemptId, claim.attemptId),
          ),
        )
        .returning({
          contentItemId: sp.contentItemId,
          variantId: sp.variantId,
        });
      if (!published) return false;

      if (published.variantId) {
        await tx
          .update(schema.contentVariants)
          .set({ status: 'published', publishedAt: now, updatedAt: now })
          .where(eq(schema.contentVariants.id, published.variantId));
      }

      const siblings = await tx.query.scheduledPublications.findMany({
        where: eq(sp.contentItemId, published.contentItemId),
        columns: { id: true, status: true },
      });
      const allTerminallyPublished = siblings.every(
        (sibling) =>
          sibling.id === claim.publicationId ||
          ['published', 'cancelled'].includes(sibling.status),
      );
      if (allTerminallyPublished) {
        await tx
          .update(schema.contentItems)
          .set({ status: 'published', updatedAt: now })
          .where(eq(schema.contentItems.id, published.contentItemId));
      }
      return true;
    });
  }

  recordFailure(
    claim: ClaimedAttempt,
    kind: 'retry' | 'terminal' | 'unknown',
    errorClass: ProviderErrorClass,
    message: string,
  ): Promise<FailureRecord> {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      await tx.insert(pr).values({
        publicationJobId: claim.attemptId,
        errorType: errorClass,
        errorMessage: message.slice(0, 1500),
      });

      const [current] = await tx
        .select({
          status: sp.status,
          activeAttemptId: sp.activeAttemptId,
          attemptCount: sp.attemptCount,
        })
        .from(sp)
        .where(eq(sp.id, claim.publicationId))
        .for('update');
      if (
        !current ||
        current.status !== 'publishing' ||
        current.activeAttemptId !== claim.attemptId
      ) {
        // Late outcome from a non-owner: the result row is the only record (spec §5 step 5).
        return 'ownership_lost';
      }

      if (kind === 'unknown') {
        await tx
          .update(pj)
          .set({ status: 'unknown', errorClass, completedAt: now, updatedAt: now })
          .where(eq(pj.id, claim.attemptId));
        await tx
          .update(sp)
          .set({ status: 'unknown', leaseExpiresAt: null, updatedAt: now })
          .where(eq(sp.id, claim.publicationId));
        return 'unknown';
      }

      await tx
        .update(pj)
        .set({ status: 'failed', errorClass, completedAt: now, updatedAt: now })
        .where(eq(pj.id, claim.attemptId));

      if (kind === 'terminal') {
        await tx
          .update(sp)
          .set({ status: 'failed', leaseExpiresAt: null, updatedAt: now })
          .where(eq(sp.id, claim.publicationId));
        return 'failed';
      }

      if (current.attemptCount >= this.config.maxAttempts) {
        await tx.insert(pr).values({
          publicationJobId: claim.attemptId,
          errorType: 'retry_exhausted',
          errorMessage: `Stopped after ${current.attemptCount} attempt(s)`,
        });
        await tx
          .update(sp)
          .set({ status: 'failed', leaseExpiresAt: null, updatedAt: now })
          .where(eq(sp.id, claim.publicationId));
        return 'retry_exhausted';
      }

      await tx
        .update(sp)
        .set(
          rearmSet(
            now,
            new Date(now.getTime() + retryDelayMs(current.attemptCount)),
          ),
        )
        .where(eq(sp.id, claim.publicationId));
      return 'retry_scheduled';
    });
  }

  /** Spec §5.1. Each row is re-checked under its lock before any write (I4). */
  async sweepExpiredLeases(limit = 50): Promise<SweepDecision[]> {
    const candidates = await this.db
      .select({ id: sp.id })
      .from(sp)
      .where(and(eq(sp.status, 'publishing'), lte(sp.leaseExpiresAt, new Date())))
      .limit(limit);

    const decisions: SweepDecision[] = [];
    for (const candidate of candidates) {
      const decision = await this.db.transaction(
        async (tx): Promise<SweepDecision | null> => {
          const now = new Date();
          const [row] = await tx
            .select({
              workspaceId: sp.workspaceId,
              activeAttemptId: sp.activeAttemptId,
              attemptCount: sp.attemptCount,
            })
            .from(sp)
            .where(
              and(
                eq(sp.id, candidate.id),
                eq(sp.status, 'publishing'),
                lte(sp.leaseExpiresAt, now),
              ),
            )
            .for('update');
          if (!row) return null;

          const attempt =
            row.activeAttemptId === null
              ? undefined
              : await tx.query.publicationJobs.findFirst({
                  where: eq(pj.id, row.activeAttemptId),
                });
          const base = {
            publicationId: candidate.id,
            workspaceId: row.workspaceId,
            attemptId: attempt?.id ?? null,
          };

          if (attempt?.providerRequestStartedAt) {
            await tx
              .update(pj)
              .set({
                status: 'unknown',
                errorClass: 'unknown_outcome',
                completedAt: now,
                updatedAt: now,
              })
              .where(and(eq(pj.id, attempt.id), eq(pj.status, 'processing')));
            await tx.insert(pr).values({
              publicationJobId: attempt.id,
              errorType: 'unknown_outcome',
              errorMessage:
                'Lease expired after the provider request started; the outcome is unconfirmed.',
            });
            await tx
              .update(sp)
              .set({ status: 'unknown', leaseExpiresAt: null, updatedAt: now })
              .where(eq(sp.id, candidate.id));
            return { ...base, outcome: 'unknown' };
          }

          if (attempt) {
            await tx
              .update(pj)
              .set({
                status: 'abandoned',
                errorClass: 'internal',
                completedAt: now,
                updatedAt: now,
              })
              .where(and(eq(pj.id, attempt.id), eq(pj.status, 'processing')));
            await tx.insert(pr).values({
              publicationJobId: attempt.id,
              errorType: 'lease_expired_before_request',
              errorMessage: 'Lease expired before the provider request started.',
            });
          }

          if (row.attemptCount >= this.config.maxAttempts) {
            await tx
              .update(sp)
              .set({ status: 'failed', leaseExpiresAt: null, updatedAt: now })
              .where(eq(sp.id, candidate.id));
            return { ...base, outcome: 'retry_exhausted' };
          }

          await tx
            .update(sp)
            .set(
              rearmSet(
                now,
                new Date(now.getTime() + retryDelayMs(row.attemptCount)),
              ),
            )
            .where(eq(sp.id, candidate.id));
          return { ...base, outcome: 'retry_scheduled' };
        },
      );
      if (decision) decisions.push(decision);
    }
    return decisions;
  }
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter api test:int -- publication-ledger && pnpm --filter api exec tsc --noEmit && pnpm --filter api lint`
Expected: 13 ledger tests PASS; no type or lint errors.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/publishing/publication-ledger.ts apps/api/test/integration/publication-ledger.int-spec.ts
git commit -m "feat(publishing): add lease-owned publication ledger with CAS recovery"
```

---

### Task 5: PublishingService orchestration, controller and wiring

**Files:**
- Modify (full replacement): `apps/api/src/modules/publishing/publishing.service.ts`
- Modify: `apps/api/src/modules/publishing/publishing.controller.ts`
- Modify: `apps/api/src/modules/publishing/publishing.module.ts`
- Create: `apps/api/src/modules/publishing/publishing.controller.spec.ts`
- Create: `apps/api/test/integration/publishing-support.ts`
- Create: `apps/api/test/integration/publishing.service.int-spec.ts`

**Interfaces:**
- Consumes: everything from Tasks 3–4.
- Produces:
  - `PublishingService.execute(id: number, request: ExecuteRequest): Promise<ExecuteResult>`
  - `PublishingService.listDispatchable(until?, offset?, limit?): Promise<DispatchablePublication[]>`
  - `PublishingService.deadLetter(id: number)`
  - `parseExecuteBody(body: unknown): ExecuteRequest`

  Types:
  - `ExecuteRequest = { expectedVersion: string; expectedDispatchGeneration?: number; queueJobId?: string }`
  - `ExecuteResult.status` ∈ `published | already_published | stale | terminal | in_progress | outcome_unknown | retry_scheduled | failed_terminal`
  - `DispatchablePublication = { id: number; scheduledAt: string; nextAttemptAt: string | null; updatedAt: string; dispatchGeneration: number }`

  These are the HTTP contracts the worker consumes in Task 9.

- [ ] **Step 1: Write the failing controller unit test (Review Focus 4)**

`apps/api/src/modules/publishing/publishing.controller.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { parseExecuteBody } from './publishing.controller.js';

describe('parseExecuteBody', () => {
  const version = '2026-09-30T00:00:00.000Z';

  it('accepts a numeric string generation from JSON', () => {
    expect(
      parseExecuteBody({ expectedVersion: version, expectedDispatchGeneration: '3' }),
    ).toEqual({ expectedVersion: version, expectedDispatchGeneration: 3, queueJobId: undefined });
  });

  it('treats a missing generation as a legacy version-only request', () => {
    expect(parseExecuteBody({ expectedVersion: version })).toEqual({
      expectedVersion: version,
      expectedDispatchGeneration: undefined,
      queueJobId: undefined,
    });
  });

  it.each([
    { expectedVersion: version, expectedDispatchGeneration: 'abc' },
    { expectedVersion: version, expectedDispatchGeneration: 0 },
    { expectedVersion: 'not-a-date' },
    {},
    null,
  ])('rejects %j with 400', (body) => {
    expect(() => parseExecuteBody(body)).toThrow(BadRequestException);
  });

  it('keeps a string queue job id and drops anything else', () => {
    expect(parseExecuteBody({ expectedVersion: version, queueJobId: 'job-1' }).queueJobId).toBe('job-1');
    expect(parseExecuteBody({ expectedVersion: version, queueJobId: 7 }).queueJobId).toBeUndefined();
  });
});
```

- [ ] **Step 2: Write the failing service integration tests**

`apps/api/test/integration/publishing-support.ts`:

```ts
import { vi } from 'vitest';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../src/db/schema.js';
import type { AuditLogService } from '../../src/common/audit/audit-log.service.js';
import type { ChannelCredentialService } from '../../src/modules/channels/channel-credential.service.js';
import type { ProviderRegistry } from '../../src/modules/channels/ProviderRegistry.js';
import type {
  PublishContext,
  PublishResult,
  SocialPublisherPort,
} from '../../src/modules/channels/ports/SocialPublisherPort.js';
import type { MediaService } from '../../src/modules/media/media.service.js';
import { PublicationLedger } from '../../src/modules/publishing/publication-ledger.js';
import {
  loadPublishingConfig,
  type PublishingConfig,
} from '../../src/modules/publishing/publishing.config.js';
import { PublishingService } from '../../src/modules/publishing/publishing.service.js';

export type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
};

export function deferred<T = void>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export class ScriptedAdapter implements SocialPublisherPort {
  readonly providerName = 'x';
  readonly capabilities = {
    text: true,
    images: false,
    video: false,
    carousel: false,
    analytics: false,
    nativeScheduling: false,
  };
  calls = 0;
  sent = 0;

  constructor(
    private readonly script: (
      context: PublishContext,
      adapter: ScriptedAdapter,
    ) => Promise<PublishResult>,
  ) {}

  publishPost(_content: string, _token: string, context: PublishContext) {
    this.calls += 1;
    return this.script(context, this);
  }

  /** Marker, then count the simulated external request. */
  async send(context: PublishContext) {
    await context.beforeSideEffect({ operationType: 'test_create_post' });
    this.sent += 1;
  }

  getAuthUrl(): string {
    throw new Error('not used');
  }
  exchangeToken(): Promise<never> {
    throw new Error('not used');
  }
  refreshAccessToken(): Promise<never> {
    throw new Error('not used');
  }
}

export function buildPublishing(
  db: PostgresJsDatabase<typeof schema>,
  adapter: SocialPublisherPort,
  options: {
    config?: Partial<PublishingConfig>;
    credentials?: Partial<ChannelCredentialService>;
    media?: Partial<MediaService>;
  } = {},
) {
  const config = { ...loadPublishingConfig({}), ...options.config };
  const ledger = new PublicationLedger(db, config);
  const audit = { record: vi.fn(async () => undefined) };
  const service = new PublishingService(
    db,
    { getProvider: () => adapter } as unknown as ProviderRegistry,
    (options.credentials ?? {
      getValidAccessToken: async () => 'token',
    }) as unknown as ChannelCredentialService,
    (options.media ?? {
      getProviderPublishMedia: async () => [],
    }) as unknown as MediaService,
    audit as unknown as AuditLogService,
    ledger,
    config,
  );
  return { service, ledger, audit, config };
}
```

`apps/api/test/integration/publishing.service.int-spec.ts`:

```ts
import { NotFoundException } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import * as schema from '../../src/db/schema.js';
import { ProviderPublishError } from '../../src/modules/channels/ports/SocialPublisherPort.js';
import { createTestDatabase, type TestDatabase } from './test-database.js';
import { createPublication, seedChannel } from './seed.js';
import { buildPublishing, deferred, ScriptedAdapter } from './publishing-support.js';

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
    return createPublication(database.db, await seedChannel(database.sql), overrides);
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

    await expect(service.execute(publication.id, request(publication))).resolves.toMatchObject({
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

    const statuses = (await Promise.all(executions)).map((result) => result.status);
    expect(statuses).toContain('published');
    expect(adapter.calls).toBe(1);
  });

  it('re-arms an adapter-declared retry under a new generation; the old job is stale', async () => {
    const adapter = new ScriptedAdapter(async (context, self) => {
      await self.send(context);
      throw new ProviderPublishError('HTTP 429', { retryable: true, errorClass: 'rate_limit', statusCode: 429 });
    });
    const { service } = buildPublishing(database.db, adapter);
    const publication = await scheduled();

    await expect(service.execute(publication.id, request(publication))).resolves.toMatchObject({
      status: 'retry_scheduled',
    });
    const rearmed = await reload(publication.id);
    expect(rearmed.dispatchGeneration).toBe(publication.dispatchGeneration + 1);
    expect(rearmed.nextAttemptAt).toBeInstanceOf(Date);
    await expect(service.execute(publication.id, request(publication))).resolves.toMatchObject({
      status: 'stale',
    });
    expect(adapter.calls).toBe(1);
  });

  it('moves an adapter-declared unknown outcome to unknown and never runs it again', async () => {
    const adapter = new ScriptedAdapter(async (context, self) => {
      await self.send(context);
      throw new ProviderPublishError('reset', { outcomeUnknown: true, errorClass: 'network_transient' });
    });
    const { service, audit } = buildPublishing(database.db, adapter);
    const publication = await scheduled();

    await expect(service.execute(publication.id, request(publication))).resolves.toMatchObject({
      status: 'outcome_unknown',
    });
    await expect(service.execute(publication.id, request(publication))).resolves.toMatchObject({
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

    await expect(service.execute(publication.id, request(publication))).resolves.toMatchObject({
      status: 'outcome_unknown',
    });
  });

  it('retries an internal error before the marker', async () => {
    const adapter = new ScriptedAdapter(async () => {
      throw new TypeError('bug before the request');
    });
    const { service } = buildPublishing(database.db, adapter);
    const publication = await scheduled();

    await expect(service.execute(publication.id, request(publication))).resolves.toMatchObject({
      status: 'retry_scheduled',
    });
  });

  it('fails without retry when channel credentials are unusable (Review Focus 1)', async () => {
    const adapter = new ScriptedAdapter(async () => ({ postId: 'never' }));
    const { service } = buildPublishing(database.db, adapter, {
      credentials: {
        getValidAccessToken: async () => {
          throw new ProviderPublishError('disconnected', { errorClass: 'authentication' });
        },
      },
    });
    const publication = await scheduled();

    await expect(service.execute(publication.id, request(publication))).resolves.toMatchObject({
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

    await expect(service.execute(publication.id, request(publication))).resolves.toMatchObject({
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
      throw new ProviderPublishError('HTTP 503 before send', { retryable: true, errorClass: 'transient_provider' });
    });
    const { service } = buildPublishing(database.db, adapter, { config: { maxAttempts: 2 } });
    const publication = await scheduled();

    await service.execute(publication.id, request(publication));
    const rearmed = await reload(publication.id);
    await database.db.update(sp).set({ nextAttemptAt: null }).where(eq(sp.id, publication.id));
    await expect(service.execute(publication.id, request(rearmed))).resolves.toMatchObject({
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

    await expect(service.execute(publication.id, request(publication))).resolves.toMatchObject({
      status: 'outcome_unknown',
    });
  });

  it('lists only due publications with their dispatch generation', async () => {
    const { service } = buildPublishing(database.db, new ScriptedAdapter(async () => ({ postId: 'x' })));
    const later = await scheduled({ nextAttemptAt: new Date(Date.now() + 10 * 60_000) });

    const defaultHorizon = await service.listDispatchable(undefined, 0, 500);
    expect(defaultHorizon.map((row) => row.id)).not.toContain(later.id);

    const wide = await service.listDispatchable(new Date(Date.now() + 20 * 60_000).toISOString(), 0, 500);
    expect(wide).toContainEqual(
      expect.objectContaining({ id: later.id, dispatchGeneration: later.dispatchGeneration }),
    );
  });

  it('makes the legacy dead-letter endpoint a no-op', async () => {
    const { service } = buildPublishing(database.db, new ScriptedAdapter(async () => ({ postId: 'x' })));
    const publication = await scheduled();

    await expect(service.deadLetter(publication.id)).resolves.toEqual({
      status: 'scheduled',
      scheduledPublicationId: publication.id,
    });
    expect((await reload(publication.id)).status).toBe('scheduled');
  });
});
```

- [ ] **Step 3: Run them to verify they fail**

Run: `pnpm --filter api exec vitest run src/modules/publishing/publishing.controller.spec.ts; pnpm --filter api test:int -- publishing.service`
Expected: FAIL — `parseExecuteBody` is not exported, and `PublishingService` has the old constructor and signature.

- [ ] **Step 4: Replace the service**

`apps/api/src/modules/publishing/publishing.service.ts` (whole file):

```ts
import {
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, eq, isNull, lte, or } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../db/db.module.js';
import * as schema from '../../db/schema.js';
import { AuditLogService } from '../../common/audit/audit-log.service.js';
import { ProviderRegistry } from '../channels/ProviderRegistry.js';
import { ChannelCredentialService } from '../channels/channel-credential.service.js';
import {
  ProviderPublishError,
  type PublishResult,
} from '../channels/ports/SocialPublisherPort.js';
import { MediaService } from '../media/media.service.js';
import {
  PublicationLedger,
  type ClaimedAttempt,
  type FailureRecord,
} from './publication-ledger.js';
import {
  decideFailure,
  failureMessage,
  type FailureDecision,
} from './publication-outcome.js';
import { PUBLISHING_CONFIG, type PublishingConfig } from './publishing.config.js';

const sp = schema.scheduledPublications;
const DUE_TOLERANCE_MS = 10_000;

export type DispatchablePublication = {
  id: number;
  scheduledAt: string;
  nextAttemptAt: string | null;
  updatedAt: string;
  dispatchGeneration: number;
};

export type ExecuteRequest = {
  expectedVersion: string;
  expectedDispatchGeneration?: number;
  queueJobId?: string;
};

export type ExecuteResult =
  | {
      status: 'published' | 'already_published';
      scheduledPublicationId: number;
      platformPostId?: string | null;
      platformPostUrl?: string | null;
    }
  | {
      status:
        | 'stale'
        | 'terminal'
        | 'in_progress'
        | 'outcome_unknown'
        | 'retry_scheduled';
      scheduledPublicationId: number;
    }
  | { status: 'failed_terminal'; scheduledPublicationId: number; reason: string };

type AttemptOutcome =
  | { kind: 'success'; result: PublishResult; published: boolean }
  | { kind: 'lease_lost' }
  | {
      kind: 'failure';
      decision: Exclude<FailureDecision, { kind: 'lease_lost' }>;
      recorded: FailureRecord;
      message: string;
      statusCode: number | null;
    };

@Injectable()
export class PublishingService {
  private readonly logger = new Logger(PublishingService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly providerRegistry: ProviderRegistry,
    private readonly credentials: ChannelCredentialService,
    private readonly mediaService: MediaService,
    private readonly audit: AuditLogService,
    private readonly ledger: PublicationLedger,
    @Inject(PUBLISHING_CONFIG) private readonly config: PublishingConfig,
  ) {}

  async listDispatchable(
    until?: string,
    offset = 0,
    limit = 250,
  ): Promise<DispatchablePublication[]> {
    const swept = await this.ledger.sweepExpiredLeases();
    for (const decision of swept) {
      this.logEvent('publication.sweep', {
        workspace_id: decision.workspaceId,
        publication_id: decision.publicationId,
        attempt_id: decision.attemptId,
        outcome: decision.outcome,
      });
      if (decision.outcome !== 'retry_scheduled') {
        await this.safeAudit(
          decision.workspaceId,
          decision.publicationId,
          decision.outcome === 'unknown'
            ? 'publication.outcome_unknown'
            : 'publication.failed',
          { attemptId: decision.attemptId, errorType: decision.outcome },
        );
      }
    }

    const horizon = until ? new Date(until) : new Date(Date.now() + 120_000);
    if (Number.isNaN(horizon.getTime())) {
      throw new ConflictException('Invalid dispatch horizon');
    }

    const records = await this.db.query.scheduledPublications.findMany({
      where: and(
        eq(sp.status, 'scheduled'),
        lte(sp.scheduledAt, horizon),
        or(isNull(sp.nextAttemptAt), lte(sp.nextAttemptAt, horizon)),
      ),
      orderBy: (fields, { asc }) => [asc(fields.scheduledAt), asc(fields.id)],
      limit: Math.min(500, Math.max(1, limit)),
      offset: Math.max(0, offset),
    });

    return records.map((record) => ({
      id: record.id,
      scheduledAt: record.scheduledAt.toISOString(),
      nextAttemptAt: record.nextAttemptAt?.toISOString() ?? null,
      updatedAt: record.updatedAt.toISOString(),
      dispatchGeneration: record.dispatchGeneration,
    }));
  }

  async execute(id: number, request: ExecuteRequest): Promise<ExecuteResult> {
    const publication = await this.getPublication(id);
    const gate = this.gate(publication, request);
    if (gate) return gate;

    const dueLimit = Date.now() + DUE_TOLERANCE_MS;
    if (
      publication.scheduledAt.getTime() > dueLimit ||
      (publication.nextAttemptAt &&
        publication.nextAttemptAt.getTime() > dueLimit)
    ) {
      throw new ConflictException('Scheduled publication is not due yet');
    }

    const claim = await this.ledger.claim({
      publicationId: id,
      expectedVersion: request.expectedVersion,
      expectedDispatchGeneration: request.expectedDispatchGeneration,
    });
    if (!claim) {
      return (
        this.gate(await this.getPublication(id), request) ?? {
          status: 'in_progress',
          scheduledPublicationId: id,
        }
      );
    }

    const marker = { set: false };
    let outcome: AttemptOutcome;
    try {
      const account = publication.socialAccount;
      const adapter = this.providerRegistry.getProvider(account.provider);
      const accessToken = await this.credentials.getValidAccessToken(
        account,
        adapter,
      );
      const content =
        publication.variant?.content ||
        publication.contentItem.description ||
        publication.contentItem.title;
      const media = await this.mediaService.getProviderPublishMedia(
        publication.workspaceId,
        publication.contentItemId,
        publication.variantId || undefined,
      );

      const result = await adapter.publishPost(content, accessToken, {
        providerAccountId: account.providerAccountId,
        media,
        signal: AbortSignal.timeout(this.config.providerBudgetMs),
        beforeSideEffect: async (checkpoint) => {
          await this.ledger.markSideEffect(claim, checkpoint);
          marker.set = true;
        },
      });
      outcome = {
        kind: 'success',
        result,
        published: await this.ledger.recordSuccess(claim, result),
      };
    } catch (error) {
      outcome = await this.recordError(claim, error, marker.set);
    }

    return this.finish(publication, claim, outcome, request.queueJobId, marker.set);
  }

  async deadLetter(id: number) {
    const publication = await this.db.query.scheduledPublications.findFirst({
      where: eq(sp.id, id),
      columns: { id: true, status: true },
    });
    if (!publication) {
      throw new NotFoundException('Scheduled publication not found');
    }
    // Spec I8 / §5.3: transport exhaustion never changes publication state.
    this.logEvent('publication.transport_exhausted', {
      publication_id: id,
      status: publication.status,
      source: 'legacy_dead_letter',
    });
    return { status: publication.status, scheduledPublicationId: id };
  }

  private async getPublication(id: number) {
    const publication = await this.db.query.scheduledPublications.findFirst({
      where: eq(sp.id, id),
      with: {
        contentItem: true,
        variant: true,
        socialAccount: true,
        jobs: { with: { results: true } },
      },
    });
    if (!publication) {
      throw new NotFoundException('Scheduled publication not found');
    }
    return publication;
  }

  private gate(
    publication: Awaited<ReturnType<PublishingService['getPublication']>>,
    request: ExecuteRequest,
  ): ExecuteResult | null {
    const scheduledPublicationId = publication.id;
    switch (publication.status) {
      case 'published': {
        const result = publication.jobs
          .flatMap((job) => job.results)
          .filter((row) => row.platformPostId)
          .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
        return {
          status: 'already_published',
          scheduledPublicationId,
          platformPostId: result?.platformPostId ?? null,
          platformPostUrl: result?.platformPostUrl ?? null,
        };
      }
      case 'failed':
      case 'cancelled':
        return { status: 'terminal', scheduledPublicationId };
      case 'unknown':
      case 'needs_review':
        return { status: 'outcome_unknown', scheduledPublicationId };
      case 'publishing':
        return { status: 'in_progress', scheduledPublicationId };
    }

    const stale =
      request.expectedDispatchGeneration === undefined
        ? publication.updatedAt.toISOString() !== request.expectedVersion
        : publication.dispatchGeneration !== request.expectedDispatchGeneration;
    return stale ? { status: 'stale', scheduledPublicationId } : null;
  }

  private async recordError(
    claim: ClaimedAttempt,
    error: unknown,
    markerSet: boolean,
  ): Promise<AttemptOutcome> {
    const decision = decideFailure(error, markerSet);
    if (decision.kind === 'lease_lost') return { kind: 'lease_lost' };

    const message = failureMessage(error);
    const recorded = await this.ledger.recordFailure(
      claim,
      decision.kind,
      decision.errorClass,
      message,
    );
    return {
      kind: 'failure',
      decision,
      recorded,
      message,
      statusCode:
        error instanceof ProviderPublishError ? (error.statusCode ?? null) : null,
    };
  }

  private async finish(
    publication: Awaited<ReturnType<PublishingService['getPublication']>>,
    claim: ClaimedAttempt,
    outcome: AttemptOutcome,
    queueJobId: string | undefined,
    markerSet: boolean,
  ): Promise<ExecuteResult> {
    const scheduledPublicationId = publication.id;
    const fields = {
      workspace_id: publication.workspaceId,
      publication_id: scheduledPublicationId,
      attempt_id: claim.attemptId,
      attempt_number: claim.attemptNumber,
      attempt_count: claim.attemptCount,
      dispatch_generation: claim.dispatchGeneration,
      provider: publication.socialAccount.provider,
      social_account_id: publication.socialAccountId,
      queue_job_id: queueJobId ?? null,
      marker_set: markerSet,
    };
    const auditBase = {
      contentItemId: publication.contentItemId,
      variantId: publication.variantId,
      socialAccountId: publication.socialAccountId,
      provider: publication.socialAccount.provider,
      attemptId: claim.attemptId,
    };

    if (outcome.kind === 'success') {
      this.logEvent('publication.attempt', {
        ...fields,
        outcome: outcome.published ? 'published' : 'ownership_lost_after_success',
        error_class: null,
        status_code: null,
      });
      if (!outcome.published) {
        return { status: 'in_progress', scheduledPublicationId };
      }
      await this.safeAudit(
        publication.workspaceId,
        scheduledPublicationId,
        'publication.published',
        {
          ...auditBase,
          platformPostId: outcome.result.postId,
          platformPostUrl: outcome.result.url,
        },
      );
      return {
        status: 'published',
        scheduledPublicationId,
        platformPostId: outcome.result.postId,
        platformPostUrl: outcome.result.url,
      };
    }

    if (outcome.kind === 'lease_lost') {
      this.logEvent('publication.attempt', {
        ...fields,
        outcome: 'lease_lost',
        error_class: null,
        status_code: null,
      });
      return { status: 'in_progress', scheduledPublicationId };
    }

    this.logEvent('publication.attempt', {
      ...fields,
      outcome: outcome.recorded,
      error_class: outcome.decision.errorClass,
      status_code: outcome.statusCode,
      contract_violation:
        outcome.decision.kind === 'unknown'
          ? outcome.decision.contractViolation
          : false,
    });

    switch (outcome.recorded) {
      case 'retry_scheduled':
        return { status: 'retry_scheduled', scheduledPublicationId };
      case 'unknown':
        await this.safeAudit(
          publication.workspaceId,
          scheduledPublicationId,
          'publication.outcome_unknown',
          { ...auditBase, errorType: outcome.decision.errorClass },
        );
        return { status: 'outcome_unknown', scheduledPublicationId };
      case 'failed':
      case 'retry_exhausted':
        await this.safeAudit(
          publication.workspaceId,
          scheduledPublicationId,
          'publication.failed',
          {
            ...auditBase,
            errorType:
              outcome.recorded === 'retry_exhausted'
                ? 'retry_exhausted'
                : outcome.decision.errorClass,
          },
        );
        return {
          status: 'failed_terminal',
          scheduledPublicationId,
          reason: outcome.message,
        };
      case 'ownership_lost':
        return { status: 'in_progress', scheduledPublicationId };
    }
  }

  /** Audit is post-commit until #33; its failure must never change the committed outcome. */
  private async safeAudit(
    workspaceId: number,
    scheduledPublicationId: number,
    action: string,
    metadata: Record<string, unknown>,
  ) {
    try {
      await this.audit.record({
        workspaceId,
        actor: { userId: null, email: null, authMethod: 'system' },
        action,
        targetType: 'scheduled_publication',
        targetId: scheduledPublicationId,
        metadata,
      });
    } catch {
      this.logEvent('publication.audit_failed', {
        workspace_id: workspaceId,
        publication_id: scheduledPublicationId,
        action,
      });
    }
  }

  private logEvent(event: string, fields: Record<string, unknown>) {
    this.logger.log(JSON.stringify({ event, ...fields }));
  }
}
```

- [ ] **Step 5: Update the controller and the module**

`apps/api/src/modules/publishing/publishing.controller.ts` (whole file):

```ts
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/auth/public.decorator.js';
import { WorkerTokenGuard } from '../../common/internal/worker-token.guard.js';
import {
  PublishingService,
  type ExecuteRequest,
} from './publishing.service.js';

export function parseExecuteBody(body: unknown): ExecuteRequest {
  const input = (body && typeof body === 'object' ? body : {}) as Record<
    string,
    unknown
  >;
  if (
    typeof input.expectedVersion !== 'string' ||
    Number.isNaN(Date.parse(input.expectedVersion))
  ) {
    throw new BadRequestException('expectedVersion must be an ISO timestamp');
  }

  let expectedDispatchGeneration: number | undefined;
  const raw = input.expectedDispatchGeneration;
  if (raw !== undefined && raw !== null) {
    const parsed =
      typeof raw === 'number'
        ? raw
        : typeof raw === 'string' && /^\d+$/.test(raw)
          ? Number(raw)
          : Number.NaN;
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new BadRequestException(
        'expectedDispatchGeneration must be a positive integer',
      );
    }
    expectedDispatchGeneration = parsed;
  }

  return {
    expectedVersion: input.expectedVersion,
    expectedDispatchGeneration,
    queueJobId:
      typeof input.queueJobId === 'string'
        ? input.queueJobId.slice(0, 200)
        : undefined,
  };
}

@Public()
@SkipThrottle()
@UseGuards(WorkerTokenGuard)
@Controller('internal/publications')
export class PublishingController {
  constructor(private readonly publishingService: PublishingService) {}

  @Get('dispatchable')
  dispatchable(
    @Query('until') until?: string,
    @Query('offset') offset?: string,
    @Query('limit') limit?: string,
  ) {
    return this.publishingService.listDispatchable(
      until,
      offset ? Number.parseInt(offset, 10) : 0,
      limit ? Number.parseInt(limit, 10) : 250,
    );
  }

  @Post(':id/execute')
  @HttpCode(200)
  execute(@Param('id', ParseIntPipe) id: number, @Body() body: unknown) {
    return this.publishingService.execute(id, parseExecuteBody(body));
  }

  /** Legacy workers only; a no-op per spec §5.3. */
  @Post(':id/dead-letter')
  @HttpCode(200)
  deadLetter(@Param('id', ParseIntPipe) id: number) {
    return this.publishingService.deadLetter(id);
  }
}
```

In `apps/api/src/modules/publishing/publishing.module.ts`, add the new imports:

```ts
import { PublicationLedger } from './publication-ledger.js';
import { loadPublishingConfig, PUBLISHING_CONFIG } from './publishing.config.js';
```

Then replace `providers` with:

```ts
  providers: [
    PublishingService,
    PublicationLedger,
    WorkerTokenGuard,
    { provide: PUBLISHING_CONFIG, useFactory: () => loadPublishingConfig() },
  ],
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter api test && pnpm --filter api test:int && pnpm --filter api exec tsc --noEmit && pnpm --filter api lint`
Expected: all unit and integration tests PASS; no type or lint errors.

- [ ] **Step 7: Verify ledger authority**

Run:

```bash
grep -nE "update\((schema\.)?(scheduledPublications|publicationJobs|sp|pj)\b" apps/api/src/modules/publishing/*.ts | grep -v publication-ledger.ts
```

Expected: no output. Every execution-state write in the publishing module is in `publication-ledger.ts`.

- [ ] **Step 8: Verify the API boots and fails on unsafe config**

Run (with db up and a valid local `.env`): `PUBLISH_LEASE_SECONDS=10 pnpm --filter api start`
Expected: the process exits during bootstrap with `PUBLISH_LEASE_SECONDS must cover PUBLISH_PROVIDER_BUDGET_MS plus 60 seconds`. Then start normally (`pnpm dev:api`); it boots.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/publishing apps/api/test/integration
git commit -m "feat(publishing): execute publications under lease ownership with DB-owned retries"
```

---

### Task 6: Schedule mutations, channel guards and the automation schedule step

**Files:**
- Create: `apps/api/src/db/pg-errors.ts`
- Create: `apps/api/src/modules/automations/schedule-checkpoint.ts`
- Modify: `apps/api/src/modules/scheduling/scheduling.service.ts` (`createSchedule`, `updateSchedule`, `cancelSchedule`)
- Modify: `apps/api/src/modules/channels/channels.service.ts:96`, `:200-209`
- Modify: `apps/api/src/modules/automations/automation-runtime.service.ts` (the `executeSchedule` checkpoint block ≈ lines 700-713; the loop ≈ lines 741-752)
- Create: `apps/api/test/integration/scheduling.int-spec.ts`

**Interfaces:**
- Consumes: `rearmSet`, the status constants and `ACTIVE_IDENTITY_INDEX` (Task 3); `PublicationLedger` (Task 4).
- Produces:
  - `isUniqueViolation(error: unknown, constraint: string): boolean`
  - `class ScheduleIdentityConflict extends ConflictException { readonly existingScheduleId: number | null }`, exported from `scheduling.service.ts`
  - `claimScheduleStartAt(db, step: { id: number; logs: string | null }, proposed: Date): Promise<{ startAt: Date; logs: string }>`

- [ ] **Step 1: Write the failing integration tests**

`apps/api/test/integration/scheduling.int-spec.ts`:

```ts
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
        describeProvider: () => ({ supported: true, capabilities: { text: true } }),
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
    expect((conflict as ScheduleIdentityConflict).existingScheduleId).toBe(first.id);
  });

  it('keeps one row when identical schedules are created concurrently', async () => {
    const seeded = await seedChannel(database.sql);
    const input = {
      contentItemId: seeded.contentItemId,
      socialAccountId: seeded.socialAccountId,
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
    };
    await Promise.allSettled([
      scheduling.createSchedule(seeded.workspaceId, input),
      scheduling.createSchedule(seeded.workspaceId, input),
    ]);
    const rows = await database.db
      .select()
      .from(sp)
      .where(eq(sp.contentItemId, seeded.contentItemId));
    expect(rows).toHaveLength(1);
  });

  it.each(['unknown', 'needs_review'])(
    'refuses to reschedule or cancel a %s publication (D2)',
    async (status) => {
      const seeded = await seedChannel(database.sql);
      const publication = await createPublication(database.db, seeded, { status });
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
    const active = await createPublication(database.db, seeded, { scheduledAt: occupiedAt });
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
    expect((conflict as ScheduleIdentityConflict).existingScheduleId).toBe(active.id);
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
      channels.disconnect(unknownChannel.workspaceId, unknownChannel.socialAccountId),
    ).rejects.toThrow(/Cancel or move active scheduled publications/);

    const reviewChannel = await seedChannel(database.sql);
    await createPublication(database.db, reviewChannel, { status: 'needs_review' });
    await expect(
      channels.disconnect(reviewChannel.workspaceId, reviewChannel.socialAccountId),
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
      claimScheduleStartAt(database.db, { id: step.id, logs: null }, new Date('2026-10-01T09:00:00Z')),
      claimScheduleStartAt(database.db, { id: step.id, logs: null }, new Date('2026-10-01T09:00:05Z')),
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
    const startAt = (JSON.parse(persisted.logs) as { checkpoint: { startAt: string } })
      .checkpoint.startAt;
    const rows = await database.db
      .select()
      .from(sp)
      .where(eq(sp.contentItemId, seeded.contentItemId));
    expect(rows).toHaveLength(1);
    expect(rows[0].scheduledAt.toISOString()).toBe(startAt);
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter api test:int -- scheduling`
Expected: FAIL — `ScheduleIdentityConflict` and `claimScheduleStartAt` are missing, and the race assertions fail.

- [ ] **Step 3: Implement the unique-violation helper and the checkpoint**

`apps/api/src/db/pg-errors.ts`:

```ts
/** postgres-js error codes may be wrapped by Drizzle; walk the cause chain. */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  let current: unknown = error;
  for (let depth = 0; current && depth < 5; depth += 1) {
    const candidate = current as {
      code?: string;
      constraint_name?: string;
      cause?: unknown;
    };
    if (candidate.code === '23505' && candidate.constraint_name === constraint) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}
```

`apps/api/src/modules/automations/schedule-checkpoint.ts`:

```ts
import { ServiceUnavailableException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';

type StepLogs = Record<string, unknown> & {
  checkpoint?: Record<string, unknown>;
};

function parseLogs(value: string | null | undefined): StepLogs {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as StepLogs) : {};
  } catch {
    return {};
  }
}

/**
 * First writer wins, so concurrent executions of one schedule step compute
 * identical scheduled_at values (spec 32A §5.2, D3).
 */
export async function claimScheduleStartAt(
  db: PostgresJsDatabase<typeof schema>,
  step: { id: number; logs: string | null },
  proposed: Date,
): Promise<{ startAt: Date; logs: string }> {
  const steps = schema.automationRunSteps;
  const log = parseLogs(step.logs);
  const logs = JSON.stringify({
    ...log,
    checkpoint: { ...(log.checkpoint ?? {}), startAt: proposed.toISOString() },
  });

  const [written] = await db
    .update(steps)
    .set({ logs })
    .where(
      and(
        eq(steps.id, step.id),
        step.logs === null ? isNull(steps.logs) : eq(steps.logs, step.logs),
      ),
    )
    .returning({ id: steps.id });
  if (written) return { startAt: proposed, logs };

  const [latest] = await db
    .select({ logs: steps.logs })
    .from(steps)
    .where(eq(steps.id, step.id));
  const winner = parseLogs(latest?.logs).checkpoint?.startAt;
  if (
    typeof winner !== 'string' ||
    Number.isNaN(new Date(winner).getTime()) ||
    !latest?.logs
  ) {
    throw new ServiceUnavailableException(
      'Schedule step checkpoint changed concurrently; retry the step',
    );
  }
  return { startAt: new Date(winner), logs: latest.logs };
}
```

- [ ] **Step 4: Rewrite the schedule mutations**

In `apps/api/src/modules/scheduling/scheduling.service.ts`:
- Add `ConflictException` to the `@nestjs/common` import and `inArray` to the `drizzle-orm` import.
- Add these imports:

```ts
import { isUniqueViolation } from '../../db/pg-errors.js';
import {
  ACTIVE_IDENTITY_INDEX,
  ACTIVE_PUBLICATION_STATUSES,
  isStatusIn,
  rearmSet,
  USER_MUTABLE_PUBLICATION_STATUSES,
} from '../publishing/publication-state.js';

export class ScheduleIdentityConflict extends ConflictException {
  constructor(readonly existingScheduleId: number | null) {
    super({
      message:
        'An active publication already exists for this content, channel and time',
      existingScheduleId,
    });
  }
}
```

Add this private method to `SchedulingService`:

```ts
  private async identityConflict(
    workspaceId: number,
    contentItemId: number,
    socialAccountId: number,
    scheduledAt: Date,
  ) {
    const existing = await this.db.query.scheduledPublications.findFirst({
      where: and(
        eq(schema.scheduledPublications.workspaceId, workspaceId),
        eq(schema.scheduledPublications.contentItemId, contentItemId),
        eq(schema.scheduledPublications.socialAccountId, socialAccountId),
        eq(schema.scheduledPublications.scheduledAt, scheduledAt),
        inArray(schema.scheduledPublications.status, [
          ...ACTIVE_PUBLICATION_STATUSES,
        ]),
      ),
      columns: { id: true },
    });
    return new ScheduleIdentityConflict(existing?.id ?? null);
  }
```

In `createSchedule`, change `return this.db.transaction(async (tx) => { … });` to:

```ts
    try {
      return await this.db.transaction(async (tx) => {
        // …existing body unchanged…
      });
    } catch (error) {
      if (isUniqueViolation(error, ACTIVE_IDENTITY_INDEX)) {
        throw await this.identityConflict(
          workspaceId,
          data.contentItemId,
          data.socialAccountId,
          scheduledAt,
        );
      }
      throw error;
    }
```

In `updateSchedule`:
- Replace the status guard (`if (['published', 'cancelled', 'publishing'].includes(current.status)) { … }`) with:

```ts
    if (!isStatusIn(current.status, USER_MUTABLE_PUBLICATION_STATUSES)) {
      throw new ConflictException(
        current.status === 'publishing'
          ? 'A publication in progress cannot be changed'
          : isStatusIn(current.status, ['unknown', 'needs_review'])
            ? 'This publication may already be live and must be resolved before it can be changed'
            : 'Published or cancelled publications cannot be changed',
      );
    }
```

- Replace the final `return this.db.transaction(async (tx) => { … })` with:

```ts
    try {
      return await this.db.transaction(async (tx) => {
        const now = new Date();
        const [record] = await tx
          .update(schema.scheduledPublications)
          .set({ ...rearmSet(now, null), scheduledAt, attemptCount: 0 })
          .where(
            and(
              eq(schema.scheduledPublications.id, id),
              eq(schema.scheduledPublications.workspaceId, workspaceId),
              inArray(schema.scheduledPublications.status, [
                ...USER_MUTABLE_PUBLICATION_STATUSES,
              ]),
              eq(schema.scheduledPublications.updatedAt, current.updatedAt),
            ),
          )
          .returning();
        if (!record) {
          throw new ConflictException(
            'This publication changed while you were editing it. Refresh and try again.',
          );
        }

        await tx
          .update(schema.contentItems)
          .set({ status: 'scheduled', updatedAt: now })
          .where(eq(schema.contentItems.id, current.contentItemId));

        if (current.variantId) {
          await tx
            .update(schema.contentVariants)
            .set({ status: 'scheduled', scheduledAt, updatedAt: now })
            .where(eq(schema.contentVariants.id, current.variantId));
        }

        return record;
      });
    } catch (error) {
      if (isUniqueViolation(error, ACTIVE_IDENTITY_INDEX)) {
        throw await this.identityConflict(
          workspaceId,
          current.contentItemId,
          current.socialAccountId,
          scheduledAt,
        );
      }
      throw error;
    }
```

In `cancelSchedule`, change the first update inside the transaction to a compare-and-set, and switch the two rollup filters to the active set:

```ts
      const [record] = await tx
        .update(schema.scheduledPublications)
        .set({ status: 'cancelled', updatedAt: new Date() })
        .where(
          and(
            eq(schema.scheduledPublications.id, current.id),
            eq(schema.scheduledPublications.workspaceId, workspaceId),
            inArray(schema.scheduledPublications.status, [
              ...USER_MUTABLE_PUBLICATION_STATUSES,
            ]),
            eq(schema.scheduledPublications.updatedAt, current.updatedAt),
          ),
        )
        .returning();
      if (!record) {
        throw new ConflictException(
          'This publication changed while you were editing it. Refresh and try again.',
        );
      }
```

Replace both `['scheduled', 'publishing'].includes(schedule.status)` with `isStatusIn(schedule.status, ACTIVE_PUBLICATION_STATUSES)`.

In `apps/api/src/modules/channels/channels.service.ts`:
- Import `ACTIVE_PUBLICATION_STATUSES`, `CREDENTIAL_DEPENDENT_PUBLICATION_STATUSES` and `isStatusIn` from `'../publishing/publication-state.js'`.
- Line 96: replace `['scheduled', 'publishing'].includes(schedule.status)` with `isStatusIn(schedule.status, ACTIVE_PUBLICATION_STATUSES)`.
- In `disconnect`, replace the `inArray(… ['scheduled', 'publishing'])` list with `[...CREDENTIAL_DEPENDENT_PUBLICATION_STATUSES]`.

- [ ] **Step 5: Use the checkpoint and the conflict in the automation step**

In `apps/api/src/modules/automations/automation-runtime.service.ts`:
- Import `claimScheduleStartAt` from `'./schedule-checkpoint.js'` and `ScheduleIdentityConflict` from `'../scheduling/scheduling.service.js'`.
- Change `const startAt = startAtRaw ? … : …;` to `let startAt = …;`.
- Replace the whole `if (!startAtRaw) { … }` checkpoint block with:

```ts
    if (!startAtRaw) {
      const claimed = await claimScheduleStartAt(this.db, step, startAt);
      startAt = claimed.startAt;
      step.logs = claimed.logs;
    }
```

Inside the per-item loop, replace:

```ts
      const created = await this.scheduling.createSchedule(
```

through `scheduleIds.push(created.id);` with:

```ts
      try {
        const created = await this.scheduling.createSchedule(
          run.automation.workspaceId,
          {
            contentItemId,
            variantId: variant?.id,
            socialAccountId,
            scheduledAt: scheduledAt.toISOString(),
          },
        );
        scheduleIds.push(created.id);
      } catch (error) {
        if (
          error instanceof ScheduleIdentityConflict &&
          error.existingScheduleId !== null
        ) {
          scheduleIds.push(error.existingScheduleId);
          continue;
        }
        throw error;
      }
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `pnpm --filter api test:int && pnpm --filter api test && pnpm --filter api exec tsc --noEmit && pnpm --filter api lint`
Expected: all PASS; no type or lint errors.

- [ ] **Step 7: Commit**

```bash
git add apps/api/src apps/api/test/integration
git commit -m "fix(scheduling): make schedule mutations CAS and dedupe active schedule identity"
```

---

### Task 7: X and LinkedIn adapters

**Files:**
- Create: `apps/api/test/support/publish-context.ts`
- Modify: `apps/api/src/modules/channels/adapters/XPublisherAdapter.ts` (`refreshAccessToken`, `publishPost`)
- Modify: `apps/api/src/modules/channels/adapters/LinkedInPublisherAdapter.ts` (`publishPost`, `refreshAccessToken`)
- Modify: `apps/api/src/modules/channels/adapters/XPublisherAdapter.spec.ts`
- Create: `apps/api/src/modules/channels/adapters/LinkedInPublisherAdapter.spec.ts`

**Interfaces:**
- Consumes: `PublishContext`, `ProviderPublishError` (with `errorClass`), `providerSignal`, `httpErrorClass`, `readJson` (Task 3).
- Produces: `testPublishContext(overrides?)` → `{ signal: AbortSignal; beforeSideEffect: Mock; …overrides }`, used by the Task 8 specs.

- [ ] **Step 1: Write the test context helper and the failing adapter tests**

`apps/api/test/support/publish-context.ts`:

```ts
import { vi } from 'vitest';
import type {
  ProviderCheckpoint,
  PublishContext,
} from '../../src/modules/channels/ports/SocialPublisherPort.js';

export function testPublishContext(overrides: Partial<PublishContext> = {}) {
  const beforeSideEffect = vi.fn(
    async (_checkpoint: ProviderCheckpoint) => undefined,
  );
  return {
    signal: new AbortController().signal,
    beforeSideEffect,
    ...overrides,
  };
}
```

`apps/api/src/modules/channels/adapters/LinkedInPublisherAdapter.spec.ts`:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { testPublishContext } from '../../../../test/support/publish-context.js';
import { ProviderPublishError } from '../ports/SocialPublisherPort.js';
import { LinkedInPublisherAdapter } from './LinkedInPublisherAdapter.js';

describe('LinkedInPublisherAdapter.publishPost', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function publish(fetchMock: ReturnType<typeof vi.fn>, context = testPublishContext()) {
    vi.stubGlobal('fetch', fetchMock);
    return new LinkedInPublisherAdapter().publishPost('Launch day', 'token', {
      ...context,
      providerAccountId: 'member-1',
    });
  }

  it('marks the side effect once, before the post request, and returns the URN', async () => {
    const order: string[] = [];
    const context = testPublishContext({
      beforeSideEffect: vi.fn(async () => {
        order.push('marker');
      }),
    });
    const fetchMock = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      order.push('post');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(null, {
        status: 201,
        headers: { 'x-restli-id': 'urn:li:share:1' },
      });
    });

    await expect(publish(fetchMock, context)).resolves.toEqual({ postId: 'urn:li:share:1' });
    expect(order).toEqual(['marker', 'post']);
    expect(context.beforeSideEffect).toHaveBeenCalledWith({
      operationType: 'linkedin_create_post',
    });
  });

  it.each([
    ['429', () => new Response('slow', { status: 429 }), { retryable: true, outcomeUnknown: false, errorClass: 'rate_limit' }],
    ['500', () => new Response('oops', { status: 500 }), { retryable: false, outcomeUnknown: true, errorClass: 'transient_provider' }],
    ['401', () => new Response('no', { status: 401 }), { retryable: false, outcomeUnknown: false, errorClass: 'authentication' }],
    ['422', () => new Response('bad', { status: 422 }), { retryable: false, outcomeUnknown: false, errorClass: 'invalid_request' }],
    ['2xx without id', () => new Response(null, { status: 201 }), { retryable: false, outcomeUnknown: true, errorClass: 'unknown_outcome' }],
  ])('classifies %s', async (_label, respond, expected) => {
    const error = await publish(vi.fn(async () => respond())).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ProviderPublishError);
    expect(error).toMatchObject(expected);
  });

  it('classifies a network failure after the marker as unknown', async () => {
    const error = await publish(
      vi.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    ).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ outcomeUnknown: true, errorClass: 'network_transient' });
  });

  it('sends nothing when the marker is refused', async () => {
    const fetchMock = vi.fn();
    const context = testPublishContext({
      beforeSideEffect: vi.fn(async () => {
        throw new Error('lease lost');
      }),
    });
    await expect(publish(fetchMock, context)).rejects.toThrow('lease lost');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
```

In `apps/api/src/modules/channels/adapters/XPublisherAdapter.spec.ts`:
- Add the import `import { testPublishContext } from '../../../../test/support/publish-context.js';`.
- Change the existing publish call to `adapter.publishPost('Launch day', 'user-access-token', testPublishContext())`.
- Append the following **inside** the top-level `describe('XPublisherAdapter', …)` block, so its `beforeEach` env setup applies:

```ts
  describe('publish error semantics', () => {
    function publish(respond: () => Response | Promise<Response>) {
      vi.stubGlobal('fetch', vi.fn(async () => respond()));
      return new XPublisherAdapter()
        .publishPost('Launch day', 'token', testPublishContext())
        .catch((caught: unknown) => caught);
    }

    it.each([
      ['429', () => new Response('{}', { status: 429 }), { retryable: true, outcomeUnknown: false, errorClass: 'rate_limit' }],
      ['503', () => new Response('{}', { status: 503 }), { outcomeUnknown: true, errorClass: 'transient_provider' }],
      ['403', () => new Response('{}', { status: 403 }), { retryable: false, outcomeUnknown: false, errorClass: 'authorization' }],
      ['malformed 2xx', () => new Response('not json', { status: 201 }), { outcomeUnknown: true, errorClass: 'unknown_outcome' }],
      ['2xx without id', () => new Response('{"data":{}}', { status: 201 }), { outcomeUnknown: true, errorClass: 'unknown_outcome' }],
    ])('classifies %s', async (_label, respond, expected) => {
      expect(await publish(respond)).toMatchObject(expected);
    });

    it('classifies a refresh network failure as retryable, not unknown', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => {
        throw new TypeError('fetch failed');
      }));
      const error = await new XPublisherAdapter()
        .refreshAccessToken('refresh')
        .catch((caught: unknown) => caught);
      expect(error).toMatchObject({ retryable: true, outcomeUnknown: false, errorClass: 'network_transient' });
    });
  });
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter api exec vitest run src/modules/channels/adapters/XPublisherAdapter.spec.ts src/modules/channels/adapters/LinkedInPublisherAdapter.spec.ts`
Expected: FAIL. `beforeSideEffect` is never called; `errorClass` is missing or wrong; malformed 2xx throws a `SyntaxError`.

- [ ] **Step 3: Implement**

In `XPublisherAdapter.ts`, import `providerSignal`, `httpErrorClass` and `readJson` from `'./provider-http.js'`. Replace `publishPost` with:

```ts
  async publishPost(
    content: string,
    accessToken: string,
    context: PublishContext,
  ): Promise<PublishResult> {
    await context.beforeSideEffect({ operationType: 'x_create_post' });

    let response: Response;
    try {
      response = await fetch('https://api.x.com/2/tweets', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ text: content }),
        signal: providerSignal(context.signal),
      });
    } catch {
      throw new ProviderPublishError(
        'X publish request ended without a confirmed provider response',
        { outcomeUnknown: true, errorClass: 'network_transient' },
      );
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => '');
      throw new ProviderPublishError(
        `X publish failed (HTTP ${response.status}): ${detail.slice(0, 300)}`,
        {
          statusCode: response.status,
          errorClass: httpErrorClass(response.status),
          retryable: response.status === 429,
          outcomeUnknown: response.status >= 500,
        },
      );
    }

    const payload = await readJson<XPostResponse>(response);
    const postId = payload?.data?.id;
    if (!postId) {
      throw new ProviderPublishError(
        'X accepted the publish request but returned no readable post id',
        { outcomeUnknown: true, errorClass: 'unknown_outcome' },
      );
    }

    return { postId, url: `https://x.com/i/web/status/${postId}` };
  }
```

In `refreshAccessToken` (X):
- Add `signal: providerSignal()` to the fetch init.
- Use `{ retryable: true, errorClass: 'network_transient' }` in the network catch.
- Add `errorClass: httpErrorClass(response.status)` to the non-ok error.
- Replace `const token = (await response.json()) as XTokenResponse;` with `const token = await readJson<XTokenResponse>(response);`.
- Change the no-token check to `if (!token?.access_token)` and throw `{ retryable: true, errorClass: 'transient_provider' }`.

Apply the same changes to `LinkedInPublisherAdapter.ts`:
- `publishPost`: after computing `providerAccountId`, add `await context.beforeSideEffect({ operationType: 'linkedin_create_post' });`.
- Add `signal: providerSignal(context.signal)` to the post fetch.
- Network catch: `{ outcomeUnknown: true, errorClass: 'network_transient' }`.
- Non-ok: `errorClass: httpErrorClass(response.status)`, keeping `retryable: isRateLimit, outcomeUnknown: isServerError`, and read the body with `.text().catch(() => '')`.
- Missing id header: `{ outcomeUnknown: true, errorClass: 'unknown_outcome' }`.
- `refreshAccessToken`: the same four changes as X, with the `LinkedInTokenResponse` type.
- Change the `publishPost` signature to `context: PublishContext` (required).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter api test && pnpm --filter api exec tsc --noEmit && pnpm --filter api lint`
Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/api/test/support apps/api/src/modules/channels/adapters
git commit -m "feat(channels): declare side-effect boundary and deadlines in X and LinkedIn adapters"
```

---

### Task 8: Facebook and Instagram adapters and credential errors

**Files:**
- Create: `apps/api/src/modules/channels/adapters/meta-errors.ts`
- Modify: `apps/api/src/modules/channels/adapters/FacebookPublisherAdapter.ts` (remove local `MetaErrorBody`/`retryableMetaError`/`metaMessage`; `publishPost`)
- Modify: `apps/api/src/modules/channels/adapters/InstagramPublisherAdapter.ts` (the same removals; `sleep` → `node:timers/promises`; `publishPost`, `waitForContainer`, `permalink`)
- Modify: `apps/api/src/modules/channels/channel-credential.service.ts` (throw sites gain `errorClass: 'authentication'`)
- Modify: `apps/api/src/modules/channels/adapters/FacebookPublisherAdapter.spec.ts`, `InstagramPublisherAdapter.spec.ts`
- Create: `apps/api/src/modules/channels/channel-credential.service.spec.ts`

**Interfaces:**
- Consumes: `testPublishContext` (Task 7); provider-http helpers (Task 3).
- Produces: `MetaErrorBody`, `retryableMetaError`, `metaRateLimited`, `metaTransient`, `metaErrorClass`, `metaMessage` from `meta-errors.ts`.

- [ ] **Step 1: Write the failing tests**

In `FacebookPublisherAdapter.spec.ts`:
- Import `testPublishContext` (same relative path as in Task 7).
- Change the existing publish call's context to `{ ...testPublishContext(), providerAccountId: 'page-123', media: [ … ] }`.
- Append the following **inside** the top-level `describe` block, so the Meta env setup applies:

```ts
  describe('publish error semantics', () => {
    function publish(respond: () => Response, context = testPublishContext()) {
      vi.stubGlobal('fetch', vi.fn(async () => respond()));
      return new FacebookPublisherAdapter(new MetaGraphClient())
        .publishPost('Hello', 'page-token', { ...context, providerAccountId: 'page-123' })
        .catch((caught: unknown) => caught);
    }
    const meta = (status: number, error: Record<string, unknown>) =>
      new Response(JSON.stringify({ error }), { status });

    it.each([
      ['500', () => meta(500, { message: 'down' }), { outcomeUnknown: true, errorClass: 'transient_provider' }],
      ['rate code 4', () => meta(400, { code: 4 }), { retryable: true, outcomeUnknown: false, errorClass: 'rate_limit' }],
      ['token code 190', () => meta(400, { code: 190 }), { retryable: false, outcomeUnknown: false, errorClass: 'authentication' }],
      ['malformed 2xx', () => new Response('<html>', { status: 200 }), { outcomeUnknown: true, errorClass: 'unknown_outcome' }],
    ])('classifies %s', async (_label, respond, expected) => {
      expect(await publish(respond)).toMatchObject(expected);
    });

    it('rejects invalid input before the marker', async () => {
      const context = testPublishContext();
      vi.stubGlobal('fetch', vi.fn());
      const error = await new FacebookPublisherAdapter(new MetaGraphClient())
        .publishPost('', 'page-token', { ...context, providerAccountId: 'page-123' })
        .catch((caught: unknown) => caught);
      expect(error).toMatchObject({ errorClass: 'invalid_request', outcomeUnknown: false });
      expect(context.beforeSideEffect).not.toHaveBeenCalled();
    });
  });
```

In `InstagramPublisherAdapter.spec.ts`:
- Import `testPublishContext`.
- Update the existing publish call's context the same way. The existing "text-only rejected" test keeps asserting that no fetch happens.
- Append the following **inside** the top-level `describe` block:

```ts
  describe('side-effect boundary and error semantics', () => {
    const image = {
      assetId: 1,
      fileType: 'image',
      mimeType: 'image/jpeg',
      fileName: 'a.jpg',
      url: 'https://storage.example.com/a.jpg',
    };
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), { status });

    function routeFetch(routes: {
      create?: () => Response;
      status?: () => Response;
      publish?: () => Response;
    }) {
      const calls: string[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string | URL) => {
          const target = String(url);
          if (target.endsWith('/ig-1/media')) {
            calls.push('create');
            return (routes.create ?? (() => json({ id: 'container-1' })))();
          }
          if (target.endsWith('/ig-1/media_publish')) {
            calls.push('publish');
            return (routes.publish ?? (() => json({ id: 'media-1' })))();
          }
          if (target.includes('container-1?')) {
            calls.push('status');
            return (routes.status ?? (() => json({ status_code: 'FINISHED' })))();
          }
          calls.push('other');
          return json({ permalink: 'https://instagram.com/p/1' });
        }),
      );
      return calls;
    }

    function publish(context = testPublishContext()) {
      return new InstagramPublisherAdapter(new MetaGraphClient())
        .publishPost('Hello', 'token', { ...context, providerAccountId: 'ig-1', media: [image] })
        .catch((caught: unknown) => caught);
    }

    it('persists the container id at the marker, before media_publish', async () => {
      const calls = routeFetch({});
      const context = testPublishContext({
        beforeSideEffect: vi.fn(async () => {
          calls.push('marker');
        }),
      });
      await expect(publish(context)).resolves.toMatchObject({ postId: 'media-1' });
      expect(calls.slice(0, 4)).toEqual(['create', 'status', 'marker', 'publish']);
      expect(context.beforeSideEffect).toHaveBeenCalledWith({
        operationType: 'instagram_media_publish',
        operationId: 'container-1',
      });
    });

    it('treats a container network failure as retryable and never marks', async () => {
      routeFetch({
        create: () => {
          throw new TypeError('fetch failed');
        },
      });
      const context = testPublishContext();
      expect(await publish(context)).toMatchObject({ retryable: true, outcomeUnknown: false });
      expect(context.beforeSideEffect).not.toHaveBeenCalled();
    });

    it('treats media_publish 200 without an id as unknown (C5)', async () => {
      routeFetch({ publish: () => json({}) });
      expect(await publish()).toMatchObject({ outcomeUnknown: true, errorClass: 'unknown_outcome' });
    });

    it('treats a media_publish 500 as unknown', async () => {
      routeFetch({ publish: () => json({ error: { message: 'down' } }, 500) });
      expect(await publish()).toMatchObject({ outcomeUnknown: true });
    });

    it('stops polling on budget abort without marking or publishing (Review Focus 5)', async () => {
      const budget = new AbortController();
      const calls = routeFetch({
        status: () => {
          budget.abort();
          return json({ status_code: 'IN_PROGRESS' });
        },
      });
      const context = testPublishContext({ signal: budget.signal });
      expect(await publish(context)).toMatchObject({ retryable: true, outcomeUnknown: false });
      expect(context.beforeSideEffect).not.toHaveBeenCalled();
      expect(calls).not.toContain('publish');
    });
  });
```

`apps/api/src/modules/channels/channel-credential.service.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { ChannelCredentialService } from './channel-credential.service.js';
import type { SocialPublisherPort } from './ports/SocialPublisherPort.js';

describe('ChannelCredentialService', () => {
  it('classifies an unusable channel as an authentication failure', async () => {
    // The disconnected-channel guard throws before any database access.
    const service = new ChannelCredentialService({} as never);
    const error = await service
      .getValidAccessToken(
        { status: 'disconnected', accessToken: null } as never,
        {} as SocialPublisherPort,
      )
      .catch((caught: unknown) => caught);
    expect(error).toMatchObject({ errorClass: 'authentication', retryable: false });
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `pnpm --filter api exec vitest run src/modules/channels`
Expected: FAIL. No `errorClass`; `beforeSideEffect` is never called; `json()` throws on malformed bodies; the budget abort is ignored.

- [ ] **Step 3: Implement**

`apps/api/src/modules/channels/adapters/meta-errors.ts`:

```ts
import type { ProviderErrorClass } from '../ports/SocialPublisherPort.js';
import { httpErrorClass } from './provider-http.js';

export type MetaErrorBody = {
  error?: {
    message?: string;
    code?: number;
    error_subcode?: number;
    is_transient?: boolean;
  };
};

const RATE_LIMIT_CODES = [4, 17, 32, 613];

export function metaRateLimited(status: number, body?: MetaErrorBody) {
  return status === 429 || RATE_LIMIT_CODES.includes(body?.error?.code ?? 0);
}

export function metaTransient(status: number, body?: MetaErrorBody) {
  return status >= 500 || body?.error?.is_transient === true;
}

/** Safe to retry for requests that cannot create a public post. */
export function retryableMetaError(status: number, body?: MetaErrorBody) {
  return metaRateLimited(status, body) || metaTransient(status, body);
}

export function metaErrorClass(
  status: number,
  body?: MetaErrorBody,
): ProviderErrorClass {
  if (metaRateLimited(status, body)) return 'rate_limit';
  if (metaTransient(status, body)) return 'transient_provider';
  const code = body?.error?.code ?? 0;
  if (code === 190) return 'authentication';
  if (code === 10 || (code >= 200 && code <= 299)) return 'authorization';
  return httpErrorClass(status);
}

export function metaMessage(prefix: string, status: number, body?: MetaErrorBody) {
  return `${prefix} (HTTP ${status}): ${body?.error?.message || 'Meta Graph API rejected the request'}`;
}
```

In both Meta adapters, delete the local `MetaErrorBody`, `retryableMetaError` and `metaMessage` definitions, and import them from `'./meta-errors.js'`. The existing analytics methods keep compiling unchanged. Also import `providerSignal` and `readJson` from `'./provider-http.js'`.

`FacebookPublisherAdapter.publishPost`:
- Make `context: PublishContext` required.
- Add `errorClass: 'invalid_request'` to every validation throw (no page id, >1 media, video, MIME, empty).
- Replace everything from `let response: Response;` to the end of the method with:

```ts
    await context.beforeSideEffect({
      operationType: image ? 'facebook_page_photo' : 'facebook_page_feed',
    });

    let response: Response;
    try {
      response = await fetch(this.meta.graphUrl(path), {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body,
        signal: providerSignal(context.signal),
      });
    } catch {
      throw new ProviderPublishError(
        'Facebook publish request ended without a confirmed provider response',
        { outcomeUnknown: true, errorClass: 'network_transient' },
      );
    }

    const payload = await readJson<FacebookPublishResponse>(response);
    if (!response.ok) {
      const unknown = metaTransient(response.status, payload);
      throw new ProviderPublishError(
        metaMessage('Facebook publish failed', response.status, payload),
        {
          statusCode: response.status,
          errorClass: metaErrorClass(response.status, payload),
          outcomeUnknown: unknown,
          retryable: !unknown && metaRateLimited(response.status, payload),
        },
      );
    }

    const postId = payload?.post_id || payload?.id;
    if (!postId) {
      throw new ProviderPublishError(
        'Facebook accepted the publish request but returned no readable post id',
        { outcomeUnknown: true, errorClass: 'unknown_outcome' },
      );
    }

    return { postId, url: `https://www.facebook.com/${postId}` };
```

`InstagramPublisherAdapter`:
- Replace the local `sleep` with `import { setTimeout as delay } from 'node:timers/promises';`.
- Make `context: PublishContext` required and add `errorClass: 'invalid_request'` to the validation throws.
- Replace everything from `let createResponse: Response;` to the end of `publishPost`, and the whole of `waitForContainer` and `permalink`, with:

```ts
    let createResponse: Response;
    try {
      createResponse = await fetch(this.meta.graphUrl(`${instagramId}/media`), {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: createBody,
        signal: providerSignal(context.signal),
      });
    } catch {
      throw new ProviderPublishError(
        'Instagram media container request failed before a provider response was received',
        { retryable: true, errorClass: 'network_transient' },
      );
    }

    const created = await readJson<ContainerResponse>(createResponse);
    if (!createResponse.ok || !created?.id) {
      throw new ProviderPublishError(
        metaMessage('Instagram media container creation failed', createResponse.status, created),
        {
          statusCode: createResponse.status,
          errorClass: createResponse.ok
            ? 'transient_provider'
            : metaErrorClass(createResponse.status, created),
          retryable: createResponse.ok || retryableMetaError(createResponse.status, created),
        },
      );
    }

    await this.waitForContainer(created.id, accessToken, context.signal);
    await context.beforeSideEffect({
      operationType: 'instagram_media_publish',
      operationId: created.id,
    });

    let publishResponse: Response;
    try {
      publishResponse = await fetch(this.meta.graphUrl(`${instagramId}/media_publish`), {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ creation_id: created.id, access_token: accessToken }),
        signal: providerSignal(context.signal),
      });
    } catch {
      throw new ProviderPublishError(
        'Instagram media_publish ended without a confirmed provider response',
        { outcomeUnknown: true, errorClass: 'network_transient' },
      );
    }

    const published = await readJson<PublishResponse>(publishResponse);
    if (!publishResponse.ok) {
      const unknown = metaTransient(publishResponse.status, published);
      throw new ProviderPublishError(
        metaMessage('Instagram media publish failed', publishResponse.status, published),
        {
          statusCode: publishResponse.status,
          errorClass: metaErrorClass(publishResponse.status, published),
          outcomeUnknown: unknown,
          retryable: !unknown && metaRateLimited(publishResponse.status, published),
        },
      );
    }
    if (!published?.id) {
      throw new ProviderPublishError(
        'Instagram accepted media_publish but returned no readable media id',
        { outcomeUnknown: true, errorClass: 'unknown_outcome' },
      );
    }

    const url = await this.permalink(published.id, accessToken, context.signal);
    return { postId: published.id, ...(url ? { url } : {}) };
  }

  private async waitForContainer(
    containerId: string,
    accessToken: string,
    signal: AbortSignal,
  ) {
    for (let attempt = 0; attempt < 6; attempt += 1) {
      const params = new URLSearchParams({
        fields: 'status_code,status',
        access_token: accessToken,
      });
      let response: Response;
      try {
        response = await fetch(`${this.meta.graphUrl(containerId)}?${params.toString()}`, {
          signal: providerSignal(signal),
        });
      } catch {
        throw new ProviderPublishError(
          'Instagram container status request failed before a provider response was received',
          { retryable: true, errorClass: 'network_transient' },
        );
      }

      const payload = await readJson<ContainerStatusResponse>(response);
      if (!response.ok) {
        throw new ProviderPublishError(
          metaMessage('Instagram container status failed', response.status, payload),
          {
            statusCode: response.status,
            errorClass: metaErrorClass(response.status, payload),
            retryable: retryableMetaError(response.status, payload),
          },
        );
      }

      if (payload?.status_code === 'FINISHED') return;
      if (payload?.status_code === 'ERROR' || payload?.status_code === 'EXPIRED') {
        throw new ProviderPublishError(
          `Instagram media container could not be published: ${payload.status || payload.status_code}`,
          { errorClass: 'content_rejected' },
        );
      }

      try {
        await delay(1000, undefined, { signal });
      } catch {
        break;
      }
    }

    throw new ProviderPublishError(
      'Instagram media container was not ready within the publish budget',
      { retryable: true, errorClass: 'network_transient' },
    );
  }

  private async permalink(mediaId: string, accessToken: string, signal: AbortSignal) {
    const params = new URLSearchParams({ fields: 'permalink', access_token: accessToken });
    try {
      const response = await fetch(`${this.meta.graphUrl(mediaId)}?${params.toString()}`, {
        signal: providerSignal(signal),
      });
      if (!response.ok) return undefined;
      const payload = await readJson<PermalinkResponse>(response);
      return payload?.permalink || undefined;
    } catch {
      return undefined;
    }
  }
```

Two notes on the Instagram code:
- `publishBody` becomes inline; delete the old `publishBody` variable.
- In the Review Focus 5 test, the status fetch aborts the budget and returns `IN_PROGRESS`. The next `delay` rejects immediately, the loop breaks, and the retryable error is thrown.

In `channel-credential.service.ts`, add `errorClass: 'authentication'` to the two `retryable: false` throws.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm --filter api test && pnpm --filter api test:int && pnpm --filter api exec tsc --noEmit && pnpm --filter api lint`
Expected: all PASS. With every adapter now calling the hook, remove the transitional comment if any survived (Task 5 already replaced that call site).

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/modules/channels
git commit -m "feat(channels): declare side-effect boundary, deadlines and error classes for Meta adapters"
```

---

### Task 9: Worker — generation job identity and transport-only retries

**Files:**
- Create: `apps/worker/src/publishing/publishing.jobs.ts`
- Modify: `apps/worker/src/publishing/publishing.api.ts`
- Modify: `apps/worker/src/publishing/publishing.dispatcher.ts`
- Modify: `apps/worker/src/publishing/publishing.processor.ts`
- Modify: `apps/worker/src/queue/redis.ts`
- Modify: `apps/worker/package.json` (scripts)
- Create: `apps/worker/test/publishing-jobs.test.cjs`
- Create: `apps/worker/test/publishing-transport.int-test.cjs`
- Modify: `.github/workflows/ci.yml` (Redis service + step)

**Interfaces:**
- Consumes: the HTTP contract from Task 5 (`DispatchablePublication`, the execute body/response).
- Produces:
  - `buildPublicationJob(publication, now, env?)` → `{ name: 'publish'; data: PublishingJobData; opts: JobsOptions }`;
  - `publicationJobId(publication)`;
  - `dispatchOnce()`, now exported from the dispatcher;
  - `PublishingJobData = { scheduledPublicationId: number; expectedVersion: string; expectedDispatchGeneration: number }`.

- [ ] **Step 1: Write the failing unit test**

`apps/worker/test/publishing-jobs.test.cjs`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildPublicationJob,
  publicationJobId,
} = require('../dist/publishing/publishing.jobs.js');

const publication = {
  id: 42,
  scheduledAt: '2026-10-01T09:00:00.000Z',
  nextAttemptAt: null,
  updatedAt: '2026-09-30T00:00:00.000Z',
  dispatchGeneration: 3,
};

test('job id is the persisted dispatch generation', () => {
  assert.equal(publicationJobId(publication), 'publication-42-dispatch-3');
});

test('delay falls back to scheduledAt when there is no retry time', () => {
  const now = Date.parse('2026-10-01T08:59:00.000Z');
  assert.equal(buildPublicationJob(publication, now, {}).opts.delay, 60_000);
});

test('delay honours next_attempt_at over scheduled_at', () => {
  const now = Date.parse('2026-10-01T09:00:00.000Z');
  const job = buildPublicationJob(
    { ...publication, nextAttemptAt: '2026-10-01T09:05:00.000Z' },
    now,
    {},
  );
  assert.equal(job.opts.delay, 300_000);
});

test('carries the generation and version for the API gates', () => {
  const job = buildPublicationJob(publication, 0, {});
  assert.deepEqual(job.data, {
    scheduledPublicationId: 42,
    expectedVersion: '2026-09-30T00:00:00.000Z',
    expectedDispatchGeneration: 3,
  });
});

test('removes failed transport envelopes so the generation can be re-dispatched', () => {
  assert.equal(buildPublicationJob(publication, 0, {}).opts.removeOnFail, true);
});

test('transport attempts fall back to PUBLISH_MAX_ATTEMPTS', () => {
  assert.equal(buildPublicationJob(publication, 0, { PUBLISH_MAX_ATTEMPTS: '7' }).opts.attempts, 7);
  assert.equal(
    buildPublicationJob(publication, 0, { PUBLISH_TRANSPORT_ATTEMPTS: '2', PUBLISH_MAX_ATTEMPTS: '7' }).opts.attempts,
    2,
  );
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `pnpm --filter worker test`
Expected: FAIL — `Cannot find module '../dist/publishing/publishing.jobs.js'`.

- [ ] **Step 3: Implement the job builder and update api/dispatcher/processor**

`apps/worker/src/publishing/publishing.jobs.ts`:

```ts
import type { JobsOptions } from 'bullmq';
import type {
  DispatchablePublication,
  PublishingJobData,
} from './publishing.api';

function positive(raw: string | undefined, fallback: number) {
  const value = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function publicationJobId(
  publication: Pick<DispatchablePublication, 'id' | 'dispatchGeneration'>,
) {
  return `publication-${publication.id}-dispatch-${publication.dispatchGeneration}`;
}

/** Spec §9: BullMQ only delivers; the database owns domain retries. */
export function buildPublicationJob(
  publication: DispatchablePublication,
  now: number,
  env: NodeJS.ProcessEnv = process.env,
): { name: 'publish'; data: PublishingJobData; opts: JobsOptions } {
  const dueAt = Math.max(
    new Date(publication.scheduledAt).getTime(),
    publication.nextAttemptAt ? new Date(publication.nextAttemptAt).getTime() : 0,
  );
  return {
    name: 'publish',
    data: {
      scheduledPublicationId: publication.id,
      expectedVersion: publication.updatedAt,
      expectedDispatchGeneration: publication.dispatchGeneration,
    },
    opts: {
      jobId: publicationJobId(publication),
      delay: Math.max(0, dueAt - now),
      attempts: positive(
        env.PUBLISH_TRANSPORT_ATTEMPTS ?? env.PUBLISH_MAX_ATTEMPTS,
        5,
      ),
      backoff: {
        type: 'exponential',
        delay: positive(env.PUBLISH_TRANSPORT_BACKOFF_MS, 30_000),
      },
      removeOnComplete: { age: 24 * 60 * 60, count: 5_000 },
      removeOnFail: true,
    },
  };
}
```

`apps/worker/src/publishing/publishing.api.ts` changes:
- Replace the types:

```ts
export type DispatchablePublication = {
  id: number;
  scheduledAt: string;
  nextAttemptAt: string | null;
  updatedAt: string;
  dispatchGeneration: number;
};

export type PublishingJobData = {
  scheduledPublicationId: number;
  expectedVersion: string;
  expectedDispatchGeneration: number;
};

export type ExecutePublicationResponse = {
  status:
    | 'published'
    | 'already_published'
    | 'stale'
    | 'terminal'
    | 'in_progress'
    | 'outcome_unknown'
    | 'retry_scheduled'
    | 'failed_terminal';
  scheduledPublicationId: number;
  platformPostId?: string | null;
  platformPostUrl?: string | null;
  reason?: string;
};
```

- Change `request<T>(path, init = {})` to `request<T>(path, init: RequestInit = {}, timeoutMs?: number)` and pass `signal: timeoutMs ? AbortSignal.timeout(timeoutMs) : undefined` into `fetch`.
- Delete `deadLetterPublication`.
- Replace `executePublication` with:

```ts
function executeTimeoutMs() {
  const value = Number.parseInt(process.env.PUBLISH_EXECUTE_TIMEOUT_MS || '', 10);
  return Number.isFinite(value) && value > 0 ? value : 180_000;
}

export function executePublication(data: PublishingJobData, queueJobId?: string) {
  return request<ExecutePublicationResponse>(
    `/internal/publications/${data.scheduledPublicationId}/execute`,
    {
      method: 'POST',
      body: JSON.stringify({
        expectedVersion: data.expectedVersion,
        expectedDispatchGeneration: data.expectedDispatchGeneration,
        queueJobId,
      }),
    },
    executeTimeoutMs(),
  );
}
```

`publishing.dispatcher.ts`:
- Delete `maxAttempts`.
- Import `buildPublicationJob` from `'./publishing.jobs'`.
- Change `async function dispatchOnce()` to `export async function dispatchOnce()`.
- Replace the whole `for (const publication of publications) { … publishingQueue.add(…) }` loop with:

```ts
    for (const publication of publications) {
      const job = buildPublicationJob(publication, Date.now());
      await publishingQueue.add(job.name, job.data, job.opts);
    }
```

`publishing.processor.ts`:
- Import only `executePublication` and `PublishingJobData`.
- The job handler becomes `const result = await executePublication(job.data, job.id);`, with the existing logging kept.
- Replace the `failed` handler with:

```ts
publishingWorker.on('failed', (job, error) => {
  console.error(
    `[PublishingProcessor] Queue job ${job?.id || 'unknown'} failed: ${error.message}`,
  );
  if (!job) return;
  if (job.attemptsMade < Number(job.opts.attempts || 1)) return;

  // Spec I8: transport exhaustion never changes publication state. removeOnFail
  // lets the next dispatch poll re-enqueue this generation once the API is back.
  console.error(
    JSON.stringify({
      event: 'publication.transport_exhausted',
      publication_id: job.data.scheduledPublicationId,
      dispatch_generation: job.data.expectedDispatchGeneration,
      queue_job_id: job.id,
    }),
  );
});
```

`apps/worker/src/queue/redis.ts`: add `db: Number.parseInt(process.env.REDIS_DB || '0', 10),` to the IORedis options.

`apps/worker/package.json` `scripts`: add `"test:int": "tsc && node --test test/*.int-test.cjs"`.

- [ ] **Step 4: Run the unit test to verify it passes**

Run: `pnpm --filter worker test && pnpm --filter worker exec tsc --noEmit`
Expected: PASS (existing 9 + 6 new).

- [ ] **Step 5: Write the Redis transport integration test**

`apps/worker/test/publishing-transport.int-test.cjs`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

async function startFakeApi() {
  const state = {
    executeMode: 'down',
    executeCalls: 0,
    deadLetterCalls: 0,
    generation: 1,
  };
  const server = http.createServer((req, res) => {
    if (req.url.startsWith('/internal/publications/dispatchable')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify([
          {
            id: 42,
            scheduledAt: new Date(Date.now() - 1_000).toISOString(),
            nextAttemptAt: null,
            updatedAt: '2026-09-30T00:00:00.000Z',
            dispatchGeneration: state.generation,
          },
        ]),
      );
      return;
    }
    if (req.url === '/internal/publications/42/execute') {
      state.executeCalls += 1;
      if (state.executeMode === 'down') {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end('{}');
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ status: 'published', scheduledPublicationId: 42 }));
      return;
    }
    if (req.url === '/internal/publications/42/dead-letter') {
      state.deadLetterCalls += 1;
    }
    res.writeHead(404);
    res.end();
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { state, server, url: `http://127.0.0.1:${server.address().port}` };
}

async function waitFor(predicate, timeoutMs = 15_000) {
  const started = Date.now();
  while (!(await predicate())) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

test('transport exhaustion leaves the domain alone and the generation is re-dispatched', async () => {
  if (!process.env.REDIS_HOST) throw new Error('REDIS_HOST is required for worker integration tests');
  const api = await startFakeApi();
  process.env.SOSTATS_API_URL = api.url;
  process.env.WORKER_API_TOKEN = 'test-token';
  process.env.REDIS_DB = process.env.REDIS_DB || '15';
  process.env.PUBLISH_TRANSPORT_ATTEMPTS = '2';
  process.env.PUBLISH_TRANSPORT_BACKOFF_MS = '50';

  const { createRedisConnection } = require('../dist/queue/redis.js');
  const admin = createRedisConnection();
  await admin.flushdb();

  const dispatcher = require('../dist/publishing/publishing.dispatcher.js');
  const processor = require('../dist/publishing/publishing.processor.js');
  const { Queue } = require('bullmq');
  const queue = new Queue('publishing', { connection: createRedisConnection() });

  try {
    await dispatcher.dispatchOnce();
    await waitFor(
      async () =>
        api.state.executeCalls >= 2 &&
        !(await queue.getJob('publication-42-dispatch-1')),
    );
    assert.equal(api.state.deadLetterCalls, 0, 'no domain call on transport exhaustion');

    api.state.executeMode = 'up';
    await dispatcher.dispatchOnce();
    await waitFor(async () => {
      const job = await queue.getJob('publication-42-dispatch-1');
      return Boolean(job) && (await job.getState()) === 'completed';
    });
    assert.equal(api.state.executeCalls, 3);

    await dispatcher.dispatchOnce();
    await new Promise((resolve) => setTimeout(resolve, 300));
    assert.equal(api.state.executeCalls, 3, 'same generation is not delivered twice');

    api.state.generation = 2;
    await dispatcher.dispatchOnce();
    await waitFor(async () => api.state.executeCalls === 4);
  } finally {
    await queue.close();
    await processor.stopPublishingWorker();
    await dispatcher.stopPublishingDispatcher();
    await admin.quit();
    api.server.close();
  }
});
```

- [ ] **Step 6: Run the integration test**

Run (with redis up): `REDIS_HOST=localhost pnpm --filter worker test:int`
Expected: PASS. Without `REDIS_HOST`: FAIL with `REDIS_HOST is required`.

- [ ] **Step 7: Wire CI**

In `.github/workflows/ci.yml`, add a service next to `postgres` in the `node` job:

```yaml
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379
        options: >-
          --health-cmd "redis-cli ping"
          --health-interval 5s
          --health-timeout 5s
          --health-retries 10
```

and a step after the API integration step:

```yaml
      - name: Worker integration tests (Redis)
        run: pnpm --filter worker test:int
        env:
          REDIS_HOST: localhost
```

- [ ] **Step 8: Commit**

```bash
git add apps/worker .github/workflows/ci.yml
git commit -m "feat(worker): dispatch publications by persisted generation with transport-only retries"
```

---

### Task 10: Web calendar status handling

**Files:**
- Modify: `apps/web/src/app/(workspace)/[workspaceSlug]/calendar/calendar-view.tsx` (`statusTone`, `StatusIcon`, new `statusLabel`, `canReschedule`/`canCancel`, the status text renders)

**Interfaces:**
- Consumes: the API statuses `unknown` and `needs_review`, and the 409 messages from Task 6 (already surfaced by the BFF as `payload.error`).

- [ ] **Step 1: Implement**

Add after `StatusIcon`:

```tsx
function statusLabel(status: string) {
  if (status === "unknown") return "Unconfirmed";
  if (status === "needs_review") return "Needs review";
  return status.replaceAll("_", " ");
}
```

In `statusTone`, add before `default`:

```tsx
    case "unknown":
    case "needs_review":
      return "border-orange-200 bg-orange-50 text-orange-700";
```

In `StatusIcon`, add before the final return:

```tsx
  if (status === "unknown" || status === "needs_review") {
    return <AlertCircle className="h-3 w-3" />;
  }
```

Replace `canReschedule` and `canCancel` with the API's allow-list:

```tsx
  const canReschedule =
    selectedPost && ["scheduled", "failed"].includes(selectedPost.status);
  const canCancel =
    selectedPost && ["scheduled", "failed"].includes(selectedPost.status);
```

Replace every rendered `{post.status}` / `{selectedPost.status}` / `{status}` status text (the list row ≈ line 687 and the filter `<option>` ≈ line 464) with `{statusLabel(…)}`.

- [ ] **Step 2: Verify**

Run: `pnpm --filter web lint && pnpm --filter web exec tsc --noEmit && pnpm --filter web build`
Expected: no errors.

Manual check with `pnpm dev:web` and the API running:
1. `update scheduled_publications set status = 'unknown' where id = <one of yours>;`
2. The calendar row shows "Unconfirmed" in orange, and the reschedule and cancel controls are hidden.
3. Revert the row afterwards.

- [ ] **Step 3: Commit**

```bash
git add "apps/web/src/app/(workspace)/[workspaceSlug]/calendar/calendar-view.tsx"
git commit -m "feat(web): show unconfirmed publications and block unsafe schedule edits"
```

---

### Task 11: Docs, env example and full verification

**Files:**
- Modify: `infra/.env.example` (append the publishing variables)
- Modify: `docs/architecture/STAGE_2_RELIABLE_PUBLISHING.md` (add a pointer section)
- Modify: `README.md` (architecture notes list)
- Modify: `docs/architecture/STAGE_15_32A_PUBLICATION_SAFETY_SPEC.md` (status line)

- [ ] **Step 1: Document**

Append to `infra/.env.example` (defaults only, no secrets):

```text
# Stage 15 PR 32A publication safety (see docs/architecture/STAGE_15_32A_PUBLICATION_SAFETY_SPEC.md §8)
PROVIDER_HTTP_TIMEOUT_MS=30000
PUBLISH_PROVIDER_BUDGET_MS=120000
PUBLISH_EXECUTE_TIMEOUT_MS=180000
PUBLISH_LEASE_SECONDS=300
PUBLISH_TRANSPORT_ATTEMPTS=5
PUBLISH_TRANSPORT_BACKOFF_MS=30000
```

At the top of `docs/architecture/STAGE_2_RELIABLE_PUBLISHING.md`, under the title, add:

```markdown
> **Stage 15 update:** retry ownership, unknown outcomes, recovery and job
> identity are superseded by
> [PR 32A — Publication Safety Core](STAGE_15_32A_PUBLICATION_SAFETY_SPEC.md).
```

In `README.md`, after the Stage 15 transactional outbox link, add:

```markdown
- [Stage 15 Production Hardening: publication safety core (32A)](docs/architecture/STAGE_15_32A_PUBLICATION_SAFETY_SPEC.md)
```

In the spec, change the status line to `Status: implemented on feat/stage-15-32a-publication-safety, rev 2`.

Append this hard checklist to `infra/postgres/migrations/README.md` (operators apply migrations from here). Copy the same checklist into the PR description:

```markdown
## 007 rollout (hard sequence — do not reorder)

- [ ] Pause publication dispatch: stop every worker process.
- [ ] Drain: wait for in-flight API executions to finish.
- [ ] Assert zero legacy in-flight work:
      `select count(*) from scheduled_publications where status = 'publishing';` → 0
      `select count(*) from publication_jobs where status in ('processing', 'pending');` → 0
      (If a row cannot drain: verify it on the provider, or run 007 with
      `set sostats.inflight_publications = 'mark_unknown';` in the same session. Never make it retryable.)
- [ ] Apply `007_stage15_publication_safety.sql` (it re-checks the drain and fails loudly).
- [ ] Deploy the API.
- [ ] Deploy the worker (this resumes dispatch).
- [ ] Deploy the web app.
- [ ] Smoke test: one post to a sandbox channel reaches `published`; its attempt row has a request marker and is `completed`.
- [ ] On smoke failure: stop the worker and roll back the code (worker, then API); keep the schema.
```

- [ ] **Step 2: Full verification, exactly as CI runs it**

Run (with db and redis up, env set):

```bash
pnpm migrations:check
pnpm typecheck
pnpm lint
pnpm test
pnpm --filter api test:int
pnpm --filter worker test:int
pnpm build
cd apps/ai && python -m compileall -q app && pytest -q; cd ../..
```

Expected: every command exits 0. Record each command and its result in the PR description (testing policy). If any fails, fix it before continuing; never mark this step done on a failure.

- [ ] **Step 3: Acceptance gate walk-through**

Tick each item in spec §14 against the evidence: the test names from Tasks 2 and 4–9, plus the command output above. Grep for any remaining `where id = ?`-only execution-state write:

```bash
grep -n "\.where(eq(schema.scheduledPublications.id" apps/api/src/modules/publishing/*.ts apps/api/src/modules/scheduling/*.ts
```

Expected: no hits in `publishing.service.ts` or `scheduling.service.ts`. The ledger's writes happen inside a transaction after a locked check or a compare-and-set.

- [ ] **Step 4: Commit**

```bash
git add infra/.env.example infra/postgres/migrations/README.md docs README.md
git commit -m "docs(stage-15): document 32A configuration, rollout runbook and pointers"
```
