# Stage 14 — Identity / Admin: Sessions + Notification Administration

This slice closes Stage 14 Identity/Admin.

It adds a revocable SoStats session registry for user authentication and a
persisted per-user/per-workspace notification policy without pretending that an
outbound email/push delivery runtime already exists.

## Goals

1. Make bearer sessions observable and revocable inside SoStats.
2. Never persist raw bearer credentials.
3. Keep API keys on their independent rotate/revoke lifecycle.
4. Persist notification preferences as policy state.
5. Keep outbound notification delivery explicitly unavailable until a real
   adapter/runtime exists.

## Session registry

SoStats now persists `auth_sessions`.

Each row stores:

- user id
- SHA-256 credential fingerprint
- auth method
- bounded user-agent snapshot
- token expiry when available
- last-seen timestamp
- revoked timestamp
- created/updated timestamps

Supported auth methods:

```text
jwt
development
```

Workspace API keys remain separate and are not represented as sessions.

## JWT session fingerprint

For a verified JWT:

```text
raw JWT
  ↓
"jwt:" + raw JWT
  ↓ SHA-256
auth_sessions.token_hash
```

The raw JWT is never persisted.

On every authenticated request, AuthGuard:

1. verifies JWT signature/issuer/audience/email claims
2. resolves the SoStats user
3. hashes the presented bearer credential
4. loads or creates the SoStats session row
5. rejects a revoked session
6. rejects an expired session
7. updates last-seen on a five-minute cadence
8. attaches the session id to the authenticated user context

A revoked SoStats session therefore stops the same JWT from reaching
controllers even if the upstream JWT signature is otherwise valid.

## Development auth

Development bypass remains disabled in production.

In non-production, SoStats creates a deterministic development session
fingerprint from the development identity.

This gives Settings a visible session record without introducing fake
production session semantics.

## Current session

Settings marks the currently authenticated SoStats session.

The current session cannot be revoked from this Settings surface.

Reason:

- the current web authentication handoff is managed by the identity/sign-out
  flow
- revoking the current session from a page that cannot clear the upstream
  credential would leave the browser/server in a partial sign-out state

Other active sessions can be revoked.

## Session isolation

Users can list/revoke only their own session rows.

The Settings route additionally requires the user to be a member of the current
workspace before exposing session administration in that workspace surface.

Revocation by session id always scopes by:

```text
auth_sessions.id = requested id
AND
auth_sessions.user_id = current user
```

## Session metadata

The Settings UI shows:

- auth method
- current marker
- active/expired/revoked state
- user-agent snapshot
- last seen
- expiry when available
- revoke action for other active sessions

No raw credential or token hash is returned to the web UI.

## Notification preference model

`workspace_notification_preferences` is unique by:

```text
(workspace_id, user_id)
```

Persisted preferences:

- security events
- publishing failures
- automation failures
- weekly digest

Defaults:

```text
security events       = enabled
publishing failures   = enabled
automation failures   = enabled
weekly digest         = disabled
```

These defaults favor operational/security visibility while avoiding an
unsolicited digest preference.

## Authorization

Every workspace member may manage their own notification preference row.

No member can modify another user's preference row.

Owner/admin roles do not override another user's personal notification policy.

## Outbound delivery boundary

This slice does **not** claim:

- email delivery
- push notifications
- SMS
- digest scheduler
- notification inbox delivery
- provider-specific notification webhooks

The product capability matrix therefore exposes:

```text
notificationPreferences = true
notificationDelivery    = false
```

Settings explicitly labels these values as persisted policy state only.

A future delivery adapter can consume this policy without changing the
Identity/Admin data model.

## Audit coverage

This slice records:

- `session.revoked`
- `notification.preferences_updated`

The audit event identifies:

- workspace
- actor
- auth method
- target
- sanitized preference values / session id context

Raw bearer credentials are never copied into audit metadata.

## Settings UX

New Settings surfaces:

### Authentication sessions

Shows only the current user's SoStats sessions.

Actions:

- inspect session state
- identify current session
- revoke another active session

### Notification preferences

Persisted toggles:

- Security events
- Publishing failures
- Automation failures
- Weekly digest

The UI clearly states that no outbound delivery adapter is active.

## Schema rollout

Apply after migrations 001–004:

```bash
psql "$DATABASE_URL" \
  -f infra/postgres/migrations/005_stage14_sessions_notifications.sql
```

Migration order:

```text
001_stage14_workspace_invitations.sql
002_stage14_ownership_rbac.sql
003_stage14_workspace_api_keys.sql
004_stage14_immutable_audit_log.sql
005_stage14_sessions_notifications.sql
```

## Tests

This slice adds regression coverage for:

- JWT raw token not persisted
- SHA-256 session fingerprint shape
- revoked session rejection
- current-session self-revoke protection
- notification policy defaults
- workspace membership requirement
- per-user/per-workspace preference persistence

Existing auth/API-key tests are updated for the new SessionService dependency.

## Stage 14 completion

After this PR, Identity/Admin contains:

- secure workspace invitations
- ownership transfer
- centralized RBAC
- scoped workspace API keys
- immutable audit log
- revocable SoStats user sessions
- persisted notification preferences

Not included by design:

- SSO/SCIM administration
- custom roles
- outbound notification delivery
- enterprise identity federation
- device attestation

Those are not required for the current SoStats product contract.

## Next stage — Production Hardening

Production Hardening should now focus on:

1. transactional outbox / audit-event coupling
2. idempotency audit across side effects
3. dead-letter and recovery policies
4. provider rate limits / circuit breakers
5. worker crash and unknown-outcome recovery
6. tenant-isolation security testing
7. OAuth/webhook/upload abuse protection
8. structured logs/tracing/metrics
9. end-to-end browser/API tests
10. canonical migration baseline + deployment gate
11. backup/restore drills
12. production configuration validation
13. beta-readiness gate
