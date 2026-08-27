import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { createNoopPipelineAssetStore } from "../shared/pg-assets.js";
import { makeLessonRunId, outlinePathForBook, REPO_ROOT, safePathToken } from "../shared/pathing.js";
import { createNoopPipelineProgressStore } from "../shared/pipeline-progress.js";
import {
  commandForPipelineOutputAttempt,
  compactPipelineCommandOutput,
  isRetryablePipelineOutputFailure,
  parsePipelineStartStage,
  redactCommandForOutput,
  runServerPipeline,
  shouldRecordReusedResumeStages,
  shouldRunStage,
  shouldExtractPdfOutline,
} from "./server-pipeline-run.js";

const bookId = "chem-hukj-xb2-structure";

test("keeps model failures in compact command output while counting verbose statement lists", () => {
  const modelFailures = [{
    profile_id: "profile-failed",
    school_stage: "higher",
    message: `Model output invalid.\nRaw model output:\n${"x".repeat(10_000)}`,
  }];
  assert.deepEqual(compactPipelineCommandOutput({
    status: "success",
    selected: 44,
    generated: 40,
    failed_model_generation: 4,
    model_failures: modelFailures,
    read_statements: ["read-a", "read-b"],
    statements: new Array(41).fill("update"),
    executedStatements: new Array(41).fill("update"),
  }), {
    status: "success",
    selected: 44,
    generated: 40,
    failed_model_generation: 4,
    model_failures: modelFailures,
    read_statements_count: 2,
    statements_count: 41,
    executedStatements_count: 41,
  });
});

test("redacts database passwords from commands stored in pipeline output", () => {
  assert.deepEqual(
    redactCommandForOutput([
      "node",
      "generate.js",
      "--db",
      "postgresql://okm:secret-value@127.0.0.1:5432/knowledge",
    ]),
    [
      "node",
      "generate.js",
      "--db",
      "postgresql://okm:****@127.0.0.1:5432/knowledge",
    ],
  );
});

test("retries only model failures and disables overwrite flags after the first attempt", () => {
  assert.equal(isRetryablePipelineOutputFailure("pedagogical_profiles", {
    failed_model_generation: 4,
    skipped_missing_context: 0,
  }), true);
  assert.equal(isRetryablePipelineOutputFailure("pedagogical_profiles", {
    failed_model_generation: 0,
    skipped_missing_context: 2,
  }), false);
  assert.equal(isRetryablePipelineOutputFailure("node_bodies", {
    failed_model_generation: 1,
  }), true);
  assert.equal(isRetryablePipelineOutputFailure("strict_qa", {
    failed_model_generation: 1,
  }), false);

  const dbUrl = "postgresql://okm:secret@localhost:5432/knowledge";
  const pedagogicalCommand = ["node", "generate-pedagogical-profiles.js", "--db", dbUrl, "--overwrite-generated"];
  assert.equal(commandForPipelineOutputAttempt("pedagogical_profiles", pedagogicalCommand, 0), pedagogicalCommand);
  assert.deepEqual(
    commandForPipelineOutputAttempt("pedagogical_profiles", pedagogicalCommand, 1),
    ["node", "generate-pedagogical-profiles.js", "--db", dbUrl],
  );
  assert.deepEqual(
    commandForPipelineOutputAttempt("node_bodies", ["node", "generate-node-bodies.js", "--overwrite-existing"], 1),
    ["node", "generate-node-bodies.js"],
  );
});

test("prefers MinerU Markdown over the optional pdftotext outline path", () => {
  assert.equal(shouldExtractPdfOutline({
    outlineExists: false,
    pdfPath: "E:\\books\\math.pdf",
    sourceMarkdownPath: "E:\\data\\mineru\\math\\full.md",
  }), false);
  assert.equal(shouldExtractPdfOutline({
    outlineExists: false,
    pdfPath: "E:\\books\\math.pdf",
    sourceMarkdownPath: "",
  }), true);
});

test("validates resume stages and skips stages before the requested checkpoint", () => {
  assert.equal(parsePipelineStartStage("node_bodies"), "node_bodies");
  assert.throws(() => parsePipelineStartStage("unknown"), /Invalid --start-stage/);
  assert.equal(shouldRunStage({ startStage: "node_bodies" }, "normalize"), false);
  assert.equal(shouldRunStage({ startStage: "node_bodies" }, "node_bodies"), true);
  assert.equal(shouldRunStage({ startStage: "node_bodies" }, "strict_qa"), true);
  assert.equal(shouldRecordReusedResumeStages({ startStage: "node_bodies" }), true);
  assert.equal(shouldRecordReusedResumeStages({
    startStage: "node_bodies",
    resumeExistingJob: true,
  }), false);
});

