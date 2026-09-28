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
- [Stage 2 reliable publishing](docs/architecture/STAGE_2_RELIABLE_PUBLISHING.md)\n- [Stage 3 automation runtime](docs/architecture/STAGE_3_AUTOMATION_RUNTIME.md)

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

This starts PostgreSQL + pgvector, Redis, MinIO, and Mailpit.

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
worker uses `SOSTATS_API_URL` to call the internal publication execution
boundary and never receives OAuth access tokens in BullMQ jobs.

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
