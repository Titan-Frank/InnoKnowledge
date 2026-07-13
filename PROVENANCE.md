# Provenance and rights boundary

Open Knowledge Map processes user-supplied learning materials into structured knowledge artifacts. The fact that the software can parse, transform, or display content does not grant permission to copy, publish, or redistribute that content.

This document records the repository's current source and rights boundaries. It is operational guidance, not legal advice.

## Artifact layers

| Layer | Typical contents | Current repository treatment |
| --- | --- | --- |
| Source code and schemas | TypeScript, React, SQL DDL, JSON Schemas, prompts, and documentation | Authored for this project. A public license has not yet been selected; the future root `LICENSE` file will define reuse rights. |
| User-provided source material | Textbook PDFs, images, tables, formulas, course documents, and other uploads | Not licensed by this repository. Users must have the right to process the material and must follow the source holder's terms. |
| MinerU and parser outputs | Markdown, extracted images, layout data, page mappings, and OCR text | Derived from the source material and normally carries the same or related redistribution restrictions. Kept out of the tracked repository by default. |
| Model extraction candidates | Proposed nodes, relations, mentions, evidence references, cards, profiles, and image decisions | Machine-generated candidates, not automatically verified facts. They remain tied to source provenance and require quality checks or review. |
| Canonical knowledge store | Normalized Knowledge Objects, relations, evidence, cards, bodies, embeddings, and `ApiUnit` views | Produced through reducer and QA steps. Canonical status does not remove upstream copyright, privacy, confidentiality, or contractual restrictions. |
| Populated synthetic demo | Source prose, graph rows, evidence, cards, and bodies under `examples/demo-data` | Written specifically for this repository and marked synthetic. It is not adapted from a textbook or presented as an evaluation benchmark. Reuse rights will follow the license selected for the public release. |
| Historical public inspection artifact | Immutable pre-`world-v1.3` `ApiUnit` JSON, graph JSON, schemas, checksums, reader examples, and static viewer under `artifacts/okm-public-v0.1.0` | Exported from `knowledge/main` for public inspection and retained as a versioned historical snapshot, not the current contract. The exported units identify `physics-hukj-compulsory-3`. Its PDF copyright page reserves rights, while no applicable open license or explicit redistribution permission is recorded; see the [artifact source manifest](artifacts/okm-public-v0.1.0/SOURCES.md). |
| Legacy import fixtures | Outline and enrichment files under `examples/sample-data` | Retained for regression compatibility. Treat as requiring a separate provenance and rights audit before any public release; the directory name alone is not evidence of clearance. |
| Product screenshots | Graph, synthetic source tree, pre-retrieval question panel, and quality-dashboard card under `docs/assets/report` | Captured from the repository-authored `examples/demo-data` module, whose directly seeded source and graph rows ship with the repository. They demonstrate interface surfaces, not model extraction, reducer or QA completion, grounded-answer success, or evaluation results. |

## Source evidence and generated content

Open Knowledge Map keeps several concepts separate:

- Source fragments, mentions, evidence, images, tables, and formulas describe where a claim came from.
- Model-generated candidates are proposals that may be rejected, merged, remapped, or sent for human review.
- Knowledge bodies are generated explanations and must not be treated as source evidence.
- Enrichment data may help with term boundaries, canonical naming, and granularity, but it cannot establish that a node or relation is supported by the current lesson.
- `ApiUnit` is a consumption-side view. It combines governed fields; it does not replace their individual provenance or rights metadata.

## Before adding data to Git

Contributors must verify all of the following:

1. The material is self-authored, public domain, openly licensed, or covered by explicit permission.
2. The repository records the source, version, retrieval date, and applicable license or permission.
3. The proposed commit excludes secrets, personal information, institution-internal data, and private learner records.
4. Textbook pages, long excerpts, answer keys, photographs, and source images are not committed without documented authorization.
5. Derived data has been reviewed for whether it can reproduce or substitute for protected source expression.
6. Screenshots and benchmark fixtures use safe data or have completed a separate rights review.

If any item is uncertain, keep the artifact local and open a review request containing metadata only, not the potentially restricted content.

## Public release policy still to be decided

The first public release needs an explicit license matrix for at least:

- source code;
- schemas and public contracts;
- documentation and screenshots;
- the repository-authored demo and legacy import fixtures as separate categories;
- any separately published Knowledge Object dataset.

Do not assume that one license is automatically suitable for every layer. A dataset derived from third-party learning materials may require different terms or may not be publishable at all.
