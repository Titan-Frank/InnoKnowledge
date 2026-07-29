#!/usr/bin/env node

import { isMainModule } from "../shared/cli-entry.js";

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { checkPostgresReady } from "../shared/postgres-readiness.js";
import { REPO_ROOT } from "../shared/pathing.js";

async function main(argv: string[]): Promise<number> {
  loadDotenvFile(resolve(REPO_ROOT, ".env"));
  const flags = parseFlags(argv);
  const result = await checkPostgresReady({
    databaseUrl: flags.get("database-url") || process.env.DATABASE_URL || "",
    timeoutMs: parseSeconds(flags.get("timeout"), 2) * 1000,
    requireQuery: flags.has("require-query"),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result.status === "success" ? 0 : 2;
}

function loadDotenvFile(path: string): void {
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [rawKey, ...rest] = line.split("=");
    const key = rawKey?.trim();
    if (!key || process.env[key] !== undefined) continue;
    process.env[key] = rest.join("=").trim();
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

function parseSeconds(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Invalid positive seconds value: ${value}`);
  return parsed;
}

if (isMainModule(import.meta.url)) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`${(error as Error).message}\n`);
      process.exitCode = 1;
    });
}
