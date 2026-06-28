#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { env as processEnv } from "node:process";

import {
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OPENAI_TIMEOUT_MS,
  callModelExtractionRequest,
  extractTextOutput,
  type ModelApiMode,
} from "../extraction/model-lesson-extraction.js";
import {
  buildModelNodeBodyPrompt,
  parseModelNodeBodyResultText,
  runGenerateNodeBodiesFromDatabase,
  type ModelNodeBodyGenerator,
  type NodeBodyGenerationMode,
} from "../unit-bodies/generate-node-bodies.js";
import { preparePostgresJsParams } from "../shared/postgres-executor.js";
import { REPO_ROOT } from "../shared/pathing.js";
import type { SqlStatement } from "../staging/staging-sql.js";

async function main(argv: string[]): Promise<number> {
  try {
    const flags = parseFlags(argv);
    const dbUrl = flags.get("db") ?? process.env.DATABASE_URL;
    if (!dbUrl) throw new Error("Missing required option --db or DATABASE_URL.");
    const output = await runDatabaseMode(flags, dbUrl);
    process.stdout.write(`${JSON.stringify(output, null, flags.has("pretty") ? 2 : undefined)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 1;
  }
}

type RawRecord = Record<string, unknown>;
type CliEnv = Record<string, string | undefined>;

async function runDatabaseMode(flags: Map<string, string>, dbUrl: string): Promise<Awaited<ReturnType<typeof runGenerateNodeBodiesFromDatabase>>> {
  const postgres = (await import("postgres")).default;
  const sql = postgres(dbUrl, { max: 1 });
  const repoRoot = flags.get("repo-root") ?? REPO_ROOT;
  const env = loadEnvironment(repoRoot, processEnv);
  const mode = parseMode(flags.get("mode"));
  const modelName = flags.get("model") ?? env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;
  const modelRetryCount = parseNonNegativeInteger(flags.get("model-retry-count"), "model-retry-count") ?? 2;
  const generator = mode === "model"
    ? makeModelNodeBodyGenerator({
        apiKey: requiredApiKey(env, flags.get("api-key-env") ?? "OPENAI_API_KEY"),
        apiMode: parseApiMode(flags.get("api-mode")),
        baseUrl: flags.get("base-url") ?? env.OPENAI_BASE_URL ?? DEFAULT_OPENAI_BASE_URL,
        model: modelName,
        reasoningEffort: flags.get("reasoning-effort") ?? "",
        timeoutMs: parseTimeoutMs(flags.get("timeout")),
        retryCount: modelRetryCount,
      })
    : undefined;
  try {
    return await runGenerateNodeBodiesFromDatabase({
      datasetId: required(flags, "dataset-id"),
      mode,
      nodeId: flags.get("node-id") ?? "",
      limit: parseNonNegativeInteger(flags.get("limit"), "limit"),
      maxEvidencePerNode: parsePositiveInteger(flags.get("max-evidence"), "max-evidence") ?? 8,
      modelName,
      concurrency: parsePositiveInteger(flags.get("concurrency"), "concurrency") ?? 8,
      overwriteExisting: flags.has("overwrite-existing"),
      generateBody: generator,
      query: async (statement) => {
        assertSelectStatement(statement);
        const rows = await sql.unsafe(statement.sql, preparePostgresJsParams(statement.params) as never[]);
        return Array.isArray(rows) ? rows.filter(isRecord) : [];
      },
      executeStatement: async (statement) => {
        assertAllowedNodeBodyWriteStatement(statement);
        await sql.unsafe(statement.sql, preparePostgresJsParams(statement.params) as never[]);
      },
    });
  } finally {
    await sql.end();
  }
}

function makeModelNodeBodyGenerator(options: {
  apiKey: string;
  apiMode: ModelApiMode;
  baseUrl: string;
  model: string;
  reasoningEffort?: string;
  timeoutMs: number;
  retryCount: number;
}): ModelNodeBodyGenerator {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  return async (input) => {
    const prompt = buildModelNodeBodyPrompt(input);
    const body = buildOpenAiBody({
      apiMode: options.apiMode,
      model: options.model,
      instructions: prompt.instructions,
      userPayload: prompt.user_payload,
      schema: prompt.response_schema,
      reasoningEffort: options.reasoningEffort,
    });
    const response = await callModelRequestWithRetries({
      api_mode: options.apiMode,
      endpoint: `${baseUrl}/${options.apiMode === "responses" ? "responses" : "chat/completions"}`,
      timeout_ms: options.timeoutMs,
      instructions: prompt.instructions,
      user_payload: prompt.user_payload,
      body,
    }, options.apiKey, options.retryCount);
    return parseModelNodeBodyResultText(extractTextOutput(response));
  };
}

async function callModelRequestWithRetries(
  request: Parameters<typeof callModelExtractionRequest>[0],
  apiKey: string,
  retryCount: number,
): Promise<RawRecord> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      return await callModelExtractionRequest(request, apiKey);
    } catch (error) {
      lastError = error as Error;
      if (attempt >= retryCount || !isRetryableModelError(lastError)) break;
      await sleep(Math.min(2000 * (attempt + 1), 8000));
    }
  }
  throw lastError ?? new Error("Model request failed.");
}

function isRetryableModelError(error: Error): boolean {
  return /fetch failed|network|socket|timeout|aborted|429|500|502|503|504/i.test(error.message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function buildOpenAiBody(input: {
  apiMode: ModelApiMode;
  model: string;
  instructions: string;
  userPayload: string;
  schema: RawRecord;
  reasoningEffort?: string;
}): RawRecord {
  if (input.apiMode === "chat_completions") {
    const body: RawRecord = {
      model: input.model,
      messages: [
        { role: "system", content: input.instructions },
        { role: "user", content: input.userPayload },
      ],
      response_format: {
        type: "json_schema",
        json_schema: input.schema,
      },
    };
    if (input.reasoningEffort) body.reasoning_effort = input.reasoningEffort;
    return body;
  }
  const body: RawRecord = {
    model: input.model,
    instructions: input.instructions,
    input: [{ role: "user", content: [{ type: "input_text", text: input.userPayload }] }],
    text: { format: { type: "json_schema", ...input.schema } },
  };
  if (input.reasoningEffort) body.reasoning = { effort: input.reasoningEffort };
  return body;
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

function requiredApiKey(env: CliEnv, name: string): string {
  const value = (env[name] ?? "").trim();
  if (!value) throw new Error(`Missing API key in environment variable ${name}.`);
  return value;
}

function parseMode(value: string | undefined): NodeBodyGenerationMode {
  if (value === undefined || value === "model") return "model";
  if (value === "card") return "card";
  if (value === "model") return "model";
  throw new Error(`Invalid --mode '${value}'. Expected card or model.`);
}

function parseApiMode(value: string | undefined): ModelApiMode {
  if (value === undefined || value === "responses") return "responses";
  if (value === "chat_completions") return "chat_completions";
  throw new Error(`Invalid --api-mode '${value}'. Expected responses or chat_completions.`);
}

function parseTimeoutMs(value: string | undefined): number {
  if (value === undefined) return DEFAULT_OPENAI_TIMEOUT_MS;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("--timeout must be a positive number of seconds.");
  return seconds * 1000;
}

function parseNonNegativeInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`--${name} must be a non-negative integer.`);
  return parsed;
}

function parsePositiveInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`--${name} must be a positive integer.`);
  return parsed;
}

function loadEnvironment(repoRoot: string, source: CliEnv): CliEnv {
  const env: CliEnv = { ...source };
  const path = resolve(repoRoot, ".env");
  if (!existsSync(path)) return env;
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    const name = key?.trim();
    if (!name || env[name] !== undefined) continue;
    env[name] = rest.join("=").trim();
  }
  return env;
}

function assertSelectStatement(statement: SqlStatement): void {
  if (!/^\s*SELECT\b/i.test(statement.sql)) {
    throw new Error(`Node body generation query executor refuses non-SELECT statement '${statement.name}'.`);
  }
}

function assertAllowedNodeBodyWriteStatement(statement: SqlStatement): void {
  const trimmed = statement.sql.trim();
  if (!/^INSERT\s+INTO\s+world_node_bodies\b[\s\S]+ON\s+CONFLICT\s+\(dataset_id,\s*node_id\)\s+DO\s+UPDATE\s+SET/i.test(trimmed)) {
    throw new Error(`Node body generation executor refuses statement '${statement.name}' outside world_node_bodies upserts.`);
  }
}

function isRecord(value: unknown): value is RawRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  raise(main(process.argv.slice(2)));
}

function raise(promise: Promise<number>): void {
  promise.then((code) => {
    process.exitCode = code;
  });
}