test("server pipeline resumes from a durable stage without rerunning extraction or merge", async (context) => {
  const resumeBookId = "resume-test-book";
  context.after(() => rmSync(outlinePathForBook(resumeBookId), { force: true }));
  const executed: string[][] = [];
  const result = await runServerPipeline({
    bookId: resumeBookId,
    outputRoot: "/tmp/okm",
    datasetId: "dataset-a",
    dbUrl: "postgresql://okm:okm@localhost:5432/knowledge",
    parallelism: 2,
    noChunks: false,
    pdfPath: "",
    subject: "computer-science",
    schoolStage: "higher",
    gradeBand: "university",
    textbookId: resumeBookId,
    apiMode: "responses",
    modelRetryCount: 2,
    model: "gpt-test",
    baseUrl: "",
    timeoutSeconds: 30,
    reasoningEffort: "medium",
    retrievalContext: true,
    retrievalLimit: 8,
    qualityRetryCount: 1,
    startStage: "node_bodies",
    progressStore: createNoopPipelineProgressStore(),
    assetStore: {
      async loadOutline() {
        return {
          book_id: resumeBookId,
          title: "Chemistry",
          source_path: `data/mineru/${resumeBookId}/full.md`,
          items: [{
            id: `struct:${resumeBookId}:lesson:1`,
            kind: "lesson",
            title: "Structure",
            order_path: "1",
            md_start: 1,
            md_end: 10,
          }],
        };
      },
      async upsertOutline() {},
      async upsertMineruSource() {},
      async close() {},
    },
    postgresChecker: fakePostgresChecker,
    datasetInitializer: fakeDatasetInitializer,
    commandRunner: async (command) => {
      executed.push(command);
      return { exitCode: 0, stdout: "{}", stderr: "" };
    },
  });

  assert.equal(result.status, "completed");
  const reusedStages = result.stages.filter((stage) => stage.status === "skipped");
  assert.deepEqual(reusedStages.map((stage) => stage.id), [
    "mineru_source_markdown",
    "extract_pdf_outline",
    "prepare_source_markdown",
    "ensure_outline",
    "prepare_outline_chunks",
    "lesson_plan",
    "lesson_staging",
    "staging_quality",
    "canonical_commit",
    "normalize",
  ]);
  assert.equal(reusedStages.every((stage) => stage.output?.reused === true), true);
  assert.equal(result.stages.find((stage) => stage.id === "node_bodies")?.status, "completed");
  assert.equal(executed.some(isExtractionCommand), false);
  assert.equal(executed.some((command) => command.some((part) => part.endsWith("merge-staged-lessons.js"))), false);
  assert.equal(executed.some((command) => command.some((part) => part.endsWith("normalize.js"))), false);
  assert.equal(executed[0]?.some((part) => part.endsWith("generate-node-bodies.js")), true);
});

test("explicit OCR input replaces the stored source when an outline already exists", async (context) => {
  const existingBookId = "existing-outline-ocr-replacement";
  const ocrRoot = mkdtempSync(join(tmpdir(), "okm-ocr-replacement-"));
  const ocrBundle = join(ocrRoot, "hybrid_ocr");
  const importedSourceDir = resolve(REPO_ROOT, "data", "mineru", safePathToken(existingBookId));
  const expectedMarkdown = "OCR preface\nmetadata\n# Updated source\nNew OCR body\n";
  let storedSourcePath = "";
  let storedOutline: Record<string, unknown> | null = null;
  const persistedOutlines: Record<string, unknown>[] = [];
  context.after(() => {
    rmSync(ocrRoot, { recursive: true, force: true });
    rmSync(importedSourceDir, { recursive: true, force: true });
    rmSync(outlinePathForBook(existingBookId), { force: true });
  });
  mkdirSync(ocrBundle, { recursive: true });
  writeFileSync(join(ocrBundle, "book.md"), expectedMarkdown, "utf8");

  const result = await runServerPipeline({
    bookId: existingBookId,
    outputRoot: "/tmp/okm",
    datasetId: "dataset-a",
    dbUrl: "postgresql://okm:okm@localhost:5432/knowledge",
    parallelism: 1,
    noChunks: false,
    pdfPath: "",
    ocrFolderPath: ocrRoot,
    subject: "mathematics",
    schoolStage: "junior",
    gradeBand: "grade7",
    textbookId: existingBookId,
    apiMode: "responses",
    modelRetryCount: 2,
    model: "gpt-test",
    baseUrl: "",
    timeoutSeconds: 30,
    reasoningEffort: "medium",
    retrievalContext: true,
    retrievalLimit: 8,
    qualityRetryCount: 1,
    progressStore: createNoopPipelineProgressStore(),
    assetStore: {
      async loadOutline() {
        return {
          book_id: existingBookId,
          title: "Stored outline",
          source_path: `data/mineru/${existingBookId}/stale.md`,
          items: [{
            id: `struct:${existingBookId}:lesson:1`,
            kind: "lesson",
            title: "Updated source",
            order_path: "1",
            md_start: 1,
            md_end: 2,
          }, {
            id: `struct:${existingBookId}:chunk:1-a`,
            kind: "chunk",
            parent_id: `struct:${existingBookId}:lesson:1`,
            order_path: "1-a",
            md_start: 1,
            md_end: 2,
          }],
        };
      },
      async upsertOutline(input) {
        storedOutline = input.record.outline;
        persistedOutlines.push(input.record.outline);
      },
      async upsertMineruSource(input) {
        storedSourcePath = input.record.sourceMarkdownPath ?? "";
      },
      async close() {},
    },
    postgresChecker: fakePostgresChecker,
    datasetInitializer: fakeDatasetInitializer,
    commandRunner: async () => ({ exitCode: 0, stdout: "{}", stderr: "" }),
  });

  assert.equal(result.status, "completed");
  const sourceStage = result.stages.find((stage) => stage.id === "mineru_source_markdown");
  const sourceStageOutput = sourceStage?.output as {
    source_kind?: string;
    outline_reset?: { removed_chunks?: number };
  } | undefined;
  assert.equal(sourceStage?.status, "completed");
  assert.equal(sourceStageOutput?.source_kind, "ocr_import");
  assert.equal(sourceStageOutput?.outline_reset?.removed_chunks, 1);
  const resetItems = persistedOutlines[0]?.items as Array<Record<string, unknown>>;
  assert.equal(persistedOutlines[0]?.source_path, `data/mineru/${existingBookId}/full.md`);
  const resetLesson = resetItems.find((item) => item.kind === "lesson");
  assert.ok(resetLesson);
  assert.equal("md_start" in resetLesson, false);
  assert.equal("md_end" in resetLesson, false);
  assert.equal(resetItems.some((item) => item.kind === "chunk"), false);
  assert.equal(readFileSync(join(importedSourceDir, "full.md"), "utf8"), expectedMarkdown);
  assert.equal(storedSourcePath, `data/mineru/${existingBookId}/full.md`);
  const finalOutline = storedOutline as Record<string, unknown> | null;
  assert.ok(finalOutline);
  const storedItems = finalOutline.items as Array<Record<string, unknown>>;
  const lesson = storedItems.find((item) => item.kind === "lesson");
  assert.equal(lesson?.md_start, 3);
  assert.equal(lesson?.md_end, 4);
  const rebuiltChunk = storedItems.find((item) => item.id === `struct:${existingBookId}:chunk:1-a`);
  assert.equal(rebuiltChunk?.md_start, 3);
  assert.equal(rebuiltChunk?.md_end, 4);
  assert.equal(storedItems.some((item) => item.kind === "chunk" && item.md_start === 1 && item.md_end === 2), false);
});

