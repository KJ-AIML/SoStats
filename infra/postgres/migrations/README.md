# PostgreSQL migration chain

SoStats SQL forward migrations are applied in numeric order.

Validate repository integrity with:

```bash
pnpm migrations:check
```

Current chain:

```text
001_stage14_workspace_invitations.sql
002_stage14_ownership_rbac.sql
003_stage14_workspace_api_keys.sql
004_stage14_immutable_audit_log.sql
005_stage14_sessions_notifications.sql
006_stage15_transactional_outbox.sql
007_stage15_publication_safety.sql
008_stage15_publication_resolution.sql
```

## Important baseline note

Migrations 001+ were introduced after the original schema already existed.
They are forward deltas, not a full from-zero historical migration set.

Do not claim a fresh empty PostgreSQL database can be fully built from this
directory yet.

Production Hardening will add a canonical baseline/fresh-database bootstrap
gate. Until then, these deltas must be applied to the schema version documented
by the corresponding architecture stage.

## Rules

- Never renumber an applied migration.
- Never edit an already-applied migration to change production behavior.
- Add a new numbered migration for later changes.
- Keep numbering contiguous.
- Deployment must stop if a migration fails.
- Application code that requires a schema delta must not be rolled out before
  the matching migration succeeds.

## 007 rollout (hard sequence — do not reorder)

- [ ] Pause publication dispatch: stop every worker process.
- [ ] Drain: wait for in-flight API executions to finish.
- [ ] Assert zero legacy in-flight work:
      `select count(*) from scheduled_publications where status = 'publishing';` → 0
      `select count(*) from publication_jobs where status in ('processing', 'pending');` → 0
      (If a row cannot drain: verify it on the provider, or run 007 with
      `set sostats.inflight_publications = 'mark_unknown';` in the same session. Never make it retryable.)
- [ ] Apply `007_stage15_publication_safety.sql` (it re-checks the drain and fails loudly).
- [ ] Deploy the API immediately after 007. Until it is live, the old API and
      web app can still reschedule rows that 007 just moved to `needs_review`.
- [ ] Deploy the worker (this resumes dispatch).
- [ ] Deploy the web app.
- [ ] Smoke test: one post to a sandbox channel reaches `published`; its attempt row has a request marker and is `completed`.
- [ ] On smoke failure: stop the worker and roll back the code (worker, then API); keep the schema.

## Roll forward after a rollback (hard sequence — do not reorder)

While the pre-32A code runs against the 007 schema:

- it writes new ambiguous outcomes as `failed`;
- it can reschedule `unknown` / `needs_review` rows back to `scheduled` with a
  stale `active_attempt_id`;
- it re-arms rows without bumping `dispatch_generation`, so a retained queue job
  for that generation can block re-dispatch;
- it leaves in-flight rows in `publishing` without a request marker.

Redeploying the 32A code is therefore not enough. Run every step below, in order.

- [ ] Pause publication dispatch: stop every worker process.
- [ ] Drain exactly as in the 007 rollout: wait for in-flight API executions,
      then assert both counts are 0:
      `select count(*) from scheduled_publications where status = 'publishing';` → 0
      `select count(*) from publication_jobs where status in ('processing', 'pending');` → 0
- [ ] If a `publishing` row cannot drain, handle it exactly like the 007 drain
      rule: verify it on the provider, or mark it `unknown` with the SQL below.
      Never make it retryable. The SQL marks every remaining in-flight row, so
      resolve the rows you verified first.

      ```sql
      begin;
      update scheduled_publications sp
      set status = 'unknown',
          active_attempt_id = coalesce(
            (select j.id from publication_jobs j
             where j.scheduled_publication_id = sp.id and j.status = 'processing'
             order by j.created_at desc, j.id desc limit 1),
            (select j.id from publication_jobs j
             where j.scheduled_publication_id = sp.id
             order by j.created_at desc, j.id desc limit 1)),
          lease_expires_at = null
      where sp.status = 'publishing'
         or (sp.status <> 'published' and exists (
               select 1 from publication_jobs j
               where j.scheduled_publication_id = sp.id and j.status = 'processing'));
      update publication_jobs
      set status = 'unknown',
          provider_request_started_at = coalesce(provider_request_started_at, last_attempt_at, now() at time zone 'utc'),
          completed_at = now() at time zone 'utc',
          error_class = 'unknown_outcome',
          updated_at = now() at time zone 'utc'
      where status = 'processing';
      commit;
      ```

- [ ] Re-run the 007 reclassification. It uses the same predicate as 007 and is
      idempotent:

      ```sql
      update scheduled_publications sp
      set status = 'needs_review'
      where sp.status = 'failed'
        and (
          exists (
            select 1
            from publication_results r
            join publication_jobs j on j.id = r.publication_job_id
            where j.scheduled_publication_id = sp.id
              and r.platform_post_id is not null
          )
          or (
            select r.error_type
            from publication_results r
            join publication_jobs j on j.id = r.publication_job_id
            where j.scheduled_publication_id = sp.id
            order by r.created_at desc, r.id desc
            limit 1
          ) in ('unknown_outcome', 'unexpected_error', 'retry_exhausted')
        );
      ```

- [ ] Give every `scheduled` row a fresh dispatch generation and clear stale
      ownership:
      `update scheduled_publications set dispatch_generation = dispatch_generation + 1, active_attempt_id = null, lease_expires_at = null where status = 'scheduled';`
- [ ] Deploy the API immediately, then the worker (this resumes dispatch), then
      the web app.
- [ ] Smoke test as in the 007 rollout.

## 008 rollout (additive — no drain)

Spec: `docs/architecture/STAGE_15_32B1_RESOLUTION_CORE_SPEC.md` §13.

- [ ] Apply `008_stage15_publication_resolution.sql`. It adds
      `publication_reconciliations` and `scheduled_publications.reconcile_after`,
      and makes every `unknown` / `needs_review` row eligible for one pass. It
      changes no status and writes no history.
- [ ] Never re-run 008 by hand once the API is live: its backfill would re-arm
      `needs_review` rows that already had their one automatic pass.
- [ ] 008 takes an ACCESS EXCLUSIVE lock on `scheduled_publications` plus FK
      locks, with no drain. If it fails on a lock timeout or deadlock it rolls
      back atomically and is safe to retry.
- [ ] Record the baseline before the worker starts reconciling:

      ```sql
      select status, count(*) from scheduled_publications
      where status in ('unknown', 'needs_review') group by status;
      ```

- [ ] Deploy the API promptly after 008. Rows that enter `unknown` through the
      old API in between have no `reconcile_after`; they become due once
      `updated_at` is older than `RECONCILE_GRACE_SECONDS`.
- [ ] Deploy the worker (it calls the new `reconcile-due` route), then the web app.
- [ ] Smoke test:
  - after the first polls, legacy rows that held a post id are `published`;
  - every other ambiguous row carries exactly one `inconclusive` history row;
  - a manager cancels one test `needs_review` row from the calendar.

**Rollback:** roll back the code and keep 008. The old API ignores the new
column and table. Rows that re-enter `unknown` meanwhile have no
`reconcile_after`; the grace fallback recovers them after roll-forward.
