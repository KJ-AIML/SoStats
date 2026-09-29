# Stage 12 — Product UI Completion: Content Workspace

Stage 12 continues the product-completion pass by turning Content into the real
lifecycle workspace between AI generation and publishing.

## Goal

The Content surface is the operational handoff between AI Studio and Calendar:

```text
AI Studio / Manual Idea
        ↓
      Draft
        ↓
      Review
        ↓
     Approved
        ↓
      Schedule
        ↓
 Publishing Worker
        ↓
     Published
```

The UI must not let a user manually fake scheduling or publication state.

## Lifecycle ownership

### User-controlled states

The Content API accepts manual transitions only to:

- `idea`
- `draft`
- `in_review`
- `approved`
- `archived`

### Scheduling-controlled state

`scheduled` is created by SchedulingService after a valid schedule is persisted.

Scheduling still requires content to be `in_review` or `approved`.

### Publishing-controlled state

`published` is written by the publishing execution path after provider success.

Scheduled and published content cannot be moved manually from Content.

## Real content editing

Content now exposes real update contracts:

```text
PATCH /v1/content/:id
PATCH /v1/content/:id/status
PATCH /v1/content/:id/variants/:variantId
```

Canonical title/description edits are supported before scheduling.

Platform-variant edits are supported before scheduling and preserve the previous
copy in `content_versions`.

If copy changes after content entered review or was approved, the content item is
reset to `draft`. This prevents stale approval from surviving a material edit.

## Manual content creation

The workspace can create a real manual idea or draft through:

```text
POST /v1/content
```

Manual creation supports:

- title
- canonical description/fallback copy
- optional Brand Brain association
- initial `idea` or `draft` state

Platform variants are not fabricated. Model-backed channel variants remain an AI
Studio responsibility.

## No fake repurposing

The previous repurpose endpoint created placeholder strings such as "Draft content
for X based on ...".

That behavior is intentionally disabled. Until repurposing is backed by the AI
generation service and persisted provenance, the API returns a clear error and the
Content UI does not advertise it as a working capability.

## Product workspace

The Content workspace now includes functional:

- full-text-style client filtering over loaded content
- lifecycle-stage filter
- campaign filter
- channel filter
- board view
- list view
- manual idea/draft creation
- detail review
- canonical copy editing
- platform variant editing
- approval controls
- scheduling
- real schedule visibility

## Drag-and-drop rules

Drag-and-drop remains a fast lifecycle control, but follows domain ownership:

```text
Ideas  → Drafts
Drafts → Ideas / Review
Review → Drafts / Scheduled
```

Dropping reviewed content into Scheduled opens the real scheduling dialog rather
than directly changing a status field.

Published is never a manual drop target.

Scheduled and Published cards are not draggable.

## Scheduling behavior

The scheduling dialog uses active provider-backed social accounts.

When the selected channel has a matching platform variant, the schedule stores its
variant id.

When no matching variant exists, the publication pipeline falls back to canonical
description/title exactly as PublishingService already supports.

The UI reports that fallback explicitly instead of pretending a platform variant
exists.

## Content review

The detail surface distinguishes:

- canonical content
- persisted channel variants
- lifecycle state
- campaign relationship
- schedule records

Review actions use persisted API transitions:

```text
idea      → draft
draft     → in_review
in_review → approved
in_review → draft
approved  → schedule
```

Copy edits after `in_review` or `approved` reset the item to `draft`.

## Data boundaries

```text
Next.js Content Workspace
       ↓
same-origin BFF
       ↓
NestJS ContentService
       ├─ content_items
       ├─ content_variants
       └─ content_versions

Scheduling action
       ↓
SchedulingService
       ↓
scheduled_publications
       ↓
BullMQ publishing worker
       ↓
provider adapter
```

Content remains the editing/review owner. Calendar remains the publication-time
owner. Publishing remains the external side-effect owner.

## Intentionally not included

This slice does not add:

- fake AI rewrite buttons
- fake repurpose output
- direct manual Published status
- provider publishing inside the browser
- collaborative comments
- approval-request assignee workflows
- asset attachment editing
- bulk operations
- server-side search pagination

Those should be added only with real contracts behind them.

## Verification

Required pull-request verification remains:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

The Python checks remain required by repository CI.

## Next Stage 12 slice

After Content, the next product-completion slice is Calendar.

The goal is to make Calendar reflect the full publication lifecycle and provide
real channel/status filtering without duplicating scheduling ownership.
