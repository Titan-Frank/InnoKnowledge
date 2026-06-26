import { makeLessonRunId, type OutlineItem } from "../shared/pathing.js";

export type ParallelLessonRun = {
  book_id: string;
  batch_anchor: string;
  lesson_run_id: string;
  title: unknown;
  label: unknown;
  unit_kind: "chunk" | "lesson";
};

export type ParallelWorker = {
  worker_slot: number;
  items: ParallelLessonRun[];
};

export type ParallelExtractionCommand = {
  worker_slot: number;
  book_id: string;
  batch_anchor: string;
  lesson_run_id: string;
  command: string[];
};

export type ParallelBatchPlan = {
  book_id: string;
  parallel: number;
  batch_size: number;
  total_units: number;
  unit_kind: "chunk" | "lesson";
  workers: ParallelWorker[];
};

export type ParallelBatchOptions = {
  bookId: string;
  parallel?: number;
  batchSize?: number;
  noChunks?: boolean;
};

export type TsModelExtractionCommandOptions = {
  outputRoot: string;
  extractorCliPath: string;
  nodeExecutable?: string;
  datasetId?: string;
  model?: string;
  prompt?: string;
  subject?: string;
  schoolStage?: string;
  gradeBand?: string;
  textbookId?: string;
  apiMode?: "responses" | "chat_completions";
  baseUrl?: string;
  apiKeyEnv?: string;
  reasoningEffort?: string;
  timeoutSeconds?: number;
  vlmApiUrl?: string;
  vlmApiKeyEnv?: string;
  vlmCacheDir?: string;
  vlmConcurrency?: number;
  vlmModel?: string;
};

export function chunked<T>(items: T[], size: number): T[][] {
  if (size < 1) throw new Error("chunk size must be at least 1.");
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    result.push(items.slice(index, index + size));
  }
  return result;
}

export function planParallelBatches(items: OutlineItem[], options: ParallelBatchOptions): ParallelBatchPlan {
  const parallel = options.parallel ?? 4;
  const batchSize = options.batchSize ?? 1;
  if (batchSize !== 1) {
    throw new Error("--batch-size must be 1. The pipeline requires one isolated Task per lesson.");
  }

  const { units, unitKind } = selectExtractionUnits(items, Boolean(options.noChunks));
  if (units.length === 0) throw new Error(`No extraction units found for book '${options.bookId}'.`);

  const lessonRuns = units.map((item) => {
    const itemId = requiredId(item);
    const batchAnchor = resolveOutlineAnchorFromItems(options.bookId, itemId, items, { strict: true });
    return {
      book_id: options.bookId,
      batch_anchor: batchAnchor,
      lesson_run_id: makeLessonRunId(options.bookId, batchAnchor),
      title: item.title,
      label: item.label,
      unit_kind: unitKind,
    };
  });

  const workers = chunked(lessonRuns, 1).map((group, index) => ({
    worker_slot: index % Math.max(1, parallel),
    items: group,
  }));

  return {
    book_id: options.bookId,
    parallel,
    batch_size: batchSize,
    total_units: lessonRuns.length,
    unit_kind: unitKind,
    workers,
  };
}

export function selectExtractionUnits(items: OutlineItem[], noChunks = false): { units: OutlineItem[]; unitKind: "chunk" | "lesson" } {
  if (!noChunks) {
    const chunks = items.filter((item) => item.kind === "chunk");
    if (chunks.length > 0) return { units: chunks, unitKind: "chunk" };
  }
  return { units: items.filter((item) => item.kind === "lesson"), unitKind: "lesson" };
}

export function taskLinesForWorkers(workers: ParallelWorker[]): string[] {
  return workers.map((worker) => `worker-${worker.worker_slot}: ${worker.items.map((item) => item.batch_anchor).join(", ")}`);
}

