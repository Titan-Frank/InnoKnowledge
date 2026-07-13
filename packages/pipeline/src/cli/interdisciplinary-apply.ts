#!/usr/bin/env node

import { applyApprovedInterdisciplinaryCandidates } from "../interdisciplinary/interdisciplinary-store.js";

async function main(argv: string[]): Promise<number> {
  try {
    const flags = parseFlags(argv);
    const output = await applyApprovedInterdisciplinaryCandidates({
      dbUrl: required(flags, "db"),
      datasetId: required(flags, "dataset-id"),
      limit: optionalInteger(flags.get("limit")),
      now: flags.get("now"),
    });
    process.stdout.write(`${JSON.stringify(output, null, flags.has("pretty") ? 2 : undefined)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 1;
  }
}

function parseFlags(argv: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index]!;
    if (!raw.startsWith("--")) throw new Error(`Unexpected argument '${raw}'.`);
    const key = raw.slice(2);
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      flags.set(key, "true");
      continue;
    }
    flags.set(key, next);
    index += 1;
  }
  return flags;
}

function required(flags: Map<string, string>, name: string): string {
  const value = flags.get(name);
  if (!value) throw new Error(`Missing required option --${name}.`);
  return value;
}

function optionalInteger(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Expected a positive integer, received '${value}'.`);
  return parsed;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