test("OCR import failures block the persisted pipeline job", async (context) => {
  const failedBookId = "failed-ocr-import";
  const ocrRoot = mkdtempSync(join(tmpdir(), "okm-failed-ocr-import-"));
  const missingBundle = join(ocrRoot, "removed-after-selection");
  const jobUpdates: Array<{ status: string; completed?: boolean; error?: string | null }> = [];
  const progressStore = createNoopPipelineProgressStore();
  context.after(() => {
    rmSync(ocrRoot, { recursive: true, force: true });
    rmSync(outlinePathForBook(failedBookId), { force: true });
  });

  const result = await runServerPipeline({
    bookId: failedBookId,
    outputRoot: "/tmp/okm",
    datasetId: "dataset-a",
    dbUrl: "postgresql://okm:okm@localhost:5432/knowledge",
    parallelism: 1,
    noChunks: false,
    pdfPath: "",
    ocrFolderPath: missingBundle,
    subject: "mathematics",
    schoolStage: "junior",
    gradeBand: "grade7",
    textbookId: failedBookId,
    apiMode: "responses",
    modelRetryCount: 2,
    model: "gpt-test",
    baseUrl: "",
    timeoutSeconds: 30,
    reasoningEffort: "medium",
    retrievalContext: true,
    retrievalLimit: 8,
    qualityRetryCount: 1,
    progressStore: {
      ...progressStore,
      async updateJob(input) {
        jobUpdates.push(input);
      },
    },
    assetStore: createNoopPipelineAssetStore(),
    postgresChecker: fakePostgresChecker,
    datasetInitializer: fakeDatasetInitializer,
    commandRunner: async () => ({ exitCode: 0, stdout: "{}", stderr: "" }),
  });

  assert.equal(result.status, "blocked");
  const sourceStage = result.stages.find((stage) => stage.id === "mineru_source_markdown");
  assert.equal(sourceStage?.status, "blocked");
  assert.match(sourceStage?.error ?? "", /OCR import failed: OCR folder not found/);
  assert.equal(result.context.ocr_folder_path, missingBundle);
  assert.deepEqual(jobUpdates.at(-1), {
    datasetId: "dataset-a",
    jobId: result.job_id,
    status: "blocked",
    currentStageId: "mineru_source_markdown",
    progress: {},
    error: sourceStage?.error,
    completed: true,
  });
});

test("OCR outline reset failures block the persisted pipeline job", async (context) => {
  const failedBookId = "failed-ocr-outline-reset";
  const ocrRoot = mkdtempSync(join(tmpdir(), "okm-failed-ocr-reset-"));
  const ocrBundle = join(ocrRoot, "hybrid_ocr");
  const outlinePath = outlinePathForBook(failedBookId);
  const importedSourceDir = resolve(REPO_ROOT, "data", "mineru", safePathToken(failedBookId));
  const jobUpdates: Array<{ status: string; completed?: boolean; error?: string | null }> = [];
  const progressStore = createNoopPipelineProgressStore();
  context.after(() => {
    rmSync(ocrRoot, { recursive: true, force: true });
    rmSync(importedSourceDir, { recursive: true, force: true });
    rmSync(outlinePath, { force: true });
  });
  mkdirSync(ocrBundle, { recursive: true });
  mkdirSync(resolve(outlinePath, ".."), { recursive: true });
  writeFileSync(join(ocrBundle, "book.md"), "# Replacement source\nbody\n", "utf8");
  writeFileSync(outlinePath, JSON.stringify({ book_id: failedBookId, source_path: "stale.md" }), "utf8");

  const result = await runServerPipeline({
    bookId: failedBookId,
    outputRoot: "/tmp/okm",
    datasetId: "dataset-a",
    dbUrl: "postgresql://okm:okm@localhost:5432/knowledge",
    parallelism: 1,
    noChunks: false,
    pdfPath: "",
    ocrFolderPath: ocrRoot,
    subject: "mathematics",
    schoolStage: "junior",
    gradeBand: "grade7",
    textbookId: failedBookId,
    apiMode: "responses",
    modelRetryCount: 2,
    model: "gpt-test",
    baseUrl: "",
    timeoutSeconds: 30,
    reasoningEffort: "medium",
    retrievalContext: true,
    retrievalLimit: 8,
    qualityRetryCount: 1,
    progressStore: {
      ...progressStore,
      async updateJob(input) {
        jobUpdates.push(input);
      },
    },
    assetStore: createNoopPipelineAssetStore(),
    postgresChecker: fakePostgresChecker,
    datasetInitializer: fakeDatasetInitializer,
    commandRunner: async () => ({ exitCode: 0, stdout: "{}", stderr: "" }),
  });

  assert.equal(result.status, "blocked");
  const sourceStage = result.stages.find((stage) => stage.id === "mineru_source_markdown");
  assert.equal(sourceStage?.status, "blocked");
  assert.match(sourceStage?.error ?? "", /OCR outline reset failed: Outline is missing items\/structure/);
  assert.equal(jobUpdates.at(-1)?.status, "blocked");
  assert.equal(jobUpdates.at(-1)?.completed, true);
});

