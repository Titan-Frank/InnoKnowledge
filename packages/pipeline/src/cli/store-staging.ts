#!/usr/bin/env node

import { runStoreStaging, type StoreStagingInput } from "../staging/staging-store.js";
import { preparePostgresJsParams } from "../shared/postgres-executor.js";
import type { SqlStatement } from "../staging/staging-sql.js";

const REQUIRED_FLAGS = [
  "root",
  "book-id",
  "batch-anchor",
  "nodes-json",
  "edges-json",
  "domain-profiles-json",
  "mentions-json",
  "evidence-json",
  "node-cards-json",
] as const;

async function main(argv: string[]): Promise<number> {
  try {
    const flags = parseFlags(argv);
    for (const flag of REQUIRED_FLAGS) {
      if (!flags.has(flag)) {
      throw new Error(`Missing required option --${flag}.`);
      }
    }
    const executor = await createExecuteStatement(flags.get("db") ?? process.env.DATABASE_URL);

    const input: StoreStagingInput = {
      root: required(flags, "root"),
      bookId: required(flags, "book-id"),
      batchAnchor: required(flags, "batch-anchor"),
      lessonRunId: flags.get("lesson-run-id"),
      datasetId: flags.get("dataset-id"),
      nodesJson: required(flags, "nodes-json"),
      edgesJson: required(flags, "edges-json"),
      domainProfilesJson: required(flags, "domain-profiles-json"),
      mentionsJson: required(flags, "mentions-json"),
      evidenceJson: required(flags, "evidence-json"),
      nodeCardsJson: required(flags, "node-cards-json"),
      resolveOutline: !flags.has("no-resolve-outline"),
      skipIntegrityCheck: flags.has("skip-integrity-check"),
      executeStatement: executor.execute,
    };

    try {
      const output = await runStoreStaging(input);
      process.stdout.write(`${JSON.stringify(output, null, flags.has("pretty") ? 2 : undefined)}\n`);
      return output.status === "success" ? 0 : 2;
    } finally {
      await executor?.close();
    }
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 1;
  }
}

async function createExecuteStatement(dbUrl: string | undefined): Promise<{ execute: (statement: SqlStatement) => Promise<void>; close: () => Promise<void> }> {
  if (!dbUrl) throw new Error("store-staging requires --db or DATABASE_URL.");
  const postgres = (await import("postgres")).default;
  const sql = postgres(dbUrl, { max: 1 });
  return {
    execute: async (statement: SqlStatement): Promise<void> => {
      assertAllowedStoreStagingStatement(statement);
      await sql.unsafe(statement.sql, preparePostgresJsParams(statement.params) as never[]);
    },
    close: () => sql.end(),
  };
}

function assertAllowedStoreStagingStatement(statement: SqlStatement): void {
  const trimmed = statement.sql.trim();
  const allowed =
    /^(BEGIN|COMMIT|ROLLBACK)\b/i.test(trimmed) ||
    /^INSERT\s+INTO\s+world_lesson_runs\b/i.test(trimmed) ||
    /^DELETE\s+FROM\s+world_staging_(nodes|edges|domain_profiles|mentions|evidence|node_cards)\b/i.test(trimmed) ||
    /^INSERT\s+INTO\s+world_staging_(nodes|edges|domain_profiles|mentions|evidence|node_cards)\b/i.test(trimmed);
  if (!allowed) {
    throw new Error(`Store staging executor refuses statement '${statement.name}' outside staging writes.`);
  }
}

function parseFlags(argv: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index]!;
    if (!raw.startsWith("--")) {
      throw new Error(`Unexpected argument '${raw}'.`);
    }
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

if (import.meta.url === `file://${process.argv[1]}`) {
  raise(main(process.argv.slice(2)));
}

function raise(promise: Promise<number>): void {
  promise.then((code) => {
    process.exitCode = code;
  });
}
