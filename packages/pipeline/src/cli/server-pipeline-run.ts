#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { planParallelBatches, planTsModelExtractionCommands, type ParallelExtractionCommand } from "../extraction/parallel-batch.js";
import { extractPdfOutline } from "../outline/pdf-outline.js";
import { runMineruSourceMarkdown } from "../outline/mineru-source.js";
import { ensureChunkedOutline, ensureOutlineFromMarkdown, prepareSourceMarkdown } from "../outline/source-preparation.js";
import { REPO_ROOT, loadOutlineItems, outlinePathForBook, safePathToken } from "../shared/pathing.js";
import { checkPostgresReady, type PostgresReadinessResult } from "../shared/postgres-readiness.js";

type StageStatus = "completed" | "blocked" | "running" | "skipped";

type ServerPipelineStage = {
  id: string;
  status: StageStatus;
  output?: Record<string, unknown>;
  error?: string;
};

type ServerPipelineManifest = {
  workflow_id: "okm.ts_server_pipeline";
  status: "completed" | "blocked";
  context: Record<string, unknown>;
  stages: ServerPipelineStage[];
};

type CommandOutput = { exitCode: number; stdout: string; stderr: string };
type CommandRunner = (command: string[]) => Promise<CommandOutput>;
type PostgresChecker = (databaseUrl: string) => Promise<PostgresReadinessResult>;

type RunnerOptions = {
  bookId: string;
  outputRoot: string;
  datasetId: string;
  dbUrl: string;
  parallelism: number;
  noChunks: boolean;
  pdfPath: string;
  sourceMarkdownPath?: string;
  bookTitle?: string;
  outlineStartPage?: number;
  outlineEndPage?: number;
  mineruFileUrl?: string;
  mineruApiKeyEnv?: string;
  mineruBaseUrl?: string;
  mineruModelVersion?: string;
  mineruLanguage?: string;
  mineruPageRanges?: string;
  mineruTimeoutSeconds?: number;
  mineruForce?: boolean;
  subject: string;
  schoolStage: string;
  gradeBand: string;
  textbookId: string;
  apiMode: "responses" | "chat_completions";
  model: string;
  baseUrl: string;
  timeoutSeconds: number;
  reasoningEffort: string;
  vlmApiUrl?: string;
  vlmApiKeyEnv?: string;
  vlmCacheDir?: string;
  vlmConcurrency?: number;
  vlmModel?: string;
  retrievalContext: boolean;
  retrievalLimit: number;
  manifestPath?: string;
  commandRunner?: CommandRunner;
  postgresChecker?: PostgresChecker;
};

const CLI_DIR = dirname(fileURLToPath(import.meta.url));

async function main(argv: string[]): Promise<number> {
  try {
    const options = parseOptions(argv);
    const result = await runServerPipeline(options);
    process.stdout.write(`${JSON.stringify(result)}\n`);
    return result.status === "blocked" ? 2 : 0;
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 1;
  }
}

