# Stage 12 — Product UI Completion: Media

Stage 12 continues the product-completion pass by turning Media into a complete
asset workspace over the real private upload and processing pipeline.

## Goal

Media owns private asset ingestion, processing state, metadata, preview access,
content attachment and safe deletion.

It does not pretend that content attachments are already published as provider
media.

```text
Browser
  ↓ signed PUT
Private object storage
  ↓
Upload verification
  ↓
media-processing queue
  ↓
Worker metadata extraction
  ↓
Ready asset
  ↓
Content attachment
```

## Upload progress

The browser now uses XMLHttpRequest for the signed object-storage PUT so the
workspace can display real upload progress.

The upload flow remains:

1. request a short-lived signed PUT through the same-origin BFF
2. stream the file directly from browser to S3/MinIO
3. show byte progress reported by the browser upload request
4. call the API completion endpoint
5. HEAD-verify object size/content type
6. move the asset to `uploaded`
7. let the existing dispatcher/worker claim processing

Object-storage credentials are never exposed.

## Supported media

Media v1 remains intentionally constrained to:

Images:

- JPEG
- PNG
- WebP
- GIF

Video:

- MP4

The worker extracts real width/height and MP4 duration from binary metadata.

## Asset workspace

The UI now includes functional:

- search
- image/video type filter
- lifecycle-state filter
- used/unused filter
- brand filter
- upload brand selection
- processing KPIs
- upload progress
- polling for active processing
- image/video preview
- metadata inspection
- lifecycle timestamps
- retry after processing failure
- signed-preview refresh
- content usage inspection
- attach/detach actions
- guarded deletion

## Signed preview lifecycle

Ready assets are private by default.

List/detail reads receive a short-lived signed GET URL from the object-storage
adapter when no configured public base URL exists.

Opening an asset detail refreshes that signed preview. The detail workspace also
has an explicit refresh action for long-running sessions.

## Content attachment

A ready asset can be associated with:

- canonical content
- a specific platform variant

through persisted `content_assets` rows.

The API validates:

- asset belongs to the workspace
- asset is `ready`
- content belongs to the workspace
- content is not scheduled/published
- selected variant belongs to the content item

Duplicate attachment requests are idempotent.

If an attachment is added or removed after content entered `in_review` or
`approved`, the parent content item is reset to `draft`.

This follows the same principle as copy edits: a material media change invalidates
previous review/approval.

## Publishing boundary

Content attachment does **not** imply media provider publishing today.

The current SocialPublisherPort exposes text publishing and provider capability
metadata, but the publishing execution path currently sends text only.

The Media UI states this boundary explicitly.

Provider media upload/publish should be wired later through a real adapter
contract before the product claims image/video publishing.

## Usage visibility

Asset reads now include bounded content usage metadata:

- attachment id
- content item id/title/status
- optional variant id/platform
- usage count

This allows Media to show where an asset is used before mutation/deletion.

## Safe deletion

The previous delete flow allowed the asset FK cascade to silently remove
`content_assets`.

That behavior is no longer accepted.

Deletion now refuses when:

- the asset has content attachments
- media processing is active
- another deletion is already active

Attach and delete operations share a PostgreSQL advisory lock keyed by workspace
and asset id.

Delete flow:

```text
advisory lock
  ↓
re-read asset
  ↓
verify no content usage
  ↓
claim status = deleting
  ↓
commit DB claim
  ↓
delete private object
  ↓
delete asset row
```

If object-storage deletion fails, the previous asset status is restored.

This prevents a concurrent attachment from being silently cascade-deleted after
the usage check.

## Processing concurrency

The existing processing-token design remains unchanged.

Worker completion/failure is accepted only for the current processing token.

Uploaded/processing assets are protected from user deletion so the UI cannot race
an active worker side effect.

## Brand awareness

Uploads can target a selected Brand Brain brand.

The existing workspace/brand validation remains server-side.

Media filters can also isolate assets by persisted brand id.

## Data boundaries

```text
Media UI
  ↓
Next.js BFF
  ↓
MediaService
  ├─ assets
  ├─ content_assets
  └─ object-storage port

Worker
  ↓ internal worker-auth API
MediaService
  ↓
assets processing state
```

Content still owns review lifecycle.

Media owns the asset and its attachment relationship.

Publishing owns provider side effects.

## Intentionally not included

This slice does not add:

- fake image generation
- fake thumbnails
- browser-side S3 credentials
- silent cascade deletion of attached media
- media upload to LinkedIn/X publishing adapters
- transcoding
- image transformations
- asset collections/tags editing
- bulk uploads
- CDN transformation services

Those should be added only with real backend contracts.

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

After Media, continue product completion with Channels.

The next goal is to expose the provider adapter boundary honestly:

```text
ProviderRegistry
  ↓
OAuth connection
  ↓
capabilities
  ↓
publishing/analytics health
```

with real connection state, capability visibility, reconnect/disconnect controls
and no unsupported provider cards pretending to be available.
