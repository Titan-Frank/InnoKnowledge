import assert from "node:assert/strict";
import test from "node:test";

import {
  buildMarkLessonRunsQaPassedStatement,
  buildSelectMergedLessonRunIdsStatement,
  planLessonRunSelection,
  planMarkQaPassed,
  planParallelLessonPipeline,
  runParallelLessonPipeline,
} from "./parallel-lesson-pipeline.js";

test("plans TypeScript parallel lesson pipeline commands", () => {
  const plan = planParallelLessonPipeline({
    root: "/tmp/okm-root",
    dbUrl: "postgresql://okm",
    datasetId: "main",
    bookId: "chem",
    batchAnchors: ["lesson:1", "lesson:2"],
    lessonRunIds: ["run-1"],
    similarityThreshold: 0.8,
    embeddingThreshold: 0.81,
    reviewThreshold: 0.7,
    normalizeAutoMerge: true,
    repoRoot: "/repo",
    nodeExecutable: "/usr/bin/node",
  });

  assert.equal(plan.root, "/tmp/okm-root");
  assert.equal(plan.dataset_id, "main");
  assert.equal(plan.db_url, "postgresql://okm");
  assert.deepEqual(
    plan.commands.map((step) => step.name),
    ["merge", "normalize", "qa", "integrity"],
  );
  assert.deepEqual(plan.commands[0]?.command, [
    "/usr/bin/node",
    "/repo/packages/pipeline/dist/cli/merge-staged-lessons.js",
    "--dataset-id",
    "main",
    "--db",
    "postgresql://okm",
    "--similarity-threshold",
    "0.8",
    "--embedding-threshold",
    "0.81",
    "--review-threshold",
    "0.7",
    "--book-id",
    "chem",
    "--batch-anchor",
    "lesson:1",
    "--batch-anchor",
    "lesson:2",
    "--lesson-run-id",
    "run-1",
  ]);
  assert.deepEqual(plan.commands[1]?.command, ["/usr/bin/node", "/repo/packages/pipeline/dist/cli/normalize.js", "--dataset-id", "main", "--db", "postgresql://okm"]);
  assert.deepEqual(plan.commands[2]?.command, ["/usr/bin/node", "/repo/packages/pipeline/dist/cli/strict-qa.js", "--dataset-id", "main", "--db", "postgresql://okm"]);
  assert.deepEqual(plan.commands[3]?.command, [
    "/usr/bin/node",
    "/repo/packages/pipeline/dist/cli/graph-integrity.js",
    "--dataset-id",
    "main",
    "--db",
    "postgresql://okm",
    "--book-id",
    "chem",
    "--batch-anchor",
    "lesson:1",
    "--batch-anchor",
    "lesson:2",
    "--lesson-run-id",
    "run-1",
  ]);
  assert.deepEqual(plan.lesson_run_selection, { mode: "explicit", lesson_run_ids: ["run-1"] });
  assert.deepEqual(plan.mark_qa_passed.params, [["<utc_now>", "main", "run-1"]]);
});

test("derives dataset id from root and honors skipped pipeline stages", () => {
  const plan = planParallelLessonPipeline({
    root: "/tmp/output/main-dataset",
    dbUrl: "",
    skipNormalize: true,
    skipQa: true,
    skipIntegrity: true,
    repoRoot: "/repo",
    nodeExecutable: "node",
  });

  assert.equal(plan.dataset_id, "main-dataset");
  assert.deepEqual(
    plan.commands.map((step) => step.name),
    ["merge"],
  );
  assert.equal(plan.commands[0]?.command[0], "node");
  assert.deepEqual(plan.lesson_run_selection, {
    mode: "query",
    sql: "SELECT lesson_run_id FROM world_lesson_runs WHERE dataset_id = %s AND status = 'merged' ORDER BY lesson_run_id",
    params: ["main-dataset"],
  });
  assert.deepEqual(plan.mark_qa_passed.params, []);
});

test("plans lesson-run selection query like Python filters", () => {
  assert.deepEqual(planLessonRunSelection({ datasetId: "main", bookId: "chem", batchAnchors: ["a", "b"] }), {
    mode: "query",
    sql: "SELECT lesson_run_id FROM world_lesson_runs WHERE dataset_id = %s AND status = 'merged' AND book_id = %s AND batch_anchor IN (%s,%s) ORDER BY lesson_run_id",
    params: ["main", "chem", "a", "b"],
  });
  assert.deepEqual(planLessonRunSelection({ datasetId: "main", lessonRunIds: ["run-2", "run-1"] }), {
    mode: "explicit",
    lesson_run_ids: ["run-2", "run-1"],
  });
});

