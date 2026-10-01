-- Stage 15 PR 32B-1: publication resolution core.
-- Spec: docs/architecture/STAGE_15_32B1_RESOLUTION_CORE_SPEC.md (§5).
-- Apply after 007. Additive and forward-only: no drain is needed, and it
-- changes no publication status. The new API runtime performs every
-- resolution, audited, in its own transactions.

begin;

alter table scheduled_publications
  add column if not exists reconcile_after timestamp;

create index if not exists scheduled_pub_reconcile_idx
  on scheduled_publications (reconcile_after)
  where status in ('unknown', 'needs_review');

create table if not exists publication_reconciliations (
  id serial primary key,
  scheduled_publication_id integer not null
    references scheduled_publications (id) on delete cascade,
  attempt_id integer references publication_jobs (id) on delete set null,
  source varchar(20) not null,
  outcome varchar(30) not null,
  evidence_type varchar(60) not null,
  platform_post_id varchar(255),
  platform_post_url varchar(1024),
  evidence jsonb not null default '{}'::jsonb,
  actor_user_id integer references users (id) on delete set null,
  note varchar(500),
  created_at timestamp not null default now(),
  constraint publication_reconciliations_source_check
    check (source in ('automatic', 'operator')),
  constraint publication_reconciliations_outcome_check
    check (outcome in ('confirmed_published', 'inconclusive', 'confirmed_absent', 'cancelled'))
);

create index if not exists publication_reconciliations_publication_idx
  on publication_reconciliations (scheduled_publication_id, created_at);

create index if not exists publication_reconciliations_attempt_idx
  on publication_reconciliations (attempt_id);

-- The only data change: make every ambiguous row eligible for one pass (§4.1).
update scheduled_publications
set reconcile_after = now() at time zone 'utc'
where status in ('unknown', 'needs_review');

commit;
