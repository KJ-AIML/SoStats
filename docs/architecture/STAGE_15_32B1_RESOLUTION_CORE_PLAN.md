# Stage 15 · PR 32B-1 — Resolution Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give every `unknown` / `needs_review` publication a safe exit: automatic resolution on strong evidence, one audited escalation pass, and owner/admin-only operator resolution (mark published, confirm absent and retry, cancel).

**Architecture:** A new worker clock polls `POST internal/publications/reconcile-due`. The API reads local evidence, then does the Instagram container lookups concurrently outside any transaction. It commits one compare-and-set transaction per row through `PublicationLedger` (state, history row, result reuse, rollup and `audit.enqueue` together). Operators resolve through `POST /v1/schedules/:id/resolution`, a second ledger method with the same atomic shape. The calendar API switches to an explicit projection that carries attempt evidence and reconciliation history, and the web calendar dialog adds the resolution panel.

**Tech Stack:**
- API: NestJS 12 + Fastify (ESM), Drizzle 0.45 over postgres-js, vitest, oxlint.
- Worker: CommonJS, `node:test`.
- Web: Next 16 BFF, React 19.
- Database: PostgreSQL migration `008`.

**Spec:** `docs/architecture/STAGE_15_32B1_RESOLUTION_CORE_SPEC.md` (commit `7703b71`). It builds on `docs/architecture/STAGE_15_32A_PUBLICATION_SAFETY_SPEC.md`. The spec is the binding authority; this plan argues from it.

**Branch:** `feat/stage-15-32b1-resolution-core` (already holds the spec commits). Commit after every task. Do not push.

## Global Constraints

**Invariants (spec §2)**
- 32A invariants I1–I8 still hold. 32B-1 adds no new `execute` statuses.
- R1: a publication becomes `published` automatically only on strong positive evidence (§4.2). Every lookup failure, unsupported capability, credential failure, timeout, rate limit, "not found", and every provider status other than exact `PUBLISHED` is inconclusive. Inconclusive never re-arms, retries or re-sends.
- R2: lookups are at-least-once, but exactly one transition is accepted. The CAS, reconciliation row, result row, rollup and audit event commit in one transaction. A losing CAS writes nothing.
- R3: reconciliation never changes a `publication_jobs` status. The only attempt change is 32A's same-attempt late success (§6).
- R4: the only way back from an ambiguous state to `scheduled` is `confirm_absent`, by an owner or admin, with an explicit time, on an `active` channel that has an access token.
- R5: every accepted automatic outcome and every operator resolution writes its audit event through `audit.enqueue(tx, …)` in the same transaction.
- R6: no raw `provider_checkpoint`, `raw_response` or evidence JSON is ever serialized to clients. Use explicit field projections.
- R7: every accepted automatic pass sets `reconcile_after = null` in its winning CAS.
- R8: nothing in 32B-1 inserts a `publication_jobs` row. Result rows are written only on attempts that exist.

**Code conventions**
- Timestamps: app code uses JS `Date` only; columns are UTC wall-clock `timestamp`. Compare versions and `reconcile_after` truncated to milliseconds (`sameVersion`, and `sameReconcileAfter` from Task 4). SQL-written values carry microseconds; JS values carry milliseconds.
- Lock order everywhere: publication row → attempt row → content item → content variant.
- API code: ESM, so relative imports end in `.js`.
  - Prettier: single quotes, trailing commas.
  - oxlint `no-floating-promises` is an error.
  - Nest-injected classes need value imports (not `import type`).
- Web code uses double quotes. Client components import API types with `import type` from `@/lib/sostats-api.server`.
- The worker is CommonJS, has no DB access, and calls the API with the `x-worker-token` header.

**Logging and secrets**
- Never log or return provider messages, response bodies, tokens or signed URLs.
- Reason codes are fixed strings: `lookup_unavailable`, `credentials_unavailable`, `lookup_failed`, `rate_limited`, `container_not_published`.
- Audit dedupe key: `audit:<action>:<workspaceId>:<publicationId>:<reconciliationId>`.
- System actor: `{ userId: null, email: null, authMethod: 'system' }`.

**Configuration (spec §11)**
- `RECONCILE_GRACE_SECONDS`: default 600, minimum 1, not coupled to `PUBLISH_LEASE_SECONDS`.
- `RECONCILE_BATCH_LIMIT`: default 5, capped at 20.
- `RECONCILE_LOOKUP_BUDGET_MS`: default 45000. The API refuses to boot if it is below `PROVIDER_HTTP_TIMEOUT_MS`.
- `RECONCILE_POLL_MS`: default 30000, minimum 5000 (worker).
- `RECONCILE_REQUEST_TIMEOUT_MS`: default 120000 (worker). The worker refuses to start the dispatcher if it is below `RECONCILE_LOOKUP_BUDGET_MS + 30000`.

**Testing**
- Real Postgres and Redis integration tests are mandatory gates. Never replace them with mocks.
- Set up the integration environment from the repo root. Never print the values:

  ```bash
  export TEST_DATABASE_URL="postgres://$(grep -E '^POSTGRES_USER=' .env | head -1 | cut -d= -f2-):$(grep -E '^POSTGRES_PASSWORD=' .env | head -1 | cut -d= -f2-)@localhost:5432/postgres" REDIS_HOST=localhost
  ```

- API unit test: `pnpm --filter api exec vitest run <path>`.
- API integration test: `pnpm --filter api exec vitest run --config ./vitest.config.int.ts <path>`. Paths are relative to `apps/api`.

