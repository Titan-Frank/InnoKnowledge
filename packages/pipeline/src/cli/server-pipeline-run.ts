#!/usr/bin/env node

import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import postgres from "postgres";

import { planParallelBatches, planTsModelExtractionCommands, type ParallelExtractionCommand } from "../extraction/parallel-batch.js";
import { extractPdfOutline } from "../outline/pdf-outline.js";
import { runMineruSourceMarkdown } from "../outline/mineru-source.js";
import { ensureChunkedOutline, ensureOutlineFromMarkdown, prepareSourceMarkdown } from "../outline/source-preparation.js";
import {
  createPostgresPipelineAssetStore,
  outlineItemsFromRecord,
  type PipelineAssetStore,
} from "../shared/pg-assets.js";
import { REPO_ROOT, outlinePathForBook, readableOutlinePathForBook, safePathToken } from "../shared/pathing.js";
import {
  createPostgresPipelineProgressStore,
  type PipelineProgressStore,
  type PipelineStageStatus,
} from "../shared/pipeline-progress.js";
import { checkPostgresReady, type PostgresReadinessResult } from "../shared/postgres-readiness.js";

type StageStatus = "completed" | "blocked" | "running" | "skipped";

type ServerPipelineStage = {
  id: string;
  status: StageStatus;
  output?: Record<string, unknown>;
  error?: string;
};

type ServerPipelineResult = {
  job_id: string;
  status: "completed" | "blocked";
  context: Record<string, unknown>;
  stages: ServerPipelineStage[];
};

type CommandOutput = { exitCode: number; stdout: string; stderr: string };
type CommandRunner = (command: string[]) => Promise<CommandOutput>;
type PostgresChecker = (databaseUrl: string) => Promise<PostgresReadinessResult>;
type DatasetInitializer = (input: { dbUrl: string; datasetId: string; outputRoot: string }) => Promise<void>;
type StagingQualityOutput = {
  status?: unknown;
  checked?: unknown;
  blocked?: unknown;
  results?: unknown;
};

type RunnerOptions = {
  jobId?: string;
  logPath?: string;
  bookId: string;
  outputRoot: string;
  datasetId: string;
  dbUrl: string;
  parallelism: number;
  noChunks: boolean;
  pdfPath: string;
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
  extractionTemplate?: string;
  modelRetryCount: number;
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
  enrichContext?: boolean;
  enrichContextLimit?: number;
  qualityRetryCount: number;
  skipNodeBodies?: boolean;
  nodeBodyConcurrency?: number;
  nodeBodyLimit?: number;
  nodeBodyMaxEvidence?: number;
  overwriteNodeBodies?: boolean;
  skipPedagogicalProfiles?: boolean;
  pedagogicalProfileConcurrency?: number;
  pedagogicalProfileLimit?: number;
  pedagogicalProfileMaxEvidence?: number;
  overwriteGeneratedPedagogicalProfiles?: boolean;
  skipEmbeddings?: boolean;
  nodeEmbeddingBatchSize?: number;
  unitEmbeddingBatchSize?: number;
  progressStore?: PipelineProgressStore;
  assetStore?: PipelineAssetStore;
  commandRunner?: CommandRunner;
  postgresChecker?: PostgresChecker;
  datasetInitializer?: DatasetInitializer;
};

type RawRecord = Record<string, unknown>;

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

