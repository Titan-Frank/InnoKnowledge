# Contributing

[中文说明](CONTRIBUTING.zh-CN.md)

Thank you for contributing to Open Knowledge Map. Read this guide and the repository-level `AGENTS.md` before changing code, schemas, data contracts, or public documentation.

The public contribution process is prepared but not yet open: the project must first add a root license and confirm the terms for inbound contributions. Until then, use this guide for maintainer and invited review work only.

## Development setup

The repository uses Node.js 22 and npm workspaces.

```bash
npm ci
```

Create a short, descriptive branch from the latest `main`, for example `fix/node-selection` or `feature/evidence-filter`. Keep unrelated work in separate branches and commits.

Use short imperative commit messages that describe the actual change:

```text
Fix node click triggering full graph rebuild
```

## Architecture boundaries

New implementation should be TypeScript-first and must preserve these write boundaries:

- Lesson workers may write only `world_lesson_runs` and `world_staging_*` tables.
- Canonical `world_*` writes, duplicate resolution, identifier remapping, and final QA state belong only to reducers and later normalization steps.
- Shared contracts belong in `packages/types`; database constraints and knowledge standards belong in `schemas`.
- Textbooks are processed by lesson unless the change explicitly requires another unit.
- Enrichment may help with naming and granularity, but it cannot be used as source evidence for a node or relation.

If a change crosses one of these boundaries, explain the reason, migration path, and rollback plan in the pull request.

## Verification

Run at least the checks that match the affected scope:

| Scope | Required commands |
| --- | --- |
| Any TypeScript or React code | `npm run check` |
| `packages/pipeline` | `npm test -w packages/pipeline` |
| `packages/server` | `npm test -w packages/server` |
| Build, dependency, or cross-workspace changes | `npm run build` |
| Pipeline data quality or graph structure | `npm run strict-qa -w packages/pipeline -- --dataset-id main --db "$DATABASE_URL"` and `npm run graph-integrity -w packages/pipeline -- --dataset-id main --db "$DATABASE_URL"` |

Database quality checks should use disposable test data. Unit tests must not depend on external databases, live model APIs, or real credentials unless the test is explicitly marked as an integration test.

## Data, copyright, and secrets

Do not commit:

- textbook PDFs, pages, images, videos, answer keys, or long excerpts without documented permission;
- derived datasets or Knowledge Objects that are not cleared for public redistribution;
- local generated artifacts under `data`, `runs`, `storage`, or `tmp` unless a maintainer approves a small sanitized fixture;
- API keys, database credentials, tokens, personal information, learner records, or institution-internal data.

Prefer self-authored minimal fixtures. Record their source and rights status in the pull request, and review [PROVENANCE.md](PROVENANCE.md).

## Pull requests

Include:

- the purpose and main implementation choices;
- affected packages, scripts, contracts, or database tables;
- exact verification commands and results;
- compatibility, migration, and rollback notes where applicable;
- related issues, runs, or design documents.

Viewer changes require before/after screenshots. Use a short recording when the behavior is visible only during interaction. Screenshots and recordings must not expose credentials, personal data, or unauthorized learning material.