**Scope freeze.** Out of scope:
- OAuth refresh race (#35);
- moving the existing post-commit publication audit to the outbox (#33);
- lookup retry/backoff (#34);
- operator actions on `unknown`;
- attaching a post id to an already-published row;
- Facebook, X and LinkedIn lookups (32B-2);
- automation reliability (32C).

## Review Focus

These five inputs are implied by the spec but no spec test covers them. Each is the most likely to bite a real user. Each has a pinning test in the task that owns the code.

1. **`reconcile_after` written by SQL carries microseconds** (migration 008 backfill). A plain-equality CAS against a JS `Date` would lose on every legacy row, forever. Expected: legacy rows resolve on the first pass. Pinned by Task 4's legacy test, which goes through the real 008 migration.
2. **Sibling publications of one content item resolve concurrently** (a reconciler batch, or two 32A successes). Each transaction reads the other sibling as not yet published, so the content item stays `scheduled` forever. Expected: the content item ends `published`. Pinned by Task 3's concurrent sibling test; the rollups lock the content item before reading siblings.
3. **An operator enters a post id that already exists on another publication's result.** Expected: "reuse" is scoped to this publication. The id is inserted on this publication's attempt and never borrowed from another. Pinned by a Task 6 integration test.
4. **Sloppy or hostile operator input.** Expected: 400, never a stored value, never a server-local parse.
   - whitespace-only id or note: treated as absent;
   - `http:` or `javascript:` URL;
   - over-long fields;
   - `scheduledAt` without a timezone, or garbage.

   Pinned by Task 6 unit tests.
5. **A garbage `limit` on the internal endpoint** (`abc`, `-3`, `0`, `1000`). Expected: the configured default or a value clamped to 1..20, never unbounded. Pinned by a Task 4 unit test.

## Plan rulings on spec gaps

- **Calendar endpoint.** Spec §8 says `GET /v1/schedules`; the real calendar endpoint is `GET /v1/calendar` (`SchedulingService.getCalendar`). The projection applies there and to the resolution response.
- **Inconclusive reason.** The reason code is stored in `evidence_type`, which is what the spec's §5.1 examples show. The code writes only the evidence keys `previousStatus`, `duplicatePlatformPostIds` and `scheduledAt`. §5.3's allowed-key list is unchanged; `lookupReason` and `containerStatus` stay allowed but unused.
- **Rollups lock the content item** (`select … for update`) before reading siblings. This fixes Review Focus 2, a latent 32A race, and does not change the lock order.
- **`scheduledAt` for `confirm_absent`** must be ISO-8601 with an explicit `Z` or `±hh:mm`. "Valid ISO date" is read strictly so the server never parses it in its local zone.
- **Resolution responses** use status 200, not Nest's POST default 201.
- **Late success logging.** 32A's `publication.attempt` line still covers late success. The reconciliation row and the audit event are the new records. Automatic decisions are logged by `ReconciliationService`, operator decisions by `ScheduleResolutionService`.
- **Known ceiling: `confirm_absent` channel check.** It reads the account inside the resolution transaction but does not lock it. A disconnect racing it can land after commit. The next attempt then fails as a known `authentication` failure; nothing is posted twice.
- **Batch size.** The worker sends no `limit`, so the API default (`RECONCILE_BATCH_LIMIT`) applies.

## File map

| File | Responsibility |
|---|---|
| `infra/postgres/migrations/008_stage15_publication_resolution.sql` | New table, new column and partial index, backfill (no status change) |
| `apps/api/src/db/schema.ts` | Declares 008: `publicationReconciliations` with its relations, and `reconcileAfter` |
| `apps/api/src/modules/publishing/publishing.config.ts` | Reconcile settings and the boot check |
| `apps/api/src/modules/channels/ports/SocialPublisherPort.ts` | Optional `lookupPublication` capability |
| `apps/api/src/modules/channels/adapters/InstagramPublisherAdapter.ts` | Container lookup (`status_code` only) |
| `apps/api/src/modules/publishing/publication-rollup.ts` (new) | `Tx` type; published, cancelled and re-armed rollups under a content-item lock |
| `apps/api/src/modules/publishing/publication-resolution.ts` (new) | Evidence types, `loadLocalEvidence`, `reuseOrInsertResult`, `appendReconciliation`, `ResolutionAction` |
| `apps/api/src/modules/publishing/publication-state.ts` | `sameReconcileAfter` |
| `apps/api/src/modules/publishing/publication-ledger.ts` | Sets `reconcile_after` on entering unknown; late success; `reconcile()`; `resolve()` |
| `apps/api/src/modules/publishing/publication-reconciliation.service.ts` (new) | Due selection, lookups, per-row commit, logs |
| `apps/api/src/modules/publishing/publishing.controller.ts` / `publishing.module.ts` | `reconcile-due` route; exports the ledger |
| `apps/api/src/modules/scheduling/schedule-view.ts` (new) | Explicit calendar projection (R6) |
| `apps/api/src/modules/scheduling/schedule-resolution.ts` (new) | `parseResolutionBody`, `ScheduleResolutionService` |
| `apps/api/src/modules/scheduling/scheduling.service.ts` / `.controller.ts` / `.module.ts` | Uses the shared rollups; `getSchedule`; `identityConflict` becomes public; resolution route |
| `apps/worker/src/publishing/publishing.api.ts`, `reconciliation.dispatcher.ts` (new), `index.ts` | Worker clock |
| `apps/web/src/lib/sostats-api.server.ts` | Record types |
| `apps/web/src/app/api/workspaces/[workspaceSlug]/schedules/[scheduleId]/resolution/route.ts` (new) | BFF route |
| `apps/web/src/app/(workspace)/[workspaceSlug]/calendar/zoned-time.ts` (new) | Time-zone helpers, moved verbatim from `calendar-view.tsx` |
| `apps/web/src/app/(workspace)/[workspaceSlug]/calendar/resolution-panel.tsx` (new) | Evidence, history and the manager-only actions |
| `apps/web/src/app/(workspace)/[workspaceSlug]/calendar/page.tsx` / `calendar-view.tsx` | Mapping, role gate, dialog wiring |
| `infra/postgres/migrations/README.md`, `infra/.env.example` | Rollout checklist, settings |

---

### Task 1: Migration 008 and schema

**Files:**
- Create: `infra/postgres/migrations/008_stage15_publication_resolution.sql`
- Modify: `apps/api/src/db/schema.ts` (the `scheduledPublications` table at about lines 773–836, a new table after `publicationResults` at about line 889, and the relations at about line 1527)
- Modify: `infra/postgres/migrations/README.md` (the "Current chain" block)
- Test: `apps/api/test/integration/migration-008.int-spec.ts` (new)

**Interfaces:**
- Produces:
  - `schema.publicationReconciliations` (columns listed in spec §5.1);
  - `schema.scheduledPublications.reconcileAfter: Date | null`;
  - the relations `scheduledPublications.reconciliations` (many) and `publicationReconciliations.actor` (one `users`, `{ id, name }`);
  - `export type ReconciliationEvidence` in `schema.ts`.

- [ ] **Step 1: Write the failing migration test**

Create `apps/api/test/integration/migration-008.int-spec.ts`:

```ts
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
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm --filter api exec vitest run --config ./vitest.config.int.ts test/integration/migration-008.int-spec.ts`
Expected: FAIL. Either `column "reconcile_after" does not exist` or `relation "publication_reconciliations" does not exist`.

- [ ] **Step 3: Write the migration**

Create `infra/postgres/migrations/008_stage15_publication_resolution.sql`:

```sql
-- Stage 15 PR 32B-1: publication resolution core.
-- Spec: docs/architecture/STAGE_15_32B1_RESOLUTION_CORE_SPEC.md (§5).
-- Apply after 007. Additive and forward-only: no drain is needed, and it
-- changes no publication status. The new API runtime performs every
-- resolution, audited, in its own transactions.

begin;

alter table scheduled_publications
  add column if not exists reconcile_after timestamp;

create index if not exists scheduled_pub_reconcile_idx
  on scheduled_publications (reconcile_after)
  where status in ('unknown', 'needs_review');

create table if not exists publication_reconciliations (
  id serial primary key,
  scheduled_publication_id integer not null
    references scheduled_publications (id) on delete cascade,
  attempt_id integer references publication_jobs (id) on delete set null,
  source varchar(20) not null,
  outcome varchar(30) not null,
  evidence_type varchar(60) not null,
  platform_post_id varchar(255),
  platform_post_url varchar(1024),
  evidence jsonb not null default '{}'::jsonb,
  actor_user_id integer references users (id) on delete set null,
  note varchar(500),
  created_at timestamp not null default now(),
  constraint publication_reconciliations_source_check
    check (source in ('automatic', 'operator')),
  constraint publication_reconciliations_outcome_check
    check (outcome in ('confirmed_published', 'inconclusive', 'confirmed_absent', 'cancelled'))
);

create index if not exists publication_reconciliations_publication_idx
  on publication_reconciliations (scheduled_publication_id, created_at);

create index if not exists publication_reconciliations_attempt_idx
  on publication_reconciliations (attempt_id);

-- The only data change: make every ambiguous row eligible for one pass (§4.1).
update scheduled_publications
set reconcile_after = now() at time zone 'utc'
where status in ('unknown', 'needs_review');

commit;
```

- [ ] **Step 4: Declare 008 in `schema.ts`**

In `scheduledPublications`, add the column after `nextAttemptAt`:

```ts
    nextAttemptAt: timestamp('next_attempt_at'),
    // 32B-1 §4.1: when the reconciler may next look at an ambiguous row.
    reconcileAfter: timestamp('reconcile_after'),
```

In its index block, add this after `scheduledPubLeaseIdx`:

```ts
      scheduledPubReconcileIdx: index('scheduled_pub_reconcile_idx')
        .on(table.reconcileAfter)
        .where(sql`${table.status} in ('unknown', 'needs_review')`),
```

After the `publicationResults` table, add:

```ts
/** Spec 32B-1 §5.3: the only keys `publication_reconciliations.evidence` may hold. */
export type ReconciliationEvidence = {
  duplicatePlatformPostIds?: string[];
  lookupReason?: string;
  containerStatus?: string;
  previousStatus?: string;
  scheduledAt?: string;
};

// publication_reconciliations — append-only resolution history (spec 32B-1 §5.1)
export const publicationReconciliations = pgTable(
  'publication_reconciliations',
  {
    id: serial('id').primaryKey(),
    scheduledPublicationId: integer('scheduled_publication_id')
      .notNull()
      .references(() => scheduledPublications.id, { onDelete: 'cascade' }),
    attemptId: integer('attempt_id').references(() => publicationJobs.id, {
      onDelete: 'set null',
    }),
    // automatic, operator
    source: varchar('source', { length: 20 }).notNull(),
    // confirmed_published, inconclusive, confirmed_absent, cancelled
    outcome: varchar('outcome', { length: 30 }).notNull(),
    evidenceType: varchar('evidence_type', { length: 60 }).notNull(),
    platformPostId: varchar('platform_post_id', { length: 255 }),
    platformPostUrl: varchar('platform_post_url', { length: 1024 }),
    evidence: jsonb('evidence')
      .$type<ReconciliationEvidence>()
      .notNull()
      .default({}),
    actorUserId: integer('actor_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    note: varchar('note', { length: 500 }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => ({
    publicationReconciliationsPublicationIdx: index(
      'publication_reconciliations_publication_idx',
    ).on(table.scheduledPublicationId, table.createdAt),
    publicationReconciliationsAttemptIdx: index(
      'publication_reconciliations_attempt_idx',
    ).on(table.attemptId),
    publicationReconciliationsSourceCheck: check(
      'publication_reconciliations_source_check',
      sql`${table.source} in ('automatic', 'operator')`,
    ),
    publicationReconciliationsOutcomeCheck: check(
      'publication_reconciliations_outcome_check',
      sql`${table.outcome} in ('confirmed_published', 'inconclusive', 'confirmed_absent', 'cancelled')`,
    ),
  }),
);
```

In `scheduledPublicationsRelations`, add this after `jobs: many(publicationJobs),`:

```ts
    reconciliations: many(publicationReconciliations),
```

After `publicationResultsRelations`, add:

```ts
export const publicationReconciliationsRelations = relations(
  publicationReconciliations,
  ({ one }) => ({
    publication: one(scheduledPublications, {
      fields: [publicationReconciliations.scheduledPublicationId],
      references: [scheduledPublications.id],
    }),
    actor: one(users, {
      fields: [publicationReconciliations.actorUserId],
      references: [users.id],
    }),
  }),
);
```

- [ ] **Step 5: Add 008 to the README chain**

In `infra/postgres/migrations/README.md`, extend the "Current chain" block:

```text
007_stage15_publication_safety.sql
008_stage15_publication_resolution.sql
```

- [ ] **Step 6: Run the test, typecheck and the chain check**

Run:
- `pnpm --filter api exec vitest run --config ./vitest.config.int.ts test/integration/migration-008.int-spec.ts`: expect PASS (2 tests).
- `pnpm --filter api exec tsc --noEmit`: expect no errors.
- `pnpm migrations:check`: expect `Migration chain OK: 8 file(s), 001–008`.

- [ ] **Step 7: Commit**

```bash
git add infra/postgres/migrations/008_stage15_publication_resolution.sql infra/postgres/migrations/README.md apps/api/src/db/schema.ts apps/api/test/integration/migration-008.int-spec.ts
git commit -m "feat(db): add 008 publication resolution schema (32B-1 §5)"
```

---

### Task 2: Reconciliation config and the Instagram `lookupPublication`

**Files:**
- Modify: `apps/api/src/modules/publishing/publishing.config.ts`
- Test: `apps/api/src/modules/publishing/publishing.config.spec.ts`
- Modify: `apps/api/src/modules/channels/ports/SocialPublisherPort.ts`
- Modify: `apps/api/src/modules/channels/adapters/InstagramPublisherAdapter.ts`
- Test: `apps/api/src/modules/channels/adapters/InstagramPublisherAdapter.spec.ts`

**Interfaces:**
- Produces:
  - `PublishingConfig` gains `reconcileGraceMs: number`, `reconcileBatchLimit: number` and `reconcileLookupBudgetMs: number`.
  - `SocialPublisherPort` gains the optional `lookupPublication?(attempt: PublicationLookupAttempt, accessToken: string, signal: AbortSignal): Promise<PublicationLookup>`.
  - New exported types `PublicationLookupAttempt` and `PublicationLookup`, in `SocialPublisherPort.ts`.

- [ ] **Step 1: Write the failing config tests**

In `publishing.config.spec.ts`, replace the `'uses the spec defaults'` test:

```ts
  it('uses the spec defaults', () => {
    expect(loadPublishingConfig({})).toEqual({
      providerHttpTimeoutMs: 30_000,
      providerBudgetMs: 120_000,
      leaseMs: 300_000,
      maxAttempts: 5,
      reconcileGraceMs: 600_000,
      reconcileBatchLimit: 5,
      reconcileLookupBudgetMs: 45_000,
    });
  });
```

Append a new block:

```ts
describe('reconciliation settings (32B-1 §11)', () => {
  it('rejects a lookup budget below the provider request timeout', () => {
    expect(() =>
      loadPublishingConfig({
        PROVIDER_HTTP_TIMEOUT_MS: '30000',
        RECONCILE_LOOKUP_BUDGET_MS: '29999',
      }),
    ).toThrow(/RECONCILE_LOOKUP_BUDGET_MS/);
  });

  it('accepts a lookup budget equal to the provider request timeout', () => {
    expect(
      loadPublishingConfig({
        PROVIDER_HTTP_TIMEOUT_MS: '30000',
        RECONCILE_LOOKUP_BUDGET_MS: '30000',
      }).reconcileLookupBudgetMs,
    ).toBe(30_000);
  });

  it('accepts any grace of at least 1 s, independent of the publish lease', () => {
    expect(
      loadPublishingConfig({
        RECONCILE_GRACE_SECONDS: '1',
        PUBLISH_LEASE_SECONDS: '300',
      }).reconcileGraceMs,
    ).toBe(1_000);
    expect(() => loadPublishingConfig({ RECONCILE_GRACE_SECONDS: '0' })).toThrow(
      /RECONCILE_GRACE_SECONDS/,
    );
  });

  it('caps the batch limit at 20', () => {
    expect(
      loadPublishingConfig({ RECONCILE_BATCH_LIMIT: '50' }).reconcileBatchLimit,
    ).toBe(20);
  });
});
```

- [ ] **Step 2: Write the failing Instagram lookup tests**

In `InstagramPublisherAdapter.spec.ts`, add this block inside the outer `describe('InstagramPublisherAdapter', …)`. The outer `beforeEach` and `afterEach` already set `META_GRAPH_API_VERSION=v26.0` and unstub globals.

```ts
  describe('lookupPublication (32B-1 §4.4)', () => {
    const attempt = {
      operationType: 'instagram_media_publish',
      operationId: 'container-9',
    };
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    const lookup = (
      value: { operationType: string; operationId: string | null } = attempt,
      signal: AbortSignal = AbortSignal.timeout(5_000),
    ) =>
      new InstagramPublisherAdapter(new MetaGraphClient()).lookupPublication(
        value,
        'token',
        signal,
      );

    it('confirms only on status_code PUBLISHED, reading status_code alone', async () => {
      const fetchMock = vi.fn(async (_url: string | URL, _init?: RequestInit) =>
        json({ id: 'container-9', status_code: 'PUBLISHED', status: 'Published' }),
      );
      vi.stubGlobal('fetch', fetchMock);

      await expect(lookup()).resolves.toEqual({
        kind: 'confirmed',
        evidenceType: 'instagram_container_published',
      });
      const url = new URL(String(fetchMock.mock.calls[0]![0]));
      expect(url.pathname).toBe('/v26.0/container-9');
      expect(url.searchParams.get('fields')).toBe('status_code');
      expect(fetchMock.mock.calls[0]![1]?.method ?? 'GET').toBe('GET');
    });

    it.each(['FINISHED', 'IN_PROGRESS', 'ERROR', 'EXPIRED', 'SOMETHING_NEW'])(
      'treats %s as inconclusive and never reads the free-text status',
      async (statusCode) => {
        vi.stubGlobal(
          'fetch',
          vi.fn(async () => json({ status_code: statusCode, status: 'PUBLISHED' })),
        );
        await expect(lookup()).resolves.toEqual({
          kind: 'inconclusive',
          reason: 'container_not_published',
        });
      },
    );

    it('treats an unreadable body as lookup_failed', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response('<html>', { status: 200 })));
      await expect(lookup()).resolves.toEqual({
        kind: 'inconclusive',
        reason: 'lookup_failed',
      });
    });

    it('maps 429 and Meta throttle codes to rate_limited', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => json({}, 429)));
      await expect(lookup()).resolves.toEqual({
        kind: 'inconclusive',
        reason: 'rate_limited',
      });
      vi.stubGlobal(
        'fetch',
        vi.fn(async () =>
          json({ error: { code: 4, message: 'Application request limit reached' } }, 400),
        ),
      );
      await expect(lookup()).resolves.toEqual({
        kind: 'inconclusive',
        reason: 'rate_limited',
      });
    });

    it('maps 5xx, 404 and network failures to lookup_failed', async () => {
      for (const status of [500, 404]) {
        vi.stubGlobal('fetch', vi.fn(async () => json({}, status)));
        await expect(lookup()).resolves.toEqual({
          kind: 'inconclusive',
          reason: 'lookup_failed',
        });
      }
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new TypeError('fetch failed');
        }),
      );
      await expect(lookup()).resolves.toEqual({
        kind: 'inconclusive',
        reason: 'lookup_failed',
      });
    });

    it('is bounded by the caller signal', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(
          (_url: string | URL, init?: RequestInit) =>
            new Promise<Response>((_resolve, reject) => {
              init?.signal?.addEventListener('abort', () =>
                reject(init.signal?.reason),
              );
            }),
        ),
      );
      const controller = new AbortController();
      const pending = lookup(attempt, controller.signal);
      controller.abort();
      await expect(pending).resolves.toEqual({
        kind: 'inconclusive',
        reason: 'lookup_failed',
      });
    });

    it('declines attempts that are not an Instagram media publish with a container id', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      await expect(
        lookup({ operationType: 'facebook_page_feed', operationId: 'x' }),
      ).resolves.toEqual({ kind: 'inconclusive', reason: 'lookup_unavailable' });
      await expect(
        lookup({ operationType: 'instagram_media_publish', operationId: null }),
      ).resolves.toEqual({ kind: 'inconclusive', reason: 'lookup_unavailable' });
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
```

- [ ] **Step 3: Run both tests and confirm they fail**

Run: `pnpm --filter api exec vitest run src/modules/publishing/publishing.config.spec.ts src/modules/channels/adapters/InstagramPublisherAdapter.spec.ts`
Expected: FAIL. The defaults object lacks the `reconcile*` keys, and `lookupPublication is not a function`.

- [ ] **Step 4: Implement the config**

In `publishing.config.ts`, replace the type, the loader body and its doc comment:

```ts
export type PublishingConfig = {
  providerHttpTimeoutMs: number;
  providerBudgetMs: number;
  leaseMs: number;
  maxAttempts: number;
  reconcileGraceMs: number;
  reconcileBatchLimit: number;
  reconcileLookupBudgetMs: number;
};

/** 32A §8 and 32B-1 §11. Throws at boot on unsafe deadline ordering. */
export function loadPublishingConfig(
  env: NodeJS.ProcessEnv = process.env,
): PublishingConfig {
  const config = {
    providerHttpTimeoutMs: providerHttpTimeoutMs(env),
    providerBudgetMs: positiveIntEnv(
      env,
      'PUBLISH_PROVIDER_BUDGET_MS',
      120_000,
    ),
    leaseMs: positiveIntEnv(env, 'PUBLISH_LEASE_SECONDS', 300) * 1000,
    maxAttempts: positiveIntEnv(env, 'PUBLISH_MAX_ATTEMPTS', 5),
    reconcileGraceMs:
      positiveIntEnv(env, 'RECONCILE_GRACE_SECONDS', 600) * 1000,
    reconcileBatchLimit: Math.min(
      20,
      positiveIntEnv(env, 'RECONCILE_BATCH_LIMIT', 5),
    ),
    reconcileLookupBudgetMs: positiveIntEnv(
      env,
      'RECONCILE_LOOKUP_BUDGET_MS',
      45_000,
    ),
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
  if (config.reconcileLookupBudgetMs < config.providerHttpTimeoutMs) {
    throw new Error(
      'RECONCILE_LOOKUP_BUDGET_MS must be at least PROVIDER_HTTP_TIMEOUT_MS',
    );
  }
  return config;
}
```

`positiveIntEnv` already rejects `0`, so a grace below 1 s cannot boot.

- [ ] **Step 5: Add the port capability**

In `SocialPublisherPort.ts`, add these types after `PublishContext`:

```ts
/** Spec 32B-1 §4.4: the attempt facts a lookup may use. */
export type PublicationLookupAttempt = {
  operationType: string;
  operationId: string | null;
};

/** `reason` is a fixed code, never provider text. */
export type PublicationLookup =
  | {
      kind: 'confirmed';
      evidenceType: string;
      platformPostId?: string;
      platformPostUrl?: string;
    }
  | { kind: 'inconclusive'; reason: string };
```

Inside `interface SocialPublisherPort`, add this after `refreshAccessToken`:

```ts
  /** Read-only (32B-1 §4.4): must never create or change a post. */
  lookupPublication?(
    attempt: PublicationLookupAttempt,
    accessToken: string,
    signal: AbortSignal,
  ): Promise<PublicationLookup>;
```

- [ ] **Step 6: Implement the Instagram lookup**

In `InstagramPublisherAdapter.ts`:
- extend the port import with `type PublicationLookup` and `type PublicationLookupAttempt`;
- extend the `./meta-errors.js` import with `metaRateLimited`;
- add this method after `publishPost`. `waitForContainer` stays unchanged.

```ts
  /**
   * 32B-1 §4.4: read-only container check. Only the exact `PUBLISHED` enum
   * confirms; the free-text `status` is never requested or read.
   */
  async lookupPublication(
    attempt: PublicationLookupAttempt,
    accessToken: string,
    signal: AbortSignal,
  ): Promise<PublicationLookup> {
    if (
      attempt.operationType !== 'instagram_media_publish' ||
      !attempt.operationId
    ) {
      return { kind: 'inconclusive', reason: 'lookup_unavailable' };
    }

    const params = new URLSearchParams({
      fields: 'status_code',
      access_token: accessToken,
    });
    let response: Response;
    try {
      response = await fetch(
        `${this.meta.graphUrl(encodeURIComponent(attempt.operationId))}?${params.toString()}`,
        { signal: providerSignal(signal) },
      );
    } catch {
      return { kind: 'inconclusive', reason: 'lookup_failed' };
    }

    const payload = await readJson<ContainerStatusResponse>(response);
    if (!response.ok) {
      return {
        kind: 'inconclusive',
        reason: metaRateLimited(response.status, payload)
          ? 'rate_limited'
          : 'lookup_failed',
      };
    }
    if (!payload?.status_code) {
      return { kind: 'inconclusive', reason: 'lookup_failed' };
    }
    return payload.status_code === 'PUBLISHED'
      ? { kind: 'confirmed', evidenceType: 'instagram_container_published' }
      : { kind: 'inconclusive', reason: 'container_not_published' };
  }
```

- [ ] **Step 7: Run the tests and typecheck**

Run: `pnpm --filter api exec vitest run src/modules/publishing/publishing.config.spec.ts src/modules/channels/adapters/InstagramPublisherAdapter.spec.ts`
Expected: PASS (every existing test plus the new ones).

Run: `pnpm --filter api exec tsc --noEmit`
Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/publishing/publishing.config.ts apps/api/src/modules/publishing/publishing.config.spec.ts apps/api/src/modules/channels/ports/SocialPublisherPort.ts apps/api/src/modules/channels/adapters/InstagramPublisherAdapter.ts apps/api/src/modules/channels/adapters/InstagramPublisherAdapter.spec.ts
git commit -m "feat(publishing): reconciliation config and Instagram lookupPublication (32B-1 §4.4, §11)"
```

---

### Task 3: Resolution primitives, locked rollups, unknown entry and late success

**Files:**
- Create: `apps/api/src/modules/publishing/publication-rollup.ts`
- Create: `apps/api/src/modules/publishing/publication-resolution.ts`
- Modify: `apps/api/src/modules/publishing/publication-ledger.ts`
  - constructor;
  - `recordSuccess` at lines 168–235;
  - the `recordFailure` unknown branch at lines 289–304;
  - the sweeper marker branch at lines 401–426.
- Modify: `apps/api/src/modules/scheduling/scheduling.service.ts`: the `updateSchedule` rollup at lines 330–340, and `cancelSchedule` at lines 363–467.
- Modify: `apps/api/test/integration/publishing-support.ts` (`testAudit`; ledger constructor)
- Modify: `apps/api/test/integration/seed.ts` (`createAmbiguousPublication`, `auditActions`, `reconciliationsOf`)
- Modify: `apps/api/test/integration/scheduling.int-spec.ts:39` (ledger constructor)
- Test: `apps/api/test/integration/publication-ledger.int-spec.ts`

**Interfaces:**
- Consumes: from Task 1, `schema.publicationReconciliations` and `reconcileAfter`; from Task 2, `PublishingConfig.reconcileGraceMs`.
- Produces:
  - **`publication-rollup.ts`:**
    - `export type Tx`
    - `rollupPublished(tx: Tx, row: { id: number; contentItemId: number; variantId: number | null }, now: Date): Promise<void>`
    - `rollupCancelled(tx, row, now)`
    - `rollupRearmed(tx, row, scheduledAt: Date, now)`
  - **`publication-resolution.ts`:**
    - `SYSTEM_ACTOR`
    - `ConfirmedEvidence`, `InconclusiveEvidence`, `ReconcileEvidence`
    - `ResolutionAction`
    - `loadLocalEvidence(executor, publicationId): Promise<ConfirmedEvidence | null>`
    - `reuseOrInsertResult(tx, publicationId, attemptId, platformPostId, platformPostUrl): Promise<number>`
    - `ReconciliationEntry`
    - `appendReconciliation(tx, audit, entry): Promise<number>`
  - **Ledger constructor:** `new PublicationLedger(db, config, audit: AuditLogService)`.
  - **Test helpers:**
    - `testAudit(db)`
    - `createAmbiguousPublication(db, seeded, options)`
    - `auditActions(sql, publicationId): Promise<string[]>`
    - `reconciliationsOf(db, publicationId)`

- [ ] **Step 1: Add the test helpers**

In `apps/api/test/integration/publishing-support.ts`:
- replace `import type { AuditLogService } …` with a value import;
- add two imports;
- add `testAudit`;
- pass the audit to the ledger.

```ts
import { AuditLogService } from '../../src/common/audit/audit-log.service.js';
import { OutboxService } from '../../src/common/outbox/outbox.service.js';
import type { WorkspaceAccessService } from '../../src/common/workspace/workspace-access.service.js';

/** Real transactional audit: `enqueue` writes `outbox_events` in the caller's transaction. */
export function testAudit(db: PostgresJsDatabase<typeof schema>) {
  return new AuditLogService(
    db,
    {} as WorkspaceAccessService,
    new OutboxService(db),
  );
}
```

In `buildPublishing`, change the ledger line to:

```ts
  const ledger = new PublicationLedger(db, config, testAudit(db));
```

The `audit` object returned by `buildPublishing` stays the `{ record: vi.fn() }` mock that `PublishingService` uses.

In `apps/api/test/integration/seed.ts`, add `import { eq } from 'drizzle-orm';` and append:

```ts
/** An `unknown` / `needs_review` publication, optionally with its one attempt row. */
export async function createAmbiguousPublication(
  db: PostgresJsDatabase<typeof schema>,
  seeded: SeededChannel,
  options: {
    status: 'unknown' | 'needs_review';
    reconcileAfter?: Date | null;
    updatedAt?: Date;
    scheduledAt?: Date;
    /** `null`: no attempt row at all (R8). */
    attempt?: {
      operationType?: string;
      operationId?: string | null;
      checkpoint?: Record<string, unknown> | null;
      postIds?: string[];
    } | null;
  },
) {
  const publication = await createPublication(db, seeded, {
    status: options.status,
    reconcileAfter: options.reconcileAfter ?? null,
    ...(options.scheduledAt ? { scheduledAt: options.scheduledAt } : {}),
  });
  let attemptId: number | null = null;
  if (options.attempt !== null) {
    const attempt = options.attempt ?? {};
    const [job] = await db
      .insert(schema.publicationJobs)
      .values({
        scheduledPublicationId: publication.id,
        status: 'unknown',
        attempts: 1,
        attemptNumber: 1,
        lastAttemptAt: new Date(),
        providerRequestStartedAt: new Date(),
        providerOperationType:
          attempt.operationType ?? 'instagram_media_publish',
        providerOperationId:
          attempt.operationId === undefined ? 'container-1' : attempt.operationId,
        providerCheckpoint: attempt.checkpoint ?? null,
      })
      .returning({ id: schema.publicationJobs.id });
    attemptId = job.id;
    for (const platformPostId of attempt.postIds ?? []) {
      await db
        .insert(schema.publicationResults)
        .values({ publicationJobId: job.id, platformPostId });
    }
  }
  const [row] = await db
    .update(schema.scheduledPublications)
    .set({
      activeAttemptId: attemptId,
      ...(options.updatedAt ? { updatedAt: options.updatedAt } : {}),
    })
    .where(eq(schema.scheduledPublications.id, publication.id))
    .returning();
  return row;
}

/** Audit actions enqueued for one publication, oldest first. */
export async function auditActions(sql: postgres.Sql, publicationId: number) {
  const rows = await sql<{ action: string }[]>`
    select payload->>'action' as action from outbox_events
    where topic = 'audit.append'
      and payload->>'targetType' = 'scheduled_publication'
      and payload->>'targetId' = ${String(publicationId)}
    order by id`;
  return rows.map((row) => row.action);
}

export function reconciliationsOf(
  db: PostgresJsDatabase<typeof schema>,
  publicationId: number,
) {
  return db
    .select()
    .from(schema.publicationReconciliations)
    .where(
      eq(schema.publicationReconciliations.scheduledPublicationId, publicationId),
    )
    .orderBy(schema.publicationReconciliations.id);
}
```

In `apps/api/test/integration/scheduling.int-spec.ts`, import `testAudit` from `./publishing-support.js` and change line 39 to:

```ts
    ledger = new PublicationLedger(database.db, loadPublishingConfig({}), testAudit(database.db));
```

- [ ] **Step 2: Write the failing ledger tests**

In `apps/api/test/integration/publication-ledger.int-spec.ts`, update the imports:

```ts
import { auditActions, createAmbiguousPublication, createPublication, reconciliationsOf, seedChannel } from './seed.js';
import { testAudit } from './publishing-support.js';
```

Update the ledger construction in `beforeAll`:

```ts
    ledger = new PublicationLedger(
      database.db,
      { ...loadPublishingConfig({}), maxAttempts: 2 },
      testAudit(database.db),
    );
```

Append this block inside the outer `describe`:

```ts
  describe('32B-1: entering unknown, late success, rollups', () => {
    it('sets reconcile_after to now + grace when the outcome is unknown without local proof', async () => {
      const claim = (await claimOf(await scheduled()))!;
      await ledger.markSideEffect(claim, { operationType: 'test_create_post' });
      const before = Date.now();

      await ledger.recordFailure(claim, 'unknown', 'network_transient', 'socket hang up');

      const row = await reload(claim.publicationId);
      expect(row.status).toBe('unknown');
      expect(row.reconcileAfter!.getTime()).toBeGreaterThanOrEqual(before + 600_000);
      expect(row.reconcileAfter!.getTime()).toBeLessThanOrEqual(Date.now() + 600_000);
    });

    it('makes a provider-confirmed post id due immediately', async () => {
      const claim = (await claimOf(await scheduled()))!;
      await ledger.markSideEffect(claim, { operationType: 'test_create_post' });

      await ledger.recordFailure(claim, 'unknown', 'internal', 'write failed', {
        platformPostId: 'post-9',
      });

      const row = await reload(claim.publicationId);
      expect(row.status).toBe('unknown');
      expect(row.reconcileAfter!.getTime()).toBeLessThanOrEqual(Date.now());
    });

    it('sets reconcile_after when the sweeper finds a started request', async () => {
      const claim = (await claimOf(await scheduled()))!;
      await ledger.markSideEffect(claim, { operationType: 'test_create_post' });
      await expireLease(claim.publicationId);

      await ledger.sweepExpiredLeases();

      const row = await reload(claim.publicationId);
      expect(row.status).toBe('unknown');
      expect(row.reconcileAfter).not.toBeNull();
    });

    it('publishes a late success from needs_review and records it once (§6)', async () => {
      const seeded = await seedChannel(database.sql);
      const row = await createAmbiguousPublication(database.db, seeded, {
        status: 'needs_review',
        reconcileAfter: new Date(),
      });
      const claim = {
        publicationId: row.id,
        attemptId: row.activeAttemptId!,
        attemptNumber: 1,
        attemptCount: 1,
        dispatchGeneration: row.dispatchGeneration,
      };

      await expect(
        ledger.recordSuccess(claim, { postId: 'late-1', url: 'https://x.example/late-1' }),
      ).resolves.toBe(true);

      expect(await reload(row.id)).toMatchObject({ status: 'published', reconcileAfter: null });
      expect(await attempt(claim.attemptId)).toMatchObject({ status: 'completed' });
      expect(await reconciliationsOf(database.db, row.id)).toEqual([
        expect.objectContaining({
          source: 'automatic',
          outcome: 'confirmed_published',
          evidenceType: 'late_confirmed_post_id',
          platformPostId: 'late-1',
          attemptId: claim.attemptId,
          actorUserId: null,
        }),
      ]);
      expect(await auditActions(database.sql, row.id)).toEqual([
        'publication.reconciled_published',
      ]);
    });

    it('keeps an operator decision when the late success arrives afterwards', async () => {
      for (const status of ['cancelled', 'scheduled'] as const) {
        const seeded = await seedChannel(database.sql);
        const row = await createAmbiguousPublication(database.db, seeded, {
          status: 'needs_review',
        });
        await database.db
          .update(sp)
          .set({ status, activeAttemptId: status === 'scheduled' ? null : row.activeAttemptId })
          .where(eq(sp.id, row.id));
        const claim = {
          publicationId: row.id,
          attemptId: row.activeAttemptId!,
          attemptNumber: 1,
          attemptCount: 1,
          dispatchGeneration: row.dispatchGeneration,
        };

        await expect(ledger.recordSuccess(claim, { postId: `late-${status}` })).resolves.toBe(false);

        expect((await reload(row.id)).status).toBe(status);
        expect(await results(claim.attemptId)).toEqual([
          expect.objectContaining({ platformPostId: `late-${status}` }),
        ]);
        expect(await reconciliationsOf(database.db, row.id)).toEqual([]);
      }
    });

    it('rolls a content item up to published when sibling publications succeed concurrently', async () => {
      for (let round = 0; round < 10; round += 1) {
        const seeded = await seedChannel(database.sql);
        const first = await createPublication(database.db, seeded, {
          scheduledAt: new Date(Date.now() - 60_000),
        });
        const second = await createPublication(database.db, seeded, {
          scheduledAt: new Date(Date.now() - 120_000),
        });
        const claims = [(await claimOf(first))!, (await claimOf(second))!];

        await Promise.all(
          claims.map((claim, index) =>
            ledger.recordSuccess(claim, { postId: `sibling-${round}-${index}` }),
          ),
        );

        const [content] = await database.db
          .select()
          .from(schema.contentItems)
          .where(eq(schema.contentItems.id, seeded.contentItemId));
        expect(content!.status).toBe('published');
      }
    });
  });
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run (with the integration env exported): `pnpm --filter api exec vitest run --config ./vitest.config.int.ts test/integration/publication-ledger.int-spec.ts`
Expected: FAIL.
- `reconcileAfter` is `null` in the first three tests.
- `recordSuccess` resolves `false` from `needs_review`.
- The sibling test is a race. It usually fails in at least one round with `scheduled` instead of `published`. If it happens to pass before the fix, continue: Review Focus 2 still requires the lock.

- [ ] **Step 4: Create `publication-rollup.ts`**

```ts
import { eq } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import { ACTIVE_PUBLICATION_STATUSES, isStatusIn } from './publication-state.js';

const sp = schema.scheduledPublications;
const ci = schema.contentItems;
const cv = schema.contentVariants;

export type Tx = Parameters<
  Parameters<PostgresJsDatabase<typeof schema>['transaction']>[0]
>[0];

type RolledUp = { id: number; contentItemId: number; variantId: number | null };

/**
 * Lock order everywhere: publication row, then content item, then variant.
 * Locking the content item before reading siblings serializes concurrent
 * sibling transitions, so the last one to commit sees all the others.
 */
async function siblingsUnderLock(tx: Tx, contentItemId: number) {
  await tx
    .select({ id: ci.id })
    .from(ci)
    .where(eq(ci.id, contentItemId))
    .for('update');
  return tx
    .select({
      id: sp.id,
      status: sp.status,
      variantId: sp.variantId,
      scheduledAt: sp.scheduledAt,
    })
    .from(sp)
    .where(eq(sp.contentItemId, contentItemId));
}

/** The publication just became `published`. */
export async function rollupPublished(tx: Tx, row: RolledUp, now: Date) {
  const siblings = await siblingsUnderLock(tx, row.contentItemId);
  const allDone = siblings.every(
    (sibling) =>
      sibling.id === row.id ||
      ['published', 'cancelled'].includes(sibling.status),
  );
  if (allDone) {
    await tx
      .update(ci)
      .set({ status: 'published', updatedAt: now })
      .where(eq(ci.id, row.contentItemId));
  }
  if (row.variantId) {
    await tx
      .update(cv)
      .set({ status: 'published', publishedAt: now, updatedAt: now })
      .where(eq(cv.id, row.variantId));
  }
}

/** The publication was just cancelled. */
export async function rollupCancelled(tx: Tx, row: RolledUp, now: Date) {
  const siblings = await siblingsUnderLock(tx, row.contentItemId);
  const active = siblings.filter((sibling) =>
    isStatusIn(sibling.status, ACTIVE_PUBLICATION_STATUSES),
  );
  const anyPublished = siblings.some((sibling) => sibling.status === 'published');
  await tx
    .update(ci)
    .set({
      status: active.length ? 'scheduled' : anyPublished ? 'published' : 'in_review',
      updatedAt: now,
    })
    .where(eq(ci.id, row.contentItemId));

  if (row.variantId) {
    const variantSiblings = siblings.filter(
      (sibling) => sibling.variantId === row.variantId,
    );
    const nextActive = variantSiblings
      .filter((sibling) => isStatusIn(sibling.status, ACTIVE_PUBLICATION_STATUSES))
      .sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime())[0];
    const variantPublished = variantSiblings.some(
      (sibling) => sibling.status === 'published',
    );
    await tx
      .update(cv)
      .set({
        status: nextActive ? 'scheduled' : variantPublished ? 'published' : 'draft',
        scheduledAt: nextActive?.scheduledAt || null,
        updatedAt: now,
      })
      .where(eq(cv.id, row.variantId));
  }
}

/** The publication was just re-armed to `scheduled` at `scheduledAt`. */
export async function rollupRearmed(
  tx: Tx,
  row: RolledUp,
  scheduledAt: Date,
  now: Date,
) {
  await tx
    .update(ci)
    .set({ status: 'scheduled', updatedAt: now })
    .where(eq(ci.id, row.contentItemId));
  if (row.variantId) {
    await tx
      .update(cv)
      .set({ status: 'scheduled', scheduledAt, updatedAt: now })
      .where(eq(cv.id, row.variantId));
  }
}
```

- [ ] **Step 5: Create `publication-resolution.ts`**

```ts
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import type { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import * as schema from '../../db/schema.js';
import type {
  AuditActor,
  AuditLogService,
} from '../../common/audit/audit-log.service.js';
import type { Tx } from './publication-rollup.js';

const pj = schema.publicationJobs;
const pr = schema.publicationResults;

export const SYSTEM_ACTOR: AuditActor = {
  userId: null,
  email: null,
  authMethod: 'system',
};

/** Strong positive evidence (32B-1 §4.2). */
export type ConfirmedEvidence = {
  kind: 'confirmed';
  evidenceType: string;
  attemptId: number;
  platformPostId: string | null;
  platformPostUrl: string | null;
  duplicatePlatformPostIds: string[];
};

/** Everything else (R1). `evidenceType` is a fixed reason code. */
export type InconclusiveEvidence = {
  kind: 'inconclusive';
  evidenceType: string;
  attemptId: number | null;
};

export type ReconcileEvidence = ConfirmedEvidence | InconclusiveEvidence;

/** Spec 32B-1 §7.1, after validation. */
export type ResolutionAction =
  | {
      action: 'mark_published';
      platformPostId?: string;
      platformPostUrl?: string;
      note?: string;
    }
  | { action: 'confirm_absent'; scheduledAt: Date; note?: string }
  | { action: 'cancel'; note?: string };

type ReadExecutor = Pick<PostgresJsDatabase<typeof schema>, 'select'>;

/** §4.2 sources 1–2: local proof that the post is live, or null. */
export async function loadLocalEvidence(
  executor: ReadExecutor,
  publicationId: number,
): Promise<ConfirmedEvidence | null> {
  const posted = await executor
    .select({
      attemptId: pr.publicationJobId,
      platformPostId: pr.platformPostId,
      platformPostUrl: pr.platformPostUrl,
    })
    .from(pr)
    .innerJoin(pj, eq(pj.id, pr.publicationJobId))
    .where(
      and(
        eq(pj.scheduledPublicationId, publicationId),
        isNotNull(pr.platformPostId),
      ),
    )
    .orderBy(desc(pr.createdAt), desc(pr.id));
  const latest = posted[0];
  if (latest?.platformPostId) {
    const ids = [...new Set(posted.map((row) => row.platformPostId as string))];
    return {
      kind: 'confirmed',
      evidenceType: 'existing_result_post_id',
      attemptId: latest.attemptId,
      platformPostId: latest.platformPostId,
      platformPostUrl: latest.platformPostUrl,
      duplicatePlatformPostIds: ids.length > 1 ? ids : [],
    };
  }

  const [job] = await executor
    .select({ id: pj.id, checkpoint: pj.providerCheckpoint })
    .from(pj)
    .where(
      and(
        eq(pj.scheduledPublicationId, publicationId),
        sql`${pj.providerCheckpoint} ->> 'confirmedPlatformPostId' is not null`,
      ),
    )
    .orderBy(desc(pj.createdAt), desc(pj.id))
    .limit(1);
  const id = job?.checkpoint?.confirmedPlatformPostId;
  if (!job || typeof id !== 'string' || !id) return null;
  const url = job.checkpoint?.confirmedPlatformPostUrl;
  return {
    kind: 'confirmed',
    evidenceType: 'confirmed_post_id',
    attemptId: job.id,
    platformPostId: id,
    platformPostUrl: typeof url === 'string' ? url : null,
    duplicatePlatformPostIds: [],
  };
}

/**
 * Reuses this publication's result that carries the same post id, and never
 * another publication's. Otherwise inserts one on `attemptId`, which must be
 * a real attempt (R8).
 */
export async function reuseOrInsertResult(
  tx: Tx,
  publicationId: number,
  attemptId: number,
  platformPostId: string,
  platformPostUrl: string | null,
) {
  const [existing] = await tx
    .select({ id: pr.id })
    .from(pr)
    .innerJoin(pj, eq(pj.id, pr.publicationJobId))
    .where(
      and(
        eq(pj.scheduledPublicationId, publicationId),
        eq(pr.platformPostId, platformPostId),
      ),
    )
    .limit(1);
  if (existing) return existing.id;
  const [inserted] = await tx
    .insert(pr)
    .values({ publicationJobId: attemptId, platformPostId, platformPostUrl })
    .returning({ id: pr.id });
  return inserted.id;
}

export type ReconciliationEntry = {
  publicationId: number;
  workspaceId: number;
  attemptId: number | null;
  source: 'automatic' | 'operator';
  outcome: 'confirmed_published' | 'inconclusive' | 'confirmed_absent' | 'cancelled';
  evidenceType: string;
  previousStatus: string;
  platformPostId?: string | null;
  platformPostUrl?: string | null;
  duplicatePlatformPostIds?: string[];
  scheduledAt?: Date;
  note?: string | null;
  actor: AuditActor;
  auditAction: string;
};

/** R5: one history row plus its audit event, in the caller's transaction. */
export async function appendReconciliation(
  tx: Tx,
  audit: Pick<AuditLogService, 'enqueue'>,
  entry: ReconciliationEntry,
) {
  const evidenceType = entry.evidenceType.slice(0, 60);
  const [row] = await tx
    .insert(schema.publicationReconciliations)
    .values({
      scheduledPublicationId: entry.publicationId,
      attemptId: entry.attemptId,
      source: entry.source,
      outcome: entry.outcome,
      evidenceType,
      platformPostId: entry.platformPostId ?? null,
      platformPostUrl: entry.platformPostUrl ?? null,
      evidence: {
        previousStatus: entry.previousStatus,
        ...(entry.duplicatePlatformPostIds?.length
          ? { duplicatePlatformPostIds: entry.duplicatePlatformPostIds }
          : {}),
        ...(entry.scheduledAt
          ? { scheduledAt: entry.scheduledAt.toISOString() }
          : {}),
      },
      actorUserId: entry.actor.userId ?? null,
      note: entry.note ?? null,
    })
    .returning({ id: schema.publicationReconciliations.id });

  await audit.enqueue(
    tx,
    {
      workspaceId: entry.workspaceId,
      actor: entry.actor,
      action: entry.auditAction,
      targetType: 'scheduled_publication',
      targetId: entry.publicationId,
      metadata: {
        reconciliationId: row.id,
        attemptId: entry.attemptId,
        outcome: entry.outcome,
        evidenceType,
        platformPostId: entry.platformPostId ?? null,
        previousStatus: entry.previousStatus,
      },
    },
    `audit:${entry.auditAction}:${entry.workspaceId}:${entry.publicationId}:${row.id}`,
  );
  return row.id;
}
```

- [ ] **Step 6: Update the ledger**

In `publication-ledger.ts`:

1. Add these imports:

```ts
import { AuditLogService } from '../../common/audit/audit-log.service.js';
import { rollupPublished, type Tx } from './publication-rollup.js';
import {
  appendReconciliation,
  loadLocalEvidence,
  SYSTEM_ACTOR,
} from './publication-resolution.js';
```

   Also extend the `./publication-state.js` import with `isStatusIn`.

2. Constructor and helper:

```ts
  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    @Inject(PUBLISHING_CONFIG) private readonly config: PublishingConfig,
    private readonly audit: AuditLogService,
  ) {}

  /** 32B-1 §4.1: known proof is due now; anything else waits for the grace period. */
  private async reconcileAfterOnUnknown(tx: Tx, publicationId: number, now: Date) {
    return (await loadLocalEvidence(tx, publicationId))
      ? now
      : new Date(now.getTime() + this.config.reconcileGraceMs);
  }
```

3. Replace `recordSuccess` entirely:

```ts
  /**
   * 32A §3.3 and 32B-1 §6: only the owning attempt completes. From `unknown` or
   * `needs_review` the same transaction records the late confirmation.
   */
  recordSuccess(
    claim: ClaimedAttempt,
    result: PublishResult,
  ): Promise<boolean> {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      // Lock order everywhere: publication row, then attempt, then content.
      const [current] = await tx
        .select({
          status: sp.status,
          activeAttemptId: sp.activeAttemptId,
          workspaceId: sp.workspaceId,
          contentItemId: sp.contentItemId,
          variantId: sp.variantId,
        })
        .from(sp)
        .where(eq(sp.id, claim.publicationId))
        .for('update');

      await tx.insert(pr).values({
        publicationJobId: claim.attemptId,
        platformPostId: result.postId,
        platformPostUrl: result.url ?? null,
      });
      // A non-owner keeps its status and only leaves the result row as evidence.
      if (
        !current ||
        current.activeAttemptId !== claim.attemptId ||
        !isStatusIn(current.status, ['publishing', 'unknown', 'needs_review'])
      ) {
        return false;
      }

      await tx
        .update(sp)
        .set({
          status: 'published',
          leaseExpiresAt: null,
          reconcileAfter: null,
          updatedAt: now,
        })
        .where(eq(sp.id, claim.publicationId));
      await tx
        .update(pj)
        .set({ status: 'completed', completedAt: now, updatedAt: now })
        .where(
          and(
            eq(pj.id, claim.attemptId),
            inArray(pj.status, ['processing', 'unknown']),
          ),
        );
      await rollupPublished(
        tx,
        {
          id: claim.publicationId,
          contentItemId: current.contentItemId,
          variantId: current.variantId,
        },
        now,
      );

      if (current.status !== 'publishing') {
        await appendReconciliation(tx, this.audit, {
          publicationId: claim.publicationId,
          workspaceId: current.workspaceId,
          attemptId: claim.attemptId,
          source: 'automatic',
          outcome: 'confirmed_published',
          evidenceType: 'late_confirmed_post_id',
          previousStatus: current.status,
          platformPostId: result.postId,
          platformPostUrl: result.url ?? null,
          actor: SYSTEM_ACTOR,
          auditAction: 'publication.reconciled_published',
        });
      }
      return true;
    });
  }
```

4. In `recordFailure`, change the `sp` update in the `kind === 'unknown'` branch to:

```ts
        await tx
          .update(sp)
          .set({
            status: 'unknown',
            leaseExpiresAt: null,
            reconcileAfter: await this.reconcileAfterOnUnknown(
              tx,
              claim.publicationId,
              now,
            ),
            updatedAt: now,
          })
          .where(eq(sp.id, claim.publicationId));
```

5. In `sweepExpiredLeases`, change the `sp` update in the `attempt?.providerRequestStartedAt` branch to:

```ts
            await tx
              .update(sp)
              .set({
                status: 'unknown',
                leaseExpiresAt: null,
                reconcileAfter: await this.reconcileAfterOnUnknown(
                  tx,
                  candidate.id,
                  now,
                ),
                updatedAt: now,
              })
              .where(eq(sp.id, candidate.id));
```

- [ ] **Step 7: Move the scheduling rollups onto the shared helpers**

In `scheduling.service.ts`, add:

```ts
import {
  rollupCancelled,
  rollupRearmed,
} from '../publishing/publication-rollup.js';
```

In `updateSchedule`, replace the two blocks after the `if (!record) { … }` check (the `contentItems` update and the `if (current.variantId)` variant update) with:

```ts
        await rollupRearmed(tx, record, scheduledAt, now);

        return record;
```

Replace `cancelSchedule` with:

```ts
  private cancelSchedule(
    workspaceId: number,
    current: typeof schema.scheduledPublications.$inferSelect,
  ) {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const [record] = await tx
        .update(schema.scheduledPublications)
        .set({ status: 'cancelled', updatedAt: now })
        .where(
          and(
            eq(schema.scheduledPublications.id, current.id),
            eq(schema.scheduledPublications.workspaceId, workspaceId),
            inArray(schema.scheduledPublications.status, [
              ...USER_MUTABLE_PUBLICATION_STATUSES,
            ]),
            sameVersion(
              schema.scheduledPublications.updatedAt,
              current.updatedAt,
            ),
          ),
        )
        .returning();
      if (!record) {
        throw new ConflictException(
          'This publication changed while you were editing it. Refresh and try again.',
        );
      }

      await rollupCancelled(tx, record, now);
      return record;
    });
  }
```

`ACTIVE_PUBLICATION_STATUSES` and `isStatusIn` stay imported: `identityConflict` and `updateSchedule` still use them.

- [ ] **Step 8: Run the tests, the whole integration suite and typecheck**

Run: `pnpm --filter api exec vitest run --config ./vitest.config.int.ts test/integration/publication-ledger.int-spec.ts`
Expected: PASS, including every 32A ledger test.

Run: `pnpm --filter api test:int`
Expected: PASS. The scheduling and publishing-service suites prove the rollup move changed no behaviour.

Run: `pnpm --filter api exec tsc --noEmit && pnpm --filter api lint`
Expected: clean.

- [ ] **Step 9: Commit**

```bash
git add apps/api/src/modules/publishing/publication-rollup.ts apps/api/src/modules/publishing/publication-resolution.ts apps/api/src/modules/publishing/publication-ledger.ts apps/api/src/modules/scheduling/scheduling.service.ts apps/api/test/integration/publishing-support.ts apps/api/test/integration/seed.ts apps/api/test/integration/scheduling.int-spec.ts apps/api/test/integration/publication-ledger.int-spec.ts
git commit -m "feat(publishing): reconcile_after on unknown, late success from needs_review, locked rollups (32B-1 §4.1, §6)"
```

---

### Task 4: Automatic reconciliation

**Files:**
- Modify: `apps/api/src/modules/publishing/publication-state.ts` (`sameReconcileAfter`)
- Modify: `apps/api/src/modules/publishing/publication-ledger.ts` (`reconcile`)
- Create: `apps/api/src/modules/publishing/publication-reconciliation.service.ts`
- Modify: `apps/api/src/modules/publishing/publishing.controller.ts`
- Modify: `apps/api/src/modules/publishing/publishing.module.ts`
- Test: `apps/api/src/modules/publishing/publishing.controller.spec.ts`
- Modify: `apps/api/test/integration/publishing-support.ts` (`lookupAdapter`, `buildReconciler`)
- Test: `apps/api/test/integration/reconciliation.int-spec.ts` (new)

**Interfaces:**
- Consumes: everything Task 3 produces.
- Produces:
  - `sameReconcileAfter(observed: Date | null): SQL`
  - `ReconcileObservation = { publicationId: number; status: 'unknown' | 'needs_review'; reconcileAfter: Date | null; activeAttemptId: number | null }`
  - `ReconcileResult = { reconciliationId: number; workspaceId: number; status: 'published' | 'needs_review' }`
  - `ledger.reconcile(observed, evidence): Promise<ReconcileResult | null>`
  - `ReconciliationService.reconcileDue(limit?: number): Promise<ReconcileDueSummary>`, with `ReconcileDueSummary = { selected: number; results: Array<{ publicationId: number; outcome: 'published' | 'needs_review' | 'lost' | 'error'; evidenceType: string | null }> }`
  - `parseReconcileLimit(raw?: string): number | undefined`
  - the route `POST /internal/publications/reconcile-due?limit=N` (worker token, 200)
  - `PublishingModule` exports `PublicationLedger`.

- [ ] **Step 1: Add the test support**

Append to `apps/api/test/integration/publishing-support.ts`:

```ts
import { ReconciliationService } from '../../src/modules/publishing/publication-reconciliation.service.js';

/** A fake provider that only answers lookups; publishing through it throws. */
export function lookupAdapter(
  lookupPublication: NonNullable<SocialPublisherPort['lookupPublication']>,
) {
  return Object.assign(
    new ScriptedAdapter(async () => {
      throw new Error('publish is not used by reconciliation');
    }),
    { lookupPublication },
  );
}

export function buildReconciler(
  db: PostgresJsDatabase<typeof schema>,
  adapter: SocialPublisherPort,
  options: {
    audit?: Pick<AuditLogService, 'enqueue'>;
    credentials?: Partial<ChannelCredentialService>;
    config?: Partial<PublishingConfig>;
  } = {},
) {
  const config = { ...loadPublishingConfig({}), ...options.config };
  const ledger = new PublicationLedger(
    db,
    config,
    (options.audit ?? testAudit(db)) as AuditLogService,
  );
  const service = new ReconciliationService(
    db,
    ledger,
    { getProvider: () => adapter } as unknown as ProviderRegistry,
    (options.credentials ?? {
      getValidAccessToken: async () => 'token',
    }) as unknown as ChannelCredentialService,
    config,
  );
  return { service, ledger, config };
}
```

Put the new `import` at the top of the file with the others.

- [ ] **Step 2: Write the failing integration tests**

Create `apps/api/test/integration/reconciliation.int-spec.ts`. Each test gets a fresh database because due-selection is global.

```ts
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import * as schema from '../../src/db/schema.js';
import type {
  PublicationLookup,
  SocialPublisherPort,
} from '../../src/modules/channels/ports/SocialPublisherPort.js';
import type { ChannelCredentialService } from '../../src/modules/channels/channel-credential.service.js';
import { createTestDatabase, type TestDatabase } from './test-database.js';
import {
  auditActions,
  createAmbiguousPublication,
  reconciliationsOf,
  seedChannel,
} from './seed.js';
import { buildReconciler, deferred, lookupAdapter } from './publishing-support.js';

const sp = schema.scheduledPublications;
const pj = schema.publicationJobs;
const pr = schema.publicationResults;
const past = () => new Date(Date.now() - 1_000);
const PUBLISHED: PublicationLookup = {
  kind: 'confirmed',
  evidenceType: 'instagram_container_published',
};
const NOT_PUBLISHED: PublicationLookup = {
  kind: 'inconclusive',
  reason: 'container_not_published',
};
const never = lookupAdapter(async () => {
  throw new Error('lookup must not be called');
});

describe('automatic reconciliation (32B-1 §4)', () => {
  let database: TestDatabase;

  beforeEach(async () => {
    database = await createTestDatabase();
  });
  afterEach(async () => {
    await database.drop();
  });

  const reload = async (id: number) =>
    (await database.db.select().from(sp).where(eq(sp.id, id)))[0]!;
  const jobOf = async (id: number) =>
    (await database.db.select().from(pj).where(eq(pj.id, id)))[0]!;
  const resultsOf = (attemptId: number) =>
    database.db.select().from(pr).where(eq(pr.publicationJobId, attemptId));
  async function ambiguous(
    options: Parameters<typeof createAmbiguousPublication>[2],
  ) {
    return createAmbiguousPublication(
      database.db,
      await seedChannel(database.sql, 'instagram'),
      options,
    );
  }

  it('publishes an unknown row with a confirmed id in its checkpoint, without a provider call', async () => {
    const row = await ambiguous({
      status: 'unknown',
      reconcileAfter: past(),
      attempt: {
        checkpoint: {
          confirmedPlatformPostId: 'ig-77',
          confirmedPlatformPostUrl: 'https://instagram.example/p/77',
        },
      },
    });

    const summary = await buildReconciler(database.db, never).service.reconcileDue();

    expect(summary.results).toEqual([
      { publicationId: row.id, outcome: 'published', evidenceType: 'confirmed_post_id' },
    ]);
    expect(await reload(row.id)).toMatchObject({ status: 'published', reconcileAfter: null });
    expect(await jobOf(row.activeAttemptId!)).toMatchObject({ status: 'unknown' }); // R3
    expect(await resultsOf(row.activeAttemptId!)).toEqual([
      expect.objectContaining({
        platformPostId: 'ig-77',
        platformPostUrl: 'https://instagram.example/p/77',
      }),
    ]);
    expect(await reconciliationsOf(database.db, row.id)).toEqual([
      expect.objectContaining({
        source: 'automatic',
        outcome: 'confirmed_published',
        evidenceType: 'confirmed_post_id',
        platformPostId: 'ig-77',
        actorUserId: null,
      }),
    ]);
    expect(await auditActions(database.sql, row.id)).toEqual([
      'publication.reconciled_published',
    ]);
  });

  it('reuses an existing result post id instead of inserting a duplicate', async () => {
    const row = await ambiguous({
      status: 'unknown',
      reconcileAfter: past(),
      attempt: { postIds: ['ig-1'] },
    });

    await buildReconciler(database.db, never).service.reconcileDue();

    expect((await reload(row.id)).status).toBe('published');
    expect(await resultsOf(row.activeAttemptId!)).toHaveLength(1);
    expect(await reconciliationsOf(database.db, row.id)).toEqual([
      expect.objectContaining({
        evidenceType: 'existing_result_post_id',
        platformPostId: 'ig-1',
      }),
    ]);
  });

  it('resolves historical duplicates with the latest id and records every distinct id', async () => {
    const row = await ambiguous({
      status: 'unknown',
      reconcileAfter: past(),
      attempt: { postIds: ['ig-old'] },
    });
    const [second] = await database.db
      .insert(pj)
      .values({ scheduledPublicationId: row.id, status: 'unknown', attemptNumber: 2, attempts: 2 })
      .returning();
    await database.db.insert(pr).values({ publicationJobId: second!.id, platformPostId: 'ig-new' });

    await buildReconciler(database.db, never).service.reconcileDue();

    const [entry] = await reconciliationsOf(database.db, row.id);
    expect(entry).toMatchObject({
      outcome: 'confirmed_published',
      platformPostId: 'ig-new',
      attemptId: second!.id,
    });
    expect([...(entry!.evidence.duplicatePlatformPostIds ?? [])].sort()).toEqual([
      'ig-new',
      'ig-old',
    ]);
  });

  it('publishes on an exact Instagram PUBLISHED without inventing a post id', async () => {
    const row = await ambiguous({ status: 'unknown', reconcileAfter: past() });
    const calls: unknown[] = [];
    const adapter = lookupAdapter(async (attempt) => {
      calls.push(attempt);
      return PUBLISHED;
    });

    await buildReconciler(database.db, adapter).service.reconcileDue();

    expect(calls).toEqual([
      { operationType: 'instagram_media_publish', operationId: 'container-1' },
    ]);
    expect((await reload(row.id)).status).toBe('published');
    expect(await resultsOf(row.activeAttemptId!)).toEqual([]);
    expect(await reconciliationsOf(database.db, row.id)).toEqual([
      expect.objectContaining({
        evidenceType: 'instagram_container_published',
        platformPostId: null,
      }),
    ]);
  });

  async function expectEscalatesAfterGrace(
    lookup: NonNullable<SocialPublisherPort['lookupPublication']>,
    reason: string,
    credentials?: Partial<ChannelCredentialService>,
  ) {
    const row = await ambiguous({
      status: 'unknown',
      reconcileAfter: new Date(Date.now() + 600_000),
    });
    const { service } = buildReconciler(database.db, lookupAdapter(lookup), {
      config: { reconcileLookupBudgetMs: 50 },
      credentials,
    });

    expect((await service.reconcileDue()).selected).toBe(0); // still inside grace
    expect((await reload(row.id)).status).toBe('unknown');

    await database.db.update(sp).set({ reconcileAfter: past() }).where(eq(sp.id, row.id));
    const before = await reload(row.id);
    const summary = await service.reconcileDue();

    expect(summary.results).toEqual([
      { publicationId: row.id, outcome: 'needs_review', evidenceType: reason },
    ]);
    expect(await reload(row.id)).toMatchObject({
      status: 'needs_review',
      reconcileAfter: null,
      dispatchGeneration: before.dispatchGeneration,
      activeAttemptId: before.activeAttemptId,
      attemptCount: before.attemptCount,
    });
    expect(await jobOf(row.activeAttemptId!)).toMatchObject({ status: 'unknown' });
    expect(await reconciliationsOf(database.db, row.id)).toEqual([
      expect.objectContaining({ outcome: 'inconclusive', evidenceType: reason }),
    ]);
    expect(await auditActions(database.sql, row.id)).toEqual([
      'publication.reconciliation_escalated',
    ]);
  }

  it('escalates Instagram FINISHED to needs_review only after grace', () =>
    expectEscalatesAfterGrace(async () => NOT_PUBLISHED, 'container_not_published'));

  it('escalates a failing lookup only after grace', () =>
    expectEscalatesAfterGrace(async () => {
      throw new Error('socket hang up');
    }, 'lookup_failed'));

  it('escalates a lookup that exceeds its budget', () =>
    expectEscalatesAfterGrace(
      (_attempt, _token, signal) =>
        new Promise<PublicationLookup>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason));
        }),
      'lookup_failed',
    ));

  it('escalates a disconnected channel without calling the provider', () =>
    expectEscalatesAfterGrace(
      async () => {
        throw new Error('lookup must not be called');
      },
      'credentials_unavailable',
      {
        getValidAccessToken: async () => {
          throw new Error('Connected channel is unavailable');
        },
      },
    ));

  it('gives needs_review exactly one inconclusive pass (R7)', async () => {
    const row = await ambiguous({ status: 'needs_review', reconcileAfter: past() });
    let lookups = 0;
    const { service } = buildReconciler(
      database.db,
      lookupAdapter(async () => {
        lookups += 1;
        return NOT_PUBLISHED;
      }),
    );

    expect((await service.reconcileDue()).results).toEqual([
      { publicationId: row.id, outcome: 'needs_review', evidenceType: 'container_not_published' },
    ]);
    for (let poll = 0; poll < 3; poll += 1) {
      expect((await service.reconcileDue()).selected).toBe(0);
    }

    expect(lookups).toBe(1);
    expect(await reload(row.id)).toMatchObject({ status: 'needs_review', reconcileAfter: null });
    expect(await reconciliationsOf(database.db, row.id)).toHaveLength(1);
    expect(await auditActions(database.sql, row.id)).toEqual([
      'publication.reconciliation_inconclusive',
    ]);
  });

  it('lets concurrent reconcilers look up twice but transition once (R2)', async () => {
    const row = await ambiguous({ status: 'unknown', reconcileAfter: past() });
    const bothLookedUp = deferred();
    let lookups = 0;
    const adapter = lookupAdapter(async () => {
      lookups += 1;
      if (lookups === 2) bothLookedUp.resolve();
      await bothLookedUp.promise;
      return PUBLISHED;
    });
    const first = buildReconciler(database.db, adapter).service;
    const second = buildReconciler(database.db, adapter).service;

    const summaries = await Promise.all([first.reconcileDue(), second.reconcileDue()]);

    expect(lookups).toBe(2);
    expect(
      summaries.flatMap((summary) => summary.results.map((result) => result.outcome)).sort(),
    ).toEqual(['lost', 'published']);
    expect(await reconciliationsOf(database.db, row.id)).toHaveLength(1);
    expect(await auditActions(database.sql, row.id)).toEqual([
      'publication.reconciled_published',
    ]);
  });

  it('escalates an unknown row with no attempt without creating one (R8)', async () => {
    const row = await ambiguous({ status: 'unknown', reconcileAfter: past(), attempt: null });

    await buildReconciler(database.db, never).service.reconcileDue();

    expect((await reload(row.id)).status).toBe('needs_review');
    expect(
      await database.db.select().from(pj).where(eq(pj.scheduledPublicationId, row.id)),
    ).toEqual([]);
    expect(await reconciliationsOf(database.db, row.id)).toEqual([
      expect.objectContaining({ attemptId: null, evidenceType: 'lookup_unavailable' }),
    ]);
  });

  it('rolls the transition back when the audit event cannot be written (R5)', async () => {
    const row = await ambiguous({
      status: 'unknown',
      reconcileAfter: past(),
      attempt: { postIds: ['ig-5'] },
    });
    const { service } = buildReconciler(database.db, never, {
      audit: {
        enqueue: async () => {
          throw new Error('audit unavailable');
        },
      },
    });

    const summary = await service.reconcileDue();

    expect(summary.results).toEqual([
      { publicationId: row.id, outcome: 'error', evidenceType: null },
    ]);
    const after = await reload(row.id);
    expect(after.status).toBe('unknown');
    expect(after.reconcileAfter).not.toBeNull();
    expect(await reconciliationsOf(database.db, row.id)).toEqual([]);
  });

  it('recovers null reconcile_after unknown rows after grace and never selects null needs_review (§4.1)', async () => {
    const fresh = await ambiguous({ status: 'unknown', reconcileAfter: null });
    const stale = await ambiguous({
      status: 'unknown',
      reconcileAfter: null,
      updatedAt: new Date(Date.now() - 601_000),
    });
    const frozen = await ambiguous({
      status: 'needs_review',
      reconcileAfter: null,
      updatedAt: new Date(Date.now() - 86_400_000),
    });
    const { service } = buildReconciler(database.db, lookupAdapter(async () => NOT_PUBLISHED));

    const summary = await service.reconcileDue();

    expect(summary.results.map((result) => result.publicationId)).toEqual([stale.id]);
    expect(await reload(stale.id)).toMatchObject({ status: 'needs_review', reconcileAfter: null });
    expect((await service.reconcileDue()).selected).toBe(0);
    expect((await reload(fresh.id)).status).toBe('unknown');
    expect((await reload(frozen.id)).status).toBe('needs_review');
  });

  it('refuses a confirmation when the active attempt changed after observation', async () => {
    const row = await ambiguous({ status: 'unknown', reconcileAfter: past() });
    const { ledger } = buildReconciler(database.db, never);

    await expect(
      ledger.reconcile(
        {
          publicationId: row.id,
          status: 'unknown',
          reconcileAfter: row.reconcileAfter,
          activeAttemptId: row.activeAttemptId! + 1_000,
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
    ).resolves.toBeNull();
    expect((await reload(row.id)).status).toBe('unknown');
    expect(await reconciliationsOf(database.db, row.id)).toEqual([]);
  });
});

describe('legacy rows after migration 008 (Review Focus 1)', () => {
  it('publishes a legacy needs_review row that already holds a post id on the first pass', async () => {
    const legacy = await createTestDatabase({ migrate: false });
    try {
      const seeded = await seedChannel(legacy.sql, 'instagram');
      const [publication] = await legacy.sql<{ id: number }[]>`
        insert into scheduled_publications (content_item_id, workspace_id, social_account_id, scheduled_at, status)
        values (${seeded.contentItemId}, ${seeded.workspaceId}, ${seeded.socialAccountId}, now(), 'failed')
        returning id`;
      const [job] = await legacy.sql<{ id: number }[]>`
        insert into publication_jobs (scheduled_publication_id, status, attempts)
        values (${publication!.id}, 'failed', 1) returning id`;
      await legacy.sql`
        insert into publication_results (publication_job_id, platform_post_id)
        values (${job!.id}, 'legacy-post')`;
      // 007 turns it into needs_review; 008 backfills reconcile_after with microseconds.
      await legacy.applyPostBaselineMigrations();

      const summary = await buildReconciler(legacy.db, never).service.reconcileDue();

      expect(summary.results).toEqual([
        {
          publicationId: publication!.id,
          outcome: 'published',
          evidenceType: 'existing_result_post_id',
        },
      ]);
      expect(await auditActions(legacy.sql, publication!.id)).toEqual([
        'publication.reconciled_published',
      ]);
    } finally {
      await legacy.drop();
    }
  });
});
```

- [ ] **Step 3: Write the failing `limit` unit test**

Append to `publishing.controller.spec.ts`, extending its import to `import { parseExecuteBody, parseReconcileLimit } from './publishing.controller.js';`:

```ts
describe('parseReconcileLimit (Review Focus 5)', () => {
  it('falls back to the default on garbage and clamps to 1..20', () => {
    expect(
      [undefined, 'abc', '-3', '2.5', '0', '7', '1000'].map((raw) =>
        parseReconcileLimit(raw),
      ),
    ).toEqual([undefined, undefined, undefined, undefined, 1, 7, 20]);
  });
});
```

- [ ] **Step 4: Run both tests and confirm they fail**

Run: `pnpm --filter api exec vitest run src/modules/publishing/publishing.controller.spec.ts`
Expected: FAIL (`parseReconcileLimit` is not exported).

Run: `pnpm --filter api exec vitest run --config ./vitest.config.int.ts test/integration/reconciliation.int-spec.ts`
Expected: FAIL (cannot resolve `publication-reconciliation.service.js`).

- [ ] **Step 5: Add `sameReconcileAfter`**

Append to `publication-state.ts`:

```ts
/** CAS on an observed `reconcile_after`, at millisecond precision like `sameVersion`. */
export function sameReconcileAfter(observed: Date | null): SQL {
  const column = schema.scheduledPublications.reconcileAfter;
  return observed === null ? sql`${column} is null` : sameVersion(column, observed);
}
```

- [ ] **Step 6: Add `ledger.reconcile`**

In `publication-ledger.ts`:
- extend the drizzle import with `isNull`;
- extend the `./publication-state.js` import with `sameReconcileAfter`;
- extend the `./publication-resolution.js` import with `reuseOrInsertResult` and `type ReconcileEvidence`;
- export these types after `SweepDecision`;
- add the method after `sweepExpiredLeases`.

```ts
export type ReconcileObservation = {
  publicationId: number;
  status: 'unknown' | 'needs_review';
  reconcileAfter: Date | null;
  activeAttemptId: number | null;
};

export type ReconcileResult = {
  reconciliationId: number;
  workspaceId: number;
  status: 'published' | 'needs_review';
};
```

```ts
  /**
   * 32B-1 §4.3 step 3. Exactly one accepted transition per observed state (R2).
   * Every accepted pass clears `reconcile_after` (R7); a lost CAS writes nothing.
   */
  reconcile(
    observed: ReconcileObservation,
    evidence: ReconcileEvidence,
  ): Promise<ReconcileResult | null> {
    return this.db.transaction(async (tx) => {
      const now = new Date();
      const confirmed = evidence.kind === 'confirmed';
      const [row] = await tx
        .update(sp)
        .set(
          confirmed
            ? { status: 'published', leaseExpiresAt: null, reconcileAfter: null, updatedAt: now }
            : { status: 'needs_review', reconcileAfter: null, updatedAt: now },
        )
        .where(
          and(
            eq(sp.id, observed.publicationId),
            eq(sp.status, observed.status),
            sameReconcileAfter(observed.reconcileAfter),
            confirmed
              ? observed.activeAttemptId === null
                ? isNull(sp.activeAttemptId)
                : eq(sp.activeAttemptId, observed.activeAttemptId)
              : undefined,
          ),
        )
        .returning({
          workspaceId: sp.workspaceId,
          contentItemId: sp.contentItemId,
          variantId: sp.variantId,
        });
      if (!row) return null;

      if (evidence.kind === 'confirmed') {
        if (evidence.platformPostId) {
          await reuseOrInsertResult(
            tx,
            observed.publicationId,
            evidence.attemptId,
            evidence.platformPostId,
            evidence.platformPostUrl,
          );
        }
        await rollupPublished(
          tx,
          {
            id: observed.publicationId,
            contentItemId: row.contentItemId,
            variantId: row.variantId,
          },
          now,
        );
      }

      const reconciliationId = await appendReconciliation(tx, this.audit, {
        publicationId: observed.publicationId,
        workspaceId: row.workspaceId,
        attemptId: evidence.attemptId,
        source: 'automatic',
        outcome: confirmed ? 'confirmed_published' : 'inconclusive',
        evidenceType: evidence.evidenceType,
        previousStatus: observed.status,
        ...(evidence.kind === 'confirmed'
          ? {
              platformPostId: evidence.platformPostId,
              platformPostUrl: evidence.platformPostUrl,
              duplicatePlatformPostIds: evidence.duplicatePlatformPostIds,
            }
          : {}),
        actor: SYSTEM_ACTOR,
        auditAction: confirmed
          ? 'publication.reconciled_published'
          : observed.status === 'unknown'
            ? 'publication.reconciliation_escalated'
            : 'publication.reconciliation_inconclusive',
      });
      return {
        reconciliationId,
        workspaceId: row.workspaceId,
        status: confirmed ? 'published' : 'needs_review',
      };
    });
  }
```

- [ ] **Step 7: Create `publication-reconciliation.service.ts`**

```ts
import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, asc, eq, isNull, lte, or, sql } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../db/db.module.js';
import * as schema from '../../db/schema.js';
import { ChannelCredentialService } from '../channels/channel-credential.service.js';
import { ProviderRegistry } from '../channels/ProviderRegistry.js';
import type { SocialPublisherPort } from '../channels/ports/SocialPublisherPort.js';
import {
  PublicationLedger,
  type ReconcileObservation,
} from './publication-ledger.js';
import {
  loadLocalEvidence,
  type ReconcileEvidence,
} from './publication-resolution.js';
import {
  PUBLISHING_CONFIG,
  type PublishingConfig,
} from './publishing.config.js';

const sp = schema.scheduledPublications;

type DueRow = ReconcileObservation & {
  workspaceId: number;
  socialAccountId: number;
};

export type ReconcileDueItem = {
  publicationId: number;
  outcome: 'published' | 'needs_review' | 'lost' | 'error';
  evidenceType: string | null;
};

export type ReconcileDueSummary = {
  selected: number;
  results: ReconcileDueItem[];
};

/** 32B-1 §4: the API side of automatic reconciliation. The worker is only the clock. */
@Injectable()
export class ReconciliationService {
  private readonly logger = new Logger(ReconciliationService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly ledger: PublicationLedger,
    private readonly providerRegistry: ProviderRegistry,
    private readonly credentials: ChannelCredentialService,
    @Inject(PUBLISHING_CONFIG) private readonly config: PublishingConfig,
  ) {}

  async reconcileDue(
    limit = this.config.reconcileBatchLimit,
  ): Promise<ReconcileDueSummary> {
    const now = new Date();
    const graceCutoff = new Date(now.getTime() - this.config.reconcileGraceMs);
    // §4.1 exact due predicate. No lock is held while selecting (§4.3 step 1).
    const rows = (await this.db
      .select({
        publicationId: sp.id,
        workspaceId: sp.workspaceId,
        status: sp.status,
        reconcileAfter: sp.reconcileAfter,
        activeAttemptId: sp.activeAttemptId,
        socialAccountId: sp.socialAccountId,
      })
      .from(sp)
      .where(
        or(
          and(
            eq(sp.status, 'unknown'),
            or(
              lte(sp.reconcileAfter, now),
              and(isNull(sp.reconcileAfter), lte(sp.updatedAt, graceCutoff)),
            ),
          ),
          and(eq(sp.status, 'needs_review'), lte(sp.reconcileAfter, now)),
        ),
      )
      .orderBy(sql`${sp.reconcileAfter} asc nulls first`, asc(sp.id))
      .limit(Math.min(20, Math.max(1, limit)))) as DueRow[];

    // Lookups run outside any transaction and concurrently (§4.3 step 2).
    const settled = await Promise.allSettled(
      rows.map((row) => this.reconcileRow(row)),
    );
    return {
      selected: rows.length,
      results: settled.map((outcome, index) =>
        outcome.status === 'fulfilled'
          ? outcome.value
          : this.failed(rows[index]!, outcome.reason),
      ),
    };
  }

  private async reconcileRow(row: DueRow): Promise<ReconcileDueItem> {
    const evidence =
      (await loadLocalEvidence(this.db, row.publicationId)) ??
      (await this.lookup(row));
    const result = await this.ledger.reconcile(row, evidence);
    if (!result) {
      this.logEvent('publication.reconciliation_lost', {
        workspace_id: row.workspaceId,
        publication_id: row.publicationId,
      });
      return { publicationId: row.publicationId, outcome: 'lost', evidenceType: null };
    }

    this.logEvent('publication.reconciliation', {
      workspace_id: row.workspaceId,
      publication_id: row.publicationId,
      reconciliation_id: result.reconciliationId,
      attempt_id: evidence.attemptId,
      source: 'automatic',
      previous_status: row.status,
      outcome: evidence.kind === 'confirmed' ? 'confirmed_published' : 'inconclusive',
      evidence_type: evidence.evidenceType,
      lookup_reason: evidence.kind === 'inconclusive' ? evidence.evidenceType : null,
      platform_post_id: evidence.kind === 'confirmed' ? evidence.platformPostId : null,
    });
    return {
      publicationId: row.publicationId,
      outcome: result.status,
      evidenceType: evidence.evidenceType,
    };
  }

  /** §4.2 source 3. Every failure is inconclusive (R1) and nothing is thrown. */
  private async lookup(row: DueRow): Promise<ReconcileEvidence> {
    const inconclusive = (reason: string): ReconcileEvidence => ({
      kind: 'inconclusive',
      evidenceType: reason.slice(0, 60),
      attemptId: row.activeAttemptId,
    });
    if (row.activeAttemptId === null) return inconclusive('lookup_unavailable');

    const attempt = await this.db.query.publicationJobs.findFirst({
      where: eq(schema.publicationJobs.id, row.activeAttemptId),
      columns: { id: true, providerOperationType: true, providerOperationId: true },
    });
    const account = await this.db.query.socialAccounts.findFirst({
      where: eq(schema.socialAccounts.id, row.socialAccountId),
    });
    if (!attempt?.providerOperationType || !account) {
      return inconclusive('lookup_unavailable');
    }

    let adapter: SocialPublisherPort;
    try {
      adapter = this.providerRegistry.getProvider(account.provider);
    } catch {
      return inconclusive('lookup_unavailable');
    }
    if (!adapter.lookupPublication) return inconclusive('lookup_unavailable');

    let accessToken: string;
    try {
      accessToken = await this.credentials.getValidAccessToken(account, adapter);
    } catch {
      return inconclusive('credentials_unavailable');
    }

    try {
      const found = await adapter.lookupPublication(
        {
          operationType: attempt.providerOperationType,
          operationId: attempt.providerOperationId,
        },
        accessToken,
        AbortSignal.timeout(this.config.reconcileLookupBudgetMs),
      );
      if (found.kind === 'inconclusive') return inconclusive(found.reason);
      return {
        kind: 'confirmed',
        evidenceType: found.evidenceType.slice(0, 60),
        attemptId: attempt.id,
        platformPostId: found.platformPostId ?? null,
        platformPostUrl: found.platformPostUrl ?? null,
        duplicatePlatformPostIds: [],
      };
    } catch {
      return inconclusive('lookup_failed');
    }
  }

  private failed(row: DueRow, error: unknown): ReconcileDueItem {
    this.logEvent(
      'publication.reconciliation_failed',
      {
        workspace_id: row.workspaceId,
        publication_id: row.publicationId,
        error: error instanceof Error ? error.name : 'unknown',
      },
      'error',
    );
    return { publicationId: row.publicationId, outcome: 'error', evidenceType: null };
  }

  private logEvent(
    event: string,
    fields: Record<string, unknown>,
    level: 'log' | 'error' = 'log',
  ) {
    this.logger[level](JSON.stringify({ event, ...fields }));
  }
}
```

- [ ] **Step 8: Add the route and wire the module**

In `publishing.controller.ts`:
- import `ReconciliationService` (a value import, from `./publication-reconciliation.service.js`);
- add the parser below `parseExecuteBody`;
- add the constructor parameter and the route.

```ts
/** Internal batch size: the config default on garbage, else clamped to 1..20 (32B-1 §4.3). */
export function parseReconcileLimit(raw?: string): number | undefined {
  if (raw === undefined || !/^\d+$/.test(raw)) return undefined;
  return Math.min(20, Math.max(1, Number(raw)));
}
```

```ts
  constructor(
    private readonly publishingService: PublishingService,
    private readonly reconciliation: ReconciliationService,
  ) {}
```

```ts
  @Post('reconcile-due')
  @HttpCode(200)
  reconcileDue(@Query('limit') limit?: string) {
    return this.reconciliation.reconcileDue(parseReconcileLimit(limit));
  }
```

In `publishing.module.ts`, import `ReconciliationService` and change the providers and exports:

```ts
  providers: [
    PublishingService,
    PublicationLedger,
    ReconciliationService,
    WorkerTokenGuard,
    { provide: PUBLISHING_CONFIG, useFactory: () => loadPublishingConfig() },
  ],
  exports: [PublishingService, PublicationLedger],
```

- [ ] **Step 9: Run the tests and typecheck**

Run: `pnpm --filter api exec vitest run src/modules/publishing/publishing.controller.spec.ts`
Expected: PASS.

Run: `pnpm --filter api exec vitest run --config ./vitest.config.int.ts test/integration/reconciliation.int-spec.ts`
Expected: PASS (15 tests).

Run: `pnpm --filter api exec tsc --noEmit && pnpm --filter api lint`
Expected: clean.

- [ ] **Step 10: Commit**

```bash
git add apps/api/src/modules/publishing apps/api/test/integration/publishing-support.ts apps/api/test/integration/reconciliation.int-spec.ts
git commit -m "feat(publishing): automatic reconciliation of unknown and needs_review (32B-1 §4)"
```

---

### Task 5: Explicit calendar projection

**Files:**
- Create: `apps/api/src/modules/scheduling/schedule-view.ts`
- Modify: `apps/api/src/modules/scheduling/scheduling.service.ts` (`getCalendar`; new `getSchedule` and private `findSchedules`)
- Test: `apps/api/test/integration/calendar-projection.int-spec.ts` (new)

**Interfaces:**
- Consumes: from Task 1, the `reconciliations` and `actor` relations; from Task 3, `createAmbiguousPublication`.
- Produces:
  - `toScheduleView(row)`;
  - `SchedulingService.getSchedule(workspaceId: number, id: number)`, which returns one schedule in the calendar projection or throws `NotFoundException`.
  - Each schedule carries every `scheduled_publications` column, plus `contentItem`, `variant`, `socialAccount` and the explicit `jobs[]`.
  - It also carries `attemptEvidence: { requestStartedAt, operationType, operationId, confirmedPlatformPostId, confirmedPlatformPostUrl } | null`.
  - It also carries `reconciliations[]` (latest 20): `{ source, outcome, evidenceType, platformPostId, platformPostUrl, duplicatePlatformPostIds, actor: { id, name } | null, note, createdAt }`.

- [ ] **Step 1: Write the failing projection test**

Create `apps/api/test/integration/calendar-projection.int-spec.ts`:

```ts
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
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `pnpm --filter api exec vitest run --config ./vitest.config.int.ts test/integration/calendar-projection.int-spec.ts`
Expected: FAIL. `attemptEvidence` is `undefined`, the JSON contains `providerCheckpoint`, and `getSchedule` is not a function.

- [ ] **Step 3: Create `schedule-view.ts`**

```ts
import type * as schema from '../../db/schema.js';

type Job = Pick<
  typeof schema.publicationJobs.$inferSelect,
  | 'id'
  | 'status'
  | 'attemptNumber'
  | 'attempts'
  | 'lastAttemptAt'
  | 'nextAttemptAt'
  | 'completedAt'
  | 'errorClass'
  | 'providerRequestStartedAt'
  | 'providerOperationType'
  | 'providerOperationId'
  | 'providerCheckpoint'
> & {
  results: Array<
    Pick<
      typeof schema.publicationResults.$inferSelect,
      'id' | 'platformPostId' | 'platformPostUrl' | 'errorType' | 'errorMessage' | 'createdAt'
    >
  >;
};

type Reconciliation = Pick<
  typeof schema.publicationReconciliations.$inferSelect,
  | 'source'
  | 'outcome'
  | 'evidenceType'
  | 'platformPostId'
  | 'platformPostUrl'
  | 'evidence'
  | 'note'
  | 'createdAt'
> & { actor: { id: number; name: string | null } | null };

const text = (value: unknown) =>
  typeof value === 'string' && value ? value : null;

/**
 * 32B-1 §8 / R6: explicit fields only. The raw checkpoint and the evidence
 * JSON are read here and never returned.
 */
export function toScheduleView<
  T extends {
    activeAttemptId: number | null;
    jobs: Job[];
    reconciliations: Reconciliation[];
  },
>(row: T) {
  const { jobs, reconciliations, ...schedule } = row;
  const active = jobs.find((job) => job.id === row.activeAttemptId);
  return {
    ...schedule,
    jobs: jobs.map((job) => ({
      id: job.id,
      status: job.status,
      attemptNumber: job.attemptNumber,
      attempts: job.attempts,
      lastAttemptAt: job.lastAttemptAt,
      nextAttemptAt: job.nextAttemptAt,
      completedAt: job.completedAt,
      errorClass: job.errorClass,
      results: job.results.map((result) => ({
        id: result.id,
        platformPostId: result.platformPostId,
        platformPostUrl: result.platformPostUrl,
        errorType: result.errorType,
        errorMessage: result.errorMessage,
        createdAt: result.createdAt,
      })),
    })),
    attemptEvidence: active
      ? {
          requestStartedAt: active.providerRequestStartedAt,
          operationType: active.providerOperationType,
          operationId: active.providerOperationId,
          confirmedPlatformPostId: text(
            active.providerCheckpoint?.confirmedPlatformPostId,
          ),
          confirmedPlatformPostUrl: text(
            active.providerCheckpoint?.confirmedPlatformPostUrl,
          ),
        }
      : null,
    reconciliations: reconciliations.map((entry) => ({
      source: entry.source,
      outcome: entry.outcome,
      evidenceType: entry.evidenceType,
      platformPostId: entry.platformPostId,
      platformPostUrl: entry.platformPostUrl,
      duplicatePlatformPostIds: Array.isArray(
        entry.evidence?.duplicatePlatformPostIds,
      )
        ? entry.evidence.duplicatePlatformPostIds.filter(
            (id): id is string => typeof id === 'string',
          )
        : [],
      actor: entry.actor ? { id: entry.actor.id, name: entry.actor.name } : null,
      note: entry.note,
      createdAt: entry.createdAt,
    })),
  };
}
```

- [ ] **Step 4: Route the calendar through the projection**

In `scheduling.service.ts`:
- change the drizzle import to `import { and, eq, gte, inArray, lte, type SQL } from 'drizzle-orm';`;
- add `import { toScheduleView } from './schedule-view.js';`;
- replace the `return this.db.query.scheduledPublications.findMany({ … })` at the end of `getCalendar` with `return this.findSchedules(and(...conditions));`;
- add these two methods after `getCalendar`.

```ts
  async getSchedule(workspaceId: number, id: number) {
    const [schedule] = await this.findSchedules(
      and(
        eq(schema.scheduledPublications.id, id),
        eq(schema.scheduledPublications.workspaceId, workspaceId),
      ),
    );
    if (!schedule) throw new NotFoundException('Scheduled publication not found');
    return schedule;
  }

  /** 32B-1 §8: the one safe projection for calendar reads and resolution responses. */
  private async findSchedules(where: SQL | undefined) {
    const rows = await this.db.query.scheduledPublications.findMany({
      where,
      with: {
        contentItem: { with: { campaign: true } },
        variant: true,
        socialAccount: { columns: PUBLIC_SOCIAL_ACCOUNT_COLUMNS },
        jobs: {
          columns: {
            id: true,
            status: true,
            attemptNumber: true,
            attempts: true,
            lastAttemptAt: true,
            nextAttemptAt: true,
            completedAt: true,
            errorClass: true,
            providerRequestStartedAt: true,
            providerOperationType: true,
            providerOperationId: true,
            providerCheckpoint: true,
          },
          with: {
            results: {
              columns: {
                id: true,
                platformPostId: true,
                platformPostUrl: true,
                errorType: true,
                errorMessage: true,
                createdAt: true,
              },
            },
          },
        },
        reconciliations: {
          columns: {
            source: true,
            outcome: true,
            evidenceType: true,
            platformPostId: true,
            platformPostUrl: true,
            evidence: true,
            note: true,
            createdAt: true,
          },
          with: { actor: { columns: { id: true, name: true } } },
          orderBy: (fields, { desc }) => [desc(fields.createdAt), desc(fields.id)],
          limit: 20,
        },
      },
      orderBy: (fields, { asc }) => [asc(fields.scheduledAt)],
    });
    return rows.map((row) => toScheduleView(row));
  }
```

- [ ] **Step 5: Run the tests and typecheck**

Run: `pnpm --filter api exec vitest run --config ./vitest.config.int.ts test/integration/calendar-projection.int-spec.ts test/integration/account-projection.int-spec.ts`
Expected: PASS.

Run: `pnpm --filter api exec tsc --noEmit && pnpm --filter api lint`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/modules/scheduling/schedule-view.ts apps/api/src/modules/scheduling/scheduling.service.ts apps/api/test/integration/calendar-projection.int-spec.ts
git commit -m "feat(scheduling): explicit calendar projection with attempt evidence and history (32B-1 §8)"
```

---

### Task 6: Operator resolution

**Files:**
- Modify: `apps/api/src/modules/publishing/publication-ledger.ts` (`resolve`)
- Create: `apps/api/src/modules/scheduling/schedule-resolution.ts`
- Test: `apps/api/src/modules/scheduling/schedule-resolution.spec.ts` (new)
- Modify: `apps/api/src/modules/scheduling/scheduling.service.ts` (`identityConflict` becomes public)
- Modify: `apps/api/src/modules/scheduling/scheduling.controller.ts`
- Modify: `apps/api/src/modules/scheduling/scheduling.module.ts`
- Modify: `apps/api/test/integration/seed.ts` (`seedMember`)
- Test: `apps/api/test/integration/schedule-resolution.int-spec.ts` (new)

**Interfaces:**
- Consumes:
  - from Task 3: `ResolutionAction`, the rollups and `appendReconciliation`;
  - from Task 4: `ledger.reconcile` (used in the race test);
  - from Task 5: `SchedulingService.getSchedule`.
- Produces:
  - `ResolveResult = { kind: 'resolved'; reconciliationId: number; attemptId: number | null } | { kind: 'not_found' } | { kind: 'status_conflict'; status: string } | { kind: 'channel_unusable' }`
  - `ledger.resolve({ publicationId, workspaceId, actor, resolution }): Promise<ResolveResult>`
  - `parseResolutionBody(body: unknown): ResolutionAction`
  - `ScheduleResolutionService.resolve(workspaceId, scheduleId, user: AuthenticatedUser, resolution)`, which returns the `getSchedule` projection
  - the route `POST /v1/schedules/:id/resolution` (200)
  - the test helper `seedMember(sql, workspaceId, role): Promise<AuthenticatedUser>`

- [ ] **Step 1: Write the failing validation tests**

Create `apps/api/src/modules/scheduling/schedule-resolution.spec.ts`:

```ts
import { BadRequestException } from '@nestjs/common';
import { describe, expect, it } from 'vitest';
import { parseResolutionBody } from './schedule-resolution.js';

describe('parseResolutionBody (32B-1 §7.1)', () => {
  it('parses the three actions and trims text', () => {
    expect(
      parseResolutionBody({
        action: 'mark_published',
        platformPostId: '  123  ',
        platformPostUrl: 'https://x.com/a/status/123',
        note: ' checked ',
      }),
    ).toEqual({
      action: 'mark_published',
      platformPostId: '123',
      platformPostUrl: 'https://x.com/a/status/123',
      note: 'checked',
    });
    expect(
      parseResolutionBody({
        action: 'confirm_absent',
        scheduledAt: '2026-10-01T09:00:00.000+07:00',
      }),
    ).toEqual({
      action: 'confirm_absent',
      scheduledAt: new Date('2026-10-01T02:00:00.000Z'),
    });
    expect(parseResolutionBody({ action: 'cancel' })).toEqual({ action: 'cancel' });
  });

  it('treats whitespace-only optional text as absent (Review Focus 4)', () => {
    expect(
      parseResolutionBody({ action: 'mark_published', platformPostId: '   ', note: '' }),
    ).toEqual({ action: 'mark_published' });
  });

  it.each([
    [{}, /action/],
    [{ action: 'retry' }, /action/],
    [{ action: 'confirm_absent' }, /scheduledAt/],
    [{ action: 'confirm_absent', scheduledAt: 'tomorrow' }, /scheduledAt/],
    [{ action: 'confirm_absent', scheduledAt: '2026-10-01T09:00' }, /scheduledAt/],
    [{ action: 'mark_published', platformPostId: 'x'.repeat(256) }, /platformPostId/],
    [{ action: 'mark_published', platformPostId: 42 }, /platformPostId/],
    [{ action: 'mark_published', platformPostUrl: 'http://x.com/p/1' }, /platformPostUrl/],
    [{ action: 'mark_published', platformPostUrl: 'javascript:alert(1)' }, /platformPostUrl/],
    [{ action: 'mark_published', platformPostUrl: `https://x.com/${'a'.repeat(1024)}` }, /platformPostUrl/],
    [{ action: 'cancel', note: 'n'.repeat(501) }, /note/],
  ])('rejects %j with a 400', (body, message) => {
    expect(() => parseResolutionBody(body)).toThrow(BadRequestException);
    expect(() => parseResolutionBody(body)).toThrow(message);
  });
});
```

- [ ] **Step 2: Add `seedMember` and write the failing integration tests**

Append to `apps/api/test/integration/seed.ts`, adding `import type { AuthenticatedUser } from '../../src/common/auth/auth.types.js';`:

```ts
export async function seedMember(
  sql: postgres.Sql,
  workspaceId: number,
  role: 'owner' | 'admin' | 'member',
): Promise<AuthenticatedUser> {
  counter += 1;
  const key = `${process.pid}-${Date.now()}-${counter}`;
  const [user] = await sql<{ id: number; email: string; name: string }[]>`
    insert into users (email, name) values (${`user-${key}@example.test`}, ${`User ${key}`})
    returning id, email, name`;
  await sql`
    insert into workspace_members (workspace_id, user_id, role)
    values (${workspaceId}, ${user!.id}, ${role})`;
  return {
    id: user!.id,
    subject: `test|${user!.id}`,
    email: user!.email,
    name: user!.name,
    authMethod: 'jwt',
  };
}
```

Create `apps/api/test/integration/schedule-resolution.int-spec.ts`:

```ts
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
```

- [ ] **Step 3: Run the tests and confirm they fail**

Run: `pnpm --filter api exec vitest run src/modules/scheduling/schedule-resolution.spec.ts`
Expected: FAIL (cannot resolve `./schedule-resolution.js`).

Run: `pnpm --filter api exec vitest run --config ./vitest.config.int.ts test/integration/schedule-resolution.int-spec.ts`
Expected: FAIL (same module missing).

- [ ] **Step 4: Add `ledger.resolve`**

In `publication-ledger.ts`:
- extend the drizzle import with `desc`;
- import `rollupCancelled` and `rollupRearmed` next to `rollupPublished`;
- extend the `./publication-resolution.js` import with `type ResolutionAction`;
- extend the audit import to `import { AuditLogService, type AuditActor } from '../../common/audit/audit-log.service.js';`;
- export these types next to `ReconcileResult`;
- add the method after `reconcile`.

```ts
export type ResolveRequest = {
  publicationId: number;
  workspaceId: number;
  actor: AuditActor;
  resolution: ResolutionAction;
};

