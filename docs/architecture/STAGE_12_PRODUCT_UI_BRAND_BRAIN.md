# Stage 12 — Product UI Completion: Brand Brain

Stage 12 continues the product-completion pass by turning Brand Brain into the
operational intelligence workspace behind AI Studio, Automations and AI Insights.

## Goal

Brand Brain combines two different sources of truth:

1. structured brand context
2. versioned semantic knowledge

They remain separate in storage and are joined only when a generation workflow
needs context.

```text
Brand identity
+ Voice
+ Audiences
+ Products
+ Content pillars
+ Rules
        ↓
BrandContextService

Knowledge sources
        ↓
extract / chunk / embed
        ↓
active-version pgvector chunks
        ↓
KnowledgeService.search()

Structured context + retrieved evidence
        ↓
AI generation
        ↓
persisted provenance
```

## Multi-brand workspace

Brand Brain now supports selecting a specific brand through the workspace route.

Every selected brand receives its own:

- structured context editor
- knowledge source list
- private document pipeline
- semantic retrieval test

Knowledge polling is explicitly scoped by `brandId`, so asynchronous worker
refreshes cannot leak another brand's sources into the active Brand Brain view.

A new Brand Brain can also be created from the same product surface.

## Brand identity

The identity editor persists:

- name
- description
- website URL

The API validates:

- non-empty brand name
- HTTP/HTTPS website URL
- bounded field lengths

The website URL is brand metadata. It is not automatically crawled unless the
operator separately adds it as a knowledge source.

## Structured context

The editor manages the existing relational tables:

- `brand_voice_profiles`
- `brand_audiences`
- `brand_products`
- `content_pillars`
- `brand_rules`

The API exposes one atomic replacement contract:

```text
PUT /brands/:id/context
```

The replacement is executed in one database transaction.

Downstream readers therefore see either:

- the previous structured Brand Brain state, or
- the newly saved structured Brand Brain state

rather than a partial mixture during a save.

No new structured-context source-of-truth table is introduced.

## Context limits

The API applies bounded entry counts and text lengths before persistence.

Current maximum entry counts:

- 10 voice profiles
- 25 audiences
- 50 products
- 25 content pillars
- 50 rules

Required fields such as voice tone, audience/product/pillar names and rule
descriptions cannot be blank.

## BrandContextService boundary

`BrandContextService` remains the structured serialization boundary used by AI
workflows.

It serializes:

- brand identity
- voice
- audiences
- products
- pillars
- rules

This Stage 12 slice does not create a second prompt-context implementation.

## Knowledge sources

The existing real source types remain:

- pasted text
- public website / public PDF URL
- private PDF
- private DOCX

Private documents remain stored in private S3-compatible object storage.

Public URL ingestion retains the existing SSRF and redirect protections.

## Private document upload

Private knowledge upload now exposes real browser upload progress.

The flow remains:

```text
browser
  ↓ signed PUT
private object storage
  ↓ HEAD verification
uploaded source
  ↓ BullMQ knowledge-processing
worker
  ↓ extract / chunk / embed
versioned knowledge chunks
  ↓
active version
```

Storage credentials never enter the browser.

## Version-safe indexing

Private documents retain the Stage 11 version model:

- `activeVersion` is the searchable source version
- `processingVersion` is the candidate version
- worker processing uses a processing token
- chunks are keyed by source/version/index

A failed reindex does not remove the previous active version.

Retrieval only joins chunks where:

```text
knowledge_chunk.version_number
=
knowledge_source.active_version
```

## RAG retrieval test

The product workspace can now execute the real knowledge search boundary.

The tester sends:

- selected brand id
- operator query
- bounded result limit

The returned evidence shows:

- chunk id
- source id
- source title
- source type
- active version number
- semantic similarity
- actual retrieved chunk text
- public source URL when available

The UI does not invent fallback evidence when no result passes the configured
similarity threshold.

## Evidence semantics

The retrieval tester is not a second search engine.

It calls the same `KnowledgeService.search()` used by downstream generation
workflows:

```text
query
  ↓
AI query embedding
  ↓
pgvector cosine distance
  ↓
workspace + brand + active-version filter
  ↓
RAG_MIN_SIMILARITY
  ↓
bounded evidence rows
```

This makes Brand Brain itself inspectable before the operator generates a
campaign.

## AI provenance

Campaign generation continues to persist knowledge evidence in generation
context.

The evidence can identify:

- source id
- source title
- source URL when public
- source version
- similarity

Stage 12 does not weaken or bypass that provenance path.

## No silent cross-brand fallback

A selected Brand Brain does not silently search another brand when it has no
knowledge.

No evidence match means no evidence match.

The system should not improve a response by silently violating tenant/brand
scope.

## Product status surface

The Brand Brain page exposes real counts for:

- structured context records
- indexed sources
- active semantic chunks
- pending/failed knowledge sources

These values are derived from persisted records.

## Deletion boundary

This product pass intentionally does not add a prominent brand-delete action.

Deleting a brand has wider relational consequences because several domain
records belong to a brand. Brand deletion should be treated as an administrative
lifecycle operation with dependency review rather than a casual editor action.

Knowledge source deletion retains the existing source-specific safeguards.

## Intentionally not included

This slice does not add:

- fake AI-generated brand profiles
- OCR
- DOC/PPTX/XLSX ingestion
- Drive/Dropbox sync
- automatic website refresh
- synthetic RAG evidence
- a second vector store
- automatic cross-brand knowledge fallback
- casual brand deletion UI

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

After Brand Brain, continue product completion with Integrations.

The next goal is to make Integrations an honest operational surface over
installed integration/trigger boundaries rather than a catalog of capabilities
that are not actually connected.
