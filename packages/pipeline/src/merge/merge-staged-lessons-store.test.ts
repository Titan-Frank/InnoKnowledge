import assert from "node:assert/strict";
import test from "node:test";

import { planStagedLessonsMerge } from "./merge-staged-lesson.js";
import { runMergeStagedLessonsFromDatabase, storeMergedLessons } from "./merge-staged-lessons-runner.js";
import { planNodeTerms } from "../shared/node-terms.js";
import type { SqlStatement } from "../staging/staging-sql.js";

function makePlan() {
  return planStagedLessonsMerge({
    datasetId: "main",
    mergeRunId: "merge:1",
    canonicalNodes: [],
    lessons: [
      {
        lesson_run_id: "lesson-run:1",
        staged: {
          nodes: [
            {
              raw_node_id: "raw-water",
              name: "Water",
              kind: "concept",
              aliases_json: [],
              domains_json: [],
              knowledge_form_json: [],
              learning_mode_json: [],
              properties_json: {},
              external_ids_json: {},
              tags_json: [],
              created_at: "node-created",
            },
          ],
        },
      },
    ],
    now: "now",
  });
}

test("executes merged lesson SQL statements in plan order without creating a connection", async () => {
  const plan = makePlan();
  const nodeTerms = planNodeTerms("main", [{ id: "concept:auto-water", name: "Water", aliases_json: [], tags_json: [] }]);
  const executed: SqlStatement[] = [];

  const result = await storeMergedLessons(plan, {
    datasetId: "main",
    now: "now",
    nodeTermRows: nodeTerms.rows,
    execute: (statement) => {
      executed.push(statement);
    },
  });

  assert.equal(result.status, "success");
  assert.equal(result.merge_run_id, "merge:1");
  assert.equal(result.merged, 1);
  assert.deepEqual(result.stats, plan.stats);
  assert.deepEqual(result.executedStatements, executed.map((statement) => statement.name));
  assert.deepEqual(result.executedStatements.slice(0, 4), [
    "upsert-world-merge-run-start",
    "mark-world-lesson-run-merging",
    "upsert-world-node",
    "upsert-world-canonical-node-map",
  ]);
  assert.deepEqual(result.executedStatements.slice(-3), ["delete-world-node-terms", "upsert-world-node-terms", "complete-world-merge-run"]);
});

test("propagates merge SQL execution failures and stops after the failing statement", async () => {
  const plan = makePlan();
  const executed: string[] = [];

  await assert.rejects(
    () =>
      storeMergedLessons(plan, {
        datasetId: "main",
        now: "now",
        execute: (statement) => {
          executed.push(statement.name);
          if (statement.name === "upsert-world-node") throw new Error("write failed");
        },
      }),
    /write failed/,
  );

  assert.deepEqual(executed, ["upsert-world-merge-run-start", "mark-world-lesson-run-merging", "upsert-world-node"]);
});

test("executes no statements for an empty merge plan", async () => {
  const plan = planStagedLessonsMerge({
    datasetId: "main",
    canonicalNodes: [],
    lessons: [],
    now: "now",
  });
  const executed: SqlStatement[] = [];

  const result = await storeMergedLessons(plan, {
    datasetId: "main",
    now: "now",
    execute: (statement) => {
      executed.push(statement);
    },
  });

  assert.deepEqual(executed, []);
  assert.deepEqual(result.executedStatements, []);
  assert.equal(result.merge_run_id, null);
  assert.equal(result.merged, 0);
});

test("executes database-backed staged lesson merge after reading staging rows", async () => {
  const queried: string[] = [];
  const executed: string[] = [];
  const result = await runMergeStagedLessonsFromDatabase({
    datasetId: "main",
    now: "now",
    query: (statement) => {
      queried.push(statement.name);
      return rowsForStatement(statement.name);
    },
    executeStatement: (statement) => {
      executed.push(statement.name);
    },
  });

  assert.equal(result.merged, 1);
  assert.equal(result.stats.nodes_created, 1);
  assert.deepEqual(result.executedStatements, executed);
  assert.ok(result.statements.includes("upsert-world-node"));
  assert.ok(result.node_terms.count > 0);
  assert.deepEqual(queried.slice(0, 4), [
    "select-merge-lesson-runs",
    "select-merge-canonical-nodes",
    "select-existing-world-domain-profiles",
    "select-existing-world-evidence-ids",
  ]);
  assert.ok(queried.includes("select-world_staging_nodes"));
  assert.deepEqual(executed.slice(0, 4), [
    "upsert-world-merge-run-start",
    "mark-world-lesson-run-merging",
    "upsert-world-node",
    "upsert-world-canonical-node-map",
  ]);
});

test("executes database-backed staged lesson merge in full plan order", async () => {
  const executed: string[] = [];
  const result = await runMergeStagedLessonsFromDatabase({
    datasetId: "main",
    now: "now",
    query: (statement) => rowsForStatement(statement.name),
    executeStatement: (statement) => {
      executed.push(statement.name);
    },
  });

  assert.deepEqual(result.executedStatements, executed);
  assert.deepEqual(executed.slice(0, 4), [
    "upsert-world-merge-run-start",
    "mark-world-lesson-run-merging",
    "upsert-world-node",
    "upsert-world-canonical-node-map",
  ]);
  assert.deepEqual(executed.slice(-3), ["delete-world-node-terms", "upsert-world-node-terms", "complete-world-merge-run"]);
});

function rowsForStatement(name: string): Array<Record<string, unknown>> {
  switch (name) {
    case "select-merge-lesson-runs":
      return [{ lesson_run_id: "lesson-run:1", created_at: "run-created" }];
    case "select-merge-canonical-nodes":
    case "select-existing-world-domain-profiles":
    case "select-existing-world-evidence-ids":
      return [];
    case "select-world_staging_nodes":
      return [
        {
          dataset_id: "main",
          lesson_run_id: "lesson-run:1",
          raw_node_id: "raw-water",
          name: "Water",
          kind: "concept",
          aliases_json: ["H2O"],
          domains_json: ["chemistry"],
          knowledge_form_json: ["propositional"],
          learning_mode_json: ["conceptual"],
          properties_json: {},
          external_ids_json: {},
          tags_json: ["matter"],
          created_at: "node-created",
        },
      ];
    default:
      return [];
  }
}
