#!/usr/bin/env node

import { isMainModule } from "../shared/cli-entry.js";

import { extractPdfOutline } from "../outline/pdf-outline.js";
import { REPO_ROOT, outlinePathForBook } from "../shared/pathing.js";

async function main(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  const bookId = required(flags, "book-id");
  const pdfPath = required(flags, "pdf-path");
  const outlinePath = flags.get("out") ?? outlinePathForBook(bookId);
  const result = await extractPdfOutline({
    bookId,
    pdfPath,
    outlinePath,
    repoRoot: REPO_ROOT,
    title: flags.get("title") ?? bookId,
    sourcePath: flags.get("source-path") ?? pdfPath,
    tocStart: parseInteger(flags.get("start-page"), 1),
    tocEnd: parseInteger(flags.get("end-page"), 20),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
  return result.status === "completed" ? 0 : 2;
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
  if (value === undefined || value.trim() === "") throw new Error(`Missing required option --${name}.`);
  return value;
}

function parseInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`Invalid positive integer: ${value}`);
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
