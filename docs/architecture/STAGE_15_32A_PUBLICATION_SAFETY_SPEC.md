# Stage 15 · PR 32A — Publication Safety Core (spec)

Status: draft for review · Baseline: `main` @ `b5b9194` · Roadmap: Stage 15 PR #32, slice A of A/B/C

This spec is the implementation and review contract for 32A. 32B (reconciliation +
operator resolution) and 32C (automation runtime reliability) are out of scope
except where 32A must leave durable plumbing for them.

## 1. Problem

The ST15-32.1 audit found three paths by which one logical publication can
produce more than one external post, plus several paths that corrupt or strand
publication state:

| # | Duplicate path today | Root cause |
|---|---|---|
| D1 | Reschedule/cancel races the worker claim and flips `publishing` back to `scheduled` under a new version; the dispatcher enqueues a second execution while the first provider call is in flight. | `scheduling.service.ts` checks status outside the transaction and updates with `WHERE id` only. |
| D2 | An ambiguous provider outcome is stored as `failed`; `failed` can be rescheduled freely. | `unknown` is not a state; reschedule has no outcome guard. |
| D3 | Concurrent automation schedule-step executions both insert the same publication. | Check-then-act lookup with no unique constraint. |

| # | Corruption / stranding today | Root cause |
|---|---|---|
| C1 | Crash between claim and `beginAttempt` leaves a publication in `publishing` forever. | Claim and attempt creation are separate writes; the sweeper only scans attempt rows. |
| C2 | The stale sweeper can overwrite `published` with `failed`. | Sweeper writes from a stale snapshot with `WHERE id` only. |
| C3 | Crash during token refresh / media prep is classified `unknown_outcome`. | No durable marker for "the external request has started". |
| C4 | DB failure after a confirmed provider success becomes terminal `unexpected_error`. | Non-provider errors are always terminal. |
| C5 | Malformed 2xx bodies become `unexpected_error` (FB, X, IG); IG 200-without-id becomes `provider_rejected`. | JSON parsing outside the adapter try; IG misclassification. |
| C6 | No request deadlines on provider or worker→API calls. | No `AbortSignal` anywhere. |
| C7 | A retry re-enqueue can collide with a retained BullMQ job id and stall for up to 24 h. | Job id is `publication-{id}-{version}`; version does not change between attempts. |

## 2. Invariants

- **I1 — At most one publish per attempt, one owner per publication.** A publication has at most one active attempt. Only the owner of the active attempt may mutate the publication's execution state, and every such write is conditional on that ownership.
- **I2 — No automatic re-arm after an ambiguous outcome.** Once an external publish request may have been sent and its outcome is not confirmed, the publication enters `unknown`. No automatic path, and no normal user endpoint, can move it back to `scheduled`.
- **I3 — `failed` means known.** `failed` is written only when SoStats has enough information to conclude the attempt did not create an unconfirmed external publication.
- **I4 — Recovery writes are compare-and-set.** A sweeper, dead-letter, or late worker may mutate a publication only if it is still in the state and ownership its decision was based on. Zero affected rows means "state changed; do nothing".
- **I5 — One active logical schedule.** At most one publication in an active state exists per `(workspace_id, content_item_id, social_account_id, scheduled_at)`.
- **I6 — Append-only attempts.** Every claim creates a new attempt row. Attempt rows move from `processing` to exactly one terminal attempt status and are never reused or reset.
- **I7 — Bounded execution.** Every provider request and the worker→API execute call has a deadline, ordered so the worker never abandons an API execution that is still legitimately running.

## 3. State model

### 3.1 `scheduled_publications.status`

