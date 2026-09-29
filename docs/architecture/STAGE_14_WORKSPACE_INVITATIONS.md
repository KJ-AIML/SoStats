# Stage 14 — Identity / Admin: Workspace Invitations

Stage 14 begins the Identity/Admin lifecycle after provider expansion.

This slice adds a real workspace invitation lifecycle without inventing an email
delivery system that does not yet exist.

## Goal

Workspace owners can provision expiring invitation links for a specific email
identity and role.

Recipients can:

- inspect an invitation
- accept it
- reject it

Owners can:

- create an invitation
- regenerate its secret link
- revoke a pending/expired invitation
- inspect current/recent invitation state from Settings

Accepted invitations become persisted workspace memberships.

## Data model

`workspace_invitations` stores:

- workspace id
- normalized invite email
- role: `admin` or `member`
- SHA-256 token hash
- lifecycle status
- inviter user id
- accepted user id
- expiry
- accepted / rejected / revoked timestamps
- created / updated timestamps

Raw invitation tokens are never persisted.

The database constrains:

```text
role   = admin | member
status = pending | accepted | rejected | revoked | expired
```

## Token model

Creation generates 32 random bytes and encodes them as base64url.

```text
raw bearer token
  ↓ SHA-256
workspace_invitations.token_hash
```

Only the raw token returned during create/regenerate can open the invitation
link.

Regenerating a link replaces the stored hash, immediately invalidating the
previous link.

Default expiry:

```text
WORKSPACE_INVITE_TTL_HOURS=168
```

The accepted configuration range is 1–720 hours. Invalid configuration falls
back to 168 hours.

## Authorization

Invitation administration remains owner-only in this slice.

```text
authenticated owner
  ↓
WorkspaceAccessService
  ↓
create / regenerate / revoke
```

Admins do not gain owner-level team mutation powers implicitly.

That boundary remains consistent with the existing Settings member controls.

## Recipient lifecycle

Recipient routes are public because the invitation URL itself is the bearer
credential.

The raw token is high entropy and rate limiting still applies globally.

### Inspect

```text
GET /invitations/:token
```

Returns only:

- workspace identity
- masked invite email
- role
- effective status
- expiry

The full invite email is not exposed on the public preview.

### Accept

```text
POST /invitations/:token/accept
```

Acceptance is transactionally serialized on the invitation.

SoStats:

1. verifies the hash and lifecycle
2. persists `expired` if the invitation timed out
3. resolves or creates a user row for the invited email
4. creates workspace membership idempotently
5. marks the invitation accepted
6. records the accepted user id/timestamp

The placeholder user may initially have no auth subject.

When that person later authenticates, the existing AuthService resolves by
email and links the verified bearer identity to that user.

Workspace access still requires normal authentication and, by default, a
verified email claim.

Holding the invite token alone does not produce an authenticated SoStats
session.

### Reject

```text
POST /invitations/:token/reject
```

Reject is terminal for that token.

The owner can create a new invitation later if needed.

## Concurrency

Invitation lifecycle mutations use PostgreSQL advisory transaction locks.

```text
(workspace_id, invitation_id)
```

This serializes:

- accept vs reject
- accept vs regenerate
- accept vs revoke
- regenerate vs revoke

Invitation creation also serializes by:

```text
(workspace_id, hashtext(normalized_email))
```

to prevent two concurrent active invitations being created for the same email
through this service.

## Existing member protection

Creating an invitation for an email that already belongs to a workspace member
returns a conflict instead of creating duplicate lifecycle state.

The existing `workspace_user_idx` unique membership constraint remains the
final database-level protection.

## Settings UX

The workspace Settings page now exposes an Invitations console to the owner.

It supports:

- email input
- admin/member role choice
- secure link generation
- copy-to-clipboard
- pending / accepted / rejected / revoked / expired state
- expiry visibility
- regenerate link
- revoke

The raw link is shown only immediately after create/regenerate.

A later page refresh cannot recover the old raw token from the server because it
was never stored.

## Recipient UX

`/invite/:token` is a dedicated recipient surface.

It displays:

- workspace
- masked identity
- role
- expiry
- current invitation state

Accepted membership remains tied to the invited email identity.

## Email delivery

Automated invitation email delivery is intentionally **not** implemented in this
slice.

The product therefore says so explicitly.

Owners currently copy the secure link and deliver it through a trusted channel.

This avoids pretending Mailpit/local SMTP is a production notification system.

A future Notifications/Identity slice can add:

- mail provider adapter
- invitation template
- delivery attempts
- bounce/failure state
- resend delivery

without changing the invitation token lifecycle.

## Schema rollout

This repository did not previously carry a historical Drizzle migration
baseline.

To avoid manufacturing a false baseline, this slice includes a focused SQL
forward delta:

```text
infra/postgres/migrations/001_stage14_workspace_invitations.sql
```

Apply it to a database whose schema matches current `main` before deploying
the Stage 14 application code.

Example:

```bash
psql "$DATABASE_URL" \
  -f infra/postgres/migrations/001_stage14_workspace_invitations.sql
```

Production Hardening should establish the canonical migration baseline and
automated rollout gate for all later schema changes.

## Explicitly not included

This PR does not claim:

- automated invitation email delivery
- ownership transfer
- custom roles
- SCIM
- SSO administration
- API key lifecycle
- immutable audit logs
- user session management UI

Those remain later Identity/Admin / Production Hardening slices.

## Security properties

- 256-bit random raw tokens
- hash-only token persistence
- bounded expiry
- old link invalidation on regenerate
- owner-only administration
- masked email on public preview
- transaction-serialized lifecycle mutations
- verified-email authentication still required for normal workspace access
- workspace membership uniqueness retained

## Verification

Required CI:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

plus the existing Python AI compile/test job.

## Next Stage 14 slice

After Invitations:

1. Ownership transfer + RBAC hardening
2. API key lifecycle
3. immutable audit log
4. account/session + notification administration

Then continue into Production Hardening.
