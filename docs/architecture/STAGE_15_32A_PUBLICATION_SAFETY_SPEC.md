# Stage 15 · PR 32A — Publication Safety Core (spec)

Status: implemented on feat/stage-15-32a-publication-safety, rev 2 · Baseline: `main` @ `b5b9194` · Roadmap: Stage 15 PR #32, slice A of A/B/C

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
| C7 | A re-enqueue can collide with a retained BullMQ job id and stall for up to 24 h (7 days after a failure). Transport exhaustion marks the publication `failed`. | Job id is `publication-{id}-{version}`, and the version does not change between attempts; the dead-letter call mutates domain state. |

## 2. Invariants

- **I1 — One owner per publication.** A publication has at most one active attempt. Only the owner of the active attempt may mutate the publication's execution state, and every such write is conditional on that ownership.
- **I2 — No automatic re-arm after the request marker.** Once `provider_request_started_at` exists for an attempt, no automatic path can start another provider attempt for that publication. An unconfirmed outcome or lease expiry after the marker always leads to `unknown`. Neither `unknown` nor `needs_review` can be left through the normal reschedule or cancel endpoints.
- **I3 — `failed` means known.** `failed` is written only when SoStats has enough information to conclude the attempt did not create an unconfirmed external publication.
- **I4 — Recovery writes are compare-and-set.** A sweeper, a late worker, or a user mutation may change a publication only if it is still in the state and ownership that its decision was based on. Zero affected rows means "state changed; do nothing".
- **I5 — One active logical schedule.** At most one publication in an active state exists per `(workspace_id, content_item_id, social_account_id, scheduled_at)`.
- **I6 — Append-only attempts.** Every claim creates a new attempt row. Attempt rows move from `processing` to exactly one terminal attempt status and are never reused or reset.
- **I7 — Bounded execution.** Every provider request and the worker→API execute call has a deadline, ordered so the worker never abandons an API execution that is still legitimately running.
- **I8 — Transport is not domain.** Queue delivery failures (API unreachable, transport retries exhausted) never change publication state. The database owns domain retries; BullMQ only delivers.

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

Active set (used by I5 and the content/channel rollups): `scheduled`, `publishing`, `unknown`, `needs_review`.

Enforced by `CHECK (status in ('scheduled','publishing','published','failed','cancelled','unknown','needs_review'))`.

### 3.2 Transitions

```text
scheduled ──claim──▶ publishing
publishing ──confirmed success─────────────────────────▶ published
publishing ──adapter-declared safe retry (§6)──────────▶ scheduled   (re-armed)
publishing ──known terminal failure────────────────────▶ failed
publishing ──unconfirmed outcome───────────────────────▶ unknown
publishing ──lease expiry, marker set──────────────────▶ unknown
publishing ──lease expiry, no marker───────────────────▶ scheduled (re-armed) | failed (retry cap)
unknown    ──late confirmed success of the same attempt─▶ published
unknown    ──(32B) positive reconciliation──────────────▶ published
unknown    ──(32B) unresolved───────────────────────────▶ needs_review
needs_review ──(32B) operator──▶ published | scheduled (confirmed absent, re-armed) | cancelled
scheduled, failed ──user reschedule──▶ scheduled (re-armed)
scheduled, failed ──user cancel──────▶ cancelled
```

**Re-armed** means one atomic write that sets `status='scheduled'` and increments `dispatch_generation`, bumps `updated_at`, and clears `active_attempt_id` and `lease_expires_at`.

Rejected in 32A with 409 Conflict: reschedule or cancel from `publishing`, `unknown`, `needs_review`, `published`, `cancelled`.

### 3.3 `publication_jobs.status` (attempt)

`processing` → one of `completed` | `failed` | `unknown` | `abandoned`.
`abandoned` = lease expired before the request marker. Enforced by `CHECK`.
One narrow, intentional exception exists: an `unknown` attempt becomes `completed`
only when **that same owning attempt** receives a confirmed provider success late,
because its external call was already in flight. No other terminal attempt status
is ever reopened.

## 4. Data model — migration `007_stage15_publication_safety.sql`

