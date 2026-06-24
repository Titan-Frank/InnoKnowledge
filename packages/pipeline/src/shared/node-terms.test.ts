import assert from "node:assert/strict";
import test from "node:test";

import { buildNodeTermsSqlPlan, buildSelectNodesForNodeTermsQuery, planNodeTerms } from "./node-terms.js";

test("plans node term rows like Python rebuild_node_terms", () => {
  const plan = planNodeTerms("main", [
    {
      id: "concept:auto-water",
      name: " Water   Cycle ",
      aliases_json: ["水循环", 3, "Water cycle"],
      tags_json: ["Hydrology", ""],
      status: "active",
    },
    {
      id: "concept:auto-deprecated",
      name: "Ignored",
      aliases_json: ["ignored"],
      tags_json: ["ignored"],
      status: "deprecated",
    },
    {
      id: "concept:auto-no-arrays",
      name: null,
      aliases_json: "not-array",
      tags_json: null,
      status: "active",
    },
  ]);

  assert.deepEqual(plan, {
    count: 4,
    rows: [
      {
        dataset_id: "main",
        node_id: "concept:auto-water",
        term: " Water   Cycle ",
        term_norm: "water cycle",
        term_type: "canonical",
      },
      {
        dataset_id: "main",
        node_id: "concept:auto-water",
        term: "水循环",
        term_norm: "水循环",
        term_type: "alias",
      },
      {
        dataset_id: "main",
        node_id: "concept:auto-water",
        term: "Water cycle",
        term_norm: "water cycle",
        term_type: "alias",
      },
      {
        dataset_id: "main",
        node_id: "concept:auto-water",
        term: "Hydrology",
        term_norm: "hydrology",
        term_type: "tag",
      },
      {
        dataset_id: "main",
        node_id: "concept:auto-water",
        term: "",
        term_norm: "",
        term_type: "tag",
      },
    ].filter((row) => row.term_norm),
  });
});

test("builds node term SQL plan without executing database operations", () => {
  const rows = planNodeTerms("main", [{ id: "concept:auto-water", name: "Water", aliases_json: ["H2O"], tags_json: ["substance"] }]).rows;
  const sqlPlan = buildNodeTermsSqlPlan("main", rows);

  assert.deepEqual(sqlPlan.delete, {
    name: "delete-world-node-terms",
    sql: "DELETE FROM world_node_terms WHERE dataset_id = $1",
    params: ["main"],
  });
  assert.ok(sqlPlan.insert);
  assert.equal(sqlPlan.statements.length, 2);
  assert.match(sqlPlan.insert.sql, /INSERT INTO world_node_terms/);
  assert.match(sqlPlan.insert.sql, /ON CONFLICT \(dataset_id, node_id, term_norm, term_type\)/);
  assert.match(sqlPlan.insert.sql, /DO UPDATE SET term = EXCLUDED\.term/);
  assert.deepEqual(sqlPlan.insert.params, [
    "main",
    "concept:auto-water",
    "Water",
    "water",
    "canonical",
    "main",
    "concept:auto-water",
    "H2O",
    "h2o",
    "alias",
    "main",
    "concept:auto-water",
    "substance",
    "substance",
    "tag",
  ]);
});

test("builds node term SQL plan with no insert for empty rows", () => {
  const sqlPlan = buildNodeTermsSqlPlan("main", []);
  assert.equal(sqlPlan.insert, null);
  assert.deepEqual(
    sqlPlan.statements.map((statement) => statement.name),
    ["delete-world-node-terms"],
  );
});

test("builds select query for node term rebuild source rows", () => {
  assert.deepEqual(buildSelectNodesForNodeTermsQuery("main"), {
    name: "select-world-nodes-for-node-terms",
    sql: "SELECT id, name, aliases_json, tags_json\nFROM world_nodes\nWHERE dataset_id = $1 AND status != 'deprecated'",
    params: ["main"],
  });
});
