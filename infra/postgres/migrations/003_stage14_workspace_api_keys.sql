-- Stage 14 workspace API key lifecycle delta.
-- Apply after 002_stage14_ownership_rbac.sql on a database matching current
-- main before deploying this application slice.

create table if not exists workspace_api_keys (
  id serial primary key,
  workspace_id integer not null references workspaces(id) on delete cascade,
  created_by_user_id integer not null references users(id) on delete cascade,
  public_id varchar(32) not null unique,
  name varchar(120) not null,
  secret_hash varchar(64) not null,
  scopes jsonb not null default '[]'::jsonb,
  expires_at timestamp not null,
  last_used_at timestamp,
  rotated_at timestamp,
  revoked_at timestamp,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now(),
  constraint workspace_api_key_name_check
    check (length(trim(name)) between 1 and 120),
  constraint workspace_api_key_scopes_array_check
    check (jsonb_typeof(scopes) = 'array')
);

create index if not exists workspace_api_key_workspace_idx
  on workspace_api_keys (workspace_id, created_at);

create index if not exists workspace_api_key_active_idx
  on workspace_api_keys (workspace_id, revoked_at);
