# Stage 12 — Product UI Completion: Integrations

Integrations is now an operational read model over the real external-trigger
runtime instead of a decorative connector catalog.

## Product boundary

The production-backed integration modes in SoStats are:

- RSS polling
- generic signed webhook
- WordPress publish events through the signed webhook runtime

Configuration is owned by Automations.

```text
External source
  ↓
automation_trigger
  ↓
persisted trigger event
  ↓
automation run
  ↓
domain actions
```

## RSS

RSS uses the existing production polling path:

- SSRF-safe URL/DNS validation
- redirect revalidation
- feed limits and timeouts
- polling lease
- item dedupe
- persisted event/run linkage
- persisted last poll/trigger/error state

## Signed webhook

Generic webhook integrations use the existing HMAC SHA-256 automation endpoint:

- per-automation public id
- 256-bit encrypted signing secret
- timestamp/replay protection
- stable event dedupe
- persisted trigger events
- explicit secret rotation in Automations

Secrets are not returned by the Integrations overview.

## WordPress

WordPress is not presented as a fake WordPress API client.

The currently supported WordPress integration is a normalized source type over
the signed webhook trigger and defaults to the
`wordpress.post.published` event contract.

## Operational overview

The Integrations page derives its cards and health from persisted automation
triggers.

It exposes:

- configured trigger count
- active trigger count
- trigger error count
- latest activity
- automation name/status
- trigger status
- RSS feed URL
- webhook source/event name
- next RSS poll
- recent persisted webhook event count
- persisted runtime error

## Legacy generic integrations

The older `integrations` table and adapter classes predate the real Automation
runtime.

Those adapters returned dummy success/empty data and therefore are no longer a
product configuration path.

New generic create/sync operations now fail explicitly rather than pretending
that an external connector executed successfully.

Existing legacy rows remain readable/removable for migration/cleanup.

## No fake catalog

The product no longer renders:

- Notion
- Drive
- Shopify
- Slack
- other planned connectors

until a production runtime boundary actually exists.

## Verification

Required CI:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

plus existing AI compile/test.
