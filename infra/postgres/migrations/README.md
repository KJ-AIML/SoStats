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
