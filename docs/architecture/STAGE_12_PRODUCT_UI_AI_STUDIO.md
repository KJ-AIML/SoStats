# Stage 12 — Product UI Completion: AI Studio

Stage 12 continues the SoStats product-completion pass by turning AI Studio into
a real campaign workspace around the backend that already exists.

## Goal

AI Studio must expose the actual generation contract:

```text
Campaign inputs
    ↓
Brand Brain structured context
    ↓
Semantic knowledge retrieval
    ↓
AI campaign plan
    ↓
Campaign + pillars
    ↓
Content items + channel variants
    ↓
Content pipeline
```

The UI must not advertise unsupported providers or controls that do not change
generation behavior.

## Changes in this slice

### Real provider catalog

The workspace snapshot now includes:

```text
GET /v1/channels/providers
```

AI Studio uses the ProviderRegistry result instead of a hard-coded social list.

At the current product stage this means the generation UI follows the adapters
that actually exist in the API. Adding a future provider to ProviderRegistry can
flow into AI Studio without another hard-coded UI list.

Provider cards expose real capabilities such as:

- text
- images
- video
- analytics

The UI also distinguishes:

```text
provider supported
        ≠
OAuth account connected
```

Generation may create a platform variant before OAuth exists. Publishing still
requires an active channel account.

### Functional campaign inputs

The previous decorative Goal / Tone / Length controls were removed.

The real generation request now exposes editable:

- campaign name
- campaign goal
- campaign context / brief
- audience / instructions
- Brand Brain selection
- supported generation channels

Brand tone and other structured context remain server-owned Brand Brain
resolution rather than a fake client dropdown.

### Quick starts

Quick-start templates are functional input presets:

- Product launch
- Weekly content plan
- Repurpose source
- Thought leadership

They populate editable campaign fields and do not bypass the normal API flow.

### Multi-brand awareness

The workspace brand list is available in AI Studio.

The selected brand id is sent through the existing campaign endpoint, so
CampaignsService resolves the appropriate structured Brand Brain context and
knowledge retrieval for that brand.

The UI also shows the count of active indexed knowledge sources for the selected
brand.

### Persisted recent campaigns

AI Studio loads recent campaigns from the existing workspace snapshot.

A saved campaign can be reopened without regenerating it. The workspace can
inspect:

- strategy
- content items
- platform variants
- content pillars
- knowledge provenance

A newly generated campaign is added to the local recent list immediately after
the API returns the persisted result.

### Campaign result workspace

The result area now has three product views:

```text
Strategy
Posts
Knowledge
```

#### Strategy

Shows persisted:

- campaign goal
- description
- content count
- channel count
- knowledge evidence count
- pillars
- generated channel plan

#### Posts

Shows persisted content items and the actual channel-variant copy returned by
the campaign record.

Editing remains owned by the Content product surface; AI Studio links directly
into the content pipeline.

#### Knowledge

Shows persisted RAG provenance:

- source title
- source version
- chunk id
- semantic similarity

This does not reconstruct or invent evidence that was not saved with the
campaign.

### Real workflow navigation

The previous visually interactive but inert next-step rows were replaced with
real links:

```text
AI Studio
   ├─> Content
   ├─> Media
   └─> Calendar
```

The campaign header also links directly to the persisted Content pipeline.

## Data boundaries

AI Studio continues to use the same-origin Next.js BFF.

```text
Browser
   ↓
Next.js workspace API
   ↓
NestJS
   ├─ BrandContextService
   ├─ KnowledgeService
   └─ CampaignsService
        ↓
     FastAPI AI
```

Backend auth credentials remain server-side.

## No new fake capability

This slice intentionally does not add:

- Instagram / TikTok adapters
- image generation
- video generation
- direct publishing from AI Studio
- fake tone generation controls
- fake campaign metrics
- client-side RAG

If those capabilities are added later, their real backend contracts should be
connected before exposing them as working UI controls.

## Verification

Pull-request CI must pass:

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

The AI compile and pytest jobs remain required because AI Studio depends on the
campaign planning service contract.

## Next Stage 12 slice

After AI Studio, continue product completion with the central Content surface:

```text
AI Studio
   ↓
Content board / list
   ↓
Variant review + status transitions
   ↓
Scheduling
```

The focus should stay on real lifecycle management rather than new
infrastructure.
