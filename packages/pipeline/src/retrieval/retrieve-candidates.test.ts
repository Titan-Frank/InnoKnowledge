import assert from "node:assert/strict";
import test from "node:test";

import {
  buildRetrievalFilters,
  buildRetrievalPayloads,
  loadRetrievalQueries,
  mergeCandidates,
  planRetrievalCandidateInsertRows,
} from "./retrieve-candidates.js";

test("merges retrieval candidates like Python retrieve_candidates", () => {
  const merged = mergeCandidates(
    [
      [
        { node_id: "n1", name: "Water", kind: "concept", score: 100, method: "local" },
        { node_id: "n2", name: "Atom", kind: "concept", score: 85, method: "local" },
        { node_id: "n3", name: "Atom", kind: "concept", score: 85, method: "local" },
      ],
      [
        { node_id: "n1", name: "Water", kind: "concept", score: 80, method: "vector" },
        { node_id: "n2", name: "Atom", kind: "concept", score: 90, method: "vector" },
      ],
    ],
    3,
  );

  assert.deepEqual(merged, [
    { node_id: "n1", name: "Water", kind: "concept", score: 108, method: "local+vector" },
    { node_id: "n2", name: "Atom", kind: "concept", score: 90, method: "vector" },
    { node_id: "n3", name: "Atom", kind: "concept", score: 85, method: "local" },
  ]);
});

test("builds Python-compatible retrieval payloads", () => {
  const payloads = buildRetrievalPayloads({
    datasetId: "main",
    batchAnchor: "struct:chem-grade8:lesson:1-1-1",
    queries: [{ query_text: "water cycle" }],
    localCandidatesByQueryId: {
      "query:94b78fee86e9": [{ node_id: "n1", name: "Water", kind: "concept", score: 100, method: "local" }],
    },
    vectorCandidatesByQueryId: {
      "query:94b78fee86e9": [{ node_id: "n2", name: "Cycle", kind: "process", score: 75, method: "vector" }],
    },
    mode: "hybrid",
    limit: 8,
  });

  assert.deepEqual(payloads, [
    {
      dataset_id: "main",
      batch_anchor: "struct:chem-grade8:lesson:1-1-1",
      query_id: "query:94b78fee86e9",
      query_text: "water cycle",
      candidates: [
        { node_id: "n1", name: "Water", kind: "concept", score: 100, method: "local" },
        { node_id: "n2", name: "Cycle", kind: "process", score: 75, method: "vector" },
      ],
    },
  ]);
});

test("keeps local and vector modes sliced in input order", () => {
  const payloads = buildRetrievalPayloads({
    datasetId: "main",
    queries: [{ query_text: "water", query_id: "q1" }],
    localCandidatesByQueryId: {
      q1: [
        { node_id: "n1", name: "B", kind: "concept", score: 1, method: "local" },
        { node_id: "n2", name: "A", kind: "concept", score: 100, method: "local" },
      ],
    },
    vectorCandidatesByQueryId: {
      q1: [{ node_id: "n3", name: "C", kind: "concept", score: 90, method: "vector" }],
    },
    mode: "local",
    limit: 1,
  });

  assert.deepEqual(payloads, [
    {
      dataset_id: "main",
      batch_anchor: null,
      query_id: "q1",
      query_text: "water",
      candidates: [{ node_id: "n1", name: "B", kind: "concept", score: 1, method: "local" }],
    },
  ]);
});

test("plans retrieval candidate insert rows like Python persist_candidates", () => {
  const filters = buildRetrievalFilters({
    mode: "hybrid",
    domain: "chemistry",
    schoolStage: "junior-secondary",
    nodeKind: "concept",
  });
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

  assert.deepEqual(rows, [
    {
      dataset_id: "main",
      batch_anchor: "anchor",
      query_id: "q1",
      query_text: "water",
      candidate_node_id: "n1",
      rank: 1,
      score: 108,
      retrieval_method: "local+vector",
      filters_json: {
        mode: "hybrid",
        domain: "chemistry",
        school_stage: "junior-secondary",
        node_kind: "concept",
      },
      created_at: "2026-01-01T00:00:00+00:00",
    },
    {
      dataset_id: "main",
      batch_anchor: "anchor",
      query_id: "q1",
      query_text: "water",
      candidate_node_id: "n2",
      rank: 2,
      score: 75,
      retrieval_method: "vector",
      filters_json: {
        mode: "hybrid",
        domain: "chemistry",
        school_stage: "junior-secondary",
        node_kind: "concept",
      },
      created_at: "2026-01-01T00:00:00+00:00",
    },
  ]);
});

test("loads retrieval queries like Python load_queries", () => {
  assert.deepEqual(
    loadRetrievalQueries({
      queries: [" water ", "", "cycle"],
      queriesFileText: "\natom\n molecule \n",
      queriesFileKind: "text",
    }),
    [{ query_text: " water " }, { query_text: "cycle" }, { query_text: "atom" }, { query_text: "molecule" }],
  );

  assert.deepEqual(
    loadRetrievalQueries({
      queriesFileText: '{"query_text":" water ","query_id":" q1 "}\n\n{"query_text":"atom"}\n',
      queriesFileKind: "jsonl",
    }),
    [
      { query_text: "water", query_id: "q1" },
      { query_text: "atom", query_id: "" },
    ],
  );

  assert.throws(() => loadRetrievalQueries({ queries: ["  "] }), /Provide at least one query or --queries-file/);
});