export async function runServerPipeline(options: RunnerOptions): Promise<ServerPipelineManifest> {
  const manifest = createManifest(options);
  writeManifest(options, manifest);

  const postgresStage = await (options.postgresChecker ?? defaultPostgresChecker)(options.dbUrl);
  if (postgresStage.status === "blocked") {
    manifest.status = "blocked";
    pushStage(manifest, { id: "check_postgres", status: "blocked", error: postgresStage.issues.join("; ") });
    writeManifest(options, manifest);
    return manifest;
  }
  pushStage(manifest, { id: "check_postgres", status: "completed", output: postgresStage });
  writeManifest(options, manifest);

  const outlinePath = outlinePathForBook(options.bookId);
  let sourceMarkdownPath = options.sourceMarkdownPath ?? "";
  const mineruFileUrl = options.mineruFileUrl ?? "";
  const shouldRunMineru = !sourceMarkdownPath.trim() && !existsSync(outlinePath) && Boolean(options.pdfPath || mineruFileUrl);
  if (shouldRunMineru) {
    const mineruStage = await runMineruSourceMarkdown({
      bookId: options.bookId,
      outputDir: resolve(REPO_ROOT, "data", "mineru", safePathToken(options.bookId)),
      apiKey: process.env[options.mineruApiKeyEnv ?? "MINERU_API_KEY"] ?? "",
      pdfPath: options.pdfPath || undefined,
      fileUrl: mineruFileUrl || undefined,
      baseUrl: options.mineruBaseUrl || "https://mineru.net",
      modelVersion: options.mineruModelVersion || "vlm",
      language: options.mineruLanguage || "ch",
      pageRanges: options.mineruPageRanges || undefined,
      timeoutMs: (options.mineruTimeoutSeconds ?? 1800) * 1000,
      force: options.mineruForce ?? false,
    });
    if (mineruStage.status === "blocked") {
      manifest.status = "blocked";
      pushStage(manifest, { id: "mineru_source_markdown", status: "blocked", error: mineruStage.error });
      writeManifest(options, manifest);
      return manifest;
    }
    sourceMarkdownPath = mineruStage.source_markdown_path;
    pushStage(manifest, { id: "mineru_source_markdown", status: "completed", output: mineruStage });
    writeManifest(options, manifest);
  }

  const hasConfiguredSourceMarkdown = Boolean(sourceMarkdownPath.trim());
  if (!existsSync(outlinePath) && !hasConfiguredSourceMarkdown) {
    manifest.status = "blocked";
    pushStage(manifest, {
      id: "ensure_outline",
      status: "blocked",
      error: `Outline not found and no source Markdown/PDF input was available: ${outlinePath}`,
    });
    writeManifest(options, manifest);
    return manifest;
  }

  if (!existsSync(outlinePath) && options.pdfPath) {
    const pdfOutlineStage = await extractPdfOutline({
      bookId: options.bookId,
      pdfPath: options.pdfPath,
      outlinePath,
      repoRoot: REPO_ROOT,
      title: options.bookTitle || options.bookId,
      sourcePath: sourceMarkdownPath || options.pdfPath,
      tocStart: options.outlineStartPage ?? 1,
      tocEnd: options.outlineEndPage ?? 20,
    });
    if (pdfOutlineStage.status === "blocked") {
      manifest.status = "blocked";
      pushStage(manifest, { id: "extract_pdf_outline", status: "blocked", error: pdfOutlineStage.error });
      writeManifest(options, manifest);
      return manifest;
    }
    pushStage(manifest, { id: "extract_pdf_outline", status: "completed", output: pdfOutlineStage });
    writeManifest(options, manifest);
  }

  const sourceStage = prepareSourceMarkdown({
    bookId: options.bookId,
    outlinePath,
    repoRoot: REPO_ROOT,
    sourceMarkdownPath,
  });
  if (sourceStage.status === "blocked") {
    manifest.status = "blocked";
    pushStage(manifest, { id: "prepare_source_markdown", status: "blocked", error: sourceStage.error });
    writeManifest(options, manifest);
    return manifest;
  }
  pushStage(manifest, { id: "prepare_source_markdown", status: "completed", output: sourceStage });
  writeManifest(options, manifest);

  const outlineStage = ensureOutlineFromMarkdown({
    bookId: options.bookId,
    outlinePath,
    repoRoot: REPO_ROOT,
    markdownPath: sourceStage.markdown_path,
    title: options.bookId,
  });
  if (outlineStage.status === "blocked") {
    manifest.status = "blocked";
    pushStage(manifest, { id: "ensure_outline", status: "blocked", error: outlineStage.error });
    writeManifest(options, manifest);
    return manifest;
  }
  pushStage(manifest, { id: "ensure_outline", status: "completed", output: outlineStage });
  writeManifest(options, manifest);

  const chunkStage = ensureChunkedOutline({
    outlinePath,
    repoRoot: REPO_ROOT,
    noChunks: options.noChunks,
  });
  if (chunkStage.status === "blocked") {
    manifest.status = "blocked";
    pushStage(manifest, { id: "prepare_outline_chunks", status: "blocked", error: chunkStage.error });
    writeManifest(options, manifest);
    return manifest;
  }
  pushStage(manifest, {
    id: "prepare_outline_chunks",
    status: chunkStage.status === "completed" ? "completed" : "skipped",
    output: chunkStage,
  });
  writeManifest(options, manifest);

  const plan = planParallelBatches(loadOutlineItems(options.bookId), {
    bookId: options.bookId,
    parallel: options.parallelism,
    noChunks: options.noChunks,
  });
  const extractorCliPath = resolve(CLI_DIR, "extract-lesson-openai.js");
  const commands = planTsModelExtractionCommands(plan.workers, {
    outputRoot: options.outputRoot,
    extractorCliPath,
    datasetId: options.datasetId,
    subject: options.subject,
    schoolStage: options.schoolStage,
    gradeBand: options.gradeBand,
    textbookId: options.textbookId,
    apiMode: options.apiMode,
    model: options.model,
    baseUrl: options.baseUrl,
    reasoningEffort: options.reasoningEffort,
    timeoutSeconds: options.timeoutSeconds,
    vlmApiUrl: options.vlmApiUrl,
    vlmApiKeyEnv: options.vlmApiUrl ? options.vlmApiKeyEnv : undefined,
    vlmCacheDir: options.vlmApiUrl ? options.vlmCacheDir : undefined,
    vlmConcurrency: options.vlmApiUrl ? options.vlmConcurrency : undefined,
    vlmModel: options.vlmApiUrl ? options.vlmModel : undefined,
  }).map((item) => ({
    ...item,
    command: addExtractionExecutionFlags(item.command, options),
  }));
  pushStage(manifest, {
    id: "lesson_plan",
    status: "completed",
    output: {
      total_units: plan.total_units,
      unit_kind: plan.unit_kind,
      parallel: plan.parallel,
      commands: commands.map((item) => item.command),
    },
  });
  writeManifest(options, manifest);

  const lessonStage: ServerPipelineStage = { id: "lesson_staging", status: "running", output: { total_units: commands.length } };
  pushStage(manifest, lessonStage);
  writeManifest(options, manifest);
  const lessonResults = await runExtractionCommands(commands, options.parallelism, options.commandRunner);
  const failed = lessonResults.filter((result) => result.exit_code !== 0);
  lessonStage.status = failed.length > 0 ? "blocked" : "completed";
  lessonStage.output = {
    total_units: commands.length,
    completed: lessonResults.length - failed.length,
    failed: failed.length,
    results: lessonResults,
  };
  if (failed.length > 0) {
    lessonStage.error = `${failed.length} lesson extraction command(s) failed.`;
    manifest.status = "blocked";
    writeManifest(options, manifest);
    return manifest;
  }

  const stagingQualityOk = await runPipelineCommandStage(
    manifest,
    options,
    "staging_quality",
    buildStagingQualityCommand(options),
    "Staging quality command failed.",
  );
  if (!stagingQualityOk) return manifest;

  const canonicalCommand = buildCanonicalMergeCommand(options);
  const canonicalStage: ServerPipelineStage = {
    id: "canonical_commit",
    status: "running",
    output: { command: canonicalCommand },
  };
  pushStage(manifest, canonicalStage);
  writeManifest(options, manifest);
  const canonicalResult = await runCommand(canonicalCommand, options.commandRunner);
  canonicalStage.status = canonicalResult.exitCode === 0 ? "completed" : "blocked";
  canonicalStage.output = {
    command: canonicalCommand,
    exit_code: canonicalResult.exitCode,
    stdout_tail: tail(canonicalResult.stdout),
    stderr_tail: tail(canonicalResult.stderr),
  };
  if (canonicalResult.exitCode !== 0) {
    canonicalStage.error = "Canonical reducer command failed.";
    manifest.status = "blocked";
    writeManifest(options, manifest);
    return manifest;
  }

  const normalizeOk = await runPipelineCommandStage(manifest, options, "normalize", buildNormalizeCommand(options), "Normalize command failed.");
  if (!normalizeOk) return manifest;
  const qaOk = await runPipelineCommandStage(manifest, options, "strict_qa", buildStrictQaCommand(options), "Strict QA command failed.");
  if (!qaOk) return manifest;
  const integrityOk = await runPipelineCommandStage(manifest, options, "graph_integrity", buildGraphIntegrityCommand(options), "Graph integrity command failed.");
  if (!integrityOk) return manifest;

  manifest.status = "completed";
  writeManifest(options, manifest);
  return manifest;
}

