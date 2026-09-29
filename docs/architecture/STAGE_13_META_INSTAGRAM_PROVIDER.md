# Stage 13 — Meta / Instagram Provider Expansion

Stage 13 starts provider expansion after the Stage 12 product-completion pass.

This slice adds production-backed provider adapters for:

- Facebook Pages
- Instagram Professional accounts linked to Facebook Pages

The implementation uses the existing SoStats boundaries rather than introducing
a second publishing, OAuth, analytics or media subsystem.

## Runtime flow

```text
Channels
  ↓ Meta OAuth / Facebook Login
Provider account discovery
  ↓
encrypted social_accounts
  ↓
Content Review
  ↓
Media attachment
  ↓
Calendar / SchedulingService
  ↓
Publishing worker
  ↓
Facebook / Instagram adapter
  ↓
publication_results
  ↓
Analytics worker
  ↓
metric_snapshots / analytics_daily
```

## ProviderRegistry

The registry now includes:

- LinkedIn
- X
- Facebook
- Instagram

Facebook and Instagram are independent SoStats providers even though both use
Meta's Facebook Login and Graph API infrastructure.

## Meta OAuth

Configuration:

```text
META_APP_ID
META_APP_SECRET
META_GRAPH_API_VERSION=v26.0
META_FACEBOOK_SCOPES
META_INSTAGRAM_SCOPES
```

The API version remains an explicit environment setting so upgrades are
intentional.

OAuth state continues to use the encrypted, short-lived SoStats state envelope.

### Facebook discovery

After OAuth:

1. exchange authorization code for a user access token
2. exchange it for the long-lived Meta user token
3. query `/me/accounts`
4. collect manageable Pages and their Page access tokens
5. persist every returned Page as a separate `facebook` social account

No Page access token reaches the browser.

### Instagram discovery

Instagram uses the Facebook Login path in this slice.

The selected Meta user must have a Facebook Page linked to an Instagram
Professional account.

After OAuth:

1. discover manageable Pages
2. inspect each Page's `instagram_business_account`
3. load Instagram username/name
4. persist every discovered Professional account as a separate `instagram`
   social account using its Page access token

Consumer Instagram accounts are intentionally unsupported.

## Multi-account callback

The provider contract now supports optional multi-account OAuth discovery.

LinkedIn and X still return one account.

Facebook and Instagram can return multiple accounts from one authorization.
ChannelsService upserts every discovered provider account and redirects with the
number of connected accounts.

## Publishing media contract

`SocialPublisherPort` now accepts optional provider media context:

```ts
{
  assetId,
  fileType,
  mimeType,
  fileName,
  url
}
```

The URL is generated only at publish time from the existing private Media
object-storage boundary.

Variant-specific attachments take precedence. If none exist, canonical content
attachments are used.

The worker receives short-lived signed URLs, never storage credentials.

## Scheduling validation

Provider capabilities can now state:

- `requiresMedia`
- accepted `mediaMimeTypes`
- `maxMediaItems`

SchedulingService validates those requirements before a publication is queued.

This prevents an Instagram text-only job from entering the publishing worker.

## Facebook Pages

Current adapter v1 supports:

- text Page posts
- one attached image
- reactions
- comments
- shares
- post clicks

Provider capabilities:

```text
text       yes
images     yes
video      no
carousel   no
analytics  yes
native scheduling no
```

Facebook image publishing uses the Page `/photos` endpoint.

Text-only publishing uses the Page `/feed` endpoint.

### Facebook analytics and 2026 metric changes

The adapter deliberately does not request the legacy Facebook Page/Post
impression metrics.

Meta deprecated the legacy post impression family above Graph API v25 and
removed additional Page insights in June 2026.

SoStats therefore ingests provider evidence that remains appropriate to this
adapter contract:

- reactions
- comments
- shares
- post clicks

Missing reach/impression fields stay missing; the Analytics UI does not
fabricate them.

## Instagram Professional

Current adapter v1 supports:

- one JPEG feed image
- caption
- media permalink lookup
- media insights

Provider capabilities:

```text
text/caption yes
images       yes
video        no
carousel     no
analytics    yes
requires media yes
accepted media image/jpeg
max media items 1
```

The publish sequence is:

```text
POST /{ig-user-id}/media
  ↓
poll container status
  ↓
POST /{ig-user-id}/media_publish
  ↓
GET permalink
```

Network/server uncertainty during `media_publish` is treated as an unknown
outcome so the existing publishing worker does not automatically create a
duplicate Instagram post.

## Instagram insights

The adapter requests the current view-centric media metrics:

- views
- reach
- likes
- comments
- saved
- shares
- total interactions (provider response; not separately stored)

Instagram `views` is stored both as `views` and as the generic
`impressions` compatibility field so existing SoStats aggregate cards can
continue to display a primary exposure metric while the raw snapshot retains
`views`.

The deprecated Instagram `impressions` metric is not requested.

## Private object storage requirement

Meta fetches media from the URL provided to the Graph API.

Therefore production must provide an object URL reachable by Meta over the
public internet.

SoStats supports either:

- an externally reachable HTTPS `S3_ENDPOINT` used by the signed GET URL, or
- an externally reachable `S3_PUBLIC_BASE_URL`

Localhost MinIO URLs cannot be fetched by Meta and are expected to fail during a
real provider publish attempt.

## Explicit v1 constraints

This PR does not claim support for:

- Instagram Reels
- Instagram Stories
- Instagram carousel
- Facebook video/Reels
- Facebook carousel
- personal Facebook profile publishing
- Instagram consumer accounts
- provider-native scheduling
- Meta webhook ingestion

Those should be added as separate capability slices with their own provider
contracts/tests.

## Security

- App secret remains server-side.
- OAuth state remains encrypted and short-lived.
- Provider/Page access tokens remain encrypted at rest.
- Media storage credentials never enter Graph API or browser payloads.
- Provider errors continue through the existing retry / unknown-outcome rules.
- Disconnect still preserves historical publication/analytics records.

## Verification

Required CI remains:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

plus the Python AI compile/test job.

## Next roadmap

After this provider slice:

1. Identity / Admin lifecycle
2. Production Hardening
3. additional provider/media capability expansion as needed
