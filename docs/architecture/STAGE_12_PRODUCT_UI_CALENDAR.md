# Stage 12 — Product UI Completion: Calendar

Stage 12 continues the product-completion pass by turning Calendar into the
publishing command center for persisted schedules and provider outcomes.

## Goal

Calendar owns publication timing and lifecycle visibility.

It does not own content editing and it does not directly publish to providers.

```text
Content Review
    ↓
Approved
    ↓
SchedulingService
    ↓
scheduled_publications
    ↓
BullMQ publishing worker
    ↓
Provider adapter
    ↓
publication_results
    ↓
Calendar + Analytics
```

## Views

Calendar now supports:

- Month
- Week
- Day

All views render the same persisted schedule records and provider lifecycle.

Month is optimized for coverage.

Week is optimized for channel cadence.

Day is optimized for execution detail.

## Filters

Calendar includes functional:

- channel filter
- publication-state filter
- clear filters

Available values come from real schedule data rather than a static provider list.

## Workspace timezone

Calendar displays schedule dates and times in the workspace timezone.

The reschedule form also interprets the selected wall-clock date/time in that
workspace timezone before sending an ISO timestamp to the API.

## Publication states

Calendar renders persisted states including:

- scheduled
- publishing
- published
- failed
- cancelled

Published records can expose the confirmed provider post URL and platform post
id from `publication_results`.

Failed records expose the latest persisted error type/message.

Historical failed results are not shown as the current failure after a schedule
has been rescheduled successfully.

## Rescheduling

A scheduled or failed publication can be moved to a new time.

Rescheduling:

1. updates `scheduled_publications.scheduled_at`
2. restores schedule state to `scheduled`
3. updates `updated_at`, which changes the worker version token
4. keeps the content item in `scheduled`
5. keeps a selected content variant in `scheduled`

Old queue work carrying the previous version becomes stale and cannot execute.

## Failed publication retry

Retry is implemented as a real reschedule.

Calendar does not create a fake client-only retry state.

The operator chooses a new publish time and the existing schedule gets a new
version through its updated timestamp.

## Cancellation

Cancellation is allowed only when the publication is not already:

- publishing
- published
- cancelled

A publication already claimed by a worker cannot be cancelled or rescheduled,
which avoids a race with an external provider side effect.

After cancellation, SchedulingService reconciles the parent content lifecycle.

For the content item:

- any active sibling schedule → `scheduled`
- no active sibling, but at least one published sibling → `published`
- otherwise → `in_review`

For a selected channel variant:

- any active sibling schedule → `scheduled`
- any published sibling → `published`
- otherwise → `draft`

This prevents cancelled schedules from leaving content permanently stranded in
`scheduled`.

## Calendar read model

The scheduling query now loads:

- content item
- campaign
- selected variant
- social account
- publication jobs
- publication results

The web read model derives:

- campaign label
- provider/account
- variant label/copy
- total execution attempts
- current failure details
- confirmed provider result

No new Calendar source-of-truth table is introduced.

## Product boundaries

### Content owns

- canonical title/description
- variant copy
- review/approval

### Calendar owns

- publication time
- schedule cancellation
- publication lifecycle visibility

### Publishing owns

- external provider side effects
- publication success/failure
- final Published transition

## Intentionally not included

This slice does not add:

- browser-side provider publishing
- content editing inside Calendar
- fake drag-to-publish
- duplicate calendar event storage
- recurring schedules
- bulk rescheduling
- cross-workspace calendar aggregation

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

After Calendar, continue product completion with Automations.

The focus should be the real persisted runtime:

```text
Trigger
  ↓
Published workflow version
  ↓
Automation run
  ↓
Run steps
  ↓
Domain actions
```

The UI should expose that runtime truth instead of decorative workflow controls.
