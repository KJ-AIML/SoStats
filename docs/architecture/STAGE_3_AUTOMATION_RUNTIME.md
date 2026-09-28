# Stage 3 — Automation Runtime v1

Stage 3 turns the SoStats workflow canvas into a real, persisted execution
runtime.

## Runtime boundary

```text
Automation definition
  -> automation_versions
  -> automation_runs
  -> worker dispatcher
  -> BullMQ automation-runs queue
  -> internal worker-authenticated API
  -> step executor
  -> automation_run_steps
```

The worker owns queue timing, retries and concurrency. The API owns tenant data,
Brand Brain access, campaign generation, approval state, scheduling and analytics.

BullMQ payloads contain only:

- automation run id
- expected next step id

No user auth token, OAuth credential, prompt secret or provider token is written
to Redis.

## Workflow versioning

Every Save creates a new immutable `automation_versions` record.

Publishing marks the latest version published and moves the automation to
`active`. Manual Test Run executes the latest saved version so a draft can be
verified before publishing.

Each run stores the exact `versionId` it started with, so later edits cannot
change an in-flight execution.

## Runtime v1 graph rules

Runtime v1 intentionally accepts a linear directed acyclic workflow:

- exactly one trigger
- trigger is the single root
- no branching
- all nodes connected
- no cycles

Branching, fan-out and conditional routing belong to a later runtime version.
Rejecting those definitions now keeps run semantics deterministic while the
platform is still hardening.

Supported nodes:

- `trigger`
- `generate`
- `review`
- `schedule`
- `analyze`

## Generate

The generate step can create a campaign and send it through the existing
Brand-Brain-aware AI campaign pipeline.

To make retries safe, the step persists a campaign checkpoint before AI content
persistence. When a retry reaches the step again it reuses that campaign and
replaces automation-owned generated campaign content instead of silently adding
duplicates.

Output includes:

- campaign id
- generated content item ids
- generated variant ids

Downstream nodes resolve that output from persisted run-step logs.

## Human review

Review is a real pause state, not a visual-only block.

When execution reaches Review:

1. generated content moves to `in_review`
2. approval request rows are created
3. the step becomes `waiting_approval`
4. the run becomes `waiting_approval`
5. the BullMQ job completes without pretending the workflow finished

Approve:

- content becomes `approved`
- approval requests become approved
- the review step completes
- the run returns to `pending`
- the dispatcher creates a new resume job for the next step

Reject:

- content returns to draft
- approval requests become rejected
- the run becomes failed

The new job identity includes the next step id, so a resumed run does not collide
with the completed pre-approval queue job.

## Schedule

Schedule consumes content ids produced by an earlier step and uses the same
`SchedulingService` as the manual Content board.

The node validates:

- workspace ownership
- connected social account
- provider support
- content review/approval state
- platform variant compatibility

It creates normal `scheduled_publications`, so the reliable Stage 2 publishing
engine takes over from there.

Exact schedule matches are reused during retry to avoid duplicate scheduling.

## Analyze

Analyze calls the existing evidence-based analytics insight service.

It uses persisted metrics plus Brand Brain context. If real analytics data does
not exist, the node fails rather than fabricating an insight.

## Retry and dead-letter behavior

A transient API/AI failure resets the current step and run to `pending`, then
returns a service error to BullMQ.

Default worker policy:

```text
AUTOMATION_DISPATCH_POLL_MS=5000
AUTOMATION_CONCURRENCY=4
AUTOMATION_MAX_ATTEMPTS=5
```

BullMQ applies exponential retry. When retries are exhausted, the worker calls
the internal dead-letter endpoint and persists the failed run/step.

A user can retry a failed run from the UI. Only the failed step is reset; already
completed steps stay completed.

## Product UI

The Automations page now supports:

- create automation
- save immutable versions
- publish workflow
- test run
- persisted run history
- live status polling
- approve & resume
- reject
- retry failed step
- node-specific runtime configuration

## Trigger scope in v1

Manual trigger execution is live in this stage.

The data model already accepts `schedule` and `webhook` trigger types, but the
external trigger schedulers/receivers are intentionally not claimed as complete
yet. Those should be implemented after the execution core is proven, using the
same versioned run creation path rather than a second workflow engine.

## Next stage

The next highest-value runtime work is real analytics ingestion:

```text
published result
  -> analytics queue
  -> provider analytics adapter
  -> metric_snapshots
  -> analytics_daily
  -> AI insight
  -> recommended next content
```

That closes the product loop from automated creation through measured learning.