export async function runServerPipeline(options: RunnerOptions): Promise<ServerPipelineResult> {
  const result = createRunResult(options);

  const postgresStage = await (options.postgresChecker ?? defaultPostgresChecker)(options.dbUrl);
  if (postgresStage.status === "blocked") {
    const stage = { id: "check_postgres", status: "blocked" as const, error: postgresStage.issues.join("; ") };
    result.status = "blocked";
    result.stages.push(stage);
    return result;
  }

  await (options.datasetInitializer ?? defaultDatasetInitializer)({
    dbUrl: options.dbUrl,
    datasetId: options.datasetId,
    outputRoot: options.outputRoot,
  });

  const progressStore = options.progressStore ?? createPostgresPipelineProgressStore(options.dbUrl);
  const assetStore = options.assetStore ?? createPostgresPipelineAssetStore(options.dbUrl);
  try {
    await progressStore.startJob({
      datasetId: options.datasetId,
      jobId: result.job_id,
      bookId: options.bookId,
      logPath: options.logPath,
      context: result.context,
    });
    await recordStage(result, progressStore, { id: "check_postgres", status: "completed", output: postgresStage });

    const outlinePath = outlinePathForBook(options.bookId);
    let outlineRecord = await assetStore.loadOutline({ datasetId: options.datasetId, bookId: options.bookId });
    if (outlineRecord) {
      materializeOutlineFromPg(outlinePath, outlineRecord);
    }
    let sourceMarkdownPath = "";
    if (outlineRecord) sourceMarkdownPath = stringValue(outlineRecord.source_path);
    const mineruFileUrl = options.mineruFileUrl ?? "";
    const shouldRunMineru = (options.mineruForce || !outlineRecord) && Boolean(options.pdfPath || mineruFileUrl);
    if (shouldRunMineru) {
      await recordStage(result, progressStore, { id: "mineru_source_markdown", status: "running" });
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
        return await blockRun(result, progressStore, "mineru_source_markdown", mineruStage.error);
      }
      sourceMarkdownPath = mineruStage.source_markdown_path;
      await assetStore.upsertMineruSource({
        datasetId: options.datasetId,
        record: {
          bookId: options.bookId,
          status: "success",
          sourceMarkdownPath: relativeRepoPath(sourceMarkdownPath),
          batchId: mineruStage.batch_id,
          zipUrl: mineruStage.zip_url,
          zipPath: relativeRepoPath(mineruStage.zip_path),
          extractDir: relativeRepoPath(mineruStage.extract_dir),
          rawMarkdownPath: relativeRepoPath(mineruStage.raw_markdown_path),
          createdByMineru: mineruStage.created,
        },
      });
      await recordStage(result, progressStore, { id: "mineru_source_markdown", status: "completed", output: mineruStage });
    }

    if (!existsSync(outlinePath) && !sourceMarkdownPath.trim()) {
      const sampleOutlinePath = readableOutlinePathForBook(options.bookId);
      if (sampleOutlinePath !== outlinePath && existsSync(sampleOutlinePath)) {
        materializeOutlineFromSample(outlinePath, sampleOutlinePath);
        outlineRecord = await syncOutlineFromFile(assetStore, options, outlinePath);
        if (outlineRecord) sourceMarkdownPath = stringValue(outlineRecord.source_path);
      }
    }

    if (!existsSync(outlinePath) && !sourceMarkdownPath.trim()) {
      return await blockRun(
        result,
        progressStore,
        "ensure_outline",
        `Outline not found and no source Markdown/PDF input was available: ${outlinePath}`,
      );
    }

    if (!existsSync(outlinePath) && options.pdfPath) {
      await recordStage(result, progressStore, { id: "extract_pdf_outline", status: "running" });
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
        return await blockRun(result, progressStore, "extract_pdf_outline", pdfOutlineStage.error);
      }
      outlineRecord = await syncOutlineFromFile(assetStore, options, outlinePath);
      await recordStage(result, progressStore, { id: "extract_pdf_outline", status: "completed", output: pdfOutlineStage });
    }

    await recordStage(result, progressStore, { id: "prepare_source_markdown", status: "running" });
    const sourceStage = prepareSourceMarkdown({
      bookId: options.bookId,
      outlinePath,
      repoRoot: REPO_ROOT,
      sourceMarkdownPath,
    });
    if (sourceStage.status === "blocked") {
      return await blockRun(result, progressStore, "prepare_source_markdown", sourceStage.error);
    }
    await recordStage(result, progressStore, { id: "prepare_source_markdown", status: "completed", output: sourceStage });

    await recordStage(result, progressStore, { id: "ensure_outline", status: "running" });
    const outlineStage = ensureOutlineFromMarkdown({
      bookId: options.bookId,
      outlinePath,
      repoRoot: REPO_ROOT,
      markdownPath: sourceStage.markdown_path,
      title: options.bookId,
    });
    if (outlineStage.status === "blocked") {
      return await blockRun(result, progressStore, "ensure_outline", outlineStage.error);
    }
    outlineRecord = await syncOutlineFromFile(assetStore, options, outlinePath);
    await recordStage(result, progressStore, { id: "ensure_outline", status: "completed", output: outlineStage });

    await recordStage(result, progressStore, { id: "prepare_outline_chunks", status: "running" });
    const chunkStage = ensureChunkedOutline({
      outlinePath,
      repoRoot: REPO_ROOT,
      noChunks: options.noChunks,
    });
    if (chunkStage.status === "blocked") {
      return await blockRun(result, progressStore, "prepare_outline_chunks", chunkStage.error);
    }
    outlineRecord = await syncOutlineFromFile(assetStore, options, outlinePath);
    await recordStage(result, progressStore, {
      id: "prepare_outline_chunks",
      status: chunkStage.status === "completed" ? "completed" : "skipped",
      output: chunkStage,
    });

    const outlineItems = outlineItemsFromRecord(outlineRecord);
    if (outlineItems.length === 0) {
      return await blockRun(result, progressStore, "lesson_plan", `Outline has no extractable items for book '${options.bookId}'.`);
    }
    const plan = planParallelBatches(outlineItems, {
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
      bookTitle: options.bookTitle,
      textbookId: options.textbookId,
      apiMode: options.apiMode,
      extractionTemplate: options.extractionTemplate ?? "auto",
      modelRetryCount: options.modelRetryCount,
      model: options.model,
      baseUrl: options.baseUrl,
      reasoningEffort: options.reasoningEffort,
      timeoutSeconds: options.timeoutSeconds,
      vlmApiUrl: options.vlmApiUrl,
      vlmApiKeyEnv: options.vlmApiUrl ? options.vlmApiKeyEnv : undefined,
      vlmCacheDir: options.vlmApiUrl ? options.vlmCacheDir : undefined,
      vlmConcurrency: options.vlmApiUrl ? options.vlmConcurrency : undefined,
      vlmModel: options.vlmApiUrl ? options.vlmModel : undefined,
      enrichContext: options.enrichContext ?? true,
      enrichContextLimit: options.enrichContextLimit ?? 6,
    }).map((item) => ({
      ...item,
      command: addExtractionExecutionFlags(item.command, options),
    }));
    await recordStage(result, progressStore, {
      id: "lesson_plan",
      status: "completed",
      output: {
        total_units: plan.total_units,
        unit_kind: plan.unit_kind,
        parallel: plan.parallel,
        commands: commands.map((item) => item.command),
      },
    });

    const lessonStage: ServerPipelineStage = { id: "lesson_staging", status: "running", output: lessonProgress(commands.length, 0, 0, [], []) };
    await recordStage(result, progressStore, lessonStage);
    const lessonResults = await runExtractionCommands(commands, options.parallelism, {
      commandRunner: options.commandRunner,
      progressStore,
      result,
      stage: lessonStage,
    });
    const failed = lessonResults.filter((lessonResult) => lessonResult.exit_code !== 0);
    lessonStage.status = failed.length > 0 ? "blocked" : "completed";
    lessonStage.output = {
      ...lessonProgress(commands.length, lessonResults.length - failed.length, failed.length, [], compactLessonResults(lessonResults).slice(-12)),
      results: compactLessonResults(lessonResults),
    };
    if (failed.length > 0) {
      lessonStage.error = `${failed.length} lesson extraction command(s) failed.`;
      await recordStage(result, progressStore, lessonStage);
      await progressStore.updateJob({
        datasetId: options.datasetId,
        jobId: result.job_id,
        status: "blocked",
        currentStageId: lessonStage.id,
        progress: sanitizeStageOutput(lessonStage),
        error: lessonStage.error,
        completed: true,
      });
      result.status = "blocked";
      return result;
    }
    await recordStage(result, progressStore, lessonStage);

    const stagingQualityOk = await runStagingQualityWithRetries(result, progressStore, options, commands);
    if (!stagingQualityOk) return result;

    const canonicalCommand = buildCanonicalMergeCommand(options);
    const canonicalStage: ServerPipelineStage = {
      id: "canonical_commit",
      status: "running",
      output: { command: canonicalCommand },
    };
    await recordStage(result, progressStore, canonicalStage);
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
      await recordStage(result, progressStore, canonicalStage);
      await progressStore.updateJob({
        datasetId: options.datasetId,
        jobId: result.job_id,
        status: "blocked",
        currentStageId: canonicalStage.id,
        progress: sanitizeStageOutput(canonicalStage),
        error: canonicalStage.error,
        completed: true,
      });
      result.status = "blocked";
      return result;
    }
    await recordStage(result, progressStore, canonicalStage);

    const normalizeOk = await runPipelineCommandStage(result, progressStore, options, "normalize", buildNormalizeCommand(options), "Normalize command failed.");
    if (!normalizeOk) return result;
    if (!options.skipNodeBodies) {
      const nodeBodiesOk = await runPipelineCommandStage(
        result,
        progressStore,
        options,
        "node_bodies",
        buildNodeBodiesCommand(options),
        "Node body generation command failed.",
      );
      if (!nodeBodiesOk) return result;
    }
    if (!options.skipPedagogicalProfiles) {
      const pedagogicalProfilesOk = await runPipelineCommandStage(
        result,
        progressStore,
        options,
        "pedagogical_profiles",
        buildPedagogicalProfilesCommand(options),
        "Pedagogical profile generation command failed.",
      );
      if (!pedagogicalProfilesOk) return result;
    }
    if (!options.skipEmbeddings) {
      const nodeEmbeddingsOk = await runPipelineCommandStage(
        result,
        progressStore,
        options,
        "node_embeddings",
        buildNodeEmbeddingsCommand(options),
        "Node embedding backfill command failed.",
      );
      if (!nodeEmbeddingsOk) return result;

      const unitEmbeddingsOk = await runPipelineCommandStage(
        result,
        progressStore,
        options,
        "unit_embeddings",
        buildUnitEmbeddingsCommand(options),
        "Unit embedding backfill command failed.",
      );
      if (!unitEmbeddingsOk) return result;
    }
    const qaOk = await runPipelineCommandStage(result, progressStore, options, "strict_qa", buildStrictQaCommand(options), "Strict QA command failed.");
    if (!qaOk) return result;
    const integrityOk = await runPipelineCommandStage(result, progressStore, options, "graph_integrity", buildGraphIntegrityCommand(options), "Graph integrity command failed.");
    if (!integrityOk) return result;
    const qualityDashboardOk = await runPipelineCommandStage(result, progressStore, options, "quality_dashboard", buildQualityDashboardCommand(options), "Quality dashboard command failed.");
    if (!qualityDashboardOk) return result;

    result.status = "completed";
    await progressStore.updateJob({
      datasetId: options.datasetId,
      jobId: result.job_id,
      status: "completed",
      currentStageId: "quality_dashboard",
      progress: { completed_stages: result.stages.length },
      completed: true,
    });
    return result;
  } finally {
    await assetStore.close();
    await progressStore.close();
  }
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

