import assert from "node:assert/strict";
import test from "node:test";

import { runRetrieveCandidatesFromDatabase } from "./retrieve-candidates-store.js";
import type { SqlStatement } from "../staging/staging-sql.js";

test("writes retrieval payloads after loading candidates from database", async () => {
  const readStatements: string[] = [];
  const executed: SqlStatement[] = [];
  const output = await runRetrieveCandidatesFromDatabase({
    datasetId: "main",
    batchAnchor: "anchor",
    queries: [{ query_text: "water", query_id: "q1" }],
    mode: "hybrid",
    limit: 2,
    embedQuery: () => [0.1, 0.2],
    query: (statement) => {
      readStatements.push(statement.name);
      return rowsForStatement(statement.name);
    },
    executeStatement: (statement) => {
      executed.push(statement);
    },
  });

  assert.equal(output.status, "success");
  assert.equal(output.dataset_id, "main");
  assert.deepEqual(output.read_statements, ["select-local-retrieval-candidates", "select-vector-retrieval-candidates"]);
  assert.deepEqual(output.statements, ["upsert-retrieval-candidates"]);
  assert.deepEqual(output.executedStatements, output.statements);
  assert.equal(executed.length, 1);
  assert.deepEqual(output.payloads, [
    {
      dataset_id: "main",
      batch_anchor: "anchor",
      query_id: "q1",
      query_text: "water",
      candidates: [
        { node_id: "n1", name: "Water", kind: "concept", score: 108.5, method: "local+vector" },
        { node_id: "n2", name: "Cycle", kind: "process", score: 85, method: "local" },
      ],
    },
  ]);
  assert.deepEqual(readStatements, output.read_statements);
});

test("requires batch anchor for retrieval candidate writes", async () => {
  await assert.rejects(
    () =>
      runRetrieveCandidatesFromDatabase({
        datasetId: "main",
        batchAnchor: "",
        queries: [{ query_text: "water" }],
        query: () => [],
        executeStatement: () => undefined,
      }),
    /requires --batch-anchor/,
  );
});

test("writes retrieval candidates in SQL plan order", async () => {
  const executed: SqlStatement[] = [];
  const output = await runRetrieveCandidatesFromDatabase({
    datasetId: "main",
    batchAnchor: "anchor",
    queries: [{ query_text: "water", query_id: "q1" }],
    mode: "local",
    limit: 1,
    replace: true,
    now: "2026-01-02T03:04:05+00:00",
    query: (statement) => rowsForStatement(statement.name),
    executeStatement: (statement) => {
      executed.push(statement);
    },
  });

  assert.deepEqual(output.statements, ["delete-retrieval-candidates", "upsert-retrieval-candidates"]);
  assert.deepEqual(output.executedStatements, output.statements);
  assert.equal(executed.length, 2);
  assert.deepEqual(executed[0], {
    name: "delete-retrieval-candidates",
    sql: "DELETE FROM retrieval_candidates WHERE dataset_id = $1 AND query_id = $2",
    params: ["main", "q1"],
  });
  assert.match(executed[1]!.sql, /INSERT INTO retrieval_candidates/);
  assert.deepEqual(executed[1]!.params.slice(0, 10), [
    "main",
    "anchor",
    "q1",
    "water",
    "n1",
    1,
    100,
    "local",
    { mode: "local", domain: null, school_stage: null, node_kind: null },
    "2026-01-02T03:04:05+00:00",
  ]);
});

function rowsForStatement(name: string): Array<Record<string, unknown>> {
  switch (name) {
    case "select-local-retrieval-candidates":
      return [
        { id: "n1", name: "Water", kind: "concept", score: 100 },
        { id: "n2", name: "Cycle", kind: "process", score: 85 },
      ];
    case "select-vector-retrieval-candidates":
      return [{ id: "n1", name: "Water", kind: "concept", similarity: 0.9 }];
    default:
      return [];
  }
}
