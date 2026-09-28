# Stage 4 — Real Analytics Ingestion

Stage 4 replaces the random analytics worker with provider-backed metric
collection.

## Closed-loop data path

```text
Provider-confirmed publication
  -> publication_results
  -> analytics dispatcher
  -> BullMQ analytics job
  -> internal worker-authenticated API
  -> SocialAnalyticsPort
  -> provider reporting API
  -> metric_snapshots
  -> analytics_daily deltas
  -> Analytics UI
  -> AI insights
```

The worker does not receive provider access tokens. It receives only the
publication result id plus the expected latest snapshot version. Credential
decryption and provider calls remain inside the API adapter boundary.

## LinkedIn member post analytics

The first real analytics adapter uses LinkedIn
`memberCreatorPostAnalytics` for member-owned posts.

The connection requests:

```text
r_member_postAnalytics
```

in addition to the existing publishing scopes.

Existing LinkedIn connections created before this scope was enabled can continue
publishing, but must reconnect once before reporting data can be collected.

The default version header is:

```text
LINKEDIN_API_VERSION=202609
```

and can be changed without editing adapter code.

Collected metrics:

- impressions
- member reach
- reshares
- reactions
- comments
- link clicks

## Shared credential lifecycle

Publishing and analytics now use the same `ChannelCredentialService`.

The service:

1. decrypts the access token only inside the API
2. checks expiry
3. refreshes when a refresh token is available
4. encrypts refreshed credentials before persistence
5. marks permanently expired credentials accordingly

Redis never receives access or refresh tokens.

## Snapshot cadence

SoStats does not hammer provider APIs continuously.

After publication:

- first collection: after 15 minutes
- first 24 hours: roughly hourly
- days 2–7: every 6 hours
- days 8–30: every 24 hours
- after 30 days: automatic collection stops

The dispatcher polls for due work, and BullMQ job ids use:

```text
publication result id + latest metric snapshot timestamp
```

so repeated dispatcher scans deduplicate the same collection revision.

## Concurrency safety

The internal ingest endpoint checks the expected snapshot version before making
the provider call and again inside the database transaction.

An account-scoped PostgreSQL advisory transaction lock serializes rollup writes.
If two workers observe the same old snapshot, only one is allowed to persist the
new snapshot/delta. The second returns `stale` instead of double-counting.

## Snapshot and rollup semantics

`metric_snapshots` stores provider lifetime totals for the exact post at each
collection time.

`analytics_daily` stores the difference between consecutive snapshots.

Example:

```text
12:00 total impressions = 100
13:00 total impressions = 135

daily delta += 35
```

This makes the 30-day dashboard additive without repeatedly summing lifetime
totals.

Provider corrections can create negative deltas, for example when a reaction is
removed. SoStats preserves those corrections instead of clamping them away.

The first observed snapshot becomes the baseline contribution for the day it was
first collected. This is not a historical reconstruction of engagement that
occurred before SoStats started tracking the post.

## Analytics overview

The workspace overview now returns:

- 30-day additive totals
- daily cross-channel rollups
- latest snapshot timestamp
- number of tracked provider posts
- active automatic collection window

The UI uses these persisted values and no longer implies that analytics is mock
data.

## Retry behavior

Provider GET failures caused by rate limits, network failures or provider 5xx
responses are retryable and use BullMQ exponential backoff.

Permission errors and unsupported post identifiers are terminal for that queue
revision. They do not fabricate metrics.

## Operations

```text
ANALYTICS_DISPATCH_POLL_MS=60000
ANALYTICS_CONCURRENCY=4
ANALYTICS_MAX_ATTEMPTS=4
```

## Next stage

With real publication metrics flowing back into SoStats, the next stage can make
the learning loop actionable:

```text
Real Metrics
  -> AI Insight
  -> Evidence / Recommendation
  -> Create More / Repurpose / Adjust Schedule
  -> New Campaign or Automation Run
```

That stage should turn analytics recommendations into user-approved domain
actions instead of ending at a report.
