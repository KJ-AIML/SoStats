# Stage 15 · PR 32B-1 — Resolution Core (spec)

Status: draft for review · Baseline: `main` @ `72dfe38` (32A + credential-projection hotfix merged) ·
Roadmap: Stage 15 PR #32, slice B-1 (32B-2 = provider lookup enrichment, then 32C)

This spec is the implementation and review contract for 32B-1. It builds on
[32A — Publication Safety Core](STAGE_15_32A_PUBLICATION_SAFETY_SPEC.md). Every 32A
invariant (I1–I8) still holds. Nothing here reopens 32A's design.

## 1. Problem

32A made duplicate posts impossible, but left ambiguous publications without an
exit:

- Nothing moves `unknown` → `needs_review`. A publication that goes `unknown` stays
  there forever unless its own attempt's success arrives late.
- Nothing moves a publication out of `needs_review`. Migration 007 reclassified legacy rows into
  `needs_review`, and they are frozen. That includes rows that already hold a
  `publication_results.platform_post_id`, meaning SoStats already knows the post is live.
- Operators have no safe way to say "it is live", "it never posted, retry it" or
  "drop it". Normal reschedule and cancel correctly refuse both states.
- 32A persisted strong evidence for exactly this stage, and nothing consumes it yet:
  - the request marker;
  - the operation type and id, including the Instagram container id;
  - `confirmedPlatformPostId`.

## 2. Invariants (in addition to 32A I1–I8)

- **R1 — Positive evidence only.** A publication becomes `published` automatically only
  on strong positive evidence (§4.2). Lookup failure, unsupported capability,
  permission or credential failure, timeout, rate limit, "not found" and every
  provider status other than an exact documented success are **inconclusive**.
  Inconclusive never re-arms, retries or re-sends anything.
- **R2 — Exactly one accepted transition.** Provider lookups are at-least-once;
  concurrent reconcilers may read the provider more than once. The resulting state
  transition is exactly-one-winner.
  - The state compare-and-set, the reconciliation record, any result row, the
    content/variant rollup and the audit event commit together in one transaction.
  - An invocation whose compare-and-set loses writes nothing.
- **R3 — Attempts keep their historical truth.** Reconciliation never changes a
  `publication_jobs` status. The attempt records what was known when it ended;
  `publication_reconciliations` records what was learned later. The only attempt
  status change remains 32A's narrow exception: a late success of that same owning attempt
  (§6).
- **R4 — Human-certified re-arm only.** The only transition from an ambiguous state
  back to `scheduled` is an owner or admin explicitly certifying absence
  (`confirm_absent`), with an explicit time, on a usable channel.
- **R5 — Resolution is audited atomically.** Every accepted automatic reconciliation
  outcome and every operator resolution writes its audit event through
  `audit.enqueue(tx, …)` in the same transaction. If the audit write cannot commit,
  the state change does not either.
- **R6 — No raw internals leave the API.** The new evidence and history fields use
  explicit safe projections. Raw `provider_checkpoint`, `raw_response` and arbitrary
  evidence JSON are never serialized to clients.

## 3. State model

32A's seven publication statuses are unchanged. New and extended transitions:

```text
unknown
  ├─ strong evidence (§4.2) ───────────────→ published
  ├─ same-attempt late success (§6) ───────→ published
  └─ inconclusive after grace ─────────────→ needs_review

needs_review
  ├─ strong evidence (§4.2) ───────────────→ published
  ├─ same-attempt late success (§6) ───────→ published
  ├─ inconclusive ─────────────────────────→ needs_review  (reconcile_after cleared)
  ├─ owner/admin mark_published ───────────→ published
  ├─ owner/admin confirm_absent ───────────→ scheduled     (re-armed, R4)
  └─ owner/admin cancel ───────────────────→ cancelled
```

- `PATCH /v1/schedules/:id` (reschedule and cancel) still rejects `unknown` and
  `needs_review` with 409. Leaving those states happens only through §4–§6.
- Operators cannot act on `unknown`: the reconciler owns it until it resolves or
  escalates.
- Every transition in this table is a ledger method (32A ledger authority). Each is a
  compare-and-set on the status it was decided from, plus the conditions listed in
  §4–§6.

