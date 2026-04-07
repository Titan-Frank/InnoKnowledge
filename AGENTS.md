# Knowledge Map Extraction Project

Turn textbook content into a stable, evidence-backed, cross-disciplinary knowledge map.

## Quick Links

| Document | Purpose |
|----------|---------|
| [GLOSSARY.md](./GLOSSARY.md) | Standardized terminology |
| [CONVENTIONS.md](./CONVENTIONS.md) | Coding and documentation standards |
| [STYLE_GUIDE.md](./STYLE_GUIDE.md) | Writing style guidelines |
| [schemas/v2/](./schemas/v2/) | JSON schemas for all artifacts |

## Core Principles

1. **Global-first, not textbook-first** - The graph serves cross-disciplinary knowledge, not one book
2. **Backbone + Support layers** - Separate core concepts from auxiliary content
3. **Evidence-backed** - Every node and edge must have textbook provenance
4. **Retrieval-first extraction** - Retrieve candidates before reasoning; never operate on full graph
5. **SQLite-first** - SQLite is the primary write layer; JSON is derived export
6. **Non-destructive** - Append rather than replace; explicit deletion requires user approval

## Architecture (Manager-Worker Pattern)

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
│  @lesson-processor  - Complete lesson workflow:            │
│                       ├─ $chapter-extract (skill)          │
│                       ├─ @node-expander (parallel Tasks)   │
│                       ├─ $graph-normalize (skill)          │
│                       │   ├─ Node deduplication            │
│                       │   ├─ Edge consolidation            │
│                       │   ├─ Cycle detection               │
│                       │   └─ Isolated node resolution      │
│                       ├─ run_sqlite_batch_pipeline.py      │
│                       └─ @qa-reviewer                      │
│  @qa-reviewer       - Quality validation (read-only)       │
├─────────────────────────────────────────────────────────────┤
│  Layer 3: Skills (Implementation Logic)                      │
│  ─────────────────────────────────                         │
│  $textbook-outline  - Structure extraction                 │
│  $chapter-extract   - Lesson-level extraction              │
│  $graph-normalize   - Deduplication + structure repair     │
│  $knowledge-schema  - Schema enforcement                   │
└─────────────────────────────────────────────────────────────┘
```

**Key Design**:
- **Manager (@kg-pipeline)**: Only spawns Tasks and monitors results. No extraction logic.
- **Workflow Agent (@lesson-processor)**: Encapsulates complete lesson processing. All business logic lives here.
- **Clear Separation**: Manager decides "what", Workflow Agent knows "how".

## Default Entry

Use `@kg-pipeline` for:
- Generic extraction requests
- "Extract this book/lesson"
- "Build knowledge map"

Use specialized Agents/Skills directly only when explicitly requested or resuming a specific stage.

## Workflow Overview (Serial Lesson-by-Lesson with Immediate Expansion)

```
outline ──→ [extract + expand] ──→ normalize ──→ qa
```

**⚠️ Serial Execution Required**: Lessons must be processed sequentially to avoid duplicate nodes and inconsistent relations across shared concepts.

**⚠️ Task-Per-Lesson (CRITICAL)**: Each lesson MUST be processed in a separate, isolated Task:
  - Manager (@kg-pipeline) spawns ONE Task per lesson using `task()` tool
  - Each Task has fresh LLM context (no accumulation)
  - Task completes and returns → Manager spawns next Task
  - **NEVER** process multiple lessons in one continuous context
  - **NEVER** let a subagent continue to next lesson autonomously

**Why isolated Tasks matter**:
  - Prevents context explosion (LLM context stays manageable)
  - Ensures each lesson sees latest SQLite state
  - Enables correct retrieval-based deduplication
  - Isolates failures to single lesson

1. **Outline** (`@outline-reader` + `$textbook-outline`): Create `data/outlines/{book-id}.outline.json`
2. **Lesson Processing** (`@lesson-processor`):
   - **Extract** (`extract_lesson_sqlite.py`):
     - Process **one lesson at a time** in outline order
     - **Direct INSERT** into SQLite tables (nodes, edges, profiles, mentions, evidence)
     - No JSONL intermediate files
   - **Expand** (`expand_node_sqlite.py`):
     - For **each new backbone node**: spawn **independent Task** → direct INSERT into `node_cards`
     - Each expansion runs in **fresh isolated context** (max stability)
     - Multiple nodes can expand **concurrently** within the same lesson
   - **Normalize** (`normalize_sqlite.py`): Deduplicate, merge aliases, detect cycles, resolve isolated nodes, normalize node cards **after each lesson**
   - **QA** (`strict_qa_sqlite.py`): Read-only review including node card completeness **after each lesson**

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

**JSONL/JSON files are DERIVED EXPORTS only.** Do not treat them as primary storage. Generate them from SQLite only through the current SQLite-native export helpers when an external consumer needs them.

### Deprecated Components (moved to `/deprecated/`)

| Component | Reason | Replacement |
|-----------|--------|-------------|
| `scripts/apply_batch_artifacts.py` | JSON→SQLite conversion no longer needed | `extract_lesson_sqlite.py` (direct INSERT) |
| `scripts/import_to_sqlite.py` | JSON→SQLite conversion no longer needed | Direct writes from extraction scripts |
| `data/{version}/graph/*.jsonl` | No longer generated as intermediate | Export from SQLite if needed |
| `data/{version}/node_cards/*.json` | No longer generated as intermediate | SQLite `node_cards` table |

## Critical Constraints

### Whole-Book Rule
Never process a whole textbook as one extraction context unless explicitly requested.

For whole-book work: **process lessons sequentially**, one at a time. Each lesson must complete normalize, closeout, and QA before moving to the next.

**No parallel execution** for lessons with potentially overlapping concepts (which is typical for textbook chapters). Serial execution ensures:
- No duplicate canonical nodes
- Consistent edge endpoints
- Proper retrieval-based deduplication

### Stage Dependencies
Manifest order is always: `backbone` → `normalize` → `qa`

Each lesson must complete all stages:
1. `backbone` - Nodes created with immediate node card generation
2. `normalize` - Deduplication, cycle detection, isolated node resolution, and card normalization
3. `qa` - Schema validation including node card completeness

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

### Task-Per-Lesson Execution (CRITICAL)
- [ ] Each lesson processed in separate, isolated Task
- [ ] Main agent spawns Task for lesson N, waits for completion
- [ ] Main agent then spawns Task for lesson N+1
- [ ] No subagent continues to next lesson autonomously
- [ ] Manifest shows sequential lesson completion (not batch)
- [ ] Each Task returns before next Task spawns

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

The following scripts have been **deprecated** and moved to `/deprecated/`:

| Script | Status | Reason |
|--------|--------|--------|
| `extract_chemistry_complete.py` | ❌ REMOVED | Directly writes JSONL, bypasses SQLite |
| `extract_chemistry_v4.py` | ❌ REMOVED | Directly writes JSONL, bypasses SQLite |

### Why They Were Deprecated

These scripts violated the **SQLite-first principle**:
- They wrote directly to `data/main/graph/*.jsonl` files
- They never updated `storage/knowledge.sqlite`
- This caused **data inconsistency**: SQLite had 85 nodes while JSONL had 145
- The Viewer API (which reads SQLite) could not see the new data

### Correct Alternatives

**For extraction:**
- Use `$chapter-extract` skill (writes to SQLite)
- Use `scripts/run_single_lesson.py` (orchestrates correct workflow)
- **Process lessons sequentially**, not in parallel

**For viewing data:**
- Use `scripts/viewer_sqlite_api.py` (serves from SQLite)
- Never read JSONL directly for canonical data

### Data Validation

Always verify data consistency after extraction:

```bash
# Check SQLite vs JSONL consistency
python check_data_consistency.py

# If inconsistent, stop and repair the active SQLite-native workflow.
# Do not re-import JSONL back into SQLite.
```

See [PIPELINE_SAFETY.md](./PIPELINE_SAFETY.md) for detailed safety guidelines.