export function planTsModelExtractionCommands(workers: ParallelWorker[], options: TsModelExtractionCommandOptions): ParallelExtractionCommand[] {
  return workers.flatMap((worker) =>
    worker.items.map((item) => ({
      worker_slot: worker.worker_slot,
      book_id: item.book_id,
      batch_anchor: item.batch_anchor,
      lesson_run_id: item.lesson_run_id,
      command: buildTsModelExtractionCommand(item, options),
    })),
  );
}

export function resolveOutlineAnchorFromItems(
  bookId: string,
  anchor: string,
  items: OutlineItem[],
  options: { strict?: boolean } = {},
): string {
  if (items.length === 0) {
    if (options.strict) throw new Error(`Outline not found for book '${bookId}'.`);
    return anchor;
  }

  const ids = items.map((item) => item.id).filter((id): id is string => typeof id === "string" && id.length > 0);
  if (ids.includes(anchor)) return anchor;

  const matches = uniqueStable(ids.filter((itemId) => anchorTokenVariants(itemId, bookId).includes(anchor)));
  if (matches.length === 1) return matches[0]!;
  if (matches.length > 0 && options.strict) {
    throw new Error(`Anchor '${anchor}' is ambiguous for book '${bookId}'. Matches: ${matches.slice(0, 5).join(", ")}`);
  }
  if (options.strict) {
    throw new Error(
      `Anchor '${anchor}' was not found in outline for book '${bookId}'. Use a canonical outline id such as: ${ids.sort().slice(0, 5).join(", ")}`,
    );
  }
  return anchor;
}

function requiredId(item: OutlineItem): string {
  if (typeof item.id !== "string" || item.id.length === 0) throw new Error("Outline item is missing id.");
  return item.id;
}

function buildTsModelExtractionCommand(item: ParallelLessonRun, options: TsModelExtractionCommandOptions): string[] {
  const command = [
    options.nodeExecutable ?? "node",
    options.extractorCliPath,
    "--book-id",
    item.book_id,
    "--batch-anchor",
    item.batch_anchor,
    "--output-root",
    options.outputRoot,
  ];
  pushOptional(command, "--dataset-id", options.datasetId);
  pushOptional(command, "--model", options.model);
  pushOptional(command, "--prompt", options.prompt);
  pushOptional(command, "--subject", options.subject);
  pushOptional(command, "--school-stage", options.schoolStage);
  pushOptional(command, "--grade-band", options.gradeBand);
  pushOptional(command, "--textbook-id", options.textbookId);
  pushOptional(command, "--api-mode", options.apiMode);
  pushOptional(command, "--base-url", options.baseUrl);
  pushOptional(command, "--api-key-env", options.apiKeyEnv);
  pushOptional(command, "--reasoning-effort", options.reasoningEffort);
  if (options.timeoutSeconds !== undefined) pushOptional(command, "--timeout", String(options.timeoutSeconds));
  pushOptional(command, "--vlm-api-url", options.vlmApiUrl);
  pushOptional(command, "--vlm-api-key-env", options.vlmApiKeyEnv);
  pushOptional(command, "--vlm-cache-dir", options.vlmCacheDir);
  if (options.vlmConcurrency !== undefined) pushOptional(command, "--vlm-concurrency", String(options.vlmConcurrency));
  pushOptional(command, "--vlm-model", options.vlmModel);
  return command;
}

function pushOptional(command: string[], flag: string, value: string | undefined): void {
  if (value !== undefined && value !== "") command.push(flag, value);
}

function anchorTokenVariants(anchorId: string, bookId?: string): string[] {
  const variants = [anchorId];
  const match = /^struct:(?<bookId>[^:]+):(?<kind>[^:]+):(?<local>.+)$/.exec(anchorId);
  if (match?.groups && (bookId === undefined || match.groups.bookId === bookId)) {
    const { kind, local } = match.groups;
    const scoped = `${kind}:${local}`;
    variants.push(scoped, scoped.replace(":", "-"), local);
  }
  return uniqueStable(variants);
}

function uniqueStable(values: Iterable<string>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}
