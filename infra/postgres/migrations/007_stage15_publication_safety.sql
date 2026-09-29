-- Stage 15 PR 32A: publication safety core.
-- Spec: docs/architecture/STAGE_15_32A_PUBLICATION_SAFETY_SPEC.md (§4, §13).
-- Apply after 006_stage15_transactional_outbox.sql, with publication dispatch
-- paused and drained. Deliberate fallback for rows that cannot drain: run this
-- in the same session before the file
--   set sostats.inflight_publications = 'mark_unknown';

begin;

do $$
declare
  inflight_mode text := coalesce(current_setting('sostats.inflight_publications', true), '');
  inflight_publications integer;
  inflight_attempts integer;
  unexpected text;
  duplicate_groups integer;
  duplicate_detail text;
begin
  select count(*) into inflight_publications
    from scheduled_publications where status = 'publishing';
  select count(*) into inflight_attempts
    from publication_jobs where status in ('processing', 'pending');

  if (inflight_publications > 0 or inflight_attempts > 0)
     and inflight_mode <> 'mark_unknown' then
    raise exception '007: publication dispatch is not drained (% publishing publication(s), % in-flight attempt(s))',
      inflight_publications, inflight_attempts
      using hint = 'Stop the worker and wait for in-flight executions. For rows that cannot drain, verify them on the provider, or run "set sostats.inflight_publications = ''mark_unknown'';" in the same session before this migration.';
  end if;

  select string_agg(distinct status, ', ') into unexpected
    from scheduled_publications
    where status not in ('scheduled', 'publishing', 'published', 'failed', 'cancelled');
  if unexpected is not null then
    raise exception '007: unexpected scheduled_publications.status value(s): %', unexpected;
  end if;

  select string_agg(distinct status, ', ') into unexpected
    from publication_jobs
    where status not in ('pending', 'processing', 'completed', 'failed');
  if unexpected is not null then
    raise exception '007: unexpected publication_jobs.status value(s): %', unexpected;
  end if;

  with latest_result as (
    select distinct on (j.scheduled_publication_id)
      j.scheduled_publication_id, r.error_type
    from publication_results r
    join publication_jobs j on j.id = r.publication_job_id
    order by j.scheduled_publication_id, r.created_at desc, r.id desc
  ),
  future_active as (
    select sp.id, sp.workspace_id, sp.content_item_id, sp.social_account_id, sp.scheduled_at
    from scheduled_publications sp
    left join latest_result lr on lr.scheduled_publication_id = sp.id
    where sp.status in ('scheduled', 'publishing')
       or (sp.status = 'failed' and lr.error_type = 'unknown_outcome')
  ),
  groups as (
    select workspace_id, content_item_id, social_account_id, scheduled_at,
           string_agg(id::text, ',' order by id) as ids
    from future_active
    group by workspace_id, content_item_id, social_account_id, scheduled_at
    having count(*) > 1
  ),
  numbered as (
    select g.*, row_number() over (order by workspace_id, content_item_id, social_account_id, scheduled_at) as rn
    from groups g
  )
  select count(*),
         string_agg(
           format('(workspace=%s, content_item=%s, social_account=%s, scheduled_at=%s) ids=[%s]',
                  workspace_id, content_item_id, social_account_id, scheduled_at, ids),
           E'\n') filter (where rn <= 20)
    into duplicate_groups, duplicate_detail
  from numbered;

  if duplicate_groups > 0 then
    raise exception '007: % duplicate active publication identity group(s); no rows were changed', duplicate_groups
      using detail = duplicate_detail,
            hint = 'Cancel or reschedule all but one row per group, then re-run 007. The future_active query in this file lists them.';
  end if;
end $$;

alter table scheduled_publications
  add column if not exists active_attempt_id integer
    constraint scheduled_publications_active_attempt_id_publication_jobs_id_fk
    references publication_jobs (id) on delete set null,
  add column if not exists lease_expires_at timestamp,
  add column if not exists dispatch_generation integer not null default 1,
  add column if not exists attempt_count integer not null default 0,
  add column if not exists next_attempt_at timestamp;

alter table publication_jobs
  add column if not exists attempt_number integer not null default 1,
  add column if not exists provider_request_started_at timestamp,
  add column if not exists completed_at timestamp,
  add column if not exists error_class varchar(40),
  add column if not exists provider_operation_type varchar(80),
  add column if not exists provider_operation_id varchar(255),
  add column if not exists provider_checkpoint jsonb;

alter table publication_jobs alter column status set default 'processing';

update publication_jobs j
set attempt_number = numbered.n
from (
  select id, row_number() over (partition by scheduled_publication_id order by created_at, id) as n
  from publication_jobs
) numbered
where j.id = numbered.id;

update scheduled_publications sp
set attempt_count = coalesce((
  select j.attempts from publication_jobs j
  where j.scheduled_publication_id = sp.id
  order by j.created_at desc, j.id desc
  limit 1
), 0)
where sp.status = 'scheduled';

-- Undrained rows exist here only with the explicit mark_unknown opt-in.
update publication_jobs
set status = 'unknown',
    provider_request_started_at = coalesce(last_attempt_at, updated_at),
    completed_at = now() at time zone 'utc',
    error_class = 'unknown_outcome',
    updated_at = now() at time zone 'utc'
where status in ('processing', 'pending');

update scheduled_publications sp
set status = 'unknown',
    active_attempt_id = (
      select j.id from publication_jobs j
      where j.scheduled_publication_id = sp.id
      order by j.created_at desc, j.id desc
      limit 1
    ),
    lease_expires_at = null
where sp.status = 'publishing';

update scheduled_publications sp
set status = 'needs_review'
where sp.status = 'failed'
  and (
    select r.error_type
    from publication_results r
    join publication_jobs j on j.id = r.publication_job_id
    where j.scheduled_publication_id = sp.id
    order by r.created_at desc, r.id desc
    limit 1
  ) = 'unknown_outcome';

alter table scheduled_publications
  add constraint scheduled_publications_status_check
  check (status in ('scheduled', 'publishing', 'published', 'failed', 'cancelled', 'unknown', 'needs_review'));

alter table publication_jobs
  add constraint publication_jobs_status_check
  check (status in ('processing', 'completed', 'failed', 'unknown', 'abandoned'));

create unique index if not exists publication_jobs_attempt_unique
  on publication_jobs (scheduled_publication_id, attempt_number);

create index if not exists publication_jobs_publication_idx
  on publication_jobs (scheduled_publication_id);

create unique index if not exists scheduled_pub_active_identity_idx
  on scheduled_publications (workspace_id, content_item_id, social_account_id, scheduled_at)
  where status in ('scheduled', 'publishing', 'unknown', 'needs_review');

create index if not exists scheduled_pub_dispatch_idx
  on scheduled_publications (status, scheduled_at);

create index if not exists scheduled_pub_lease_idx
  on scheduled_publications (lease_expires_at)
  where status = 'publishing';

commit;