## 4. Automatic reconciliation

### 4.1 Eligibility (`reconcile_after`)

New column `scheduled_publications.reconcile_after timestamp null`.

- **Entering `unknown`.** Whenever the ledger moves a publication to `unknown`, it
  sets `reconcile_after`. This covers `recordFailure(kind='unknown')` and the
  sweeper's marker branch.
  - If strong local evidence already exists (§4.2 sources 1–2), use `now`: known
    proof waits for nothing.
  - Otherwise use `now + RECONCILE_GRACE_SECONDS` (default 600).
- **Leaving `unknown` / `needs_review`.** Every transition out of these states, and
  every inconclusive pass on `needs_review`, sets `reconcile_after = null`.
- **Legacy rows.** Migration 008 sets `reconcile_after = now` for every existing
  `unknown` and `needs_review` row. That gives all frozen 007 rows exactly one
  automatic strong-evidence pass right after deployment.
- **Safety net.** A row that is `unknown` with `reconcile_after is null` (for
  example, entered `unknown` through the pre-32B-1 API during rollout) is eligible
  once `updated_at <= now - grace`.
- **Due set:**
  - `status in ('unknown','needs_review') and reconcile_after <= now`, or
  - the safety-net rows, `status = 'unknown' and reconcile_after is null and updated_at <= now - grace`.

  It is ordered by `reconcile_after nulls first, id`.

### 4.2 Strong evidence (checked in this order; first match wins)

1. **Existing result.** A `publication_results` row for any job of this publication
   has a non-null `platform_post_id`.
   - Use the latest one (`created_at desc, id desc`).
   - **Reuse it; do not insert a duplicate.**
   - If more than one distinct platform post id exists (a historical duplicate
     post), still resolve `published` with the latest. Record every distinct id in
     the reconciliation evidence as `duplicatePlatformPostIds` for operators.
2. **Local confirmed id.** A job of this publication has
   `provider_checkpoint.confirmedPlatformPostId`, from 32A's post-success write
   failure. Use the latest such job.
   - Insert one `publication_results` row on that job with the id and url.
   - Before inserting, check whether a row with the same `platform_post_id` already
     exists; if so, reuse it.
3. **Provider exact confirmation.** In 32B-1 this is Instagram only:
   - The attempt referenced by `active_attempt_id` must have
     `provider_operation_type = 'instagram_media_publish'` and a non-empty
     `provider_operation_id` (the container id).
   - Call the adapter capability `lookupPublication` (§4.4).
   - `confirmed` only when the provider returns `status_code === 'PUBLISHED'`
     exactly. Resolve `published` with **no** platform post id: the container read
     does not return the media id, and SoStats never invents one. Analytics stays
     unavailable for that row until 32B-2 recovers the id.

Everything else is inconclusive (R1), including:

- Instagram `FINISHED`, `IN_PROGRESS`, `ERROR`, `EXPIRED` and any other value;
- the free-text `status` field, which is never interpreted;
- channel disconnected, or no usable token;
- a lookup that throws, times out or is rate limited;
- every Facebook, X and LinkedIn publication without local evidence.

### 4.3 Protocol

The worker is the clock: a new worker domain polls
`POST internal/publications/reconcile-due?limit=N` (worker-token guarded, like 32A's
internal routes). The API does the work, because credentials live in the API.

1. **Select.** Read up to `limit` due rows (default `RECONCILE_BATCH_LIMIT = 5`,
   hard maximum 20), plus the facts §4.2 needs. No lock is held at this point.
2. **Look up, outside any transaction, with bounded concurrency.**
   - Sources 1–2 are local reads.
   - Source 3 calls the provider through `providerSignal` (per-request timeout),
     combined with a per-row budget `RECONCILE_LOOKUP_BUDGET_MS` (default 45 000).
   - Rows are processed concurrently (`Promise.allSettled`), so one slow provider
     never serializes the batch.
   - A lookup error is converted to `inconclusive`, never thrown.
