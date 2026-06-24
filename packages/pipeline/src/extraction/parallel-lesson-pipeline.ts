import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { REPO_ROOT } from "../shared/pathing.js";

export type ParallelLessonPipelineOptions = {
  root: string;
  dbUrl?: string;
  datasetId?: string;
  bookId?: string;
  batchAnchors?: string[];
  lessonRunIds?: string[];
  similarityThreshold?: number;
  embeddingThreshold?: number;
  reviewThreshold?: number;
  normalizeAutoMerge?: boolean;
  skipNormalize?: boolean;
  skipQa?: boolean;
  skipIntegrity?: boolean;
  repoRoot?: string;
  nodeExecutable?: string;
};

export type PipelineCommandStep = {
  name: "merge" | "normalize" | "qa" | "integrity";
  command: string[];
};

export type PipelineCommandOutput = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type PipelineCommandRunner = (command: string[]) => Promise<PipelineCommandOutput>;

export type PipelineCommandRun = PipelineCommandStep & {
  status: "completed" | "blocked";
  exit_code: number;
  stdout_tail: string;
  stderr_tail: string;
};

export type LessonRunSelectionPlan =
  | {
      mode: "explicit";
      lesson_run_ids: string[];
    }
  | {
      mode: "query";
      sql: string;
      params: string[];
    };

export type MarkQaPassedPlan = {
  sql: string;
  params: string[][];
};

export type ParallelLessonPipelinePlan = {
  root: string;
  dataset_id: string;
  db_url: string;
  commands: PipelineCommandStep[];
  lesson_run_selection: LessonRunSelectionPlan;
  mark_qa_passed: MarkQaPassedPlan;
};

export type LessonRunSelectionQuery = {
  datasetId: string;
  bookId?: string;
  batchAnchors?: string[];
};

export type PipelineSqlStatement = {
  name: string;
  sql: string;
  params: unknown[];
};

export type ParallelLessonPipelineRunOptions = ParallelLessonPipelineOptions & {
  commandRunner?: PipelineCommandRunner;
  selectLessonRunIds?: (input: LessonRunSelectionQuery) => Promise<string[]>;
  markQaPassed?: (input: { datasetId: string; lessonRunIds: string[] }) => Promise<number>;
  tailLimit?: number;
};

export type ParallelLessonPipelineRunResult = ParallelLessonPipelinePlan & {
  status: "success" | "blocked";
  steps: PipelineCommandRun[];
  qa_passed?: {
    lesson_run_ids: string[];
    marked_count: number;
  };
  error?: string;
};

export function planParallelLessonPipeline(options: ParallelLessonPipelineOptions): ParallelLessonPipelinePlan {
  const root = resolveInputPath(options.root);
  const datasetId = options.datasetId ?? datasetIdFromRoot(root);
  const dbUrl = options.dbUrl ?? "";
  const repoRoot = options.repoRoot ?? REPO_ROOT;
  const node = options.nodeExecutable ?? "node";

  const commands: PipelineCommandStep[] = [
    {
      name: "merge",
      command: buildMergeCommand({ ...options, root, dbUrl, datasetId, repoRoot, nodeExecutable: node }),
    },
  ];

  if (!options.skipNormalize) {
    commands.push({
      name: "normalize",
      command: buildNormalizeCommand({ ...options, dbUrl, datasetId, repoRoot, nodeExecutable: node }),
    });
  }

  if (!options.skipQa) {
    commands.push({
      name: "qa",
      command: [node, resolve(repoRoot, "packages", "pipeline", "dist", "cli", "strict-qa.js"), "--dataset-id", datasetId, "--db", dbUrl],
    });
  }

  if (!options.skipIntegrity) {
    commands.push({
      name: "integrity",
      command: buildGraphIntegrityCommand({ ...options, dbUrl, datasetId, repoRoot, nodeExecutable: node }),
    });
  }

  const selection = planLessonRunSelection({
    datasetId,
    bookId: options.bookId,
    batchAnchors: options.batchAnchors,
    lessonRunIds: options.lessonRunIds,
  });

  return {
    root,
    dataset_id: datasetId,
    db_url: dbUrl,
    commands,
    lesson_run_selection: selection,
    mark_qa_passed: planMarkQaPassed(datasetId, selection.mode === "explicit" ? selection.lesson_run_ids : []),
  };
}

