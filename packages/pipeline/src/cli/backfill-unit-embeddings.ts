#!/usr/bin/env node

import { isMainModule } from "../shared/cli-entry.js";

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_EMBEDDING_URL,
  embedTextsOpenAICompatible,
} from "../shared/embeddings.js";
import { REPO_ROOT } from "../shared/pathing.js";
import { preparePostgresJsParams } from "../shared/postgres-executor.js";
import type { SqlStatement } from "../staging/staging-sql.js";
import {
  runUnitEmbeddingBackfillFromDatabase,
  type UnitEmbeddingDatabaseOutput,
} from "../unit-embeddings/unit-embeddings.js";

type RawRecord = Record<string, unknown>;

async function main(argv: string[]): Promise<number> {
  try {
    loadDotenvFile(resolve(REPO_ROOT, ".env"));
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

async function runDatabaseMode(flags: Map<string, string>, dbUrl: string): Promise<UnitEmbeddingDatabaseOutput> {
  const postgres = (await import("postgres")).default;
  const sql = postgres(dbUrl, { max: 1 });
  const embeddingModel = flags.get("embedding-model") ?? process.env.EMBEDDING_MODEL ?? DEFAULT_EMBEDDING_MODEL;
  try {
    return await runUnitEmbeddingBackfillFromDatabase({
      datasetId: flags.get("dataset-id") ?? flags.get("source") ?? "main",
      batchSize: parsePositiveInteger(flags.get("batch-size"), 8),
      limit: parseOptionalPositiveInteger(flags.get("limit"), "limit"),
      force: flags.has("force"),
      embeddingModel,
      query: async (statement) => {
        assertSelectStatement(statement);
        const rows = await sql.unsafe(statement.sql, preparePostgresJsParams(statement.params) as never[]);
        return Array.isArray(rows) ? rows.filter(isRecord) : [];
      },
      executeStatement: async (statement) => {
        assertAllowedUnitEmbeddingWriteStatement(statement);
        await sql.unsafe(statement.sql, preparePostgresJsParams(statement.params) as never[]);
      },
      embedTexts: (texts) =>
        embedTextsOpenAICompatible(texts, {
          url: flags.get("embedding-url") ?? process.env.EMBEDDING_URL ?? DEFAULT_EMBEDDING_URL,
          model: embeddingModel,
          apiKey: process.env[flags.get("embedding-api-key-env") ?? "EMBEDDING_API_KEY"] ?? "",
          maxRetries: parsePositiveInteger(flags.get("max-retries"), 3),
          retryDelayMs: parseNonNegativeInteger(flags.get("retry-delay-ms"), 2000),
          timeoutMs: parsePositiveInteger(flags.get("timeout-ms"), 30000),
        }),
    });
  } finally {
    await sql.end();
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

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`Invalid positive integer: ${value}`);
  return parsed;
}

function parseOptionalPositiveInteger(value: string | undefined, name: string): number | null {
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`--${name} must be a positive integer.`);
  return parsed;
}

function parseNonNegativeInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`Invalid non-negative integer: ${value}`);
  return parsed;
}

function assertSelectStatement(statement: SqlStatement): void {
  if (!/^\s*SELECT\b/i.test(statement.sql)) {
    throw new Error(`Unit embedding query executor refuses non-SELECT statement '${statement.name}'.`);
  }
}

function assertAllowedUnitEmbeddingWriteStatement(statement: SqlStatement): void {
  const trimmed = statement.sql.trim();
  if (!/^INSERT\s+INTO\s+world_unit_embeddings\b[\s\S]+ON\s+CONFLICT\s+\(dataset_id,\s*node_id\)\s+DO\s+UPDATE\s+SET/i.test(trimmed)) {
    throw new Error(`Unit embedding executor refuses statement '${statement.name}' outside world_unit_embeddings upserts.`);
  }
}

function loadDotenvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const [key, ...rest] = line.split("=");
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = unquote(rest.join("=").trim());
  }
}

function unquote(value: string): string {
  const trimmed = value.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
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
