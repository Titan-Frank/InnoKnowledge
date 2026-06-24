#!/usr/bin/env node

import { runNormalizeFromDatabase } from "../normalize/normalize-store.js";
import { preparePostgresParams } from "../shared/postgres-executor.js";
import type { SqlStatement } from "../staging/staging-sql.js";

async function main(argv: string[]): Promise<number> {
  try {
    const flags = parseFlags(argv);
    const output = await runDatabaseMode(flags, required(flags, "db"));
    process.stdout.write(`${JSON.stringify(output, null, flags.has("pretty") ? 2 : undefined)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 1;
  }
}

type RawRecord = Record<string, unknown>;

async function runDatabaseMode(flags: Map<string, string>, dbUrl: string): Promise<unknown> {
  const postgres = (await import("postgres")).default;
  const sql = postgres(dbUrl, { max: 1 });
  try {
    return await runNormalizeFromDatabase({
      datasetId: required(flags, "dataset-id"),
      now: flags.get("now"),
      query: async (statement) => {
        assertSelectStatement(statement);
        const rows = await sql.unsafe(statement.sql, preparePostgresParamsForStatement(statement) as never[]);
        return Array.isArray(rows) ? rows.filter(isRecord) : [];
      },
      executeStatement: async (statement) => {
        assertAllowedNormalizeWriteStatement(statement);
        await sql.unsafe(statement.sql, preparePostgresParamsForStatement(statement) as never[]);
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
  if (value === undefined) throw new Error(`Missing required option --${name}.`);
  return value;
}

function preparePostgresParamsForStatement(statement: SqlStatement): unknown[] {
  return statement.params.map((param, index) => (placeholderCastsToJsonb(statement.sql, index + 1) ? preparePostgresParams([param])[0] : param));
}

function placeholderCastsToJsonb(sql: string, index: number): boolean {
  return new RegExp(`\\$${index}\\s*::\\s*jsonb`, "i").test(sql);
}

function assertSelectStatement(statement: SqlStatement): void {
  if (!/^\s*SELECT\b/i.test(statement.sql)) {
    throw new Error(`Normalize query executor refuses non-SELECT statement '${statement.name}'.`);
  }
}

function assertAllowedNormalizeWriteStatement(statement: SqlStatement): void {
  const trimmed = statement.sql.trim();
  const allowed =
    /^(INSERT|UPDATE|DELETE)\s+/i.test(trimmed) &&
    /\b(world_node_cards|world_domain_profiles|world_mentions|world_evidence_links|world_edges|world_node_terms)\b/i.test(trimmed);
  if (!allowed) {
    throw new Error(`Normalize executor refuses statement '${statement.name}' outside normalize tables.`);
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
