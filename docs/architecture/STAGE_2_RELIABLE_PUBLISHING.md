# Stage 2 — Reliable Publishing Engine

Stage 2 replaces the simulated publishing worker with a real queue-driven
publication path.

## Runtime flow

```text
User schedules reviewed content
  -> scheduled_publications row
  -> worker dispatcher reads dispatchable schedules
  -> BullMQ delayed job
  -> worker calls internal API with WORKER_API_TOKEN
  -> PublishingService claims schedule
  -> ProviderRegistry resolves adapter
  -> provider API
  -> publication_jobs + publication_results
  -> schedule / variant / content lifecycle updates
```

## Why the API owns provider execution

The worker is a driving adapter. It owns timing, queue retries and horizontal
concurrency. The NestJS application owns tenant data, credential decryption and
provider adapter resolution.

This keeps:

- OAuth credentials out of Redis payloads
- encrypted tokens out of the worker queue
- provider rules behind the existing adapter registry
- database lifecycle invariants in one application boundary

The internal worker API is not authenticated as a user. It is marked public for
the normal user auth guard and then protected independently with a constant-time
`WORKER_API_TOKEN` check.

## Dispatcher scale behavior

The internal dispatch endpoint is paginated. A worker scan can queue up to 5,000
publication versions per poll, in stable `scheduledAt + id` order. BullMQ job
ids deduplicate repeated scans, so horizontal dispatcher replicas can safely
observe the same schedule rows.

The internal worker routes bypass the user-facing request throttle but remain
protected by `WORKER_API_TOKEN`.

## Queue identity and rescheduling

A queue job id is derived from:

```text
scheduledPublicationId + scheduledPublication.updatedAt
```

The same schedule version is therefore deduplicated by BullMQ.

When a user reschedules, `updatedAt` changes. The new schedule version gets a
new queue job id. If an old delayed job wakes up later, the API compares its
`expectedVersion` with the current schedule version and returns `stale`
without publishing.

## Retry policy

Automatic publish retry is provider-specific.

For the first LinkedIn adapter:

- HTTP 429 is retryable.
- HTTP 4xx is treated as a provider rejection.
- HTTP 5xx and network ambiguity are treated as an unknown publish outcome and are **not** replayed automatically, because the external POST may already have created a post.

Token refresh is different: it has no publishing side effect, so transient refresh failures (429 / 5xx / network failure) can safely retry.

Retryable failures return an internal 503 so BullMQ applies exponential backoff.

Default policy:

- 5 attempts
- 30 second exponential base delay
- persisted attempt count and next-attempt hint
- dead-letter domain state after the final queue failure

Configuration:

```text
PUBLISH_DISPATCH_POLL_MS=15000
PUBLISH_DISPATCH_HORIZON_MS=120000
PUBLISH_CONCURRENCY=5
PUBLISH_MAX_ATTEMPTS=5
```

## Unknown outcomes

A POST to a social provider can fail after bytes leave SoStats but before a
provider response reaches us. Without a provider-supported idempotency key,
blindly retrying that request could create duplicate social posts.

SoStats classifies that case as `unknown_outcome` and marks the publication
failed for operator/user review instead of retrying automatically.

This favors duplicate prevention over pretending that exactly-once delivery is
possible when the provider does not supply the primitive required to guarantee
it.

## Persisted state

`scheduled_publications.status`

- scheduled
- publishing
- published
- failed
- cancelled

`publication_jobs.status`

- processing
- completed
- failed

`publication_results` stores either:

- external post id / URL, or
- normalized failure type / error message

No access token is written into queue payloads, publication results or logs.

## Publishing ownership

The UI cannot manually move content to Published.

Only a confirmed provider result can move:

- the selected content variant to `published`
- the schedule to `published`

The canonical content item becomes `published` after all of its schedules are
either published or cancelled.

## Recovery

A publication left in `publishing` with a processing attempt older than 15 minutes is treated as an unknown provider outcome. The dispatcher reconciliation pass marks it failed instead of replaying the external side effect automatically. This prevents a crashed process from turning into a duplicate post later.

A failed schedule can be retried by selecting a new publish time in Calendar.
That creates a new schedule version, which makes any old queue job stale.

A schedule with an unknown provider outcome should be checked against the
provider account before a human retries it.

## Credential refresh

Before publishing, the API checks the encrypted provider token expiry. If an
encrypted refresh token exists, the provider adapter refreshes the access token
and the API atomically stores the newly encrypted credentials. A permanent
refresh rejection marks the social account expired; transient refresh failures
stay retryable.

## Current provider scope

LinkedIn is the first real publisher adapter in the registry.

Additional providers should implement the same `SocialPublisherPort` error
semantics and must classify:

- retryable rejection
- non-retryable rejection
- unknown outcome

before they are enabled for production publishing.