function addExtractionExecutionFlags(command: string[], options: RunnerOptions): string[] {
  const result = [...command, "--db", options.dbUrl, "--write-staging"];
  if (options.retrievalContext) {
    result.push("--retrieval-context", "--retrieval-limit", String(options.retrievalLimit));
  }
  return result;
}

function buildCanonicalMergeCommand(options: RunnerOptions): string[] {
  return [
    "node",
    resolve(CLI_DIR, "merge-staged-lessons.js"),
    "--dataset-id",
    options.datasetId,
    "--db",
    options.dbUrl,
    "--book-id",
    options.bookId,
    "--similarity-threshold",
    "0.9",
    "--embedding-threshold",
    "0.92",
    "--review-threshold",
    "0.72",
  ];
}

function buildStagingQualityCommand(options: RunnerOptions): string[] {
  return ["node", resolve(CLI_DIR, "staging-quality.js"), "--dataset-id", options.datasetId, "--db", options.dbUrl, "--book-id", options.bookId];
}

function buildNormalizeCommand(options: RunnerOptions): string[] {
  return ["node", resolve(CLI_DIR, "normalize.js"), "--dataset-id", options.datasetId, "--db", options.dbUrl];
}

function buildStrictQaCommand(options: RunnerOptions): string[] {
  return ["node", resolve(CLI_DIR, "strict-qa.js"), "--dataset-id", options.datasetId, "--db", options.dbUrl];
}