3. **Decide and commit, one transaction per row.**
   - Compare-and-set on the observed state: `status = <observed>`, and
     `reconcile_after` still equal to the observed value (or still null, for
     safety-net rows).
   - On `confirmed_published`, also require `active_attempt_id` to be unchanged.
   - If the compare-and-set loses, write nothing (R2).
   - If it wins, the same transaction:
     - applies the transition (§3);
     - inserts one `publication_reconciliations` row (§5), with
       `source = 'automatic'`;
     - inserts or reuses the result row (§4.2);
     - runs the content/variant rollup (lock order: content item, then variant, as in
       32A F5);
     - calls `audit.enqueue(tx, …)` with a system actor.
4. **Response.** Return a per-row summary to the worker. The summary carries ids,
   outcome and evidence type only — never provider text. Also write one structured
   log line per accepted decision (§10).

`unknown` + inconclusive → `needs_review`. `needs_review` + inconclusive → stays,
with `reconcile_after = null` (one pass only). An inconclusive pass on `needs_review`
still writes an `inconclusive` reconciliation row and audit event, so the history
shows the pass happened. That happens exactly once per pass, and only for the
compare-and-set winner.

### 4.4 Adapter capability

`SocialPublisherPort` gains an optional method:

```ts
lookupPublication?(
  attempt: { operationType: string; operationId: string | null },
  accessToken: string,
  signal: AbortSignal,
): Promise<
  | { kind: 'confirmed'; evidenceType: string; platformPostId?: string; platformPostUrl?: string }
  | { kind: 'inconclusive'; reason: string } // fixed code, never provider text
>;
```

- **Instagram (32B-1):**
  - `GET /{containerId}?fields=status_code` via `providerSignal(signal)`.
  - `status_code === 'PUBLISHED'` → `{ kind: 'confirmed', evidenceType: 'instagram_container_published' }`.
  - Everything else, and any error, → `inconclusive` with a fixed reason code (e.g.
    `container_not_published`, `lookup_failed`, `rate_limited`).
  - The existing private `waitForContainer` keeps its own behaviour; the two may
    share a small internal status reader.
- **Facebook, X, LinkedIn:** no `lookupPublication` in 32B-1. The absence is itself
  inconclusive.

## 5. Data model — migration `008_stage15_publication_resolution.sql`

### 5.1 `publication_reconciliations` (new, append-only)

| Column | Type | Notes |
|---|---|---|
| `id` | serial pk | |
| `scheduled_publication_id` | integer not null | FK → `scheduled_publications(id)` **on delete cascade** |
| `attempt_id` | integer null | FK → `publication_jobs(id)` **on delete set null** |
| `source` | varchar(20) not null | CHECK in (`automatic`, `operator`) |
| `outcome` | varchar(30) not null | CHECK in (`confirmed_published`, `inconclusive`, `confirmed_absent`, `cancelled`) |
| `evidence_type` | varchar(60) not null | e.g. `existing_result_post_id`, `confirmed_post_id`, `instagram_container_published`, `late_confirmed_post_id`, `lookup_unavailable`, `container_not_published`, `lookup_failed`, `operator_attested` |
| `platform_post_id` | varchar(255) null | |
| `platform_post_url` | varchar(1024) null | |
| `evidence` | jsonb not null default `'{}'` | normalized, non-secret keys only (§5.3) |
| `actor_user_id` | integer null | FK → `users(id)` on delete set null; null for automatic |
| `note` | varchar(500) null | operator note |
| `created_at` | timestamp not null default now | |

Indexes: `(scheduled_publication_id, created_at)` and `(attempt_id)`.

Each accepted automatic outcome or operator resolution adds exactly one row. Rows are
never updated or deleted by application code.

### 5.2 `scheduled_publications` (additive)

- `reconcile_after timestamp null`.
- Partial index `scheduled_pub_reconcile_idx on (reconcile_after) where status in ('unknown','needs_review')`.

### 5.3 Evidence JSON (normalized)

The only allowed keys:

- `duplicatePlatformPostIds: string[]`
- `lookupReason: string` (a fixed code)
- `containerStatus: string` (an exact provider enum value only)
- `previousStatus: string`
- `scheduledAt: string` (ISO, `confirm_absent` only)

It never holds tokens, URLs with query strings, provider messages or response bodies.

