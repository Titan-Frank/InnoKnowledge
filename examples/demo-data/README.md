# Populated synthetic demo

This directory contains a small, fully repository-authored graph for testing the public viewer without a model API or third-party source material.

The demo models a simplified home-solar energy path. It contains 9 knowledge objects, one for each `world-v1.2` node kind, plus 12 typed relations, 9 evidence records, 9 mentions, 9 domain profiles, 9 cards, and 9 knowledge bodies. The source prose in `source.md` is synthetic and was written for this repository.

## Run it

From the repository root:

```bash
npm install
npm run demo
```

The command starts the Docker PostgreSQL service, creates an isolated `okm_demo` database, applies the current schema, loads `seed-demo.sql`, builds the application, and serves the viewer at <http://127.0.0.1:8765/viewer/>. It does not modify the default `knowledge` database.

To load or refresh the demo database without starting the application:

```bash
npm run demo:seed
```

`seed-demo.sql` is idempotent at the dataset boundary: it deletes and recreates only `dataset_id = 'demo'`. It can also be applied manually after `schemas/pg/knowledge_store.sql` has initialized a PostgreSQL database.

## Interpretation boundary

- The `source_type = 'textbook'` value is used because the current viewer's source-tree interface recognizes that source category. The demo module is not a real textbook.
- Evidence is marked `synthetic` and `quality_excluded`. It demonstrates traceability and complete `ApiUnit` assembly, not extraction accuracy.
- The lesson run is marked as a direct seed and remains at `merged`; it does not claim that model extraction, reducer execution, strict quality checks, or independent review took place.
- The facts are deliberately simple and illustrative. Do not use the module for system sizing, electrical installation, or engineering advice.
- Public reuse terms remain governed by the root license once the project selects one.
