#!/usr/bin/env node

import { isMainModule } from "../shared/cli-entry.js";

import { existsSync, readFileSync } from "node:fs";

import { DEFAULT_EMBEDDING_MODEL, DEFAULT_EMBEDDING_URL, embedTextsOpenAICompatible } from "../shared/embeddings.js";
import { preparePostgresJsParams } from "../shared/postgres-executor.js";
import { loadRetrievalQueries, type RetrievalMode, type RetrievalQuery } from "../retrieval/retrieve-candidates.js";
import { runRetrieveCandidatesFromDatabase } from "../retrieval/retrieve-candidates-store.js";
import type { SqlStatement } from "../staging/staging-sql.js";

const VALID_MODES = new Set(["local", "hybrid", "vector"]);

async function main(argv: string[]): Promise<number> {
  try {
    const flags = parseFlags(argv);
    const datasetId = required(flags, "dataset-id");
    const mode = parseMode(flags.get("mode"));
    const limit = parseLimit(flags.get("limit"));
    const output = await runDatabaseMode(flags, flags.get("db") ?? process.env.DATABASE_URL, datasetId, mode, limit);
    process.stdout.write(`${JSON.stringify(output, null, flags.has("pretty") ? 2 : undefined)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 1;
  }
}

type RawRecord = Record<string, unknown>;

async function runDatabaseMode(
  flags: Map<string, string>,
  dbUrl: string | undefined,
  datasetId: string,
  mode: RetrievalMode | undefined,
  limit: number | undefined,
): Promise<Awaited<ReturnType<typeof runRetrieveCandidatesFromDatabase>>> {
  if (!dbUrl) throw new Error("retrieve-candidates requires --db or DATABASE_URL.");
  const postgres = (await import("postgres")).default;
  const sql = postgres(dbUrl, { max: 1 });
  try {
    return await runRetrieveCandidatesFromDatabase({
      datasetId,
      batchAnchor: required(flags, "batch-anchor"),
      queries: loadQueries(flags),
      mode,
      domain: flags.get("domain"),
      schoolStage: flags.get("school-stage"),
      nodeKind: flags.get("node-kind"),
      limit,
      vectorMinSimilarity: parseOptionalNumber(flags.get("vector-min-similarity"), "vector-min-similarity") ?? 0.5,
      replace: flags.has("replace"),
      query: async (statement) => {
        assertSelectStatement(statement);
        const rows = await sql.unsafe(statement.sql, preparePostgresJsParams(statement.params) as never[]);
        return Array.isArray(rows) ? rows.filter(isRecord) : [];
      },
      executeStatement: async (statement) => {
        assertAllowedRetrievalWriteStatement(statement);
        await sql.unsafe(statement.sql, preparePostgresJsParams(statement.params) as never[]);
      },
      embedQuery:
        mode === "local"
          ? undefined
          : async (queryText) => {
              const vectors = await embedTextsOpenAICompatible([queryText], {
                url: flags.get("embedding-url") ?? process.env.EMBEDDING_URL ?? DEFAULT_EMBEDDING_URL,
                model: flags.get("embedding-model") ?? process.env.EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL,
                apiKey: process.env[flags.get("embedding-api-key-env") ?? "EMBEDDING_API_KEY"] ?? "",
              });
              return vectors[0] ?? [];
            },
    });
  } finally {
    await sql.end();
  }
}

function loadQueries(flags: Map<string, string>): RetrievalQuery[] {
  if (flags.get("queries-json")) return parseQueriesJson(flags.get("queries-json")!);
  return loadRetrievalQueries({
    queries: flags.get("query") ? [flags.get("query")!] : undefined,
    queriesFileText: loadQueriesFileText(flags.get("queries-file")),
    queriesFileKind: queriesFileKind(flags.get("queries-file")),
  });
}

function parseQueriesJson(value: string): RetrievalQuery[] {
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || !parsed.every(isRecord)) throw new Error("Invalid queries-json: expected a JSON array of objects.");
  return parsed.map((row) => ({
    query_text: requiredRecordString(row, "query_text", "queries-json"),
    query_id: typeof row.query_id === "string" ? row.query_id : undefined,
  }));
}

function loadQueriesFileText(path: string | undefined): string | null {
  if (!path) return null;
  if (!existsSync(path)) throw new Error(`queries-file not found: ${path}`);
  return readFileSync(path, "utf8");
}

function queriesFileKind(path: string | undefined): "jsonl" | "text" | null {
  if (!path) return null;
  return path.endsWith(".jsonl") ? "jsonl" : "text";
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

function parseOptionalNumber(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`--${name} must be a number.`);
  return parsed;
}

function assertSelectStatement(statement: SqlStatement): void {
  if (!/^\s*SELECT\b/i.test(statement.sql)) {
    throw new Error(`Retrieve candidates query executor refuses non-SELECT statement '${statement.name}'.`);
  }
}

function assertAllowedRetrievalWriteStatement(statement: SqlStatement): void {
  const trimmed = statement.sql.trim();
  if (!/^(DELETE\s+FROM\s+retrieval_candidates|INSERT\s+INTO\s+retrieval_candidates)\b/i.test(trimmed)) {
    throw new Error(`Retrieve candidates executor refuses statement '${statement.name}' outside retrieval candidate writes.`);
  }
}

function requiredRecordString(row: RawRecord, key: string, name: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`Invalid ${name}: row is missing string field '${key}'.`);
  return value;
}

function parseMode(value: string | undefined): RetrievalMode | undefined {
  if (value === undefined) return undefined;
  if (!VALID_MODES.has(value)) throw new Error(`Invalid --mode '${value}'. Expected local, hybrid, or vector.`);
  return value as RetrievalMode;
}

function parseLimit(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const limit = Number(value);
  if (!Number.isInteger(limit) || limit < 1) throw new Error("--limit must be a positive integer.");
  return limit;
}

function isRecord(value: unknown): value is RawRecord {
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
