# Stage 1 — Real Product Vertical Slice

Stage 1 connects the redesigned SoStats product surface to real backend contracts.

## User loop now wired

```text
Brand Brain
  -> AI Studio
  -> Campaign
  -> Content Items + Channel Variants
  -> Human Review Status
  -> Scheduling
  -> Calendar

Analytics Daily
  -> Analytics Overview
  -> AI Insight Engine
  -> Evidence-based Recommendation
```

The web application no longer needs to send backend credentials from browser code.
A server-side Next.js BFF resolves the workspace, attaches authentication and tenant
headers, then calls the NestJS API.

## Brand Brain -> AI generation

Brand context is assembled in one backend service and includes:

- brand identity
- voice profiles
- audiences
- products
- content pillars
- brand rules

Campaign generation sends this structured context to the AI service. The returned
plan is validated by the AI service and then persisted by NestJS as:

- campaign
- campaign channels
- campaign pillars
- content items
- content variants

The UI consumes the persisted result rather than keeping generated content only in
page-local state.

## Content review and scheduling

The Content board loads real workspace content. Dragging cards between review
states persists the status through the BFF.

Moving content into Scheduled is intentionally different:

1. SoStats asks for a connected social account and publishing time.
2. The scheduling API validates content ownership, variant ownership and channel
   ownership.
3. A `scheduled_publications` record is created.
4. The content item is moved to `scheduled`.
5. The Calendar reads the same persisted schedule.

The UI does not allow manually dragging content into Published. Publication must
come from the publishing execution boundary.

## Analytics -> AI insight

Analytics uses persisted `analytics_daily` rows.

The API converts only numeric observed metrics into the AI insight request and
adds Brand Brain context. The AI service is instructed not to invent metrics and
returns structured findings, recommendations and impact wording.

No AI insight is generated when there is no analytics evidence.

## Web BFF contract

Server-only environment:

```text
SOSTATS_API_URL=http://localhost:4000
SOSTATS_API_TOKEN=                # production/session-provided bearer token
SOSTATS_DEV_EMAIL=dev@sostats.local
SOSTATS_DEV_NAME=SoStats Dev
SOSTATS_DEV_AUTO_WORKSPACE=true
```

Development can use the API's explicit dev bypass. Production requires a bearer
token and never falls back to the development identity.

## Current boundary that remains

The scheduling record and UI flow are real, but the current worker publishing
processor is still the earlier mock BullMQ implementation. It does not yet claim
production publication semantics or persistence of provider results.

The next hardening slice should:

1. introduce a publication queue port in the API
2. enqueue scheduled publications with stable idempotency keys
3. have the worker resolve the correct provider adapter
4. persist publication jobs/results
5. update content/schedule state only from confirmed provider outcomes
6. add retry/backoff and dead-letter behavior without random simulated failures

That work should keep provider code behind adapters and preserve the current
tenant/security boundary.
