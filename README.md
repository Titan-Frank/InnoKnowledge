# Open Knowledge Map

**Build an AI-native multidisciplinary knowledge network from canonical objects, domain semantics, explicit bridges, and governed evidence.**

[中文说明](README.zh-CN.md) · [Live viewer](https://open-knowledge-map.pages.dev/) · [Historical inspection artifact](artifacts/okm-public-v0.1.0/README.md) · [Populated demo](examples/demo-data/README.md) · [Architecture](docs/current-system-architecture.md) · [Interdisciplinary network](docs/interdisciplinary-knowledge-network.md) · [Knowledge unit contract](docs/knowledge-unit-contract.md) · [Contributing](CONTRIBUTING.md)

[![CI](https://github.com/Titan-Frank/Open-Knowledge-Map/actions/workflows/ci.yml/badge.svg)](https://github.com/Titan-Frank/Open-Knowledge-Map/actions/workflows/ci.yml)
![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-339933?logo=nodedotjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-first-3178C6?logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/storage-PostgreSQL-4169E1?logo=postgresql&logoColor=white)

![Open Knowledge Map graph explorer showing the repository-authored solar interface fixture](docs/assets/report/graph-overview.png)

The [hosted read-only viewer](https://open-knowledge-map.pages.dev/) currently serves the versioned `knowledge/main` snapshot: **182 knowledge objects**, **144 typed relations**, **537 exported evidence records**, **182 cards**, and **182 knowledge bodies**. The screenshot above deliberately uses the smaller repository-authored solar fixture so that the interface can be shown without reproducing third-party textbook content; its 9 objects and 12 relations are not the scale of the published snapshot or an accuracy benchmark.

## Three ways to try it

1. **Open the hosted viewer:** inspect the current `main` snapshot immediately, without PostgreSQL or model credentials.
2. **Run the safe local fixture:** `npm install && npm run demo` starts an isolated, repository-authored graph at <http://127.0.0.1:8765/viewer/>.
3. **Process authorized material:** configure PostgreSQL, MinerU, and a model endpoint, then run the lesson-level TypeScript pipeline described below.

## Why this project exists

PDF pages and document chunks are useful retrieval units, but they are weak long-term interfaces for tutoring, planning, evaluation, and knowledge maintenance. They do not automatically provide stable identities, typed relations, evidence links, review state, or a contract that downstream software can safely call.

Open Knowledge Map treats textbooks as **source evidence and teaching paths**, not as the ontology itself. It converts lesson-level material into governed Knowledge Objects, semantic Domain Profiles, and separate Curriculum Projections; it connects disciplines through explicit bridge objects and exposes complete `ApiUnit` views for search, grounded generation, and inspection.

This repository is a full extraction and knowledge-runtime system, not only a static taxonomy or JSON dataset.

## What is implemented

- TypeScript-first PDF and MinerU ingestion.
- Outline alignment and lesson/chunk planning.
- Model-based knowledge object and relation extraction.
- Lesson-isolated staging tables and transactional canonical reducers.
- Canonical objects, Chinese-semantic typed relations, Domain Profiles, Curriculum Projections, mentions, evidence, cards, and knowledge bodies.
- Domain schemas for mathematics, physics, computer science, chemistry, biology, and general knowledge, plus governed source policies.
- Evidence-linked, pending-review pedagogical profiles generated per curriculum and school stage after canonical normalization.
- Lexical object retrieval plus vector and hybrid execution when query embeddings and stored vectors are available.
- Grounded generation with citation-identifier membership checks and explicit insufficient-context outcomes.
- Explainable identity alignment, direct cross-domain relations, and two-segment paths through explicit bridge objects; every relation segment requires governed direct evidence and human approval before canonical application.
- Image relevance, merge, and interdisciplinary review plus strict quality and graph-integrity checks.
- PostgreSQL-backed APIs and React workspaces for graph, interdisciplinary, textbook, annotation, and pipeline operations.

```mermaid
flowchart LR
    A["PDF or MinerU Markdown"] --> B["Outline and lesson planning"]
    B --> C["Lesson workers"]
    C --> D["world_staging_* tables"]
    D --> E["Reducer and normalization"]
    E --> F["Canonical world_* knowledge store"]
    F --> K["Interdisciplinary candidate scan"]
    K --> L["Human evidence review"]
    L -->|Apply approved candidates separately| F
    K --> G["Strict QA, graph integrity, and quality dashboard"]
    F --> H["ApiUnit assembly"]
    H --> I["Search and grounded generation"]
    H --> J["Viewer and review workbench"]
```

Lesson workers may write only `world_lesson_runs` and `world_staging_*`. Canonical `world_*` writes, duplicate resolution, remapping, and final QA state belong to reducer, normalization, and approved interdisciplinary-application steps.

## Product surfaces

| Source-to-object traceability | Retrieval and grounded-generation interface |
| --- | --- |
| ![Synthetic source tree linked to a complete knowledge object and evidence](docs/assets/report/unit-detail.png) | ![Grounded-generation query panel over the synthetic knowledge graph](docs/assets/report/grounded-answer.png) |

### Evidence-grounded runtime

The runtime retrieves complete `ApiUnit` objects and checks that generated citation identifiers belong to the retrieved evidence set; this membership check does not prove semantic entailment. Hybrid retrieval falls back to lexical results and reports `mode=text_only` when vector execution is unavailable. Grounded generation requires a model endpoint configured by the operator; the bundled demo itself does not call a model API.

## Standards and contracts

The project separates three versioned layers:

| Layer | Current name | Purpose |
| --- | --- | --- |
| Conceptual system standard | `ai-nks-v0.2` | Canonical Knowledge Objects, Domain Profiles, Curriculum Projections, bridge objects, runtime, and governance boundaries |
| Executable engineering schema | `world-v1.3` | Current PostgreSQL tables, JSON Schemas, domain schemas, Chinese relation semantics, source policies, and evidence rules |
| Public consumption contract | `ApiUnit` | Complete object view used by the viewer, retrieval, and grounded-generation runtime |

See [the theory decision record](docs/theory-decision-record.md), [AI-NKS v0.2](docs/ai-nks-v0.2.md), [the interdisciplinary knowledge network contract](docs/interdisciplinary-knowledge-network.md), and [the knowledge unit contract](docs/knowledge-unit-contract.md).

## One-command local fixture

Requirements: Node.js 22+, npm, Docker, and Docker Compose.

```bash
npm install
npm run demo
```

Open <http://127.0.0.1:8765/viewer/>. The command starts PostgreSQL, creates an isolated `okm_demo` database, loads the self-authored graph, builds the application, and starts the server. It does not modify the default `knowledge` database and does not require a model API key. See [the demo documentation](examples/demo-data/README.md) for its exact contents and interpretation boundary.

To initialize only the demo database:

```bash
npm run demo:seed
```

## Process material you are authorized to use

Initialize the normal application database:

```bash
docker compose up -d postgres
export DATABASE_URL=postgresql://okm:okm@127.0.0.1:5432/knowledge
docker compose exec -T postgres psql -U okm -d knowledge < schemas/pg/knowledge_store.sql
```

Configure the services needed by the extraction flow:

```bash
export MINERU_API_KEY=your_mineru_token
export OPENAI_API_KEY=your_model_api_key

# Optional image review model
export VLM_API_URL=http://localhost:8000/v1/chat/completions
export VLM_API_KEY=your_vision_model_api_key
export VLM_MODEL=gpt-4.1-mini

# Optional; no embedding endpoint is used unless explicitly configured
export EMBEDDING_URL=https://your-provider.example/v1/embeddings
export EMBEDDING_API_KEY=your_embedding_api_key
export EMBEDDING_MODEL=your_embedding_model
```

Run the end-to-end TypeScript pipeline:

```bash
npm run server-pipeline-run -w packages/pipeline -- \
  --book-id physics-example \
  --pdf-path /absolute/path/to/book.pdf \
  --subject physics \
  --school-stage junior-secondary \
  --grade-band grade-8 \
  --skip-embeddings \
  --db "$DATABASE_URL"
```

If the PDF is already available at a public URL, use `--mineru-file-url` instead of `--pdf-path`. Remove `--skip-embeddings` only after configuring an embedding endpoint you trust.

After canonical normalization, the default pipeline generates knowledge bodies and curriculum- and stage-scoped pedagogical profiles before the optional embedding stages and final quality checks. Domain semantics remain in `world_domain_profiles`; teaching placement and pedagogical content live in `world_curriculum_projections.properties_json.pedagogical_profile`. Generated entries retain evidence references, model and prompt metadata, an input fingerprint, confidence, and review state. Identifier membership checks are not semantic entailment judgments, so generated profiles remain pending review. To rerun that stage separately:

```bash
npm run generate-pedagogical-profiles -w packages/pipeline -- \
  --dataset-id main \
  --book-id physics-example \
  --school-stage junior-secondary \
  --grade-band grade-8 \
  --db "$DATABASE_URL" \
  --pretty
```

The default pipeline then scans for interdisciplinary candidates without changing canonical nodes or edges. You can also scan separately and review candidates in the Interdisciplinary workspace:

```bash
npm run interdisciplinary-analyze -w packages/pipeline -- \
  --dataset-id main \
  --db "$DATABASE_URL" \
  --pretty
```

Direct-relation approval requires governed evidence, a Chinese relation selection, and direction. Bridge paths require per-segment relation and direct-evidence review. Apply approved candidates in the dataset-locked reducer step:

```bash
npm run interdisciplinary-apply -w packages/pipeline -- \
  --dataset-id main \
  --db "$DATABASE_URL" \
  --pretty
```

Names, aliases, semantic keys, and topic tags are discovery signals rather than factual evidence. Approved identity alignments merge canonical objects; approved direct relations and bridge-path segments enter the single canonical `world_edges` table only after the separate apply step. The retired `same_as` relation is never created. See [the interdisciplinary contract](docs/interdisciplinary-knowledge-network.md) for the full boundary.

This flow can transfer content to external services: MinerU receives the PDF or public file URL; the configured language-model endpoint receives lesson text and, during later stages, normalized node, card, relation, and evidence context for body and pedagogical-profile generation; the optional vision endpoint receives selected image context; and an explicitly configured embedding endpoint receives object text. Review each provider's data-handling terms before processing private, licensed, personal, or institution-confidential material. The demo path above performs none of these transfers.

## Verification

Run the repository verification suite:

```bash
npm run verify
```

The command performs TypeScript checks, pipeline, server, and viewer tests, and production builds. Database-backed quality checks are available separately:

```bash
npm run strict-qa -w packages/pipeline -- \
  --dataset-id main \
  --db "$DATABASE_URL"

npm run graph-integrity -w packages/pipeline -- \
  --dataset-id main \
  --db "$DATABASE_URL"
```

## Repository layout

```text
packages/types      Shared models and API contracts
packages/pipeline   Extraction, staging, reducers, normalization, and QA
packages/server     Hono API, PostgreSQL query layer, and runtime
packages/viewer     React/Vite graph and review workbench
schemas             JSON Schemas, PostgreSQL DDL, and knowledge standards
examples/demo-data  Repository-authored populated demo
examples/sample-data Legacy import fixtures; audit rights before public release
experiments         Reproducible experiment source, schemas, and reviewed fixtures/reports
docs                Theory, architecture, contracts, reports, and run notes
artifacts           Versioned, read-only public result layers
```

PostgreSQL is the only canonical application store. Generated `data`, `runs`, `storage`, `tmp`, and local model artifacts are not canonical source files.

## Research status

The implemented system demonstrates governed object extraction, evidence preservation, structured unit assembly, retrieval, citation-identifier membership checks, and an interdisciplinary candidate-review loop. It does **not** yet establish semantic entailment for every generated claim, complete cross-domain discovery, that the graph is pedagogically optimal, or that object-level retrieval improves learning outcomes.

The hosted artifact and populated fixture are structural and interface releases, not paper-grade benchmarks. The repository includes pilot and ablation scaffolding plus reviewed summary reports, but adjudicated multi-subject labels, completed independent human review, fully reproducible external baselines, and learning-outcome evaluation remain open work.

## Data rights, license, and citation

- Read [PROVENANCE.md](PROVENANCE.md) before adding or redistributing source material or derived data.
- A public code/data license has **not yet been selected**. Until a root `LICENSE` file is added, do not assume permission to redistribute or create derivative releases.
- The hosted `knowledge/main` artifact is available for public inspection, but its source PDF reserves rights and no applicable open license or explicit redistribution permission is recorded; see its [source manifest](artifacts/okm-public-v0.1.0/SOURCES.md) and [rights boundary](artifacts/okm-public-v0.1.0/RIGHTS.md).
- Citation metadata is available in [CITATION.cff](CITATION.cff).
- Security-sensitive reports should follow [SECURITY.md](SECURITY.md).

The contribution workflow is documented in [CONTRIBUTING.md](CONTRIBUTING.md), but public contributions should open only after the project selects a root license and confirms inbound terms.

## Current release boundary

The repository currently exposes an early Knowledge Runtime for object retrieval and citation-identifier-checked generation, plus a versioned read-only `ApiUnit` result layer. The hosted page is a preview artifact rather than a tagged GitHub Release. Semantic planning, adaptive tutoring, learner-state feedback, mature version governance, and large-scale expert evaluation remain future work.
