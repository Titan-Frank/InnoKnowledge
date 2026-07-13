# Documentation index

Use this page to distinguish current contracts from theory, historical run notes, and future plans.

## Start here

- [Hosted read-only viewer](https://open-knowledge-map.pages.dev/): current public inspection build backed by the versioned `knowledge/main` snapshot.
- [Inspection artifact v0.1.0](../artifacts/okm-public-v0.1.0/README.md): graph JSON, one `ApiUnit` per object, schema, source and rights records, checksums, readers, and static React viewer.
- [Current system architecture](current-system-architecture.md): implemented package, database, API, pipeline, and viewer boundaries.
- [Theory decision record](theory-decision-record.md): frozen terminology and the boundary of the current research claim.
- [AI-NKS v0.1](ai-nks-v0.1.md): top-level conceptual system standard.
- [Knowledge unit contract](knowledge-unit-contract.md): public `ApiUnit` consumption contract.
- [Documentation status](documentation-status.md): priority rules when older documents use different terminology.

## Engineering standards

- [World knowledge standard](../schemas/world-knowledge-standard.md): executable `world-v1.2` graph baseline.
- [World knowledge architecture](../schemas/world-knowledge-architecture.md): storage and evidence architecture.
- [Prompt inventory](prompt-inventory.md): model inputs, structured outputs, and prompt locations.
- [Node extraction policy](node-extraction-policy.md): admission rules for canonical knowledge candidates.

## Research and reports

- [Implementation technical report source](open_knowledge_map_technical_report.tex): current working LaTeX report grounded in the repository implementation. Its claims, screenshots, author metadata, and generated PDF must be reviewed before archival release.
- [Theoretical foundation](theoretical-foundation.md): motivation and historical framing.

## Operations and history

- [Populated synthetic demo](../examples/demo-data/README.md): repository-authored graph and one-command local viewer path.
- [TypeScript pipeline migration record](history/pipeline-typescript-migration.md): completed Python-to-TypeScript migration scope and verification history.
- [Open-source release checklist](open-source-release-checklist.md): legal, product, benchmark, and GitHub release gates.

The current conceptual standard is `ai-nks-v0.1`; the executable schema baseline is `world-v1.2`; `ApiUnit` is the public consumption contract. These versions name different layers and should not be collapsed into one number.