### 5.4 Migration rules

- Wrapped in `begin; … commit;`, forward-only, additive.
- **Backfill:** `reconcile_after = now() at time zone 'utc'` for every row in
  `unknown` or `needs_review`.
- There is no drain precondition. 008 does not change the claim or execution
  protocol, and in-flight rows are unaffected.
- `schema.ts` declares every table, column, check, FK and index. The migrations
  README chain gains `008`.

## 6. Late success of the same attempt

32A allowed a late confirmed success of the owning attempt to move `unknown →
published`. 32B-1 extends the accepted source states to `needs_review`:

- `recordSuccess` compare-and-set: `status in ('publishing','unknown','needs_review') and active_attempt_id = attempt`.
- **The attempt row** follows 32A §3.3 unchanged: that same owning attempt moves
  `unknown → completed`, because its own in-flight call genuinely returned success.
  This is the single existing exception, not a new one. Reconciliation (§4) never
  touches attempt status.
- **When the publication was `unknown` or `needs_review`,** the same transaction also:
  - inserts a reconciliation row: `source = 'automatic'`,
    `outcome = 'confirmed_published'`, `evidence_type = 'late_confirmed_post_id'`,
    with the post id and url;
  - enqueues `publication.reconciled_published`;
  - clears `reconcile_after`.
