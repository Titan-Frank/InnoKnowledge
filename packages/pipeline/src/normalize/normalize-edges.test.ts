import assert from "node:assert/strict";
import test from "node:test";

import { countDeduplicatedEdges, planEdgeDeduplication } from "./normalize-edges.js";

test("plans edge deduplication like Python normalize.deduplicate_edges", () => {
  const plan = planEdgeDeduplication([
    { id: "e2", from_id: "a", to_id: "b", type: "related_to", created_at: "2026-01-02T00:00:00Z" },
    { id: "e1", from_id: "a", to_id: "b", type: "related_to", created_at: "2026-01-01T00:00:00Z" },
    { id: "e3", from_id: "a", to_id: "b", type: "related_to", created_at: "2026-01-03T00:00:00Z" },
  ]);

  assert.deepEqual(plan, {
    keep: ["e1"],
    deprecate: ["e2", "e3"],
    groups: [
      {
        key: { from_id: "a", to_id: "b", type: "related_to" },
        keep: "e1",
        deprecate: ["e2", "e3"],
      },
    ],
  });
});

test("does not deduplicate deprecated edges or different edge keys", () => {
  const edges = [
    { id: "e1", from_id: "a", to_id: "b", type: "related_to", created_at: "2026-01-01T00:00:00Z" },
    { id: "e2", from_id: "a", to_id: "b", type: "related_to", status: "deprecated", created_at: "2026-01-02T00:00:00Z" },
    { id: "e3", from_id: "b", to_id: "a", type: "related_to", created_at: "2026-01-03T00:00:00Z" },
    { id: "e4", from_id: "a", to_id: "b", type: "uses", created_at: "2026-01-04T00:00:00Z" },
  ];

  assert.deepEqual(planEdgeDeduplication(edges), { keep: [], deprecate: [], groups: [] });
  assert.equal(countDeduplicatedEdges(edges), 0);
});

test("counts duplicate edges across multiple groups", () => {
  const edges = [
    { id: "a1", from_id: "a", to_id: "b", type: "related_to", created_at: "1" },
    { id: "a2", from_id: "a", to_id: "b", type: "related_to", created_at: "2" },
    { id: "b1", from_id: "c", to_id: "d", type: "uses", created_at: "1" },
    { id: "b2", from_id: "c", to_id: "d", type: "uses", created_at: "2" },
    { id: "b3", from_id: "c", to_id: "d", type: "uses", created_at: "3" },
  ];

  assert.equal(countDeduplicatedEdges(edges), 3);
});

test("keeps input order when duplicate edges have the same created_at", () => {
  const plan = planEdgeDeduplication([
    { id: "first", from_id: "a", to_id: "b", type: "related_to", created_at: "same" },
    { id: "second", from_id: "a", to_id: "b", type: "related_to", created_at: "same" },
  ]);

  assert.deepEqual(plan.keep, ["first"]);
  assert.deepEqual(plan.deprecate, ["second"]);
});
