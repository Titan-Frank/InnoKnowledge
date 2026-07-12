# Legacy import fixtures

This directory contains legacy fallback fixtures for `npm run import-file-assets -w packages/pipeline`. Its contents have **not** completed the file-by-file provenance and redistribution review required for a public release.

- `outlines/` currently contains two outline JSON files associated with named textbook editions.
- `enrich/` contains an index and two complete generated trees associated with those named editions; these artifacts still require source and redistribution review.
- `mineru/` contains two small Markdown snippets explicitly marked as synthetic, plus import-status metadata. Their presence does not make the outline and enrichment artifacts public-safe.

The importer uses full local `data/` assets when they exist and may fall back to this directory in a fresh clone. Do not describe these fixtures as public-safe or redistribute them without recording their source, derivation, and applicable permission.

For a populated, fully repository-authored example, use [`../demo-data`](../demo-data/README.md).
