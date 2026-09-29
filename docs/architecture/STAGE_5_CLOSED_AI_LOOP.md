# Stage 5 — Closed AI Learning Loop

Stage 5 turns analytics from a reporting surface into a controlled product
feedback loop.

## Product loop

```text
Publish
  -> Provider Metrics
  -> Metric Snapshots
  -> Daily Rollups
  -> Evidence-backed AI Insight
  -> User-approved Domain Action
  -> Campaign / Repurpose / Schedule Change
  -> Review / Publish
  -> Measure again
```

The AI never writes directly into product state. It proposes an action, the API
validates that proposal against real workspace evidence, and a user explicitly
applies it.

## Persistent recommendation model

`ai_insights` stores:

- workspace / brand
- generation id
- finding
- concrete evidence statements
- evidence snapshot used for generation
- recommendation
- qualitative impact estimate
- confidence
- normalized action type and payload
- execution status / result / error
- execution timestamp

Recommendation lifecycle:

```text
pending
  -> executing
  -> executed

pending / failed / informational
  -> dismissed

older pending recommendations
  -> superseded
```

A new recommendation generation supersedes older still-pending advice so users
do not accidentally execute stale actions against a changed content calendar.

## Evidence contract

The AI receives only bounded workspace evidence:

- rolling 30-day provider metrics
- up to 20 observed content-performance records
- upcoming schedules for the next 14 days
- currently connected channels
- Brand Brain context

Each actionable recommendation must cite evidence from this payload.

The API does not trust ids returned by the model.

It verifies:

- repurpose source ids exist in observed content performance
- schedule ids exist in upcoming schedules
- schedule timestamps are valid future timestamps within 60 days
- target platforms are connected workspace channels

An invalid AI action is downgraded to an informational insight with no executable
domain action.

## Supported actions

### Create campaign

```text
Insight
  -> Campaign checkpoint
  -> Brand-aware AI generation
  -> Content Items + Variants
  -> Content board
```

The campaign id is checkpointed before generation completes. If generation fails,
retry reuses the same campaign and replaces generated campaign content rather
than creating duplicate campaigns.

### Repurpose observed content

The model may reference only a `content_item_id` included in the performance
evidence.

Execution creates a new campaign seeded with:

- source title / description
- observed recommendation
- source brand
- validated target channels

It then runs through the same Brand-Brain-aware campaign generator. This keeps
repurposing inside the normal content lifecycle instead of bypassing review.

### Reschedule publication

The model may reference only a currently upcoming `scheduled_publications`
record.

The suggested time must be:

- valid ISO date/time
- in the future
- no more than 60 days ahead

Execution uses `SchedulingService.updateSchedule`, so the same stale-job
protection from the publishing engine applies automatically.

## Human agency

The model proposes; the user decides.

The UI exposes:

- finding
- concrete evidence
- confidence
- recommendation
- expected qualitative impact
- explicit Apply action control
- Dismiss
- execution result / retry state

No recommendation executes automatically from analytics generation.

## Automation integration

The Automation `Analyze` node now calls the same persisted recommendation
engine.

That means a workflow can produce analytics recommendations, but subsequent
domain actions remain separately controlled unless a future automation policy
explicitly defines how approval should work.

## Dashboard

The Home dashboard reads the latest persisted recommendation and links users to
Analytics for review instead of showing a static mock insight.

## Database rollout

This stage adds the `ai_insights` table to the Drizzle schema.

Before deployment, generate and review the database migration for the target
environment:

```bash
pnpm --filter api db:generate
pnpm --filter api db:migrate
```

Production migration review is required before deploying the API version that
reads `ai_insights`.

## Next stage

The next large gaps are no longer in the core loop.

Highest-value follow-ons are:

1. real Media processing worker
2. second social provider adapter
3. real RSS / WordPress triggers feeding Automation Runtime
4. Brand Brain document / URL RAG with pgvector
5. E2E / observability / load hardening

The core SoStats loop is now structurally complete:

```text
Create -> Review -> Schedule -> Publish -> Measure -> Learn -> Act -> Create Better
```