export type ResolveResult =
  | { kind: 'resolved'; reconciliationId: number; attemptId: number | null }
  | { kind: 'not_found' }
  | { kind: 'status_conflict'; status: string }
  | { kind: 'channel_unusable' };
```

```ts
  /**
   * 32B-1 §7.2. One transaction per action: the CAS on `needs_review` under the
   * row lock, the history row, any result, the rollup and the audit (R2, R5).
   */
  resolve(request: ResolveRequest): Promise<ResolveResult> {
    const { publicationId, workspaceId, resolution } = request;
    return this.db.transaction(async (tx): Promise<ResolveResult> => {
      const now = new Date();
      const [current] = await tx
        .select({
          id: sp.id,
          status: sp.status,
          activeAttemptId: sp.activeAttemptId,
          contentItemId: sp.contentItemId,
          variantId: sp.variantId,
          socialAccountId: sp.socialAccountId,
        })
        .from(sp)
        .where(and(eq(sp.id, publicationId), eq(sp.workspaceId, workspaceId)))
        .for('update');
      if (!current) return { kind: 'not_found' };
      if (current.status !== 'needs_review') {
        return { kind: 'status_conflict', status: current.status };
      }

      const [latest] =
        current.activeAttemptId === null
          ? await tx
              .select({ id: pj.id })
              .from(pj)
              .where(eq(pj.scheduledPublicationId, publicationId))
              .orderBy(desc(pj.createdAt), desc(pj.id))
              .limit(1)
          : [{ id: current.activeAttemptId }];
      const attemptId = latest?.id ?? null;
      const base = {
        publicationId,
        workspaceId,
        attemptId,
        source: 'operator' as const,
        evidenceType: 'operator_attested',
        previousStatus: current.status,
        actor: request.actor,
        note: resolution.note ?? null,
      };

      if (resolution.action === 'mark_published') {
        await tx
          .update(sp)
          .set({ status: 'published', leaseExpiresAt: null, reconcileAfter: null, updatedAt: now })
          .where(eq(sp.id, publicationId));
        if (resolution.platformPostId && attemptId !== null) {
          await reuseOrInsertResult(
            tx,
            publicationId,
            attemptId,
            resolution.platformPostId,
            resolution.platformPostUrl ?? null,
          );
        }
        await rollupPublished(tx, current, now);
        const reconciliationId = await appendReconciliation(tx, this.audit, {
          ...base,
          outcome: 'confirmed_published',
          platformPostId: resolution.platformPostId ?? null,
          platformPostUrl: resolution.platformPostUrl ?? null,
          auditAction: 'publication.resolution_marked_published',
        });
        return { kind: 'resolved', reconciliationId, attemptId };
      }

      if (resolution.action === 'confirm_absent') {
        const [account] = await tx
          .select({
            status: schema.socialAccounts.status,
            hasToken: sql<boolean>`${schema.socialAccounts.accessToken} is not null`,
          })
          .from(schema.socialAccounts)
          .where(eq(schema.socialAccounts.id, current.socialAccountId));
        if (account?.status !== 'active' || !account.hasToken) {
          return { kind: 'channel_unusable' };
        }
        // R4: 32A's rearmSet plus the resolution fields; the identity index may reject it.
        await tx
          .update(sp)
          .set({
            ...rearmSet(now, null),
            attemptCount: 0,
            scheduledAt: resolution.scheduledAt,
            reconcileAfter: null,
          })
          .where(eq(sp.id, publicationId));
        await rollupRearmed(tx, current, resolution.scheduledAt, now);
        const reconciliationId = await appendReconciliation(tx, this.audit, {
          ...base,
          outcome: 'confirmed_absent',
          scheduledAt: resolution.scheduledAt,
          auditAction: 'publication.resolution_confirmed_absent',
        });
        return { kind: 'resolved', reconciliationId, attemptId };
      }

      await tx
        .update(sp)
        .set({ status: 'cancelled', leaseExpiresAt: null, reconcileAfter: null, updatedAt: now })
        .where(eq(sp.id, publicationId));
      await rollupCancelled(tx, current, now);
      const reconciliationId = await appendReconciliation(tx, this.audit, {
        ...base,
        outcome: 'cancelled',
        auditAction: 'publication.resolution_cancelled',
      });
      return { kind: 'resolved', reconciliationId, attemptId };
    });
  }
