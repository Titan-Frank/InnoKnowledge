import { homedir } from "node:os";
import { resolve } from "node:path";

import {
  planParallelBatches,
  planTsModelExtractionCommands,
  taskLinesForWorkers,
  type ParallelBatchPlan,
  type ParallelExtractionCommand,
  type TsModelExtractionCommandOptions,
} from "./parallel-batch.js";
import { REPO_ROOT, loadOutlineItems, safePathToken } from "../shared/pathing.js";

export type ParallelBatchRunInput = {
  bookId: string;
  outputRoot: string;
  parallel?: number;
  batchSize?: number;
  noChunks?: boolean;
  generateTasks?: boolean;
  planExtractionCommands?: boolean;
} & Partial<Omit<TsModelExtractionCommandOptions, "extractorCliPath" | "outputRoot">> & {
    extractorCliPath?: string;
};

export type ParallelBatchRunOutput = ParallelBatchPlan & {
  status: "success";
  output_path: string;
  task_lines?: string[];
  extraction_commands?: ParallelExtractionCommand[];
};

export function runParallelBatchPlan(input: ParallelBatchRunInput): ParallelBatchRunOutput {
  const plan = planParallelBatches(loadOutlineItems(input.bookId), {
    bookId: input.bookId,
    parallel: input.parallel,
    batchSize: input.batchSize,
    noChunks: input.noChunks,
  });
  return {
    status: "success",
    output_path: parallelPlanOutputPath(input.outputRoot, input.bookId),
    ...plan,
    ...(input.generateTasks ? { task_lines: taskLinesForWorkers(plan.workers) } : {}),
    ...(input.planExtractionCommands
      ? {
          extraction_commands: planTsModelExtractionCommands(plan.workers, {
            ...input,
            outputRoot: input.outputRoot,
            extractorCliPath: input.extractorCliPath ?? defaultExtractorCliPath(),
          }),
        }
      : {}),
  };
}

export function parallelPlanOutputPath(outputRoot: string, bookId: string): string {
  return resolve(expandHome(outputRoot), "runs", "parallel", `${safePathToken(bookId)}.parallel-plan.json`);
}

export function defaultExtractorCliPath(): string {
  return resolve(REPO_ROOT, "packages/pipeline/dist/cli/extract-lesson-openai.js");
}

function expandHome(path: string): string {
  if (path === "~") return homedir();
  if (path.startsWith("~/")) return resolve(homedir(), path.slice(2));
  return path;
}
