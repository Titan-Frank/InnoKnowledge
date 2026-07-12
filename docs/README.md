# Documentation index

Use this page to distinguish current contracts from theory, historical run notes, and future plans.

## Start here

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

- [Technical report source](open_knowledge_map_technical_report.tex): working LaTeX draft. Its claims, screenshots, author metadata, and generated PDF must be reviewed before public release.
- [Theoretical foundation](theoretical-foundation.md): motivation and historical framing.
- [AI-NKS technical report v0.2](ai_nks_technical_report_v0_2.md): concept-architecture draft.
- [Discussion notes](discussion.md): broader design discussion.

## Operations and history

- [Populated synthetic demo](../examples/demo-data/README.md): repository-authored graph and one-command local viewer path.
- [TypeScript pipeline migration record](history/pipeline-typescript-migration.md): completed Python-to-TypeScript migration scope and verification history.
- [Physics extraction run, 2026-06-26](physics-hukj-compulsory-3-extraction-run-2026-06-26.md): one historical run record, not the current standard.
- [Next-step plan, 2026-06-26](next-step-plan-2026-06-26.md): dated roadmap; confirm completion against current code.
- [Open-source release checklist](open-source-release-checklist.md): legal, product, benchmark, and GitHub release gates.

The current conceptual standard is `ai-nks-v0.1`; the executable schema baseline is `world-v1.2`; `ApiUnit` is the public consumption contract. These versions name different layers and should not be collapsed into one number.
