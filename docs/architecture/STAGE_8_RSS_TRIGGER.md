# Stage 8 — External RSS Automation Trigger

Stage 8 makes the Automation Runtime respond to external content events.

The first external source is RSS / Atom because it provides a deterministic,
provider-neutral event stream that can exercise the whole SoStats pipeline
without introducing a second workflow engine.

## End-to-end flow

```text
Public RSS / Atom feed
  -> RSS dispatcher
  -> BullMQ rss-triggers queue
  -> leased feed poll
  -> deduplicated trigger event
  -> published Automation Version
  -> automation_run
  -> Trigger
  -> AI Generate
  -> Human Review
  -> Schedule
  -> LinkedIn / X
  -> Metrics
  -> AI Learning Loop
```

External events create the same `automation_runs` and
`automation_run_steps` used by manual execution.

There is no RSS-specific execution engine after the trigger boundary.

## Published-version semantics

Manual Test Run continues to use the latest saved draft so a workflow can be
tested before publication.

External RSS events are different: they execute only the latest version that has
actually been published.

This prevents an unfinished builder edit from changing a live external
automation.

Every generated run permanently references its exact `versionId`.

## Trigger persistence

Stage 8 adds:

### automation_triggers

Stores the live source state:

- automation id
- source type
- source config
- active / paused / error status
- poll lease token / expiry
- next poll time
- last poll time
- last successful trigger time
- last source error

### automation_trigger_events

Stores observed external items:

- trigger id
- automation id
- deterministic event key
- external item id
- sanitized event payload
- generated run id, when applicable

`trigger_id + event_key` is unique, and the event key includes the feed URL
plus the external item id. Repeatedly fetching the same feed item therefore
cannot create duplicate automation runs.

If a published workflow changes to a different feed URL, SoStats resets the
source's first-sync state. The new feed gets its own baseline/latest behavior
instead of being treated as a continuation of the previous feed.

## First-sync policy

RSS feeds normally contain historical items. Running an automation for all of
them immediately after connection is usually undesirable.

The builder supports:

### Baseline existing items

Default.

The first successful poll records the current feed items as seen but creates no
runs. Only genuinely new items on later polls trigger the workflow.

### Trigger latest item

The first poll records the current feed and creates one run for the newest item.

This is useful when a user wants to verify a live source immediately.

## Polling and leases

The worker periodically asks the internal API for due RSS sources.

Each source is claimed with a random lease token before network I/O.

```text
dispatch
  -> claim lease
  -> fetch / parse
  -> complete with same lease
```

BullMQ retries preserve the lease token in job data.

If an old worker overlaps a replacement worker, only the current valid lease can
complete the source poll.

After retry exhaustion, the trigger is persisted in `error` state. The
Automation UI exposes **Retry source**, which clears the error and schedules an
immediate new poll.

## SSRF boundary

Feed URLs are user-configurable, so they are treated as untrusted network input.

Runtime v1:

- permits only HTTP / HTTPS
- rejects embedded credentials
- permits only standard HTTP(S) ports
- rejects localhost / local / internal hostnames
- resolves DNS before connecting
- rejects private, loopback, link-local, multicast, documentation and other
  non-public addresses
- rejects hosts whose DNS result set includes a non-public address
- pins the HTTP/TLS connection to the validated resolved address
- revalidates every redirect target
- limits redirects
- caps response size
- applies a network timeout

The worker therefore does not perform a normal unrestricted `fetch(feedUrl)`.

## Feed parsing

Runtime v1 supports common RSS 2.0 and Atom structures without evaluating XML
external entities.

Captured event evidence includes:

- stable id / guid
- title
- canonical link
- publication timestamp
- summary / description
- feed title and feed URL

Payload sizes are bounded before persistence.

## AI source grounding

The Trigger step persists the RSS event payload.

When a downstream **AI Generate** step creates its campaign, source title,
summary, URL, publication time and feed identity are placed into the campaign
context supplied to Brand Brain-aware generation.

This means an automation such as:

```text
New blog article
  -> Generate LinkedIn + X campaign
  -> Human Review
  -> Schedule
```

is actually grounded in the new article event rather than merely using the RSS
event as a wake-up signal.

## UI

The trigger block now supports:

- Manual
- RSS / Atom
- feed URL
- poll interval from 5 minutes to daily
- first-sync baseline/latest behavior

For a published RSS automation the workspace shows:

- source status
- feed URL
- last poll
- last triggered event
- persisted error
- Retry source

## Operational settings

```text
RSS_TRIGGER_DISPATCH_POLL_MS=15000
RSS_TRIGGER_CONCURRENCY=3
RSS_TRIGGER_MAX_ATTEMPTS=4
```

The per-feed polling interval remains part of the immutable published workflow
definition and is copied into live trigger state when Publish is pressed.

## Database rollout

This stage adds:

- `automation_triggers`
- `automation_trigger_events`

Before deploying against an existing database:

```bash
pnpm --filter api db:generate
pnpm --filter api db:migrate
```

Review the generated migration before production rollout.

## Current scope

Stage 8 intentionally implements RSS/Atom first.

WordPress can now be added as a second **external trigger adapter** that creates
the same deduplicated trigger events and versioned runs. It should not create a
new workflow execution path.

## Next stage

The strongest next source expansion is a signed inbound webhook / WordPress
trigger:

```text
WordPress publish webhook
  -> signature verification
  -> deduplicated trigger event
  -> same Automation Runtime
```

After that, Brand Brain document/URL RAG becomes the largest remaining product
capability gap.
