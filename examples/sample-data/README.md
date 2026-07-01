# Open Knowledge Map sample data

This directory contains a tiny, repository-safe sample asset set for `npm run import-file-assets -w packages/pipeline`.

- `outlines/` contains two textbook outline JSON files.
- `enrich/` contains two generated enrichment trees and a matching index.
- `mineru/` contains synthetic Markdown snippets and minimal source manifests. The Markdown files are not original textbook text.

The importer uses the full local `data/` assets when they exist. It falls back to this sample set when a fresh clone has no generated local assets.
