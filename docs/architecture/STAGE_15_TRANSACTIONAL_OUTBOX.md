# Stage 15 — Production Hardening: Transactional Outbox Foundation

Stage 15 starts production hardening after the product, provider and
Identity/Admin completion passes.

This slice introduces a durable transactional outbox and begins migrating audit
delivery away from post-commit best-effort writes.

## Why this exists

Before this slice, an operation could succeed in the domain database and then
the process could fail before the corresponding audit event was appended.

That gap looked like:

```text
domain commit
  ↓
process / DB / network failure
  ↓
audit append never happens
```

The outbox changes the critical path to:

```text
domain transaction
  ├─ domain mutation
  └─ outbox event
        ↓ commit together
worker claim
        ↓
idempotent event materialization
        ↓
completed outbox row
```

A process crash after the domain transaction can delay delivery, but it cannot
silently remove the persisted delivery intent.

## Data model

`outbox_events` stores:

- optional workspace id snapshot
- topic
- unique dedupe key
- JSON payload
- status
- attempt count
- availability time
- lease token
- lease expiry
- processed timestamp
- bounded last error
- created / updated timestamps

Statuses:

```text
pending
processing
completed
dead
```

Current topic:

```text
audit.append
```

The topic contract is intentionally narrow in PR #31. Later hardening slices can
reuse the same delivery layer for additional internal side-effect intents rather
than introducing another reliability mechanism.

## Claim / lease model

The worker does not simply select pending rows.

The API claims rows in a PostgreSQL transaction using:

```sql
FOR UPDATE SKIP LOCKED
```

Claimed rows receive:

- `status = processing`
- a random lease token
- a bounded lease expiry

Expired processing leases are eligible for recovery.

This means:

- multiple dispatchers can run without claiming the same active row
- a dispatcher crash after claim does not permanently strand the row
- queue failure is recoverable after lease expiry

Default lease:

```text
OUTBOX_LEASE_SECONDS=120
```

Allowed runtime bound: 30–900 seconds.

## Worker runtime

The existing worker architecture remains authoritative.

New runtime:

```text
OutboxDispatcher
  ↓ worker-token authenticated claim API
BullMQ "outbox"
  ↓ deterministic job id
OutboxProcessor
  ↓ worker-token authenticated execute API
OutboxService
```

Queue job id:

```text
outbox-{eventId}-{leaseToken}
```

BullMQ retries transport/API failures.

Domain processing failures are persisted by the outbox service itself and
return the row to its retry schedule.

## Retry / dead-letter state

Defaults:

```text
OUTBOX_MAX_ATTEMPTS=8
OUTBOX_RETRY_BASE_MS=5000
```

Outbox processing uses bounded exponential retry delay capped at one hour.

After the configured attempt limit:

```text
status = dead
```

The row and last bounded error remain persisted for operations/debugging.

This is distinct from BullMQ transport retry.

## Lease safety

Execution requires the active lease token.

A stale worker cannot reset or overwrite a row that has already been reclaimed
under a newer lease.

Failure-state updates are conditional on:

- outbox id
- lease token
- `processing` status

## Response-loss idempotency

If processing commits successfully but the HTTP response is lost, a retry with
the old lease can still read:

```text
status = completed
```

and acknowledge success without re-running the side effect.

## Audit materialization idempotency

`workspace_audit_events` now has:

```text
source_outbox_event_id
```

with a unique partial index.

Audit materialization inserts with conflict-ignore on that correlation id.

Therefore:

```text
same outbox row executed N times
→ at most one audit event
```

The existing database trigger still prevents UPDATE or DELETE of persisted audit
rows.

## Transactional audit API

`AuditLogService` now supports:

```ts
audit.enqueue(transaction, event, dedupeKey)
```

It:

1. validates action / target identity
2. recursively sanitizes audit metadata
3. stores only safe actor/action/target data in the outbox payload
4. inserts the outbox row using the caller's active DB transaction

Raw credentials remain excluded.

## Migrated atomic paths in PR #31

The following now persist domain mutation + audit delivery intent in the same
database transaction.

### Workspace administration

- workspace creation + owner membership
- workspace settings update
- workspace name update
- workspace deletion
- member role update
- member removal
- ownership transfer

