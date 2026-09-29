-- Stage 15 transactional outbox foundation.
-- Apply after 005_stage14_sessions_notifications.sql.

alter table workspace_audit_events
  add column if not exists source_outbox_event_id integer;

create unique index if not exists workspace_audit_source_outbox_idx
  on workspace_audit_events (source_outbox_event_id)
  where source_outbox_event_id is not null;

create table if not exists outbox_events (
  id serial primary key,
  workspace_id integer,
  topic varchar(120) not null,
  dedupe_key varchar(255) not null unique,
  payload jsonb not null default '{}'::jsonb,
  status varchar(30) not null default 'pending',
  attempts integer not null default 0,
  available_at timestamp not null default now(),
  lease_token varchar(64),
  lease_expires_at timestamp,
  processed_at timestamp,
  last_error text,
  created_at timestamp not null default now(),
  updated_at timestamp not null default now(),
  constraint outbox_status_check
    check (status in ('pending', 'processing', 'completed', 'dead')),
  constraint outbox_attempts_check
    check (attempts >= 0)
);

create index if not exists outbox_dispatch_idx
  on outbox_events (status, available_at, lease_expires_at);

create index if not exists outbox_workspace_idx
  on outbox_events (workspace_id, created_at);
