#!/usr/bin/env node

import { isMainModule } from "../shared/cli-entry.js";

import { runChunkOutlineFile } from "../outline/chunk-outline-files.js";
import { runChunkOutline } from "../outline/chunk-outline-runner.js";

async function main(argv: string[]): Promise<number> {
  try {
    const flags = parseFlags(argv);
    const common = {
      includeOutline: flags.has("include-outline"),
      minLines: parseInteger(flags.get("min-lines"), "min-lines"),
      maxLines: parseInteger(flags.get("max-lines"), "max-lines"),
      targetLines: parseInteger(flags.get("target-lines"), "target-lines"),
    };
    const output =
      flags.has("book-id") || flags.has("outline-path")
        ? runChunkOutlineFile({
            ...common,
            bookId: flags.get("book-id"),
            outlinePath: flags.get("outline-path"),
            markdownPath: flags.get("markdown-path"),
            repoRoot: flags.get("repo-root"),
            outlinesDir: flags.get("outlines-dir"),
          })
        : runChunkOutline({
            ...common,
            itemsJson: flags.get("items-json"),
            outlineJson: flags.get("outline-json"),
            headingsJson: flags.get("headings-json"),
          });
    process.stdout.write(`${JSON.stringify(output)}\n`);
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

function parseInteger(value: string | undefined, name: string): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`--${name} must be a positive integer.`);
  return parsed;
}

if (isMainModule(import.meta.url)) {
  raise(main(process.argv.slice(2)));
}

function raise(promise: Promise<number>): void {
  promise.then((code) => {
    process.exitCode = code;
  });
}
