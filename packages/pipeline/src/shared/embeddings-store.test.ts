import assert from "node:assert/strict";
import test from "node:test";

import { runEmbeddingBackfillFromDatabase, tablesForMode } from "./embeddings.js";
import type { SqlStatement } from "../staging/staging-sql.js";

test("resolves embedding backfill table modes", () => {
  assert.deepEqual(tablesForMode("world_nodes"), ["world_nodes"]);
  assert.deepEqual(tablesForMode("world_staging_nodes"), ["world_staging_nodes"]);
  assert.deepEqual(tablesForMode("both"), ["world_nodes", "world_staging_nodes"]);
});

test("runs database-backed embedding backfill across canonical and staging tables", async () => {
  const embeddedTexts: string[][] = [];
  const executed: SqlStatement[] = [];
  const result = await runEmbeddingBackfillFromDatabase({
    table: "both",
    batchSize: 2,
    query: (statement) => rowsForStatement(statement.name),
    embedTexts: (texts) => {
      embeddedTexts.push(texts);
      return texts.map((text) => [text.length]);
    },
    executeStatement: (statement) => {
      executed.push(statement);
    },
  });

  assert.deepEqual(embeddedTexts, [["Water A substance", "No vector"], ["Atom Particle 粒子 physics"]]);
  assert.equal(result.selected, 3);
  assert.equal(result.batches, 2);
  assert.equal(result.updated, 3);
  assert.deepEqual(result.read_statements, ["select-world-nodes-missing-embeddings", "select-world-staging-nodes-missing-embeddings"]);
  assert.deepEqual(result.statements, ["update-world_nodes-embedding", "update-world_nodes-embedding", "update-world_staging_nodes-embedding"]);
  assert.equal(executed.length, 3);
  assert.deepEqual(result.tables, [
    { table: "world_nodes", selected: 2, batches: 1, updated: 2 },
    { table: "world_staging_nodes", selected: 1, batches: 1, updated: 1 },
  ]);
});

test("executes database-backed embedding backfill in batches", async () => {
  const embeddedTexts: string[][] = [];
  const sleeps: number[] = [];
  const executed: SqlStatement[] = [];
  const result = await runEmbeddingBackfillFromDatabase({
    table: "world_nodes",
    batchSize: 1,
    sleepBetweenBatchesMs: 5,
    sleep: async (ms) => {
      sleeps.push(ms);
    },
    query: (statement) => rowsForStatement(statement.name),
    embedTexts: (texts) => {
      embeddedTexts.push(texts);
      return texts.map((text) => (text.includes("No vector") ? [] : [text.length]));
    },
    executeStatement: (statement) => {
      executed.push(statement);
    },
  });

  assert.deepEqual(embeddedTexts, [["Water A substance"], ["No vector"]]);
  assert.deepEqual(sleeps, [5]);
  assert.equal(result.selected, 2);
  assert.equal(result.updated, 1);
  assert.deepEqual(result.statements, ["update-world_nodes-embedding"]);
  assert.deepEqual(result.executedStatements, ["update-world_nodes-embedding"]);
  assert.deepEqual(executed[0], {
    name: "update-world_nodes-embedding",
    sql: "UPDATE world_nodes SET embedding = $1::vector WHERE id = $2",
    params: ["[17]", "n1"],
  });
});

function rowsForStatement(name: string): Array<Record<string, unknown>> {
  switch (name) {
    case "select-world-nodes-missing-embeddings":
      return [
        { id: "n1", name: "Water", definition: "A substance", aliases_json: [], domains_json: [] },
        { id: "n2", name: "No vector", definition: "", aliases_json: [], domains_json: [] },
      ];
    case "select-world-staging-nodes-missing-embeddings":
      return [{ raw_node_id: "raw-1", name: "Atom", definition: "Particle", aliases_json: ["粒子"], domains_json: ["physics"] }];
    default:
      return [];
  }
}