| Status | Meaning | Terminal |
|---|---|---|
| `scheduled` | Waiting for its due time or its next retry time. | no |
| `publishing` | Claimed by exactly one active attempt. | no |
| `published` | Provider confirmed; platform id recorded. | yes |
| `failed` | Known failure; no unconfirmed external post can exist. | yes (reschedulable) |
| `cancelled` | Cancelled before any unconfirmed external request. | yes |
| `unknown` | An external publish request may have been sent; outcome unconfirmed. Owned by the reconciler (32B). | no |
| `needs_review` | Reconciliation could not decide. Only operator resolution (32B) exits. | no |

Active set (used by I5, content/channel rollups): `scheduled`, `publishing`, `unknown`, `needs_review`.

Enforced by `CHECK (status in (...7 values...))`.

### 3.2 Transitions

```text
scheduled ──claim──▶ publishing
publishing ──confirmed success────────────────▶ published
publishing ──safe retry (see §5)──────────────▶ scheduled
publishing ──known terminal failure───────────▶ failed
publishing ──ambiguous outcome / lease expiry after request start──▶ unknown
publishing ──lease expiry before request start──▶ scheduled | failed (attempt cap)
unknown    ──late confirmed success of the same attempt──▶ published
unknown    ──(32B) positive reconciliation──▶ published
unknown    ──(32B) unresolved──▶ needs_review
needs_review ──(32B) operator actions──▶ published | scheduled (confirmed absent) | cancelled
scheduled, failed ──user reschedule──▶ scheduled (new version)
scheduled, failed ──user cancel──▶ cancelled
```

Rejected in 32A: reschedule or cancel from `publishing`, `unknown`, `needs_review`,
`published`, `cancelled` (409 Conflict).

### 3.3 `publication_jobs.status` (attempt)

`processing` → one of `completed` | `failed` | `unknown` | `abandoned`.
`abandoned` = lease expired before the external request started.
Enforced by `CHECK`.

## 4. Data model — migration `007_stage15_publication_safety.sql`

`scheduled_publications.id` is the logical publication operation id.
`publication_jobs.id` is the attempt id. No new attempt table.

### 4.1 `scheduled_publications` (additive)

| Column | Type | Purpose |
|---|---|---|
| `active_attempt_id` | `integer null references publication_jobs(id) on delete set null` | Ownership token for canonical writes (I1). A new attempt row per claim makes the id unique per ownership. |
| `lease_expires_at` | `timestamp null` | Lease for the active attempt. |
| `attempt_count` | `integer not null default 0` | Attempts in the current arming; reset on user reschedule. Part of the queue job id (C7) and the retry cap. |
| `next_attempt_at` | `timestamp null` | DB-owned retry time (replaces BullMQ-owned backoff for domain retries). |

Constraints / indexes:

- `scheduled_publications_status_check` — 7 values.
- `scheduled_pub_active_identity_idx` — `unique (workspace_id, content_item_id, social_account_id, scheduled_at) where status in ('scheduled','publishing','unknown','needs_review')` (I5).
- `scheduled_pub_dispatch_idx` — `(status, scheduled_at)` for the dispatch query.
- `scheduled_pub_lease_idx` — `(lease_expires_at) where status = 'publishing'` for the sweeper.

### 4.2 `publication_jobs` (additive, becomes the attempt record)

| Column | Type | Purpose |
|---|---|---|
| `attempt_number` | `integer not null default 1` | Monotonic per publication across all armings. Default keeps the pre-32A code's insert valid during rollback. |
| `provider_request_started_at` | `timestamp null` | Durable marker written immediately before the external side-effect request (I2, §5). |
| `completed_at` | `timestamp null` | When the attempt reached a terminal attempt status. |
| `error_class` | `varchar(40) null` | Taxonomy value (§6). |
| `provider_operation_type` | `varchar(80) null` | Checkpoint plumbing for 32B, e.g. `instagram_media_publish`. |
| `provider_operation_id` | `varchar(255) null` | e.g. Instagram container id. |
| `provider_checkpoint` | `jsonb null` | Provider-specific non-secret checkpoint data. |