```

- [ ] **Step 5: Create `schedule-resolution.ts`**

```ts
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import { DRIZZLE } from '../../db/db.module.js';
import * as schema from '../../db/schema.js';
import { isUniqueViolation } from '../../db/pg-errors.js';
import { actorFromUser } from '../../common/audit/audit-log.service.js';
import type { AuthenticatedUser } from '../../common/auth/auth.types.js';
import { WorkspaceAccessService } from '../../common/workspace/workspace-access.service.js';
import {
  PublicationLedger,
  type ResolveResult,
} from '../publishing/publication-ledger.js';
import type { ResolutionAction } from '../publishing/publication-resolution.js';
import { ACTIVE_IDENTITY_INDEX } from '../publishing/publication-state.js';
import { SchedulingService } from './scheduling.service.js';

const sp = schema.scheduledPublications;
const ISO_WITH_ZONE =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$/;
const OPERATOR_OUTCOME = {
  mark_published: 'confirmed_published',
  confirm_absent: 'confirmed_absent',
  cancel: 'cancelled',
} as const;

function optionalText(value: unknown, field: string, max: number) {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'string') {
    throw new BadRequestException(`${field} must be a string`);
  }
  const trimmed = value.trim();
  if (trimmed.length > max) {
    throw new BadRequestException(`${field} must be at most ${max} characters`);
  }
  return trimmed || undefined;
}

