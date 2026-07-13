#!/usr/bin/env node

import { runInterdisciplinaryAnalysisFromDatabase } from "../interdisciplinary/interdisciplinary-store.js";

async function main(argv: string[]): Promise<number> {
  try {
    const flags = parseFlags(argv);
    const output = await runInterdisciplinaryAnalysisFromDatabase({
      dbUrl: required(flags, "db"),
      datasetId: required(flags, "dataset-id"),
      domains: commaList(flags.get("domains")),
      minimumAlignmentScore: optionalScore(flags.get("minimum-alignment-score")),
      minimumRelationScore: optionalScore(flags.get("minimum-relation-score")),
      maximumCandidates: optionalInteger(flags.get("maximum-candidates")),
      maximumBucketSize: optionalInteger(flags.get("maximum-bucket-size")),
      replacePending: !flags.has("keep-pending"),
      now: flags.get("now"),
    });
    const printable = {
      run: output.run,
      candidates_created: output.candidates_created,
      alignment_candidates: output.alignment_candidates,
      relation_candidates: output.relation_candidates,
      bridge_path_candidates: output.bridge_path_candidates,
      summary: output.plan.summary,
    };
    process.stdout.write(`${JSON.stringify(printable, null, flags.has("pretty") ? 2 : undefined)}\n`);
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

function commaList(value: string | undefined): string[] | undefined {
  if (!value) return undefined;
  const values = value.split(",").map((item) => item.trim()).filter(Boolean);
  return values.length > 0 ? values : undefined;
}

function optionalNumber(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`Expected a number, received '${value}'.`);
  return parsed;
}

function optionalScore(value: string | undefined): number | undefined {
  const parsed = optionalNumber(value);
  if (parsed === undefined) return undefined;
  if (parsed < 0 || parsed > 1) throw new Error(`Expected a score from 0 to 1, received '${value}'.`);
  return parsed;
}

function optionalInteger(value: string | undefined): number | undefined {
  const parsed = optionalNumber(value);
  if (parsed === undefined) return undefined;
  if (!Number.isInteger(parsed) || parsed <= 0) throw new Error(`Expected a positive integer, received '${value}'.`);
  return parsed;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