async function runStagingQualityWithRetries(
  result: ServerPipelineResult,
  progressStore: PipelineProgressStore,
  options: RunnerOptions,
  commands: ParallelExtractionCommand[],
): Promise<boolean> {
  const attempts: Record<string, unknown>[] = [];
  for (let retryIndex = 0; retryIndex <= options.qualityRetryCount; retryIndex += 1) {
    const attempt = await runStagingQualityAttempt(result, progressStore, options, attempts);
    if (attempt.ok) return true;

    const retryCommands = retryCommandsForBlockedLessons(commands, attempt.parsed, retryIndex + 1, options);
    const canRetry = retryIndex < options.qualityRetryCount && retryCommands.length > 0;
    if (!canRetry) {
      const error = "Staging quality command failed.";
      const stage: ServerPipelineStage = {
        id: "staging_quality",
        status: "blocked",
        error,
        output: { ...attempt.stageOutput, attempts },
      };
      await recordStage(result, progressStore, stage);
      await progressStore.updateJob({
        datasetId: options.datasetId,
        jobId: result.job_id,
        status: "blocked",
        currentStageId: stage.id,
        progress: sanitizeStageOutput(stage),
        error,
        completed: true,
      });
      result.status = "blocked";
      return false;
    }

    attempts.push({
      retry: retryIndex + 1,
      blocked_lesson_runs: retryCommands.map((command) => command.lesson_run_id),
      blocked_batch_anchors: retryCommands.map((command) => command.batch_anchor),
    });
    await recordStage(result, progressStore, {
      id: "staging_quality",
      status: "completed",
      output: { ...attempt.stageOutput, retrying: true, attempts },
    });

    const retryStage: ServerPipelineStage = {
      id: `lesson_staging_retry_${retryIndex + 1}`,
      status: "running",
      output: lessonProgress(retryCommands.length, 0, 0, [], []),
    };
    await recordStage(result, progressStore, retryStage);
    const retryResults = await runExtractionCommands(retryCommands, options.parallelism, {
      commandRunner: options.commandRunner,
      progressStore,
      result,
      stage: retryStage,
    });
    const failed = retryResults.filter((lessonResult) => lessonResult.exit_code !== 0);
    retryStage.status = failed.length > 0 ? "blocked" : "completed";
    retryStage.output = {
      ...lessonProgress(retryCommands.length, retryResults.length - failed.length, failed.length, [], compactLessonResults(retryResults).slice(-12)),
      results: compactLessonResults(retryResults),
    };
    if (failed.length > 0) {
      retryStage.error = `${failed.length} retry extraction command(s) failed.`;
      await recordStage(result, progressStore, retryStage);
      await progressStore.updateJob({
        datasetId: options.datasetId,
        jobId: result.job_id,
        status: "blocked",
        currentStageId: retryStage.id,
        progress: sanitizeStageOutput(retryStage),
        error: retryStage.error,
        completed: true,
      });
      result.status = "blocked";
      return false;
    }
    await recordStage(result, progressStore, retryStage);
  }
  return false;
}

