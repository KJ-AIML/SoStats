# SoStats

SoStats is an AI Content Automation platform built around a closed content loop:

```text
Create -> Review -> Schedule -> Publish -> Measure -> Learn -> Create Better
```

The repository is a monorepo with intentionally separate runtime boundaries.

## Architecture

```text
                         +----------------------+
                         | Next.js Web          |
                         | shadcn/ui            |
                         +----------+-----------+
                                    |
                                    v
                         +----------------------+
                         | NestJS API           |
                         | application/domain   |
                         +----+-----------+-----+
                              |           |
                              v           v
                         PostgreSQL    Redis / queues
                              |           |
                              |           v
                              |      BullMQ workers
                              |
                              +-----> FastAPI AI service

External systems stay behind adapters:
- social provider adapters
- S3-compatible object storage
- AI model providers
- integration adapters
```

Architecture notes:

- [Implementation plan](docs/architecture/SoStats_Architecture_Implementation_Plan.md)
- [Stage 0 hardening](docs/architecture/STAGE_0_HARDENING.md)
- [Stage 1 real-data vertical slice](docs/architecture/STAGE_1_VERTICAL_SLICE.md)
- [Stage 2 reliable publishing](docs/architecture/STAGE_2_RELIABLE_PUBLISHING.md)
- [Stage 3 automation runtime](docs/architecture/STAGE_3_AUTOMATION_RUNTIME.md)
- [Stage 4 real analytics ingestion](docs/architecture/STAGE_4_REAL_ANALYTICS.md)
- [Stage 5 closed AI learning loop](docs/architecture/STAGE_5_CLOSED_AI_LOOP.md)
- [Stage 6 real media processing](docs/architecture/STAGE_6_REAL_MEDIA.md)
- [Stage 7 X provider + secure OAuth](docs/architecture/STAGE_7_X_PROVIDER.md)
- [Stage 8 external RSS automation trigger](docs/architecture/STAGE_8_RSS_TRIGGER.md)
- [Stage 9 signed webhook / WordPress trigger](docs/architecture/STAGE_9_SIGNED_WEBHOOK_TRIGGER.md)
- [Stage 10 Brand Brain knowledge RAG](docs/architecture/STAGE_10_BRAND_BRAIN_RAG.md)
- [Stage 11 private document knowledge pipeline](docs/architecture/STAGE_11_PRIVATE_KNOWLEDGE_DOCUMENTS.md)
- [Stage 12 product UI completion: real Home dashboard](docs/architecture/STAGE_12_PRODUCT_UI_HOME.md)
- [Stage 12 product UI completion: AI Studio](docs/architecture/STAGE_12_PRODUCT_UI_AI_STUDIO.md)
- [Stage 12 product UI completion: Content workspace](docs/architecture/STAGE_12_PRODUCT_UI_CONTENT.md)
- [Stage 12 product UI completion: Calendar](docs/architecture/STAGE_12_PRODUCT_UI_CALENDAR.md)
- [Stage 12 product UI completion: Automations](docs/architecture/STAGE_12_PRODUCT_UI_AUTOMATIONS.md)
- [Stage 12 product UI completion: Analytics](docs/architecture/STAGE_12_PRODUCT_UI_ANALYTICS.md)
- [Stage 12 product UI completion: Media](docs/architecture/STAGE_12_PRODUCT_UI_MEDIA.md)
- [Stage 12 product UI completion: Channels](docs/architecture/STAGE_12_PRODUCT_UI_CHANNELS.md)
- [Stage 12 product UI completion: Brand Brain](docs/architecture/STAGE_12_PRODUCT_UI_BRAND_BRAIN.md)
- [Stage 12 product UI completion: Integrations](docs/architecture/STAGE_12_PRODUCT_UI_INTEGRATIONS.md)
- [Stage 12 product UI completion: Settings](docs/architecture/STAGE_12_PRODUCT_UI_SETTINGS.md)
- [Stage 13 Meta / Instagram provider expansion](docs/architecture/STAGE_13_META_INSTAGRAM_PROVIDER.md)
- [Stage 14 Identity/Admin: workspace invitations](docs/architecture/STAGE_14_WORKSPACE_INVITATIONS.md)
- [Stage 14 Identity/Admin: ownership transfer + RBAC](docs/architecture/STAGE_14_OWNERSHIP_RBAC.md)
- [Stage 14 Identity/Admin: workspace API keys](docs/architecture/STAGE_14_WORKSPACE_API_KEYS.md)
- [Stage 14 Identity/Admin: immutable audit log](docs/architecture/STAGE_14_IMMUTABLE_AUDIT_LOG.md)
- [Stage 14 Identity/Admin: sessions + notification administration](docs/architecture/STAGE_14_SESSIONS_NOTIFICATIONS.md)

## Repository layout

- `apps/web` — Next.js product UI
- `apps/api` — NestJS/Fastify application API
- `apps/ai` — FastAPI AI orchestration
- `apps/worker` — BullMQ background jobs
- `infra` — local infrastructure
- `docs` — architecture and implementation plans

## Local infrastructure

```bash
cp infra/.env.example .env
docker compose --env-file .env -f infra/docker-compose.yml up -d
```

This starts PostgreSQL + pgvector, Redis, MinIO, an idempotent private-bucket
initializer, and Mailpit.

## Node services

Install once from the repository root:

```bash
corepack enable
pnpm install
```

Run the API and web app in separate terminals:

```bash
pnpm dev:api
pnpm dev:web
```

For local web-to-API wiring, copy `apps/web/.env.example` to
`apps/web/.env.local`. The browser talks to a same-origin Next.js BFF;
backend auth credentials stay on the server.

Build the worker before starting it:

```bash
pnpm --filter worker build
pnpm dev:worker
```

The API and worker must share the same independent `WORKER_API_TOKEN`. The
worker uses `SOSTATS_API_URL` to call internal publishing, automation and
analytics execution boundaries. Redis jobs carry stable ids/version tokens,
never OAuth credentials or browser auth tokens.

## AI service

```bash
cd apps/ai
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Configure `OPENAI_API_KEY` and `AI_MODEL` before calling generation routes.

## Verification

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

GitHub Actions runs the same Node checks plus a Python service compile check on
every pull request.

## Security

Do not commit real environment files or credentials.

Production deployments must configure strong authentication/encryption secrets,
must use an independent strong `WORKER_API_TOKEN`, and must not enable
`AUTH_DEV_BYPASS`.
