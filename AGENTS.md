# Knowledge Map Extraction Project

Turn textbook content into a stable, evidence-backed, cross-disciplinary knowledge map.

## Quick Links

| Document | Purpose |
|----------|---------|
| [GLOSSARY.md](./.claude/GLOSSARY.md) | Standardized terminology |
| [CONVENTIONS.md](./.claude/CONVENTIONS.md) | Coding and documentation standards |
| [STYLE_GUIDE.md](./.claude/STYLE_GUIDE.md) | Writing style guidelines |
| [schemas/v2/](./schemas/v2/) | JSON schemas for all artifacts |

## Core Principles

1. **Global-first, not textbook-first** - The graph serves cross-disciplinary knowledge, not one book
2. **Backbone + Support layers** - Separate core concepts from auxiliary content
3. **Evidence-backed** - Every node and edge must have textbook provenance
4. **Retrieval-first extraction** - Retrieve candidates before reasoning; never operate on full graph
5. **SQLite-first** - SQLite is the primary write layer; JSON is derived export
6. **Non-destructive** - Append rather than replace; explicit deletion requires user approval

## Architecture (Parallel Staging + Canonical Commit)

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: Manager (Pure Orchestrator - NO business logic)    │
│  ─────────────────────────────────                         │
│  @kg-pipeline       - Plan, Spawn, Monitor, Decide         │
│                      (Only tracks state, no extraction)     │
├─────────────────────────────────────────────────────────────┤
│  Layer 2: Workflow Agents (Complete Business Logic)          │
│  ─────────────────────────────────                         │
│  @outline-reader    - Extract structure (standalone)       │
│  @lesson-processor  - Parallel lesson extractor:           │
│                       ├─ /chapter-extract (skill)          │
│                       ├─ raw nodes / edges / evidence      │
│                       └─ store_lesson_staging.py           │
│  @kg-reducer        - Canonical merge worker:              │
│                       ├─ merge_staged_lessons.py           │
│                       ├─ normalize_sqlite.py               │
│                       └─ strict_qa_sqlite.py               │
│  @qa-reviewer       - Quality validation (read-only)       │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: Skills (Implementation Logic)                      │
│  ─────────────────────────────────                         │
│  /textbook-outline  - Structure extraction                 │
│  /chapter-extract   - Lesson-level extraction              │
│  /graph-normalize   - Deduplication + structure repair     │
│  /knowledge-schema  - Schema enforcement                   │
└─────────────────────────────────────────────────────────────┘
```

**Key Design**:
- **Manager (@kg-pipeline)**: Only spawns Tasks and monitors results. No extraction logic.
- **Lesson worker (@lesson-processor)**: Extracts one lesson in isolated context and writes only to staging tables.
- **Reducer (@kg-reducer)**: Owns canonical alignment, deduplication, graph commit, normalize, and QA.
- **Clear Separation**: Parallel workers produce candidates; the reducer decides canonical truth.

## Default Entry

Use `@kg-pipeline` for:
- Generic extraction requests
- "Extract this book/lesson"
- "Build knowledge map"

Use specialized Agents/Skills directly only when explicitly requested or resuming a specific stage.

## Workflow Overview (Parallel Lesson Staging with Serial Canonical Commit)

```
outline ──→ parallel lesson extract ──→ staging_* ──→ global align/merge ──→ normalize ──→ qa
```

**⚠️ Parallel lesson extraction is allowed** only if workers write to `lesson_runs` + `staging_*` tables and never mutate canonical tables directly.

**⚠️ Task-Per-Lesson remains critical**:
  - Manager spawns independent lesson Tasks with fresh LLM context.
  - Each Task extracts exactly one lesson and calls `store_lesson_staging.py`.
  - Multiple lesson Tasks may run concurrently.
  - No lesson worker may write `nodes`, `edges`, `profiles`, `mentions`, `evidence`, or `node_cards` directly.

**Why this split matters**:
  - Keeps LLM contexts isolated and parallelizable.
  - Defers duplicate resolution to one canonical reducer pass.
  - Preserves append-first SQLite semantics.
  - Allows global semantic alignment across many lessons before commit.

1. **Outline** (`@outline-reader` + `/textbook-outline`): Create `data/outlines/{book-id}.outline.json`
2. **Parallel Lesson Staging** (`@lesson-processor`):
   - Extract one lesson in isolated context.
   - Produce raw nodes, edges, profiles, mentions, evidence, and provisional node cards.
   - Store outputs via `scripts/store_lesson_staging.py`.
3. **Canonical Merge** (`@kg-reducer`):
   - Run `scripts/merge_staged_lessons.py`.
   - Align nodes semantically using lexical normalization + semantic keys + embeddings.
   - Remap edges, mentions, evidence, profiles, and node cards to canonical IDs.
4. **Closeout**:
   - Run `scripts/run_parallel_lesson_pipeline.py` or equivalent reducer sequence.
   - `normalize_sqlite.py` repairs residual duplicates and graph structure.
   - `strict_qa_sqlite.py` blocks on schema or provenance failures.

## Output Contract

Active storage: `storage/knowledge.sqlite`

| Artifact | SQLite Table | Notes |
|----------|--------------|-------|
| Outline | `data/outlines/{book-id}.outline.json` | JSON (source of truth for structure) |
| Run manifest | `{root}/runs/{book-id}.pipeline.json` | JSON (tracking only) |
| Canonical nodes | `nodes` | SQLite PRIMARY storage |
| Canonical edges | `edges` | SQLite PRIMARY storage |
| Curriculum profiles | `profiles` | SQLite PRIMARY storage |
| Mentions | `mentions` | SQLite PRIMARY storage |
| Evidence | `evidence` | SQLite PRIMARY storage |
| Node cards | `node_cards` | SQLite PRIMARY storage |
| Lesson runs | `lesson_runs` | Parallel extraction run registry |
| Staged nodes | `staging_nodes` | Raw lesson-local node candidates |
| Staged edges | `staging_edges` | Raw lesson-local edge candidates |
| Staged profiles | `staging_profiles` | Raw lesson-local profile candidates |
| Staged mentions | `staging_mentions` | Raw lesson-local mention candidates |
| Staged evidence | `staging_evidence` | Raw lesson-local evidence candidates |
| Staged cards | `staging_node_cards` | Provisional lesson-local node cards |
| Merge runs | `merge_runs` | Canonical reducer run registry |
| Canonical map | `canonical_node_map` | Raw node → canonical node mapping |

**JSONL/JSON files are DERIVED EXPORTS only.** Do not treat them as primary storage. Generate them from SQLite only through the current SQLite-native export helpers when an external consumer needs them.

### Deprecated Components

| Component | Reason | Replacement |
|-----------|--------|-------------|
| `scripts/apply_batch_artifacts.py` | JSON→SQLite conversion no longer needed | `store_lesson_staging.py` (staging INSERT) |
| `scripts/import_to_sqlite.py` | JSON→SQLite conversion no longer needed | `store_lesson_staging.py` + `merge_staged_lessons.py` |
| `data/{version}/graph/*.jsonl` | No longer generated as intermediate | Export from SQLite if needed |
| `data/{version}/node_cards/*.json` | No longer generated as intermediate | SQLite `node_cards` table |

## Critical Constraints

### Whole-Book Rule
Never process a whole textbook as one extraction context unless explicitly requested.

For whole-book work:
- Extract lessons in isolated Tasks.
- Lessons may run **in parallel** during staging.
- Canonical merge, normalize, and QA remain **serial reducer stages**.
- Do not let multiple workers write canonical tables concurrently.

### Stage Dependencies
Manifest order is now: `staging` → `merge` → `normalize` → `qa`

Each selected lesson run must complete:
1. `staging` - Raw artifacts inserted into `staging_*`
2. `merge` - Canonical node alignment and graph commit
3. `normalize` - Deduplication, cycle detection, isolated node resolution, and card normalization
4. `qa` - Schema validation including node card completeness

Do not mark a later stage complete while an earlier required stage is pending.

### Blocker Policy
If strict QA fails, **halt** the pipeline, record the batch as blocked, report issues before continuing.

Missing batch-local mentions or broken mention-to-evidence links are blockers.

### Preservation
- Append-first, non-destructive by default
- Absence from current lesson is not evidence for deletion
- Explicit user instruction required for deletion
- If rerun would shrink coverage, stop and report conflict

## Required Schemas

Read these before writing output:

- `schemas/framework.schema.json`
- `schemas/outline.schema.json`
- `schemas/v2/node.schema.json`
- `schemas/v2/edge.schema.json`
- `schemas/v2/curriculum-profile.schema.json`
- `schemas/v2/mention.schema.json`
- `schemas/v2/evidence.schema.json`
- `schemas/v2/node-card.schema.json`
- `schemas/v2/pattern-library.schema.json`

## Review Checklist

### Parallel Lesson Staging (CRITICAL)
- [ ] Each lesson is processed in a separate, isolated Task
- [ ] Every lesson worker writes only to `lesson_runs` + `staging_*`
- [ ] No lesson worker writes canonical graph tables directly
- [ ] Reducer merges staged lessons before normalize/QA
- [ ] Canonical merge records raw→canonical mapping in `canonical_node_map`
- [ ] Normalize and QA run after canonical merge, not before

### Schema Validation
- [ ] Schema-valid fields only
- [ ] All required fields present in every record type

### Canonical Nodes
- [ ] Every node has valid `node_kind` and `node_layer`
- [ ] Every backbone node has `card_ref` pointing to node card
- [ ] Every backbone node has at least one `bridge_tags`
- [ ] Every backbone node has at least one `learning_modes`
- [ ] **`entity/substance` nodes SHOULD have meaningful `properties`** (color, state, odor, etc.)
  - If empty, check `notes` field for explanation
- [ ] **`activity/experiment` nodes SHOULD have `properties`** with method/steps/materials
  - If empty, check `notes` field for explanation
- [ ] **`entity/equipment` nodes SHOULD have `properties`** with instrument_type
  - If empty, check `notes` field for explanation
- [ ] No duplicate nodes differing only by whitespace/punctuation/aliases

### Support Nodes (RECOMMENDED)
- [ ] **Lessons with experiments/activities SHOULD have support nodes**
  - `activity/experiment` for experiments
  - `method` for procedures
  - `entity/equipment` for instruments
  - `representation` for formulas/diagrams
- [ ] **If no support nodes, check lesson content type**:
  - Concept/theory lessons may not have experiments
  - Review/introductory lessons may not have new methods
- [ ] Support nodes have `node_layer="support"` (not backbone)

### Curriculum Profiles (课程画像)
- [ ] **Every backbone node has a corresponding profile**
- [ ] Profile contains required: subject, school_stage, grade_band
- [ ] Profile has valid curriculum_role and mastery_level
- [ ] Profile has at least one `learning_objectives`
- [ ] Profile links to current lesson via `textbook_refs`

### Evidence (出处)
- [ ] **Every mention has at least one evidence record**
- [ ] No evidence without anchor_ref
- [ ] Evidence excerpt is non-empty and from actual textbook text
- [ ] Evidence has valid locator (page number and location)
- [ ] Evidence modality specified (text/image/table/equation)

### Mentions (提及)
- [ ] **Every backbone node has at least one mention**
- [ ] Mention has valid target_type="node" and target_id
- [ ] Mention has valid role (introduces/defines/focuses_on/demonstrates/etc.)
- [ ] Mention confidence is set (0.0-1.0)

### Node Cards (详细节点卡片)
- [ ] **Every backbone node has a node card** (generated during extraction)
- [ ] **Node card has non-empty summary** (100-200 words)
- [ ] **Node card has all required sections** per pattern-library template:
  - definition (定义) - from textbook evidence
  - essence (核心本质) - distilled understanding
  - key_points (关键要点) - 3-5 bullet points
  - example (示例) - from current lesson
  - application (应用) - practical scenarios
  - misconception (常见误解) - if applicable
- [ ] Each section has source_refs linking to evidence
- [ ] Node card sections use evidence from current lesson (fresh context)
- [ ] No node card references missing or non-existent evidence
- [ ] Node card has card_layer="backbone"

### Edges (关系)
- [ ] Every edge has valid `edge_type` from allowed enum
- [ ] Every edge has valid `edge_layer` and `backbone_expand`
- [ ] Every edge has source_refs linking to evidence
- [ ] No edge with missing endpoints (from/to must exist in graph)
- [ ] No relation promoted without explicit evidence
- [ ] **No cycles in hierarchical edges** (is_a, part_of, prerequisite_for, etc.)
- [ ] **No excessive isolated nodes** (nodes with no edges)
- [ ] **No duplicate edges** (same from/to/type)

### Graph Connectivity (Normalized during normalization phase)
- [ ] **Hierarchical edges are acyclic**:
  - `is_a`, `instance_of`, `contains`, `part_of` - NO cycles
  - `prerequisite_for`, `depends_on`, `extends` - NO cycles
- [ ] **Association edges may cycle**:
  - `related_to`, `explains`, `uses`, `produces` - cycles OK
- [ ] **Isolated nodes resolved**:
  - Backbone nodes must have edges (resolved during normalization)
  - Support nodes may be isolated with documented reason in `notes`
  - Intentional isolation documented in `notes` field
- [ ] **Graph is reasonably connected**:
  - No excessive disconnected components
  - Most nodes should have at least one edge

### Completeness Blockers
If any of the following are missing, extraction is INCOMPLETE:
- [ ] Missing canonical node for extracted concept
- [ ] Missing curriculum profile for backbone node
- [ ] Missing evidence for textbook excerpt
- [ ] Missing mention linking node to lesson
- [ ] Missing node card for backbone node
- [ ] Missing required sections in node card

### Quality Warnings (NOT blockers)
The following indicate quality issues but do NOT block extraction:
- [ ] **Missing properties for substance/experiment/equipment nodes** (check `notes` for reason)
- [ ] **Missing support nodes in lesson** (check lesson content type)
- [ ] **Support nodes marked as backbone instead of support layer**
- [ ] **Duplicate edges detected** (same from/to/type combination)

## Graph Integrity Checks

After normalization, graph integrity is validated:

```bash
# Basic QA validation (read-only verification)
python scripts/strict_qa_sqlite.py --dataset-id main

# Detailed graph integrity check (cycles, isolated nodes, connectivity)
# Run independently if needed for deeper analysis
python scripts/check_graph_integrity.py --dataset-id main

# If cycles found in hierarchical edges (should not happen after normalization)
python scripts/check_graph_integrity.py --dataset-id main --fail-on-cycles
```

### Cycle Detection (Performed during normalization)

Hierarchical edges MUST NOT form cycles:
- `is_a` - Type hierarchy cannot loop
- `part_of` - Part-whole hierarchy cannot loop
- `prerequisite_for` - Dependency chains must be acyclic

Association edges MAY form cycles:
- `related_to`, `explains`, `uses`, `produces` - cycles are acceptable

### Isolated Node Detection (Performed during normalization)

Isolated nodes (nodes with NO edges) are resolved during normalization:
- Backbone nodes must have edges added (with evidence support)
- Support nodes may remain isolated with documented reason
- Intentional isolation is documented in `notes` field
- Excessive isolated nodes (>10% of backbone) blocks pipeline

## Instruction Ownership

Resolution order (highest priority first):
1. User request
2. **AGENTS.md** (this file)
3. Agent file
4. Skill file
5. Reference file

See [CONVENTIONS.md](./CONVENTIONS.md) for documentation standards.

## ⚠️ Critical: Deprecated Scripts

### DO NOT USE

| Script | Status | Reason |
|--------|--------|--------|
| `extract_chemistry_complete.py` | ❌ REMOVED | Directly writes JSONL, bypasses SQLite |
| `extract_chemistry_v4.py` | ❌ REMOVED | Directly writes JSONL, bypasses SQLite |
| `insert_batch.py` | ⚠️ LEGACY | Writes canonical tables directly, bypasses staging |

### Why They Were Deprecated

These scripts violated the **SQLite-first** or **staging-first** principle:
- They wrote directly to JSONL or canonical SQLite tables
- They bypassed the staging→reducer workflow
- This caused **data inconsistency** and duplicate nodes

### Correct Alternatives

**For extraction:**
- Use `/chapter-extract` skill (produces lesson-local artifacts)
- Use `scripts/store_lesson_staging.py` (writes staging tables with auto-embedding)
- Use `scripts/merge_staged_lessons.py` (merges staging → canonical with semantic alignment)

**For viewing data:**
- Use `scripts/viewer_sqlite_api.py` (serves from SQLite)
- Never read JSONL directly for canonical data

### Data Validation

Always verify data consistency after extraction:

```bash
# QA validation
python scripts/strict_qa_sqlite.py --dataset-id main

# Graph integrity check
python scripts/check_graph_integrity.py --dataset-id main
```
