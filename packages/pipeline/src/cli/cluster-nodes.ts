#!/usr/bin/env node

import { runClusterNodesFromDatabase } from "../shared/cluster-nodes.js";
import { preparePostgresJsParams } from "../shared/postgres-executor.js";
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

async function runDatabaseMode(flags: Map<string, string>, dbUrl: string): Promise<Awaited<ReturnType<typeof runClusterNodesFromDatabase>>> {
  const postgres = (await import("postgres")).default;
  const sql = postgres(dbUrl, { max: 1 });
  try {
    return await runClusterNodesFromDatabase({
      datasetId: required(flags, "dataset-id"),
      seed: parseInteger(flags.get("seed"), 42),
      fixedK: parseOptionalInteger(flags.get("fixed-k"), "fixed-k"),
      query: async (statement) => {
        assertSelectStatement(statement);
        const rows = await sql.unsafe(statement.sql, preparePostgresJsParams(statement.params) as never[]);
        return Array.isArray(rows) ? rows.filter(isRecord) : [];
      },
      executeStatement: async (statement) => {
        assertAllowedClusterWriteStatement(statement);
        await sql.unsafe(statement.sql, preparePostgresJsParams(statement.params) as never[]);
      },
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

function required(flags: Map<string, string>, name: string): string {
  const value = flags.get(name);
  if (value === undefined || value.trim() === "") throw new Error(`Missing required option --${name}.`);
  return value;
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) throw new Error(`Invalid integer: ${value}`);
  return parsed;
}

function parseOptionalInteger(value: string | undefined, name: string): number | null {
  if (value === undefined || value === "") return null;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`Invalid positive integer for --${name}: ${value}`);
  return parsed;
}

function assertSelectStatement(statement: SqlStatement): void {
  if (!/^\s*SELECT\b/i.test(statement.sql)) {
    throw new Error(`Cluster nodes query executor refuses non-SELECT statement '${statement.name}'.`);
  }
}

function assertAllowedClusterWriteStatement(statement: SqlStatement): void {
  const trimmed = statement.sql.trim();
  if (!/^UPDATE\s+world_nodes\s+SET\s+properties_json\s*=\s*\$1::jsonb\s+WHERE\s+dataset_id\s*=\s*\$2\s+AND\s+id\s*=\s*\$3$/i.test(trimmed)) {
    throw new Error(`Cluster nodes executor refuses statement '${statement.name}' outside layout updates.`);
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
