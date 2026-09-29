# Stage 11 — Private Document Knowledge Pipeline

Stage 11 extends Brand Brain RAG with private PDF and DOCX documents stored in
SoStats object storage and indexed asynchronously by the worker.

## End-to-end flow

```text
Browser
  -> request presigned upload
  -> private S3 / MinIO object
  -> complete + verify upload
  -> knowledge source = uploaded
  -> BullMQ dispatcher
  -> worker lease
  -> short-lived signed download
  -> AI extraction / chunking / embeddings
  -> chunk batches
  -> pgvector
  -> activate source version
  -> Brand Brain retrieval
```

The browser never sends document bytes through the NestJS API.

The worker does not receive long-lived object-storage credentials. It receives a
short-lived signed GET URL only after claiming the source.

## Supported private documents

Stage 11 supports:

- PDF
- DOCX
- maximum 15 MiB by default

Configuration:

```text
KNOWLEDGE_MAX_UPLOAD_BYTES=15728640
```

Private file types are allowlisted by MIME type and storage extension. The API
verifies the uploaded object size and content type before it becomes
dispatchable.

The AI extraction service validates the actual document structure while parsing.

## Direct-to-object-storage upload

The upload sequence is:

```text
POST /v1/knowledge/upload-url
  -> source(status=uploading)
  -> presigned PUT

Browser PUT -> S3 / MinIO

POST /v1/knowledge/:id/complete-upload
  -> HEAD/stat verification
  -> source(status=uploaded)
```

The knowledge source stores the private `storage_key`; it does not expose a
public object URL.

Production S3-compatible storage must allow CORS for the SoStats web origin to
perform the presigned PUT.

## Background queue

The worker adds a dedicated BullMQ queue:

```text
knowledge-processing
```

Operational settings:

```text
KNOWLEDGE_DISPATCH_POLL_MS=5000
KNOWLEDGE_CONCURRENCY=2
KNOWLEDGE_MAX_ATTEMPTS=4
KNOWLEDGE_PROCESSING_STALE_MS=1200000
```

The dispatcher asks the internal API for:

- uploaded sources
- processing sources whose lease has become stale

The worker then claims the source with a processing token.

## Lease and retry semantics

```text
dispatch
  -> claim processing token
  -> download signed object
  -> extract/chunk/embed
  -> upload chunk batches
  -> finalize same token
```

BullMQ retry jobs persist the processing token in their job data.

A retry with the same token can continue safely. A stale processor can be
reclaimed with a new token.

When a new token claims a processing version, any partial chunks for that
unfinished version are cleared before processing restarts.

Completion is accepted only when:

- source is still processing
- token matches
- processing version matches
- persisted chunk count matches the AI result

## Version model

Knowledge sources now have two independent version fields:

```text
active_version
processing_version
```

Chunks are uniquely identified by:

```text
source_id + version_number + chunk_index
```

Retrieval uses only chunks where:

```text
chunk.version_number = source.active_version
```

### Why this matters

Re-indexing version 3 does **not** delete version 2 before version 3 succeeds.

```text
active v2
   |
   +-------------------------> retrieval continues
   |
processing v3
   |
   +-- success -> active v3
   |
   +-- failure -> active v2 remains searchable
```

This avoids a temporary Brand Brain outage during embedding failures, AI service
errors, or worker restarts.

Historical chunks are retained so campaign provenance remains resolvable.

A future retention policy may compact old versions after a configured history
window.

## Re-index

For private files the UI exposes **Re-index**.

Re-indexing:

1. verifies the private object still exists
2. creates the next processing version
3. queues background processing
4. preserves the current active version
5. activates the new version only after all chunks are persisted

The existing private file is reused; re-index does not require a new upload.

## Failure and retry

A failed processing version records a bounded error on the source.

If no earlier version exists:

```text
active_version = 0
status = failed
```

If an earlier version exists, retrieval continues to use it even while the
source UI reports that the newer processing attempt failed.

**Retry** retries the same failed processing version.

**Re-index** intentionally creates a new processing version.

## Worker -> AI boundary

The worker downloads the private object and sends the document bytes to the AI
service as bounded base64 input.

The AI service:

