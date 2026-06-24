#!/usr/bin/env node

import { runGraphIntegrityFromDatabase } from "../qa/qa-store.js";
import type { SqlStatement } from "../staging/staging-sql.js";

async function main(argv: string[]): Promise<number> {
  try {
    const flags = parseFlags(argv);
    const output = await runDatabaseMode(flags, required(flags, "db"));
    process.stdout.write(`${JSON.stringify(output, null, hasFlag(flags, "pretty") ? 2 : undefined)}\n`);
    return output.status === "success" ? 0 : 2;
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 1;
  }
}

type RawRecord = Record<string, unknown>;
type Flags = Map<string, string[]>;

async function runDatabaseMode(flags: Flags, dbUrl: string): Promise<Awaited<ReturnType<typeof runGraphIntegrityFromDatabase>>> {
  const postgres = (await import("postgres")).default;
  const sql = postgres(dbUrl, { max: 1 });
  try {
    return await runGraphIntegrityFromDatabase({
      datasetId: required(flags, "dataset-id"),
      failOnCycles: hasFlag(flags, "fail-on-cycles"),
      markQaPassed: hasFlag(flags, "mark-qa-passed"),
      now: getFlag(flags, "now"),
      lessonRunFilter: {
        bookId: getFlag(flags, "book-id"),
        lessonRunIds: getAllFlags(flags, "lesson-run-id"),
        batchAnchors: getAllFlags(flags, "batch-anchor"),
      },
      query: async (statement) => {
        assertSelectStatement(statement);
        const rows = await sql.unsafe(statement.sql, statement.params as never[]);
        return Array.isArray(rows) ? rows.filter(isRecord) : [];
      },
      executeStatement: async (statement) => {
        assertAllowedGraphWriteStatement(statement);
        await sql.unsafe(statement.sql, statement.params as never[]);
      },
    });
  } finally {
    await sql.end();
  }
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index]!;
    if (!raw.startsWith("--")) throw new Error(`Unexpected argument '${raw}'.`);
    const withoutPrefix = raw.slice(2);
    const equalsIndex = withoutPrefix.indexOf("=");
    if (equalsIndex >= 0) {
      pushFlag(flags, withoutPrefix.slice(0, equalsIndex), withoutPrefix.slice(equalsIndex + 1));
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      pushFlag(flags, withoutPrefix, "true");
      continue;
    }
    pushFlag(flags, withoutPrefix, next);
    index += 1;
  }
  return flags;
}

function pushFlag(flags: Flags, name: string, value: string): void {
  flags.set(name, [...(flags.get(name) ?? []), value]);
}

function getFlag(flags: Flags, name: string): string | undefined {
  return flags.get(name)?.at(-1);
}

function getAllFlags(flags: Flags, name: string): string[] {
  return [...(flags.get(name) ?? [])];
}

function hasFlag(flags: Flags, name: string): boolean {
  return flags.has(name);
}

function required(flags: Flags, name: string): string {
  const value = getFlag(flags, name);
  if (value === undefined) throw new Error(`Missing required option --${name}.`);
  return value;
}

function assertSelectStatement(statement: SqlStatement): void {
  if (!/^\s*SELECT\b/i.test(statement.sql)) {
    throw new Error(`Graph integrity query executor refuses non-SELECT statement '${statement.name}'.`);
  }
}

function assertAllowedGraphWriteStatement(statement: SqlStatement): void {
  const trimmed = statement.sql.trim();
  if (!/^UPDATE\s+world_lesson_runs\b/i.test(trimmed)) {
    throw new Error(`Graph integrity executor refuses statement '${statement.name}' outside QA status updates.`);
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