function optionalHttpsUrl(value: unknown) {
  const url = optionalText(value, 'platformPostUrl', 1024);
  if (url === undefined) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new BadRequestException('platformPostUrl must be an https URL');
  }
  if (parsed.protocol !== 'https:') {
    throw new BadRequestException('platformPostUrl must be an https URL');
  }
  return url;
}

/** 32B-1 §7.1. Pure validation (no reads). Invalid input is a 400. */
export function parseResolutionBody(body: unknown): ResolutionAction {
  const input = (body && typeof body === 'object' ? body : {}) as Record<
    string,
    unknown
  >;
  const note = optionalText(input.note, 'note', 500);
  switch (input.action) {
    case 'mark_published':
      return {
        action: 'mark_published',
        platformPostId: optionalText(input.platformPostId, 'platformPostId', 255),
        platformPostUrl: optionalHttpsUrl(input.platformPostUrl),
        note,
      };
    case 'confirm_absent': {
      const raw = input.scheduledAt;
      if (
        typeof raw !== 'string' ||
        !ISO_WITH_ZONE.test(raw) ||
        Number.isNaN(Date.parse(raw))
      ) {
        throw new BadRequestException(
          'scheduledAt must be an ISO timestamp with a timezone',
        );
      }
      return { action: 'confirm_absent', scheduledAt: new Date(raw), note };
    }
    case 'cancel':
      return { action: 'cancel', note };
    default:
      throw new BadRequestException(
        'action must be mark_published, confirm_absent or cancel',
      );
  }
}