test("explicit OCR input resets a file-only outline missing from the dataset store", async (context) => {
  const existingBookId = "file-only-outline-ocr-replacement";
  const ocrRoot = mkdtempSync(join(tmpdir(), "okm-file-only-ocr-replacement-"));
  const ocrBundle = join(ocrRoot, "hybrid_ocr");
  const outlinePath = outlinePathForBook(existingBookId);
  const importedSourceDir = resolve(REPO_ROOT, "data", "mineru", safePathToken(existingBookId));
  let storedOutline: Record<string, unknown> | null = null;
  context.after(() => {
    rmSync(ocrRoot, { recursive: true, force: true });
    rmSync(importedSourceDir, { recursive: true, force: true });
    rmSync(outlinePath, { force: true });
  });
  mkdirSync(ocrBundle, { recursive: true });
  mkdirSync(resolve(outlinePath, ".."), { recursive: true });
  writeFileSync(join(ocrBundle, "book.md"), "preface\n# Updated source\nNew OCR body\n", "utf8");
  writeFileSync(outlinePath, `${JSON.stringify({
    book_id: existingBookId,
    title: "File-only outline",
    source_path: `data/mineru/${existingBookId}/stale.md`,
    items: [{
      id: `struct:${existingBookId}:lesson:1`,
      kind: "lesson",
      title: "Updated source",
      order_path: "1",
      md_start: 1,
      md_end: 1,
    }, {
      id: `struct:${existingBookId}:chunk:1-a`,
      kind: "chunk",
      parent_id: `struct:${existingBookId}:lesson:1`,
      order_path: "1-a",
      md_start: 1,
      md_end: 1,
    }],
  }, null, 2)}\n`, "utf8");

  const result = await runServerPipeline({
    bookId: existingBookId,
    outputRoot: "/tmp/okm",
    datasetId: "dataset-b",
    dbUrl: "postgresql://okm:okm@localhost:5432/knowledge",
    parallelism: 1,
    noChunks: false,
    pdfPath: "",
    ocrFolderPath: ocrRoot,
    subject: "mathematics",
    schoolStage: "junior",
    gradeBand: "grade7",
    textbookId: existingBookId,
    apiMode: "responses",
    modelRetryCount: 2,
    model: "gpt-test",
    baseUrl: "",
    timeoutSeconds: 30,
    reasoningEffort: "medium",
    retrievalContext: true,
    retrievalLimit: 8,
    qualityRetryCount: 1,
    progressStore: createNoopPipelineProgressStore(),
    assetStore: {
      async loadOutline() {
        return null;
      },
      async upsertOutline(input) {
        storedOutline = input.record.outline;
      },
      async upsertMineruSource() {},
      async close() {},
    },
    postgresChecker: fakePostgresChecker,
    datasetInitializer: fakeDatasetInitializer,
    commandRunner: async () => ({ exitCode: 0, stdout: "{}", stderr: "" }),
  });

  assert.equal(result.status, "completed");
  const sourceStageOutput = result.stages.find((stage) => stage.id === "mineru_source_markdown")?.output as {
    outline_reset?: { removed_chunks?: number };
  } | undefined;
  assert.equal(sourceStageOutput?.outline_reset?.removed_chunks, 1);
  const finalOutline = storedOutline as Record<string, unknown> | null;
  assert.ok(finalOutline);
  const storedItems = finalOutline.items as Array<Record<string, unknown>>;
  assert.equal(storedItems.find((item) => item.kind === "lesson")?.md_start, 2);
  assert.equal(storedItems.find((item) => item.kind === "chunk")?.md_start, 2);
  assert.equal(storedItems.some((item) => item.kind === "chunk" && item.md_end === 1), false);
});

test("server pipeline runner plans TypeScript lesson extraction commands", async () => {
  const executed: string[][] = [];
  const result = await runServerPipeline({
    bookId,
    outputRoot: "/tmp/okm",
    datasetId: "dataset-a",
    dbUrl: "postgresql://okm:okm@localhost:5432/knowledge",
    parallelism: 2,
    noChunks: false,
    pdfPath: "",
    subject: "computer-science",
    schoolStage: "higher",
    gradeBand: "university",
    textbookId: bookId,
    apiMode: "responses",
    modelRetryCount: 2,
    model: "gpt-test",
    baseUrl: "",
    timeoutSeconds: 30,
    reasoningEffort: "medium",
    vlmApiUrl: "http://localhost:8000/v1",
    retrievalContext: true,
    retrievalLimit: 8,
    qualityRetryCount: 1,
    progressStore: createNoopPipelineProgressStore(),
    assetStore: createNoopPipelineAssetStore(),
    postgresChecker: fakePostgresChecker,
    datasetInitializer: fakeDatasetInitializer,
    commandRunner: async (command) => {
      executed.push(command);
      return { exitCode: 0, stdout: "{}", stderr: "" };
    },
  });

  assert.equal(result.status, "completed");
  assert.equal(result.stages[0]?.id, "check_postgres");
  assert.equal(result.stages[0]?.status, "completed");
  const lessonPlan = result.stages.find((stage) => stage.id === "lesson_plan");
  const commands = lessonPlan?.output?.commands as string[][];
  assert.equal(commands.length, 37);
  assert.ok(commands[0]?.some((part) => part.endsWith("extract-lesson-openai.js")));
  assert.ok(commands[0]?.includes("--write-staging"));
  assert.ok(commands[0]?.includes("--extraction-template"));
  assert.ok(commands[0]?.includes("auto"));
  assert.ok(commands[0]?.includes("--vlm-api-url"));
  assert.ok(commands[0]?.includes("http://localhost:8000/v1"));
  assert.ok(commands[0]?.includes("--enrich-context"));
  assert.ok(commands[0]?.includes("--enrich-context-limit"));
  assert.ok(!commands[0]?.some((part) => part.includes("run_okm_harness.py")));
  assert.equal(executed.filter((command) => command.some((part) => part.endsWith("extract-lesson-openai.js"))).length, 37);
});

