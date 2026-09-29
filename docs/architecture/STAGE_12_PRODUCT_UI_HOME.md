# Stage 12 — Product UI Completion: Real Home Dashboard

Stage 12 shifts SoStats from backend-heavy vertical slices into end-user product
completion. The first slice is the workspace Home dashboard.

## Goal

Home must be a read-model over real product state. It must not invent activity,
performance, schedules, or trends.

The dashboard now aggregates the existing workspace snapshot:

- content lifecycle
- scheduled publications
- publication results reflected through schedule state
- analytics rollups
- AI insights
- automation runs
- campaigns
- connected channels
- media assets
- Brand Brain knowledge sources

No new source-of-truth tables are introduced.

## Product rules

1. Home owns no domain data.
2. KPI values must come from persisted workspace state.
3. Trend visualizations must use persisted distributions or analytics samples.
4. Missing metrics render an explicit empty state instead of synthetic bars.
5. Upcoming publication counts are not limited by the four-item preview.
6. Automation activity prioritizes persisted runs; configured workflows are only
   used as a fallback when no run exists.
7. Analytics remains the canonical source for provider performance.

## Dashboard sections

### Command center

The command surface keeps the primary path visible:

```text
Brand Brain
    ↓
AI Studio
    ↓
Campaign / Content
    ↓
Review
    ↓
Schedule / Publish
```

The workspace engine summary uses real active campaigns, review state, and
upcoming publications.

### KPI strip

The dashboard exposes:

- Content Items
- Upcoming Publications
- Published Posts
- 30-day provider performance

Mini-bars are now derived from live data:

- content lifecycle distribution
- next-six-day publication distribution
- recent publishing cadence
- recent analytics daily values

When a trend is unavailable the UI says so instead of rendering a decorative
fake trend.

### Content pipeline

Uses canonical content lifecycle state:

```text
Draft → Review → Scheduled → Published
```

### AI insight loop

Surfaces the latest persisted recommendation or the analytics data state.

### Automation activity

Shows recent persisted automation runs across workflows. If no run exists yet,
the dashboard falls back to saved workflow configuration.

### Upcoming content

Shows scheduled publication state ordered by scheduled time and limits the visual
preview to four items. The KPI count remains the complete scheduled queue.

### Connected channels

Shows real provider connection state.

### Performance pulse

Uses the existing 30-day analytics read model. The primary display metric is
selected from available provider metrics, preferring:

```text
impressions
reach
views
engagements
engagement
clicks
likes
shares
reposts
```

If none of these exist, the first numeric metric returned by analytics is used.

### Operating health

Summarizes real active product surfaces:

- active social channels
- active automations
- usable Brand Brain knowledge sources
- ready media assets

### Recent campaigns

Uses the existing campaign list, which is already ordered newest-first by the
API, and shows persisted content/channel counts.

### Latest assets

Shows media processing state and available dimensions without exposing private
object storage credentials.

## Data flow

```text
Next.js Home
    ↓
loadWorkspaceSnapshot()
    ↓
NestJS workspace-scoped APIs
    ├─ campaigns
    ├─ content
    ├─ calendar
    ├─ analytics
    ├─ insights
    ├─ channels
    ├─ automations
    ├─ assets
    └─ knowledge
```

The web server remains the authenticated boundary. Browser-visible components
do not receive backend auth credentials.

## Scope intentionally not included

This slice does not add:

- a new dashboard API/table
- synthetic KPI generation
- billing / upgrade UI
- additional providers
- notification center
- user/team management
- historical dashboard caching

Those remain separate product/hardening stages.

## Verification

Required pull-request verification remains:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

The Python compile/test jobs remain part of repository CI even though this stage
is primarily web UI.

## Next product slice

Continue Stage 12 page-by-page with the same rule: improve UX around existing
real domain behavior before adding another infrastructure subsystem.

Recommended order:

```text
Home
  ↓
AI Studio
  ↓
Content
  ↓
Calendar
  ↓
Automations
  ↓
Analytics
  ↓
Media / Channels / Brand Brain
  ↓
Integrations / Settings
```