- validates the 15 MiB source limit
- extracts PDF text with pypdf
- extracts DOCX paragraphs and table cells with python-docx
- normalizes text
- chunks with overlap
- creates real embeddings
- returns at most 100 chunks

The worker validates:

- embedding dimensions
- finite numeric values
- chunk indexes
- duplicate indexes
- content bounds
- result count

before submitting chunks to the API.

## Batched persistence

A full 100-chunk embedding result can be larger than a normal HTTP request body.

The worker therefore persists chunks through the internal API in batches of at
most 10 chunks.

Runtime default batches are 8 chunks.

This keeps internal requests bounded and avoids increasing the public/global API
body-size limit simply to support embeddings.

## Internal API trust boundary

Worker endpoints are under:

```text
/internal/knowledge/*
```

and require `WORKER_API_TOKEN`.

Supported internal operations:

- list dispatchable
- claim
- append chunks
- complete
- fail

Workspace ids and brand ids are read from persisted source state. The worker
cannot choose a different tenant while appending chunks.

## Retrieval during processing

Stage 10 retrieval used source `status=ready`.

Stage 11 instead uses:

```text
active_version > 0
```

This is intentional. A source can be:

```text
status = processing
active_version = 2
processing_version = 3
```

while version 2 remains valid retrieval evidence.

## Provenance

Semantic search now returns the chunk version.

Campaign `generation_context` persists:

- chunk id
- source id
- source title
- source URL when applicable
- version number
- similarity

AI Studio displays the version alongside semantic match evidence.

Old chunk ids remain in the database, so generation provenance does not become
ambiguous after a source is re-indexed.

## Brand Brain UI

Knowledge Library now supports three ingestion modes:

- **Private PDF / DOCX**
- **Website / public PDF**
- **Paste text**

Private sources show:

- upload/indexing state
- active version
- processing version
- chunk count
- file name
- file size
- embedding model
- failure detail
- Retry
- Re-index
- Delete when not actively processing

The client polls source state only while a source is uploading, queued, or
processing.

## Object deletion

Deleting a private knowledge source also deletes its object from storage before
removing the database source/chunks.

An upload that fails before completion is cleaned up best-effort and an
`uploading` source can be deleted manually. Sources already queued or actively
processing cannot be deleted until the background lease reaches a terminal
state.

## Database changes

Stage 11 extends `knowledge_sources` with:

- `file_name`
- `file_size`
- `storage_key`
- `active_version`
- `processing_version`
- `processing_token`
- `upload_completed_at`

`knowledge_chunks` adds:

- `version_number`

and changes its uniqueness contract to:

```text
(source_id, version_number, chunk_index)
```

## Deployment

Existing installations still require pgvector from Stage 10:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Then generate and review the migration:

```bash
pnpm --filter api db:generate
pnpm --filter api db:migrate
```

New environment variables:

```text
KNOWLEDGE_MAX_UPLOAD_BYTES=15728640
KNOWLEDGE_PROCESSING_STALE_MS=1200000
KNOWLEDGE_DISPATCH_POLL_MS=5000
KNOWLEDGE_CONCURRENCY=2
KNOWLEDGE_MAX_ATTEMPTS=4
```

Production object storage must keep the bucket private while allowing the web
origin to use presigned PUT requests.

## Verification

Stage 11 adds coverage for:

- DOCX paragraph/table extraction
- worker AI response validation
- embedding dimension validation
- duplicate chunk-index rejection
- bounded internal chunk batching

Existing Stage 10 extraction, PDF and network-security tests remain active.

## Current scope

Stage 11 deliberately does not add:

- OCR for scanned PDFs
- DOC / PPTX / XLSX extraction
- private Google Drive / Dropbox connectors
- automatic file replacement upload
- scheduled refresh for mutable documents
- old-version retention compaction

These can reuse the same version activation contract later.

## Next stage

With Brand Brain ingestion now covering public sources, text and private
documents, the strongest next product slice is knowledge quality and source
management:

```text
Source refresh / replacement
  -> version diff
  -> retrieval evaluation
  -> hybrid lexical + vector search
  -> evidence quality metrics
```

Alternatively, product work can shift back to the end-user content experience:
polish the Home/AI Studio/Content/Calendar surfaces around the now-real
automation and knowledge backend.
