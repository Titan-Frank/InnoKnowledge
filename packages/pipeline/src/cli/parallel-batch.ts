#!/usr/bin/env node

import { runParallelBatchPlan } from "../extraction/parallel-batch-runner.js";

async function main(argv: string[]): Promise<number> {
  try {
    const flags = parseFlags(argv);
    const output = runParallelBatchPlan({
      bookId: required(flags, "book-id"),
      outputRoot: required(flags, "output-root"),
      parallel: parseInteger(flags.get("parallel"), "parallel"),
      batchSize: parseInteger(flags.get("batch-size"), "batch-size"),
      noChunks: flags.has("no-chunks"),
      generateTasks: flags.has("generate-tasks"),
      planExtractionCommands: flags.has("plan-extraction-commands"),
      extractorCliPath: flags.get("extractor-cli"),
      nodeExecutable: flags.get("node"),
      datasetId: flags.get("dataset-id"),
      model: flags.get("model"),
      prompt: flags.get("prompt"),
      subject: flags.get("subject"),
      schoolStage: flags.get("school-stage"),
      gradeBand: flags.get("grade-band"),
      textbookId: flags.get("textbook-id"),
      apiMode: parseApiMode(flags.get("api-mode")),
      baseUrl: flags.get("base-url"),
      apiKeyEnv: flags.get("api-key-env"),
      reasoningEffort: flags.get("reasoning-effort"),
      timeoutSeconds: parseNumber(flags.get("timeout"), "timeout"),
    });
    process.stdout.write(`${JSON.stringify(output)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 1;
  }
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
  if (value === undefined) throw new Error(`Missing required option --${name}.`);
  return value;
}

function parseInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`--${name} must be an integer.`);
  return parsed;
}

function parseNumber(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`--${name} must be a positive number.`);
  return parsed;
}

function parseApiMode(value: string | undefined): "responses" | "chat_completions" | undefined {
  if (value === undefined) return undefined;
  if (value === "responses" || value === "chat_completions") return value;
  throw new Error(`Invalid --api-mode '${value}'. Expected responses or chat_completions.`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  raise(main(process.argv.slice(2)));
}

function raise(promise: Promise<number>): void {
  promise.then((code) => {
    process.exitCode = code;
  });
}
