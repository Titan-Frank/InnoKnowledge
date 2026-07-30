#!/usr/bin/env node

import { isMainModule } from "../shared/cli-entry.js";

import { preparePostgresJsParams } from "../shared/postgres-executor.js";
import { runStagingQualityFromDatabase } from "../staging/staging-quality.js";
import type { SqlStatement } from "../staging/staging-sql.js";

async function main(argv: string[]): Promise<number> {
  try {
    const flags = parseFlags(argv);
    const dbUrl = required(flags, "db");
    const output = await runDatabaseMode(flags, dbUrl);
    process.stdout.write(`${JSON.stringify(output, null, hasFlag(flags, "pretty") ? 2 : undefined)}\n`);
    return output.status === "success" ? 0 : 2;
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 1;
  }
}

type RawRecord = Record<string, unknown>;
type ParsedFlags = Map<string, string[]>;

async function runDatabaseMode(flags: ParsedFlags, dbUrl: string): Promise<Awaited<ReturnType<typeof runStagingQualityFromDatabase>>> {
  const postgres = (await import("postgres")).default;
  const sql = postgres(dbUrl, { max: 1 });
  try {
    return await runStagingQualityFromDatabase({
      datasetId: required(flags, "dataset-id"),
      filter: {
        bookId: getLast(flags, "book-id"),
        lessonRunIds: getAll(flags, "lesson-run-id"),
        batchAnchors: getAll(flags, "batch-anchor"),
      },
      warnOnly: hasFlag(flags, "warn-only"),
      now: getLast(flags, "now"),
      query: async (statement) => {
        assertSelectStatement(statement);
        const rows = await sql.unsafe(statement.sql, preparePostgresParamsForStatement(statement) as never[]);
        return Array.isArray(rows) ? rows.filter(isRecord) : [];
      },
      executeStatement: async (statement) => {
        assertAllowedStagingQualityWriteStatement(statement);
        await sql.unsafe(statement.sql, preparePostgresParamsForStatement(statement) as never[]);
      },
    });
  } finally {
    await sql.end();
  }
}

function parseFlags(argv: string[]): ParsedFlags {
  const flags: ParsedFlags = new Map();
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

function pushFlag(flags: ParsedFlags, name: string, value: string): void {
  const current = flags.get(name) ?? [];
  current.push(value);
  flags.set(name, current);
}

function required(flags: ParsedFlags, name: string): string {
  const value = getLast(flags, name);
  if (value === undefined || value.trim() === "") throw new Error(`Missing required option --${name}.`);
  return value;
}

function getLast(flags: ParsedFlags, name: string): string | undefined {
  return flags.get(name)?.at(-1);
}

function getAll(flags: ParsedFlags, name: string): string[] | undefined {
  const values = flags.get(name)?.filter((value) => value.trim() !== "");
  return values && values.length > 0 ? values : undefined;
}

function hasFlag(flags: ParsedFlags, name: string): boolean {
  return flags.has(name);
}

function preparePostgresParamsForStatement(statement: SqlStatement): unknown[] {
  return preparePostgresJsParams(statement.params);
}

function assertSelectStatement(statement: SqlStatement): void {
  if (!/^\s*SELECT\b/i.test(statement.sql)) {
    throw new Error(`Staging quality query executor refuses non-SELECT statement '${statement.name}'.`);
  }
}

function assertAllowedStagingQualityWriteStatement(statement: SqlStatement): void {
  const trimmed = statement.sql.trim();
  const allowed =
    /^UPDATE\s+world_lesson_runs\s+SET\b/is.test(trimmed) &&
    /\bproperties_json\s*=/is.test(trimmed) &&
    /'quality_issues'/.test(trimmed) &&
    /'quality_warnings'/.test(trimmed) &&
    /'quality_review_required'/.test(trimmed) &&
    /'review_node_ids'/.test(trimmed);
  if (!allowed) {
    throw new Error(`Staging quality executor refuses statement '${statement.name}' outside quality status updates.`);
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