async function runStagingQualityAttempt(
  result: ServerPipelineResult,
  progressStore: PipelineProgressStore,
  options: RunnerOptions,
  previousAttempts: Record<string, unknown>[],
): Promise<{
  ok: boolean;
  parsed: StagingQualityOutput | null;
  stageOutput: Record<string, unknown>;
}> {
  const command = buildStagingQualityCommand(options);
  const runningStage: ServerPipelineStage = {
    id: "staging_quality",
    status: "running",
    output: { command, attempts: previousAttempts },
  };
  await recordStage(result, progressStore, runningStage);
  const commandResult = await runCommand(command, options.commandRunner);
  const parsed = parseStagingQualityOutput(commandResult.stdout);
  const blockedLessonIds = extractBlockedLessonRunIds(parsed);
  const stageOutput = {
    command,
    exit_code: commandResult.exitCode,
    stdout_tail: tail(commandResult.stdout),
    stderr_tail: tail(commandResult.stderr),
    checked: numberValue(parsed?.checked),
    blocked: numberValue(parsed?.blocked) ?? blockedLessonIds.length,
    blocked_lesson_run_ids: blockedLessonIds,
  };
  if (commandResult.exitCode === 0) {
    await recordStage(result, progressStore, {
      id: "staging_quality",
      status: "completed",
      output: { ...stageOutput, attempts: previousAttempts },
    });
    return { ok: true, parsed, stageOutput };
  }
  return { ok: false, parsed, stageOutput };
}

function retryCommandsForBlockedLessons(
  commands: ParallelExtractionCommand[],
  parsed: StagingQualityOutput | null,
  retryNumber: number,
  options: RunnerOptions,
): ParallelExtractionCommand[] {
  const byLessonRunId = new Map(commands.map((command) => [command.lesson_run_id, command]));
  return extractBlockedLessonResults(parsed)
    .map((qualityResult, index) => {
      const lessonRunId = stringValue(qualityResult.lesson_run_id);
      const command = byLessonRunId.get(lessonRunId);
      if (!command) return null;
      return {
        ...command,
        worker_slot: index,
        command: appendRetryPrompt(command.command, buildStagingQualityRetryPrompt(qualityResult, retryNumber, options)),
      };
    })
    .filter((command): command is ParallelExtractionCommand => command !== null);
}

function appendRetryPrompt(command: string[], prompt: string): string[] {
  return [...command, "--prompt", prompt];
}

function buildStagingQualityRetryPrompt(result: RawRecord, retryNumber: number, options: RunnerOptions): string {
  const errors = Array.isArray(result.errors) ? result.errors.map(stringValue).filter(Boolean) : [];
  const issueText = errors.length > 0 ? errors.slice(0, 8).join("；") : "质量检查未通过。";
  const subjectContext = buildRetrySubjectContext(options);
  return [
    `这是第 ${retryNumber} 次质量失败后的自动重抽。`,
    `上一轮问题：${issueText}`,
    `请重新核对当前 chunk 是否包含与${subjectContext}对应、且有直接教材证据支撑的知识对象。`,
    "第一阶段只按当前 schema 返回 lesson_disposition、no_knowledge_reason、nodes、evidence_units 和 issues；不要要求或输出当前阶段不支持的画像、提及或卡片字段。",
    "如果存在合格知识对象，lesson_disposition 设为 extracted，并让每个节点通过 evidence_units.node_ids 绑定自己的证据；如果确实没有合格知识对象，lesson_disposition 设为 no_knowledge，所有知识产物保持为空，并明确填写 no_knowledge_reason。",
    "第二阶段只为第一阶段的节点抽取证据充分的关系；证据不足时允许关系为空，不要为了通过检查而制造节点或关系。",
  ].join("\n");
}

function buildRetrySubjectContext(options: RunnerOptions): string {
  const parts = [
    options.subject ? `学科 ${options.subject}` : "",
    options.schoolStage ? `学段 ${options.schoolStage}` : "",
    options.gradeBand ? `年级段 ${options.gradeBand}` : "",
    options.bookTitle ? `教材《${options.bookTitle}》` : "",
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" / ") : "当前教材";
}