export async function runParallelLessonPipeline(options: ParallelLessonPipelineRunOptions): Promise<ParallelLessonPipelineRunResult> {
  const plan = planParallelLessonPipeline(options);
  if (!plan.db_url) throw new Error("Running the parallel lesson pipeline requires --db or DATABASE_URL.");

  const steps: PipelineCommandRun[] = [];
  const runner = options.commandRunner ?? runChildCommand;
  for (const step of plan.commands) {
    const output = await runner(step.command);
    const run: PipelineCommandRun = {
      ...step,
      status: output.exitCode === 0 ? "completed" : "blocked",
      exit_code: output.exitCode,
      stdout_tail: tail(output.stdout, options.tailLimit),
      stderr_tail: tail(output.stderr, options.tailLimit),
    };
    steps.push(run);
    if (output.exitCode !== 0) {
      return {
        ...plan,
        status: "blocked",
        steps,
        error: `${step.name} command failed.`,
      };
    }
  }

  const lessonRunIds =
    plan.lesson_run_selection.mode === "explicit"
      ? plan.lesson_run_selection.lesson_run_ids
      : await selectMergedLessonRunIds(options, plan.lesson_run_selection);
  const markedCount = lessonRunIds.length > 0 ? await markQaPassed(options, plan.dataset_id, lessonRunIds) : 0;

  return {
    ...plan,
    status: "success",
    steps,
    qa_passed: {
      lesson_run_ids: lessonRunIds,
      marked_count: markedCount,
    },
  };
}

export function planLessonRunSelection(input: {
  datasetId: string;
  bookId?: string;
  batchAnchors?: string[];
  lessonRunIds?: string[];
}): LessonRunSelectionPlan {
  if (input.lessonRunIds && input.lessonRunIds.length > 0) {
    return { mode: "explicit", lesson_run_ids: [...input.lessonRunIds] };
  }

  const params = [input.datasetId];
  const filters = ["dataset_id = %s", "status = 'merged'"];
  if (input.bookId) {
    filters.push("book_id = %s");
    params.push(input.bookId);
  }
  if (input.batchAnchors && input.batchAnchors.length > 0) {
    filters.push(`batch_anchor IN (${input.batchAnchors.map(() => "%s").join(",")})`);
    params.push(...input.batchAnchors);
  }

  return {
    mode: "query",
    sql: `SELECT lesson_run_id FROM world_lesson_runs WHERE ${filters.join(" AND ")} ORDER BY lesson_run_id`,
    params,
  };
}

export function planMarkQaPassed(datasetId: string, lessonRunIds: string[]): MarkQaPassedPlan {
  return {
    sql: "UPDATE world_lesson_runs SET status = 'qa_passed', updated_at = %s WHERE dataset_id = %s AND lesson_run_id = %s",
    params: lessonRunIds.map((lessonRunId) => ["<utc_now>", datasetId, lessonRunId]),
  };
}

export function buildSelectMergedLessonRunIdsStatement(input: LessonRunSelectionQuery): PipelineSqlStatement {
  const params: unknown[] = [input.datasetId];
  const filters = ["dataset_id = $1", "status = 'merged'"];
  if (input.bookId) {
    params.push(input.bookId);
    filters.push(`book_id = $${params.length}`);
  }
  if (input.batchAnchors && input.batchAnchors.length > 0) {
    params.push(input.batchAnchors);
    filters.push(`batch_anchor = ANY($${params.length})`);
  }
  return {
    name: "select-merged-world-lesson-runs",
    sql: `SELECT lesson_run_id FROM world_lesson_runs WHERE ${filters.join(" AND ")} ORDER BY lesson_run_id`,
    params,
  };
}

