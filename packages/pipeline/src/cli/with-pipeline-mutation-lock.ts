#!/usr/bin/env node

import { spawn } from "node:child_process";
import { resolve } from "node:path";

import postgres from "postgres";

import { isMainModule } from "../shared/cli-entry.js";
import { withPipelineMutationSessionLock } from "../shared/dataset-transaction.js";

export function databaseUrlFromArgs(args: string[], env: NodeJS.ProcessEnv = process.env): string {
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]!;
    if (value.startsWith("--db=")) return value.slice("--db=".length);
    if (value === "--db" && args[index + 1]) return args[index + 1]!;
  }
  return env.DATABASE_URL ?? "";
}

async function main(argv: string[]): Promise<number> {
  const [commandPath, ...commandArgs] = argv;
  if (!commandPath) throw new Error("Missing child pipeline command path.");
  const databaseUrl = databaseUrlFromArgs(commandArgs);
  if (!databaseUrl) throw new Error("Pipeline mutation lock requires --db or DATABASE_URL.");

  const sql = postgres(databaseUrl, { max: 1 });
  try {
    return await withPipelineMutationSessionLock(sql, () => runChild(resolve(commandPath), commandArgs));
  } finally {
    await sql.end({ timeout: 1 });
  }
}

function runChild(commandPath: string, args: string[]): Promise<number> {
  return new Promise((resolveExit, reject) => {
    const child = spawn(process.execPath, [commandPath, ...args], { stdio: "inherit", env: process.env });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolveExit(code ?? (signal ? 1 : 0));
    });
  });
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => { process.exitCode = code; },
    (error) => {
      process.stderr.write(`${(error as Error).message}\n`);
      process.exitCode = 1;
    },
  );
}
