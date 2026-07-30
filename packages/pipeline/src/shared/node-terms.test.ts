import assert from "node:assert/strict";
import test from "node:test";

import {
  buildNodeTermsSqlPlan,
  buildNodeTermsUpsertStatement,
  buildSelectNodesForNodeTermsQuery,
  planNodeTerms,
} from "./node-terms.js";

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

test("deduplicates normalized node terms by the database conflict key", () => {
  const plan = planNodeTerms("demo", [
    {
      id: "concept:zero",
      name: "函数的零点",
      aliases_json: ["zero", "Zero", "  ZERO  "],
      tags_json: ["ZERO", "zero"],
      status: "active",
    },
    {
      id: "method:bisection",
      name: "二分法",
      aliases_json: ["bisection method", "Bisection   Method"],
      tags_json: [],
      status: "active",
    },
    {
      id: "concept:other-zero",
      name: "Zero",
      aliases_json: [],
      tags_json: [],
      status: "active",
    },
  ]);

  assert.equal(plan.count, 6);
  assert.equal(plan.count, plan.rows.length);
  assert.equal(
    new Set(plan.rows.map((row) => JSON.stringify([row.dataset_id, row.node_id, row.term_norm, row.term_type]))).size,
    plan.rows.length,
  );
  assert.deepEqual(
    plan.rows.filter((row) => row.term_type === "alias"),
    [
      {
        dataset_id: "demo",
        node_id: "concept:zero",
        term: "zero",
        term_norm: "zero",
        term_type: "alias",
      },
      {
        dataset_id: "demo",
        node_id: "method:bisection",
        term: "bisection method",
        term_norm: "bisection method",
        term_type: "alias",
      },
    ],
  );
  assert.deepEqual(
    plan.rows.filter((row) => row.term_norm === "zero").map((row) => [row.node_id, row.term, row.term_type]),
    [
      ["concept:zero", "zero", "alias"],
      ["concept:zero", "ZERO", "tag"],
      ["concept:other-zero", "Zero", "canonical"],
    ],
  );
});

test("deduplicates direct node term upsert rows defensively", () => {
  const statement = buildNodeTermsUpsertStatement([
    {
      dataset_id: "demo",
      node_id: "concept:zero",
      term: "zero",
      term_norm: "zero",
      term_type: "alias",
    },
    {
      dataset_id: "demo",
      node_id: "concept:zero",
      term: "Zero",
      term_norm: "zero",
      term_type: "alias",
    },
  ]);

  assert.ok(statement);
  assert.deepEqual(statement.params, ["demo", "concept:zero", "zero", "zero", "alias"]);
  assert.equal((statement.sql.match(/\(\$\d+, \$\d+, \$\d+, \$\d+, \$\d+\)/g) ?? []).length, 1);
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
