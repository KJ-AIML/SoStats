-- Stage 14 immutable workspace audit log.
-- Apply after 003_stage14_workspace_api_keys.sql.

create table if not exists workspace_audit_events (
  id serial primary key,
  workspace_id integer not null,
  actor_user_id integer,
  actor_email varchar(255),
  auth_method varchar(40) not null,
  api_key_id integer,
  action varchar(120) not null,
  target_type varchar(80) not null,
  target_id varchar(120),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamp not null default now(),
  constraint workspace_audit_auth_method_check
    check (auth_method in ('jwt', 'development', 'api_key', 'invitation_token', 'system')),
  constraint workspace_audit_action_check
    check (length(trim(action)) between 1 and 120),
  constraint workspace_audit_target_type_check
    check (length(trim(target_type)) between 1 and 80)
);

create index if not exists workspace_audit_workspace_created_idx
  on workspace_audit_events (workspace_id, created_at);

create index if not exists workspace_audit_action_idx
  on workspace_audit_events (workspace_id, action);

create or replace function sostats_reject_workspace_audit_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'workspace_audit_events are immutable';
end;
$$;

drop trigger if exists workspace_audit_immutable_trigger
  on workspace_audit_events;

create trigger workspace_audit_immutable_trigger
before update or delete on workspace_audit_events
for each row
execute function sostats_reject_workspace_audit_mutation();
