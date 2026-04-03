---
name: chapter-extract
description: Extracts one lesson or small page range into evidence-backed canonical updates, curriculum profiles, mentions, and evidence.
---

# Chapter Extract

## ⚠️ CRITICAL: Single Lesson Scope Only

**This skill processes EXACTLY ONE lesson. DO NOT continue to next lesson.**

- ✅ Process lesson 1-1-1 → STOP
- ❌ Process lesson 1-1-1 → lesson 1-1-2 → lesson 1-1-3 (WRONG)

If you need to process multiple lessons, the caller must:
1. Call this skill for lesson 1-1-1
2. Wait for completion
3. Spawn a new Task for lesson 1-1-2
4. Repeat for each lesson

**Violating this rule causes**:
- Context explosion (LLM context exceeds limits)
- Cross-lesson contamination
- Inconsistent deduplication

---

Extract knowledge from one lesson or tightly scoped page range at a time. This skill implements the complete extraction workflow including pre-flight checks, evidence chunking, retrieval-first candidate selection, and SQLite persistence.

## Quick Start

Process one lesson:

```bash
# This skill is called by @kg-pipeline with proper context
# Direct usage requires specifying:
#   --output-root
#   --batch-anchor (e.g., struct:chem-grade8:lesson:1-1-1)
#   --book-md-path
```

## Workflow

### Phase 1: Pre-flight

Before processing, ensure:

1. Read `../../AGENTS.md` for project principles
2. Read `../../GLOSSARY.md` for terminology
3. Resolve `--output-root` (active versioned directory)
4. Verify `--batch-anchor` is valid outline ID
5. Check SQLite dataset exists and is accessible
6. Read required schemas:
   - `schemas/v2/node.schema.json`
   - `schemas/v2/edge.schema.json`
   - `schemas/v2/curriculum-profile.schema.json`
   - `schemas/v2/mention.schema.json`
   - `schemas/v2/evidence.schema.json`
7. Read reference: `references/extraction-rules.md`

### Phase 2: Load and Chunk

1. Locate lesson scope from `data/outlines/{book-id}.outline.json`
2. Read OCR-completed markdown source for target lesson
3. Split into **evidence-bearing units**:
   - Definition paragraphs
   - Example paragraphs
   - Experiment step blocks
   - Figure captions
   - Table row groups
4. Create evidence records first (before nodes)

### Phase 3: Retrieval-First Processing

For each evidence unit:

1. **Extract candidates**
   - Identify key concepts, entities, relationships
   - Prepare query payloads

2. **Retrieve existing nodes**
   ```bash
   scripts/retrieve_candidates.py \
     --output-root <root> \
     --query "<concept>" \
     --mode hybrid
   ```
   - Default: `--mode hybrid` (lexical + semantic)
   - Fallback: `--mode mix` when lexical recall is weak

3. **Apply hard filters**
   - Filter by `node_kind`
   - Filter by `subject`
   - Filter by `school_stage`
   - Filter by `grade_band`

4. **Local subgraph reasoning**
   ```bash
   scripts/local_subgraph.py \
     --output-root <root> \
     --seed-nodes <candidates>
   ```
   - Inspect narrow neighborhood
   - Never widen to whole graph

5. **Decision**
   - High similarity (>0.85)? → Reuse existing node
   - Semantic description match? → Reuse existing node
   - Otherwise → Create new node

### Phase 4: Build Complete Artifacts for Each Node

**⚠️ CRITICAL: Follow this extraction order and completeness requirements.**

#### Step 4.1: Identify All Node Types

For each lesson, identify and extract:

1. **Backbone nodes** (核心概念):
   - Core concepts and principles
   - Key substances and entities
   - Stable cross-lesson knowledge anchors

2. **Support nodes** (支撑节点) - **RECOMMENDED where applicable**:
   - `activity/experiment` - Experiments and activities described in lesson
   - `method` - Procedures and operations (heating, filtering, testing, etc.)
   - `entity/equipment` - Instruments and tools mentioned
   - `representation` - Formulas, equations, diagrams, symbols

**Note**: Not all lessons have experiments or equipment. If no support nodes found:
- Verify lesson content type (concept/theory lessons may not have experiments)
- Document in extraction result why no support nodes were extracted

#### Step 4.2: Extract Properties (RECOMMENDED for specific node types)

**Entity/Substance nodes SHOULD have properties**:
```json
{
  "node_kind": "entity",
  "node_subkind": "substance",
  "properties": {
    "color": "无色",
    "odor": "无味",
    "state": "气体"
  },
  "notes": null
}
```

**If properties are empty**:
```json
{
  "node_kind": "entity",
  "node_subkind": "substance",
  "properties": {},
  "notes": "Textbook only mentions substance name, no detailed physical/chemical properties described"
}
```