@Injectable()
export class ScheduleResolutionService {
  private readonly logger = new Logger(ScheduleResolutionService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: PostgresJsDatabase<typeof schema>,
    private readonly access: WorkspaceAccessService,
    private readonly ledger: PublicationLedger,
    private readonly scheduling: SchedulingService,
  ) {}

  async resolve(
    workspaceId: number,
    scheduleId: number,
    user: AuthenticatedUser,
    resolution: ResolutionAction,
  ) {
    // §7.1: owners and admins only. A member gets 403 before the row is read.
    await this.access.requireManager(user.id, workspaceId);

    let result: ResolveResult;
    try {
      result = await this.ledger.resolve({
        publicationId: scheduleId,
        workspaceId,
        actor: actorFromUser(user),
        resolution,
      });
    } catch (error) {
      if (
        resolution.action === 'confirm_absent' &&
        isUniqueViolation(error, ACTIVE_IDENTITY_INDEX)
      ) {
        throw await this.identityConflict(
          workspaceId,
          scheduleId,
          resolution.scheduledAt,
          error,
        );
      }
      throw error;
    }

    switch (result.kind) {
      case 'not_found':
        throw new NotFoundException('Scheduled publication not found');
      case 'status_conflict':
        this.logEvent('publication.reconciliation_lost', {
          workspace_id: workspaceId,
          publication_id: scheduleId,
          source: 'operator',
        });
        throw new ConflictException({
          message:
            result.status === 'unknown'
              ? 'SoStats is still checking this publication'
              : `Only publications that need review can be resolved (status: ${result.status})`,
          status: result.status,
        });
      case 'channel_unusable':
        throw new ConflictException('Reconnect the channel before retrying');
      case 'resolved':
        this.logEvent('publication.reconciliation', {
          workspace_id: workspaceId,
          publication_id: scheduleId,
          reconciliation_id: result.reconciliationId,
          attempt_id: result.attemptId,
          source: 'operator',
          previous_status: 'needs_review',
          outcome: OPERATOR_OUTCOME[resolution.action],
          evidence_type: 'operator_attested',
          lookup_reason: null,
          platform_post_id:
            resolution.action === 'mark_published'
              ? (resolution.platformPostId ?? null)
              : null,
        });
        return this.scheduling.getSchedule(workspaceId, scheduleId);
    }
  }

