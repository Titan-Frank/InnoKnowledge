# Rights and publication boundary

The exported snapshot comes from the PostgreSQL `knowledge/main` dataset. That database contains textbook-derived evidence, generated Knowledge Objects, cards, bodies, and profiles. It currently has no `world_source_artifacts` records that establish public redistribution permission for those sources.

The export therefore records:

- `source_clearance: review-required`;
- `publication_status: candidate-rights-review-required`;
- `redistribution: not-cleared-for-public-redistribution`.

Binary textbook images are not copied into this directory, and live `/api/source/.../assets/...` URLs are removed. Textual evidence and generated content remain source-derived and still require a file-by-file and source-by-source rights review.

The repository also does not currently contain a root `LICENSE`. No open reuse license should be inferred for the software, schemas, documentation, or data. A future release must state separate terms for each layer.

The repository owner has authorized public inspection of this snapshot and stated that the source textbooks are open source. Passing `--allow-unreviewed` still does not record the exact upstream license, complete a source-by-source copyright review, or grant a separate reuse license. Public availability should therefore be treated as an inspection release while source URLs and license identifiers are completed. This artifact is also not a benchmark result or a statement of educational effectiveness.
