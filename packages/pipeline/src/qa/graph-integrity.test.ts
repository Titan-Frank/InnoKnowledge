import assert from "node:assert/strict";
import test from "node:test";

import { checkGraphIntegrity } from "./graph-integrity.js";

test("reports hierarchical cycles and blocks only when failOnCycles is true", () => {
  const nodes = [
    { id: "a", name: "A", kind: "concept" },
    { id: "b", name: "B", kind: "concept" },
  ];
  const edges = [
    { id: "e1", type: "is_a", from_id: "a", to_id: "b" },
    { id: "e2", type: "is_a", from_id: "b", to_id: "a" },
  ];

  assert.equal(checkGraphIntegrity(nodes, edges).status, "success");
  assert.deepEqual(checkGraphIntegrity(nodes, edges, { failOnCycles: true }), {
    status: "blocked",
    cycles: 1,
    directed_cycle_warnings: 0,
    isolated_nodes: 0,
    disconnected_components: 0,
    issues: {
      cycles: [{ nodes: ["a", "b", "a"] }],
      directed_cycle_warnings: [],
      isolated_nodes: [],
      weakly_connected: [],
    },
  });
});

test("reports directed cycle warnings separately from hard hierarchical cycles", () => {
  const nodes = [
    { id: "a", name: "A", kind: "concept" },
    { id: "b", name: "B", kind: "concept" },
  ];
  const edges = [
    { id: "e1", type: "uses", from_id: "a", to_id: "b" },
    { id: "e2", type: "uses", from_id: "b", to_id: "a" },
  ];

  const result = checkGraphIntegrity(nodes, edges);
  assert.equal(result.cycles, 0);
  assert.equal(result.directed_cycle_warnings, 1);
  assert.deepEqual(result.issues.directed_cycle_warnings, [{ nodes: ["a", "b", "a"] }]);
});

test("reports isolated active nodes and ignores deprecated rows", () => {
  const result = checkGraphIntegrity(
    [
      { id: "a", name: "A", kind: "concept" },
      { id: "b", name: "B", kind: "entity" },
      { id: "old", name: "Old", kind: "concept", status: "deprecated" },
    ],
    [{ id: "e1", type: "related_to", from_id: "a", to_id: "a" }, { id: "old-edge", type: "related_to", from_id: "b", to_id: "b", status: "deprecated" }],
  );

  assert.deepEqual(result.issues.isolated_nodes, [{ id: "b", name: "B", kind: "entity" }]);
});

test("reports multiple large weakly connected components", () => {
  const nodes = Array.from({ length: 12 }, (_, index) => ({ id: `n${index}`, name: `N${index}`, kind: "concept" }));
  const edges = [
    ...Array.from({ length: 5 }, (_, index) => ({ id: `a${index}`, type: "related_to", from_id: `n${index}`, to_id: `n${index + 1}` })),
    ...Array.from({ length: 5 }, (_, index) => ({ id: `b${index}`, type: "related_to", from_id: `n${index + 6}`, to_id: `n${index + 7}` })),
  ];

  const result = checkGraphIntegrity(nodes, edges);
  assert.equal(result.disconnected_components, 2);
  assert.deepEqual(result.issues.weakly_connected, [
    { size: 6, sample_nodes: ["n0", "n1", "n2"] },
    { size: 6, sample_nodes: ["n6", "n7", "n8"] },
  ]);
});
