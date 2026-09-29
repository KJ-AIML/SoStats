# Stage 12 — Product UI Completion: Analytics

Stage 12 continues the product-completion pass by turning Analytics into a
truthful operational performance surface over provider-synced metrics.

## Goal

Analytics must distinguish:

- observed provider metrics
- publication lifecycle records
- snapshot freshness
- AI interpretation

It must not manufacture chart data when provider evidence does not exist.

```text
Published provider result
  ↓
analytics worker
  ↓
metric_snapshots
  ↓
analytics_daily deltas
  ↓
workspace/channel/content read model
  ↓
AI evidence → recommendation → approved action
```

## Time ranges

The overview supports real query-backed display windows:

- 7 days
- 30 days
- 90 days

The selected window is applied server-side to `analytics_daily` and publication
lifecycle records.

The active provider collection policy still stops refreshing an individual post
after 30 days. Historical daily rows remain queryable after collection stops.

## Channel filter

The overview exposes analytics-capable providers from the workspace accounts.

Selecting a channel filters:

- daily metric totals
- trend data
- tracked post snapshots
- channel breakdown
- top measured content
- published publication count

Unsupported arbitrary channel values are rejected by the API.

## KPI truth

The KPI cards use persisted data only:

- Reach / Views
- Engagement Rate
- Clicks
- Published Posts

Reach, engagement and clicks come from provider daily deltas.

Published Posts comes from persisted `scheduled_publications` with
`status=published` in the selected window.

When provider metrics do not exist, metric values display as unavailable rather
than implying a measured zero.

## Real sparklines

The old hard-coded sparkline arrays were removed.

Reach, engagement-rate and click mini charts are normalized from the selected
window's real `analytics_daily` rows.

No trend is rendered when no provider evidence exists.

## Performance trend

The main chart renders daily reach/views deltas from the selected API window.

Negative provider correction deltas remain part of aggregate totals. Visual bar
height is floored at zero because a negative cumulative bar height is not a
meaningful display primitive.

## Snapshot freshness

The read model exposes:

- latest workspace/filter snapshot
- tracked post count
- per-provider latest snapshot
- per-provider tracked posts

The UI surfaces relative freshness so operators can distinguish current metrics
from stale provider data.

## Channel breakdown

Channel performance is aggregated from persisted daily deltas.

Each provider row can show:

- account names/count
- reach/views
- engagement rate
- tracked posts
- latest snapshot freshness

Providers with no persisted metric/snapshot evidence are not presented as
zero-performing channels.

## Top measured content

The overview loads a bounded recent snapshot set and keeps only the latest
snapshot for each:

```text
content item + social account + platform post id
```

Content is ranked by observed interaction score, then reach/views.

The UI exposes:

- title
- provider/account
- snapshot freshness
- reach/views
- engagement rate

No synthetic content score is stored.

## AI learning loop

AI recommendations remain based on the existing evidence builder:

- 30-day provider metrics
- measured content performance
- upcoming persisted schedules
- available supported channels
- Brand Brain context

Display filters do not silently alter the AI evidence window.

The UI states this explicitly so a 7-day filtered chart is not confused with the
30-day recommendation evidence set.

Recommendations still require real provider metrics and measured published
content. Generation fails instead of fabricating advice if those prerequisites
are absent.

## Read-model boundaries

Analytics does not own publishing state.

```text
Publishing
  -> publication_results

Analytics ingestion
  -> metric_snapshots
  -> analytics_daily

Analytics overview
  -> read-only aggregation

AI insight execution
  -> existing domain services
```

Recommendation actions continue through Content/Campaign/Scheduling services
rather than mutating domain records from the dashboard.

## Bounded reads

Snapshot-backed content performance is intentionally bounded for the product
overview. It is not an export/reporting API.

A future reporting stage can add cursor-based exhaustive exports without making
the main workspace load unbounded metric history.

## Intentionally not included

This slice does not add:

- synthetic benchmark data
- fake percentage changes
- fabricated charts
- browser-side provider API calls
- lifetime exhaustive exports
- paid attribution/conversion analytics
- cross-workspace analytics
- a second AI recommendation engine

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

After Analytics, continue product completion with Media.

The next goal is to make Media a complete asset workspace over the real private
upload and processing pipeline:

```text
upload
  ↓
private object storage
  ↓
processing worker
  ↓
asset metadata
  ↓
usable content asset
```

with real filters, processing state, detail inspection and safe deletion.