test("server pipeline retries only lessons with transient extraction failures", async () => {
  const extractionAttempts = new Map<string, number>();
  const result = await runServerPipeline({
    bookId,
    outputRoot: "/tmp/okm",
    datasetId: "dataset-a",
    dbUrl: "postgresql://okm:okm@localhost:5432/knowledge",
    parallelism: 8,
    noChunks: false,
    pdfPath: "",
    subject: "computer-science",
    schoolStage: "higher",
    gradeBand: "university",
    textbookId: bookId,
    apiMode: "responses",
    modelRetryCount: 2,
    model: "gpt-test",
    baseUrl: "",
    timeoutSeconds: 30,
    reasoningEffort: "medium",
    retrievalContext: true,
    retrievalLimit: 8,
    qualityRetryCount: 1,
    progressStore: createNoopPipelineProgressStore(),
    assetStore: createNoopPipelineAssetStore(),
    postgresChecker: fakePostgresChecker,
    datasetInitializer: fakeDatasetInitializer,
    commandRunner: async (command) => {
      if (!isExtractionCommand(command)) return { exitCode: 0, stdout: "{}", stderr: "" };
      const anchorIndex = command.indexOf("--batch-anchor");
      const anchor = command[anchorIndex + 1] ?? "";
      const attempts = (extractionAttempts.get(anchor) ?? 0) + 1;
      extractionAttempts.set(anchor, attempts);
      if (extractionAttempts.size === 1 && attempts === 1) {
        return {
          exitCode: 2,
          stdout: JSON.stringify({ status: "blocked", issues: ["OpenAI Responses extraction failed: fetch failed"] }),
          stderr: "",
        };
      }
      return { exitCode: 0, stdout: "{}", stderr: "" };
    },
  });

  assert.equal(result.status, "completed");
  assert.equal([...extractionAttempts.values()].filter((attempts) => attempts === 2).length, 1);
  assert.equal(result.stages.find((stage) => stage.id === "lesson_staging_retry_transport_1")?.status, "completed");
  const lessonStage = result.stages.find((stage) => stage.id === "lesson_staging");
  assert.equal(lessonStage?.status, "completed");
  assert.equal(lessonStage?.output?.recovered_transient_failures, 1);
});

