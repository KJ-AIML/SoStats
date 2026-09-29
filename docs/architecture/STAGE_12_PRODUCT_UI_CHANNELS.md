# Stage 12 — Product UI Completion: Channels

Stage 12 continues the product-completion pass by turning Channels into the
operational surface for real provider adapters, OAuth credentials and execution
readiness.

## Goal

Channels must distinguish three different ideas:

- an adapter is installed in SoStats
- an OAuth account is connected
- that account currently has usable credentials

Those are not the same thing.

```text
ProviderRegistry
  ↓
OAuth connection
  ↓
encrypted social account credentials
  ↓
publishing / analytics readiness
  ↓
Scheduling + Publishing + Analytics workers
```

## ProviderRegistry is the source of truth

The web provider catalog is no longer a hard-coded LinkedIn/X list.

The API returns only providers registered in `ProviderRegistry`, including
their actual capability flags:

- text
- images
- video
- carousel
- analytics
- native scheduling
- OAuth PKCE usage

The UI can therefore show exactly what SoStats can execute today.

Unsupported providers are not rendered as connectable cards.

## Current real adapters

At this stage the registry contains:

- LinkedIn
- X

Both currently support:

- text publishing
- analytics ingestion

Both explicitly report no provider media publishing yet.

X uses OAuth Authorization Code + PKCE S256.

LinkedIn uses its configured authorization-code flow.

## Account read model

Connected account reads now expose operational metadata without exposing secrets:

- Brand Brain association
- provider/account identity
- persisted account status
- credential state
- whether a refresh token exists
- credential expiry time
- publishing readiness
- analytics readiness
- active scheduled-publication count
- published publication count
- last published schedule time
- latest analytics snapshot time
- provider capability flags

Access and refresh token ciphertext is used only server-side and is never
returned from the API response.

## Credential states

The server derives one of these credential states:

- `active`
- `no_expiry`
- `expiring`
- `refresh_required`
- `expired`
- `disconnected`
- `missing_token`

An account is marked publishing/analytics ready only when:

1. the provider adapter supports that capability
2. account status is active
3. an access token exists
4. the access token is not already past its persisted expiry time

This is execution readiness, not a guarantee that a provider API permission or
request will succeed.

## Refresh recovery

Credential refresh can now recover an account whose status is already
`expired` when a usable refresh token remains.

The previous credential guard rejected every non-active account before reaching
the refresh path.

The credential service now allows:

```text
active + expired timestamp + refresh token
expired + refresh token
        ↓
provider refreshAccessToken()
        ↓
encrypted replacement credentials
        ↓
status = active
```

A disconnected account cannot be refreshed directly. It must re-enter OAuth.

## Reconnect

Reconnect always uses the normal OAuth flow.

On callback, if SoStats finds the same:

```text
workspace + provider + providerAccountId
```

the existing account row is updated with new encrypted credentials and marked
active.

This preserves its identity and historical relationships.

## Safe disconnect

Disconnect does **not** delete the `social_accounts` row.

It removes:

- encrypted access token
- encrypted refresh token
- persisted expiry

and sets:

```text
status = disconnected
```

Historical schedules, publication results and analytics remain intact.

## Scheduled-publication guard

A channel cannot be disconnected while it owns a publication in:

- `scheduled`
- `publishing`

The operator must first resolve those records in Calendar.

This prevents a user from knowingly removing the credentials required by an
already queued side effect.

## UI workspace

Channels now exposes real:

- active account count
- publishing-ready account count
- analytics-ready account count
- accounts requiring credential attention
- provider capability matrix
- OAuth mode
- brand association
- exact credential expiry
- last publish
- latest analytics snapshot
- active scheduled-publication count
- credential refresh
- OAuth reconnect
- safe disconnect

## Security boundary

The browser receives only sanitized health/readiness metadata.

It never receives:

- access tokens
- refresh tokens
- OAuth client secrets
- decrypted credential material

OAuth state remains encrypted and short-lived.

## Capability wording

The Channels UI intentionally describes publishing/analytics as
"credential + adapter ready".

It does not claim the remote provider is healthy or that every account has every
provider permission at that moment.

Runtime provider errors remain authoritative.

## Data ownership

```text
ProviderRegistry
  -> adapter capabilities

Channels
  -> OAuth / credential lifecycle
  -> social_accounts

Calendar
  -> scheduled_publications

Publishing
  -> external post side effects

Analytics
  -> provider metric ingestion
```

Channels does not duplicate publishing or analytics state.

## Intentionally not included

This slice does not add:

- fake Instagram/Facebook/YouTube cards
- provider status pings that call remote APIs on every page load
- deletion of historical account identity
- browser access to credentials
- provider media publishing before the adapter contract supports it
- native provider scheduling claims when capability is false

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

After Channels, continue product completion with Brand Brain.

The next goal is to unify:

```text
brand profile
  + voice
  + audiences
  + products
  + pillars/rules
  + public/private knowledge
  + ingestion/reindex state
```

into one operational Brand Brain workspace while preserving the real RAG and
private-document pipelines already implemented.
