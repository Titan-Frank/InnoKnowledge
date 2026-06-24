import assert from "node:assert/strict";
import test from "node:test";

import { EMBEDDING_DIMENSION, runClusterNodesFromDatabase } from "./cluster-nodes.js";
import type { SqlStatement } from "../staging/staging-sql.js";

test("skips database-backed node clustering updates when there are too few valid nodes", async () => {
  const executed: SqlStatement[] = [];
  const result = await runClusterNodesFromDatabase({
    datasetId: "main",
    fixedK: 4,
    query: () => rowsForStatement("small"),
    executeStatement: (statement) => {
      executed.push(statement);
    },
  });

  assert.deepEqual(result, {
    status: "success",
    dataset_id: "main",
    total_nodes: 2,
    clustered_nodes: 0,
    k: 0,
    read_statements: ["select-world-nodes-cluster-source"],
    statements: [],
    executedStatements: [],
  });
  assert.deepEqual(executed, []);
});

test("executes database-backed node clustering updates", async () => {
  const executed: SqlStatement[] = [];
  const result = await runClusterNodesFromDatabase({
    datasetId: "main",
    fixedK: 2,
    seed: 42,
    query: (statement) => rowsForStatement(statement.name),
    computeLayout: (nodes) => ({
      labels: nodes.map((_, index) => (index < 5 ? 0 : 1)),
      coords: nodes.map((_, index) => [index, -index] as const),
    }),
    executeStatement: (statement) => {
      executed.push(statement);
    },
  });

  assert.equal(result.total_nodes, 11);
  assert.equal(result.clustered_nodes, 10);
  assert.equal(result.k, 2);
  assert.deepEqual(result.cluster_sizes, { "0": 5, "1": 5 });
  assert.equal(executed.length, 10);
  assert.deepEqual(result.executedStatements, executed.map((statement) => statement.name));
  assert.deepEqual(executed[0], {
    name: "update-world-node-cluster-layout",
    sql: "UPDATE world_nodes SET properties_json = $1::jsonb WHERE dataset_id = $2 AND id = $3",
    params: [{ old: true, community_id: 0, layout: { x: 0, y: 0 } }, "main", "n0"],
  });
});

function rowsForStatement(name: string): Array<Record<string, unknown>> {
  if (name === "small") {
    return [
      { id: "s1", embedding: vector(1), properties_json: {} },
      { id: "s2", embedding: vector(2), properties_json: {} },
    ];
  }
  if (name !== "select-world-nodes-cluster-source") return [];
  return [
    ...Array.from({ length: 10 }, (_, index) => ({
      id: `n${index}`,
      embedding: vector(index),
      properties_json: index === 0 ? { old: true } : {},
    })),
    { id: "bad", embedding: [1, 2], properties_json: {} },
  ];
}

function vector(seed: number): number[] {
  return Array.from({ length: EMBEDDING_DIMENSION }, (_, index) => seed + index / EMBEDDING_DIMENSION);
}