test("server pipeline runner executes TypeScript quality gate and canonical reducer after staging", async () => {
  const commands: string[][] = [];
  const result = await runServerPipeline({
    bookId,
    outputRoot: "/tmp/okm",
    datasetId: "dataset-a",
    dbUrl: "postgresql://okm:okm@localhost:5432/knowledge",
    parallelism: 8,
    noChunks: false,
    pdfPath: "",
    subject: "computer-science",
    schoolStage: "higher",
    gradeBand: "university",
    textbookId: bookId,
    apiMode: "responses",
    modelRetryCount: 2,
    model: "gpt-test",
    baseUrl: "",
    timeoutSeconds: 30,
    reasoningEffort: "medium",
    retrievalContext: true,
    retrievalLimit: 8,
    qualityRetryCount: 1,
    progressStore: createNoopPipelineProgressStore(),
    assetStore: createNoopPipelineAssetStore(),
    postgresChecker: fakePostgresChecker,
    datasetInitializer: fakeDatasetInitializer,
    commandRunner: async (command) => {
      commands.push(command);
      return { exitCode: 0, stdout: "{}", stderr: "" };
    },
  });

  assert.equal(result.status, "completed");
  const canonicalStage = result.stages.find((stage) => stage.id === "canonical_commit");
  const stagingQualityStage = result.stages.find((stage) => stage.id === "staging_quality");
  const normalizeStage = result.stages.find((stage) => stage.id === "normalize");
  const qaStage = result.stages.find((stage) => stage.id === "strict_qa");
  const integrityStage = result.stages.find((stage) => stage.id === "graph_integrity");
  const qualityDashboardStage = result.stages.find((stage) => stage.id === "quality_dashboard");
  const nodeBodiesStage = result.stages.find((stage) => stage.id === "node_bodies");
  const pedagogicalProfilesStage = result.stages.find((stage) => stage.id === "pedagogical_profiles");
  const nodeEmbeddingsStage = result.stages.find((stage) => stage.id === "node_embeddings");
  const unitEmbeddingsStage = result.stages.find((stage) => stage.id === "unit_embeddings");
  const canonicalCommand = canonicalStage?.output?.command as string[];
  const stagingQualityCommand = stagingQualityStage?.output?.command as string[];
  const nodeBodiesCommand = nodeBodiesStage?.output?.command as string[];
  const pedagogicalProfilesCommand = pedagogicalProfilesStage?.output?.command as string[];
  const nodeEmbeddingsCommand = nodeEmbeddingsStage?.output?.command as string[];
  const unitEmbeddingsCommand = unitEmbeddingsStage?.output?.command as string[];
  const integrityCommand = integrityStage?.output?.command as string[];
  const qualityDashboardCommand = qualityDashboardStage?.output?.command as string[];
  assert.equal(stagingQualityStage?.status, "completed");
  assert.ok(stagingQualityCommand.some((part) => part.endsWith("staging-quality.js")));
  assert.ok(stagingQualityCommand.includes("--book-id"));
  assert.equal(canonicalStage?.status, "completed");
  assert.ok(canonicalCommand.some((part) => part.endsWith("merge-staged-lessons.js")));
  assert.ok(canonicalCommand.includes("--db"));
  assert.equal(normalizeStage?.status, "completed");
  assert.equal(nodeBodiesStage?.status, "completed");
  assert.ok(nodeBodiesCommand.some((part) => part.endsWith("generate-node-bodies.js")));
  assert.ok(nodeBodiesCommand.includes("--book-id"));
  assert.ok(nodeBodiesCommand.includes(bookId));
  assert.equal(nodeBodiesCommand.includes("--mode"), false);
  assert.ok(nodeBodiesCommand.includes("--concurrency"));
  assert.ok(nodeBodiesCommand.includes("8"));
  assert.ok(nodeBodiesCommand.includes("--model-retry-count"));
  assert.ok(nodeBodiesCommand.includes("2"));
  assert.equal(pedagogicalProfilesStage?.status, "completed");
  assert.ok(pedagogicalProfilesCommand.some((part) => part.endsWith("generate-pedagogical-profiles.js")));
  assert.ok(pedagogicalProfilesCommand.includes("--book-id"));
  assert.ok(pedagogicalProfilesCommand.includes(bookId));
  assert.ok(pedagogicalProfilesCommand.includes("--school-stage"));
  assert.ok(pedagogicalProfilesCommand.includes("higher"));
  assert.ok(pedagogicalProfilesCommand.includes("--grade-band"));
  assert.ok(pedagogicalProfilesCommand.includes("university"));
  assert.ok(pedagogicalProfilesCommand.includes("--concurrency"));
  assert.ok(pedagogicalProfilesCommand.includes("8"));
  assert.ok(pedagogicalProfilesCommand.includes("--model-retry-count"));
  assert.ok(pedagogicalProfilesCommand.includes("2"));
  assert.equal(nodeEmbeddingsStage?.status, "completed");
  assert.ok(nodeEmbeddingsCommand.some((part) => part.endsWith("backfill-embeddings.js")));
  assert.ok(nodeEmbeddingsCommand.includes("--dataset-id"));
  assert.ok(nodeEmbeddingsCommand.includes("dataset-a"));
  assert.ok(nodeEmbeddingsCommand.includes("--table"));
  assert.ok(nodeEmbeddingsCommand.includes("world_nodes"));
  assert.equal(unitEmbeddingsStage?.status, "completed");
  assert.ok(unitEmbeddingsCommand.some((part) => part.endsWith("backfill-unit-embeddings.js")));
  assert.ok(unitEmbeddingsCommand.includes("--dataset-id"));
  assert.ok(unitEmbeddingsCommand.includes("dataset-a"));
  assert.equal(qaStage?.status, "completed");
  assert.ok(commands.at(-3)?.includes("--book-id"));
  assert.ok(commands.at(-3)?.includes(bookId));
  assert.equal(integrityStage?.status, "completed");
  assert.ok(integrityCommand.some((part) => part.endsWith("graph-integrity.js")));
  assert.ok(integrityCommand.includes("--mark-qa-passed"));
  assert.equal(qualityDashboardStage?.status, "completed");
  assert.ok(qualityDashboardCommand.some((part) => part.endsWith("quality-dashboard.js")));
  assert.ok(commands.at(-10)?.some((part) => part.endsWith("staging-quality.js")));
  assert.ok(commands.at(-9)?.some((part) => part.endsWith("merge-staged-lessons.js")));
  assert.ok(commands.at(-8)?.some((part) => part.endsWith("normalize.js")));
  assert.ok(commands.at(-7)?.some((part) => part.endsWith("generate-node-bodies.js")));
  assert.ok(commands.at(-6)?.some((part) => part.endsWith("generate-pedagogical-profiles.js")));
  assert.ok(commands.at(-5)?.some((part) => part.endsWith("backfill-embeddings.js")));
  assert.ok(commands.at(-4)?.some((part) => part.endsWith("backfill-unit-embeddings.js")));
  assert.ok(commands.at(-3)?.some((part) => part.endsWith("strict-qa.js")));
  assert.ok(commands.at(-2)?.some((part) => part.endsWith("graph-integrity.js")));
  assert.ok(commands.at(-1)?.some((part) => part.endsWith("quality-dashboard.js")));
  assert.ok(commands.slice(0, -10).every((command) => command.some((part) => part.endsWith("extract-lesson-openai.js"))));
});

