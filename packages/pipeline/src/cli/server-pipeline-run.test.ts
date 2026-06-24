import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { runServerPipeline } from "./server-pipeline-run.js";

const bookId = "chem-hukj-xb2-structure";

test("server pipeline runner plans TypeScript lesson extraction commands", async () => {
  const repo = makeFixtureRepo();
  const executed: string[][] = [];
  try {
    const manifest = await runServerPipeline({
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
      model: "gpt-test",
      baseUrl: "",
      timeoutSeconds: 30,
      reasoningEffort: "medium",
      retrievalContext: true,
      retrievalLimit: 8,
      manifestPath: join(repo.root, "manifest.json"),
      postgresChecker: fakePostgresChecker,
      commandRunner: async (command) => {
        executed.push(command);
        return { exitCode: 0, stdout: "{}", stderr: "" };
      },
    });

    assert.equal(manifest.status, "completed");
    assert.equal(manifest.stages[0]?.id, "check_postgres");
    assert.equal(manifest.stages[0]?.status, "completed");
    const lessonPlan = manifest.stages.find((stage) => stage.id === "lesson_plan");
    const commands = lessonPlan?.output?.commands as string[][];
    assert.equal(commands.length, 37);
    assert.ok(commands[0]?.some((part) => part.endsWith("extract-lesson-openai.js")));
    assert.ok(commands[0]?.includes("--write-staging"));
    assert.ok(!commands[0]?.some((part) => part.includes("run_okm_harness.py")));
    assert.equal(executed.filter((command) => command.some((part) => part.endsWith("extract-lesson-openai.js"))).length, 37);
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

test("server pipeline runner executes TypeScript quality gate and canonical reducer after staging", async () => {
  const repo = makeFixtureRepo();
  const commands: string[][] = [];
  try {
    const manifest = await runServerPipeline({
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
      model: "gpt-test",
      baseUrl: "",
      timeoutSeconds: 30,
      reasoningEffort: "medium",
      retrievalContext: true,
      retrievalLimit: 8,
      manifestPath: join(repo.root, "manifest.json"),
      postgresChecker: fakePostgresChecker,
      commandRunner: async (command) => {
        commands.push(command);
        return { exitCode: 0, stdout: "{}", stderr: "" };
      },
    });

    assert.equal(manifest.status, "completed");
    const canonicalStage = manifest.stages.find((stage) => stage.id === "canonical_commit");
    const stagingQualityStage = manifest.stages.find((stage) => stage.id === "staging_quality");
    const normalizeStage = manifest.stages.find((stage) => stage.id === "normalize");
    const qaStage = manifest.stages.find((stage) => stage.id === "strict_qa");
    const integrityStage = manifest.stages.find((stage) => stage.id === "graph_integrity");
    const canonicalCommand = canonicalStage?.output?.command as string[];
    const stagingQualityCommand = stagingQualityStage?.output?.command as string[];
    const integrityCommand = integrityStage?.output?.command as string[];
    assert.equal(stagingQualityStage?.status, "completed");
    assert.ok(stagingQualityCommand.some((part) => part.endsWith("staging-quality.js")));
    assert.ok(stagingQualityCommand.includes("--book-id"));
    assert.equal(canonicalStage?.status, "completed");
    assert.ok(canonicalCommand.some((part) => part.endsWith("merge-staged-lessons.js")));
    assert.ok(canonicalCommand.includes("--db"));
    assert.equal(normalizeStage?.status, "completed");
    assert.equal(qaStage?.status, "completed");
    assert.equal(integrityStage?.status, "completed");
    assert.ok(integrityCommand.some((part) => part.endsWith("graph-integrity.js")));
    assert.ok(integrityCommand.includes("--mark-qa-passed"));
    assert.ok(commands.at(-5)?.some((part) => part.endsWith("staging-quality.js")));
    assert.ok(commands.at(-4)?.some((part) => part.endsWith("merge-staged-lessons.js")));
    assert.ok(commands.at(-3)?.some((part) => part.endsWith("normalize.js")));
    assert.ok(commands.at(-2)?.some((part) => part.endsWith("strict-qa.js")));
    assert.ok(commands.at(-1)?.some((part) => part.endsWith("graph-integrity.js")));
    assert.ok(commands.slice(0, -5).every((command) => command.some((part) => part.endsWith("extract-lesson-openai.js"))));
  } finally {
    rmSync(repo.root, { recursive: true, force: true });
  }
});

function makeFixtureRepo(): { root: string } {
  const root = mkdtempSync(join(tmpdir(), "okm-ts-server-runner-"));
  return { root };
}

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