`scheduled_publications.id` is the logical publication operation id.
`publication_jobs.id` is the attempt id. No new attempt table.

### 4.1 `scheduled_publications` (additive)

| Column | Type | Purpose |
|---|---|---|
| `active_attempt_id` | `integer null references publication_jobs(id) on delete set null` | Ownership token for canonical writes (I1). A new attempt row per claim makes the id unique per ownership. |
| `lease_expires_at` | `timestamp null` | Lease for the active attempt. |
| `dispatch_generation` | `integer not null default 1` | Persisted, monotonic queue-delivery generation. It is incremented on every re-arm and never reset or inferred from other rows. The queue job id is derived from it (I8, C7). |
| `attempt_count` | `integer not null default 0` | Provider attempts in the current arming. It is reset by user reschedule and drives the retry cap. It is not a queue identity. |
| `next_attempt_at` | `timestamp null` | DB-owned retry time. |

Constraints / indexes:

- `scheduled_publications_status_check` — the 7 values.
- `scheduled_pub_active_identity_idx` — `unique (workspace_id, content_item_id, social_account_id, scheduled_at) where status in ('scheduled','publishing','unknown','needs_review')` (I5).
- `scheduled_pub_dispatch_idx` — `(status, scheduled_at)` for the dispatch query.
- `scheduled_pub_lease_idx` — `(lease_expires_at) where status = 'publishing'` for the sweeper.

### 4.2 `publication_jobs` (additive, becomes the attempt record)

| Column | Type | Purpose |
|---|---|---|
| `attempt_number` | `integer not null default 1` | Monotonic per publication across all armings. The default keeps the pre-32A code's insert valid during rollback. |
| `provider_request_started_at` | `timestamp null` | Durable request marker written immediately before the external side-effect request (I2, §5). |
| `completed_at` | `timestamp null` | When the attempt reached a terminal attempt status. |
| `error_class` | `varchar(40) null` | Taxonomy value (§6). |
| `provider_operation_type` | `varchar(80) null` | Checkpoint plumbing for 32B, e.g. `instagram_media_publish`. |
| `provider_operation_id` | `varchar(255) null` | e.g. the Instagram container id. |
| `provider_checkpoint` | `jsonb null` | Provider-specific non-secret checkpoint data. |

Constraints / indexes:

- `publication_jobs_status_check` — `processing`, `completed`, `failed`, `unknown`, `abandoned`.
- `unique (scheduled_publication_id, attempt_number)`.
- index `(scheduled_publication_id)`.
- The `status` column default changes from `'pending'` to `'processing'`.

`publication_results` is unchanged. New outcomes write `error_type = error_class`.
Analytics reads results that have a `platform_post_id` through `job → scheduledPublication`,
which stays correct with multiple attempts per publication.

### 4.3 Migration rules

- Wrapped in `begin; … commit;` so a failure leaves no partial state (001–006 are not wrapped; 007 must be).
- **Drained precondition (hard).** A leading `do $$ … $$` block raises unless both are zero:
  - `scheduled_publications` with `status = 'publishing'`;
  - `publication_jobs` with `status = 'processing'` (or legacy `'pending'`).

  Legacy in-flight executions carry no request marker, so SoStats cannot tell whether they sent the request. See §13 for the drain procedure.
- **Deliberate fallback, never automatic.** If a drain cannot finish, the operator must opt in explicitly:

  ```sql
  set sostats.inflight_publications = 'mark_unknown';
  ```

  in the same session before running 007. The migration then sets those publications to `unknown` and those attempts to `unknown` (with `provider_request_started_at = coalesce(last_attempt_at, now())`). It never converts them to anything retryable.
- **Fail loudly, never auto-dedupe.** The same leading block raises if:
  - any existing status value is outside the new check sets;
  - any active-identity duplicates exist among `scheduled` rows.

  The exception's `DETAIL` lists up to 20 conflicting identity tuples with their row ids, and its `HINT` gives the diagnostic query. No row is deleted, merged, or chosen as a winner.