  private async identityConflict(
    workspaceId: number,
    scheduleId: number,
    scheduledAt: Date,
    cause: unknown,
  ) {
    const row = await this.db.query.scheduledPublications.findFirst({
      where: and(eq(sp.id, scheduleId), eq(sp.workspaceId, workspaceId)),
      columns: { contentItemId: true, socialAccountId: true },
    });
    return row
      ? this.scheduling.identityConflict(
          workspaceId,
          row.contentItemId,
          row.socialAccountId,
          scheduledAt,
        )
      : cause;
  }

  private logEvent(event: string, fields: Record<string, unknown>) {
    this.logger.log(JSON.stringify({ event, ...fields }));
  }
}
```

- [ ] **Step 6: Wire the controller, module and service**

In `scheduling.service.ts`, change `private async identityConflict(` to:

```ts
  /** Also used by ScheduleResolutionService for `confirm_absent` (32B-1 §7.2). */
  async identityConflict(
```

In `scheduling.controller.ts`:
- extend the `@nestjs/common` import with `HttpCode` and `ParseIntPipe`;
- import `{ parseResolutionBody, ScheduleResolutionService } from './schedule-resolution.js'`;
- add the constructor parameter and the route.

```ts
  constructor(
    private readonly schedulingService: SchedulingService,
    private readonly resolution: ScheduleResolutionService,
    private readonly audit: AuditLogService,
  ) {}
```

```ts
  /** 32B-1 §7: owner/admin resolution of a `needs_review` publication. */
  @Post('schedules/:id/resolution')
  @HttpCode(200)
  resolveSchedule(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: unknown,
    @CurrentWorkspaceId() workspaceId: number,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.resolution.resolve(
      workspaceId,
      id,
      user,
      parseResolutionBody(body),
    );
  }
```

In `scheduling.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { ChannelsModule } from '../channels/channels.module.js';
import { MediaModule } from '../media/media.module.js';
import { PublishingModule } from '../publishing/publishing.module.js';
import { ScheduleResolutionService } from './schedule-resolution.js';
import { SchedulingController } from './scheduling.controller.js';
import { SchedulingService } from './scheduling.service.js';

@Module({
  imports: [ChannelsModule, MediaModule, PublishingModule],
  controllers: [SchedulingController],
  providers: [SchedulingService, ScheduleResolutionService],
  exports: [SchedulingService],
})
export class SchedulingModule {}
```

API keys: the existing `WorkspaceGuard` already requires `workspace:write` for POST. No change.

- [ ] **Step 7: Run the tests, then the whole API suite**

Run: `pnpm --filter api exec vitest run src/modules/scheduling/schedule-resolution.spec.ts`
Expected: PASS.

Run: `pnpm --filter api exec vitest run --config ./vitest.config.int.ts test/integration/schedule-resolution.int-spec.ts`
Expected: PASS (13 tests).

Run: `pnpm --filter api exec tsc --noEmit && pnpm --filter api lint && pnpm --filter api test && pnpm --filter api test:int`
Expected: all green.

- [ ] **Step 8: Commit**

```bash
git add apps/api/src/modules/publishing/publication-ledger.ts apps/api/src/modules/scheduling apps/api/test/integration/seed.ts apps/api/test/integration/schedule-resolution.int-spec.ts
git commit -m "feat(scheduling): owner/admin resolution of needs_review publications (32B-1 §7)"
```

---

### Task 7: Worker reconciliation dispatcher

**Files:**
- Modify: `apps/worker/src/publishing/publishing.api.ts`
- Create: `apps/worker/src/publishing/reconciliation.dispatcher.ts`
- Modify: `apps/worker/src/index.ts`
- Test: `apps/worker/test/reconciliation.test.cjs` (new)

**Interfaces:**
- Consumes: the Task 4 route `POST /internal/publications/reconcile-due`, which returns `{ selected, results: [{ publicationId, outcome, evidenceType }] }`.
- Produces:
  - `reconcileDue(timeoutMs: number): Promise<ReconcileDueResponse>`
  - `reconciliationConfig(env?): { pollMs: number; requestTimeoutMs: number }`, which throws when `requestTimeoutMs < lookupBudgetMs + 30000`
  - `reconcileOnce(config): Promise<void>`
  - `startReconciliationDispatcher()` and `stopReconciliationDispatcher()`

- [ ] **Step 1: Write the failing worker tests**

Create `apps/worker/test/reconciliation.test.cjs`:

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { reconcileDue } = require('../dist/publishing/publishing.api.js');
const {
  reconciliationConfig,
  reconcileOnce,
} = require('../dist/publishing/reconciliation.dispatcher.js');

async function withApi(t, handler) {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({
      method: req.method,
      url: req.url,
      token: req.headers['x-worker-token'],
    });
    handler(req, res, requests.length);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const saved = {
    SOSTATS_API_URL: process.env.SOSTATS_API_URL,
    WORKER_API_TOKEN: process.env.WORKER_API_TOKEN,
  };
  process.env.SOSTATS_API_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.WORKER_API_TOKEN = 'test-token';
  t.after(async () => {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });
  return requests;
}

// 32B-1 §11: the request must outlive one lookup budget plus 30 s.
test('reconciliationConfig refuses a request timeout below the lookup budget plus 30 s', () => {
  assert.throws(
    () =>
      reconciliationConfig({
        RECONCILE_LOOKUP_BUDGET_MS: '45000',
        RECONCILE_REQUEST_TIMEOUT_MS: '74999',
      }),
    /RECONCILE_REQUEST_TIMEOUT_MS/,
  );
  assert.deepEqual(
    reconciliationConfig({
      RECONCILE_LOOKUP_BUDGET_MS: '45000',
      RECONCILE_REQUEST_TIMEOUT_MS: '75000',
    }),
    { pollMs: 30000, requestTimeoutMs: 75000 },
  );
  assert.deepEqual(reconciliationConfig({}), {
    pollMs: 30000,
    requestTimeoutMs: 120000,
  });
  assert.equal(reconciliationConfig({ RECONCILE_POLL_MS: '100' }).pollMs, 5000);
});

test('reconcileDue posts with the worker token and times out as a transport failure', async (t) => {
  const held = [];
  const requests = await withApi(t, (_req, res) => {
    held.push(res); // never answered
  });

  const outcome = await reconcileDue(100).then(
    () => ({ settled: 'resolved' }),
    (error) => ({ settled: 'rejected', error }),
  );

  assert.deepEqual(requests, [
    { method: 'POST', url: '/internal/publications/reconcile-due', token: 'test-token' },
  ]);
  assert.equal(outcome.settled, 'rejected');
  assert.equal(outcome.error.name, 'TimeoutError');
});

test('reconcileOnce logs a transport failure and the next poll tries again', async (t) => {
  const requests = await withApi(t, (_req, res, count) => {
    if (count === 1) {
      res.writeHead(503);
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        selected: 1,
        results: [{ publicationId: 7, outcome: 'published', evidenceType: 'confirmed_post_id' }],
      }),
    );
  });
  const errors = [];
  const logs = [];
  t.mock.method(console, 'error', (...args) => errors.push(args.join(' ')));
  t.mock.method(console, 'log', (line) => logs.push(line));
  const config = { pollMs: 5000, requestTimeoutMs: 1000 };

  await reconcileOnce(config);
  await reconcileOnce(config);

  assert.equal(requests.length, 2);
  assert.match(errors[0], /HTTP 503/);
  assert.deepEqual(JSON.parse(logs[0]), {
    event: 'publication.reconciliation_batch',
    selected: 1,
    published: 1,
    needs_review: 0,
    lost: 0,
    error: 0,
  });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `pnpm --filter worker test`
Expected: FAIL. `Cannot find module '../dist/publishing/reconciliation.dispatcher.js'`, and `reconcileDue` is not a function.

- [ ] **Step 3: Add `reconcileDue` to `publishing.api.ts`**

Append:

```ts
export type ReconcileDueResponse = {
  selected: number;
  results: Array<{
    publicationId: number;
    outcome: 'published' | 'needs_review' | 'lost' | 'error';
    evidenceType: string | null;
  }>;
};

/** 32B-1 §4.3: the API does the lookups and commits; the worker is only the clock. */
export function reconcileDue(timeoutMs: number) {
  return request<ReconcileDueResponse>(
    '/internal/publications/reconcile-due',
    { method: 'POST' },
    timeoutMs,
  );
}
```

- [ ] **Step 4: Create `reconciliation.dispatcher.ts`**

```ts
import { reconcileDue } from './publishing.api';

export type ReconciliationConfig = {
  pollMs: number;
  requestTimeoutMs: number;
};

function positiveInt(env: NodeJS.ProcessEnv, name: string, fallback: number) {
  const value = Number.parseInt(env[name] || '', 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

/** 32B-1 §11: the request must outlive one lookup budget plus 30 s of API overhead. */
export function reconciliationConfig(
  env: NodeJS.ProcessEnv = process.env,
): ReconciliationConfig {
  const lookupBudgetMs = positiveInt(env, 'RECONCILE_LOOKUP_BUDGET_MS', 45_000);
  const requestTimeoutMs = positiveInt(
    env,
    'RECONCILE_REQUEST_TIMEOUT_MS',
    120_000,
  );
  if (requestTimeoutMs < lookupBudgetMs + 30_000) {
    throw new Error(
      'RECONCILE_REQUEST_TIMEOUT_MS must be at least RECONCILE_LOOKUP_BUDGET_MS + 30000',
    );
  }
  return {
    pollMs: Math.max(5_000, positiveInt(env, 'RECONCILE_POLL_MS', 30_000)),
    requestTimeoutMs,
  };
}

let polling = false;
let timer: NodeJS.Timeout | undefined;

/** One poll. The worker holds no domain state: a failure is logged and the next poll retries. */
export async function reconcileOnce(config: ReconciliationConfig) {
  if (polling) return;
  polling = true;
  try {
    const summary = await reconcileDue(config.requestTimeoutMs);
    if (summary.selected) {
      const count = (outcome: string) =>
        summary.results.filter((result) => result.outcome === outcome).length;
      console.log(
        JSON.stringify({
          event: 'publication.reconciliation_batch',
          selected: summary.selected,
          published: count('published'),
          needs_review: count('needs_review'),
          lost: count('lost'),
          error: count('error'),
        }),
      );
    }
  } catch (error) {
    console.error(
      '[ReconciliationDispatcher] Poll failed:',
      error instanceof Error ? error.message : error,
    );
  } finally {
    polling = false;
  }
}

export function startReconciliationDispatcher() {
  let config: ReconciliationConfig;
  try {
    config = reconciliationConfig();
  } catch (error) {
    console.error(
      `[ReconciliationDispatcher] Not started: ${error instanceof Error ? error.message : String(error)}`,
    );
    return;
  }
  void reconcileOnce(config);
  timer = setInterval(() => {
    void reconcileOnce(config);
  }, config.pollMs);
  console.log(`[ReconciliationDispatcher] Polling every ${config.pollMs}ms`);
}

export async function stopReconciliationDispatcher() {
  if (timer) clearInterval(timer);
}
```

- [ ] **Step 5: Wire it into `index.ts`**

Add the import next to the publishing imports:

```ts
import {
  startReconciliationDispatcher,
  stopReconciliationDispatcher,
} from './publishing/reconciliation.dispatcher';
```

Add `startReconciliationDispatcher();` after `startPublishingDispatcher();`. Add `stopReconciliationDispatcher(),` to the `Promise.all` in `shutdown`, after `stopPublishingWorker(),`.

- [ ] **Step 6: Run the worker tests**

Run: `pnpm --filter worker test`
Expected: PASS, including every existing worker test.

Run: `pnpm --filter worker test:int` (Redis on DB 15, with `REDIS_HOST=localhost`)
Expected: PASS. This suite is unaffected, but it is a hard gate.

- [ ] **Step 7: Commit**

```bash
git add apps/worker/src/publishing/publishing.api.ts apps/worker/src/publishing/reconciliation.dispatcher.ts apps/worker/src/index.ts apps/worker/test/reconciliation.test.cjs
git commit -m "feat(worker): poll publication reconciliation (32B-1 §4.3, §11)"
```

---

### Task 8: Web — resolution panel and BFF route

**Files:**
- Modify: `apps/web/src/lib/sostats-api.server.ts` (types at lines 295–327)
- Create: `apps/web/src/app/api/workspaces/[workspaceSlug]/schedules/[scheduleId]/resolution/route.ts`
- Create: `apps/web/src/app/(workspace)/[workspaceSlug]/calendar/zoned-time.ts`
- Create: `apps/web/src/app/(workspace)/[workspaceSlug]/calendar/resolution-panel.tsx`
- Modify: `apps/web/src/app/(workspace)/[workspaceSlug]/calendar/calendar-view.tsx`
- Modify: `apps/web/src/app/(workspace)/[workspaceSlug]/calendar/page.tsx`

**Interfaces:**
- Consumes:
  - from Task 5, the projection fields `attemptEvidence`, `reconciliations`, `jobs[].results[]` and `socialAccount.status`;
  - from Task 6, `POST /v1/schedules/:id/resolution`. On errors its body is `{ message }` (409 may add `status`).
- Produces:
  - `export type CalendarSchedule` (from `calendar-view.tsx`);
  - `ResolutionPanel`;
  - the BFF `POST`, which answers `{ error }` on failure.

The web app has no unit-test framework. This task's gate is lint, typecheck and a production build, plus the manual check in Step 8.

- [ ] **Step 1: Extend the API record types**

In `sostats-api.server.ts`, replace `PublicationJobRecord` and `ScheduleRecord`, and add the two new types:

```ts
export type PublicationJobRecord = {
  id: number;
  status: string;
  attempts: number;
  attemptNumber?: number;
  lastAttemptAt?: string | null;
  nextAttemptAt?: string | null;
  completedAt?: string | null;
  errorClass?: string | null;
  results?: PublicationResultRecord[];
};

export type AttemptEvidenceRecord = {
  requestStartedAt: string | null;
  operationType: string | null;
  operationId: string | null;
  confirmedPlatformPostId: string | null;
  confirmedPlatformPostUrl: string | null;
};

export type ReconciliationRecord = {
  source: "automatic" | "operator";
  outcome: "confirmed_published" | "inconclusive" | "confirmed_absent" | "cancelled";
  evidenceType: string;
  platformPostId: string | null;
  platformPostUrl: string | null;
  duplicatePlatformPostIds: string[];
  actor: { id: number; name: string | null } | null;
  note: string | null;
  createdAt: string;
};

export type ScheduleRecord = {
  id: number;
  contentItemId: number;
  variantId?: number | null;
  workspaceId: number;
  socialAccountId: number;
  scheduledAt: string;
  status: string;
  createdAt?: string;
  updatedAt?: string;
  contentItem?: ContentRecord;
  variant?: ContentVariantRecord | null;
  socialAccount?: SocialAccountRecord;
  jobs?: PublicationJobRecord[];
  attemptEvidence?: AttemptEvidenceRecord | null;
  reconciliations?: ReconciliationRecord[];
};
```

- [ ] **Step 2: Create the BFF route**

`apps/web/src/app/api/workspaces/[workspaceSlug]/schedules/[scheduleId]/resolution/route.ts`:

```ts
import { NextResponse } from "next/server";
import {
  jsonBody,
  ScheduleRecord,
  SoStatsApiError,
  workspaceRequest,
} from "@/lib/sostats-api.server";

/** 32B-1 §9: forwards an owner/admin resolution. The API enforces the role. */
export async function POST(
  request: Request,
  context: {
    params: Promise<{ workspaceSlug: string; scheduleId: string }>;
  },
) {
  try {
    const { workspaceSlug, scheduleId } = await context.params;
    const input = (await request.json()) as {
      action?: string;
      platformPostId?: string;
      platformPostUrl?: string;
      scheduledAt?: string;
      note?: string;
    };

    const schedule = await workspaceRequest<ScheduleRecord>(
      workspaceSlug,
      `/v1/schedules/${encodeURIComponent(scheduleId)}/resolution`,
      { method: "POST", body: jsonBody(input) },
    );

    return NextResponse.json(schedule);
  } catch (error) {
    const status = error instanceof SoStatsApiError ? error.status : 500;
    const apiMessage =
      error instanceof SoStatsApiError
        ? (error.payload as { message?: unknown } | null)?.message
        : undefined;
    return NextResponse.json(
      {
        error:
          typeof apiMessage === "string" ? apiMessage : "Resolution failed",
      },
      { status },
    );
  }
}
```

- [ ] **Step 3: Move the time-zone helpers into `zoned-time.ts`**

Create `apps/web/src/app/(workspace)/[workspaceSlug]/calendar/zoned-time.ts`. It holds exactly the five helpers from `calendar-view.tsx` (lines 88–160), with the four public ones exported:

```ts
function formatter(
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
) {
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone, ...options });
  } catch {
    return new Intl.DateTimeFormat("en-US", options);
  }
}

export function dateKeyInZone(date: Date, timeZone: string) {
  const parts = formatter(timeZone, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

export function timeInZone(date: Date, timeZone: string) {
  return formatter(timeZone, {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(date);
}

export function fullDateTimeInZone(date: Date, timeZone: string) {
  return formatter(timeZone, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export function zonedWallTimeToUtc(
  dateValue: string,
  timeValue: string,
  timeZone: string,
) {
  const [year, month, day] = dateValue.split("-").map(Number);
  const [hour, minute] = timeValue.split(":").map(Number);
  let timestamp = Date.UTC(year, month - 1, day, hour, minute);

  for (let index = 0; index < 3; index += 1) {
    const parts = formatter(timeZone, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(new Date(timestamp));
    const value = Object.fromEntries(
      parts.map((part) => [part.type, part.value]),
    );
    const rendered = Date.UTC(
      Number(value.year),
      Number(value.month) - 1,
      Number(value.day),
      Number(value.hour),
      Number(value.minute),
    );
    timestamp -= rendered - Date.UTC(year, month - 1, day, hour, minute);
  }

  return new Date(timestamp);
}
```

In `calendar-view.tsx`, delete those five function definitions (`formatter` through `zonedWallTimeToUtc`) and import the helpers:

```ts
import {
  dateKeyInZone,
  fullDateTimeInZone,
  timeInZone,
  zonedWallTimeToUtc,
} from "./zoned-time";
```

- [ ] **Step 4: Create `resolution-panel.tsx`**

```tsx
"use client";

import { useState } from "react";
import { AlertCircle, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type {
  AttemptEvidenceRecord,
  ReconciliationRecord,
} from "@/lib/sostats-api.server";
import {
  dateKeyInZone,
  fullDateTimeInZone,
  timeInZone,
  zonedWallTimeToUtc,
} from "./zoned-time";

type Action = "mark_published" | "confirm_absent" | "cancel";

const ACTION_LABELS: Record<Action, string> = {
  mark_published: "Mark published",
  confirm_absent: "Confirm not posted & retry",
  cancel: "Cancel publication",
};

const CONFIRM_COPY: Record<Action, string> = {
  mark_published:
    "SoStats will record this publication as live. It will not post anything.",
  confirm_absent:
    "This will publish again at the chosen time. Only continue if you have checked the channel and the post is not there.",
  cancel: "SoStats will cancel this publication. It will not post anything.",
};

const OUTCOME_LABELS: Record<ReconciliationRecord["outcome"], string> = {
  confirmed_published: "Confirmed published",
  inconclusive: "Still unconfirmed",
  confirmed_absent: "Confirmed not posted",
  cancelled: "Cancelled",
};

/** 32B-1 §9: evidence and history for everyone; actions for owners and admins on needs_review. */
export function ResolutionPanel({
  workspaceSlug,
  timezone,
  canResolve,
  post,
  onResolved,
  onConflict,
}: {
  workspaceSlug: string;
  timezone: string;
  canResolve: boolean;
  post: {
    id: number;
    status: string;
    channelConnected: boolean;
    attemptEvidence: AttemptEvidenceRecord | null;
    reconciliations: ReconciliationRecord[];
  };
  onResolved: () => void;
  onConflict: () => void;
}) {
  const [action, setAction] = useState<Action | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [postId, setPostId] = useState("");
  const [postUrl, setPostUrl] = useState("");
  const [note, setNote] = useState("");
  const [retryDate, setRetryDate] = useState("");
  const [retryTime, setRetryTime] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const evidence = post.attemptEvidence;
  const duplicates = [
    ...new Set(post.reconciliations.flatMap((entry) => entry.duplicatePlatformPostIds)),
  ];

  const choose = (next: Action) => {
    setAction(next);
    setConfirming(false);
    setError(null);
    if (next === "confirm_absent") {
      const now = new Date();
      setRetryDate(dateKeyInZone(now, timezone));
      setRetryTime(timeInZone(now, timezone));
    }
  };

  const submit = async () => {
    if (!action) return;
    const body: Record<string, string> = { action };
    if (note.trim()) body.note = note.trim();
    if (action === "mark_published") {
      if (postId.trim()) body.platformPostId = postId.trim();
      if (postUrl.trim()) body.platformPostUrl = postUrl.trim();
    }
    if (action === "confirm_absent") {
      const scheduledAt = zonedWallTimeToUtc(retryDate, retryTime, timezone);
      if (Number.isNaN(scheduledAt.getTime())) {
        setError("Choose a valid date and time.");
        return;
      }
      body.scheduledAt = scheduledAt.toISOString();
    }

    setPending(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/workspaces/${encodeURIComponent(workspaceSlug)}/schedules/${post.id}/resolution`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const payload = (await response.json().catch(() => ({}))) as {
        error?: string;
      };
      if (!response.ok) {
        setError(payload.error || "Unable to resolve this publication");
        if (response.status === 403 || response.status === 409) onConflict();
        return;
      }
      onResolved();
    } catch {
      setError("Unable to resolve this publication");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-orange-100 bg-orange-50/60 p-3">
      <p className="text-[9px] font-semibold text-orange-800">
        {post.status === "unknown"
          ? "SoStats is checking whether this post went out."
          : "SoStats could not confirm whether this post went out. Check the channel, then resolve it."}
      </p>

      {evidence && (
        <dl className="grid grid-cols-2 gap-2 text-[8px] text-orange-900">
          <Fact
            label="Request started"
            value={
              evidence.requestStartedAt
                ? fullDateTimeInZone(new Date(evidence.requestStartedAt), timezone)
                : "Not recorded"
            }
          />
          <Fact label="Operation" value={evidence.operationType || "Not recorded"} />
          <Fact label="Operation id" value={evidence.operationId || "Not recorded"} />
          <Fact
            label="Confirmed post id"
            value={evidence.confirmedPlatformPostId || "None"}
          />
        </dl>
      )}

      {duplicates.length > 0 && (
        <p className="text-[8px] text-orange-900">
          Several post ids were recorded: {duplicates.join(", ")}
        </p>
      )}

      {post.reconciliations.length > 0 && (
        <ol className="space-y-1 text-[8px] text-orange-900">
          {post.reconciliations.map((entry, index) => (
            <li key={`${entry.createdAt}-${index}`}>
              {fullDateTimeInZone(new Date(entry.createdAt), timezone)} ·{" "}
              {OUTCOME_LABELS[entry.outcome] ?? entry.outcome} ·{" "}
              {entry.source === "operator" ? entry.actor?.name || "Operator" : "SoStats"}
              {entry.platformPostId ? ` · post ${entry.platformPostId}` : ""}
              {entry.note ? ` · "${entry.note}"` : ""}
            </li>
          ))}
        </ol>
      )}

      {post.status === "needs_review" && canResolve && (
        <div className="space-y-2 border-t border-orange-100 pt-3">
          <div className="flex flex-wrap gap-2">
            {(Object.keys(ACTION_LABELS) as Action[]).map((key) => (
              <Button
                key={key}
                type="button"
                size="sm"
                variant={action === key ? "default" : "outline"}
                className="rounded-xl text-[9px]"
                disabled={pending || (key === "confirm_absent" && !post.channelConnected)}
                onClick={() => choose(key)}
              >
                {ACTION_LABELS[key]}
              </Button>
            ))}
          </div>
          {!post.channelConnected && (
            <p className="text-[8px] text-orange-900">
              Reconnect the channel before confirming the post is missing and retrying.
            </p>
          )}

          {action === "mark_published" && (
            <div className="grid gap-2">
              <Input
                value={postId}
                onChange={(event) => setPostId(event.target.value)}
                placeholder="Post id (optional)"
                maxLength={255}
                className="rounded-xl text-[9px]"
              />
              <Input
                value={postUrl}
                onChange={(event) => setPostUrl(event.target.value)}
                placeholder="https:// post URL (optional)"
                maxLength={1024}
                className="rounded-xl text-[9px]"
              />
            </div>
          )}

          {action === "confirm_absent" && (
            <div className="grid grid-cols-2 gap-2">
              <label className="block text-[8px] font-semibold">
                Date · {timezone}
                <Input
                  type="date"
                  required
                  value={retryDate}
                  onChange={(event) => setRetryDate(event.target.value)}
                  className="mt-1 rounded-xl"
                />
              </label>
              <label className="block text-[8px] font-semibold">
                Time · {timezone}
                <Input
                  type="time"
                  required
                  value={retryTime}
                  onChange={(event) => setRetryTime(event.target.value)}
                  className="mt-1 rounded-xl"
                />
              </label>
            </div>
          )}

          {action && (
            <>
              <Textarea
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder="Note (optional)"
                maxLength={500}
                className="rounded-xl text-[9px]"
              />
              {confirming ? (
                <div className="space-y-2 rounded-xl bg-white p-2">
                  <p className="text-[8px] leading-4 text-orange-900">
                    {CONFIRM_COPY[action]}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      size="sm"
                      className="rounded-xl bg-[#ef2b2d] text-[9px] hover:bg-[#da2427]"
                      disabled={pending}
                      onClick={submit}
                    >
                      {pending && <LoaderCircle className="mr-1 h-3 w-3 animate-spin" />}
                      Confirm
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="rounded-xl text-[9px]"
                      disabled={pending}
                      onClick={() => setConfirming(false)}
                    >
                      Back
                    </Button>
                  </div>
                </div>
              ) : (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="rounded-xl text-[9px]"
                  disabled={action === "confirm_absent" && (!retryDate || !retryTime)}
                  onClick={() => setConfirming(true)}
                >
                  Continue
                </Button>
              )}
            </>
          )}
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 rounded-xl bg-red-50 p-2 text-[9px] text-red-700">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="uppercase tracking-[0.08em] opacity-70">{label}</dt>
      <dd className="mt-0.5 break-all font-semibold">{value}</dd>
    </div>
  );
}
```

- [ ] **Step 5: Wire the panel into `calendar-view.tsx`**

1. Imports: add `import { useRouter } from "next/navigation";` and `import { ResolutionPanel } from "./resolution-panel";`. Add `import type { AttemptEvidenceRecord, ReconciliationRecord } from "@/lib/sostats-api.server";`.

2. Replace the `type Post = { … }` block:

```ts
export type CalendarSchedule = {
  id: number;
  contentItemId: number;
  title: string;
  campaign: string;
  channel: string;
  accountName: string;
  channelConnected: boolean;
  variantLabel: string;
  variantCopy?: string;
  scheduledAt: string;
  status: string;
  attempts: number;
  failureType?: string;
  failureReason?: string;
  postUrl?: string;
  platformPostId?: string;
  resultAt?: string;
  analyticsUnavailable?: boolean;
  attemptEvidence: AttemptEvidenceRecord | null;
  reconciliations: ReconciliationRecord[];
};

type Post = CalendarSchedule & { date: Date };

function toPosts(schedules: CalendarSchedule[]): Post[] {
  return schedules.map((schedule) => ({
    ...schedule,
    date: new Date(schedule.scheduledAt),
  }));
}
```

3. Change the component signature and the posts state:

```tsx
export function CalendarView({
  workspaceSlug,
  timezone,
  initialSchedules,
  canResolve,
}: {
  workspaceSlug: string;
  timezone: string;
  initialSchedules: CalendarSchedule[];
  canResolve: boolean;
}) {
  const router = useRouter();
  const [currentDate, setCurrentDate] = useState(initialToday);
  const [viewMode, setViewMode] = useState<ViewMode>("month");
  const [posts, setPosts] = useState<Post[]>(() => toPosts(initialSchedules));
  const [syncedSchedules, setSyncedSchedules] = useState(initialSchedules);
  if (syncedSchedules !== initialSchedules) {
    // router.refresh() delivered fresh server data: adopt it (React's
    // "adjust state when a prop changes" pattern, no effect needed).
    setSyncedSchedules(initialSchedules);
    setPosts(toPosts(initialSchedules));
  }
```

   The remaining `useState` lines (`channelFilter` onward) stay as they are.

4. In the dialog, replace the published block's first `<p>` (`Provider confirmed publication`) with:

```tsx
                    <p className="text-[9px] font-semibold text-emerald-800">
                      {selectedPost.platformPostId
                        ? "Provider confirmed publication"
                        : "Published (post id unknown — analytics unavailable)"}
                    </p>
                    {selectedPost.platformPostId && selectedPost.analyticsUnavailable && (
                      <p className="mt-1 text-[8px] text-emerald-700">
                        Analytics unavailable for this publication
                      </p>
                    )}
```

5. Directly after the closing `)}` of the published block, add:

```tsx
                {(selectedPost.status === "unknown" ||
                  selectedPost.status === "needs_review") && (
                  <ResolutionPanel
                    workspaceSlug={workspaceSlug}
                    timezone={timezone}
                    canResolve={canResolve}
                    post={selectedPost}
                    onResolved={() => {
                      setSelectedPost(null);
                      router.refresh();
                    }}
                    onConflict={() => router.refresh()}
                  />
                )}
```

- [ ] **Step 6: Map the new fields in `page.tsx`**

Replace `page.tsx` with:

```tsx
import Link from "next/link";
import { ArrowRight, CalendarPlus } from "lucide-react";
import { PageHeading } from "@/components/sostats/page-heading";
import { loadWorkspaceSnapshot } from "@/lib/sostats-api.server";
import { CalendarView, type CalendarSchedule } from "./calendar-view";

export default async function CalendarPage({
  params,
}: {
  params: Promise<{ workspaceSlug: string }>;
}) {
  const { workspaceSlug } = await params;
  let schedules: CalendarSchedule[] = [];
  let timezone = "UTC";
  let canResolve = false;
  let connectionError = false;

  try {
    const snapshot = await loadWorkspaceSnapshot(workspaceSlug);
    timezone = snapshot.workspace.timezone || "UTC";
    // 32B-1 §9: only owners and admins see resolution actions; the API enforces it too.
    canResolve = ["owner", "admin"].includes(snapshot.workspace.role || "");

    schedules = snapshot.calendar.map((schedule) => {
      const jobs = [...(schedule.jobs || [])].sort(
        (a, b) =>
          new Date(b.lastAttemptAt || 0).getTime() -
          new Date(a.lastAttemptAt || 0).getTime(),
      );
      const results = jobs
        .flatMap((job) => job.results || [])
        .sort(
          (a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
        );
      const latest = results[0];
      const posted = results.find((result) => result.platformPostId);
      const reconciliations = schedule.reconciliations || [];
      const attested = reconciliations.find(
        (entry) => entry.outcome === "confirmed_published" && entry.platformPostId,
      );
      const published = schedule.status === "published";

      return {
        id: schedule.id,
        contentItemId: schedule.contentItemId,
        title:
          schedule.contentItem?.title ||
          schedule.variant?.content?.slice(0, 90) ||
          "Scheduled content",
        campaign: schedule.contentItem?.campaign?.name || "Unassigned",
        channel: schedule.socialAccount?.provider || "Channel",
        accountName:
          schedule.socialAccount?.accountName ||
          schedule.socialAccount?.provider ||
          "Channel",
        channelConnected: schedule.socialAccount?.status === "active",
        variantLabel: schedule.variant?.platform || "Canonical",
        variantCopy: schedule.variant?.content || undefined,
        scheduledAt: schedule.scheduledAt,
        status: schedule.status,
        attempts: jobs.reduce((total, job) => total + (job.attempts || 0), 0),
        failureType:
          schedule.status === "failed" ? latest?.errorType || undefined : undefined,
        failureReason:
          schedule.status === "failed"
            ? latest?.errorMessage || undefined
            : undefined,
        postUrl: published
          ? posted?.platformPostUrl || attested?.platformPostUrl || undefined
          : undefined,
        platformPostId: published
          ? posted?.platformPostId || attested?.platformPostId || undefined
          : undefined,
        resultAt: published
          ? posted?.createdAt || attested?.createdAt || undefined
          : undefined,
        analyticsUnavailable: published && !posted,
        attemptEvidence: schedule.attemptEvidence ?? null,
        reconciliations,
      };
    });
  } catch {
    connectionError = true;
  }

  return (
    <div className="mx-auto w-full max-w-[1500px] space-y-5 p-4 md:p-6 xl:p-8">
      <PageHeading
        eyebrow="Calendar"
        title="Control the publishing lifecycle"
        description="Plan by month, week or day, filter real provider schedules, reschedule safely and inspect provider outcomes without leaving the publishing command center."
        actions={
          <Link
            href={`/${workspaceSlug}/content`}
            className="inline-flex h-10 items-center gap-2 rounded-xl bg-[#ef2b2d] px-4 text-[10px] font-semibold text-white transition hover:bg-[#da2427]"
          >
            <CalendarPlus className="h-3.5 w-3.5" />
            Schedule from Content
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        }
      />

      {connectionError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[10px] text-amber-800">
          Calendar data is unavailable until the API/database stack is running.
        </div>
      )}

      <CalendarView
        workspaceSlug={workspaceSlug}
        timezone={timezone}
        initialSchedules={schedules}
        canResolve={canResolve}
      />
    </div>
  );
}
```

- [ ] **Step 7: Lint, typecheck and build the web app**

Run: `pnpm --filter web lint && pnpm --filter web exec tsc --noEmit && pnpm --filter web build`
Expected: all succeed with no new warnings.

- [ ] **Step 8: Manual check (if the local stack runs)**

Start the API and web app against the local database. Put one test publication into `needs_review` with SQL, then open the calendar dialog:
- as owner: all three actions appear; "Confirm not posted & retry" is disabled with its reason when the channel is disconnected; cancel works and the dialog closes and refreshes;
- as a member: evidence and history are visible, with no actions;
- an `unknown` row: the checking message appears, with no actions.

If the stack is not running, record "manual check skipped" in the task report. Do not claim it ran.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/lib/sostats-api.server.ts "apps/web/src/app/api/workspaces/[workspaceSlug]/schedules/[scheduleId]/resolution/route.ts" "apps/web/src/app/(workspace)/[workspaceSlug]/calendar"
git commit -m "feat(web): needs-review resolution panel in the calendar (32B-1 §9)"
```

---

### Task 9: Rollout docs, settings and the full gate

**Files:**
- Modify: `infra/postgres/migrations/README.md` (new "008 rollout" section after the 007 roll-forward section)
- Modify: `infra/.env.example` (after the 32A publication safety block)

**Interfaces:**
- Consumes: all previous tasks.
- Produces: the operator rollout checklist and the documented settings.

- [ ] **Step 1: Document the settings**

Append this after the `PUBLISH_TRANSPORT_BACKOFF_MS=30000` line in `infra/.env.example`:

```bash

# Stage 15 PR 32B-1 publication reconciliation (see docs/architecture/STAGE_15_32B1_RESOLUTION_CORE_SPEC.md §11)
# PROVIDER_HTTP_TIMEOUT_MS <= RECONCILE_LOOKUP_BUDGET_MS < RECONCILE_REQUEST_TIMEOUT_MS (>= 30 s margin)
RECONCILE_GRACE_SECONDS=600
RECONCILE_BATCH_LIMIT=5
RECONCILE_LOOKUP_BUDGET_MS=45000
RECONCILE_POLL_MS=30000
RECONCILE_REQUEST_TIMEOUT_MS=120000
```

- [ ] **Step 2: Write the 008 rollout checklist**

Append to `infra/postgres/migrations/README.md`:

````markdown
## 008 rollout (additive — no drain)

Spec: `docs/architecture/STAGE_15_32B1_RESOLUTION_CORE_SPEC.md` §13.

- [ ] Apply `008_stage15_publication_resolution.sql`. It adds
      `publication_reconciliations` and `scheduled_publications.reconcile_after`,
      and makes every `unknown` / `needs_review` row eligible for one pass. It
      changes no status and writes no history.
- [ ] Record the baseline before the worker starts reconciling:

      ```sql
      select status, count(*) from scheduled_publications
      where status in ('unknown', 'needs_review') group by status;
      ```

- [ ] Deploy the API promptly after 008. Rows that enter `unknown` through the
      old API in between have no `reconcile_after`; they become due once
      `updated_at` is older than `RECONCILE_GRACE_SECONDS`.
- [ ] Deploy the worker (it calls the new `reconcile-due` route), then the web app.
- [ ] Smoke test:
  - after the first polls, legacy rows that held a post id are `published`;
  - every other ambiguous row carries exactly one `inconclusive` history row;
  - a manager cancels one test `needs_review` row from the calendar.

**Rollback:** roll back the code and keep 008. The old API ignores the new
column and table. Rows that re-enter `unknown` meanwhile have no
`reconcile_after`; the grace fallback recovers them after roll-forward.
````

- [ ] **Step 3: Run the full gate**

From `repos/SoStats`, with the integration env exported:

```bash
pnpm migrations:check
pnpm typecheck
pnpm lint
pnpm test
pnpm build
pnpm --filter api test:int
pnpm --filter worker test:int
```

Expected:
- every command exits 0;
- `migrations:check` reports `8 file(s), 001–008`;
- both integration suites run against real Postgres/Redis, with no skipped suites.

- [ ] **Step 4: Check the acceptance gate (spec §14)**

Walk through §14, confirming each box against the tests that pin it:
- **R1:** Task 2 lookups; Task 4 escalation tests.
- **R2:** Task 4 concurrent test; Task 6 race.
- **R3:** attempt-status asserts in Tasks 4 and 6.
- **R4:** Task 6 `confirm_absent` tests.
- **R5:** Task 4 and Task 6 forced audit failure.
- **R6:** Task 5.
- **R7:** Task 4 R7 test.
- **R8:** Task 4 and Task 6 no-attempt tests.
- **Members get 403:** Task 6.
- **Legacy self-heal:** Task 4 legacy test.

Note any gap in the task report. Do not paper over it.

- [ ] **Step 5: Commit**

```bash
git add infra/postgres/migrations/README.md infra/.env.example
git commit -m "docs(stage-15): 32B-1 rollout checklist and reconciliation settings"
```
