import assert from "node:assert/strict";
import test from "node:test";

import { runNormalizeFromDatabase } from "./normalize-store.js";

test("executes database-backed normalize after reading canonical rows", async () => {
  const queried: string[] = [];
  const executed: string[] = [];
  const result = await runNormalizeFromDatabase({
    datasetId: "main",
    now: "now",
    query: (statement) => {
      queried.push(statement.name);
      return normalizeRowsForStatement(statement.name);
    },
    executeStatement: (statement) => {
      executed.push(statement.name);
    },
  });

  assert.equal(result.cards_updated, 1);
  assert.equal(result.domain_profiles_deduplicated, 1);
  assert.equal(result.edges_deduplicated, 1);
  assert.deepEqual(result.executedStatements, executed);
  assert.ok(result.statements.includes("update-normalized-node-card"));
  assert.ok(result.statements.includes("upsert-normalized-domain-profile"));
  assert.ok(result.statements.includes("deprecate-duplicate-world-edge"));
  assert.ok(result.statements.includes("upsert-world-node-terms"));
  assert.deepEqual(queried.slice(0, 5), [
    "select-normalize-node-cards",
    "select-normalize-domain-profiles",
    "select-normalize-edges",
    "select-normalize-nodes",
    "select-normalize-evidence-ids",
  ]);
});

test("executes database-backed normalize in full plan order", async () => {
  const executed: string[] = [];
  const result = await runNormalizeFromDatabase({
    datasetId: "main",
    now: "now",
    query: (statement) => normalizeRowsForStatement(statement.name),
    executeStatement: (statement) => {
      executed.push(statement.name);
    },
  });

  assert.deepEqual(result.executedStatements, executed);
  assert.ok(executed.includes("update-normalized-node-card"));
  assert.ok(executed.includes("delete-world-node-terms"));
  assert.ok(executed.includes("upsert-world-node-terms"));
});

function normalizeRowsForStatement(name: string): Array<Record<string, unknown>> {
  switch (name) {
    case "select-normalize-node-cards":
      return [{ node_id: "node:water", sections_json: [{ content: [" 定义 ", ""] }] }];
    case "select-normalize-domain-profiles":
      return [
        {
          id: "domain-profile:old-water",
          node_id: "node:water",
          domain: "chemistry",
          school_stages_json: ["higher"],
          curriculum_roles_json: ["core"],
          source_refs_json: ["ev1"],
          properties_json: { a: 1 },
          notes: "old",
          status: "active",
          created_at: "1",
        },
      ];
    case "select-normalize-edges":
      return [
        { id: "edge:1", from_id: "node:water", to_id: "node:oxygen", type: "related_to", status: "active", created_at: "1" },
        { id: "edge:2", from_id: "node:water", to_id: "node:oxygen", type: "related_to", status: "active", created_at: "2" },
      ];
    case "select-normalize-nodes":
      return [
        { id: "node:water", name: "Water", kind: "concept", aliases_json: ["H2O"], tags_json: ["matter"], status: "active" },
        { id: "node:oxygen", name: "Oxygen", kind: "concept", aliases_json: [], tags_json: [], status: "active" },
      ];
    case "select-normalize-evidence-ids":
      return [{ id: "ev1" }];
    default:
      return [];
  }
}
