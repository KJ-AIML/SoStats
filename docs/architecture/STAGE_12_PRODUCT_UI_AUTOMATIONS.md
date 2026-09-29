# Stage 12 — Product UI Completion: Automations

Stage 12 continues the product-completion pass by aligning the Automations UI
with the real persisted runtime already present in SoStats.

## Goal

Automations must expose runtime truth rather than decorative workflow controls.

```text
Trigger
  ↓
Immutable workflow version
  ↓
Automation run
  ↓
Persisted run steps
  ↓
Domain actions
  ↓
Result / Error / Human decision
```

## Runtime surfaces

The workspace now exposes:

- active workflow count
- recent waiting approvals
- recent failed runs
- external trigger errors
- latest saved version
- latest published version
- automation status
- trigger health
- persisted run history
- step-level execution inspector

The dashboard values come from persisted automation/run/trigger state.

## Saved vs published versions

The UI distinguishes the latest saved version from the latest published version.

Manual Test Run continues to execute the latest saved version so a draft can be
validated before publication.

RSS and webhook triggers continue to resolve the latest published version.

Each run keeps its immutable `versionId`, so later builder edits cannot mutate
an in-flight or historical run.

## Run inspector

Run history can now be opened into a detailed inspector.

The inspector shows:

- run state
- workflow version
- started/completed timestamps
- run-level error
- ordered run steps
- step state
- step timestamps
- persisted step error
- persisted step log JSON

This is the actual `automation_runs` / `automation_run_steps` state. The UI
does not fabricate an execution trace.

Step logs may contain:

- trigger payload
- retry checkpoint
- runtime output
- human decision
- review notes

Webhook signing secrets are not part of run logs.

## Brand Brain and provider-aware AI nodes

Generate nodes now select:

- Brand Brain context
- real provider adapters returned by ProviderRegistry
- goal
- audience

Analyze nodes can also select Brand Brain context.

The Generate channel field is no longer free text. Unsupported providers such as
a provider with no installed adapter are not offered by the UI.

The API also validates configured generation providers while creating, saving,
and publishing workflow versions. Bypassing the browser cannot persist a
configured provider that lacks a text-capable adapter.

## Publishing account boundary

Generate provider selection and publishing-account selection remain separate.

```text
Provider adapter supported
        ≠
OAuth account connected
```

A Generate node can create platform variants for a supported provider.

A Schedule node still requires an active connected social account and uses the
normal SchedulingService boundary.

## Pause and resume

An active automation can now be paused.

Pause:

1. marks the automation `paused`
2. pauses its persisted external trigger
3. clears RSS processing lease state
4. removes the next RSS poll time
5. preserves webhook endpoint/config/signing credential state

This stops future RSS/webhook-triggered runs without pretending that an already
running automation run can be suspended mid-side-effect.

Existing in-flight runs are not force-stopped.

Resume is intentionally explicit: save/publish the workflow again. Publishing
reactivates the trigger using the latest immutable workflow version.

## External trigger status

RSS surfaces include:

- status
- feed URL
- last poll
- last trigger
- last error
- explicit retry after trigger failure

Webhook surfaces include:

- status
- source/event name
- endpoint
- last delivery
- last trigger
- one-time signing-secret reveal
- explicit secret rotation

Secrets remain encrypted at rest and are not returned during normal reads.

## Bounded workspace summary

The top-level automation list now loads only the most recent run summaries per
automation instead of an unbounded run/step history.

The dedicated run endpoint remains the full operational history boundary used by
the selected automation workspace.

## Runtime v1 constraints remain

This product pass does not change workflow execution semantics.

Runtime v1 remains:

- exactly one trigger
- one linear connected path
- no branching/fan-out
- no cycles
- deterministic ordered execution

Supported node kinds remain:

- trigger
- generate
- review
- schedule
- analyze

## Intentionally not included

This slice does not add:

- fake branch/condition nodes
- fake provider adapters
- browser-side queue execution
- force-cancellation of an in-flight provider side effect
- arbitrary secret display after initial reveal
- a second automation execution engine

## Verification

Required pull-request verification remains:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

The existing Python compile/test job remains required by repository CI.

## Next Stage 12 slice

After Automations, continue product completion with Analytics.

The next goal is to make the analytics surface clearly show:

```text
Published provider result
  ↓
metric snapshots
  ↓
daily rollups
  ↓
performance views
  ↓
AI insight / recommended action
```

without displaying synthetic metrics when provider data does not exist.
