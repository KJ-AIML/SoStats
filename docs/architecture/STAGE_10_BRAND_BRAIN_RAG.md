# Stage 10 — Brand Brain Knowledge RAG

Stage 10 replaces the remaining mock/random RAG prototype with a real
workspace-scoped knowledge retrieval path.

## Product flow

```text
Website / public PDF / pasted text
  -> secure ingestion
  -> text extraction
  -> overlapping chunks
  -> OpenAI embeddings
  -> PostgreSQL + pgvector
  -> semantic retrieval
  -> Brand Brain context
  -> AI Studio / Automation Runtime
```

The database remains the source of truth. The Python AI service extracts,
chunks and embeds content, but does not own a second vector database.

## Data model

### knowledge_sources

Stores source-level lifecycle and provenance:

- workspace id
- brand id
- source type: `url` or `text`
- title
- canonical source URL when applicable
- original pasted text when applicable
- MIME type
- content SHA-256
- processing status
- embedding model
- chunk count
- bounded error detail
- processed timestamp

Normal API reads intentionally do **not** return `source_text`.

### knowledge_chunks

Stores retrieval units:

- source id
- workspace id
- brand id
- stable chunk index
- chunk text
- `vector(1536)` embedding
- source metadata

Every retrieval query is scoped by both workspace and brand before ranking.

Stage 10 uses exact pgvector cosine-distance ordering. It intentionally does not
add an approximate HNSW index yet; early Brand Brain corpora are small and an
exact scan keeps behavior simple and deterministic. Add an HNSW index when
corpus size/latency measurements justify it.

## Embedding contract

The default model is:

```text
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_EMBEDDING_DIMENSIONS=1536
```

The database column is physically `vector(1536)`. The API validates every
returned embedding before persistence and again for query vectors.

Changing dimensions therefore requires a deliberate database migration; changing
only the environment variable is not supported.

## AI service boundary

The previous random embedding implementation and mock Brand context endpoint
were removed.

The AI service now exposes:

```text
POST /v1/knowledge/process
POST /v1/knowledge/embed-query
```

`/process`:

1. accepts text or bounded base64 document bytes
2. extracts normalized text
3. produces overlapping chunks
4. requests real embeddings
5. returns chunks + vectors to the API

`/embed-query` embeds a bounded retrieval query using the same embedding
configuration.

OpenAI credentials stay inside the AI service.

## Extraction

Supported source material in Stage 10:

- pasted plain text
- public HTML / XHTML URLs
- public text URLs
- public PDF URLs

HTML extraction ignores script/style/noscript/svg content and normalizes text.

PDF extraction uses `pypdf` and currently accepts at most 250 pages.

Document processing is bounded to:

- 8 MiB for server-fetched URL content
- 500,000 extracted characters
- 100 semantic chunks
- roughly 650 words per chunk
- roughly 100 words of overlap

Pasted browser text is limited to 750 KiB so it remains below the normal API
request-body boundary. Larger documents should be supplied by public URL in
this stage.

## URL security / SSRF boundary

Knowledge URLs are untrusted input.

The NestJS API:

- accepts HTTP / HTTPS only
- rejects embedded credentials
- accepts standard HTTP(S) ports only
- rejects localhost / local / internal hostnames
- resolves DNS before connecting
- rejects private, loopback, link-local, multicast and documentation ranges
- rejects a hostname if any resolved address is non-public
- pins the network connection to a validated DNS result
- revalidates each redirect destination
- limits redirects
- requests identity encoding
- limits response bytes
- applies a network timeout
- accepts only supported text/HTML/PDF content types

This prevents ingestion from becoming an unrestricted internal-network fetch
primitive.

## Retrieval

The API embeds the campaign/automation retrieval query, then ranks chunks using
pgvector cosine distance.

Default minimum similarity:

```text
RAG_MIN_SIMILARITY=0.2
```

Retrieval returns bounded evidence with:

- chunk id
- source id
- source title
- source URL
- chunk content
- similarity

If a brand has no ready knowledge sources, SoStats skips the embedding request
entirely and continues with structured Brand Brain fields.

## Generation grounding

`CampaignsService` now builds a retrieval query from:

- campaign goal
- campaign name
- campaign description
- generation topic
- generation instructions

It retrieves up to six relevant chunks for the campaign's brand and injects
them into the existing serialized Brand Brain context.

The campaign planner is already instructed to use only supplied context and not
invent unsupported claims.

Because Automation Runtime's AI Generate block delegates to
`CampaignsService.generate()`, RSS and signed-webhook automations inherit the
same RAG behavior automatically.

There is no automation-specific RAG implementation.

## Provenance

Each generated campaign persists a compact `generation_context` containing the
retrieved:

- chunk id
- source id
- source title
- source URL
- similarity

The evidence text itself stays in `knowledge_chunks` rather than being copied
into every campaign.

AI Studio surfaces the source/chunk grounding used for the latest generation.

## Brand Brain UI

The Knowledge Library supports:

- Website / public PDF URL
- Pasted source-of-truth text
- source title
- ingestion status
- semantic chunk count
- embedding model
- processing error
- source deletion

The UI does not expose stored raw pasted text or embedding vectors.

## pgvector bootstrap

Fresh local databases enable pgvector through:

```text
infra/postgres/init/001-pgvector.sql
```

which runs:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Existing databases must enable the extension before applying the generated
schema migration:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Then:

```bash
pnpm --filter api db:generate
pnpm --filter api db:migrate
```

Review generated migrations before production rollout.

## Verification

CI now runs Python tests in addition to Python bytecode compilation.

Coverage added for:

- HTML extraction without script/style content
- overlap-aware chunking
- PDF extraction code path
- knowledge URL private/reserved network rejection
- existing Node/API/worker suites

## Current boundaries

Stage 10 intentionally does not yet include:

- direct browser PDF/file upload into the knowledge library
- OCR for scanned PDFs
- recursive website crawling
- scheduled source refresh
- approximate vector indexes
- hybrid BM25 + vector retrieval

Those should be added based on real product usage rather than hidden inside the
first RAG slice.

## Next stage

The strongest follow-up is direct document ingestion + knowledge lifecycle:

```text
PDF / DOCX upload
  -> private object storage
  -> worker extraction
  -> re-index / refresh
  -> source versioning
  -> same pgvector retrieval
```

After that, retrieval quality can be measured and hybrid reranking added only
where evidence supports it.
