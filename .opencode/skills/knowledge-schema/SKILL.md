---
name: knowledge-schema
description: Schema authority for canonical nodes, edges, profiles, mentions, evidence, and node cards.
---

# Knowledge Schema

Enforce schema compliance for all knowledge artifacts. This skill provides schema validation, ID generation, and validation utilities.

## Quick Start

```bash
# Schema validation
python -m scripts.validate \
  --schema schemas/v2/node.schema.json \
  --data <node.json>

# Used implicitly by other skills
# No direct invocation required for normal workflow
```

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
| `id` | URN | `urn:knowledge:{subject}:{name}` | Stable canonical identifier |
| `canonical_label` | String | Text | Primary display name |
| `aliases` | Array | [String] | Alternative names |
| `node_kind` | Enum | see below | Ontology type |
| `node_layer` | Enum | `backbone`, `support` | Visibility layer |
| `subject` | String | e.g., `physics`, `chemistry` | Discipline |
| `learning_modes` | Array | [Enum] | Required, non-empty |

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
| `id` | URN | `urn:knowledge:edge:{from}-{type}-{to}` |
| `source` | URN | Origin node ID |
| `target` | URN | Destination node ID |
| `relation` | Enum | Edge type |
| `edge_layer` | Enum | `backbone`, `support` |
| `backbone_expand` | Boolean | Show in default expansion? |

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
| `school_stage` | Enum | `primary`, `junior_high`, `senior_high` |
| `grade_band` | String | e.g., `grade_8`, `grade_10-12` |
| `learning_modes` | Array | Instructional approaches |

### Optional Fields

| Field | Use |
|-------|-----|
| `objectives` | Learning objectives |
| `framework_refs` | Curriculum standard mappings |
| `textbook_refs` | Textbook locations |
| `source_refs` | Evidence references |

## Mention Schema

### Critical Rule

> **Every canonical node must have at least one mention with evidence.**

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | URN | Mention identifier |
| `target_id` | URN | Canonical node ID |
| `anchor_ref` | String | Outline anchor |
| `role` | Enum | How lesson treats the node |

### Roles

| Role | Meaning |
|------|---------|
| `introduces` | First appearance |
| `defines` | Formal definition |
| `focuses_on` | Main topic |
| `demonstrates` | Example/illustration |
| `reviews` | Review/practice |
| `mentions` | Passing reference |

## Evidence Schema

### Required Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | URN | Evidence identifier |
| `source_id` | String | Book identifier |
| `anchor` | String | Location anchor |
| `excerpt` | String | Text fragment |
| `method` | String | Extraction method |

### Anchors

- Book-level: `{book-id}`
- Lesson-level: `struct:{book-id}:lesson:{x-y-z}`
- Page-level: `{book-id}:page:{number}`
- Paragraph-level: `{book-id}:page:{number}:para:{number}`

### Extraction Methods

- `ocr` - OCR-completed markdown
- `manual` - Manual entry
- `import` - Imported from external source

## Node Card Schema

### Structure

Each node card contains detailed explanation:

```json
{
  "id": "urn:knowledge:card:{node-id}",
  "node_id": "urn:knowledge:{subject}:{name}",
  "card_layer": "backbone|support",
  "sections": [
    {
      "id": "conceptual-overview",
      "title": "Conceptual Overview",
      "content": "...",
      "pattern_ref": "explanation/v2/concept-overview"
    }
  ]
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
urn:knowledge:{subject}:{canonical-name}
```

- `subject`: lowercase, e.g., `physics`, `chemistry`
- `canonical-name`: lowercase, hyphen-separated, ASCII only

Examples:
- `urn:knowledge:physics:newtons-first-law`
- `urn:knowledge:chemistry:chemical-bond`

### Edge ID

```
urn:knowledge:edge:{from-node}-{relation}-{to-node}
```

Example:
- `urn:knowledge:edge:chemical-bond-contains-ionic-bond`

### Safe Node ID (for filenames)

```python
safe_id = node_id.replace(":", "__").replace("/", "__")
# e.g., "urn:knowledge:physics:newtons-first-law"
#       → "urn__knowledge__physics__newtons-first-law"
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
# Validate single artifact
scripts/validate.py \
  --schema schemas/v2/node.schema.json \
  --data path/to/node.json

# Validate batch
scripts/validate_batch.py \
  --output-root data/v4/ \
  --scope nodes
```

## References

- `references/schema-guide.md` - Semantic guidance for schema fields
- `references/framework-usage.md` - Curriculum framework alignment
- `references/node-card-usage.md` - Node card patterns and templates
- `../../GLOSSARY.md` - Terminology definitions
- `../../CONVENTIONS.md` - Documentation standards