- **If the compare-and-set loses** (an operator already cancelled or re-armed the
  publication, or it's already published), the result row is still written as
  evidence, exactly as 32A does for non-owners. The newer decision is never
  overwritten.

## 7. Operator resolution

### 7.1 API

`POST /v1/schedules/:id/resolution` (`@WorkspaceScoped`, write scope for API keys).
The body is a discriminated union:

```ts
| { action: 'mark_published'; platformPostId?: string; platformPostUrl?: string; note?: string }
| { action: 'confirm_absent'; scheduledAt: string /* ISO, required */; note?: string }
| { action: 'cancel'; note?: string }
```

- **Authorization:** `WorkspaceAccessService.requireManager(user.id, workspaceId)`,
  so owners and admins pass and members get 403. It is called in the service before
  any read of the row. A publication from another workspace gets 404.
- **Precondition:** the row is `needs_review`. Any other status → 409 with the
  current status. An `unknown` row → 409 "SoStats is still checking this
  publication".
- **Validation:**
  - `platformPostId`: at most 255 characters, trimmed.
  - `platformPostUrl`: an `https:` URL of at most 1024 characters.
  - `note`: at most 500 characters.
  - `scheduledAt`: a valid ISO date, required for `confirm_absent`.
  - Invalid input → 400.
- **Response:** the updated schedule, using the same safe projection as the calendar
  (§8).

### 7.2 Actions (one transaction each: CAS + record + rollup + audit)

**`mark_published`** — `needs_review → published`.

- If `platformPostId` is given:
  - reuse a `publication_results` row with the same id if one exists;
  - otherwise insert one on the publication's `active_attempt_id` job, or its latest
    job if that is null.
  - Analytics then ingests it.
  - If the publication has no attempt rows at all, a result row cannot exist (it
    needs a job). The id is then kept only on the reconciliation row, and analytics
    stays unavailable.
- Without an id, the publication becomes `published` with no platform post id
  (nothing is fabricated), and analytics is unavailable for it.
- Record: `source = 'operator'`, `outcome = 'confirmed_published'`,
  `evidence_type = 'operator_attested'`, plus `actor_user_id` and `note`.
- Audit: `publication.resolution_marked_published`.

**`confirm_absent`** — `needs_review → scheduled`, re-armed (R4).

- **Required:** the social account is `active` with an access token. Otherwise →
  409 "Reconnect the channel before retrying".
- **Atomic update:**
  - `status = 'scheduled'`
  - `dispatch_generation += 1`
  - `active_attempt_id = null`
  - `lease_expires_at = null`
  - `attempt_count = 0`
  - `next_attempt_at = null`
  - `scheduled_at = <supplied>`
  - `reconcile_after = null`
  - `updated_at = now`

  This is 32A's `rearmSet` plus the extra fields.
- **Identity collision:** a clash on `scheduled_pub_active_identity_idx` →
  `ScheduleIdentityConflict` (409 with the existing id), and nothing commits.
- Record: `outcome = 'confirmed_absent'`, `evidence_type = 'operator_attested'`, with
  `evidence.scheduledAt`.
- Audit: `publication.resolution_confirmed_absent`.
- This is the only human path that can lead to another external post. The UI
  requires an explicit confirmation step (§9).

**`cancel`** — `needs_review → cancelled`.

- Allowed even when the channel is disconnected.
- Record: `outcome = 'cancelled'`, `evidence_type = 'operator_attested'`.
- Audit: `publication.resolution_cancelled`.

### 7.3 Concurrency

- Every action is a compare-and-set on `status = 'needs_review'` for the row's
  current `id`.
- An operator racing the reconciler, or another operator, produces exactly one winner.
- The loser gets 409 with the new status and writes nothing.

## 8. Calendar API projection (R6)

`GET /v1/schedules` stops returning raw job and result rows. Each schedule carries
only explicit fields:

- **Existing display fields, now projected explicitly:**
  - the schedule's own columns;
  - `contentItem` (with campaign);
  - `variant`;
  - `socialAccount` (the hotfix projection);
  - `jobs[]`: `id`, `status`, `attemptNumber`, `attempts`, `lastAttemptAt`,
    `nextAttemptAt`, `completedAt`, `errorClass`;
  - `jobs[].results[]`: `id`, `platformPostId`, `platformPostUrl`, `errorType`,
    `errorMessage`, `createdAt`.

  `errorMessage` stays only because the existing failed-publication UI already shows
  it; scrubbing provider text is #35. `provider_checkpoint` and `raw_response` are
  never serialized.
- **New:**
  - `attemptEvidence` (for the active attempt):
    - `requestStartedAt`
    - `operationType`
    - `operationId`
    - `confirmedPlatformPostId`
    - `confirmedPlatformPostUrl`

    These are extracted by name from the checkpoint, never the raw object.
  - `reconciliations[]`, the **latest 20**:
    - `source`
    - `outcome`
    - `evidenceType`
    - `platformPostId`
    - `platformPostUrl`
    - `duplicatePlatformPostIds`
    - `actor` (`{ id, name }` or null)
    - `note`
    - `createdAt`

The content endpoints keep their current shape. They show no evidence panel.

## 9. Web

Everything happens in the calendar detail dialog. The BFF adds the route
`POST /api/workspaces/[workspaceSlug]/schedules/[scheduleId]/resolution`, which
forwards to the API.

- **`unknown` ("Unconfirmed"):**
  - "SoStats is checking whether this post went out."
  - Attempt evidence and history, read-only.
  - No controls for anyone.
- **`needs_review` ("Needs review"):**
  - Panel content:
    - channel and account;
    - when the request started;
    - operation type and id;
    - any confirmed or duplicate post ids;
    - reconciliation history.
  - Three actions, visible **only** when the workspace role is owner or admin (the
    page already loads `workspace.role`):
    - **Mark published:** optional post id or URL, optional note, then a confirm step.
    - **Confirm not posted & retry:** a date-time field prefilled with now, which is
      required, plus an optional note. The confirm step says: "This will publish again
      at the chosen time. Only continue if you have checked the channel and the post
      is not there."
      - The action is disabled, with a reason, when the channel is disconnected.
    - **Cancel publication:** optional note, then a confirm step.
- **Members** see the same status, evidence and history, and no actions.
- **409 / 403 handling:** show the API message, then refresh.
- **Published rows** resolved without a post id show "Published (post id unknown —
  analytics unavailable)".

## 10. Observability and audit

**Audit events** (all via `audit.enqueue(tx, …)`, same transaction):

- `publication.reconciled_published` (system actor)
- `publication.reconciliation_escalated` (system; `unknown` → `needs_review`)
- `publication.reconciliation_inconclusive` (system; `needs_review` stays)
- `publication.resolution_marked_published` (operator)
- `publication.resolution_confirmed_absent` (operator)
- `publication.resolution_cancelled` (operator)

Dedupe key: `audit:<action>:<workspaceId>:<publicationId>:<reconciliationId>`.

