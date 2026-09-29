# Stage 12 — Product UI Completion: Settings

Settings completes the Stage 12 product surface over workspace administration
capabilities that already have real persistence and authorization boundaries.

## Workspace scope

Settings is now workspace-scoped:

```text
/:workspaceSlug/settings
```

The old global `/settings` route resolves the user's first accessible workspace
and redirects into that workspace-scoped surface.

The sidebar also links to the current workspace's Settings route.

## Workspace settings

The persisted workspace fields exposed for editing are:

- name
- IANA timezone

Slug is displayed but remains immutable in this slice.

The API validates:

- non-empty bounded workspace name
- valid IANA timezone

Owner and admin roles may change workspace identity/timezone.

## Team and roles

The UI reads the real `workspace_members` relation joined to persisted users.

Roles remain:

- owner
- admin
- member

Only owners can change another non-owner member between:

- admin
- member

Only owners can remove non-owner members.

Owner mutation/removal is intentionally blocked because ownership transfer does
not yet have a dedicated transactional lifecycle.

## Authentication/security summary

Settings exposes sanitized runtime capability state only.

It may show:

- Bearer JWT vs non-production development bypass mode
- whether the development bypass is active
- whether JWT issuer configuration exists
- whether JWT audience configuration exists
- that production requires Bearer authentication

It does **not** expose:

- issuer values
- audience values
- JWT secrets/keys
- bearer tokens
- user credentials

The development bypass remains explicitly unavailable in production through the
existing AuthGuard condition.

## Honest capability matrix

The product no longer renders fake controls for settings capabilities without a
backend lifecycle.

Available now:

- workspace identity
- workspace timezone
- persisted team roles

Explicitly unavailable until later identity/hardening stages:

- invitations
- user-managed API keys
- notification preferences
- immutable audit log
- mutable workspace-wide publish policy
- ownership transfer

The UI labels these as not implemented and provides no action control.

## Human approval

Content review and Automation review gates remain real domain/runtime state.

This slice does not add a decorative workspace-level “human approval” toggle,
because no persisted workspace policy record currently exists.

## Authorization

Settings mutations reuse the existing WorkspaceAccessService.

```text
authenticated user
  ↓
workspace membership
  ↓
owner/admin permission boundary
  ↓
workspace or member mutation
```

Workspace not found and insufficient-role behavior remains enforced by the API,
not only the browser.

## Intentionally not included

This Stage 12 completion does not attempt to collapse the later identity/security
roadmap into UI fiction.

Not included:

- invitation tokens
- ownership transfer
- API key generation/revocation
- notification delivery/preferences
- audit event store
- SSO administration
- SCIM
- billing
- fake workspace policy toggles

These require separate data models and lifecycle rules.

## Verification

Required CI:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

plus the existing AI compile/test job.

## Stage 12 completion

With Settings complete, the Stage 12 product-completion pass covers:

- Home
- AI Studio
- Content
- Calendar
- Automations
- Analytics
- Media
- Channels
- Brand Brain
- Integrations
- Settings

The next roadmap work is provider expansion, deeper identity/team lifecycle and
production hardening rather than filling product pages with placeholders.
