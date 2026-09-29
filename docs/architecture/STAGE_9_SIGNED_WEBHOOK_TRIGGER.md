# Stage 9 — Signed Webhook / WordPress Trigger

Stage 9 adds a push-based external trigger that enters the exact same
versioned Automation Runtime used by manual runs and RSS.

## End-to-end flow

```text
WordPress / external system
  -> signed HTTPS POST
  -> public automation hook
  -> HMAC + timestamp verification
  -> event-name filter
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

The inbound hook never executes business logic directly. It authenticates and
normalizes the event, creates a persisted run, and lets the existing Automation
Runtime continue from there.

## Workflow configuration

The Trigger block now supports:

- Manual
- RSS / Atom
- Signed Webhook / WordPress

Webhook configuration contains only non-secret behavior:

- `sourceType`: `generic` or `wordpress`
- `eventName`: for example `wordpress.post.published`

The endpoint id and secret are runtime credentials, not workflow-definition
content.

## Endpoint provisioning

Publishing a webhook automation provisions:

- a random public endpoint id
- a random 256-bit signing secret
- an encrypted-at-rest secret in `automation_triggers.secret`

The returned endpoint has the form:

```text
POST https://api.example.com/v1/automation-hooks/<public-id>
```

The plaintext secret is shown only when first created or after an explicit
rotation. Normal automation reads redact the encrypted secret.

Secret rotation immediately invalidates signatures made with the old secret.

## Signature protocol

Every request must be JSON and include:

```text
x-sostats-timestamp: <unix seconds or milliseconds>
x-sostats-event: <configured event name>
x-sostats-event-id: <stable unique delivery/event id>
x-sostats-signature: sha256=<hex digest>
content-type: application/json
```

The sender computes HMAC-SHA256 over the exact UTF-8 request body:

```text
timestamp + "." + event-name + "." + event-id + "." + exact-body
```

Pseudo-code:

```text
signature = HMAC_SHA256(
  secret,
  timestamp + "." + eventName + "." + eventId + "." + rawJsonBody
)
```

SoStats verifies the exact raw bytes before trusting the parsed body.

The event name and event id are part of the signature. This prevents a valid
signed body from being replayed with a modified event identity to bypass
deduplication.

## Replay protection

The timestamp must be within five minutes of the API clock.

The event id must also be stable across retries.

After signature validation the event identity is persisted using a deterministic
hash of:

```text
trigger id + configured event name + external event id
```

The database has a unique constraint on `trigger_id + event_key`.

A legitimate retry therefore returns an accepted duplicate response and does
not create another automation run.

## WordPress normalization

For `sourceType=wordpress`, SoStats accepts a JSON object at either:

- root
- `post`
- `data`

and normalizes common WordPress-style fields:

- `id` / `ID`
- `title.rendered` or title text
- `excerpt.rendered`
- `content.rendered`
- `link` / `permalink` / `url`
- `date_gmt` / `date`
- `status`
- `type`

HTML is reduced to bounded plain text before being persisted as trigger
evidence.

If a WordPress payload contains a status and it is not `publish`, a
`wordpress.post.published` trigger rejects the payload.

## AI grounding

Webhook events are normalized into the same Trigger output shape used by RSS.

The downstream AI Generate step receives:

- source type
- event name
- content title
- content type
- source status
- canonical URL
- publication timestamp
- bounded summary/content evidence

This makes:

```text
WordPress publish
  -> Generate LinkedIn + X campaign
  -> Review
  -> Schedule
```

grounded in the actual incoming post rather than using the webhook only as a
wake-up signal.

## Public endpoint security boundary

The hook route is public by design because external systems must reach it.

It still requires all of the following:

- a random endpoint id
- a valid HMAC signature
- an accepted timestamp
- a stable signed event id
- the exact configured event name
- JSON content type
- an active automation
- an active webhook trigger
- a published workflow version

Workspace ids, automation ids, provider ids, and workflow versions are never
trusted from the external request.

## Raw-body verification

Nest/Fastify raw-body capture is enabled so signature verification uses the
exact bytes sent by the client.

The parsed JSON body is used only after HMAC verification succeeds.

## Runtime persistence

Stage 9 extends the existing `automation_triggers` row with:

- `public_id`
- encrypted `secret`
- `last_received_at`

It continues using the Stage 8 `automation_trigger_events` table for dedupe and
run linkage.

No separate WordPress execution tables or queues are introduced.

## UI

A published webhook automation displays:

- source type
- expected event name
- public endpoint URL
- last received delivery
- last generated run
- one-time signing secret after create/rotation
- Rotate secret action
- Copy endpoint / Copy secret actions

## Environment

Production must expose a public API origin:

```text
PUBLIC_API_URL=https://api.example.com
WEBHOOK_PUBLIC_BASE_URL=https://api.example.com
```

`WEBHOOK_PUBLIC_BASE_URL` controls the URL shown to webhook senders. In local
development it defaults to `http://localhost:4000`.

## Database rollout

This stage extends `automation_triggers`.

Before deploying to an existing database:

```bash
pnpm --filter api db:generate
pnpm --filter api db:migrate
```

Review the generated migration before production rollout.

## WordPress sender

A minimal sender example is documented in:

```text
docs/integrations/WORDPRESS_AUTOMATION_WEBHOOK.md
```

WordPress does not need SoStats credentials beyond the endpoint and signing
secret. Social tokens and workspace authentication never leave SoStats.

## Next stage

With pull-based RSS and push-based signed webhooks proven through the same
runtime, the largest remaining product capability gap is Brand Brain knowledge
ingestion and RAG:

```text
URL / PDF / docs
  -> extract
  -> chunk
  -> embed
  -> retrieve relevant evidence
  -> AI Studio / Automations
```