**Activity/Experiment nodes SHOULD have properties**:
```json
{
  "node_kind": "activity",
  "node_subkind": "experiment",
  "properties": {
    "method": "观察法",
    "steps": ["点燃镁条", "观察现象"],
    "materials": ["镁条", "酒精灯"]
  }
}
```

**Entity/Equipment nodes SHOULD have properties**:
```json
{
  "node_kind": "entity",
  "node_subkind": "equipment",
  "properties": {
    "instrument_type": "玻璃仪器",
    "usage": "用于过滤操作"
  }
}
```

**Validation**: If properties are empty, check if `notes` field has explanation.

#### Step 4.3: Build Complete Artifacts for Each Node

Every new backbone node must include **ALL FIVE categories** of content:

#### 1. Canonical Node (Required Fields)
```json
{
  "id": "entity/substance:oxygen",
  "canonical_name": "氧气",
  "node_kind": "entity",
  "node_subkind": "substance",
  "node_layer": "backbone",
  "aliases": ["O₂", "氧", "oxygen"],
  "definition": "由氧元素组成的单质，是空气的主要成分之一",
  "learning_modes": ["factual", "conceptual"],
  "bridge_tags": ["matter", "structure", "properties"],
  "framework_refs": ["framework:chem:topic:2-1"],
  "card_ref": "node-card:entity/substance:oxygen",
  "status": "active"
}
```

#### 2. Curriculum Profile (课程画像)
```json
{
  "id": "profile:chem:entity/substance:oxygen",
  "node_id": "entity/substance:oxygen",
  "subject": "chemistry",
  "school_stage": "senior_secondary",
  "grade_band": "10-12",
  "curriculum_role": "introduced",
  "mastery_level": "understand",
  "framework_refs": ["framework:chem:expectation:2-1-3"],
  "learning_objectives": ["描述氧气的物理性质", "掌握氧气的化学性质"],
  "textbook_refs": ["struct:chem:lesson:2-1"],
  "status": "active"
}
```

#### 3. Evidence (出处/证据)
```json
{
  "id": "evidence:chem:p42-para-3",
  "source_type": "textbook",
  "source_id": "chem-highschool-compulsory-1",
  "anchor_ref": "struct:chem:lesson:2-1",
  "excerpt": "氧气是一种无色无味的气体，密度略大于空气...",
  "locator": "第42页第三段",
  "page_start": 42,
  "page_end": 42,
  "modality": "text",
  "extraction_method": "pdftotext"
}
```

#### 4. Mention (提及记录)
```json
{
  "id": "mention:chem:oxygen-in-lesson-2-1",
  "source_type": "textbook",
  "source_id": "chem-highschool-compulsory-1",
  "anchor_ref": "struct:chem:lesson:2-1",
  "target_type": "node",
  "target_id": "entity/substance:oxygen",
  "role": "focuses_on",
  "source_refs": ["evidence:chem:p42-para-3"],
  "confidence": 0.95
}
```

#### 5. Node Card (详细节点卡片) - Return for Expansion

**This skill does NOT generate node cards. It returns the list of new backbone nodes.**

The calling agent (`@lesson-processor`) is responsible for:
1. Receiving the list of new backbone nodes
2. Spawning `@node-expander` Tasks for each node
3. Verifying all node cards are created

**What this skill returns:**
```json
{
  "new_backbone_nodes": ["entity/substance:oxygen", "concept:combustion"],
  "counts": {
    "nodes": 5,
    "edges": 3,
    "profiles": 5,
    "mentions": 12,
    "evidence": 15
  }
}
```

**Why separate extraction and expansion?**
- Extraction stays focused on schema-valid node/edge creation
- Expansion requires fresh isolated context for each node card
- Caller can parallelize expansion across multiple Tasks
- Clearer separation of concerns

**For existing nodes being updated:**
- Do NOT regenerate card (preserve existing)
- Just add new mentions, evidence links, and update profile with new textbook_refs

### Phase 5: Persist (SQLite-Native)

Write directly to SQLite - **No JSONL intermediate files**:

```bash
# Extract directly to SQLite
python scripts/extract_lesson_sqlite.py \
  --batch-anchor <anchor> \
  --book-md-path <book.md> \
  --dataset-id <version> \
  --db storage/knowledge.sqlite
```

**What this does:**
1. Reads lesson scope from Markdown
2. Direct INSERT into `nodes`, `edges`, `profiles`, `mentions`, `evidence` tables
3. Returns list of new backbone node IDs to caller

**No JSONL files generated:**
- ❌ `knowledge.nodes.jsonl`
- ❌ `knowledge.edges.jsonl`
- ❌ `*.mentions.jsonl`
- ❌ `*.evidence.jsonl`
- ❌ `node_cards/*.json`

See `SKILL_SQLITE_NATIVE_V2.md` for complete SQLite-native workflow.

