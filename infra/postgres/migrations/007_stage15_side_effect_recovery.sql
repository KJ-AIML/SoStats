-- Stage 15 side-effect recovery and automation execution fencing.
-- Apply after 006_stage15_transactional_outbox.sql.

alter table campaigns
  add column if not exists source_key varchar(255);

create unique index if not exists campaign_source_key_unique
  on campaigns (source_key);

alter table publication_jobs
  add column if not exists execution_phase varchar(40) not null default 'idle',
  add column if not exists execution_token varchar(64),
  add column if not exists lease_expires_at timestamp,
  add column if not exists provider_request_started_at timestamp;

alter table publication_jobs
  drop constraint if exists publication_job_phase_check;

alter table publication_jobs
  add constraint publication_job_phase_check
  check (
    execution_phase in (
      'idle',
      'claimed',
      'provider_request_started',
      'terminal'
    )
  );

create index if not exists publication_job_schedule_idx
  on publication_jobs (scheduled_publication_id, created_at);

create index if not exists publication_job_lease_idx
  on publication_jobs (status, lease_expires_at);

alter table automation_run_steps
  add column if not exists attempts integer not null default 0,
  add column if not exists execution_token varchar(64),
  add column if not exists lease_expires_at timestamp,
  add column if not exists updated_at timestamp not null default now();

alter table automation_run_steps
  drop constraint if exists automation_run_step_attempts_check;

alter table automation_run_steps
  add constraint automation_run_step_attempts_check
  check (attempts >= 0);

create unique index if not exists automation_run_step_unique
  on automation_run_steps (run_id, step_id);

create index if not exists automation_run_step_lease_idx
  on automation_run_steps (status, lease_expires_at);

create index if not exists ai_insight_generation_idx
  on ai_insights (workspace_id, generation_id);
