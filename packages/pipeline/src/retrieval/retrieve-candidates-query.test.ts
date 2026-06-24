import assert from "node:assert/strict";
import test from "node:test";

import {
  buildLocalCandidatesQuery,
  buildVectorCandidatesQuery,
  loadRetrievalCandidatesForQueries,
  mapLocalCandidateRows,
  mapVectorCandidateRows,
  type RetrievalCandidateQueryExecutor,
} from "./retrieve-candidates-query.js";

test("builds local candidate query like Python fetch_local_candidates", () => {
  const statement = buildLocalCandidatesQuery({
    datasetId: "main",
    queryText: " Water   Cycle ",
    nodeKind: "concept",
    domain: "chemistry",
    schoolStage: "junior-secondary",
    limit: 8,
  });

  assert.equal(statement.name, "select-local-retrieval-candidates");
  assert.deepEqual(statement.params, [
    "water cycle",
    "water cycle%",
    "main",
    "concept",
    "chemistry",
    "junior-secondary",
    "water cycle",
    "water cycle%",
    "%Water   Cycle%",
    24,
  ]);
  assert.match(statement.sql, /CASE\n         WHEN nt\.term_norm = \$1 THEN 100\n         WHEN nt\.term_norm LIKE \$2 THEN 85/);
  assert.match(statement.sql, /n\.dataset_id = \$3/);
  assert.match(statement.sql, /n\.kind = \$4/);
  assert.match(statement.sql, /p\.domain = \$5/);
  assert.match(statement.sql, /\$6 = ANY\(SELECT jsonb_array_elements_text\(p\.school_stages_json\)\)/);
  assert.match(statement.sql, /nt\.term_norm = \$7 OR nt\.term_norm LIKE \$8 OR n\.definition ILIKE \$9/);
  assert.match(statement.sql, /ORDER BY score DESC, n\.name\nLIMIT \$10/);
});

test("builds local candidate query without optional filters", () => {
  const statement = buildLocalCandidatesQuery({
    datasetId: "main",
    queryText: "atom",
  });

  assert.deepEqual(statement.params, ["atom", "atom%", "main", "atom", "atom%", "%atom%", 24]);
  assert.doesNotMatch(statement.sql, /n\.kind =/);
  assert.doesNotMatch(statement.sql, /world_domain_profiles p/);
  assert.match(statement.sql, /nt\.term_norm = \$4 OR nt\.term_norm LIKE \$5 OR n\.definition ILIKE \$6/);
  assert.match(statement.sql, /LIMIT \$7/);
});

test("maps local rows like Python fetch_local_candidates", () => {
  assert.deepEqual(
    mapLocalCandidateRows([
      { id: "n1", name: "Water", kind: "concept", score: 100 },
      { id: "n2", name: "Cycle", kind: "process", score: "85" },
      { id: "n3", name: "Bad", kind: "concept", score: "bad" },
    ]),
    [
      { node_id: "n1", name: "Water", kind: "concept", score: 100, method: "local" },
      { node_id: "n2", name: "Cycle", kind: "process", score: 85, method: "local" },
    ],
  );
});

test("builds vector candidate query like Python fetch_vector_candidates", () => {
  const embedding = [0.1, 0.2, 0.3];
  const statement = buildVectorCandidatesQuery({
    datasetId: "main",
    embedding,
    nodeKind: "concept",
    limit: 8,
  });

  assert.equal(statement.name, "select-vector-retrieval-candidates");
  assert.deepEqual(statement.params, [embedding, "main", "concept", embedding, 16]);
  assert.match(statement.sql, /SELECT id, name, kind, 1 - \(embedding <=> \$1::vector\) AS similarity/);
  assert.match(statement.sql, /dataset_id = \$2 AND status != 'deprecated' AND embedding IS NOT NULL AND kind = \$3/);
  assert.match(statement.sql, /ORDER BY embedding <=> \$4::vector\nLIMIT \$5/);
});

test("builds vector candidate query without optional node kind", () => {
  const embedding = [0.1, 0.2];
  const statement = buildVectorCandidatesQuery({
    datasetId: "main",
    embedding,
  });

  assert.deepEqual(statement.params, [embedding, "main", embedding, 16]);
  assert.doesNotMatch(statement.sql, /kind =/);
  assert.match(statement.sql, /ORDER BY embedding <=> \$3::vector\nLIMIT \$4/);
});

test("maps vector rows with Python-compatible score threshold", () => {
  assert.deepEqual(
    mapVectorCandidateRows(
      [
        { id: "n1", name: "Water", kind: "concept", similarity: 0.5 },
        { id: "n2", name: "Cycle", kind: "process", similarity: "0.8" },
        { id: "n3", name: "Drop", kind: "concept", similarity: 0.49 },
        { id: "n4", name: "Bad", kind: "concept", similarity: "bad" },
      ],
      0.5,
    ),
    [
      { node_id: "n1", name: "Water", kind: "concept", score: 65, method: "vector" },
      { node_id: "n2", name: "Cycle", kind: "process", score: 80, method: "vector" },
    ],
  );
});

test("loads retrieval context candidates with read-only query executor", async () => {
  const statementNames: string[] = [];
  const executor: RetrievalCandidateQueryExecutor = (statement) => {
    statementNames.push(statement.name);
    if (statement.name === "select-local-retrieval-candidates") {
      return [
        { id: "n1", name: "Water", kind: "concept", score: 100 },
        { id: "n2", name: "Cycle", kind: "process", score: 85 },
      ];
    }
    return [];
  };

  const candidates = await loadRetrievalCandidatesForQueries({
    datasetId: "dataset-a",
    queries: ["Water", "Water", ""],
    executor,
    mode: "hybrid",
    domain: "chemistry",
    schoolStage: "senior-secondary",
    limit: 2,
  });

  assert.deepEqual(statementNames, ["select-local-retrieval-candidates"]);
  assert.deepEqual(candidates, [
    { node_id: "n1", name: "Water", kind: "concept", score: 100, method: "local" },
    { node_id: "n2", name: "Cycle", kind: "process", score: 85, method: "local" },
  ]);
});

test("loads vector candidates when an embedding provider is supplied", async () => {
  const statementNames: string[] = [];
  const executor: RetrievalCandidateQueryExecutor = (statement) => {
    statementNames.push(statement.name);
    if (statement.name === "select-vector-retrieval-candidates") {
      return [{ id: "n3", name: "Atom", kind: "concept", similarity: 0.9 }];
    }
    return [];
  };

  const candidates = await loadRetrievalCandidatesForQueries({
    datasetId: "dataset-a",
    queries: ["Atom"],
    executor,
    embedQuery: () => [0.1, 0.2],
    mode: "vector",
    limit: 4,
  });

  assert.deepEqual(statementNames, ["select-vector-retrieval-candidates"]);
  assert.deepEqual(candidates, [{ node_id: "n3", name: "Atom", kind: "concept", score: 85, method: "vector" }]);
});
