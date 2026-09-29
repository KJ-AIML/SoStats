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
- [ ] Deploy the API.
- [ ] Deploy the worker (this resumes dispatch).
- [ ] Deploy the web app.
- [ ] Smoke test: one post to a sandbox channel reaches `published`; its attempt row has a request marker and is `completed`.
- [ ] On smoke failure: stop the worker and roll back the code (worker, then API); keep the schema.
