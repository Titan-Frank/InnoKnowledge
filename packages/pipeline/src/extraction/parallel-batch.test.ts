import assert from "node:assert/strict";
import test from "node:test";

import {
  chunked,
  planParallelBatches,
  planTsModelExtractionCommands,
  resolveOutlineAnchorFromItems,
  selectExtractionUnits,
  taskLinesForWorkers,
} from "./parallel-batch.js";

const items = [
  { id: "topic-1", kind: "topic" },
  { id: "struct:chem:lesson:1-1", kind: "lesson", title: "水", label: "第1节" },
  { id: "struct:chem:lesson:1-2", kind: "lesson", title: "空气", label: "第2节" },
  { id: "struct:chem:chunk:1-1-a", kind: "chunk", parent_id: "struct:chem:lesson:1-1", title: "水 上", label: "第1节 (上)" },
  { id: "struct:chem:chunk:1-1-b", kind: "chunk", parent_id: "struct:chem:lesson:1-1", title: "水 下", label: "第1节 (下)" },
];

test("chunks arrays like Python parallel_batch_runner.chunked", () => {
  assert.deepEqual(chunked([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]]);
});

test("selects chunks first unless noChunks requests lesson units", () => {
  assert.deepEqual(selectExtractionUnits(items).units.map((item) => item.id), ["struct:chem:chunk:1-1-a", "struct:chem:chunk:1-1-b"]);
  assert.equal(selectExtractionUnits(items).unitKind, "chunk");
  assert.deepEqual(selectExtractionUnits(items, true).units.map((item) => item.id), ["struct:chem:lesson:1-1", "struct:chem:lesson:1-2"]);
  assert.equal(selectExtractionUnits(items, true).unitKind, "lesson");
});

test("plans parallel workers with Python-compatible payload fields", () => {
  const plan = planParallelBatches(items, { bookId: "chem", parallel: 2 });

  assert.equal(plan.book_id, "chem");
  assert.equal(plan.parallel, 2);
  assert.equal(plan.batch_size, 1);
  assert.equal(plan.total_units, 2);
  assert.equal(plan.unit_kind, "chunk");
  assert.deepEqual(
    plan.workers.map((worker) => ({ slot: worker.worker_slot, anchors: worker.items.map((item) => item.batch_anchor) })),
    [
      { slot: 0, anchors: ["struct:chem:chunk:1-1-a"] },
      { slot: 1, anchors: ["struct:chem:chunk:1-1-b"] },
    ],
  );
  assert.equal(plan.workers[0]?.items[0]?.lesson_run_id, "lesson-run:ef1ab8115b3d");
});

test("falls back to one worker slot when parallel is below one, while preserving payload value", () => {
  const plan = planParallelBatches(items, { bookId: "chem", parallel: 0 });

  assert.equal(plan.parallel, 0);
  assert.deepEqual(plan.workers.map((worker) => worker.worker_slot), [0, 0]);
});

test("requires one isolated task per lesson like Python", () => {
  assert.throws(() => planParallelBatches(items, { bookId: "chem", batchSize: 2 }), /--batch-size must be 1/);
  assert.throws(() => planParallelBatches([{ id: "topic-1", kind: "topic" }], { bookId: "chem" }), /No extraction units found/);
});

test("resolves outline anchor variants with strict errors", () => {
  assert.equal(resolveOutlineAnchorFromItems("chem", "chunk:1-1-a", items, { strict: true }), "struct:chem:chunk:1-1-a");
  assert.equal(resolveOutlineAnchorFromItems("chem", "1-1-a", items, { strict: true }), "struct:chem:chunk:1-1-a");
  assert.throws(() => resolveOutlineAnchorFromItems("chem", "missing", items, { strict: true }), /was not found in outline/);
});

test("formats generated task lines like Python --generate-tasks", () => {
  const plan = planParallelBatches(items, { bookId: "chem", parallel: 2 });

  assert.deepEqual(taskLinesForWorkers(plan.workers), ["worker-0: struct:chem:chunk:1-1-a", "worker-1: struct:chem:chunk:1-1-b"]);
});

test("plans TypeScript model extraction commands for parallel workers", () => {
  const plan = planParallelBatches(items, { bookId: "chem", parallel: 2 });
  const commands = planTsModelExtractionCommands(plan.workers, {
    outputRoot: "/tmp/okm",
    extractorCliPath: "/repo/packages/pipeline/dist/cli/extract-lesson-openai.js",
    nodeExecutable: "node",
    datasetId: "dataset-a",
    model: "gpt-test",
    subject: "chemistry",
    schoolStage: "senior-secondary",
    gradeBand: "grade-8",
    apiMode: "responses",
    extractionStrategy: "hybrid",
    extractionTemplate: "textbook/chemistry",
    modelRetryCount: 2,
    timeoutSeconds: 90,
  });

  assert.equal(commands.length, 2);
  assert.equal(commands[0]?.worker_slot, 0);
  assert.equal(commands[0]?.batch_anchor, "struct:chem:chunk:1-1-a");
  assert.deepEqual(commands[0]?.command, [
    "node",
    "/repo/packages/pipeline/dist/cli/extract-lesson-openai.js",
    "--book-id",
    "chem",
    "--batch-anchor",
    "struct:chem:chunk:1-1-a",
    "--output-root",
    "/tmp/okm",
    "--dataset-id",
    "dataset-a",
    "--model",
    "gpt-test",
    "--subject",
    "chemistry",
    "--school-stage",
    "senior-secondary",
    "--grade-band",
    "grade-8",
    "--api-mode",
    "responses",
    "--extraction-strategy",
    "hybrid",
    "--extraction-template",
    "textbook/chemistry",
    "--model-retry-count",
    "2",
    "--timeout",
    "90",
  ]);
  assert.ok(!commands[0]?.command.some((part) => part.includes("extract_lesson_openai.py")));
});
