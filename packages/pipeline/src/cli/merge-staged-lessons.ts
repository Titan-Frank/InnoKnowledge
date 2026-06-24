#!/usr/bin/env node

import { runMergeStagedLessonsFromDatabase } from "../merge/merge-staged-lessons-runner.js";
import { preparePostgresParams } from "../shared/postgres-executor.js";
import type { SqlStatement } from "../staging/staging-sql.js";

async function main(argv: string[]): Promise<number> {
  try {
    const flags = parseFlags(argv);
    const dbUrl = required(flags, "db");
    const output = await runDatabaseMode(flags, dbUrl);
    process.stdout.write(`${JSON.stringify(output, null, hasFlag(flags, "pretty") ? 2 : undefined)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 1;
  }
}

type Flags = Map<string, string[]>;
type RawRecord = Record<string, unknown>;

async function runDatabaseMode(flags: Flags, dbUrl: string): Promise<unknown> {
  if (hasFlag(flags, "lessons-json")) {
    throw new Error("Merge reads staged lessons from PostgreSQL; omit --lessons-json.");
  }
  const postgres = (await import("postgres")).default;
  const sql = postgres(dbUrl, { max: 1 });
  try {
    return await runMergeStagedLessonsFromDatabase({
      datasetId: required(flags, "dataset-id"),
      bookId: getFlag(flags, "book-id"),
      batchAnchors: getAllFlags(flags, "batch-anchor"),
      lessonRunIds: getAllFlags(flags, "lesson-run-id"),
      mergeRunId: getFlag(flags, "merge-run-id"),
      similarityThreshold: parseOptionalNumber(getFlag(flags, "similarity-threshold"), "similarity-threshold"),
      embeddingThreshold: parseOptionalNumber(getFlag(flags, "embedding-threshold"), "embedding-threshold"),
      reviewThreshold: parseOptionalNumber(getFlag(flags, "review-threshold"), "review-threshold"),
      now: getFlag(flags, "now"),
      query: async (statement) => {
        assertSelectStatement(statement);
        const rows = await sql.unsafe(statement.sql, preparePostgresParamsForStatement(statement) as never[]);
        return Array.isArray(rows) ? rows.filter(isRecord) : [];
      },
      executeStatement: async (statement) => {
        assertAllowedMergeWriteStatement(statement);
        await sql.unsafe(statement.sql, preparePostgresParamsForStatement(statement) as never[]);
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
  return flags.get(name) ?? [];
}

function hasFlag(flags: Flags, name: string): boolean {
  return flags.has(name);
}

function required(flags: Flags, name: string): string {
  const value = getFlag(flags, name);
  if (value === undefined) throw new Error(`Missing required option --${name}.`);
  return value;
}

function parseOptionalNumber(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`--${name} must be a finite number.`);
  return parsed;
}

function preparePostgresParamsForStatement(statement: SqlStatement): unknown[] {
  return statement.params.map((param, index) => {
    if (placeholderCastsToJsonb(statement.sql, index + 1)) {
      return preparePostgresParams([param])[0];
    }
    return param;
  });
}

function placeholderCastsToJsonb(sql: string, index: number): boolean {
  return new RegExp(`\\$${index}\\s*::\\s*jsonb`, "i").test(sql);
}

function assertSelectStatement(statement: SqlStatement): void {
  if (!/^\s*SELECT\b/i.test(statement.sql)) {
    throw new Error(`Merge query executor refuses non-SELECT statement '${statement.name}'.`);
  }
}

function assertAllowedMergeWriteStatement(statement: SqlStatement): void {
  const trimmed = statement.sql.trim();
  const allowed =
    /^(INSERT|UPDATE|DELETE)\s+/i.test(trimmed) &&
    /\b(world_lesson_runs|world_nodes|world_edges|world_domain_profiles|world_mentions|world_evidence|world_node_cards|world_canonical_node_map|world_merge_runs|world_evidence_links|world_node_terms)\b/i.test(
      trimmed,
    );
  if (!allowed) {
    throw new Error(`Merge executor refuses statement '${statement.name}' outside canonical merge tables.`);
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
