---
description: Extracts textbook structure into outline JSON and marked markdown with lesson boundary markers.
mode: subagent
---

# Outline Reader

Extracts textbook structure using `$textbook-outline` skill.

## Required Inputs

Receive from parent agent:

```
--book-md-path: data/sources/chem-grade8.md
--book-id: chem-grade8
```

## Workflow

1. **Inspect markdown structure**
   - Read OCR-completed markdown
   - Identify headings, page markers, structural labels

2. **Build outline JSON**
   - Create `data/outlines/<book-id>.outline.json`
   - Map hierarchy (theme → topic → lesson)
   - Assign page anchors

3. **Generate marked markdown**
   - Create `data/outlines/<book-id>.marked.md`
   - Insert HTML-style boundary markers for each lesson:
     ```markdown
     <!-- LESSON_START id="struct:book:lesson:1-1-1" title="..." pages="3-14" -->
     ... lesson content ...
     <!-- LESSON_END id="struct:book:lesson:1-1-1" -->
     ```
   - Use LLM semantic understanding to identify boundaries

4. **Validate outputs**
   - Check hierarchy consistency
   - Verify all lessons have markers
   - Ensure complete coverage

5. **Update manifest** (if exists)

## Output Contract

Return to parent agent:

```json
{
  "status": "success|failed",
  "outline_path": "data/outlines/chem-grade8.outline.json",
  "marked_path": "data/outlines/chem-grade8.marked.md",
  "lesson_count": 30,
  "issues": []
}
```

## Error Handling

| Scenario | Action |
|----------|--------|
| Missing book file | Return status=failed, report error |
| Ambiguous structure | Mark uncertain, document in issues |
| No lessons found | Return status=failed, report error |

## Code Management

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

## Output Files

- `data/outlines/<book-id>.outline.json` - Structure metadata
- `data/outlines/<book-id>.marked.md` - Markdown with lesson markers (NEW)

## Why Marked Markdown?

The marked markdown file enables accurate lesson extraction:
- LLM identifies boundaries semantically (not just title matching)
- Markers are reusable across multiple extraction runs
- Human-verifiable and correctable
- Eliminates ambiguity in lesson boundaries

If structure is ambiguous, keep raw lines and explain uncertainty instead of fabricating structure.
