# Schema Guide

This document provides semantic guidance for using the knowledge graph schema.

## Node Types

| Type | Description | ID Prefix | Examples |
|------|-------------|-----------|----------|
| `concept` | Abstract concepts, principles, theories | `concept:` | concept:oxidation-reaction |
| `substance` | Chemical substances, materials | `substance:` | substance:oxygen |
| `experiment` | Experimental procedures | `experiment:` | experiment:water-electrolysis |
| `method` | Scientific methods, techniques | `method:` | method:filtration |
| `skill` | Learnable skills | `skill:` | skill:write-equation |
| `symbol` | Chemical symbols, notations | `symbol:` | symbol:h |

## Edge Types and Cycle Rules

### Edge Type Semantics

| Edge Type | Semantics | Example |
|-----------|-----------|---------|
| `contains` | A contains B (composition) | air contains nitrogen |
| `part_of` | A is part of B (membership) | hydrogen is part of water |
| `produces` | A produces B (transformation) | electrolysis produces oxygen |
| `uses` | A uses B (instrument/method) | experiment uses method |
| `explains` | A explains B | experiment explains concept |
| `related_to` | General association | concept related_to concept |
| `measures` | A measures B | experiment measures property |
| `prerequisite_for` | A is prerequisite for B | safety prerequisite_for operation |
| `consumes` | A consumes B (reaction) | combustion consumes oxygen |

### Cycle Prevention Rules

**Critical: Some edge types MUST NOT form cycles.**

| Edge Type | Cycle Allowed? | Reason |
|-----------|----------------|--------|
| `contains` | ❌ NO | Hierarchical containment cannot be circular |
| `part_of` | ❌ NO | Parent-child hierarchy cannot loop |
| `prerequisite_for` | ❌ NO | Dependency chains cannot be circular |
| `produces` | ⚠️ RARELY | Usually acyclic; cycles imply reversible reactions |
| `consumes` | ⚠️ RARELY | Usually acyclic |
| `uses` | ✅ YES | Method usage can be mutual |
| `explains` | ✅ YES | Mutual explanation is valid |
| `related_to` | ✅ YES | Associations can be bidirectional |
| `measures` | ✅ YES | Can have measurement relationships |

### Validation Rules

When adding edges, check for cycles:

1. **Hierarchical edges** (`contains`, `part_of`):
   - Must NOT create a path from A to B AND from B to A
   - Run cycle detection before adding

2. **Dependency edges** (`prerequisite_for`):
   - Must NOT create circular dependencies
   - Check transitive closure

3. **Association edges** (`related_to`, `explains`):
   - Cycles are acceptable
   - Represent mutual or bidirectional relationships

## ID Naming Conventions

- Use lowercase ASCII characters
- Use hyphens (`-`) for multi-word names
- Use colons (`:`) only as prefix separator
- Examples:
  - ✅ `concept:oxidation-reaction`
  - ✅ `substance:carbon-dioxide`
  - ❌ `concept:OxidationReaction`
  - ❌ `substance:co2` (use full name)

## Framework Alignment

- Use `framework_refs` to link canonical nodes to curriculum framework
- Framework refs should reference specific expectation IDs
- Not all nodes need framework refs (e.g., local experiments)

## Provenance Requirements

- Every canonical node must be traceable to at least one mention
- Every mention must reference at least one evidence
- Every evidence must have an outline anchor
- Keep evidence snippets as original text from textbooks
