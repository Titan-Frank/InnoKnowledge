import assert from "node:assert/strict";
import test from "node:test";

import { buildEmbeddingBackfillSqlPlan, buildSelectMissingEmbeddingsStatement } from "./embeddings.js";

test("builds select statements like Python backfill_embeddings", () => {
  assert.deepEqual(buildSelectMissingEmbeddingsStatement("world_nodes"), {
    name: "select-world-nodes-missing-embeddings",
    sql: "SELECT id, name, definition, aliases_json, domains_json FROM world_nodes WHERE embedding IS NULL",
    params: [],
  });
  assert.deepEqual(buildSelectMissingEmbeddingsStatement("world_staging_nodes"), {
    name: "select-world-staging-nodes-missing-embeddings",
    sql: "SELECT raw_node_id, name, definition, aliases_json, domains_json FROM world_staging_nodes WHERE embedding IS NULL",
    params: [],
  });
});

test("builds canonical embedding update plan without executing database operations", () => {
  const plan = buildEmbeddingBackfillSqlPlan("world_nodes", [
    { id: "n1", vector: [0.1, 0.2] },
    { id: "n2", vector: [] },
    { id: "n3", vector: null },
  ]);

  assert.equal(plan.updates.length, 1);
  assert.deepEqual(plan.updates[0], {
    name: "update-world_nodes-embedding",
    sql: "UPDATE world_nodes SET embedding = $1::vector WHERE id = $2",
    params: ["[0.1,0.2]", "n1"],
  });
  assert.deepEqual(
    plan.statements.map((statement) => statement.name),
    ["select-world-nodes-missing-embeddings", "update-world_nodes-embedding"],
  );
});

test("builds staging embedding update plan with raw_node_id key", () => {
  const plan = buildEmbeddingBackfillSqlPlan("world_staging_nodes", [{ id: "raw-1", vector: [0.3] }]);

  assert.deepEqual(plan.updates[0], {
    name: "update-world_staging_nodes-embedding",
    sql: "UPDATE world_staging_nodes SET embedding = $1::vector WHERE raw_node_id = $2",
    params: ["[0.3]", "raw-1"],
  });
});