test("plans QA status update without executing it", () => {
  assert.deepEqual(planMarkQaPassed("main", ["run-1", "run-2"]), {
    sql: "UPDATE world_lesson_runs SET status = 'qa_passed', updated_at = %s WHERE dataset_id = %s AND lesson_run_id = %s",
    params: [
      ["<utc_now>", "main", "run-1"],
      ["<utc_now>", "main", "run-2"],
    ],
  });
});

test("builds executable QA status SQL with PostgreSQL placeholders", () => {
  assert.deepEqual(buildSelectMergedLessonRunIdsStatement({ datasetId: "main", bookId: "chem", batchAnchors: ["a", "b"] }), {
    name: "select-merged-world-lesson-runs",
    sql: "SELECT lesson_run_id FROM world_lesson_runs WHERE dataset_id = $1 AND status = 'merged' AND book_id = $2 AND batch_anchor = ANY($3) ORDER BY lesson_run_id",
    params: ["main", "chem", ["a", "b"]],
  });
  assert.deepEqual(buildMarkLessonRunsQaPassedStatement({ datasetId: "main", lessonRunIds: ["run-1", "run-2"], now: "now" }), {
    name: "mark-world-lesson-runs-qa-passed",
    sql: "UPDATE world_lesson_runs SET status = 'qa_passed', updated_at = $1 WHERE dataset_id = $2 AND lesson_run_id = ANY($3)",
    params: ["now", "main", ["run-1", "run-2"]],
  });
});

test("executes TypeScript batch reducer pipeline then marks selected lesson runs QA passed", async () => {
  const commands: string[][] = [];
  const selections: unknown[] = [];
  const marked: unknown[] = [];
  const result = await runParallelLessonPipeline({
    root: "/tmp/okm-root",
    dbUrl: "postgresql://okm",
    datasetId: "main",
    bookId: "chem",
    batchAnchors: ["lesson:1", "lesson:2"],
    repoRoot: "/repo",
    nodeExecutable: "node",
    commandRunner: async (command) => {
      commands.push(command);
      return { exitCode: 0, stdout: `ok ${command[1]}`, stderr: "" };
    },
    selectLessonRunIds: async (input) => {
      selections.push(input);
      return ["run-a", "run-b"];
    },
    markQaPassed: async (input) => {
      marked.push(input);
      return input.lessonRunIds.length;
    },
  });

  assert.equal(result.status, "success");
  assert.deepEqual(
    result.steps.map((step) => step.name),
    ["merge", "normalize", "qa", "integrity"],
  );
  assert.equal(commands.length, 4);
  assert.deepEqual(selections, [{ datasetId: "main", bookId: "chem", batchAnchors: ["lesson:1", "lesson:2"] }]);
  assert.deepEqual(marked, [{ datasetId: "main", lessonRunIds: ["run-a", "run-b"] }]);
  assert.deepEqual(result.qa_passed, { lesson_run_ids: ["run-a", "run-b"], marked_count: 2 });
});

test("stops executable batch reducer pipeline on first failed command", async () => {
  const marked: unknown[] = [];
  const result = await runParallelLessonPipeline({
    root: "/tmp/okm-root",
    dbUrl: "postgresql://okm",
    datasetId: "main",
    repoRoot: "/repo",
    nodeExecutable: "node",
    commandRunner: async (command) => {
      const isNormalize = command.some((part) => part.endsWith("normalize.js"));
      return isNormalize ? { exitCode: 2, stdout: "", stderr: "bad normalize" } : { exitCode: 0, stdout: "ok", stderr: "" };
    },
    selectLessonRunIds: async () => ["run-a"],
    markQaPassed: async (input) => {
      marked.push(input);
      return input.lessonRunIds.length;
    },
  });

  assert.equal(result.status, "blocked");
  assert.equal(result.error, "normalize command failed.");
  assert.deepEqual(
    result.steps.map((step) => [step.name, step.status]),
    [
      ["merge", "completed"],
      ["normalize", "blocked"],
    ],
  );
  assert.deepEqual(marked, []);
});