function buildGraphIntegrityCommand(options: RunnerOptions): string[] {
  return [
    "node",
    resolve(CLI_DIR, "graph-integrity.js"),
    "--dataset-id",
    options.datasetId,
    "--db",
    options.dbUrl,
    "--mark-qa-passed",
    "--book-id",
    options.bookId,
  ];
}

async function runPipelineCommandStage(
  manifest: ServerPipelineManifest,
  options: RunnerOptions,
  id: string,
  command: string[],
  errorMessage: string,
): Promise<boolean> {
  const stage: ServerPipelineStage = { id, status: "running", output: { command } };
  pushStage(manifest, stage);
  writeManifest(options, manifest);
  const result = await runCommand(command, options.commandRunner);
  stage.status = result.exitCode === 0 ? "completed" : "blocked";
  stage.output = {
    command,
    exit_code: result.exitCode,
    stdout_tail: tail(result.stdout),
    stderr_tail: tail(result.stderr),
  };
  if (result.exitCode !== 0) {
    stage.error = errorMessage;
    manifest.status = "blocked";
    writeManifest(options, manifest);
    return false;
  }
  writeManifest(options, manifest);
  return true;
}

async function runExtractionCommands(commands: ParallelExtractionCommand[], parallelism: number, commandRunner?: CommandRunner): Promise<Array<Record<string, unknown>>> {
  const results: Array<Record<string, unknown>> = [];
  let nextIndex = 0;
  const workerCount = Math.max(1, Math.min(Math.floor(parallelism), commands.length || 1));
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < commands.length) {
        const current = commands[nextIndex];
        nextIndex += 1;
        if (!current) continue;
        results.push(await runOneExtractionCommand(current, commandRunner));
      }
    }),
  );
  return results.sort((left, right) => Number(left.index) - Number(right.index));
}

async function runOneExtractionCommand(item: ParallelExtractionCommand, commandRunner?: CommandRunner): Promise<Record<string, unknown>> {
  const started = Date.now();
  const output = await runCommand(item.command, commandRunner);
  return {
    index: started,
    worker_slot: item.worker_slot,
    book_id: item.book_id,
    batch_anchor: item.batch_anchor,
    lesson_run_id: item.lesson_run_id,
    command: item.command,
    exit_code: output.exitCode,
    stdout_tail: tail(output.stdout),
    stderr_tail: tail(output.stderr),
  };
}

function runCommand(command: string[], commandRunner?: CommandRunner): Promise<CommandOutput> {
  return commandRunner ? commandRunner(command) : runChildCommand(command);
}

function defaultPostgresChecker(databaseUrl: string): Promise<PostgresReadinessResult> {
  return checkPostgresReady({ databaseUrl, timeoutMs: 2000 });
}

function runChildCommand(command: string[]): Promise<CommandOutput> {
  return new Promise((resolvePromise) => {
    const child = spawn(command[0]!, command.slice(1), {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code) => {
      resolvePromise({ exitCode: code ?? 1, stdout, stderr });
    });
  });
}

function tail(text: string, limit = 4000): string {
  return text.length <= limit ? text : text.slice(text.length - limit);
}

function createManifest(options: RunnerOptions): ServerPipelineManifest {
  return {
    workflow_id: "okm.ts_server_pipeline",
    status: "blocked",
    context: {
      book_id: options.bookId,
      output_root: options.outputRoot,
      dataset_id: options.datasetId,
      parallelism: options.parallelism,
      subject: options.subject,
      school_stage: options.schoolStage,
      grade_band: options.gradeBand,
      vlm_api_url_configured: Boolean(options.vlmApiUrl),
      vlm_concurrency: options.vlmConcurrency,
      vlm_cache_dir: options.vlmCacheDir,
    },
    stages: [],
  };
}

function pushStage(manifest: ServerPipelineManifest, stage: ServerPipelineStage): void {
  manifest.stages.push(stage);
}

