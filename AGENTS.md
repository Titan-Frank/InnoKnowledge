# Repository Guidelines

## Project Structure & Module Organization

This repository uses a TypeScript-first extraction pipeline. Main areas:

- `packages/types`: shared TypeScript models and API types.
- `packages/pipeline`: TypeScript pipeline commands, stage logic, PostgreSQL executors, and stage tests.
- `packages/server`: Hono-based API server and PostgreSQL query layer.
- `packages/viewer`: React/Vite graph viewer UI.
- `schemas`: JSON Schemas, PostgreSQL schema files, and the world knowledge standard docs.
- `data`, `runs`, `storage`, `tmp`: generated or local artifacts; do not treat them as canonical source.

## Build, Test, and Development Commands

Install dependencies:

```bash
npm install
```

Run the local app stack:

```bash
npm run dev
```

Build all TypeScript workspaces:

```bash
npm run build
```

Run TypeScript checks across workspaces:

```bash
npm run check
```

Start PostgreSQL before pipeline work:

```bash
# 只用 Docker 启动本地 PostgreSQL
docker compose up -d postgres
export DATABASE_URL=postgresql://okm:okm@localhost:5432/knowledge
docker compose exec -T postgres psql -U okm -d knowledge < schemas/pg/knowledge_store.sql
```

Run the TypeScript extraction pipeline:

```bash
npm run server-pipeline-run -w packages/pipeline -- --book-id chem-grade8 --pdf-path /abs/path/to/book.pdf --db "$DATABASE_URL"
```

Run pipeline tests:

```bash
npm test -w packages/pipeline
```

## Coding Style & Naming Conventions

Use TypeScript for new implementation work. Follow existing style: two-space TypeScript/React indentation, descriptive camelCase identifiers, and PascalCase React components. Keep shared contracts in `packages/types` and schema constraints in `schemas`; avoid duplicated type definitions.

## Testing Guidelines

Before submitting changes, run `npm run check` and `npm run build`. For `packages/pipeline`, add or update colocated `*.test.ts` files and run `npm test -w packages/pipeline`. For pipeline QA, prefer the TypeScript commands:

```bash
npm run strict-qa -w packages/pipeline -- --dataset-id main --db "$DATABASE_URL"
npm run graph-integrity -w packages/pipeline -- --dataset-id main --db "$DATABASE_URL"
```

Use focused fixtures that prove current stage contracts and business outputs. For database paths, use temporary data, verify writes, and clean up test rows.

## Commit & Pull Request Guidelines

Recent commits use short, imperative summaries such as `Fix node click triggering full graph rebuild`. Keep commits focused on one logical change.

Pull requests should include a concise description, affected packages or scripts, verification commands, and screenshots for viewer changes. Link related issues or runs when available.

## Architecture & Data Rules

The top-level conceptual standard is `ai-nks-v0.2`; unified world knowledge `world-v1.3` is the active executable engineering schema. A Knowledge Object has one canonical identity, semantic Domain Profiles, and separate Curriculum Projections. Cross-disciplinary paths must use explicit bridge objects and evidence-backed segments. User-facing relation names are Chinese; stable snake-case codes are internal only. Do not use retired `schemas/v2/*`, `world-v1.2`, or `same_as` assumptions. Process textbooks by lesson unless explicitly asked otherwise. Lesson workers may write only `world_lesson_runs` and `world_staging_*`. Canonical `world_*` writes, duplicate merges, remapping, and final QA status belong only in reducer steps.
