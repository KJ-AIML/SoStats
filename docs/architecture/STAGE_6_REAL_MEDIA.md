# Stage 6 — Real Media Processing

Stage 6 replaces the simulated media worker with a verified private-storage
pipeline.

## Upload flow

```text
Browser
  -> Next.js BFF
  -> API requests signed PUT
  -> Browser PUTs directly to S3 / MinIO
  -> API HEAD-verifies stored object
  -> asset status = uploaded
  -> media dispatcher
  -> BullMQ
  -> worker claims asset
  -> signed private GET
  -> real metadata extraction
  -> API persists metadata
  -> asset status = ready
```

The browser never receives object-storage credentials. The worker also never
receives S3 credentials; it receives a short-lived signed download URL from the
internal worker-authenticated API.

## Asset lifecycle

```text
uploading
  -> uploaded
  -> processing
  -> ready

processing -> failed -> uploaded (explicit Retry)
```

Existing assets migrate safely because the new status column defaults to
`ready`.

Persisted processing fields:

- status
- width
- height
- duration_ms
- processing token
- processing error
- upload completed timestamp
- processed timestamp

## Upload verification

The API does not trust file metadata submitted by the browser.

Before queueing processing it performs a signed object-storage HEAD request and
checks:

- object exists
- stored byte size exactly matches the declared File size
- stored content type matches when storage returns a specific MIME type

A size/type mismatch is rejected and the suspicious object is deleted.

## Supported media v1

Images:

- JPEG
- PNG
- WebP
- GIF

Video:

- MP4

The worker extracts dimensions from real binary headers. MP4 processing parses
the ISO BMFF `moov`, `mvhd`, `trak` and `tkhd` structures to persist
video dimensions and duration.

No random dimensions, sleeps, fake thumbnails, or fake success states remain in
the media worker.

Thumbnail generation/transcoding is intentionally a later optimization. The
Media UI uses short-lived signed original URLs for ready assets.

## Queue reliability

The dispatcher scans only assets that are:

- uploaded
- or processing longer than the configured stale timeout

Queue identity includes:

```text
asset id + asset updated-at revision
```

The API creates a processing token when a worker claims an asset. BullMQ retries
reuse that token. If a stale job and a replacement job overlap, only the current
processing token can persist completion.

Transient storage/API failures use BullMQ exponential retry. Invalid media
headers are terminal and persist a readable failure reason.

## Worker memory boundary

Runtime v1 intentionally buffers one media object in worker memory so binary
metadata parsing is deterministic and dependency-light.

Control the bound with:

```text
MEDIA_MAX_UPLOAD_BYTES=104857600
MEDIA_CONCURRENCY=3
```

For much larger video workloads, the next media iteration should stream to a
temporary file or dedicated transcoding service rather than increasing this
limit.

## Local MinIO

Docker Compose now:

- enables the configured web origin for MinIO API CORS
- creates the private upload bucket automatically through `minio/mc`
- explicitly keeps anonymous access disabled

This makes browser-to-MinIO signed PUT uploads usable in local development.

## Web product surface

The Media page now has a real upload flow:

- file picker
- direct signed upload
- upload verification
- processing state
- automatic polling while processing
- real image/video metadata
- private signed preview
- retry failed processing
- delete asset
- search and type filters

The previous non-functional "Generate asset" control was removed rather than
presenting a fake action.

## Database rollout

This stage extends `assets`.

Before deploying against an existing database:

```bash
pnpm --filter api db:generate
pnpm --filter api db:migrate
```

Review the generated migration before production rollout.

## Next stage

With the core loop and real media pipeline in place, the next product expansion
should add a second social provider through the existing provider ports.

That validates that Channels / Publishing / Analytics are truly provider-neutral
rather than LinkedIn-specific.