function writeManifest(options: RunnerOptions, manifest: ServerPipelineManifest): void {
  const path = manifestPath(options);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

function manifestPath(options: RunnerOptions): string {
  return options.manifestPath ?? resolve(REPO_ROOT, "runs", "pipeline", `${safePathToken(options.bookId)}.okm.ts_server_pipeline.json`);
}

function parseOptions(argv: string[]): RunnerOptions {
  const flags = parseFlags(argv);
  const bookId = required(flags, "book-id");
  const outputRoot = flags.get("output-root") ?? "data/main";
  const datasetId = flags.get("dataset-id") || outputRoot.split(/[\\/]+/).filter(Boolean).at(-1) || "main";
  return {
    bookId,
    outputRoot,
    datasetId,
    dbUrl: required(flags, "db"),
    parallelism: parseInteger(flags.get("parallelism"), 4),
    noChunks: flags.has("no-chunks"),
    pdfPath: flags.get("pdf-path") ?? "",
    sourceMarkdownPath: flags.get("source-markdown-path") ?? "",
    bookTitle: flags.get("book-title") ?? "",
    outlineStartPage: parseInteger(flags.get("outline-start-page"), 1),
    outlineEndPage: parseInteger(flags.get("outline-end-page"), 20),
    mineruFileUrl: flags.get("mineru-file-url") ?? "",
    mineruApiKeyEnv: flags.get("mineru-api-key-env") ?? "MINERU_API_KEY",
    mineruBaseUrl: flags.get("mineru-base-url") ?? "https://mineru.net",
    mineruModelVersion: flags.get("mineru-model-version") ?? "vlm",
    mineruLanguage: flags.get("mineru-language") ?? "ch",
    mineruPageRanges: flags.get("mineru-page-ranges") ?? "",
    mineruTimeoutSeconds: parseInteger(flags.get("mineru-timeout"), 1800),
    mineruForce: flags.has("mineru-force"),
    subject: flags.get("subject") ?? "computer-science",
    schoolStage: flags.get("school-stage") ?? "higher",
    gradeBand: flags.get("grade-band") ?? "university",
    textbookId: flags.get("textbook-id") ?? bookId,
    apiMode: parseApiMode(flags.get("api-mode") ?? "responses"),
    model: flags.get("model") ?? "",
    baseUrl: flags.get("base-url") ?? "",
    timeoutSeconds: parseInteger(flags.get("timeout"), 600),
    reasoningEffort: flags.get("reasoning-effort") ?? "medium",
    vlmApiUrl: flags.get("vlm-api-url") ?? process.env.VLM_API_URL ?? "",
    vlmApiKeyEnv: flags.get("vlm-api-key-env") ?? "VLM_API_KEY",
    vlmCacheDir: flags.get("vlm-cache-dir") ?? process.env.VLM_CACHE_DIR ?? resolve(REPO_ROOT, outputRoot, ".cache", "image-relevance"),
    vlmConcurrency: parseInteger(flags.get("vlm-concurrency") ?? process.env.VLM_CONCURRENCY, 3),
    vlmModel: flags.get("vlm-model") ?? process.env.VLM_MODEL ?? "",
    retrievalContext: parseBoolean(flags.get("retrieval-context"), true),
    retrievalLimit: parseInteger(flags.get("retrieval-limit"), 8),
    manifestPath: flags.get("manifest-path"),
  };
}

function parseFlags(argv: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index]!;
    if (!raw.startsWith("--")) throw new Error(`Unexpected argument '${raw}'.`);
    const withoutPrefix = raw.slice(2);
    const equalsIndex = withoutPrefix.indexOf("=");
    if (equalsIndex >= 0) {
      flags.set(withoutPrefix.slice(0, equalsIndex), withoutPrefix.slice(equalsIndex + 1));
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      flags.set(withoutPrefix, "true");
      continue;
    }
    flags.set(withoutPrefix, next);
    index += 1;
  }
  return flags;
}

function required(flags: Map<string, string>, name: string): string {
  const value = flags.get(name);
  if (value === undefined || value.trim() === "") throw new Error(`Missing required option --${name}.`);
  return value;
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`Invalid positive integer: ${value}`);
  return parsed;
}

function parseApiMode(value: string): "responses" | "chat_completions" {
  if (value === "responses" || value === "openai_responses") return "responses";
  if (value === "chat_completions" || value === "openai_chat_completions") return "chat_completions";
  throw new Error(`Unsupported lesson backend/api mode '${value}'.`);
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

if (import.meta.url === `file://${process.argv[1]}`) {
  raise(main(process.argv.slice(2)));
}

function raise(promise: Promise<number>): void {
  promise.then((code) => {
    process.exitCode = code;
  });
}
