# Textbook Outline Output Contract

Use this reference when writing `data/outlines/<book-id>.outline.json`.

## Required Top-Level Fields

- `book_id`
- `title`
- `source_path`
- `generated_at`
- `toc_pages`
- `items`

## Required Item Fields

- `id`
- `kind`
- `label`
- `title`
- `page_start`
- `order_path`
- `raw_line`

## Item Kinds

- `theme`
- `topic`
- `lesson`
- `activity`
- `review`

## Parenting Rules

- `topic` belongs to the current `theme`
- `lesson` belongs to the current `topic` when a topic exists
- `activity` belongs to the nearest open `topic`, otherwise the nearest open `theme`
- `review` belongs to the nearest open `topic`, otherwise the nearest open `theme`

## Quality Rules

- Preserve the original TOC line in `raw_line`.
- Keep `page_start` as the textbook page number shown in the TOC.
- If TOC nesting is ambiguous, favor the nearest preceding higher-level heading.
- Do not fabricate missing page numbers.
