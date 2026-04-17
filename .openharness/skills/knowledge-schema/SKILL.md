---
name: knowledge-schema
description: Schema authority for canonical nodes, edges, profiles, mentions, evidence, and node cards. Use when creating or validating knowledge artifacts.
---

# Knowledge Schema

Enforce schema compliance for all knowledge artifacts. This skill provides schema validation, ID generation, and validation utilities.

## Quick Start

Schema validation is performed by `scripts/strict_qa.py` during the pipeline.
No separate validation script is needed. This skill is used implicitly by other skills
for schema knowledge and ID generation conventions.

## Schema Overview

### Core Artifacts

| Artifact | Schema | Purpose |
|----------|--------|---------|
| Node | `schemas/v2/node.schema.json` | Canonical knowledge nodes |
| Edge | `schemas/v2/edge.schema.json` | Relationships between nodes |
| Profile | `schemas/v2/curriculum-profile.schema.json` | Curriculum context for nodes |
| Mention | `schemas/v2/mention.schema.json` | Textbook location references |
| Evidence | `schemas/v2/evidence.schema.json` | Source text excerpts |
| Node Card | `schemas/v2/node-card.schema.json` | Detailed node explanations |
| Outline | `schemas/outline.schema.json` | Book structure |
| Framework | `schemas/framework.schema.json` | Curriculum standards mapping |
| Patterns | `schemas/v2/pattern-library.schema.json` | Explanation templates |

### Reading Order

Before using any artifact, read in this order:

1. `references/schema-guide.md` - Semantic guidance
2. `references/framework-usage.md` - Curriculum alignment
3. `references/node-card-usage.md` - Node card patterns
4. Specific schema file (`*.schema.json`)

## Node Schema

### Required Fields

| Field | Type | Values | Description |
|-------|------|--------|-------------|
| `id` | String | `^[a-z0-9/_:-]+$` | Stable node identifier, e.g. `concept:chemical-change` |
| `canonical_name` | String | Text | Primary display name |
| `aliases` | Array | [String] | Alternative names |
| `node_kind` | Enum | see below | Ontology type |
| `node_layer` | Enum | `backbone`, `support` | Visibility layer |
| `definition` | String | Text | Stable definition |
| `learning_modes` | Array | [Enum] | Required, non-empty |
| `properties` | Object | JSON object | Compact structured facts |
| `status` | Enum | `candidate`, `active`, `merged`, `deprecated` | Node lifecycle |

### Node Kinds

| Kind | Subkinds | Typical Layer | Examples |
|------|----------|---------------|----------|
| `concept` | - | backbone | 化学键, 惯性 |
| `entity` | `substance`, `equipment` | backbone/support | 氧气, 烧杯 |
| `activity` | `experiment`, `investigation` | support | 过滤实验 |
| `method` | - | support | 控制变量法 |
| `principle` | `law`, `mechanism` | backbone | 牛顿第一定律 |
| `representation` | `symbol`, `formula`, `diagram` | support | H₂O, 电路图 |
| `skill` | `procedure`, `technique` | support | 读数, 计算 |
| `issue` | - | support | 空气污染议题 |

### Learning Modes

All nodes must have at least one:

| Mode | Typical For |
|------|-------------|
| `conceptual` | concepts, principles, backbone entities |
| `procedural` | methods, skills, activities |
| `factual` | support entities, properties |
| `metacognitive` | reflection, self-regulation |

Defaults if not explicit:
- `concept`, `principle` → `conceptual`
- `method`, `skill`, `activity` → `procedural`
- `entity` (support) → `factual`

### Properties

Use for sparse, structured, stable facts:

```json
{
  "properties": {
    "color": "无色",
    "state": "气态",
    "solubility": "难溶于水"
  }
}
```

Avoid:
- Textbook sentences
- Long explanations
- Procedure details

Move to node cards instead.

## Edge Schema

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | String | `edge:{stable-suffix}` |
| `from` | String | Origin node ID |
| `to` | String | Destination node ID |
| `edge_type` | Enum | Edge type |
| `edge_layer` | Enum | `backbone`, `support` |
| `backbone_expand` | Boolean | Show in default expansion? |
| `directionality` | Enum | `directed`, `undirected` |
| `confidence` | Number | `0.0` to `1.0` |
| `properties` | Object | JSON object |
| `status` | Enum | `candidate`, `active`, `deprecated` |

### Edge Types

**Hierarchical/dependency** (cycles prohibited):
```
is_a          - Type membership
instance_of   - Instance relationship
contains      - Containment (whole→part)
part_of       - Part-whole (part→whole)
extends       - Extension/inheritance
depends_on    - Dependency
prerequisite_for - Learning/prerequisite order
```

**Process/causal**:
```
causes        - Causal relationship
explains      - Explanation (not hierarchy)
affects       - Influence without strict causation
produces      - Generation/creation
consumes      - Consumption/use
applies_to    - Application scope
```

**Operational**:
```
uses          - Tool/method usage
measures      - Measurement relationship
represented_by - External representation
symbolizes    - Symbolic representation
has_property  - Property attribution
```

**Association**:
```
analogous_to  - Analogy/similarity
same_as       - Equivalence
related_to    - General association
```

### Edge Layer Defaults

| From | To | edge_layer | backbone_expand |
|------|-----|------------|-----------------|
| backbone | backbone | `backbone` | `false` |
| backbone | support | `support` | `true` |
| support | support | `support` | `false` |

## Profile Schema

### Key Principles

