# Stage 14 — Identity / Admin: Immutable Workspace Audit Log

This slice adds a real append-only audit event store for sensitive workspace
operations.

## Goal

SoStats now records security-relevant administrative and operational actions as
persistent workspace audit events rather than relying on process logs.

The core model is:

```text
actor
  ↓
sensitive action
  ↓
sanitized audit metadata
  ↓
append-only workspace_audit_events
  ↓
owner-only Settings viewer
```

## Persistence

`workspace_audit_events` stores:

- workspace id snapshot
- actor user id snapshot
- actor email snapshot
- auth method
- API key id when applicable
- action
- target type
- target id
- sanitized metadata
- created timestamp

The table intentionally does not foreign-key workspace, actor, API key or target
identifiers.

Audit history therefore survives deletion of the referenced entity.

There is intentionally no `updated_at` column.

## Database immutability

Migration 004 installs a PostgreSQL trigger:

```text
workspace_audit_immutable_trigger
```

The trigger rejects both:

- UPDATE
- DELETE

against `workspace_audit_events`.

The application exposes only append and list operations.

No audit-event edit/delete endpoint exists.

## Actor model

Supported auth methods are constrained by the database:

```text
jwt
development
api_key
invitation_token
system
```

### User-authenticated events

JWT/development requests record:

- user id
- user email
- auth method

### API-key events

Workspace API-key requests additionally record:

- API key id

The raw key and hash are never included.

### Invitation recipient events

Invite accept/reject records:

- `invitation_token` auth method
- no authenticated user id
- masked invited email in sanitized metadata

The raw invitation token is never logged.

### System events

Publishing worker outcomes and OAuth callback completion use the `system`
actor.

## Metadata sanitization

Every event passes through a recursive sanitizer before insertion.

Keys matching secret-like names are replaced with:

```text
[REDACTED]
```

The sanitizer covers names containing concepts such as:

- secret
- token
- password
- authorization
- access token
- refresh token
- hash
- credential
- cookie

It also bounds:

- nesting depth
- array length
- object key count
- string length

Date values are stored as ISO timestamps.

This is defense in depth; callers also avoid passing raw sensitive result
payloads.

## Identity/Admin coverage

This slice records:

### Workspace

- `workspace.created`
- `workspace.settings_updated`
- `workspace.name_updated`
- `workspace.ownership_transferred`
- `workspace.deleted`

### Membership

- `member.role_updated`
- `member.removed`

### Invitations

- `invitation.created`
- `invitation.regenerated`
- `invitation.revoked`
- `invitation.accepted`
- `invitation.rejected`

Invitation create/regenerate audit metadata intentionally excludes the raw
one-time token.

### API keys

- `api_key.created`
- `api_key.rotated`
- `api_key.revoked`

API-key audit metadata may include safe operational fields such as:

- display/public id
- name
- scopes
- expiry

It never includes:

- raw key
- secret
- secret hash

## Channel coverage

The audit log records:

- `channel.oauth_started`
- `channel.connected`
- `channel.credentials_refreshed`
- `channel.disconnected`

OAuth authorization URLs/state, access tokens and refresh tokens are excluded.

A successful OAuth callback records the connected provider/account identity as a
system event.

## Publishing coverage

User-side scheduling actions record:

- `publication.scheduled`
- `publication.rescheduled`
- `publication.cancelled`

Publishing worker outcomes record:

- `publication.published`
- `publication.failed`

The success event includes safe provider/post correlation.

Failure events retain error classification but deliberately do not persist
provider error text or credential context.

## Automation coverage

The audit log records:

- `automation.created`
- `automation.updated`
- `automation.version_created`
- `automation.published`
- `automation.paused`
- `automation.trigger_secret_rotated`
- `automation.trigger_retried`
- `automation.run_started`
- `automation.run_retried`
- `automation.review_decision`

Workflow definitions, webhook secrets and trigger payload contents are not copied
into audit metadata.

For run starts, the log stores only whether a trigger payload was present.

For human review decisions, the log stores the decision and whether notes were
provided, not the note body.

## Owner-only read access

Workspace Settings loads the most recent 50 audit events for the owner.

Non-owner members do not receive audit event rows.

The Settings viewer shows:

- action
- actor/auth method
- target
- timestamp
- sanitized metadata

This is a read-only surface.

## Workspace deletion

Because workspace id is stored as a snapshot rather than a foreign key, a
`workspace.deleted` audit event can be appended after the workspace row has
been deleted and prior audit history remains intact.

## Schema rollout

Apply after migration 003:

```bash
psql "$DATABASE_URL" \
  -f infra/postgres/migrations/004_stage14_immutable_audit_log.sql
```

Migration order:

```text
001_stage14_workspace_invitations.sql
002_stage14_ownership_rbac.sql
003_stage14_workspace_api_keys.sql
004_stage14_immutable_audit_log.sql
```

## Transactional delivery boundary

Persisted audit rows are immutable once appended.

In this Stage 14 slice, some audit appends occur immediately after a successful
domain mutation rather than in the exact same database transaction.

That means a process/database failure in the narrow interval after the domain
commit could theoretically leave a missing audit row.

Production Hardening must close this delivery gap with a transactional
outbox/event coupling or same-transaction audit writer.

This limitation is documented rather than hidden.

## Tests

This slice adds regression coverage for:

- secret-like metadata redaction
- nested redaction
- Date → ISO serialization
- API-key actor correlation without credential material
- owner-only audit read authorization
- sanitization before insertion

Existing CI additionally typechecks all instrumented controller/service result
contracts.

## Explicitly not included

This slice does not add:

- audit row editing
- audit row deletion
- external SIEM export
- log retention policies
- cryptographic event chaining
- WORM object-storage export
- cross-workspace/global organization audit search
- transactional outbox coupling

The latter operational guarantees belong to Production Hardening.

## Next Stage 14 slice

Next:

1. session administration
2. notification preferences

Then Identity/Admin can close and SoStats can enter Production Hardening.
