#!/usr/bin/env node

import { isMainModule } from "../shared/cli-entry.js";

import { runQualityDashboardFromDatabase } from "../qa/quality-dashboard.js";
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

async function runDatabaseMode(flags: Map<string, string>, dbUrl: string): Promise<Awaited<ReturnType<typeof runQualityDashboardFromDatabase>>> {
  const postgres = (await import("postgres")).default;
  const sql = postgres(dbUrl, { max: 1 });
  try {
    return await runQualityDashboardFromDatabase({
      datasetId: required(flags, "dataset-id"),
      now: flags.get("now"),
      query: async (statement) => {
        assertSelectStatement(statement);
        const rows = await sql.unsafe(statement.sql, statement.params as never[]);
        return Array.isArray(rows) ? rows.filter(isRecord) : [];
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

function assertSelectStatement(statement: SqlStatement): void {
  if (!/^\s*SELECT\b/i.test(statement.sql)) {
    throw new Error(`Quality dashboard query executor refuses non-SELECT statement '${statement.name}'.`);
  }
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
