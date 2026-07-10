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
  assert.deepEqual(transactionStatementNames(executed), ["begin-merge-transaction", "commit-merge-transaction"]);
  assert.deepEqual(result.executedStatements, businessStatementNames(executed));
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

  assert.deepEqual(executed, [
    "begin-merge-transaction",
    "upsert-world-merge-run-start",
    "mark-world-lesson-run-merging",
    "upsert-world-node",
    "rollback-merge-transaction",
  ]);
});

test("reports both merge write and rollback failures", async () => {
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
          if (statement.name === "rollback-merge-transaction") throw new Error("rollback failed");
        },
      }),
    /Merge transaction failed: write failed; rollback also failed: rollback failed/,
  );

  assert.deepEqual(executed.slice(-2), ["upsert-world-node", "rollback-merge-transaction"]);
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
  const queried: SqlStatement[] = [];
  const executed: SqlStatement[] = [];
  const result = await runMergeStagedLessonsFromDatabase({
    datasetId: "main",
    now: "now",
    query: (statement) => {
      queried.push(statement);
      return rowsForStatement(statement.name);
    },
    executeStatement: (statement) => {
      executed.push(statement);
    },
  });

  assert.equal(result.merged, 1);
  assert.equal(result.stats.nodes_created, 1);
  assert.deepEqual(result.executedStatements, businessStatementNames(executed));
  assert.ok(result.statements.includes("upsert-world-node"));
  assert.ok(result.node_terms.count > 0);
  assert.deepEqual(queried[0], {
    name: "lock-dataset-transaction",
    sql: "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
    params: ["main"],
  });
  assert.deepEqual(queried.slice(0, 5).map((statement) => statement.name), [
    "lock-dataset-transaction",
    "select-merge-lesson-runs",
    "select-merge-canonical-nodes",
    "select-existing-world-domain-profiles",
    "select-existing-world-evidence-ids",
  ]);
  assert.ok(queried.some((statement) => statement.name === "select-world_staging_nodes"));
  assert.equal(executed[0]?.sql, "BEGIN");
  assert.deepEqual(transactionStatementNames(executed), ["begin-merge-run-transaction", "commit-merge-run-transaction"]);
  assert.deepEqual(businessStatementNames(executed).slice(0, 4), [
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

  assert.deepEqual(result.executedStatements, businessStatementNames(executed));
  assert.deepEqual(transactionStatementNames(executed), ["begin-merge-run-transaction", "commit-merge-run-transaction"]);
  assert.deepEqual(businessStatementNames(executed).slice(0, 4), [
    "upsert-world-merge-run-start",
    "mark-world-lesson-run-merging",
    "upsert-world-node",
    "upsert-world-canonical-node-map",
  ]);
  assert.deepEqual(businessStatementNames(executed).slice(-3), ["delete-world-node-terms", "upsert-world-node-terms", "complete-world-merge-run"]);
});

test("rolls back the merge run when a read fails after acquiring the dataset lock", async () => {
  const queried: SqlStatement[] = [];
  const executed: SqlStatement[] = [];

  await assert.rejects(
    () =>
      runMergeStagedLessonsFromDatabase({
        datasetId: "main",
        now: "now",
        query: (statement) => {
          queried.push(statement);
          if (statement.name === "select-merge-canonical-nodes") throw new Error("read failed");
          return rowsForStatement(statement.name);
        },
        executeStatement: (statement) => {
          executed.push(statement);
        },
      }),
    /read failed/,
  );

  assert.deepEqual(queried.map((statement) => statement.name), [
    "lock-dataset-transaction",
    "select-merge-lesson-runs",
    "select-merge-canonical-nodes",
  ]);
  assert.equal(executed[0]?.sql, "BEGIN");
  assert.deepEqual(transactionStatementNames(executed), ["begin-merge-run-transaction", "rollback-merge-run-transaction"]);
  assert.deepEqual(businessStatementNames(executed), []);
});

test("rolls back the merge run without nesting when a canonical write fails", async () => {
  const executed: string[] = [];

  await assert.rejects(
    () =>
      runMergeStagedLessonsFromDatabase({
        datasetId: "main",
        now: "now",
        query: (statement) => rowsForStatement(statement.name),
        executeStatement: (statement) => {
          executed.push(statement.name);
          if (statement.name === "upsert-world-node") throw new Error("write failed");
        },
      }),
    /write failed/,
  );

  assert.deepEqual(transactionStatementNames(executed), ["begin-merge-run-transaction", "rollback-merge-run-transaction"]);
  assert.equal(executed.includes("begin-merge-transaction"), false);
  assert.deepEqual(businessStatementNames(executed).slice(-3), [
    "upsert-world-merge-run-start",
    "mark-world-lesson-run-merging",
    "upsert-world-node",
  ]);
});

function transactionStatementNames(statements: SqlStatement[] | string[]): string[] {
  return statements
    .map((statement) => typeof statement === "string" ? statement : statement.name)
    .filter((name) => name.endsWith("-transaction"));
}

function businessStatementNames(statements: SqlStatement[] | string[]): string[] {
  return statements
    .map((statement) => typeof statement === "string" ? statement : statement.name)
    .filter((name) => !name.endsWith("-transaction"));
}

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
