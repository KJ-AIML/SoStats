-- Stage 14 workspace invitations delta.
-- Apply to an existing SoStats database whose schema matches main before deploying
-- the Stage 14 invitations code. This repository did not previously carry a
-- historical Drizzle migration baseline, so this file is intentionally a
-- focused forward-only SQL delta rather than pretending a full baseline exists.

create table if not exists workspace_invitations (
  id serial primary key,
  workspace_id integer not null references workspaces(id) on delete cascade,
  email varchar(255) not null,
  role varchar(50) not null default 'member',
  token_hash varchar(64) not null unique,
  status varchar(30) not null default 'pending',
  invited_by_user_id integer references users(id) on delete set null,
  accepted_by_user_id integer references users(id) on delete set null,
  expires_at timestamp not null,
  accepted_at timestamp,
  rejected_at timestamp,
  revoked_at timestamp,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now(),
  constraint workspace_invite_role_check
    check (role in ('admin', 'member')),
  constraint workspace_invite_status_check
    check (status in ('pending', 'accepted', 'rejected', 'revoked', 'expired'))
);

create index if not exists workspace_invite_email_idx
  on workspace_invitations (workspace_id, email);

create index if not exists workspace_invite_status_idx
  on workspace_invitations (workspace_id, status);