test("server pipeline retries chunks that fail staging quality", async () => {
  const commands: string[][] = [];
  const failedAnchor = "struct:chem-hukj-xb2-structure:chunk:1-1-a";
  const failedLessonRunId = makeLessonRunId(bookId, failedAnchor);
  let qualityCalls = 0;
  const result = await runServerPipeline({
    bookId,
    outputRoot: "/tmp/okm",
    datasetId: "dataset-a",
    dbUrl: "postgresql://okm:okm@localhost:5432/knowledge",
    parallelism: 8,
    noChunks: false,
    pdfPath: "",
    subject: "computer-science",
    schoolStage: "higher",
    gradeBand: "university",
    textbookId: bookId,
    apiMode: "responses",
    modelRetryCount: 2,
    model: "gpt-test",
    baseUrl: "",
    timeoutSeconds: 30,
    reasoningEffort: "medium",
    retrievalContext: true,
    retrievalLimit: 8,
    qualityRetryCount: 1,
    progressStore: createNoopPipelineProgressStore(),
    assetStore: createNoopPipelineAssetStore(),
    postgresChecker: fakePostgresChecker,
    datasetInitializer: fakeDatasetInitializer,
    commandRunner: async (command) => {
      commands.push(command);
      if (isStagingQualityCommand(command)) {
        qualityCalls += 1;
        if (qualityCalls === 1) {
          return {
            exitCode: 2,
            stdout: JSON.stringify({
              status: "blocked",
              checked: 37,
              blocked: 1,
              results: [
                {
                  lesson_run_id: failedLessonRunId,
                  status: "blocked",
                  errors: ["Lesson produced no staged nodes."],
                  counts: { nodes: 0, evidence: 1 },
                },
              ],
            }),
            stderr: "",
          };
        }
        return { exitCode: 0, stdout: JSON.stringify({ status: "success", checked: 37, blocked: 0, results: [] }), stderr: "" };
      }
      return { exitCode: 0, stdout: "{}", stderr: "" };
    },
  });

  assert.equal(result.status, "completed");
  assert.equal(qualityCalls, 2);
  const firstQualityIndex = commands.findIndex(isStagingQualityCommand);
  const secondQualityIndex = commands.findIndex((command, index) => index > firstQualityIndex && isStagingQualityCommand(command));
  const retryExtractionCommands = commands.slice(firstQualityIndex + 1, secondQualityIndex).filter(isExtractionCommand);
  assert.equal(retryExtractionCommands.length, 1);
  assert.ok(retryExtractionCommands[0]?.includes(failedAnchor));
  assert.ok(retryExtractionCommands[0]?.includes("--prompt"));
  const retryPrompt = retryExtractionCommands[0]?.at(-1) ?? "";
  assert.match(retryPrompt, /质量失败后的自动重抽/);
  assert.match(retryPrompt, /computer-science/);
  assert.match(retryPrompt, /higher/);
  assert.match(retryPrompt, /university/);
  assert.match(retryPrompt, /lesson_disposition/);
  assert.match(retryPrompt, /no_knowledge_reason/);
  assert.doesNotMatch(retryPrompt, /不要让节点数为 0/);
  assert.doesNotMatch(retryPrompt, /domain_profile|node_card/);
  assert.doesNotMatch(retryPrompt, /高中物理|物理量/);
  assert.equal(commands.filter(isExtractionCommand).length, 38);
  assert.equal(result.stages.find((stage) => stage.id === "lesson_staging_retry_1")?.status, "completed");
  assert.equal(result.stages.find((stage) => stage.id === "staging_quality")?.status, "completed");
});

test("server pipeline blocks when node body generation reports model failures", async () => {
  const commands: string[][] = [];
  const result = await runServerPipeline({
    bookId,
    outputRoot: "/tmp/okm",
    datasetId: "dataset-a",
    dbUrl: "postgresql://okm:okm@localhost:5432/knowledge",
    parallelism: 8,
    noChunks: false,
    pdfPath: "",
    subject: "computer-science",
    schoolStage: "higher",
    gradeBand: "university",
    textbookId: bookId,
    apiMode: "responses",
    modelRetryCount: 2,
    model: "gpt-test",
    baseUrl: "",
    timeoutSeconds: 30,
    reasoningEffort: "medium",
    retrievalContext: true,
    retrievalLimit: 8,
    qualityRetryCount: 1,
    progressStore: createNoopPipelineProgressStore(),
    assetStore: createNoopPipelineAssetStore(),
    postgresChecker: fakePostgresChecker,
    datasetInitializer: fakeDatasetInitializer,
    commandRunner: async (command) => {
      commands.push(command);
      if (isNodeBodiesCommand(command)) {
        return { exitCode: 0, stdout: JSON.stringify({ failed_model_generation: 2 }), stderr: "" };
      }
      return { exitCode: 0, stdout: "{}", stderr: "" };
    },
  });

  assert.equal(result.status, "blocked");
  const nodeBodiesStage = result.stages.find((stage) => stage.id === "node_bodies");
  assert.equal(nodeBodiesStage?.status, "blocked");
  assert.match(nodeBodiesStage?.error ?? "", /2 node body generation/);
  assert.equal(commands.some((command) => command.some((part) => part.endsWith("strict-qa.js"))), false);
});

