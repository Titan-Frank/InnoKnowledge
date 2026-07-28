# Open-source release checklist

This checklist separates release blockers from presentation improvements. Completing the high-priority items does not override any blocker.

## Release blockers

- [ ] Select and add a root license for source code.
- [ ] Decide separate terms for schemas, documentation, screenshots, safe sample data, and any published Knowledge Object dataset.
- [ ] Audit every visible screenshot for textbook excerpts, source images, personal data, internal identifiers, and third-party branding.
- [ ] Publish only self-authored, public-domain, openly licensed, or explicitly authorized sample material.
- [ ] Document source, version, retrieval date, and license for every released dataset.
- [ ] Confirm that generated Knowledge Objects and evidence snippets do not reproduce protected source expression beyond the intended permission.
- [ ] Run secret and sensitive-data checks over Git history and release artifacts.
- [ ] Review `.env`, logs, run manifests, screenshots, PDFs, database exports, and benchmark outputs before staging.
- [ ] Confirm that the author names, affiliations, and email addresses embedded in the technical report are intended for public release.
- [ ] Confirm whether the software citation author and the technical-report authors belong to different attribution scopes; update `CITATION.cff` accordingly.
- [ ] Decide whether the repository itself will become public or whether a separate public release repository will contain the safe output layer.

## High-priority release work

- [x] Rewrite the default README around a clear public value proposition.
- [x] Add English and Chinese README entry points.
- [x] Add real product screenshots using the repository-authored demo, with descriptive alternative text.
- [x] Add GitHub continuous integration for checks, tests, and builds.
- [x] Add citation metadata, contribution guidance, security guidance, and provenance boundaries.
- [x] Provide a populated, repository-authored demo graph that requires no model API calls.
- [x] Provide a one-command demo path that initializes an isolated PostgreSQL database, loads the safe graph, and starts the viewer.
- [x] Publish a versioned read-only inspection artifact with JSON data, `ApiUnit` objects, schemas, readers, and a static viewer.
- [ ] Publish a cleaned benchmark directory with exact commands, fixtures, outputs, and limitations.
- [ ] Complete independent human review and fair baseline comparisons before making research-performance claims.
- [x] Add a versioned release manifest with counts and checksums for every public data file.
- [x] Add a versioned changelog entry for the first public preview.
- [x] Add a root documentation index and ensure every README link resolves.
- [x] Remove legacy textbook-derived fixtures and research experiments from the public source-release boundary.

## GitHub release configuration

- [ ] Set a concise repository description.
- [ ] Add focused topics such as `knowledge-graph`, `education`, `rag`, `typescript`, `postgresql`, and `knowledge-representation`.
- [ ] Enable private vulnerability reporting.
- [ ] Configure branch protection and require the CI workflow.
- [ ] Create a version tag and GitHub Release with a short change summary.
- [ ] Attach the technical report and public data manifest where rights allow.
- [ ] Approve the live read-only preview for public redistribution after source clearance; the current preview URL is `https://open-knowledge-map.pages.dev/`.
- [ ] Add social preview artwork based on the graph explorer rather than a dense application screenshot.

## Launch and post-release

- [ ] Prepare one short demonstration: graph overview, source evidence, complete unit, and citation-validated answer.
- [ ] Publish one reproducible technical example and one nontechnical visual explanation.
- [ ] Invite adapters around `ApiUnit`, including lightweight SDKs, Model Context Protocol tools, and third-party viewers.
- [ ] Triage issues with labels for data quality, semantic quality, documentation, integrations, and rights review.
- [ ] Add semantic checks for name/description/evidence consistency, duplicate names, cycle detection, and implausible prerequisite direction.
- [ ] Track release adoption separately from benchmark effectiveness; GitHub stars are not evidence of educational quality.
- [ ] Revisit the release rights matrix whenever a new source collection, subject, or jurisdiction is added.