- One profile per `(node_id, subject, school_stage, grade_band)`
- Multiple profiles for same node in different contexts
- Junior and senior secondary profiles coexist

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | URN | Profile identifier |
| `node_id` | URN | Linked canonical node |
| `subject` | String | Discipline |
| `school_stage` | Enum | `primary`, `junior_secondary`, `senior_secondary`, `higher`, `cross_stage` |
| `grade_band` | String | e.g., `7-9`, `10-12` |
| `curriculum_role` | Enum | introduced/reinforced/developed/integrated/transferred/assessed |
| `mastery_level` | Enum | aware/identify/understand/apply/analyze/model/transfer/evaluate/create |
| `framework_refs` | Array | Required, non-empty |
| `learning_objectives` | Array | Required, non-empty |
| `properties` | Object | JSON object |
| `status` | Enum | `draft`, `reviewed`, `validated` |

### Optional Fields

| Field | Use |
|-------|-----|
| `textbook_refs` | Textbook locations |
| `textbook_ids` | Textbook source IDs |
| `source_refs` | Evidence references |

## Mention Schema

### Critical Rule

> **Every canonical node must have at least one mention with evidence.**

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | URN | Mention identifier |
| `source_type` | Enum | textbook/curriculum/exercise/assessment/note/media/other |
| `source_id` | String | Source artifact ID |
| `target_id` | URN | Canonical node ID |
| `anchor_ref` | String | Outline anchor |
| `target_type` | Enum | node/edge/profile/card |
| `role` | Enum | How lesson treats the node |
| `source_refs` | Array | Evidence IDs, required non-empty |
| `confidence` | Number | `0.0` to `1.0` |
| `properties` | Object | JSON object |

### Roles

| Role | Meaning |
|------|---------|
| `introduces` | First appearance |
| `defines` | Formal definition |
| `focuses_on` | Main topic |
| `demonstrates` | Example/illustration |
| `applies` | Applies or uses the target |
| `reviews` | Review/practice |
| `mentions` | Passing reference |
| `supports` | Provides support for the target |
| `assesses` | Assessment reference |
| `extends` | Extends prior treatment |

## Evidence Schema

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | URN | Evidence identifier |
| `source_type` | Enum | textbook/curriculum/exercise/assessment/note/media/other |
| `source_id` | String | Book identifier |
| `anchor_ref` | String | Location anchor |
| `excerpt` | String | Text fragment |
| `locator` | String | Page/paragraph/table/figure locator |
| `extraction_method` | Enum | manual/pdftotext/ocr/speech_to_text/mixed |
| `properties` | Object | JSON object |

### Anchors

- Book-level: `{book-id}`
- Lesson-level: `struct:{book-id}:lesson:{x-y-z}`
- Page-level: `{book-id}:page:{number}`
- Paragraph-level: `{book-id}:page:{number}:para:{number}`

### Extraction Methods

- `ocr` - OCR-completed markdown
- `manual` - Manual entry
- `pdftotext` - Extracted with PDF text tooling
- `speech_to_text` - Audio/video transcript extraction
- `mixed` - Multiple methods

## Node Card Schema

### Structure

Each node card contains detailed explanation:

```json
{
  "id": "node-card:{node-id}",
  "node_id": "concept:chemical-change",
  "card_layer": "backbone|support",
  "title": "化学变化",
  "summary": "Short evidence-backed summary.",
  "sections": [
    {
      "id": "definition",
      "title": "定义",
      "section_type": "definition",
      "content": ["Evidence-backed definition."],
      "source_refs": ["evidence:auto-example"]
    }
  ],
  "properties": {},
  "status": "draft"
}
```

### Card Sections

Common sections:
- `conceptual-overview` - Core explanation
- `key-properties` - Important characteristics
- `common-misconceptions` - Typical errors
- `examples` - Illustrative cases
- `applications` - Real-world usage
- `related-concepts` - Connected knowledge
- `procedural-notes` - How-to guidance

Keep sections **compact, structured, evidence-backed**.

## ID Generation

### Node ID

```
{node_kind}[/node_subkind]:{stable-token}
```

- Use ASCII IDs only.
- Legacy IDs such as `concept:chemical-change` are allowed.
- New auto IDs commonly use `concept:auto-{hash}` or `entity/substance:auto-{hash}`.

Examples:
- `concept:chemical-change`
- `entity/substance:oxygen`
- `activity/experiment:auto-abc123`

### Edge ID

```
edge:auto-{stable-hash}
```

Example:
- `edge:auto-abc123def456`

### Safe Node ID (for filenames)

```python
safe_id = node_id.replace(":", "__").replace("/", "__")
# e.g., "entity/substance:oxygen"
#       → "entity__substance__oxygen"
```

## Validation

### Pre-Write Checks

Before writing any artifact:

1. **Schema validation**: All required fields present
2. **Type validation**: Values match schema types
3. **Enum validation**: Values in allowed sets
4. **Reference validation**: All IDs reference existing records
5. **Provenance validation**: Evidence chain complete

### Validation Tools

```bash
# QA validation (schema + completeness + integrity)
python scripts/strict_qa.py --dataset-id main

# Graph integrity check (cycles, isolated nodes, connectivity)
python scripts/check_graph_integrity.py --dataset-id main
```

## References

- `references/schema-guide.md` - Semantic guidance for schema fields
- `references/framework-usage.md` - Curriculum framework alignment
- `references/node-card-usage.md` - Node card patterns and templates
- `../../GLOSSARY.md` - Terminology definitions
- `../../CONVENTIONS.md` - Documentation standards
