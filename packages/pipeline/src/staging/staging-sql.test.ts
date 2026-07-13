import assert from "node:assert/strict";
import test from "node:test";

import { buildStagingTableRows } from "./staging-rows.js";
import { buildStagingSqlPlan } from "./staging-sql.js";
import { normalizeLessonArtifacts } from "./staging.js";

const context = {
  datasetId: "main",
  lessonRunId: "lesson-run:1",
  bookId: "chem-grade8",
  batchAnchor: "struct:chem-grade8:lesson:1-1-1",
  now: "2026-01-02T03:04:05+00:00",
};

test("builds a staging SQL plan without executing database operations", () => {
  const rows = buildStagingTableRows(
    context,
    normalizeLessonArtifacts(
      {
        nodes: [{ id: "n1", name: "Water", kind: "concept", definition: "A substance", aliases: ["H2O"] }],
        edges: [{ id: "e1", type: "related_to", from: "n1", to: "n1" }],
        domainProfiles: [{ id: "p1", node_id: "n1", domain: "chemistry" }],
        mentions: [{ id: "m1", target_id: "n1" }],
        evidence: [{ id: "ev1", excerpt: "claim", normalized_claims: ["claim"] }],
        nodeCards: [{ id: "c1", node_id: "n1" }],
      },
      context.bookId,
      context.batchAnchor,
    ),
  );

  const plan = buildStagingSqlPlan(rows);

  assert.equal(plan.lessonRun.name, "upsert-world-lesson-run");
  assert.match(plan.lessonRun.sql, /INSERT INTO world_lesson_runs/);
  assert.match(plan.lessonRun.sql, /\$6::jsonb/);
  assert.deepEqual(plan.lessonRun.params.slice(0, 6), [
    "main",
    "lesson-run:1",
    "chem-grade8",
    "struct:chem-grade8:lesson:1-1-1",
    "staged",
    rows.lesson_run.counts_json,
  ]);

  assert.equal(plan.deletes.length, 7);
  assert.deepEqual(plan.deletes[0], {
    name: "delete-world_staging_nodes",
    sql: "DELETE FROM world_staging_nodes WHERE dataset_id = $1 AND lesson_run_id = $2",
    params: ["main", "lesson-run:1"],
  });

  const nodeInsert = plan.inserts.find((statement) => statement.table === "world_staging_nodes");
  assert.ok(nodeInsert);
  assert.deepEqual(nodeInsert.columns, [
    "dataset_id",
    "lesson_run_id",
    "raw_node_id",
    "book_id",
    "batch_anchor",
    "name",
    "kind",
    "subkind",
    "definition",
    "aliases_json",
    "domains_json",
    "knowledge_form_json",
    "learning_mode_json",
    "scope",
    "properties_json",
    "external_ids_json",
    "tags_json",
    "semantic_key",
    "embedding",
    "source_refs_json",
    "status",
    "created_at",
    "updated_at",
    "notes",
  ]);
  assert.match(nodeInsert.sql, /\$10::jsonb/);
  assert.match(nodeInsert.sql, /\$15::jsonb/);
  assert.equal(nodeInsert.params[0], "main");
  assert.equal(nodeInsert.params[2], "n1");
  assert.deepEqual(nodeInsert.params[9], ["H2O"]);
});

test("skips empty insert batches while preserving delete statements", () => {
  const rows = buildStagingTableRows(
    context,
    normalizeLessonArtifacts(
      {
        nodes: [],
        edges: [],
        domainProfiles: [],
        mentions: [],
        evidence: [],
        nodeCards: [],
      },
      context.bookId,
      context.batchAnchor,
    ),
  );

  const plan = buildStagingSqlPlan(rows);
  assert.equal(plan.deletes.length, 7);
  assert.equal(plan.inserts.length, 0);
  assert.equal(plan.statements.length, 8);
});
