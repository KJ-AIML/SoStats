# Stage 14 — Identity / Admin: Workspace API Keys

This slice continues Stage 14 after workspace invitations and ownership/RBAC
hardening.

## Goal

Provide real machine credentials for SoStats workspace APIs without turning API
keys into unrestricted user-session substitutes.

The core boundary is:

```text
workspace owner
  ↓
generate-once API key
  ↓
hash-only persistence
  ↓
workspace-scoped endpoint only
  ↓
matching x-workspace-id
  ↓
read/write scope enforcement
```

## Credential format

Generated keys use:

```text
sostats_sk_<public-id>_<secret>
```

The public id is used for indexed lookup.

The secret is 32 random bytes encoded as base64url.

Only the SHA-256 hash of the secret is persisted.

The raw token is returned only after:

- create
- rotate

It is never returned by the Settings read model.

## Persistence

`workspace_api_keys` stores:

- workspace id
- creator user id
- public id
- name
- SHA-256 secret hash
- scopes
- expiry
- last-used timestamp
- rotation timestamp
- revocation timestamp
- created/updated timestamps

The creator relation is used as an identity anchor.

Normal workspace membership remains authoritative. If the creator no longer has
workspace membership, WorkspaceGuard denies requests even if the secret still
matches.

## Management authorization

Only the workspace owner may:

- create
- rotate
- revoke
- list API key metadata

API keys themselves cannot manage API keys.

Management endpoints live under `/workspaces/:id/...`, which are deliberately
not decorated as generic workspace-scoped resource endpoints.

AuthGuard rejects SoStats API keys on those unscoped identity/admin endpoints.

## API authentication

AuthGuard recognizes a bearer token beginning with:

```text
Bearer sostats_sk_
```

Before accepting it, the guard requires:

1. the target controller/handler is `@WorkspaceScoped()`
2. `x-workspace-id` is present
3. the header workspace matches the key's persisted workspace
4. the key exists
5. the key is not revoked
6. the key is not expired
7. the secret hash matches with timing-safe comparison

The request receives the creator user identity plus an API-key auth context.

This does **not** create a JWT session.

## Scope model

Stage 14 intentionally keeps the first scope model narrow:

- `workspace:read`
- `workspace:write`

WorkspaceGuard maps request methods to scopes.

Read methods:

```text
GET
HEAD
OPTIONS
→ workspace:read
```

Mutating methods:

```text
POST
PUT
PATCH
DELETE
→ workspace:write
```

Scopes are independent.

A write-only key cannot read unless it also has `workspace:read`.

A read-only key cannot mutate resources even if the user who originally created
the key is an owner.

## Workspace isolation

The API key is bound to one workspace.

The request must include:

```http
Authorization: Bearer sostats_sk_...
x-workspace-id: 123
```

If the persisted key belongs to workspace 77 and the request header says
workspace 88, authentication fails before the resource controller executes.

WorkspaceGuard then independently verifies the creator still has membership in
the same workspace.

## Identity/Admin isolation

API keys are intentionally not accepted on unscoped identity/admin endpoints.

Examples blocked for API-key authentication:

- workspace listing/creation
- Settings administration
- invitations
- ownership transfer
- API key creation/rotation/revocation

Those continue to require normal user authentication.

This avoids giving a leaked integration key a path to mint new credentials or
change ownership.

## Expiry

Each key must expire.

Supported lifecycle input:

```text
1–365 days
```

The Settings UI provides:

- 30 days
- 90 days
- 180 days
- 365 days

The service default is 90 days.

There is intentionally no never-expire option in this slice.

## Rotation

Rotation:

1. requires owner authorization
2. rejects revoked keys
3. generates a new public id
4. generates a new secret
5. replaces the stored secret hash
6. resets expiry
7. records `rotated_at`
8. returns the new raw token once

Changing the public id means the previous token stops at indexed lookup before
secret comparison.

Expired, non-revoked keys may be rotated to restore a credential intentionally.

## Revocation

Revocation records `revoked_at`.

Authentication rejects revoked keys immediately.

Repeated revocation is idempotent.

Revoked keys cannot be rotated.

Historical metadata remains visible in Settings for operational traceability.

## Last-used tracking

A successful API-key authentication updates `last_used_at`.

To avoid writing on every request, SoStats refreshes the timestamp at most once
per five-minute window per key.

The Settings UI exposes the last-used time but never the secret/hash.

## Settings UX

Owners can:

- name a key
- select expiry
- select read/write scopes
- create
- copy the one-time token
- inspect status
- inspect prefix
- inspect scopes
- inspect expiry
- inspect last used
- rotate
- revoke

Non-owners see no management controls.

## Schema rollout

Apply after migrations 001 and 002:

```bash
psql "$DATABASE_URL" \
  -f infra/postgres/migrations/003_stage14_workspace_api_keys.sql
```

Migration order:

```text
001_stage14_workspace_invitations.sql
002_stage14_ownership_rbac.sql
003_stage14_workspace_api_keys.sql
```

Production Hardening still needs the canonical migration baseline and automated
migration gate.

## Security properties

- 256-bit random secrets
- hash-only secret persistence
- timing-safe secret comparison
- generated token shown once
- mandatory bounded expiry
- explicit rotation
- explicit revocation
- workspace binding
- creator membership re-check
- read/write scope enforcement
- identity/admin endpoints unavailable to API keys
- global request throttling remains active

## Tests

This slice adds regression coverage for:

- allowed/invalid scope validation
- raw key not persisted
- malformed key rejection
- unscoped endpoint rejection
- cross-workspace rejection
- read-scoped GET access
- read-only mutation rejection

## Explicitly not included

This slice does not add:

- organization-global API keys
- custom scopes
- per-resource scopes
- IP allowlists
- mTLS
- OAuth client credentials
- API key usage analytics beyond last-used time
- immutable audit events

Audit logging is the next Identity/Admin slice and will record credential
lifecycle operations separately.

## Next Stage 14 slice

Next:

1. immutable audit log
2. sessions / notification administration

Then continue into Production Hardening.
