-- Stage 14 session administration + notification preference policy.
-- Apply after 004_stage14_immutable_audit_log.sql.

create table if not exists auth_sessions (
  id serial primary key,
  user_id integer not null references users(id) on delete cascade,
  token_hash varchar(64) not null unique,
  auth_method varchar(40) not null,
  user_agent varchar(512),
  expires_at timestamp,
  last_seen_at timestamp not null default now(),
  revoked_at timestamp,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now(),
  constraint auth_session_method_check
    check (auth_method in ('jwt', 'development'))
);

create index if not exists auth_session_user_idx
  on auth_sessions (user_id, last_seen_at);

create table if not exists workspace_notification_preferences (
  id serial primary key,
  workspace_id integer not null references workspaces(id) on delete cascade,
  user_id integer not null references users(id) on delete cascade,
  security_events boolean not null default true,
  publishing_failures boolean not null default true,
  automation_failures boolean not null default true,
  weekly_digest boolean not null default false,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now()
);

create unique index if not exists workspace_notification_user_idx
  on workspace_notification_preferences (workspace_id, user_id);
