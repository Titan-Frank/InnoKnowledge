---
name: textbook-outline
description: Extracts the structural outline of an OCR-completed textbook source into anchored outline JSON. Use when creating or refreshing `data/outlines/BOOK_ID.outline.json`, inspecting textbook hierarchy, or preparing lesson/page ranges before chapter-level knowledge extraction.
---

# Textbook Outline

Create the textbook skeleton before extracting lesson knowledge. `AGENTS.md` remains the authority for when outline refresh is required and how the outline feeds the larger pipeline.

## Workflow

1. Read `AGENTS.md` and `schemas/outline.schema.json`.
2. If the source textbook is OCR-completed markdown, inspect markdown headings and explicit page markers first.
3. Prefer markdown-first outline building:

```bash
rg -n "^(#{1,6})\\s+|^第[一二三四五六七八九十0-9]+[章单元课节专题主题]|^\\[?Page[[:space:]]+[0-9]+\\]?|^<!--\\s*page:" "<path-to-book.md>"
```

4. Build `data/outlines/<book-id>.outline.json` conservatively from the markdown hierarchy.
5. Validate hierarchy and page anchors against the source markdown.
6. If a line is not parsed automatically, patch the resulting JSON conservatively and preserve the original `raw_line`.

## Output Rules

- Write only `data/outlines/<book-id>.outline.json`.
- Keep one record per structural item.
- Use `theme`, `topic`, `lesson`, `activity`, and `review` as the default structural kinds.
- Keep `label` close to textbook wording such as `主题一`, `专题 3`, `课题 2`.
- Keep `title` as the human-readable Chinese title.
- Keep the file stable enough for downstream lesson batching and page-anchor lookup.
- If working from OCR markdown, set `source_path` to the markdown source path.
- If markdown contains explicit page markers, derive `page_start` from the nearest reliable marker.
- If markdown lacks reliable page anchors, stop and report the blocker instead of fabricating page numbers.

## References

- Read `references/output-contract.md` for the field-level contract.
