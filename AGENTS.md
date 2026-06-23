# Repository Guidelines

## Project Structure & Module Organization

This repository combines a TypeScript web workspace with Python knowledge extraction scripts. The main packages are:

- `packages/types`: shared TypeScript models and API types.
- `packages/server`: Hono-based API server and PostgreSQL query layer.
- `packages/viewer`: React/Vite graph viewer UI.
- `scripts`: extraction, staging, merge, normalization, QA, and integrity tools.
- `schemas`: JSON Schemas, PostgreSQL schema files, and the world knowledge standard docs.
- `harness`: workflow runtime configuration and harness backend code.
- `data`, `runs`, `storage`, `tmp`: generated or local runtime artifacts; do not treat these as canonical source.

## Build, Test, and Development Commands

Install dependencies with:

```bash
npm install
```

Run the full local app stack:

```bash
npm run dev
```

Build server and viewer:

```bash
npm run build
```

Run TypeScript checks across workspaces:

```bash
npm run check
```

Start PostgreSQL and related services before pipeline work:

```bash
docker compose up -d
export DATABASE_URL=postgresql://okm:okm@localhost:5432/knowledge
```

Run the main extraction harness:

```bash
python3 scripts/run_okm_harness.py --book-id chem-grade8 --pdf-path /abs/path/to/book.pdf
```

## Coding Style & Naming Conventions

Use TypeScript for `packages/*` and Python for pipeline scripts. Follow existing style: two-space indentation in TypeScript/React, descriptive camelCase identifiers, PascalCase React components, and snake_case Python functions and filenames. Keep shared contracts in `packages/types` and schema constraints in `schemas`; avoid duplicating type definitions across packages.

## Testing Guidelines

There is no dedicated test runner configured yet. Before submitting changes, run `npm run check` and, for UI/server changes, `npm run build`. For pipeline or schema changes, run the relevant QA tools:

```bash
python3 scripts/strict_qa.py --dataset-id main
python3 scripts/check_graph_integrity.py --dataset-id main
```

When adding tests later, use colocated `*.test.ts` files for TypeScript and `tests/test_*.py` for Python.

## Commit & Pull Request Guidelines

Recent commits use short, imperative summaries such as `Fix node click triggering full graph rebuild` or `Migrate to world knowledge standard V1.2`. Keep commits focused on one logical change.

Pull requests should include a concise description, affected packages or scripts, verification commands run, and screenshots for viewer changes. Link related issues or runs when available.

## Architecture & Data Rules

The active standard is unified world knowledge `V1.2`; do not use retired `schemas/v2/*` assumptions. Process textbooks by lesson unless explicitly asked to process a whole book in one extraction context. Lesson workers may write only `world_lesson_runs` and `world_staging_*`. Canonical `world_*` writes, duplicate merges, remapping, and final QA status belong only in reducer steps.
