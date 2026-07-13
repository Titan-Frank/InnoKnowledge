# Documentation index

Use this page to distinguish current contracts and implementation documents from dated research drafts and historical run records.

## Start here

- [Hosted read-only viewer](https://open-knowledge-map.pages.dev/): current public inspection build backed by the versioned `knowledge/main` snapshot.
- [Inspection artifact v0.1.0](../artifacts/okm-public-v0.1.0/README.md): graph JSON, one `ApiUnit` per object, schemas, source and rights records, checksums, readers, and static viewer.
- [Current system architecture](current-system-architecture.md): implemented package, database, API, pipeline, viewer, and transaction boundaries.
- [Interdisciplinary knowledge network](interdisciplinary-knowledge-network.md): implemented cross-domain discovery, review, evidence, and reducer contract.
- [Theory decision record](theory-decision-record.md): frozen terminology and the boundary of the current research claim.
- [AI-NKS v0.2](ai-nks-v0.2.md): current AI-native multidisciplinary knowledge network standard.
- [Knowledge unit contract](knowledge-unit-contract.md): public `ApiUnit` consumption contract.
- [Documentation status](documentation-status.md): priority rules when documents describe different layers.

## Engineering standards

- [World knowledge standard](../schemas/world-knowledge-standard.md): executable `world-v1.3` multidisciplinary network baseline.
- [World knowledge architecture](../schemas/world-knowledge-architecture.md): storage, evidence, and governance architecture.
- [Prompt inventory](prompt-inventory.md): model inputs, structured outputs, and prompt locations.
- [Node extraction policy](node-extraction-policy.md): admission rules for canonical knowledge candidates.

## Research and reports

- [Implementation technical report source](open_knowledge_map_technical_report.tex): current working LaTeX report grounded in the repository implementation. Its claims, screenshots, author metadata, and generated PDF must be reviewed before archival release.
- [Theoretical foundation](theoretical-foundation.md): motivation and historical framing.

## Operations and history

- [Populated synthetic demo](../examples/demo-data/README.md): repository-authored graph and one-command local viewer path.
- [TypeScript pipeline migration record](history/pipeline-typescript-migration.md): completed Python-to-TypeScript migration scope and verification history.
- [Physics extraction run, 2026-06-26](physics-hukj-compulsory-3-extraction-run-2026-06-26.md): one historical run record, not the current standard.
- [Open-source release checklist](open-source-release-checklist.md): legal, product, benchmark, and GitHub release gates.

The current conceptual standard is `ai-nks-v0.2`; the executable schema baseline is `world-v1.3`; `ApiUnit` is the public consumption contract. These names refer to different layers and should not be collapsed into one version number. The versioned `artifacts/okm-public-v0.1.0` directory is an immutable historical snapshot and intentionally retains its release-time schema.