- **Backfills (non-destructive):**
  - `publication_jobs.attempt_number` = `row_number() over (partition by scheduled_publication_id order by created_at, id)`.
  - `scheduled_publications.attempt_count` = the latest job's legacy `attempts` for `scheduled` rows, else 0.
  - **Latest-outcome reclassification.** A publication with `status = 'failed'` whose **latest** `publication_results` row is `unknown_outcome` becomes `needs_review`. "Latest" is ordered by `created_at desc, id desc` across all of the publication's jobs. An older `unknown_outcome` followed by a definitive result does not qualify. This enforces I3 for historical data. Those rows cannot be rescheduled until 32B ships operator resolution; that is the intended safe side.
- `apps/api/src/db/schema.ts` declares every column, check and index added by 007.
- The chain list in `infra/postgres/migrations/README.md` gains `007`.

## 5. Execution protocol (API `PublishingService.execute`)

Request: `POST internal/publications/:id/execute { expectedVersion, expectedDispatchGeneration?, queueJobId? }`.
New workers always send `expectedDispatchGeneration`. Legacy workers send only `expectedVersion`.

1. **Load + gates.**
   - Return `stale` if `expectedDispatchGeneration` is present and ≠ `dispatch_generation`, or, when it is absent, if `updatedAt` ≠ `expectedVersion`.
   - Otherwise return `already_published` / `terminal` / `in_progress` / `outcome_unknown` according to status.
   - Reject with 409 if `scheduled_at` or `next_attempt_at` is more than 10 s in the future (existing behavior).
2. **Atomic claim** (one transaction):
   - `update scheduled_publications set status='publishing', attempt_count = attempt_count + 1, lease_expires_at = now() + lease, next_attempt_at = null where id = $id and status = 'scheduled' and active_attempt_id is null and dispatch_generation = $g returning *`. When there is no generation (legacy), use `updated_at = $version` instead.
   - 0 rows → re-read and return `stale` / `in_progress` / `already_published`.
   - Insert the attempt `(status='processing', attempt_number = max+1, last_attempt_at = now())`, then set `active_attempt_id`. The first update holds the row lock, so `max+1` cannot race.
3. **Preflight** (no external side effect): resolve the adapter, `getValidAccessToken`, `getProviderPublishMedia`. Nothing here sets the marker.
4. **Side-effect boundary.** The adapter calls `context.beforeSideEffect(checkpoint)` immediately before the one request that can create a public post. The service, in one transaction:
   - `update scheduled_publications set lease_expires_at = now() + lease where id = $id and status = 'publishing' and active_attempt_id = $attempt and lease_expires_at > now()`. 0 rows → throw `LeaseLostError`; the adapter must not send the request.
   - `update publication_jobs set provider_request_started_at = now(), provider_operation_type, provider_operation_id, provider_checkpoint where id = $attempt and status = 'processing'`.
   - Commit, then the adapter sends the request.
   - The lease renewed here must outlast the rest of the provider call (§8). Both this transaction and the sweeper lock the publication row, so exactly one of "marker committed while leased" or "sweeper reclaimed first" wins (I4).