Constraints / indexes: `publication_jobs_status_check` (`processing`, `completed`,
`failed`, `unknown`, `abandoned`); `unique (scheduled_publication_id, attempt_number)`;
index `(scheduled_publication_id)`. Column default `status` changes from `'pending'`
to `'processing'`.

`publication_results` is unchanged. New outcomes write `error_type = error_class`.
Analytics reads results with a `platform_post_id` through `job → scheduledPublication`,
which stays correct with multiple attempts per publication.

### 4.3 Migration rules

- Wrapped in `begin; … commit;` so a failure leaves no partial state (001–006 are not wrapped; 007 must be).
- **Fail loudly, never auto-dedupe.** A leading `do $$ … $$` block raises with counts if:
  - any `scheduled_publications.status` or `publication_jobs.status` is outside the new check sets (legacy job default `'pending'` included),
  - any active-identity duplicates exist among rows in `scheduled`/`publishing`.
- Backfills (non-destructive):
  - `publication_jobs.attempt_number` = `row_number() over (partition by scheduled_publication_id order by created_at, id)`.
  - `scheduled_publications.attempt_count` = latest job's legacy `attempts` for rows in `scheduled`, else 0.
  - Rows in `publishing` at migration time: `active_attempt_id` = latest job, `lease_expires_at = now()`, and that job's `provider_request_started_at = coalesce(last_attempt_at, now())`. Legacy attempts carry no marker, so the sweeper must treat them as possibly sent → `unknown`, never retried.
  - Rows in `failed` whose latest `publication_results.error_type = 'unknown_outcome'` → `needs_review`. This enforces I3 for historical data. Those rows cannot be rescheduled until 32B ships operator resolution; that is the intended safe side.
- `drizzle` schema in `apps/api/src/db/schema.ts` declares every column, check and index added by 007.
- `infra/postgres/migrations/README.md` chain list gains `007`.

## 5. Execution protocol (API `PublishingService.execute`)

Request: `POST internal/publications/:id/execute { expectedVersion, expectedAttemptCount?, queueJobId? }`.

1. **Load + gates.** Load publication. Return `stale` if `updatedAt` ≠ `expectedVersion`, or if `expectedAttemptCount` is present and ≠ `attempt_count`. Return `already_published` / `terminal` / `in_progress` / `outcome_unknown` by status. Reject with 409 if `scheduled_at` or `next_attempt_at` is more than 10 s in the future (existing behavior).
2. **Atomic claim** (one transaction):
   - `update scheduled_publications set status='publishing', attempt_count = attempt_count + 1, lease_expires_at = now() + lease, next_attempt_at = null where id = $id and status = 'scheduled' and updated_at = $version [and attempt_count = $expected] returning *`.
   - 0 rows → re-read and return `stale` / `in_progress` / `already_published`.
   - Insert attempt `(status='processing', attempt_number = max+1, last_attempt_at = now())`, then set `active_attempt_id`.
   - `updated_at` is **not** changed by claim or domain retry, so the user-visible version stays stable (existing semantics).
3. **Preflight** (no external side effect): resolve adapter, `getValidAccessToken`, `getProviderPublishMedia`. Any error here is pre-marker.
4. **Side-effect boundary.** The adapter calls `context.beforeSideEffect(checkpoint)` immediately before the one request that can create a public post. The service, in one transaction:
   - `update scheduled_publications set lease_expires_at = now() + lease where id = $id and status = 'publishing' and active_attempt_id = $attempt and lease_expires_at > now()` — 0 rows → throw `LeaseLostError`; the adapter must not send the request.
   - `update publication_jobs set provider_request_started_at = now(), provider_operation_type, provider_operation_id, provider_checkpoint where id = $attempt and status = 'processing'`.
   - Commit, then the adapter sends the request.
   - Because both this transaction and the sweeper lock the publication row, exactly one of "marker committed while leased" or "sweeper reclaimed first" wins (I4).