Audit metadata:

- `reconciliationId`
- `attemptId`
- `outcome`
- `evidenceType`
- `platformPostId`
- `previousStatus`

It never holds provider text.

**Logs:**

- One JSON line per accepted decision, `publication.reconciliation`, with:
  - `workspace_id`
  - `publication_id`
  - `attempt_id`
  - `source`
  - `previous_status`
  - `outcome`
  - `evidence_type`
  - `lookup_reason`
  - `platform_post_id`
- One line per lost compare-and-set, `publication.reconciliation_lost` (ids only).
- The worker logs batch counts only.

## 11. Configuration

| Setting | Default | Where |
|---|---|---|
| `RECONCILE_GRACE_SECONDS` | 600 | API |
| `RECONCILE_BATCH_LIMIT` | 5 (max 20) | API default for `limit` |
| `RECONCILE_LOOKUP_BUDGET_MS` | 45 000 | API, per-row provider budget |
| `RECONCILE_POLL_MS` | 30 000 (min 5 000) | Worker |
| `RECONCILE_REQUEST_TIMEOUT_MS` | 120 000 | Worker, `fetch` to `reconcile-due` |

Boot checks:

- **API:** refuses to boot if the grace period is shorter than the execute lease
  (`RECONCILE_GRACE_SECONDS·1000 < PUBLISH_LEASE_SECONDS·1000`), or if
  `RECONCILE_LOOKUP_BUDGET_MS < PROVIDER_HTTP_TIMEOUT_MS`.
- **Worker:** clamps the request timeout to at least the lookup budget plus 30 s.

## 12. Tests

**PostgreSQL integration tests**, using real concurrent connections as in 32A:

| Case | Expectation |
|---|---|
| `unknown` + confirmed id in checkpoint | → `published` **immediately** (no grace); result row inserted on that job; attempt still `unknown`; 1 reconciliation row; audit enqueued. |
| `unknown` + existing result `platform_post_id` | → `published`; existing result reused (no duplicate). |
| `unknown` + two distinct post ids across jobs | → `published` with the latest; `duplicatePlatformPostIds` recorded. |
| `unknown` + Instagram `PUBLISHED` (fake adapter) | → `published`, no platform post id, no result row. |
| `unknown` + Instagram `FINISHED` / error / timeout | → `needs_review` after grace, never before; nothing re-armed. |
| `unknown` without local evidence, before grace | Not due; untouched. |
| Legacy `needs_review` + existing `platform_post_id` | → `published` on the first pass after 008. |
| `needs_review` + inconclusive | Stays; `reconcile_after` null; 1 `inconclusive` row; not selected again. |
| Two concurrent reconcilers, same row | Both may look up; exactly one transition, one reconciliation row, one audit event. |
| Reconciler racing an operator action | Exactly one winner; loser writes nothing. |
| Late success of the same attempt from `needs_review` | → `published`; attempt `completed`; `late_confirmed_post_id` row. |
| Late success after the operator re-armed or cancelled | No state change; result row kept as evidence. |
| `mark_published` with an id | → `published`; result row inserted or reused; analytics-visible. |
| `mark_published` without an id | → `published`; no result row with an id. |
| `confirm_absent` | → `scheduled`, generation +1, `attempt_count` 0, owner and lease cleared, `scheduled_at` = supplied, and claimable. |
| `confirm_absent` without `scheduledAt` | 400 |
| `confirm_absent` on a disconnected channel | 409; nothing changes. |
| `confirm_absent` into an occupied identity | `ScheduleIdentityConflict` with the existing id; nothing commits. |
| `cancel` on a disconnected channel | → `cancelled`. |
| Member calls resolution | 403 before any read or write. |
| Resolution on `unknown` / `scheduled` / `published` | 409 |
| Audit enqueue failure (forced) | Transaction rolls back: status and reconciliation row unchanged. |
| `PATCH /schedules` on `needs_review` | Still 409. |
| Migration 008 on the post-007 schema | Applies; backfills `reconcile_after` for `unknown` and `needs_review`; constraints and indexes exist. |
| Calendar projection | No `providerCheckpoint`, `rawResponse` or unknown evidence keys; `attemptEvidence` and `reconciliations` shaped as §8; at most 20 reconciliations. |
| Safety net | `unknown` with null `reconcile_after` becomes due once `updated_at <= now - grace`. |

