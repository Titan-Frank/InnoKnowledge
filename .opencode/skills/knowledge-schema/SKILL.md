---
name: knowledge-schema
description: Applies the project's V2 canonical node, edge, curriculum profile, mention, evidence, and node-card schema for unified knowledge map extraction. Use when creating or normalizing graph artifacts under `data/v2/` or an explicitly requested versioned root such as `data/v3/`, defining IDs, choosing relation types, or checking whether extraction outputs match the project's schema.
---

# Knowledge Schema

Use this skill as the schema authority for every extraction task. Prefer the V2 schema in `schemas/v2/` unless the user explicitly asks for legacy compatibility output. If the user explicitly asks for a versioned root such as `data/v3/`, keep the same schema and layout there.

## Workflow

1. Read the JSON schema files in `schemas/v2/`.
2. Read `references/schema-guide.md` for semantic guidance.
3. Read `references/framework-usage.md` and the relevant framework file when aligning nodes or profiles to curriculum expectations.
4. Read `data/patterns/unified-knowledge-patterns.v2.json` before expanding a node into a card.
5. Write JSONL with one object per line for canonical nodes, canonical edges, curriculum profiles, mentions, and evidence.
6. Write node cards as JSON objects under `data/v2/node_cards/`.
7. Keep canonical IDs stable and provenance explicit.

## Rules

- Canonical knowledge records are global-first, not book-first.
- Provenance belongs in mentions and evidence.
- Subject and grade expectations belong in curriculum profiles.
- Curriculum profiles are append-first: if a canonical node appears in a new subject, school stage, or grade band, add a new profile instead of overwriting an existing one.
- Never delete or replace an existing profile from another stage just because the current extraction batch is focused on a different stage.
- If the same `subject` / `school_stage` / `grade_band` profile already exists, merge objectives and references conservatively instead of dropping prior supported content.
- Detailed explanation belongs in node cards, not in the backbone graph.
- Prefer fewer, cleaner relation types over many nearly identical ones.
- Keep Chinese display names in `canonical_name` when the source language is Chinese.
- Use `learning_modes` as an instructional tag, not as the primary ontology type.
- Use `node_kind` and optional `node_subkind` as the primary ontology axis.
- Use `node_layer` to distinguish `backbone` nodes from `support` nodes.
- Use `edge_layer` and `backbone_expand` to distinguish default trunk relations from support-expansion relations.
- Prefer `backbone` for stable, cross-stage knowledge anchors.
- Prefer `support` for reusable but auxiliary methods, activities, representations, equipment, or issue nodes.
- Keep `card_layer` aligned with the referenced node's `node_layer`.
- Use `framework_refs` primarily on curriculum profiles; keep them on canonical nodes only when they help normalization or discovery.
- Use `properties` for extensible details instead of creating ad hoc top-level keys.
- Treat existing canonical nodes, edges, profiles, mentions, evidence, and node cards as persistent records. Do not delete them unless the user explicitly requests a destructive cleanup.

## Cycle Prevention

**CRITICAL**: Hierarchical and dependency edge types must NOT form cycles.

| Edge Type | Cycle Allowed | Reason |
|-----------|---------------|--------|
| `is_a` | ❌ NO | Type hierarchy |
| `instance_of` | ❌ NO | Membership hierarchy |
| `contains` | ❌ NO | Containment hierarchy |
| `part_of` | ❌ NO | Membership hierarchy |
| `prerequisite_for` | ❌ NO | Dependency chain |
| `depends_on` | ❌ NO | Dependency chain |
| `extends` | ❌ NO | Extension hierarchy |
| `related_to` | ✅ YES | Association is allowed to be cyclic |
| `explains` | ✅ YES | Mutual explanation can be valid |
| `uses` | ✅ YES | Operational association can be cyclic |
| `analogous_to` | ✅ YES | Analogy is naturally symmetric |
| `same_as` | ✅ YES | Equivalence is symmetric |

Before adding any hierarchical or dependency edge, verify it does not create a cycle.

## References

- `references/schema-guide.md`
- `references/framework-usage.md`
- `references/node-card-usage.md`
- `schemas/v2/node.schema.json`
- `schemas/v2/edge.schema.json`
- `schemas/v2/curriculum-profile.schema.json`
- `schemas/v2/mention.schema.json`
- `schemas/v2/evidence.schema.json`
- `schemas/v2/node-card.schema.json`
- `schemas/v2/pattern-library.schema.json`
- `schemas/outline.schema.json`
- `schemas/framework.schema.json`
