# Stage 0 — Foundation Hardening

This stage turns the initial SoStats scaffold into a safer production-oriented
foundation before feature expansion.

## Scope

The branch deliberately preserves the four deployable boundaries:

```text
apps/web      Next.js + shadcn/ui
apps/api      NestJS + Fastify + Drizzle
apps/ai       FastAPI AI orchestration
apps/worker   BullMQ background workers
```

The goal is not to split SoStats into microservices early. The goal is to make
the boundaries explicit enough that each workload can scale independently when
traffic requires it.

## Security contract

### Authentication

All non-public API routes require a Bearer JWT.

Required claims:

- `sub`
- `email`
- `email_verified=true` by default

Optional validation can be configured with:

- `AUTH_JWT_ISSUER`
- `AUTH_JWT_AUDIENCE`

JWTs currently use HS256. Production deployments must provide an
`AUTH_JWT_SECRET` of at least 32 bytes.

For local development only, `AUTH_DEV_BYPASS=true` accepts
`x-dev-user-email`. The bypass is rejected when `NODE_ENV=production`.

Identity subjects are stored as `issuer|subject` to prevent accidental
cross-issuer collisions.

### Workspace isolation

Tenant-owned controllers are marked with `@WorkspaceScoped()`.

The request must provide `x-workspace-id`; the global workspace guard verifies
that the authenticated user is a member before a controller executes.

Resource services also scope record-level reads and mutations by
`workspace_id`. The header is context, not authorization by itself.

### Secrets

OAuth credentials and other sensitive values use AES-256-GCM authenticated
encryption. There is no production fallback encryption key.

Webhook secrets are encrypted at rest.

Never log OAuth access or refresh tokens.

## Database

PostgreSQL remains the system of record. The branch adds Drizzle configuration
and repeatable scripts so schema changes can be generated and reviewed rather
than edited ad hoc.

Before deploying a schema change:

1. update `src/db/schema.ts`
2. run the Drizzle generation script
3. review the generated SQL
4. run migrations against a disposable/staging database
5. deploy application code only after migration compatibility is confirmed

## Provider boundaries

### Social

`SocialPublisherPort` isolates provider-specific behavior.

LinkedIn is the first concrete adapter. Credentials and the LinkedIn Marketing
API version are configuration, not core-domain concerns.

The API version is intentionally explicit because LinkedIn versions sunset over
time.

### Object storage

`ObjectStoragePort` isolates S3-compatible storage.

The production adapter creates SigV4 pre-signed upload/download URLs and supports
MinIO/S3-compatible deployments. Private buckets return no fake public URL;
consumers must request a signed download URL.

### AI

The AI service exposes a provider-neutral `StructuredGenerationProvider`.

OpenAI is implemented through the Responses API with strict JSON Schema output.
API routes validate the returned JSON again with Pydantic before returning it to
the backend.

The provider can later be replaced without changing campaign or analytics
business flows.

## CI

Pull requests run:

- Node dependency install from the root pnpm lockfile
- TypeScript type checking
- lint
- unit tests
- production builds
- Python dependency installation
- Python bytecode compilation

Stage 0 tests specifically cover authentication token validation, authenticated
encryption, and S3 signing shape in addition to the existing API tests.

## Runtime configuration

The reference contract lives in `infra/.env.example`.

Important production-only values:

- `DATABASE_URL`
- `AUTH_JWT_SECRET`
- `ENCRYPTION_KEY`
- `OPENAI_API_KEY`
- `LINKEDIN_CLIENT_ID`
- `LINKEDIN_CLIENT_SECRET`
- `LINKEDIN_API_VERSION`
- object storage credentials

Do not commit real credentials.

## What Stage 0 does not claim

This branch establishes trustworthy boundaries; it does not claim that the full
product loop is complete.

The next vertical slice should wire real UI state through:

```text
Brand Brain
  -> AI Studio
  -> Campaign
  -> Content Item / Channel Variants
  -> Review
  -> Calendar
  -> Publisher Worker
  -> Provider
  -> Metrics
  -> AI Insight
```

That slice should be implemented with real API contracts rather than additional
page-local mock data.

## Review checklist

- [ ] production auth secret policy is acceptable
- [ ] workspace membership is enforced on every tenant-owned route
- [ ] no secret/token values are returned or logged
- [ ] Drizzle schema changes are reviewed before migration
- [ ] LinkedIn permissions/version match the configured developer application
- [ ] object storage signing works against the target S3-compatible provider
- [ ] AI provider configuration is set in staging
- [ ] CI remains green before merge
