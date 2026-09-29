-- Stage 14 ownership/RBAC hardening delta.
-- Apply after 001_stage14_workspace_invitations.sql on a database matching
-- current main before deploying this application slice.

alter table workspace_members
  add constraint workspace_member_role_check
  check (role in ('owner', 'admin', 'member'));

create unique index if not exists workspace_single_owner_idx
  on workspace_members (workspace_id)
  where role = 'owner';