function parseStagingQualityOutput(stdout: string): StagingQualityOutput | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace < 0 || lastBrace <= firstBrace) return null;
    try {
      const parsed = JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as unknown;
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

function extractBlockedLessonRunIds(output: StagingQualityOutput | null): string[] {
  return extractBlockedLessonResults(output).map((result) => stringValue(result.lesson_run_id)).filter(Boolean);
}

function extractBlockedLessonResults(output: StagingQualityOutput | null): RawRecord[] {
  const results = Array.isArray(output?.results) ? output.results : [];
  return results.filter((result): result is RawRecord => isRecord(result) && result.status === "blocked" && Boolean(stringValue(result.lesson_run_id)));
}

function buildNormalizeCommand(options: RunnerOptions): string[] {
  return ["node", resolve(CLI_DIR, "normalize.js"), "--dataset-id", options.datasetId, "--db", options.dbUrl];
}

function buildNodeBodiesCommand(options: RunnerOptions): string[] {
  const command = [
    "node",
    resolve(CLI_DIR, "generate-node-bodies.js"),
    "--dataset-id",
    options.datasetId,
    "--db",
    options.dbUrl,
    "--book-id",
    options.bookId,
    "--pretty",
  ];
  command.push("--api-mode", options.apiMode);
  if (options.model) command.push("--model", options.model);
  if (options.baseUrl) command.push("--base-url", options.baseUrl);
  if (options.reasoningEffort) command.push("--reasoning-effort", options.reasoningEffort);
  command.push("--timeout", String(options.timeoutSeconds));
  command.push("--max-evidence", String(options.nodeBodyMaxEvidence ?? 8));
  command.push("--concurrency", String(options.nodeBodyConcurrency ?? options.parallelism));
  command.push("--model-retry-count", String(options.modelRetryCount));
  if (options.nodeBodyLimit && options.nodeBodyLimit > 0) command.push("--limit", String(options.nodeBodyLimit));
  if (options.overwriteNodeBodies) command.push("--overwrite-existing");
  return command;
}

function buildPedagogicalProfilesCommand(options: RunnerOptions): string[] {
  const command = [
    "node",
    resolve(CLI_DIR, "generate-pedagogical-profiles.js"),
    "--dataset-id",
    options.datasetId,
    "--db",
    options.dbUrl,
    "--book-id",
    options.bookId,
    "--school-stage",
    options.schoolStage,
    "--pretty",
    "--api-mode",
    options.apiMode,
  ];
  if (options.model) command.push("--model", options.model);
  if (options.gradeBand) command.push("--grade-band", options.gradeBand);
  if (options.baseUrl) command.push("--base-url", options.baseUrl);
  if (options.reasoningEffort) command.push("--reasoning-effort", options.reasoningEffort);
  command.push("--timeout", String(options.timeoutSeconds));
  command.push("--max-evidence", String(options.pedagogicalProfileMaxEvidence ?? 8));
  command.push("--concurrency", String(options.pedagogicalProfileConcurrency ?? options.parallelism));
  command.push("--model-retry-count", String(options.modelRetryCount));
  if (options.pedagogicalProfileLimit && options.pedagogicalProfileLimit > 0) {
    command.push("--limit", String(options.pedagogicalProfileLimit));
  }
  if (options.overwriteGeneratedPedagogicalProfiles) command.push("--overwrite-generated");
  return command;
}

function buildNodeEmbeddingsCommand(options: RunnerOptions): string[] {
  return [
    "node",
    resolve(CLI_DIR, "backfill-embeddings.js"),
    "--dataset-id",
    options.datasetId,
    "--db",
    options.dbUrl,
    "--table",
    "world_nodes",
    "--batch-size",
    String(options.nodeEmbeddingBatchSize ?? 8),
    "--sleep-between-batches-ms",
    "200",
  ];
}

function buildUnitEmbeddingsCommand(options: RunnerOptions): string[] {
  return [
    "node",
    resolve(CLI_DIR, "backfill-unit-embeddings.js"),
    "--dataset-id",
    options.datasetId,
    "--db",
    options.dbUrl,
    "--batch-size",
    String(options.unitEmbeddingBatchSize ?? 8),
  ];
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

function buildQualityDashboardCommand(options: RunnerOptions): string[] {
  return [
    "node",
    resolve(CLI_DIR, "quality-dashboard.js"),
    "--dataset-id",
    options.datasetId,
    "--db",
    options.dbUrl,
  ];
}

async function runPipelineCommandStage(
  result: ServerPipelineResult,
  progressStore: PipelineProgressStore,
  options: RunnerOptions,
  id: string,
  command: string[],
  errorMessage: string,
): Promise<boolean> {
  const stage: ServerPipelineStage = { id, status: "running", output: { command } };
  await recordStage(result, progressStore, stage);
  const commandResult = await runCommand(command, options.commandRunner);
  const outputFailure = commandResult.exitCode === 0 ? stageFailureFromOutput(id, commandResult.stdout) : null;
  stage.status = commandResult.exitCode === 0 && !outputFailure ? "completed" : "blocked";
  stage.output = {
    command,
    exit_code: commandResult.exitCode,
    stdout_tail: tail(commandResult.stdout),
    stderr_tail: tail(commandResult.stderr),
  };
  if (stage.status === "blocked") {
    stage.error = outputFailure ?? errorMessage;
    await recordStage(result, progressStore, stage);
    result.status = "blocked";
    await progressStore.updateJob({
      datasetId: options.datasetId,
      jobId: result.job_id,
      status: "blocked",
      currentStageId: id,
      progress: sanitizeStageOutput(stage),
      error: stage.error,
      completed: true,
    });
    return false;
  }
  await recordStage(result, progressStore, stage);
  return true;
}

function stageFailureFromOutput(stageId: string, stdout: string): string | null {
  const output = parseJsonObjectFromOutput(stdout);
  if (!output) return null;
  if (stageId === "node_bodies") {
    const failed = numberValue(output.failed_model_generation) ?? 0;
    if (failed > 0) return `${failed} node body generation request(s) failed.`;
  }
  if (stageId === "pedagogical_profiles") {
    const failed = numberValue(output.failed_model_generation) ?? 0;
    if (failed > 0) return `${failed} pedagogical profile generation request(s) failed.`;
    const missing = (numberValue(output.skipped_missing_stage) ?? 0)
      + (numberValue(output.skipped_missing_context) ?? 0)
      + (numberValue(output.skipped_missing_evidence) ?? 0);
    if (missing > 0) return `${missing} pedagogical profile context(s) were missing stage, node, or evidence data.`;
  }
  if (stageId === "node_embeddings") {
    const selected = numberValue(output.selected) ?? 0;
    const updated = numberValue(output.updated) ?? 0;
    if (selected > 0 && updated < selected) {
      return `Node embedding backfill updated ${updated}/${selected} selected node(s).`;
    }
  }
  if (stageId === "unit_embeddings") {
    const pending = numberValue(output.pending) ?? 0;
    const updated = numberValue(output.updated) ?? 0;
    if (pending > 0 && updated < pending) {
      return `Unit embedding backfill updated ${updated}/${pending} pending unit(s).`;
    }
  }
  return null;
}

function parseJsonObjectFromOutput(stdout: string): RawRecord | null {
  const trimmed = stdout.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    return isRecord(parsed) ? parsed : null;
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");
    if (firstBrace < 0 || lastBrace <= firstBrace) return null;
    try {
      const parsed = JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as unknown;
      return isRecord(parsed) ? parsed : null;
    } catch {
      return null;
    }
  }
}

async function runExtractionCommands(
  commands: ParallelExtractionCommand[],
  parallelism: number,
  input: {
    commandRunner?: CommandRunner;
    progressStore: PipelineProgressStore;
    result: ServerPipelineResult;
    stage: ServerPipelineStage;
  },
): Promise<Array<Record<string, unknown>>> {
  const results: Array<Record<string, unknown>> = [];
  const running = new Map<number, Record<string, unknown>>();
  const recentCompleted: Record<string, unknown>[] = [];
  let nextIndex = 0;
  let completed = 0;
  let failed = 0;
  let writeQueue = Promise.resolve();
  const workerCount = Math.max(1, Math.min(Math.floor(parallelism), commands.length || 1));
  const datasetId = String(input.result.context.dataset_id);

  const queueProgressWrite = (event?: () => Promise<void>) => {
    writeQueue = writeQueue
      .then(async () => {
        if (event) await event();
        input.stage.output = lessonProgress(commands.length, completed, failed, [...running.values()], recentCompleted.slice(-12));
        await recordStage(input.result, input.progressStore, input.stage);
      })
      .catch(() => undefined);
    return writeQueue;
  };

  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (nextIndex < commands.length) {
        const current = commands[nextIndex];
        nextIndex += 1;
        if (!current) continue;
        const started = Date.now();
        running.set(current.worker_slot, lessonRuntimeItem(current));
        await queueProgressWrite(async () => {
          await input.progressStore.setWorkerState({
            datasetId,
            jobId: input.result.job_id,
            worker: {
              workerSlot: current.worker_slot,
              stageId: input.stage.id,
              status: "running",
              lessonRunId: current.lesson_run_id,
              batchAnchor: current.batch_anchor,
            },
          });
          await input.progressStore.addEvent({
            datasetId,
            jobId: input.result.job_id,
            event: {
              stageId: input.stage.id,
              eventType: "lesson_started",
              status: "running",
              workerSlot: current.worker_slot,
              lessonRunId: current.lesson_run_id,
              batchAnchor: current.batch_anchor,
            },
          });
        });

        const result = await runOneExtractionCommand(current, started, input.commandRunner);
        results.push(result);
        running.delete(current.worker_slot);
        if (result.exit_code === 0) completed += 1;
        else failed += 1;
        recentCompleted.push(compactLessonResult(result));
        await queueProgressWrite(async () => {
          await input.progressStore.setWorkerState({
            datasetId,
            jobId: input.result.job_id,
            worker: {
              workerSlot: current.worker_slot,
              stageId: input.stage.id,
              status: result.exit_code === 0 ? "completed" : "failed",
              lessonRunId: current.lesson_run_id,
              batchAnchor: current.batch_anchor,
              error: result.exit_code === 0 ? undefined : String(result.stderr_tail || result.stdout_tail || "Lesson extraction command failed."),
              data: compactLessonResult(result),
            },
          });
          await input.progressStore.addEvent({
            datasetId,
            jobId: input.result.job_id,
            event: {
              stageId: input.stage.id,
              eventType: result.exit_code === 0 ? "lesson_completed" : "lesson_failed",
              status: result.exit_code === 0 ? "completed" : "failed",
              workerSlot: current.worker_slot,
              lessonRunId: current.lesson_run_id,
              batchAnchor: current.batch_anchor,
              data: compactLessonResult(result),
            },
          });
        });
      }
    }),
  );
  await writeQueue;
  return results.sort((left, right) => Number(left.index) - Number(right.index));
}

