import assert from "node:assert/strict";
import test from "node:test";

import { createNoopPipelineAssetStore } from "../shared/pg-assets.js";
import { makeLessonRunId } from "../shared/pathing.js";
import { createNoopPipelineProgressStore } from "../shared/pipeline-progress.js";
import { runServerPipeline } from "./server-pipeline-run.js";

const bookId = "chem-hukj-xb2-structure";

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
  const nodeEmbeddingsStage = result.stages.find((stage) => stage.id === "node_embeddings");
  const unitEmbeddingsStage = result.stages.find((stage) => stage.id === "unit_embeddings");
  const canonicalCommand = canonicalStage?.output?.command as string[];
  const stagingQualityCommand = stagingQualityStage?.output?.command as string[];
  const nodeBodiesCommand = nodeBodiesStage?.output?.command as string[];
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
  assert.equal(integrityStage?.status, "completed");
  assert.ok(integrityCommand.some((part) => part.endsWith("graph-integrity.js")));
  assert.ok(integrityCommand.includes("--mark-qa-passed"));
  assert.equal(qualityDashboardStage?.status, "completed");
  assert.ok(qualityDashboardCommand.some((part) => part.endsWith("quality-dashboard.js")));
  assert.ok(commands.at(-9)?.some((part) => part.endsWith("staging-quality.js")));
  assert.ok(commands.at(-8)?.some((part) => part.endsWith("merge-staged-lessons.js")));
  assert.ok(commands.at(-7)?.some((part) => part.endsWith("normalize.js")));
  assert.ok(commands.at(-6)?.some((part) => part.endsWith("generate-node-bodies.js")));
  assert.ok(commands.at(-5)?.some((part) => part.endsWith("backfill-embeddings.js")));
  assert.ok(commands.at(-4)?.some((part) => part.endsWith("backfill-unit-embeddings.js")));
  assert.ok(commands.at(-3)?.some((part) => part.endsWith("strict-qa.js")));
  assert.ok(commands.at(-2)?.some((part) => part.endsWith("graph-integrity.js")));
  assert.ok(commands.at(-1)?.some((part) => part.endsWith("quality-dashboard.js")));
  assert.ok(commands.slice(0, -9).every((command) => command.some((part) => part.endsWith("extract-lesson-openai.js"))));
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

function isUnitEmbeddingsCommand(command: string[]): boolean {
  return command.some((part) => part.endsWith("backfill-unit-embeddings.js"));
}
