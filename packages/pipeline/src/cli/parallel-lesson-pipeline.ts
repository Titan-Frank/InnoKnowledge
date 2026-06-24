#!/usr/bin/env node

import {
  buildMarkLessonRunsQaPassedStatement,
  buildSelectMergedLessonRunIdsStatement,
  runParallelLessonPipeline,
  type LessonRunSelectionQuery,
  type PipelineSqlStatement,
} from "../extraction/parallel-lesson-pipeline.js";

async function main(argv: string[]): Promise<number> {
  let closeStore: (() => Promise<void>) | undefined;
  try {
    const flags = parseFlags(argv);
    const dbUrl = flags.get("db") ?? process.env.DATABASE_URL ?? "";
    if (!dbUrl) throw new Error("Running the parallel lesson pipeline requires --db or DATABASE_URL.");

    const store = await createPostgresLessonRunStore(dbUrl);
    closeStore = store?.close;
    const output = await runParallelLessonPipeline({
      root: required(flags, "root"),
      dbUrl,
      datasetId: flags.get("dataset-id"),
      bookId: flags.get("book-id"),
      batchAnchors: flags.getAll("batch-anchor"),
      lessonRunIds: flags.getAll("lesson-run-id"),
      similarityThreshold: parseNumber(flags.get("similarity-threshold"), "similarity-threshold"),
      embeddingThreshold: parseNumber(flags.get("embedding-threshold"), "embedding-threshold"),
      reviewThreshold: parseNumber(flags.get("review-threshold"), "review-threshold"),
      normalizeAutoMerge: flags.has("normalize-auto-merge"),
      skipNormalize: flags.has("skip-normalize"),
      skipQa: flags.has("skip-qa"),
      skipIntegrity: flags.has("skip-integrity"),
      repoRoot: flags.get("repo-root"),
      nodeExecutable: flags.get("node"),
      selectLessonRunIds: store?.selectLessonRunIds,
      markQaPassed: store?.markQaPassed,
    });
    process.stdout.write(`${JSON.stringify(output)}\n`);
    return output.status === "blocked" ? 2 : 0;
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 1;
  } finally {
    await closeStore?.();
  }
}

type RawRecord = Record<string, unknown>;

async function createPostgresLessonRunStore(dbUrl: string): Promise<{
  selectLessonRunIds: (input: LessonRunSelectionQuery) => Promise<string[]>;
  markQaPassed: (input: { datasetId: string; lessonRunIds: string[] }) => Promise<number>;
  close: () => Promise<void>;
}> {
  const postgres = (await import("postgres")).default;
  const sql = postgres(dbUrl, { max: 1 });
  return {
    selectLessonRunIds: async (input) => {
      const statement = buildSelectMergedLessonRunIdsStatement(input);
      assertSelectStatement(statement);
      const rows = (await sql.unsafe(statement.sql, statement.params as never[])) as RawRecord[];
      return rows.map((row) => row.lesson_run_id).filter((value): value is string => typeof value === "string" && value.length > 0);
    },
    markQaPassed: async (input) => {
      if (input.lessonRunIds.length === 0) return 0;
      const statement = buildMarkLessonRunsQaPassedStatement({
        ...input,
        now: new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00"),
      });
      assertAllowedQaStatusWrite(statement);
      const result = (await sql.unsafe(statement.sql, statement.params as never[])) as unknown as { count?: number };
      return typeof result.count === "number" ? result.count : input.lessonRunIds.length;
    },
    close: async () => {
      await sql.end();
    },
  };
}

function assertSelectStatement(statement: PipelineSqlStatement): void {
  if (!/^\s*SELECT\b/i.test(statement.sql)) {
    throw new Error(`Parallel lesson pipeline refuses non-SELECT statement '${statement.name}'.`);
  }
}

function assertAllowedQaStatusWrite(statement: PipelineSqlStatement): void {
  if (!/^\s*UPDATE\s+world_lesson_runs\b/i.test(statement.sql)) {
    throw new Error(`Parallel lesson pipeline refuses statement '${statement.name}' outside lesson run QA status updates.`);
  }
}

class MultiFlags {
  private readonly values = new Map<string, string[]>();

  add(name: string, value: string): void {
    const list = this.values.get(name) ?? [];
    list.push(value);
    this.values.set(name, list);
  }

  get(name: string): string | undefined {
    return this.values.get(name)?.at(-1);
  }

  getAll(name: string): string[] {
    return [...(this.values.get(name) ?? [])];
  }

  has(name: string): boolean {
    return this.values.has(name);
  }
}

function parseFlags(argv: string[]): MultiFlags {
  const flags = new MultiFlags();
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index]!;
    if (!raw.startsWith("--")) throw new Error(`Unexpected argument '${raw}'.`);
    const withoutPrefix = raw.slice(2);
    const equalsIndex = withoutPrefix.indexOf("=");
    if (equalsIndex >= 0) {
      flags.add(withoutPrefix.slice(0, equalsIndex), withoutPrefix.slice(equalsIndex + 1));
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      flags.add(withoutPrefix, "true");
      continue;
    }
    flags.add(withoutPrefix, next);
    index += 1;
  }
  return flags;
}

function required(flags: MultiFlags, name: string): string {
  const value = flags.get(name);
  if (value === undefined) throw new Error(`Missing required option --${name}.`);
  return value;
}

function parseNumber(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`--${name} must be a number.`);
  return parsed;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  raise(main(process.argv.slice(2)));
}

function raise(promise: Promise<number>): void {
  promise.then((code) => {
    process.exitCode = code;
  });
}