export function buildMarkLessonRunsQaPassedStatement(input: { datasetId: string; lessonRunIds: string[]; now: string }): PipelineSqlStatement {
  return {
    name: "mark-world-lesson-runs-qa-passed",
    sql: "UPDATE world_lesson_runs SET status = 'qa_passed', updated_at = $1 WHERE dataset_id = $2 AND lesson_run_id = ANY($3)",
    params: [input.now, input.datasetId, input.lessonRunIds],
  };
}

function buildMergeCommand(
  options: ParallelLessonPipelineOptions & { root: string; dbUrl: string; datasetId: string; repoRoot: string; nodeExecutable: string },
): string[] {
  const command = [
    options.nodeExecutable,
    resolve(options.repoRoot, "packages", "pipeline", "dist", "cli", "merge-staged-lessons.js"),
    "--dataset-id",
    options.datasetId,
    "--db",
    options.dbUrl,
    "--similarity-threshold",
    String(options.similarityThreshold ?? 0.9),
    "--embedding-threshold",
    String(options.embeddingThreshold ?? 0.92),
    "--review-threshold",
    String(options.reviewThreshold ?? 0.72),
  ];
  if (options.bookId) command.push("--book-id", options.bookId);
  for (const batchAnchor of options.batchAnchors ?? []) {
    command.push("--batch-anchor", batchAnchor);
  }
  for (const lessonRunId of options.lessonRunIds ?? []) {
    command.push("--lesson-run-id", lessonRunId);
  }
  return command;
}

function buildNormalizeCommand(
  options: ParallelLessonPipelineOptions & { dbUrl: string; datasetId: string; repoRoot: string; nodeExecutable: string },
): string[] {
  return [options.nodeExecutable, resolve(options.repoRoot, "packages", "pipeline", "dist", "cli", "normalize.js"), "--dataset-id", options.datasetId, "--db", options.dbUrl];
}

function buildGraphIntegrityCommand(
  options: ParallelLessonPipelineOptions & { dbUrl: string; datasetId: string; repoRoot: string; nodeExecutable: string },
): string[] {
  const command = [
    options.nodeExecutable,
    resolve(options.repoRoot, "packages", "pipeline", "dist", "cli", "graph-integrity.js"),
    "--dataset-id",
    options.datasetId,
    "--db",
    options.dbUrl,
  ];
  if (options.bookId) command.push("--book-id", options.bookId);
  for (const batchAnchor of options.batchAnchors ?? []) {
    command.push("--batch-anchor", batchAnchor);
  }
  for (const lessonRunId of options.lessonRunIds ?? []) {
    command.push("--lesson-run-id", lessonRunId);
  }
  return command;
}

function resolveInputPath(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  return resolve(path);
}

function datasetIdFromRoot(root: string): string {
  const parts = root.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) ?? "";
}

async function selectMergedLessonRunIds(options: ParallelLessonPipelineRunOptions, selection: Extract<LessonRunSelectionPlan, { mode: "query" }>): Promise<string[]> {
  if (!options.selectLessonRunIds) throw new Error("Executing query-mode QA status updates requires a lesson run selector.");
  return options.selectLessonRunIds({
    datasetId: selection.params[0] ?? "",
    bookId: options.bookId,
    batchAnchors: options.batchAnchors,
  });
}

async function markQaPassed(options: ParallelLessonPipelineRunOptions, datasetId: string, lessonRunIds: string[]): Promise<number> {
  if (!options.markQaPassed) throw new Error("Executing QA status updates requires a markQaPassed executor.");
  return options.markQaPassed({ datasetId, lessonRunIds });
}

function runChildCommand(command: string[]): Promise<PipelineCommandOutput> {
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
