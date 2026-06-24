#!/usr/bin/env node

import { embedTextsOpenAICompatible, DEFAULT_EMBEDDING_MODEL, DEFAULT_EMBEDDING_URL, runEmbeddingBackfillFromDatabase, type EmbeddingBackfillMode } from "../shared/embeddings.js";
import { preparePostgresParams } from "../shared/postgres-executor.js";
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

async function runDatabaseMode(flags: Map<string, string>, dbUrl: string): Promise<Awaited<ReturnType<typeof runEmbeddingBackfillFromDatabase>>> {
  const postgres = (await import("postgres")).default;
  const sql = postgres(dbUrl, { max: 1 });
  try {
    return await runEmbeddingBackfillFromDatabase({
      table: parseTable(flags.get("table") ?? "both"),
      batchSize: parsePositiveInteger(flags.get("batch-size"), 32),
      sleepBetweenBatchesMs: parseNonNegativeInteger(flags.get("sleep-between-batches-ms"), 500),
      query: async (statement) => {
        assertSelectStatement(statement);
        const rows = await sql.unsafe(statement.sql, preparePostgresParams(statement.params) as never[]);
        return Array.isArray(rows) ? rows.filter(isRecord) : [];
      },
      executeStatement: async (statement) => {
        assertAllowedEmbeddingWriteStatement(statement);
        await sql.unsafe(statement.sql, preparePostgresParams(statement.params) as never[]);
      },
      embedTexts: (texts) =>
        embedTextsOpenAICompatible(texts, {
          url: flags.get("embedding-url") ?? DEFAULT_EMBEDDING_URL,
          model: flags.get("embedding-model") ?? DEFAULT_EMBEDDING_MODEL,
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

function parseTable(value: string): EmbeddingBackfillMode {
  if (value === "world_nodes" || value === "world_staging_nodes" || value === "both") return value;
  throw new Error(`Unsupported table '${value}'.`);
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
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

function assertSelectStatement(statement: SqlStatement): void {
  if (!/^\s*SELECT\b/i.test(statement.sql)) {
    throw new Error(`Embedding backfill query executor refuses non-SELECT statement '${statement.name}'.`);
  }
}

function assertAllowedEmbeddingWriteStatement(statement: SqlStatement): void {
  const trimmed = statement.sql.trim();
  if (!/^UPDATE\s+(world_nodes|world_staging_nodes)\s+SET\s+embedding\s*=\s*\$1::vector\s+WHERE\s+(id|raw_node_id)\s*=\s*\$2$/i.test(trimmed)) {
    throw new Error(`Embedding backfill executor refuses statement '${statement.name}' outside embedding updates.`);
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