async function runOneExtractionCommand(item: ParallelExtractionCommand, started: number, commandRunner?: CommandRunner): Promise<Record<string, unknown>> {
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
  return checkPostgresReady({ databaseUrl, timeoutMs: 2000, requireQuery: true });
}

async function defaultDatasetInitializer(input: { dbUrl: string; datasetId: string; outputRoot: string }): Promise<void> {
  const sql = postgres(input.dbUrl, { max: 1 });
  const now = new Date().toISOString();
  const rootPath = relativeRepoPath(resolve(REPO_ROOT, input.outputRoot)) ?? null;
  try {
    await sql`
      INSERT INTO world_datasets (
        dataset_id, dataset_name, schema_version, status, is_active, root_path, created_at, updated_at, notes
      )
      VALUES (
        ${input.datasetId},
        ${input.datasetId},
        'world-v1.2',
        'active',
        0,
        ${rootPath},
        ${now},
        ${now},
        NULL
      )
      ON CONFLICT (dataset_id) DO UPDATE SET
        root_path = COALESCE(world_datasets.root_path, EXCLUDED.root_path),
        updated_at = EXCLUDED.updated_at
    `;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function syncOutlineFromFile(
  assetStore: PipelineAssetStore,
  options: RunnerOptions,
  outlinePath: string,
): Promise<RawRecord | null> {
  if (!existsSync(outlinePath)) return null;
  const outline = readJsonRecord(outlinePath);
  await assetStore.upsertOutline({
    datasetId: options.datasetId,
    record: {
      bookId: options.bookId,
      title: stringValue(outline.title) || stringValue(outline.book_title) || options.bookTitle || options.bookId,
      sourcePath: relativeRepoPath(stringValue(outline.source_path)),
      outlinePath: relativeRepoPath(outlinePath),
      outline,
    },
  });
  return outline;
}

function materializeOutlineFromPg(outlinePath: string, outline: RawRecord): void {
  mkdirSync(dirname(outlinePath), { recursive: true });
  const body = `${JSON.stringify(outline, null, 2)}\n`;
  if (!existsSync(outlinePath) || readFileSync(outlinePath, "utf8") !== body) {
    writeFileSync(outlinePath, body, "utf8");
  }
}

function materializeOutlineFromSample(outlinePath: string, sampleOutlinePath: string): void {
  mkdirSync(dirname(outlinePath), { recursive: true });
  copyFileSync(sampleOutlinePath, outlinePath);
}

function readJsonRecord(path: string): RawRecord {
  const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`Expected outline JSON object: ${path}`);
  }
  return value as RawRecord;
}