5. **Outcome** (§6 decides class → outcome). Every write is CAS on `active_attempt_id = $attempt`:
   - **success** → `published` (allowed from `publishing` or `unknown`), attempt `completed`, result row with platform id/url, variant + content-item rollups as today. 0 rows → still record the result on the attempt and log `ownership_lost_after_success`.
   - **safe retry** → attempt `failed`; if `attempt_count >= PUBLISH_MAX_ATTEMPTS` → publication `failed` (`retry_exhausted`); else publication `scheduled`, `active_attempt_id = null`, `lease_expires_at = null`, `next_attempt_at = now() + backoff(attempt_count)` (existing `min(15 min, 30 s · 2^(n-1))`; jitter is #34). Response `retry_scheduled` (HTTP 200).
   - **known terminal** → attempt `failed`, publication `failed`. Response `failed_terminal`.
   - **ambiguous** → attempt `unknown`, publication `unknown` (keeps `active_attempt_id`). Response `outcome_unknown`.
   - When the publication is already `unknown` (sweeper won), non-success late outcomes are recorded on the attempt only; the publication stays `unknown` for 32B.
6. **Audit** stays post-commit via `AuditLogService.record` (moving it into the outbox is #33). New action `publication.outcome_unknown`.

### 5.1 Sweeper (runs inside `listDispatchable`, as today)

For each `status='publishing' and lease_expires_at <= now()`: in one transaction,
`select … for update` the publication with `status='publishing' and active_attempt_id = $a and lease_expires_at <= now()`. Skip on 0 rows. Then:

- attempt `provider_request_started_at is null` → attempt `abandoned`; publication → `scheduled` with `next_attempt_at` backoff, or `failed` (`retry_exhausted`) at the cap.
- marker present → attempt `unknown`; publication `unknown`.
- `active_attempt_id is null` (only possible for a legacy row that crashed between the old claim and `beginAttempt`, i.e. before any provider call) → publication `scheduled` with backoff. Match with `active_attempt_id is null` rather than `= $a`.

### 5.2 User mutations (`SchedulingService`)

- `updateSchedule` (reschedule): `where id and workspace_id and status in ('scheduled','failed') and updated_at = $read`. It sets `updated_at = now()`, `attempt_count = 0`, `next_attempt_at = null`, `active_attempt_id = null`, `lease_expires_at = null`. 0 rows → 409. Re-arming a `failed` row can collide with another active row on `scheduled_pub_active_identity_idx` → 409.
- `cancelSchedule`: same CAS set of allowed statuses → `cancelled`. 0 rows → 409.
- `createSchedule`: a unique violation on `scheduled_pub_active_identity_idx` → 409 Conflict with the existing row id.
- Automation schedule step (`automation-runtime.service.ts`): on that 409, reuse the existing row id instead of failing. This closes D3; the rest of automation idempotency is 32C.
- Rollups (`cancelSchedule` content/variant status, `channels.service` active counts) use the active set. `ChannelsService.disconnect` blocks on `scheduled`, `publishing`, `unknown` — `unknown` still needs credentials for 32B, while `needs_review` does not.

### 5.3 Dead-letter (worker transport exhaustion)

`deadLetter(id, expectedVersion, expectedAttemptCount?)` is CAS: `status = 'scheduled' and updated_at = $version [and attempt_count = $expected]` → `failed` (`dispatch_exhausted`). The API never started a new attempt, so no unconfirmed external request exists (I3). Any other state → no-op.

## 6. Error taxonomy and outcome rule

`ProviderPublishError` becomes `{ errorClass: ProviderErrorClass; statusCode?: number }`.
The `retryable` / `outcomeUnknown` flags are removed and all throw sites migrated.

`ProviderErrorClass`: `authentication`, `authorization`, `rate_limit`,
`transient_provider`, `network_transient`, `invalid_request`, `content_rejected`,
`resource_not_found`, `unknown_outcome`, `permanent_provider`, `internal`.

**Adapters classify what happened. The service decides what it means, using the marker:**

| Adapter observation | errorClass |
|---|---|
| network error, abort, deadline | `network_transient` |
| HTTP 429, Meta codes 4/17/32/613 | `rate_limit` |
| HTTP 5xx, Meta `is_transient` | `transient_provider` |
| HTTP 401 | `authentication` |
| HTTP 403 | `authorization` |
| HTTP 404 | `resource_not_found` |
| HTTP 400/422, provider content policy | `invalid_request` / `content_rejected` |
| other 4xx | `permanent_provider` |
| 2xx with unparseable body or missing post id | `unknown_outcome` |
| non-`ProviderPublishError` Nest `HttpException` with 4xx (e.g. media not ready/invalid) | `invalid_request` (service-assigned) |
| any other non-`ProviderPublishError` | `internal` (service-assigned) |

| errorClass | Marker **not** set | Marker set |
|---|---|---|
| `rate_limit` | safe retry | safe retry (request rejected, not executed) |
| `network_transient`, `transient_provider`, `internal`, `unknown_outcome` | safe retry | **ambiguous → `unknown`** |
| `authentication`, `authorization`, `invalid_request`, `content_rejected`, `resource_not_found`, `permanent_provider` | known terminal | known terminal |
| `LeaseLostError` | write nothing; response `in_progress` (the sweeper owns the state) | n/a (thrown only before the marker) |

Token-refresh failures happen pre-marker and follow the same table.
`ChannelCredentialService` throw sites are migrated. The refresh race itself is #35.

## 7. Port and adapter changes

```ts
export type ProviderCheckpoint = {
  operationType: string;          // e.g. 'x_create_post', 'instagram_media_publish'
  operationId?: string;           // e.g. Instagram container id
  data?: Record<string, unknown>; // non-secret only
};

export type PublishContext = {
  providerAccountId?: string;
  media?: PublishMedia[];
  signal: AbortSignal;            // overall publish budget
  beforeSideEffect(checkpoint: ProviderCheckpoint): Promise<void>;
};
```

- Every adapter calls `beforeSideEffect` exactly once, immediately before its post-creating request: FB `/photos` or `/feed`, LinkedIn `/rest/posts`, X `/2/tweets`, Instagram `/media_publish` with `operationId = containerId`.
- Every provider `fetch` uses `AbortSignal.any([context.signal, AbortSignal.timeout(PROVIDER_HTTP_TIMEOUT_MS)])`. The token-refresh fetches use the per-request timeout.
- Response bodies are parsed inside the adapter's try. A 2xx that cannot be parsed, or that lacks the post id, → `unknown_outcome`.
- Instagram: a 200 from `media_publish` without an id → `unknown_outcome` (was `provider_rejected`). Container-phase failures are pre-marker, so a retry creates a new container (unchanged). The container polling loop honours `context.signal`.
- Adapters never put tokens or signed URLs in checkpoints.

## 8. Deadlines

| Setting | Default | Where |
|---|---|---|
| `PROVIDER_HTTP_TIMEOUT_MS` | 30 000 | API, per provider request |
| `PUBLISH_PROVIDER_BUDGET_MS` | 120 000 | API, whole `publishPost` call (`context.signal`) |
| `PUBLISH_EXECUTE_TIMEOUT_MS` | 180 000 | Worker, `fetch` to `execute` |
| `PUBLISH_LEASE_SECONDS` | 300 | API, attempt lease |
| `PUBLISH_MAX_ATTEMPTS` | 5 | API (domain retry cap) and worker (BullMQ transport attempts), as today |

Required ordering: per-request ≤ budget < worker execute timeout < lease. The API
refuses to boot if `PUBLISH_LEASE_SECONDS·1000 <= PUBLISH_PROVIDER_BUDGET_MS + 60 000`.
BullMQ auto-renews its job lock while the worker process is alive, so it adds no
further constraint.

## 9. Worker changes

- `dispatchable` returns `attemptCount`; it filters `status='scheduled' and scheduled_at <= horizon and (next_attempt_at is null or next_attempt_at <= horizon)`.
- Job id `publication-{id}-{versionMs}-{attemptCount}`; delay = `max(scheduledAt, nextAttemptAt) − now`; job data carries `expectedAttemptCount` (fixes C7).
- API domain outcomes (`retry_scheduled`, `failed_terminal`, `outcome_unknown`, …) return HTTP 200, so the job completes. BullMQ `attempts` now covers transport failures only. On exhaustion the worker calls CAS dead-letter (§5.3).
- `execute` fetch uses `AbortSignal.timeout(PUBLISH_EXECUTE_TIMEOUT_MS)`; the job id is sent as `queueJobId` for log correlation.

## 10. Web (production-safety UI only)

`calendar-view.tsx`: tones and icons for `unknown` ("Unconfirmed") and `needs_review`
("Needs review"). `canReschedule` / `canCancel` exclude both. A 409 from
reschedule/cancel surfaces as a refresh-and-retry message. No resolution actions (32B).

## 11. Observability (§17 minimum)

One structured log line per attempt outcome and per sweeper decision (Nest `Logger`,
JSON payload):
`workspace_id, publication_id, attempt_id, attempt_number, attempt_count, provider,
social_account_id, queue_job_id, outcome, error_class, status_code, marker_set`.

Provider error messages and response bodies are **not** logged; they stay in
`publication_results.error_message` as today (scrubbing is #35).

## 12. Tests

### 12.1 PostgreSQL integration harness (new)

- `apps/api/vitest.config.int.ts` runs `**/*.int-spec.ts`; script `pnpm --filter api test:int`. It is not part of `pnpm test` (the `*.spec.ts` glob does not match `*.int-spec.ts`).
- Requires `TEST_DATABASE_URL` and fails loudly if it is unset; it never silently skips.
- Global setup creates a throwaway database, then applies `infra/postgres/init/001-pgvector.sql`, then `apps/api/test/integration/pre-007-schema.sql`, then `infra/postgres/migrations/007_*.sql`. Teardown drops the database.
- `pre-007-schema.sql` is generated from `apps/api/src/db/schema.ts` at `b5b9194` (`drizzle-kit export`; the exact command is recorded in the file header). It is a **test fixture**, not a production baseline — canonical from-zero bootstrap stays ST15-36.1.
- Tests use real Drizzle over postgres-js with a pool size > 1, real `PublishingService` / `SchedulingService`, and fake adapters driven by controllable promises.
- CI: the `node` job gains a `pgvector/pgvector:pg16` service and a `pnpm --filter api test:int` step.

### 12.2 Required integration cases

| Case | Expectation |
|---|---|
| Two concurrent `execute` for the same publication/version | Exactly one claims; the other returns `in_progress` or `stale`; the adapter is called once. |
| Reschedule racing a claim | Never produces `publishing → scheduled`; the loser gets 409 or `stale`. |
| Cancel racing a claim | One deterministic winner; never `cancelled` with an in-flight attempt. |
| Two identical schedule creations (concurrent) | One row; the second gets 409 carrying the existing id. |
| Automation schedule step replayed concurrently | One publication row; both executions reference it. |
| Stale owner writes after the sweeper reclaimed and a new attempt claimed | 0 rows; the new owner's state is untouched. |
| Old sweeper decision after publication became `published` | No-op. |
| Lease expiry before marker | Attempt `abandoned`; publication `scheduled` with `next_attempt_at`; the cap produces `failed`. |
| Lease expiry after marker | Publication `unknown`; never re-dispatched. |
| Marker vs sweeper race | Exactly one wins; if the sweeper wins, the adapter receives `LeaseLostError` and sends nothing. |
| Late success on `unknown` from the same attempt | → `published`. From a different attempt → no-op. |
| `unknown` / `needs_review` reschedule or cancel | 409; state unchanged. |
| Repeated attempts | New attempt rows with increasing `attempt_number`; earlier rows unchanged. |
| Retry cap | Attempt `PUBLISH_MAX_ATTEMPTS` with a safe-retry class → `failed` / `retry_exhausted`. |
| Dead-letter CAS | No-op unless `scheduled` at the same version/attempt count. |
| Migration 007 on conflicting legacy data | Raises; the pre-007 rows are intact (transaction rolled back). |
| Migration 007 backfills | Legacy `publishing` → leased with marker; legacy `failed` + `unknown_outcome` → `needs_review`; `attempt_number` populated. |
| CHECK constraints | Invalid status insert rejected. |

### 12.3 Unit tests (mocked, fast)

- Outcome table (§6) exhaustively: class × marker → outcome.
- Adapter specs (FB, IG, X, new LinkedIn spec): network error, abort/timeout, 429, 5xx, 401/403/404/400, malformed 2xx, missing id → expected `errorClass`. Also: `beforeSideEffect` is called exactly once before the post-creating request and never before a container-phase request; a `beforeSideEffect` rejection means no side-effect request is sent.
- Worker dispatcher: job id includes the attempt count; the delay respects `next_attempt_at`.

## 13. Rollout and rollback

Order: apply 007 → deploy worker → deploy API.

- The new worker is compatible with the old API. The old API ignores `expectedAttemptCount` and returns 503 for retryable failures, which BullMQ transport retries still cover. `attemptCount` defaults to 0 when absent.
- The old API is compatible with the 007 schema. New columns are nullable/defaulted, and `attempt_number` defaults to 1, which matches the old one-row-per-publication pattern. The old code writes only statuses inside the new CHECK set.
- API rollback keeps 007 in place (no schema rollback). The cost: old `updateSchedule` would again allow rescheduling `unknown` / `needs_review` rows (D2 reopens for manual actions only). The old dispatcher never picks those statuses, so no automatic duplicate is reintroduced.
- 007 has no destructive statements; there is no down-migration. Forward-fix only.

## 14. Acceptance gate (32A)

- [ ] D1, D2, D3 each have a failing-before / passing-after integration test.
- [ ] C1–C7 are each covered by a test from §12.
- [ ] Every write to `scheduled_publications` execution state checks ownership or status (review checklist: no `where id = ?`-only update remains in `publishing.service.ts` / `scheduling.service.ts`).
- [ ] 2xx malformed / missing id → `unknown` for all four providers.
- [ ] Instagram container id is persisted before `media_publish`.
- [ ] Deadlines are enforced; the boot check rejects an invalid lease/budget ordering.
- [ ] Migration 007 applies to the pre-007 fixture, fails loudly on conflicts, and `pnpm migrations:check` passes.
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build` and `pnpm --filter api test:int` pass locally and in CI.
- [ ] No secrets in new log lines or checkpoints.

## 15. Non-goals (owned elsewhere)

- Reconciliation algorithms, the `needs_review` operator actions and UI — 32B.
- Automation run lease, step side-effect registry `(run_id, step_id, effect_key)`, approval resume, automation dead-letter/retry fixes — 32C.
- OAuth refresh race, secret scrubbing of provider messages — #35.
- Moving publication audit into the outbox — #33.
- Jitter, Retry-After, circuit breakers — #34.
- From-zero migration bootstrap — #36 (ST15-36.1).

## 16. Known ceilings

- The active-identity index (I5) infers identity from domain values. An explicit `creation_key` is cleaner and may replace it later without changing I5.
- A crash between committing the marker and the request leaving the host is classified `unknown`. This is deliberate: a false-positive ambiguity is preferred over a duplicate.
- `pre-007-schema.sql` reflects `schema.ts` at the baseline, not a dump of production. If production drifted, #36's baseline verification is where that surfaces.
