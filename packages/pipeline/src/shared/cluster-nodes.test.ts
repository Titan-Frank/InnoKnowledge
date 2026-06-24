import assert from "node:assert/strict";
import test from "node:test";

import {
  chooseClusterCount,
  computeClusterLayout,
  countClusterSizes,
  parseEmbedding,
  planClusterNodeUpdates,
  prepareClusterNodes,
  summarizeClusterInput,
  summarizeClusterRun,
} from "./cluster-nodes.js";

test("parses embeddings like Python cluster_nodes", () => {
  assert.equal(parseEmbedding(null), null);
  assert.equal(parseEmbedding("[]"), null);
  assert.deepEqual(parseEmbedding("[1, 2,3]"), [1, 2, 3]);
  assert.deepEqual(parseEmbedding("1,2,, 3 "), [1, 2, 3]);
  assert.deepEqual(parseEmbedding([1, "2", 3]), [1, 2, 3]);
  assert.equal(parseEmbedding({}), null);
});

test("prepares only rows with valid embedding dimensions", () => {
  const rows = [
    { id: "n1", embedding: "[1,2,3]", properties_json: { old: true } },
    { id: "n2", embedding: [1, 2], properties_json: { old: false } },
    { id: "n3", embedding: "[1,bad,3]", properties_json: null },
    { id: "n4", embedding: null },
  ];

  assert.deepEqual(prepareClusterNodes(rows, 3), [
    { id: "n1", embedding: [1, 2, 3], properties: { old: true } },
  ]);
});

test("chooses cluster count like Python cluster_dataset", () => {
  assert.equal(chooseClusterCount(10), 2);
  assert.equal(chooseClusterCount(30), 2);
  assert.equal(chooseClusterCount(90), 6);
  assert.equal(chooseClusterCount(300), 12);
  assert.equal(chooseClusterCount(90, 5), 5);
});

test("summarizes cluster input like Python cluster_dataset", () => {
  const validRows = Array.from({ length: 10 }, (_, index) => ({
    id: `n${index}`,
    embedding: [index, index + 1],
    properties_json: {},
  }));
  const invalidRows = [{ id: "bad", embedding: [1], properties_json: {} }];

  assert.deepEqual(summarizeClusterInput(validRows.slice(0, 9), { embeddingDimension: 2 }), {
    total_nodes: 9,
    clustered_nodes: 0,
    k: 0,
  });
  assert.deepEqual(summarizeClusterInput([...validRows, ...invalidRows], { embeddingDimension: 2, fixedK: 4 }), {
    total_nodes: 11,
    clustered_nodes: 10,
    k: 4,
  });
});

test("plans cluster node property updates like Python cluster_dataset", () => {
  const nodes = [
    { id: "n1", embedding: [1, 2], properties: { old: true, layout: { x: 99, y: 99 } } },
    { id: "n2", embedding: [3, 4], properties: {} },
  ];

  assert.deepEqual(planClusterNodeUpdates(nodes, [2, "3"], [[1.5, "2.5"], ["3", 4]]), [
    { id: "n1", properties_json: { old: true, community_id: 2, layout: { x: 1.5, y: 2.5 } } },
    { id: "n2", properties_json: { community_id: 3, layout: { x: 3, y: 4 } } },
  ]);
});

test("counts cluster sizes and summarizes completed cluster run", () => {
  assert.deepEqual(countClusterSizes([0, "0", 1, 1, "bad"]), { "0": 2, "1": 2 });
  assert.deepEqual(summarizeClusterRun(12, 10, 3, [0, 0, 1, 2, 2]), {
    total_nodes: 12,
    clustered_nodes: 10,
    k: 3,
    cluster_sizes: { "0": 2, "1": 1, "2": 2 },
  });
});

test("computes deterministic cluster labels and two-dimensional layout", () => {
  const nodes = [
    ...Array.from({ length: 5 }, (_, index) => ({ id: `a${index}`, embedding: [index, index + 0.1], properties: {} })),
    ...Array.from({ length: 5 }, (_, index) => ({ id: `b${index}`, embedding: [100 + index, 100 + index + 0.1], properties: {} })),
  ];

  const result = computeClusterLayout(nodes, { k: 2, seed: 7 });
  const again = computeClusterLayout(nodes, { k: 2, seed: 7 });

  assert.deepEqual(result.labels, again.labels);
  assert.equal(result.labels.length, nodes.length);
  assert.equal(result.coords.length, nodes.length);
  assert.ok(result.coords.every(([x, y]) => Number.isFinite(x) && Number.isFinite(y)));
});
