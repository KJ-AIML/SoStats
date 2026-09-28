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

See [the architecture plan](docs/architecture/SoStats_Architecture_Implementation_Plan.md)
and [Stage 0 hardening notes](docs/architecture/STAGE_0_HARDENING.md).

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

Build the worker before starting it:

```bash
pnpm --filter worker build
pnpm dev:worker
```

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

Production deployments must configure strong authentication/encryption secrets
and must not enable `AUTH_DEV_BYPASS`.
