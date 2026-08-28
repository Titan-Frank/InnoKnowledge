#!/usr/bin/env node

import { isMainModule } from "../shared/cli-entry.js";

import { existsSync, readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { env as processEnv } from "node:process";

import {
  DEFAULT_OPENAI_BASE_URL,
  DEFAULT_OPENAI_MODEL,
  DEFAULT_OPENAI_TIMEOUT_MS,
  buildHybridEdgeExtractionRequest,
  buildAssessmentExtractionPayloadFromModelBundle,
  buildHybridExtractionPayloadFromModelBundles,
  buildHybridNodeEvidenceExtractionRequest,
  buildModelLessonPayload,
  buildRetrievalQueries,
  callModelExtractionRequest,
  type BuildModelExtractionRequestInput,
  type ModelApiMode,
  parseHybridEdgeBundleFromResponse,
  parseHybridNodeEvidenceBundleFromResponse,
} from "../extraction/model-lesson-extraction.js";
import {
  loadEnrichHintsForLesson,
  outlineTitlePathFromRecord,
  type EnrichContextQueryExecutor,
} from "../extraction/enrich-context.js";
import { resolveExtractionTemplate } from "../extraction/extraction-template.js";
import { filterImageEvidencePayload } from "../extraction/image-relevance.js";
import {
  loadRetrievalCandidatesForQueries,
  type RetrievalCandidateQueryExecutor,
} from "../retrieval/retrieve-candidates-query.js";
import type { RetrievalMode } from "../retrieval/retrieve-candidates.js";
import { preparePostgresJsParams } from "../shared/postgres-executor.js";
import { REPO_ROOT } from "../shared/pathing.js";
import { buildStagingTableRows } from "../staging/staging-rows.js";
import { storeStagingRows, type SqlExecutor } from "../staging/staging-store.js";
import { normalizeLessonArtifacts } from "../staging/staging.js";

type CliEnv = Record<string, string | undefined>;
type RawRecord = Record<string, unknown>;
type ExtractLessonRequestBase = BuildModelExtractionRequestInput & {
  datasetId?: string;
  outputRoot: string;
  subject: string;
  schoolStage: string;
  bookTitle?: string;
};

export type ExtractLessonOpenAiCliDeps = {
  stdout?: (text: string) => void;
  stderr?: (text: string) => void;
  env?: CliEnv;
  fetchImpl?: typeof fetch;
  retrievalQueryExecutor?: RetrievalCandidateQueryExecutor;
  enrichContextExecutor?: EnrichContextQueryExecutor;
  embedQuery?: (queryText: string) => Promise<number[]> | number[];
  stagingStatementExecutor?: SqlExecutor;
};

type ExtractLessonOpenAiErrorPayload = {
  status: "blocked" | "failed";
  issues: string[];
};

const DEFAULT_EMBEDDING_URL = "";
const DEFAULT_EMBEDDING_MODEL = "Qwen/Qwen3-Embedding-4B";
const EMBEDDING_DIMENSION = 1024;

async function main(argv: string[]): Promise<number> {
  return runExtractLessonOpenAiCli(argv);
}

export async function runExtractLessonOpenAiCli(argv: string[], deps: ExtractLessonOpenAiCliDeps = {}): Promise<number> {
  const stdout = deps.stdout ?? ((text: string) => process.stdout.write(text));
  const stderr = deps.stderr ?? ((text: string) => process.stderr.write(text));

  try {
    const flags = parseFlags(argv);
    if (flags.has("fallback-local-on-error")) {
      throw new Error("--fallback-local-on-error is retired. TypeScript extraction only calls the model; failures are reported as blocked.");
    }
    assertKnownFlags(flags, EXTRACT_LESSON_OPENAI_FLAGS);
    if (flags.has("write-staging") && !flags.get("db") && !deps.stagingStatementExecutor) {
      throw new Error("--write-staging requires --db when no staging executor is injected.");
    }

    const repoRoot = flags.get("repo-root") ?? REPO_ROOT;
    const env = loadEnvironment(repoRoot, deps.env ?? processEnv);
    const apiMode = parseApiMode(flags.get("api-mode"));
    const modelRetryCount = parseNonNegativeInteger(flags.get("model-retry-count") ?? env.MODEL_RETRY_COUNT, "model-retry-count") ?? 2;
    const timeoutMs = parseTimeoutMs(flags.get("timeout"));
    const outputRoot = required(flags, "output-root");
    const requestBase: ExtractLessonRequestBase = {
      bookId: required(flags, "book-id"),
      batchAnchor: required(flags, "batch-anchor"),
      repoRoot,
      datasetId: flags.get("dataset-id"),
      outputRoot,
      model: flags.get("model") ?? env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL,
      prompt: flags.get("prompt") ?? "",
      bookTitle: flags.get("book-title") ?? "",
      subject: flags.get("subject") ?? "computer-science",
      schoolStage: flags.get("school-stage") ?? "higher",
      gradeBand: flags.get("grade-band") ?? "university",
      textbookId: flags.get("textbook-id") ?? "",
      apiMode,
      baseUrl: flags.get("base-url") ?? env.OPENAI_BASE_URL ?? DEFAULT_OPENAI_BASE_URL,
      reasoningEffort: flags.get("reasoning-effort") ?? "",
      timeoutMs,
    };
    requestBase.extractionTemplate = resolveExtractionTemplate({
      repoRoot,
      templateId: flags.get("extraction-template"),
      subject: requestBase.subject,
      bookId: requestBase.bookId,
    });
    const pgOutline = await loadPostgresOutline({
      dbUrl: flags.get("db"),
      datasetId: requestBase.datasetId,
      bookId: requestBase.bookId,
    });
    if (pgOutline) requestBase.outline = pgOutline;
    const retrievalCandidates = await resolveRetrievalCandidates(flags, requestBase, env, deps);
    const enrichHints = await resolveEnrichHints(flags, requestBase, deps);
    const requestInput = { ...requestBase, retrievalCandidates, enrichHints };

    const apiKeyEnv = flags.get("api-key-env") ?? "OPENAI_API_KEY";
    const apiKey = (env[apiKeyEnv] ?? "").trim();
    if (!apiKey) {
      writeJson(stdout, blockedPayload(`OpenAI Responses extraction failed: Missing API key in environment variable ${apiKeyEnv}.`), flags.has("pretty"));
      return 2;
    }

    try {
      const nodeEvidenceRequest = buildHybridNodeEvidenceExtractionRequest(requestInput);
      const nodeEvidenceBundle = await callModelExtractionRequestWithRetries(
        nodeEvidenceRequest,
        apiKey,
        deps.fetchImpl ?? fetch,
        modelRetryCount,
        parseHybridNodeEvidenceBundleFromResponse,
      );
      const lessonPayload = buildModelLessonPayload(requestInput);
      const assessmentOnly = lessonPayload.lesson_context.extraction_policy === "existing_nodes_only";
      const edgeBundle = assessmentOnly || nodeEvidenceBundle.lesson_disposition === "no_knowledge"
        ? { edges: [], issues: [] }
        : await callModelExtractionRequestWithRetries(
          buildHybridEdgeExtractionRequest(requestInput, nodeEvidenceBundle),
          apiKey,
          deps.fetchImpl ?? fetch,
          modelRetryCount,
          parseHybridEdgeBundleFromResponse,
        );
      let payload: RawRecord = assessmentOnly
        ? buildAssessmentExtractionPayloadFromModelBundle(requestInput, nodeEvidenceBundle)
        : buildHybridExtractionPayloadFromModelBundles(requestInput, nodeEvidenceBundle, edgeBundle);
      if (!flags.has("no-image-filter")) {
        const vlmConcurrency = parsePositiveInteger(flags.get("vlm-concurrency") ?? env.VLM_CONCURRENCY, "vlm-concurrency") ?? 3;
        const imageFilterResult = await filterImageEvidencePayload(payload, {
          repoRoot,
          vlmApiUrl: flags.get("vlm-api-url") ?? env.VLM_API_URL,
          vlmApiKey: env[flags.get("vlm-api-key-env") ?? "VLM_API_KEY"] ?? "",
          vlmModel: flags.get("vlm-model") ?? env.VLM_MODEL,
          vlmConcurrency,
          vlmCacheDir: flags.get("vlm-cache-dir") ?? env.VLM_CACHE_DIR ?? resolve(repoRoot, outputRoot, ".cache", "image-relevance"),
          fetchImpl: deps.fetchImpl ?? fetch,
        });
        payload = imageFilterResult.payload;
      }
      if (flags.has("write-staging")) {
        payload = await writeStagingPayload({
          payload,
          flags,
          outputRoot,
          deps,
        });
      }
      writeJson(stdout, payload, flags.has("pretty"));
      return payload.status === "success" ? 0 : 2;
    } catch (error) {
      writeJson(stdout, blockedPayload(`OpenAI Responses extraction failed: ${(error as Error).message}`), flags.has("pretty"));
      return 2;
    }
  } catch (error) {
    stderr(`${(error as Error).message}\n`);
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

const EXTRACT_LESSON_OPENAI_FLAGS = new Set([
  "api-key-env",
  "api-mode",
  "base-url",
  "batch-anchor",
  "book-title",
  "book-id",
  "dataset-id",
  "db",
  "embedding-api-key-env",
  "embedding-model",
  "embedding-url",
  "enrich-context",
  "enrich-book-path",
  "enrich-context-limit",
  "extraction-template",
  "grade-band",
  "model",
  "model-retry-count",
  "output-root",
  "pretty",
  "prompt",
  "reasoning-effort",
  "repo-root",
  "retrieval-candidates-json",
  "retrieval-context",
  "retrieval-limit",
  "retrieval-mode",
  "school-stage",
  "subject",
  "textbook-id",
  "timeout",
  "vector-min-similarity",
  "vlm-api-key-env",
  "vlm-api-url",
  "vlm-cache-dir",
  "vlm-concurrency",
  "vlm-model",
  "write-staging",
  "no-image-filter",
]);

function assertKnownFlags(flags: Map<string, string>, allowed: Set<string>): void {
  for (const name of flags.keys()) {
    if (!allowed.has(name)) throw new Error(`Unknown option --${name}.`);
  }
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

async function loadPostgresOutline(input: {
  dbUrl?: string;
  datasetId?: string;
  bookId: string;
}): Promise<RawRecord | undefined> {
  if (!input.dbUrl || !input.datasetId) return undefined;
  const postgres = (await import("postgres")).default;
  const sql = postgres(input.dbUrl, { max: 1 });
  try {
    const rows = await sql<{ outline_json: unknown }[]>`
      SELECT outline_json
      FROM world_textbook_outlines
      WHERE dataset_id = ${input.datasetId}
        AND book_id = ${input.bookId}
      LIMIT 1
    `;
    const outline = rows[0]?.outline_json;
    if (isRecord(outline)) return outline;
    throw new Error(`Outline for book '${input.bookId}' was not found in PostgreSQL dataset '${input.datasetId}'.`);
  } finally {
    await sql.end({ timeout: 1 });
  }
}

function parseApiMode(value: string | undefined): ModelApiMode {
  if (value === undefined || value === "chat_completions") return "chat_completions";
  if (value === "responses") return "responses";
  throw new Error(`Invalid --api-mode '${value}'. Expected responses or chat_completions.`);
}

function parseTimeoutMs(value: string | undefined): number {
  if (value === undefined) return DEFAULT_OPENAI_TIMEOUT_MS;
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error("--timeout must be a positive number of seconds.");
  return seconds * 1000;
}

async function resolveRetrievalCandidates(
  flags: Map<string, string>,
  requestBase: ExtractLessonRequestBase,
  env: CliEnv,
  deps: ExtractLessonOpenAiCliDeps,
): Promise<RawRecord[] | undefined> {
  const provided = parseRetrievalCandidatesJson(flags.get("retrieval-candidates-json"));
  if (provided !== undefined || !flags.has("retrieval-context")) return provided;

  if (!requestBase.datasetId) return [];
  const payload = buildModelLessonPayload({ ...requestBase, retrievalCandidates: [] });
  const queries = buildRetrievalQueries({ title: payload.lesson_context.lesson_title }, payload.markdown_lines);
  if (queries.length === 0) return [];

  const ownedExecutor = deps.retrievalQueryExecutor ? null : await createExplicitPostgresRetrievalExecutor(flags.get("db"));
  const executor = deps.retrievalQueryExecutor ?? ownedExecutor?.executor;
  if (!executor) {
    throw new Error("--retrieval-context requires --db when --retrieval-candidates-json is not provided.");
  }

  try {
    return await loadRetrievalCandidatesForQueries({
      datasetId: requestBase.datasetId,
      queries,
      executor,
      embedQuery: deps.embedQuery ?? createEmbedQuery(flags, env, deps.fetchImpl ?? fetch),
      mode: parseRetrievalMode(flags.get("retrieval-mode")),
      domain: requestBase.subject,
      schoolStage: requestBase.schoolStage,
      limit: parsePositiveInteger(flags.get("retrieval-limit"), "retrieval-limit") ?? 8,
      vectorMinSimilarity: parseOptionalNumber(flags.get("vector-min-similarity"), "vector-min-similarity") ?? 0.5,
    });
  } finally {
    await ownedExecutor?.close();
  }
}

async function resolveEnrichHints(
  flags: Map<string, string>,
  requestBase: ExtractLessonRequestBase,
  deps: ExtractLessonOpenAiCliDeps,
) {
  if (!flags.has("enrich-context")) return undefined;
  if (!requestBase.datasetId) return [];
  const ownedExecutor = deps.enrichContextExecutor ? null : await createExplicitPostgresEnrichContextExecutor(flags.get("db"));
  const executor = deps.enrichContextExecutor ?? ownedExecutor?.executor;
  if (!executor) {
    throw new Error("--enrich-context requires --db when no enrich context executor is injected.");
  }

  try {
    const payload = buildModelLessonPayload({ ...requestBase, retrievalCandidates: [], enrichHints: [] });
    return await loadEnrichHintsForLesson({
      datasetId: requestBase.datasetId,
      executor,
      bookPath: flags.get("enrich-book-path"),
      bookId: requestBase.bookId,
      textbookId: requestBase.textbookId,
      bookTitle: requestBase.bookTitle,
      subject: requestBase.subject,
      schoolStage: requestBase.schoolStage,
      gradeBand: requestBase.gradeBand,
      lessonTitle: payload.lesson_context.lesson_title,
      outlineTitlePath: outlineTitlePathFromRecord(requestBase.outline, payload.lesson_context.batch_anchor),
      markdownLines: payload.markdown_lines,
      limit: parsePositiveInteger(flags.get("enrich-context-limit"), "enrich-context-limit") ?? 6,
    });
  } finally {
    await ownedExecutor?.close();
  }
}

function parseRetrievalCandidatesJson(value: string | undefined): RawRecord[] | undefined {
  if (value === undefined) return undefined;
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || !parsed.every(isRecord)) {
    throw new Error("--retrieval-candidates-json must be a JSON array of objects.");
  }
  return parsed;
}

async function createExplicitPostgresRetrievalExecutor(dbUrl: string | undefined): Promise<
  | {
      executor: RetrievalCandidateQueryExecutor;
      close: () => Promise<void>;
    }
  | null
> {
  if (!dbUrl) return null;
  const postgres = (await import("postgres")).default;
  const sql = postgres(dbUrl, { max: 1 });
  return {
    executor: async (statement) => {
      if (!/^\s*SELECT\b/i.test(statement.sql)) {
        throw new Error(`Retrieval context executor refuses non-SELECT statement '${statement.name}'.`);
      }
      const rows = await sql.unsafe(statement.sql, preparePostgresJsParams(statement.params) as never[]);
      return Array.isArray(rows) ? rows.filter(isRecord) : [];
    },
    close: () => sql.end(),
  };
}

async function createExplicitPostgresEnrichContextExecutor(dbUrl: string | undefined): Promise<
  | {
      executor: EnrichContextQueryExecutor;
      close: () => Promise<void>;
    }
  | null
> {
  if (!dbUrl) return null;
  const postgres = (await import("postgres")).default;
  const sql = postgres(dbUrl, { max: 1 });
  return {
    executor: async (statement) => {
      if (!/^\s*SELECT\b/i.test(statement.sql)) {
        throw new Error(`Enrich context executor refuses non-SELECT statement '${statement.name}'.`);
      }
      const rows = await sql.unsafe(statement.sql, preparePostgresJsParams(statement.params) as never[]);
      return Array.isArray(rows) ? rows.filter(isRecord) : [];
    },
    close: () => sql.end(),
  };
}

async function writeStagingPayload(input: {
  payload: RawRecord;
  flags: Map<string, string>;
  outputRoot: string;
  deps: ExtractLessonOpenAiCliDeps;
}): Promise<RawRecord> {
  const ownedExecutor = input.deps.stagingStatementExecutor ? null : await createExplicitPostgresStagingExecutor(input.flags.get("db"));
  const executor = input.deps.stagingStatementExecutor ?? ownedExecutor?.executor;
  if (!executor) {
    throw new Error("--write-staging requires --db when no staging executor is injected.");
  }

  try {
    const datasetId = stringValue(input.payload.dataset_id) || input.flags.get("dataset-id") || basename(resolve(input.outputRoot));
    const lessonRunId = requiredPayloadString(input.payload, "lesson_run_id");
    const bookId = requiredPayloadString(input.payload, "book_id");
    const batchAnchor = requiredPayloadString(input.payload, "batch_anchor");
    const artifacts = normalizeLessonArtifacts(
      {
        nodes: recordArray(input.payload.nodes),
        edges: recordArray(input.payload.edges),
        domainProfiles: recordArray(input.payload.domain_profiles),
        mentions: recordArray(input.payload.mentions),
        evidence: recordArray(input.payload.evidence),
        nodeCards: recordArray(input.payload.node_cards),
      },
      bookId,
      batchAnchor,
    );
    const rows = buildStagingTableRows(
      {
        datasetId,
        lessonRunId,
        bookId,
        batchAnchor,
        now: utcNow(),
        lessonDisposition: parseLessonDisposition(input.payload.lesson_disposition),
        noKnowledgeReason: stringValue(input.payload.no_knowledge_reason).trim(),
        contentRole: parseContentRole(input.payload.content_role),
        extractionPolicy: parseExtractionPolicy(input.payload.extraction_policy),
        extractionIssues: stringArray(input.payload.issues),
      },
      artifacts,
    );
    const result = await storeStagingRows(rows, executor);
    return {
      ...input.payload,
      status: result.status,
      lesson_run_id: result.lesson_run_id,
      counts: result.counts,
      issues: [...stringArray(input.payload.issues), ...result.issues],
      staging: {
        status: result.status,
        dataset_id: datasetId,
        lesson_run_id: result.lesson_run_id,
        statements: result.executedStatements,
      },
    };
  } finally {
    await ownedExecutor?.close();
  }
}

function parseLessonDisposition(value: unknown): "extracted" | "no_knowledge" {
  return value === "no_knowledge" ? "no_knowledge" : "extracted";
}

function parseContentRole(value: unknown): "knowledge" | "summary" | "assessment" {
  if (value === "summary" || value === "assessment") return value;
  return "knowledge";
}

function parseExtractionPolicy(value: unknown): "canonical_knowledge" | "existing_nodes_only" {
  return value === "existing_nodes_only" ? value : "canonical_knowledge";
}

async function createExplicitPostgresStagingExecutor(dbUrl: string | undefined): Promise<
  | {
      executor: SqlExecutor;
      close: () => Promise<void>;
    }
  | null
> {
  if (!dbUrl) return null;
  const postgres = (await import("postgres")).default;
  const sql = postgres(dbUrl, { max: 1 });
  return {
    executor: async (statement) => {
      assertAllowedStagingStatement(statement.sql, statement.name);
      await sql.unsafe(statement.sql, preparePostgresJsParams(statement.params) as never[]);
    },
    close: () => sql.end(),
  };
}

function assertAllowedStagingStatement(sql: string, name: string): void {
  const trimmed = sql.trim();
  const allowed =
    /^(BEGIN|COMMIT|ROLLBACK)\b/i.test(trimmed) ||
    /^INSERT\s+INTO\s+world_lesson_runs\b/i.test(trimmed) ||
    /^DELETE\s+FROM\s+world_staging_(nodes|edges|domain_profiles|mentions|evidence|node_cards)\b/i.test(trimmed) ||
    /^INSERT\s+INTO\s+world_staging_(nodes|edges|domain_profiles|mentions|evidence|node_cards)\b/i.test(trimmed);
  if (!allowed) {
    throw new Error(`Staging executor refuses statement '${name}' outside world_lesson_runs/world_staging_*.`);
  }
}

function createEmbedQuery(
  flags: Map<string, string>,
  env: CliEnv,
  fetchImpl: typeof fetch,
): (queryText: string) => Promise<number[]> {
  const url = flags.get("embedding-url") ?? env.EMBEDDING_URL ?? DEFAULT_EMBEDDING_URL;
  const model = flags.get("embedding-model") ?? env.EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL;
  const apiKeyEnv = flags.get("embedding-api-key-env") ?? "EMBEDDING_API_KEY";
  const apiKey = (env[apiKeyEnv] ?? "").trim();
  if (!url.trim()) return async () => [];
  return async (queryText: string) => {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (apiKey) headers.Authorization = `Bearer ${apiKey}`;
    try {
      const response = await fetchImpl(url, {
        method: "POST",
        headers,
        body: JSON.stringify({ model, input: [queryText] }),
      });
      if (!response.ok) return [];
      const body = (await response.json()) as unknown;
      const vector = isRecord(body) && Array.isArray(body.data) && isRecord(body.data[0]) ? body.data[0].embedding : undefined;
      if (!Array.isArray(vector) || !vector.every((value) => typeof value === "number" && Number.isFinite(value))) return [];
      if (vector.length > EMBEDDING_DIMENSION) return vector.slice(0, EMBEDDING_DIMENSION);
      if (vector.length < EMBEDDING_DIMENSION) return [];
      return vector;
    } catch {
      return [];
    }
  };
}

function parseRetrievalMode(value: string | undefined): RetrievalMode {
  if (value === undefined || value === "hybrid") return "hybrid";
  if (value === "local" || value === "vector") return value;
  throw new Error(`Invalid --retrieval-mode '${value}'. Expected local, hybrid, or vector.`);
}

function parsePositiveInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`--${name} must be a positive integer.`);
  return parsed;
}

function parseNonNegativeInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`--${name} must be a non-negative integer.`);
  return parsed;
}

