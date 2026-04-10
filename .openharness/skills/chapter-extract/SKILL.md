---
name: chapter-extract
description: Extracts one lesson or small page range into lesson-local staged artifacts. Use when processing textbook content for knowledge extraction.
---

# Chapter Extract

## ⚠️ Critical: Single Lesson Scope Only

Process **exactly one lesson** and stop.

This skill returns **lesson-local structured artifacts** only. It does **not** commit canonical graph updates directly. The extraction standard should remain as strict and detailed as the previous canonical workflow; only the persistence target has changed.

## Workflow

### Phase 1: Pre-flight

Before processing, ensure:

1. Read `../../AGENTS.md` for project principles
2. Read `../../GLOSSARY.md` for terminology
3. Resolve `--output-root`
4. Verify `--batch-anchor` is a valid outline ID
5. Check SQLite is accessible
6. Read required schemas:
   - `schemas/v2/node.schema.json`
   - `schemas/v2/edge.schema.json`
   - `schemas/v2/curriculum-profile.schema.json`
   - `schemas/v2/mention.schema.json`
   - `schemas/v2/evidence.schema.json`
   - `schemas/v2/node-card.schema.json`

### Phase 2: Load and Chunk

1. Locate lesson scope from `data/outlines/{book-id}.outline.json`
2. Read OCR-completed markdown for the target lesson
3. Split into **evidence-bearing units**:
   - definition paragraphs
   - example paragraphs
   - experiment step blocks
   - figure captions
   - table row groups
4. Create lesson-local evidence records first

### Phase 3: Retrieval-First Processing

For each evidence unit:

1. Extract candidate concepts, entities, and relationships
2. Retrieve canonical candidates with `scripts/retrieve_candidates.py`
3. Apply hard filters:
   - `node_kind`
   - `subject`
   - `school_stage`
   - `grade_band`
4. Use local subgraph reasoning when needed
5. Reuse canonical candidates only as retrieval hints
6. Produce **lesson-local raw nodes and edges**
7. Do not make the final canonical merge decision here

### Phase 4: Build Complete Artifacts for Each Node

#### Step 4.1: Identify All Node Types

For each lesson, identify and extract:

1. **Backbone nodes**
   - core concepts and principles
   - key substances and entities
   - stable cross-lesson knowledge anchors

2. **Support nodes** where applicable
   - `activity/experiment`
   - `method`
   - `entity/equipment`
   - `representation`

If no support nodes are present:
- verify the lesson is concept/theory heavy
- do not fabricate support nodes

#### Step 4.2: Extract Properties Carefully

**Entity/Substance nodes should have properties when supported by evidence**

```json
{
  "node_kind": "entity",
  "node_subkind": "substance",
  "properties": {
    "color": "无色",
    "odor": "无味",
    "state": "气体"
  }
}
```

**Activity/Experiment nodes should have properties when supported**

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

**Entity/Equipment nodes should have structured properties when supported**

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

If evidence does not support such fields:
- leave properties sparse
- add `notes` only when needed
- do not fabricate details

#### Step 4.3: Enforce Five-Category Completeness

Every new backbone node must be supported by all five categories:

1. Node
2. Curriculum profile
3. Evidence
4. Mention
5. Node card target via `new_backbone_nodes`

This skill returns the first four categories directly and returns `new_backbone_nodes` so the caller can generate provisional node cards.

#### Step 4.4: Node Requirements

Lesson-local node candidates should be shaped like canonical nodes, except their lifecycle remains candidate/staged:

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
  "properties": {
    "state": "气体",
    "color": "无色"
  },
  "status": "candidate"
}
```

#### Step 4.5: Profile Requirements

Every backbone node should have a corresponding profile:

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
  "properties": {},
  "status": "draft"
}
```

#### Step 4.6: Evidence Requirements

Every mention must be backed by lesson-local evidence:

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
  "extraction_method": "ocr",
  "properties": {}
}
```

#### Step 4.7: Mention Requirements

Every backbone node must have at least one lesson-local mention:

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
  "confidence": 0.95,
  "properties": {}
}
```

### Phase 5: Return Structured Lesson Bundle

Return:

```json
{
  "nodes": [...],
  "edges": [...],
  "profiles": [...],
  "mentions": [...],
  "evidence": [...],
  "new_backbone_nodes": ["concept:...", "entity/..."],
  "counts": {
    "nodes": 5,
    "edges": 3,
    "profiles": 5,
    "mentions": 12,
    "evidence": 15
  }
}
```

The caller is responsible for:
1. expanding provisional node cards
2. calling `scripts/store_lesson_staging.py`
3. verifying staging completeness

### Phase 6: Validate Bundle

Before returning:

1. Verify every backbone node has:
   - a node candidate
   - a profile
   - a mention
   - evidence support
2. Verify edge endpoints refer to lesson-local node IDs
3. Verify all `source_refs` refer to lesson-local evidence IDs
4. Verify no required schema fields are missing

## Constraints

- Do not write canonical `nodes`, `edges`, `profiles`, `mentions`, `evidence`, or `node_cards`
- Do not continue to the next lesson
- Do not operate on the whole graph directly

## Key Rules

### Scope
- one lesson only
- stop after the requested `batch-anchor`

### Storage
- canonical SQLite tables are not the output of this skill
- the output of this skill is a lesson-local artifact bundle

### Evidence First
- split into evidence units before node decisions
- every node and edge must remain evidence-backed

### Retrieval First
- retrieve candidates before reasoning
- use retrieval as narrowing aid, not as evidence

### Support Nodes
- extract support nodes when lesson content warrants them
- do not fabricate support nodes for lessons that genuinely lack them

### Properties
- fill meaningful structured properties when evidence supports them
- otherwise keep sparse and avoid hallucination

### Node Layers
- `backbone` for stable cross-lesson anchors
- `support` for auxiliary content
