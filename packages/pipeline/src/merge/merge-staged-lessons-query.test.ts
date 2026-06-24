import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFetchStagedRowsQuery,
  buildLoadExistingDomainProfilesQuery,
  buildLoadExistingEvidenceIdsQuery,
  buildFilterExistingEvidenceIdsQuery,
  buildLoadCanonicalNodesQuery,
  buildLoadExistingByIdQuery,
  buildLoadMergeLessonRunsQuery,
} from "./merge-staged-lessons-query.js";

test("builds merge lesson run selection query like Python load_lesson_runs", () => {
  assert.deepEqual(
    buildLoadMergeLessonRunsQuery({
      datasetId: "main",
      bookId: "chem",
      lessonRunIds: ["lesson-run:2", "lesson-run:1"],
      batchAnchors: ["struct:chem:chunk:1"],
    }),
    {
      name: "select-merge-lesson-runs",
      sql:
        "SELECT * FROM world_lesson_runs WHERE dataset_id = $1 AND status IN ('staged', 'merging') AND book_id = $2 AND lesson_run_id = ANY($3) AND batch_anchor = ANY($4) ORDER BY created_at, lesson_run_id",
      params: ["main", "chem", ["lesson-run:2", "lesson-run:1"], ["struct:chem:chunk:1"]],
    },
  );
});

test("builds merge lesson run query without optional filters", () => {
  assert.deepEqual(buildLoadMergeLessonRunsQuery({ datasetId: "main" }), {
    name: "select-merge-lesson-runs",
    sql: "SELECT * FROM world_lesson_runs WHERE dataset_id = $1 AND status IN ('staged', 'merging') ORDER BY created_at, lesson_run_id",
    params: ["main"],
  });
});

test("builds canonical node load query like Python load_canonical_nodes", () => {
  assert.deepEqual(buildLoadCanonicalNodesQuery("main"), {
    name: "select-merge-canonical-nodes",
    sql: "SELECT *\nFROM world_nodes\nWHERE dataset_id = $1 AND status != 'deprecated'\nORDER BY id",
    params: ["main"],
  });
});

test("builds existing canonical support queries for database merge", () => {
  assert.deepEqual(buildLoadExistingDomainProfilesQuery("main"), {
    name: "select-existing-world-domain-profiles",
    sql: "SELECT *\nFROM world_domain_profiles\nWHERE dataset_id = $1\nORDER BY id",
    params: ["main"],
  });
  assert.deepEqual(buildLoadExistingEvidenceIdsQuery("main"), {
    name: "select-existing-world-evidence-ids",
    sql: "SELECT id\nFROM world_evidence\nWHERE dataset_id = $1\nORDER BY id",
    params: ["main"],
  });
});

test("builds staged row fetch query for allowed staging tables", () => {
  assert.deepEqual(buildFetchStagedRowsQuery("world_staging_edges", "main", "lesson-run:1"), {
    name: "select-world_staging_edges",
    sql: "SELECT * FROM world_staging_edges WHERE dataset_id = $1 AND lesson_run_id = $2 ORDER BY created_at",
    params: ["main", "lesson-run:1"],
  });
});

test("builds existing row lookup query with constrained table and key", () => {
  assert.deepEqual(
    buildLoadExistingByIdQuery({
      table: "world_domain_profiles",
      datasetId: "main",
      itemId: "domain-profile:1",
    }),
    {
      name: "select-existing-world_domain_profiles",
      sql: "SELECT * FROM world_domain_profiles WHERE dataset_id = $1 AND id = $2",
      params: ["main", "domain-profile:1"],
    },
  );
  assert.deepEqual(
    buildLoadExistingByIdQuery({
      table: "world_node_cards",
      datasetId: "main",
      itemId: "concept:auto-water",
      key: "node_id",
    }),
    {
      name: "select-existing-world_node_cards",
      sql: "SELECT * FROM world_node_cards WHERE dataset_id = $1 AND node_id = $2",
      params: ["main", "concept:auto-water"],
    },
  );
});

test("builds existing evidence id filter query and skips empty input like Python", () => {
  assert.equal(buildFilterExistingEvidenceIdsQuery("main", []), null);
  assert.deepEqual(buildFilterExistingEvidenceIdsQuery("main", ["ev2", "ev1"]), {
    name: "select-existing-evidence-ids",
    sql: "SELECT id\nFROM world_evidence\nWHERE dataset_id = $1 AND id = ANY($2)",
    params: ["main", ["ev2", "ev1"]],
  });
});