async function callModelExtractionRequestWithRetries<T>(
  request: Parameters<typeof callModelExtractionRequest>[0],
  apiKey: string,
  fetchImpl: typeof fetch,
  retryCount: number,
  parseResponse: (body: RawRecord) => T,
): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    try {
      return parseResponse(await callModelExtractionRequest(request, apiKey, fetchImpl));
    } catch (error) {
      lastError = error as Error;
      if (attempt >= retryCount || !isRetryableModelError(lastError)) break;
      await sleep(Math.min(2000 * (attempt + 1), 8000));
    }
  }
  throw lastError ?? new Error("Model request failed.");
}

function isRetryableModelError(error: Error): boolean {
  return /fetch failed|network|socket|timeout|aborted|429|500|502|503|504|no output_text payload/i.test(error.message);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function parseOptionalNumber(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`--${name} must be a number.`);
  return parsed;
}

function blockedPayload(issue: string): ExtractLessonOpenAiErrorPayload {
  return { status: "blocked", issues: [issue] };
}

function utcNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

function requiredPayloadString(payload: RawRecord, key: string): string {
  const value = stringValue(payload[key]).trim();
  if (!value) throw new Error(`Extraction payload missing '${key}'.`);
  return value;
}

function recordArray(value: unknown): RawRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(stringValue).filter(Boolean) : [];
}

function stringValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function writeJson(stdout: (text: string) => void, value: unknown, pretty: boolean): void {
  stdout(`${JSON.stringify(value, null, pretty ? 2 : undefined)}\n`);
}

function required(flags: Map<string, string>, name: string): string {
  const value = flags.get(name);
  if (value === undefined) throw new Error(`Missing required option --${name}.`);
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

if (isMainModule(import.meta.url)) {
  raise(main(process.argv.slice(2)));
}

function raise(promise: Promise<number>): void {
  promise.then((code) => {
    process.exitCode = code;
  });
}