function relativeRepoPath(value: string | undefined): string | undefined {
  if (!value) return undefined;
  if (/^https?:\/\//i.test(value)) return value;
  const resolved = isAbsolute(value) ? resolve(value) : resolve(REPO_ROOT, value);
  const relativePath = relative(REPO_ROOT, resolved).split(/[\\/]+/).join("/");
  return relativePath.startsWith("../") ? resolved : relativePath;
}

function stringValue(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function numberValue(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isRecord(value: unknown): value is RawRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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

function createRunResult(options: RunnerOptions): ServerPipelineResult {
  return {
    job_id: options.jobId ?? `${safePathToken(options.bookId)}.${Date.now()}`,
    status: "blocked",
    context: {
      book_id: options.bookId,
      output_root: options.outputRoot,
      dataset_id: options.datasetId,
      parallelism: options.parallelism,
      subject: options.subject,
      school_stage: options.schoolStage,
      grade_band: options.gradeBand,
      extraction_template: options.extractionTemplate ?? "auto",
      model_retry_count: options.modelRetryCount,
      vlm_api_url_configured: Boolean(options.vlmApiUrl),
      vlm_concurrency: options.vlmConcurrency,
      vlm_cache_dir: options.vlmCacheDir,
      quality_retry_count: options.qualityRetryCount,
    },
    stages: [],
  };
}

async function recordStage(result: ServerPipelineResult, progressStore: PipelineProgressStore, stage: ServerPipelineStage): Promise<void> {
  const existingIndex = result.stages.findIndex((item) => item.id === stage.id);
  if (existingIndex >= 0) result.stages[existingIndex] = stage;
  else result.stages.push(stage);
  await progressStore.upsertStage({
    datasetId: String(result.context.dataset_id),
    jobId: result.job_id,
    stage: {
      stageId: stage.id,
      status: toProgressStageStatus(stage.status),
      sortOrder: stageSortOrder(stage.id, result.stages.length),
      label: stageLabel(stage.id),
      progress: sanitizeStageOutput(stage),
      error: stage.error,
    },
  });
  await progressStore.updateJob({
    datasetId: String(result.context.dataset_id),
    jobId: result.job_id,
    status: stage.status === "blocked" ? "blocked" : "running",
    currentStageId: stage.id,
    progress: sanitizeStageOutput(stage),
    error: stage.status === "blocked" ? stage.error ?? null : null,
    completed: false,
  });
}

async function blockRun(
  result: ServerPipelineResult,
  progressStore: PipelineProgressStore,
  stageId: string,
  error: string,
): Promise<ServerPipelineResult> {
  const stage: ServerPipelineStage = { id: stageId, status: "blocked", error };
  await recordStage(result, progressStore, stage);
  result.status = "blocked";
  await progressStore.updateJob({
    datasetId: String(result.context.dataset_id),
    jobId: result.job_id,
    status: "blocked",
    currentStageId: stageId,
    progress: sanitizeStageOutput(stage),
    error,
    completed: true,
  });
  return result;
}

function toProgressStageStatus(status: StageStatus): PipelineStageStatus {
  return status;
}

function stageSortOrder(stageId: string, fallback: number): number {
  if (stageId.startsWith("lesson_staging_retry_")) return 9;
  const index = [
    "check_postgres",
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
    "node_bodies",
    "pedagogical_profiles",
    "node_embeddings",
    "unit_embeddings",
    "strict_qa",
    "graph_integrity",
    "quality_dashboard",
  ].indexOf(stageId);
  return index >= 0 ? index + 1 : fallback;
}

function stageLabel(stageId: string): string {
  if (stageId.startsWith("lesson_staging_retry_")) {
    const retry = stageId.replace("lesson_staging_retry_", "");
    return `重抽失败课时 ${retry}`;
  }
  const labels: Record<string, string> = {
    check_postgres: "检查数据库",
    mineru_source_markdown: "MinerU 解析 PDF",
    extract_pdf_outline: "读取 PDF 目录",
    prepare_source_markdown: "准备解析文本",
    ensure_outline: "生成教材目录",
    prepare_outline_chunks: "切分课时",
    lesson_plan: "生成抽取任务",
    lesson_staging: "模型抽取课时",
    staging_quality: "检查暂存质量",
    canonical_commit: "合并入正式图谱",
    normalize: "归一化知识对象",
    node_bodies: "生成知识正文",
    pedagogical_profiles: "生成教学画像",
    node_embeddings: "生成节点向量",
    unit_embeddings: "生成单元向量",
    strict_qa: "严格质检",
    graph_integrity: "图谱完整性检查",
    quality_dashboard: "生成质量仪表盘",
  };
  return labels[stageId] ?? stageId;
}

function sanitizeStageOutput(stage: ServerPipelineStage): Record<string, unknown> {
  const output = stage.output ?? {};
  if (stage.id === "lesson_plan") {
    return {
      total_units: output.total_units,
      unit_kind: output.unit_kind,
      parallel: output.parallel,
    };
  }
  return output;
}

function lessonProgress(
  total: number,
  completed: number,
  failed: number,
  running: Record<string, unknown>[],
  recentCompleted: Record<string, unknown>[],
): Record<string, unknown> {
  const done = completed + failed;
  return {
    total_units: total,
    completed,
    failed,
    running,
    recent_completed: recentCompleted,
    percent: total > 0 ? done / total : 0,
  };
}

function lessonRuntimeItem(item: ParallelExtractionCommand): Record<string, unknown> {
  return {
    worker_slot: item.worker_slot,
    book_id: item.book_id,
    batch_anchor: item.batch_anchor,
    lesson_run_id: item.lesson_run_id,
  };
}

function compactLessonResults(results: Array<Record<string, unknown>>): Record<string, unknown>[] {
  return results.map(compactLessonResult);
}

function compactLessonResult(result: Record<string, unknown>): Record<string, unknown> {
  return {
    index: result.index,
    worker_slot: result.worker_slot,
    book_id: result.book_id,
    batch_anchor: result.batch_anchor,
    lesson_run_id: result.lesson_run_id,
    exit_code: result.exit_code,
    stdout_tail: result.stdout_tail,
    stderr_tail: result.stderr_tail,
  };
}

function parseOptions(argv: string[]): RunnerOptions {
  const flags = parseFlags(argv);
  const bookId = required(flags, "book-id");
  const outputRoot = flags.get("output-root") ?? "data/main";
  const datasetId = flags.get("dataset-id") || outputRoot.split(/[\\/]+/).filter(Boolean).at(-1) || "main";
  return {
    jobId: flags.get("job-id"),
    logPath: flags.get("log-path"),
    bookId,
    outputRoot,
    datasetId,
    dbUrl: required(flags, "db"),
    parallelism: parseInteger(flags.get("parallelism"), 8),
    noChunks: flags.has("no-chunks"),
    pdfPath: flags.get("pdf-path") ?? "",
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
    apiMode: parseApiMode(flags.get("api-mode") ?? "chat_completions"),
    extractionTemplate: flags.get("extraction-template") ?? "auto",
    modelRetryCount: parseNonNegativeInteger(flags.get("model-retry-count"), 2),
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
    enrichContext: parseBoolean(flags.get("enrich-context"), true),
    enrichContextLimit: parseInteger(flags.get("enrich-context-limit"), 6),
    qualityRetryCount: parseNonNegativeInteger(flags.get("quality-retry-count") ?? flags.get("quality-retries"), 1),
    skipNodeBodies: flags.has("skip-node-bodies"),
    nodeBodyConcurrency: parseInteger(flags.get("node-body-concurrency") ?? flags.get("parallelism"), 8),
    nodeBodyLimit: parseNonNegativeInteger(flags.get("node-body-limit"), 0),
    nodeBodyMaxEvidence: parseInteger(flags.get("node-body-max-evidence"), 8),
    overwriteNodeBodies: flags.has("overwrite-node-bodies"),
    skipPedagogicalProfiles: flags.has("skip-pedagogical-profiles"),
    pedagogicalProfileConcurrency: parseInteger(flags.get("pedagogical-profile-concurrency") ?? flags.get("parallelism"), 8),
    pedagogicalProfileLimit: parseNonNegativeInteger(flags.get("pedagogical-profile-limit"), 0),
    pedagogicalProfileMaxEvidence: parseInteger(flags.get("pedagogical-profile-max-evidence"), 8),
    overwriteGeneratedPedagogicalProfiles: flags.has("overwrite-generated-pedagogical-profiles"),
    skipEmbeddings: flags.has("skip-embeddings"),
    nodeEmbeddingBatchSize: parseInteger(flags.get("node-embedding-batch-size") ?? flags.get("embedding-batch-size"), 8),
    unitEmbeddingBatchSize: parseInteger(flags.get("unit-embedding-batch-size") ?? flags.get("embedding-batch-size"), 8),
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

function parseNonNegativeInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`Invalid non-negative integer: ${value}`);
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
