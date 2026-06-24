import assert from "node:assert/strict";
import test from "node:test";

import { buildRetrievalCandidatesSqlPlan } from "./retrieve-candidates-sql.js";
import { buildRetrievalFilters, planRetrievalCandidateInsertRows } from "./retrieve-candidates.js";

test("builds retrieval candidate SQL plan like Python persist_candidates", () => {
  const filters = buildRetrievalFilters({ mode: "hybrid", domain: "chemistry", schoolStage: "junior-secondary", nodeKind: "concept" });
  const rows = planRetrievalCandidateInsertRows(
    {
      dataset_id: "main",
      batch_anchor: "anchor",
      query_id: "q1",
      query_text: "water",
      candidates: [
        { node_id: "n1", name: "Water", kind: "concept", score: 108, method: "local+vector" },
        { node_id: "n2", name: "Cycle", kind: "process", score: 75, method: "vector" },
      ],
    },
    filters,
    "2026-01-01T00:00:00+00:00",
  );

  const plan = buildRetrievalCandidatesSqlPlan({ rows, replace: true });

  assert.deepEqual(plan.deleteExisting, {
    name: "delete-retrieval-candidates",
    sql: "DELETE FROM retrieval_candidates WHERE dataset_id = $1 AND query_id = $2",
    params: ["main", "q1"],
  });
  assert.equal(plan.insert?.name, "upsert-retrieval-candidates");
  assert.equal(plan.insert?.table, "retrieval_candidates");
  assert.equal(plan.insert?.rowCount, 2);
  assert.deepEqual(plan.insert?.columns, [
    "dataset_id",
    "batch_anchor",
    "query_id",
    "query_text",
    "candidate_node_id",
    "rank",
    "score",
    "retrieval_method",
    "filters_json",
    "created_at",
  ]);
  assert.match(plan.insert?.sql ?? "", /ON CONFLICT \(dataset_id, query_id, candidate_node_id\) DO UPDATE SET/);
  assert.match(plan.insert?.sql ?? "", /\$9::jsonb/);
  assert.deepEqual(plan.insert?.params.slice(0, 10), [
    "main",
    "anchor",
    "q1",
    "water",
    "n1",
    1,
    108,
    "local+vector",
    filters,
    "2026-01-01T00:00:00+00:00",
  ]);
  assert.deepEqual(
    plan.statements.map((statement) => statement.name),
    ["delete-retrieval-candidates", "upsert-retrieval-candidates"],
  );
});

test("skips empty retrieval candidate insert while preserving explicit replace delete", () => {
  const plan = buildRetrievalCandidatesSqlPlan({ rows: [], replace: true, datasetId: "main", queryId: "q1" });

  assert.equal(plan.insert, null);
  assert.deepEqual(plan.deleteExisting?.params, ["main", "q1"]);
  assert.deepEqual(
    plan.statements.map((statement) => statement.name),
    ["delete-retrieval-candidates"],
  );
});

test("omits retrieval candidate delete when replace is false", () => {
  const rows = planRetrievalCandidateInsertRows(
    {
      dataset_id: "main",
      batch_anchor: null,
      query_id: "q1",
      query_text: "water",
      candidates: [{ node_id: "n1", name: "Water", kind: "concept", score: 100, method: "local" }],
    },
    buildRetrievalFilters({ mode: "local" }),
    "2026-01-01T00:00:00+00:00",
  );

  const plan = buildRetrievalCandidatesSqlPlan({ rows });
  assert.equal(plan.deleteExisting, null);
  assert.deepEqual(
    plan.statements.map((statement) => statement.name),
    ["upsert-retrieval-candidates"],
  );
});
