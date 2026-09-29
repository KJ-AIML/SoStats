# Stage 14 — Identity / Admin: Ownership Transfer + RBAC Hardening

This slice continues Stage 14 after secure workspace invitations.

## Goal

Make workspace ownership a real lifecycle instead of a special role string that
can be assigned through generic member editing.

The target invariant is:

```text
every live workspace has exactly one owner through normal application flows
```

The database enforces **at most one** owner. The transactional service preserves
the existing owner until a complete transfer commits, so normal application
flows preserve **at least one** owner as well.

## Workspace roles

The canonical role set is now centralized:

```text
owner
admin
member
```

`WorkspaceAccessService` exposes:

- `requireMembership()`
- `requireManager()` — owner/admin
- `requireOwner()` — owner only

Unknown persisted role values fail closed.

This avoids duplicating free-form role arrays across identity/admin services.

## Database constraints

`workspace_members.role` now has a CHECK constraint:

```sql
role in ('owner', 'admin', 'member')
```

A partial unique index enforces at most one owner per workspace:

```sql
create unique index workspace_single_owner_idx
on workspace_members (workspace_id)
where role = 'owner';
```

The forward SQL delta is:

```text
infra/postgres/migrations/002_stage14_ownership_rbac.sql
```

Apply it after the Stage 14 invitations migration.

If historical data already contains invalid roles or multiple owners, the
migration is expected to fail visibly instead of silently choosing an owner.
That data must be reconciled before production rollout.

## Ownership transfer

Only the current owner may transfer ownership.

API boundary:

```text
POST /workspaces/:id/ownership-transfer
```

Input:

```json
{
  "targetMemberId": 123,
  "previousOwnerRole": "admin"
}
```

The previous owner role may only be:

- admin
- member

The Settings UI intentionally uses `admin` so the transferring owner retains
workspace management access.

## Transaction semantics

Ownership transfer runs in one database transaction.

It obtains a workspace-level PostgreSQL advisory transaction lock:

```text
(workspace_id, 0)
```

Then it:

1. re-reads the actor membership inside the transaction
2. verifies the actor is still the current owner
3. loads the target by both member id **and workspace id**
4. rejects self-transfer
5. demotes the previous owner
6. promotes the target to owner
7. commits both role changes together

Readers outside the transaction continue to observe the previous committed owner
until commit.

If target promotion fails, the previous owner demotion rolls back with it.

## Tenant isolation

A target member id is never sufficient by itself.

The transfer query always scopes the target to the current workspace:

```text
member.id = targetMemberId
AND
member.workspace_id = workspaceId
```

A member id from another workspace is treated as not found and causes no role
mutation.

The test suite covers this boundary.

## Generic member-role editing

The existing role editor may assign only:

- admin
- member

It cannot assign `owner`.

Ownership can only change through the dedicated transfer lifecycle.

The current owner also cannot be removed through generic member removal.

## Invitations

Workspace invitation administration now uses the centralized
`requireOwner()` boundary.

Invitations still cannot grant owner directly.

Valid invitation roles remain:

- admin
- member

A new member must first join, then the current owner can explicitly transfer
ownership.

## Settings UX

For owners, non-owner members now expose:

- Make owner
- Remove
- admin/member role selector

Ownership transfer uses an explicit confirmation state.

After a successful transfer:

- selected member becomes owner
- previous owner becomes admin
- browser refreshes the Settings read model
- the previous owner retains Settings manager access but loses owner-only
  powers

The current owner row is no longer labeled as “ownership transfer not
implemented.”

## Authorization matrix

Current identity/admin boundaries are:

| Operation | Owner | Admin | Member |
| --- | --- | --- | --- |
| Read workspace | yes | yes | yes |
| Edit workspace name/timezone | yes | yes | no |
| Create/revoke invites | yes | no | no |
| Change admin/member roles | yes | no | no |
| Remove non-owner members | yes | no | no |
| Transfer ownership | yes | no | no |
| Delete workspace | yes | no | no |

These checks are enforced server-side.

## Schema rollout

Apply:

```bash
psql "$DATABASE_URL" \
  -f infra/postgres/migrations/002_stage14_ownership_rbac.sql
```

after:

```text
001_stage14_workspace_invitations.sql
```

Production Hardening still needs to establish the canonical migration baseline
and automated migration gate.

## Tests

This slice adds tests for:

- missing workspace membership returns not found
- unknown persisted roles fail closed
- admin cannot pass owner-only authorization
- admin satisfies manager authorization
- owner satisfies owner authorization
- successful ownership transfer
- previous owner demotion
- target owner promotion
- cross-workspace target rejection
- no mutations when the target is outside the workspace
- invalid target ids

## Explicitly not included

This slice does not add:

- custom roles
- granular per-resource permissions
- ownership transfer by invitation
- organization-level roles
- SCIM
- SSO administration
- API keys
- immutable audit log

Those remain separate lifecycle/hardening slices.

## Next Stage 14 slice

Next:

1. API key lifecycle
2. immutable audit log
3. sessions / notification administration

Then continue into Production Hardening.