Workspace creation is additionally improved from two independent writes to one
transaction:

```text
workspace row
+ owner membership
+ audit outbox
= one commit
```

### Invitations

- create / renew
- regenerate
- revoke
- accept
- reject

Invitation token material is not copied into the outbox payload.

### Workspace API keys

- create
- rotate
- revoke

The one-time API-key secret and stored secret hash are not copied into the
outbox.

## Audit metadata security

Transactional enqueue reuses the existing audit sanitizer.

Secret-like fields remain redacted before the payload enters
`outbox_events`.

This is important because the outbox is durable infrastructure, not a temporary
queue, and therefore must obey the same credential-handling boundary as the
final audit store.

## Current non-transactional audit paths

This PR deliberately does not pretend the migration is complete.

Some existing paths still append audit after the primary domain mutation,
including portions of:

- session / notification administration
- channel lifecycle
- scheduling
- provider publish outcome
- automation lifecycle

They continue to use the existing immutable audit store and are functionally
unchanged.

The next reliability slice should move the remaining paths to the outbox or,
where external provider calls are involved, to the appropriate idempotent
side-effect state machine.

## Internal API security

Outbox internal endpoints are:

```text
POST /internal/outbox/claim
POST /internal/outbox/:id/execute
GET  /internal/outbox/stats
```

They are:

- public only with respect to user JWT authentication
- protected by the existing `WorkerTokenGuard`
- skipped from user-facing throttle rules
- not available through workspace API keys

No outbox payload is exposed to the worker. The worker receives only:

- outbox event id
- lease token
- topic/workspace metadata from claim

Processing payload remains inside the API/DB trust boundary.

## Migration chain gate

Stage 15 starts treating SQL migration order as a CI invariant.

New command:

```bash
pnpm migrations:check
```

The gate verifies:

- at least one SQL migration exists
- filename format is `NNN_snake_case.sql`
- numbers are unique
- sequence is contiguous from 001
- migration files are non-empty

CI runs this before TypeScript checks.

This does not yet claim that the repository has a full historical baseline from
day zero. The existing Stage 14 notes correctly describe migrations 001–005 as
forward deltas from the pre-Stage-14 schema.

Establishing a reproducible canonical baseline / fresh-database bootstrap remains
a dedicated Production Hardening slice.

## Schema rollout

Apply after migration 005:

```bash
psql "$DATABASE_URL" \
  -f infra/postgres/migrations/006_stage15_transactional_outbox.sql
```

Migration order:

```text
001_stage14_workspace_invitations.sql
002_stage14_ownership_rbac.sql
003_stage14_workspace_api_keys.sql
004_stage14_immutable_audit_log.sql
005_stage14_sessions_notifications.sql
006_stage15_transactional_outbox.sql
```

## Runtime configuration

```text
OUTBOX_LEASE_SECONDS=120
OUTBOX_MAX_ATTEMPTS=8
OUTBOX_RETRY_BASE_MS=5000
OUTBOX_DISPATCH_POLL_MS=5000
OUTBOX_CLAIM_LIMIT=100
OUTBOX_CONCURRENCY=10
```

Bounds are enforced by the API where relevant.

## Tests

This slice adds regression coverage for:

- audit materialization from an outbox row
- `sourceOutboxEventId` correlation
- completed-event acknowledgement after response loss
- stale lease rejection
- dedupe conflict as an idempotent no-op
- existing audit sanitization
- existing Identity/Admin authorization regressions

CI also compiles the new worker dispatcher/processor.

## Explicit non-goals

PR #31 does not:

- replace the existing publishing queue
- replace the automation queue
- add a second scheduler
- claim exactly-once external provider side effects
- claim canonical fresh-database bootstrap
- claim all audit producers are transactional yet
- delete completed/dead outbox history automatically

Those need separate operational policies.

## Next Production Hardening slice

Recommended next:

1. publishing/automation idempotency + unknown-outcome recovery audit
2. migrate remaining audit producers to transactional outbox
3. dead-letter operational visibility / retry controls
4. canonical migration baseline + fresh-database CI
5. provider rate-limit / circuit-breaker handling
6. broader tenant-isolation / abuse security tests
