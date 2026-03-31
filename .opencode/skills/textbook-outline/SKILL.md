---
name: textbook-outline
description: Extracts the structural outline of a textbook PDF from its table of contents and anchors each item to a start page. Use when creating or refreshing `data/outlines/BOOK_ID.outline.json`, inspecting textbook hierarchy, or preparing lesson/page ranges before chapter-level knowledge extraction.
---

# Textbook Outline

Create the textbook skeleton before extracting lesson knowledge. `AGENTS.md` remains the authority for when outline refresh is required and how the outline feeds the larger pipeline.

## Workflow

1. Read `AGENTS.md` and `schemas/outline.schema.json`.
2. Inspect the table of contents with `pdftotext -layout` if needed.
3. Prefer the bundled extraction script:

```bash
python3 .opencode/skills/textbook-outline/scripts/extract_outline.py \
  --pdf "<path-to-book.pdf>" \
  --book-id "<book-id>" \
  --out "data/outlines/<book-id>.outline.json"
```

4. Validate hierarchy and page numbers against the source pages.
5. If a line is not parsed automatically, patch the resulting JSON conservatively and preserve the original `raw_line`.

## Output Rules

- Write only `data/outlines/<book-id>.outline.json`.
- Keep one record per structural item.
- Use `theme`, `topic`, `lesson`, `activity`, and `review` as the default structural kinds.
- Keep `label` close to textbook wording such as `主题一`, `专题 3`, `课题 2`.
- Keep `title` as the human-readable Chinese title.
- Keep the file stable enough for downstream lesson batching and page-anchor lookup.

## References

- Read `references/output-contract.md` for the field-level contract.
- Use the script in `scripts/extract_outline.py` instead of rewriting the parser from scratch.
