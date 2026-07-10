import assert from "node:assert/strict";
import test from "node:test";

import {
  buildCanonicalNodeTermsUpsertStatement,
  buildDeprecateDuplicateRemappedEdgesStatement,
  buildDeprecateRemappedSelfLoopEdgesStatement,
} from "./dedupe-nodes.js";

test("rebuilds canonical node terms after duplicate repair deletes group terms", () => {
  const statement = buildCanonicalNodeTermsUpsertStatement("main", {
    id: "concept:auto-water",
    name: "Water cycle",
    aliases_json: ["水循环", "Hydrologic cycle"],
    tags_json: ["hydrology"],
    status: "active",
  });

  assert.ok(statement);
  assert.equal(statement.name, "upsert-world-node-terms");
  assert.match(statement.sql, /INSERT INTO world_node_terms/);
  assert.match(statement.sql, /ON CONFLICT \(dataset_id, node_id, term_norm, term_type\)/);
  assert.deepEqual(statement.params, [
    "main",
    "concept:auto-water",
    "Water cycle",
    "water cycle",
    "canonical",
    "main",
    "concept:auto-water",
    "水循环",
    "水循环",
    "alias",
    "main",
    "concept:auto-water",
    "Hydrologic cycle",
    "hydrologic cycle",
    "alias",
    "main",
    "concept:auto-water",
    "hydrology",
    "hydrology",
    "tag",
  ]);
});

test("plans deprecation for self-loop edges produced by duplicate remapping", () => {
  assert.deepEqual(buildDeprecateRemappedSelfLoopEdgesStatement("main", "concept:auto-water", "now"), {
    name: "deprecate-remapped-self-loop-edges",
    sql: [
      "UPDATE world_edges",
      "SET status = 'deprecated', updated_at = $1",
      "WHERE dataset_id = $2",
      "  AND status != 'deprecated'",
      "  AND from_id = $3",
      "  AND to_id = $3",
    ].join("\n"),
    params: ["now", "main", "concept:auto-water"],
  });
});

test("plans deprecation for duplicate edges involving the canonical node", () => {
  const statement = buildDeprecateDuplicateRemappedEdgesStatement("main", "concept:auto-water", "now");

  assert.equal(statement.name, "deprecate-remapped-duplicate-edges");
  assert.match(statement.sql, /row_number\(\) OVER/);
  assert.match(statement.sql, /PARTITION BY type, directionality/);
  assert.match(statement.sql, /directionality = 'undirected'/);
  assert.match(statement.sql, /ranked\.duplicate_rank > 1/);
  assert.deepEqual(statement.params, ["main", "concept:auto-water", "now"]);
});