**Unit tests:**

- Instagram `lookupPublication`: `PUBLISHED` → confirmed; `FINISHED`, `IN_PROGRESS`,
  `ERROR`, `EXPIRED`, unknown values, network error, abort, 429 and 5xx →
  inconclusive, each with a fixed reason code. It is bounded by the signal and never
  reads the free-text `status`.
- Resolution body validation; config boot checks.

**Worker:**

- The reconciliation dispatcher calls `reconcile-due` with its timeout.
- A transport failure is logged and retried on the next poll; the worker holds no
  domain state.

## 13. Rollout and rollback

Order: apply 008 → deploy the API → deploy the worker → deploy the web app.

- 008 is additive, so no drain is required.
- Deploy the API promptly after 008. Rows entering `unknown` through the old API in
  between get no `reconcile_after`; the safety net (§4.1) still picks them up.
- The worker is deployed after the API because it calls the new endpoint. An old
  worker simply never calls it.
- 32B-1 adds no new `execute` statuses, so 32A's worker-before-API rule for new
  execute statuses does not apply.

**Smoke test:**

1. Before the worker, run `select count(*) … where status in ('unknown','needs_review')`.
2. After the first reconciliation polls, legacy rows with post ids have become
   `published` and the rest carry `inconclusive` history.
3. A manager performs `cancel` on a test row.

**Rollback:** roll back the code and keep 008. The old API ignores the new column and
table. Rows re-enter `unknown` without `reconcile_after`, and the safety net recovers
them after roll-forward.

## 14. Acceptance gate (32B-1)

- [ ] R1–R6 each have tests from §12 that would fail if the rule broke.
- [ ] No automatic path turns inconclusive evidence into `published`, `scheduled` or a retry.
- [ ] Reconciliation never changes a `publication_jobs` status. The only attempt change is 32A's same-attempt late success.
- [ ] Every transition is a ledger compare-and-set. Reconciliation row, result, rollup and audit are in the same transaction, and losers write nothing.
- [ ] Only owners and admins can resolve; members get 403, verified by test.
- [ ] Calendar evidence uses explicit projections; there is no raw checkpoint or response.
- [ ] Legacy `needs_review` rows with known post ids self-heal on the first pass.
- [ ] `pnpm typecheck && pnpm lint && pnpm test && pnpm build` and both `test:int` suites pass locally and in CI.

## 15. Non-goals and handoff to 32B-2

Owned elsewhere:

- **32B-2:** Facebook recent-post matching; X timeline lookup where the API tier
  allows it; Instagram media-id recovery for rows published without an id. All of
  these plug into `lookupPublication` and follow R1 (positive and unique, or
  inconclusive).
- **32B-2 or later:** LinkedIn stays `needs_review` unless restricted
  `r_member_social` access is granted.
- **Out of scope for this PR:**
  - notification delivery;
  - retry and backoff of lookups (#34);
  - the OAuth refresh race (#35);
  - moving the existing publication audit to the outbox (#33);
  - operator actions on `unknown`;
  - attaching a post id to an already-published row;
  - automation run reliability (32C).

Handoff notes for 32B-2:

- **Due rows.** A 32B-2 lookup that becomes available for an existing
  `needs_review` row needs a way to make the row due again. 32B-1 clears
  `reconcile_after` after one pass; 32B-2 decides the re-check policy.
- **Evidence strength.** Heuristic matches must record their match criteria in
  normalized evidence keys (§5.3 is extended, never loosened), and must be unique
  before they can confirm.

## 16. Known ceilings

- One inconclusive pass per `needs_review` row. There is no periodic re-check in
  32B-1, by design.
- Instagram rows confirmed through the container have no post id, so no analytics,
  until 32B-2.
- Historical duplicate posts (several distinct post ids) resolve to the latest id.
  The others are shown to operators and are not deleted.
- The calendar history is capped at the latest 20 reconciliation rows per
  publication.