test("server pipeline retries missing node bodies before blocking the run", async () => {
  let nodeBodyCalls = 0;
  const result = await runServerPipeline({
    bookId,
    outputRoot: "/tmp/okm",
    datasetId: "dataset-a",
    dbUrl: "postgresql://okm:okm@localhost:5432/knowledge",
    parallelism: 8,
    noChunks: false,
    pdfPath: "",
    subject: "computer-science",
    schoolStage: "higher",
    gradeBand: "university",
    textbookId: bookId,
    apiMode: "responses",
    modelRetryCount: 2,
    model: "gpt-test",
    baseUrl: "",
    timeoutSeconds: 30,
    reasoningEffort: "medium",
    retrievalContext: true,
    retrievalLimit: 8,
    qualityRetryCount: 1,
    progressStore: createNoopPipelineProgressStore(),
    assetStore: createNoopPipelineAssetStore(),
    postgresChecker: fakePostgresChecker,
    datasetInitializer: fakeDatasetInitializer,
    commandRunner: async (command) => {
      if (isNodeBodiesCommand(command)) {
        nodeBodyCalls += 1;
        if (nodeBodyCalls === 1) {
          return {
            exitCode: 0,
            stdout: JSON.stringify({
              selected: 44,
              generated: 43,
              failed_model_generation: 1,
              model_failures: [{ node_id: "node-failed", message: "Model output must be a JSON object" }],
            }),
            stderr: "",
          };
        }
        return {
          exitCode: 0,
          stdout: JSON.stringify({ selected: 1, generated: 1, failed_model_generation: 0, model_failures: [] }),
          stderr: "",
        };
      }
      return { exitCode: 0, stdout: "{}", stderr: "" };
    },
  });

  assert.equal(result.status, "completed");
  assert.equal(nodeBodyCalls, 2);
  const nodeBodiesStage = result.stages.find((stage) => stage.id === "node_bodies");
  assert.equal(nodeBodiesStage?.status, "completed");
  assert.equal((nodeBodiesStage?.output?.attempts as unknown[])?.length, 2);
});

test("server pipeline blocks when pedagogical profile generation reports model failures", async () => {
  const commands: string[][] = [];
  const result = await runServerPipeline({
    bookId,
    outputRoot: "/tmp/okm",
    datasetId: "dataset-a",
    dbUrl: "postgresql://okm:okm@localhost:5432/knowledge",
    parallelism: 8,
    noChunks: false,
    pdfPath: "",
    subject: "computer-science",
    schoolStage: "higher",
    gradeBand: "university",
    textbookId: bookId,
    apiMode: "responses",
    modelRetryCount: 2,
    model: "gpt-test",
    baseUrl: "",
    timeoutSeconds: 30,
    reasoningEffort: "medium",
    retrievalContext: true,
    retrievalLimit: 8,
    qualityRetryCount: 1,
    progressStore: createNoopPipelineProgressStore(),
    assetStore: createNoopPipelineAssetStore(),
    postgresChecker: fakePostgresChecker,
    datasetInitializer: fakeDatasetInitializer,
    commandRunner: async (command) => {
      commands.push(command);
      if (isPedagogicalProfilesCommand(command)) {
        return { exitCode: 0, stdout: JSON.stringify({ failed_model_generation: 2 }), stderr: "" };
      }
      return { exitCode: 0, stdout: "{}", stderr: "" };
    },
  });

  assert.equal(result.status, "blocked");
  const stage = result.stages.find((item) => item.id === "pedagogical_profiles");
  assert.equal(stage?.status, "blocked");
  assert.match(stage?.error ?? "", /2 pedagogical profile generation/);
  assert.equal(commands.filter(isPedagogicalProfilesCommand).length, 2);
  assert.equal(commands.some((command) => command.some((part) => part.endsWith("backfill-embeddings.js"))), false);
  assert.equal(commands.some((command) => command.some((part) => part.endsWith("strict-qa.js"))), false);
});

test("server pipeline blocks when unit embedding backfill cannot update pending units", async () => {
  const commands: string[][] = [];
  const result = await runServerPipeline({
    bookId,
    outputRoot: "/tmp/okm",
    datasetId: "dataset-a",
    dbUrl: "postgresql://okm:okm@localhost:5432/knowledge",
    parallelism: 8,
    noChunks: false,
    pdfPath: "",
    subject: "computer-science",
    schoolStage: "higher",
    gradeBand: "university",
    textbookId: bookId,
    apiMode: "responses",
    modelRetryCount: 2,
    model: "gpt-test",
    baseUrl: "",
    timeoutSeconds: 30,
    reasoningEffort: "medium",
    retrievalContext: true,
    retrievalLimit: 8,
    qualityRetryCount: 1,
    progressStore: createNoopPipelineProgressStore(),
    assetStore: createNoopPipelineAssetStore(),
    postgresChecker: fakePostgresChecker,
    datasetInitializer: fakeDatasetInitializer,
    commandRunner: async (command) => {
      commands.push(command);
      if (isUnitEmbeddingsCommand(command)) {
        return { exitCode: 0, stdout: JSON.stringify({ status: "success", pending: 3, updated: 1 }), stderr: "" };
      }
      return { exitCode: 0, stdout: "{}", stderr: "" };
    },
  });

  assert.equal(result.status, "blocked");
  const unitEmbeddingsStage = result.stages.find((stage) => stage.id === "unit_embeddings");
  assert.equal(unitEmbeddingsStage?.status, "blocked");
  assert.match(unitEmbeddingsStage?.error ?? "", /updated 1\/3 pending/);
  assert.equal(commands.some((command) => command.some((part) => part.endsWith("strict-qa.js"))), false);
});

async function fakePostgresChecker() {
  return {
    status: "success" as const,
    database_url_present: true as const,
    socket_ready: true as const,
    postgres_query_ok: false,
    host: "localhost",
    port: 5432,
  };
}

async function fakeDatasetInitializer() {}

function isExtractionCommand(command: string[]): boolean {
  return command.some((part) => part.endsWith("extract-lesson-openai.js"));
}

function isStagingQualityCommand(command: string[]): boolean {
  return command.some((part) => part.endsWith("staging-quality.js"));
}

function isNodeBodiesCommand(command: string[]): boolean {
  return command.some((part) => part.endsWith("generate-node-bodies.js"));
}

function isPedagogicalProfilesCommand(command: string[]): boolean {
  return command.some((part) => part.endsWith("generate-pedagogical-profiles.js"));
}

function isUnitEmbeddingsCommand(command: string[]): boolean {
  return command.some((part) => part.endsWith("backfill-unit-embeddings.js"));
}