5. **Outcome** (§6 maps the error to an outcome). Every write is compare-and-set on `active_attempt_id = $attempt`:
   - **success** → `published`. Allowed from `publishing`, or from `unknown` for the same attempt (a late success after lease expiry). Also: attempt `completed`, a result row with the platform id/url, and the variant and content-item rollups as today. If 0 rows are affected (only possible if 32B re-armed the publication meanwhile), still record the result on the attempt and log `ownership_lost_after_success` for operator attention.
   - **safe retry** → attempt `failed`. If `attempt_count >= PUBLISH_MAX_ATTEMPTS`, the publication becomes `failed` (`retry_exhausted`). Otherwise the publication is re-armed with `next_attempt_at = now() + backoff(attempt_count)`, using the existing `min(15 min, 30 s · 2^(n-1))` (jitter is #34). Response `retry_scheduled` (HTTP 200).
   - **known terminal** → attempt `failed`, publication `failed`. Response `failed_terminal`.
   - **unconfirmed** → attempt `unknown`, publication `unknown` (keeps `active_attempt_id`). Response `outcome_unknown`.
   - When the publication is already `unknown` (the sweeper won), non-success late outcomes are recorded on the attempt only; the publication stays `unknown` for 32B.
6. **Audit** stays post-commit via `AuditLogService.record` (moving it into the outbox is #33). New action: `publication.outcome_unknown`.

All domain outcomes return HTTP 200. Non-200 responses mean the protocol itself did not complete (e.g. the database is unavailable during the claim) and are treated as transport failures by the worker (I8).

### 5.1 Sweeper (runs inside `listDispatchable`, as today)

For each row with `status='publishing' and lease_expires_at <= now()`, in one transaction:
`select … for update` the publication `where status='publishing' and active_attempt_id = $a and lease_expires_at <= now()`. Skip it on 0 rows. Then:

- the attempt has `provider_request_started_at is null` → attempt `abandoned`. The publication is re-armed with `next_attempt_at` backoff, or becomes `failed` (`retry_exhausted`) at the cap.
- the request marker is present → attempt `unknown`, publication `unknown`. **Never re-armed** (I2).

### 5.2 User mutations (`SchedulingService`)

- `updateSchedule` (reschedule): re-arm `where id and workspace_id and status in ('scheduled','failed') and updated_at = $read`, which also sets `attempt_count = 0` and `next_attempt_at = null`. 0 rows → 409. Re-arming a `failed` row can collide with another active row on `scheduled_pub_active_identity_idx` → 409.
- `cancelSchedule`: the same compare-and-set status set → `cancelled`. 0 rows → 409.
- `createSchedule`: a unique violation on `scheduled_pub_active_identity_idx` → 409 Conflict carrying the existing row id.
- Automation schedule step (`automation-runtime.service.ts`): on that 409, reuse the existing row id instead of failing.
  - When `startAt` is not configured, the step's `startAt` checkpoint write becomes first-writer-wins (compare-and-set on the step's prior `logs` value). The loser re-reads the step and uses the winner's `startAt`, so concurrent executions compute identical `scheduled_at` values.
  - This closes D3; the rest of automation idempotency is 32C.
- Rollups (`cancelSchedule` content/variant status, `channels.service` active counts) use the active set.
- `ChannelsService.disconnect` blocks on `scheduled`, `publishing` and `unknown`. `unknown` may still need credentials for 32B reconciliation; `needs_review` does not.

### 5.3 Dead-letter endpoint

`POST internal/publications/:id/dead-letter` becomes a **no-op** that returns the current status and logs `transport_exhausted`, per I8. It is kept only because legacy workers call it. New workers never call it.

## 6. Error semantics — adapter-declared

Adapters own the knowledge of whether a failed request could have been applied by
the provider. The service reacts to the declared semantics, never to raw HTTP status.

`ProviderPublishError` keeps its existing semantic flags and gains a taxonomy field:

```ts
class ProviderPublishError extends Error {
  readonly errorClass: ProviderErrorClass; // new: taxonomy for attempts/logs
  readonly retryable: boolean;             // declared: safe to attempt again
  readonly outcomeUnknown: boolean;        // declared: the provider may have applied it
  readonly statusCode?: number;
}
```

`ProviderErrorClass`: `authentication`, `authorization`, `rate_limit`,
`transient_provider`, `network_transient`, `invalid_request`, `content_rejected`,
`resource_not_found`, `unknown_outcome`, `permanent_provider`, `internal`.

### 6.1 Service decision

| Error | Outcome |
|---|---|
| `ProviderPublishError` with `outcomeUnknown` | unconfirmed → `unknown` |
| `ProviderPublishError` with `retryable` (and not unknown) | safe retry |
| other `ProviderPublishError` | known terminal → `failed` |
| `LeaseLostError` | write nothing; respond `in_progress` (the sweeper owns the state) |
| non-provider error, marker **set** | unconfirmed → `unknown` (e.g. the DB fails after the provider returned success) |
| non-provider error, marker not set, Nest `HttpException` 4xx (e.g. invalid media) | known terminal (`invalid_request`) |
| non-provider error, marker not set, anything else | safe retry (`internal`) |

Contract check: `outcomeUnknown` declared while the marker is not set indicates an
adapter bug. The service still takes the conservative outcome (`unknown`) and logs
`side_effect_contract_violation`.

### 6.2 Declarations for the current adapters

| Observation | On the post-creating request (after marker) | On other requests (container, polling, refresh) |
|---|---|---|
| network error, abort, deadline | `outcomeUnknown` · `network_transient` | `retryable` · `network_transient` |
| HTTP 429, Meta codes 4/17/32/613 | `retryable` · `rate_limit` (the provider rejected it; not applied) | `retryable` · `rate_limit` |
| HTTP 5xx, Meta `is_transient` | `outcomeUnknown` · `transient_provider` | `retryable` · `transient_provider` |
| 2xx with an unparseable body or missing post id | `outcomeUnknown` · `unknown_outcome` | `retryable` · `transient_provider` |
| HTTP 401 / 403 / 404 | terminal · `authentication` / `authorization` / `resource_not_found` | same |
| HTTP 400 / 422, provider content policy | terminal · `invalid_request` / `content_rejected` | same |
| other 4xx | terminal · `permanent_provider` | same |

A future provider may declare differently. For example, it could declare a 5xx it
documents as not-applied as `retryable`. The state machine does not change.
Token-refresh errors follow the "other requests" column. `ChannelCredentialService`
throw sites gain `errorClass`. The refresh race itself is #35.

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

- Every adapter awaits `beforeSideEffect` exactly once, immediately before its post-creating request:
  - FB `/photos` or `/feed`;
  - LinkedIn `/rest/posts`;
  - X `/2/tweets`;
  - Instagram `/media_publish`, with `operationId = containerId`, after the container reports it is ready.
- If `beforeSideEffect` rejects, the adapter rethrows and sends nothing.
- Every provider `fetch` uses `AbortSignal.any([context.signal, AbortSignal.timeout(PROVIDER_HTTP_TIMEOUT_MS)])`. The token-refresh fetches use the per-request timeout.
- Response bodies are parsed inside the adapter's try, and classified per §6.2.
- Instagram: a 200 from `media_publish` without an id → `outcomeUnknown` (was `provider_rejected`). Container-phase failures are pre-marker, so a retry creates a new container (unchanged). The polling loop honours `context.signal`.
- For 32B: an Instagram container `PUBLISHED` status is strong evidence of publication. `FINISHED` only means ready to publish and is **not** evidence after an ambiguous `media_publish`.
- Adapters never put tokens or signed URLs in checkpoints.

## 8. Deadlines

| Setting | Default | Where |
|---|---|---|
| `PROVIDER_HTTP_TIMEOUT_MS` | 30 000 | API, per provider request |
| `PUBLISH_PROVIDER_BUDGET_MS` | 120 000 | API, whole `publishPost` call (`context.signal`) |
| `PUBLISH_EXECUTE_TIMEOUT_MS` | 180 000 | Worker, `fetch` to `execute` |
| `PUBLISH_LEASE_SECONDS` | 300 | API; set at claim and renewed at the marker |
| `PUBLISH_MAX_ATTEMPTS` | 5 | API: domain retry cap |
| `PUBLISH_TRANSPORT_ATTEMPTS` | 5 | Worker: BullMQ delivery attempts (was `PUBLISH_MAX_ATTEMPTS`, which is still read as a fallback) |
| `PUBLISH_TRANSPORT_BACKOFF_MS` | 30 000 | Worker: BullMQ exponential base delay (was hardcoded) |

Required ordering: per-request ≤ budget < worker execute timeout < lease. The lease
renewed at the marker must outlast the remaining provider call plus a margin. The
API refuses to boot if `PUBLISH_LEASE_SECONDS·1000 < PUBLISH_PROVIDER_BUDGET_MS + 60 000`
or `PROVIDER_HTTP_TIMEOUT_MS > PUBLISH_PROVIDER_BUDGET_MS`. BullMQ auto-renews its
job lock while the worker process is alive, so it adds no further constraint.

## 9. Worker changes

- `dispatchable` returns `dispatchGeneration` and `nextAttemptAt`. It filters `status='scheduled' and scheduled_at <= horizon and (next_attempt_at is null or next_attempt_at <= horizon)`.
- Job id `publication-{id}-dispatch-{dispatchGeneration}`; delay = `max(scheduledAt, nextAttemptAt) − now`. Job data carries `expectedDispatchGeneration` and `expectedVersion`.
- Every domain outcome returns HTTP 200 and completes the job. BullMQ `attempts` covers transport failures only.
- The queue uses `removeOnFail: true`, so a job whose transport attempts are exhausted is removed, and the next dispatch poll re-enqueues the same generation once the API is reachable. The worker no longer calls dead-letter (I8). A completed job cannot block re-dispatch, because every re-arm increments the generation.
- The `execute` fetch uses `AbortSignal.timeout(PUBLISH_EXECUTE_TIMEOUT_MS)`. The job id is sent as `queueJobId` for log correlation.

## 10. Web (production-safety UI only)

`calendar-view.tsx`: tones and icons for `unknown` ("Unconfirmed") and `needs_review`
("Needs review"). `canReschedule` / `canCancel` exclude both. A 409 from
reschedule/cancel surfaces as a refresh-and-retry message. No resolution actions (32B).

## 11. Observability (§17 minimum)

The API writes one structured log line per attempt outcome and per sweeper decision
(Nest `Logger`, JSON payload):
`workspace_id, publication_id, attempt_id, attempt_number, attempt_count,
dispatch_generation, provider, social_account_id, queue_job_id, outcome,
error_class, status_code, marker_set`.

The worker logs `transport_exhausted` with `publication_id, dispatch_generation, queue_job_id`.

Provider error messages and response bodies are **not** logged. They stay in
`publication_results.error_message` as today (scrubbing is #35).

## 12. Tests

### 12.1 Harnesses (new)

**API — PostgreSQL.**
- `apps/api/vitest.config.int.ts` runs `**/*.int-spec.ts`; script `pnpm --filter api test:int`. It is not part of `pnpm test` (the `*.spec.ts` glob does not match `*.int-spec.ts`).
- Requires `TEST_DATABASE_URL`; fails loudly if it is unset and never silently skips.
- Global setup creates a throwaway database and applies, in order:
  1. `infra/postgres/init/001-pgvector.sql`;
  2. `apps/api/test/integration/pre-007-schema.sql`;
  3. `infra/postgres/migrations/007_*.sql`.

  Teardown drops the database. The migration tests build their own databases stopping at step 2, so they can seed legacy data first.
- `pre-007-schema.sql` is generated with `drizzle-kit export` from `schema.ts` **at `b5b9194`**, from a detached worktree at that commit, before any 32A schema edit. The command and commit are recorded in the file header. It is a **test fixture**, not a production baseline; canonical from-zero bootstrap stays ST15-36.1.
- Tests use real Drizzle over postgres-js with a pool size > 1, the real `PublishingService` / `SchedulingService`, and fake adapters driven by controllable promises.

**Worker — Redis.**
- `apps/worker/test/*.int-test.cjs`, run by `pnpm --filter worker test:int`. The name keeps it out of the unit glob `test/*.test.cjs`. It requires `REDIS_HOST`, uses `REDIS_DB` (default 15) for isolation, and uses a local HTTP server as a scriptable fake API.

**CI.** The `node` job gains `pgvector/pgvector:pg16` and `redis:7-alpine` services, plus both `test:int` steps.

### 12.2 Required integration cases

| Case | Expectation |
|---|---|
| Two concurrent `execute` for the same generation | Exactly one claims; the other returns `in_progress` or `stale`; the adapter is called once. |
| Reschedule racing a claim | Never produces `publishing → scheduled`; the loser gets 409 or `stale`. |
| Cancel racing a claim | One deterministic winner; never `cancelled` with an in-flight attempt. |
| Two identical schedule creations (concurrent) | One row; the second gets 409 carrying the existing id. |
| Automation schedule step replayed concurrently | One publication row; both executions reference it. |
| Stale owner writes after the sweeper reclaimed and a new attempt claimed | 0 rows; the new owner's state is untouched. |
| Old sweeper decision after the publication became `published` | No-op. |
| Lease expiry before the marker | Attempt `abandoned`; publication re-armed (generation +1, `next_attempt_at` set); the cap produces `failed`. |
| Lease expiry after the marker | Publication `unknown`; never re-armed; the adapter is not called again. |
| Marker vs sweeper race | Exactly one wins. If the sweeper wins, `beforeSideEffect` throws `LeaseLostError` and the adapter sends nothing. |
| Late success on `unknown` from the same attempt | → `published`. |
| `unknown` / `needs_review` reschedule or cancel | 409; state unchanged. |
| Repeated attempts | New attempt rows with increasing `attempt_number`; earlier rows unchanged. |
| Retry cap | The `PUBLISH_MAX_ATTEMPTS`-th safe-retry outcome → `failed` / `retry_exhausted`. |
| Domain retry re-arm | `retry_scheduled` increments `dispatch_generation` and `updated_at`; a stale job for the old generation returns `stale`. |
| Dead-letter endpoint | No-op in every state. |
| Migration 007, not drained | Raises; all rows intact. |
| Migration 007, not drained + `mark_unknown` opt-in | Legacy `publishing` → `unknown`, legacy `processing` attempts → `unknown` with a marker; nothing retryable. |
| Migration 007 with duplicate active identities | Raises with the conflicting tuples in `DETAIL`; all rows intact. |
| Migration 007 latest-outcome backfill | `failed` + latest `unknown_outcome` → `needs_review`; `failed` with an older `unknown_outcome` but a later definitive result → stays `failed`. |
| CHECK constraints | An invalid status insert is rejected. |
| **Worker: transport exhaustion** (Redis + fake API) | Fake API unreachable → transport attempts exhausted → no domain call was made and no dead-letter call is sent → the job is removed → the fake API comes back → the next dispatch re-enqueues the same generation → execute is called and succeeds. |
| **Worker: generation identity** | Two dispatch polls for the same generation enqueue one job; a new generation enqueues a new job even while the previous generation's completed job is still retained. |

### 12.3 Unit tests (mocked, fast)

- The §6.1 decision table exhaustively, including the contract-violation case.
- Adapter specs (FB, IG, X, and a new LinkedIn spec) cover each §6.2 row, asserting `errorClass`, `retryable` and `outcomeUnknown`. They also check that:
  - `beforeSideEffect` is awaited exactly once before the post-creating request, and never before a container-phase request;
  - a `beforeSideEffect` rejection means no side-effect request is sent.

## 13. Rollout and rollback

### 13.1 Rollout (hard sequence)

1. **Pause publication dispatch.** Stop the worker processes. The old worker has no per-domain switch, so the other runtimes pause briefly too; the old code only invokes `execute` from the worker.
2. **Drain.** Wait for in-flight API executions to finish, then assert:

   ```sql
   select count(*) from scheduled_publications where status = 'publishing';          -- 0
   select count(*) from publication_jobs where status in ('processing', 'pending');  -- 0
   ```

   If a row cannot drain (for example a crashed legacy execution), resolve it by checking the provider account manually, or run 007 with the explicit `mark_unknown` opt-in (§4.3). Never convert it to retryable.
3. **Apply 007.** It enforces the drained precondition itself.
4. **Deploy the API.** The new API is compatible with the old worker:
   - domain outcomes are HTTP 200, so old jobs complete;
   - re-arms bump `updated_at`, so the old version-based job id changes;
   - dead-letter is a no-op.
5. **Deploy the worker. This resumes dispatch.** It uses the transport-only retry and the generation job ids. Resuming here is safe because both sides now speak the new protocol. The old API is **not** a supported peer for the new worker, which is why the API goes first.
6. **Deploy the web app** (status handling).
7. **Smoke gate.** CI (`test:int` included) was green for the release commit. Then schedule one post to a sandbox channel, observe `published`, and check the attempt row has a request marker and is `completed`. If the smoke test fails: stop the worker (pause again) and follow §13.2.

### 13.2 Rollback

- **Roll back the code, not the schema.** Stop the worker, roll back the worker, then the API. 007 has no destructive statements and no down-migration; fixes go forward.
- **The old API works against the 007 schema.** New columns are nullable or defaulted, `attempt_number` defaults to 1 (which matches the old one-row-per-publication pattern), and the old code writes only statuses inside the new CHECK set.
- **Cost of a rollback:** the old `updateSchedule` would again allow rescheduling `unknown` / `needs_review` rows (D2 reopens for manual actions only). The old dispatcher never picks those statuses, so no automatic duplicate is reintroduced.

## 14. Acceptance gate (32A)

- [ ] D1, D2, D3 each have a test that fails before and passes after.
- [ ] C1–C7 are each covered by a test from §12.
- [ ] Every write to `scheduled_publications` execution state checks ownership or status. Review checklist: no `where id = ?`-only update remains in `publishing.service.ts` / `scheduling.service.ts`.
- [ ] No automatic path re-arms a publication whose active attempt has a request marker (I2).
- [ ] The worker transport-exhaustion test passes; domain state is unchanged by transport failure (I8).
- [ ] 2xx malformed / missing id → `unknown` for all four providers.
- [ ] The Instagram container id is persisted before `media_publish`.
- [ ] Deadlines are enforced; the boot check rejects an invalid lease/budget ordering.
- [ ] Migration 007 applies to the pre-007 fixture, refuses when not drained, fails loudly on conflicts, and `pnpm migrations:check` passes.
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build` and both `test:int` suites pass locally and in CI.
- [ ] No secrets in new log lines or checkpoints.
- [ ] The rollout runbook in §13.1 is copied into the PR description.

## 15. Non-goals and handoff notes

Owned elsewhere:

- Reconciliation algorithms, the `needs_review` operator actions and UI — 32B.
- The automation run lease, the step side-effect registry `(run_id, step_id, effect_key)` with `unique (run_id, step_id, effect_key)`, approval resume, and the automation dead-letter/retry fixes — 32C.
- The OAuth refresh race and secret scrubbing of provider messages — #35.
- Moving publication audit into the outbox — #33.
- Jitter, Retry-After, circuit breakers — #34.
- From-zero migration bootstrap — #36 (ST15-36.1).

Handoff to 32B:

- **Reconciliation evidence.** Only positive, unique matches confirm publication. "Not found" never re-arms automatically.
  - Instagram `PUBLISHED` is strong evidence; `FINISHED` is not.
  - A Facebook recent-post match must be unique and bounded in time after `provider_request_started_at`.
  - X reconciles only when the app's API access provides the timeline capability.
  - LinkedIn goes to `needs_review` under the current scopes.
- **Disconnected channels.** For a `needs_review` publication on a disconnected channel, operators can mark it published or cancel it. "Confirm absent and retry" requires reconnecting first.
- **Late successes.** The `ownership_lost_after_success` log line and the success result stored on the attempt must be visible to operators.

## 16. Known ceilings

- The active-identity index (I5) infers identity from domain values. An explicit `creation_key` is cleaner and can replace it later without changing I5.
- A crash between committing the marker and the request leaving the host is classified `unknown`. This is deliberate: a false-positive ambiguity is preferred over a duplicate.
- `active_attempt_id` has a plain FK. A composite FK `(active_attempt_id, id) → publication_jobs(id, scheduled_publication_id)` would let PostgreSQL also prove the attempt belongs to the publication. It was deferred because 32A's ownership writes are atomic and covered by the real-Postgres tests.
- A publication whose `execute` persistently fails at the protocol level (non-200, e.g. a bug) is re-dispatched at the transport-backoff rate indefinitely. No domain harm results, and it shows in `transport_exhausted` logs; alerting is #37.
- `pre-007-schema.sql` reflects `schema.ts` at the baseline, not a dump of production. If production drifted, #36's baseline verification is where that surfaces.