## Input Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `--batch-anchor` | String | Yes | Canonical outline ID (e.g., `struct:chem:lesson:1-1-1`) |
| `--book-md-path` | Path | Yes | Path to OCR-completed markdown source |
| `--db` | Path | No | SQLite database path (default: `storage/knowledge.sqlite`) |
| `--dataset-id` | String | No | Dataset ID (default: inferred from output root or `v4`) |
| `--output-root` | Path | No | Used for dataset inference (SQLite is primary storage) |

## Output

**Primary**: SQLite canonical tables
- `nodes`: Canonical knowledge nodes
- `edges`: Canonical relationships
- `profiles`: Curriculum-specific projections
- `mentions`: Textbook location references
- `evidence`: Source text excerpts

**Runtime**: `batch_runtime_records` table
- Temporary proposals
- Unresolved alternatives
- Review queue items

## Key Rules

### Code Management

When generating or executing code:

1. **Temporary Code**: Do NOT save
   - One-off scripts for debugging
   - Quick prototypes
   - Throwaway verification scripts

2. **Reusable Code**: Save to project
   - Utility scripts that solve common problems
   - Reusable functions/modules
   - Scripts in `scripts/` directory

3. **Specified Code Errors**: Fix as needed
   - If documented commands/scripts have errors, fix them based on actual context
   - Update documentation if the fix is permanent
   - Report significant discrepancies to user

### Scope
- **ONE lesson or one short page range only**
- **NEVER whole-book extraction in one pass**
- **NEVER continue to next lesson after completion**
- **STOP after processing the specified batch-anchor**
- If multiple lessons are needed, caller must spawn separate Tasks for each

### Storage
- SQLite is primary; JSON/JSONL are derived exports
- Keep `batch_runtime_records` as default replay source

### Support Nodes (RECOMMENDED)
- **Lessons with experiments/activities SHOULD have support nodes**
- **Extract experiments as `activity/experiment` nodes**
- **Extract methods/procedures as `method` nodes**
- **Extract equipment/instruments as `entity/equipment` nodes**
- **Extract formulas/diagrams as `representation` nodes**
- **Support nodes MUST have `node_layer="support"`**
- **If no support nodes found**:
  - Check if lesson is concept/theory only
  - Add note in extraction result explaining why

### Properties (RECOMMENDED)
- **`entity/substance` nodes SHOULD have meaningful properties** (color, state, odor, etc.)
- **`activity/experiment` nodes SHOULD have properties** with method/steps/materials
- **`entity/equipment` nodes SHOULD have properties** with instrument_type
- **If properties are empty for these types**:
  - Add explanation in node's `notes` field
  - Example: "Textbook only mentions name, no detailed properties described"
  - Do NOT fabricate properties not in evidence

### Evidence-First
- Split into small evidence units before node decisions
- Create evidence before nodes/edges
- Every node must have evidence-backed provenance

### Retrieval-First
- Retrieve candidates before reasoning
- Use as narrowing aid, not as evidence
- Don't operate on full canonical graph

### Canonicalization
- Prefer reusing existing nodes
- Add new profiles for new stage coverage
- Don't delete prior profiles during new extraction
- Don't create lesson nodes in canonical graph

### Node Selection
Use appropriate `node_kind`:
- `concept` - Abstract ideas, definitions
- `entity` - Named substances, objects
- `activity` - Experiments, investigations
- `method` - Reusable operations
- `principle` - Laws, mechanisms
- `representation` - Formulas, diagrams
- `skill` - Assessable capabilities
- `issue` - Discussable topics

### Node Layers
- `backbone` - Stable, cross-lesson anchors
- `support` - Auxiliary content (experiments, methods, equipment)

### Relation Types

**Hierarchical/dependency** (no cycles allowed):
`is_a`, `instance_of`, `contains`, `part_of`, `prerequisite_for`, `depends_on`, `extends`

**Association** (cycles allowed):
`explains`, `causes`, `affects`, `uses`, `measures`, `produces`, `consumes`, `has_property`, `applies_to`, `represented_by`, `symbolizes`, `analogous_to`, `same_as`, `related_to`

## Error Handling

### Blocker Scenarios

| Scenario | Action |
|----------|--------|
| Missing SQLite dataset | Halt, report blocker |
| Invalid batch anchor | Halt, report blocker |
| Schema validation failure | Halt, report blocker |
| Empty evidence after chunking | Halt, report blocker |

### Warning Scenarios

| Scenario | Action |
|----------|--------|
| Low-confidence relation proposal | Keep in runtime, skip canonical |
| Candidate retrieval returns empty | Log, proceed with new node creation |

## References

- `references/extraction-rules.md` - Detailed extraction rules (299 lines)
- `references/graphrag-inspired-workflow.md` - Micro-chunking approach
- `../knowledge-schema/references/schema-guide.md` - Schema semantics
- `../knowledge-schema/references/framework-usage.md` - Curriculum alignment
- `../../GLOSSARY.md` - Terminology
- `../../CONVENTIONS.md` - Standards
