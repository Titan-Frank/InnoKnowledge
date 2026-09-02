import assert from "node:assert/strict";
import test from "node:test";

import { parallelPlanOutputPath, runParallelBatchPlan } from "./parallel-batch-runner.js";

test("computes the Python-compatible parallel plan output path", () => {
  assert.equal(parallelPlanOutputPath("/tmp/okm", "chem/hukj xb2"), "/tmp/okm/runs/parallel/chem-hukj-xb2.parallel-plan.json");
});

test("plans a parallel batch from repository outline items", () => {
  const output = runParallelBatchPlan({
    bookId: "chem-hukj-xb2-structure",
    outputRoot: "/tmp/okm",
    parallel: 3,
    generateTasks: true,
  });

  assert.equal(output.status, "success");
  assert.equal(output.output_path, "/tmp/okm/runs/parallel/chem-hukj-xb2-structure.parallel-plan.json");
  assert.equal(output.unit_kind, "chunk");
  assert.equal(output.total_units, 32);
  assert.equal(output.workers.length, 32);
  assert.deepEqual(output.workers.slice(0, 4).map((worker) => worker.worker_slot), [0, 1, 2, 0]);
  assert.equal(output.task_lines?.length, 32);
  assert.match(output.task_lines?.[0] ?? "", /^worker-0: struct:chem-hukj-xb2-structure:chunk:/);
});

test("plan can ignore chunks and use lesson-level units", () => {
  const output = runParallelBatchPlan({
    bookId: "chem-hukj-xb2-structure",
    outputRoot: "/tmp/okm",
    noChunks: true,
  });

  assert.equal(output.unit_kind, "lesson");
  assert.equal(output.total_units, 9);
});

test("plan can include TypeScript model extraction commands", () => {
  const output = runParallelBatchPlan({
    bookId: "chem-hukj-xb2-structure",
    outputRoot: "/tmp/okm",
    parallel: 2,
    planExtractionCommands: true,
    extractorCliPath: "/repo/packages/pipeline/dist/cli/extract-lesson-openai.js",
    datasetId: "dataset-a",
    model: "gpt-test",
    subject: "chemistry",
  });

  assert.equal(output.extraction_commands?.length, 32);
  assert.equal(output.extraction_commands?.[0]?.worker_slot, 0);
  assert.deepEqual(output.extraction_commands?.[0]?.command.slice(0, 8), [
    "node",
    "/repo/packages/pipeline/dist/cli/extract-lesson-openai.js",
    "--book-id",
    "chem-hukj-xb2-structure",
    "--batch-anchor",
    output.extraction_commands?.[0]?.batch_anchor,
    "--output-root",
    "/tmp/okm",
  ]);
  assert.ok(output.extraction_commands?.[0]?.command.includes("--model"));
});
