#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { runMineruSourceMarkdown } from "../outline/mineru-source.js";
import { REPO_ROOT, safePathToken } from "../shared/pathing.js";

async function main(argv: string[]): Promise<number> {
  loadDotenvFile(resolve(REPO_ROOT, ".env"));
  const flags = parseFlags(argv);
  const bookId = required(flags, "book-id");
  const outputDir = flags.get("output-dir") ?? resolve(REPO_ROOT, "data", "mineru", safePathToken(bookId));
  const apiKeyEnv = flags.get("api-key-env") ?? "MINERU_API_KEY";
  const result = await runMineruSourceMarkdown({
    bookId,
    outputDir,
    apiKey: process.env[apiKeyEnv] ?? "",
    pdfPath: flags.get("pdf-path"),
    fileUrl: flags.get("file-url"),
    baseUrl: flags.get("base-url"),
    modelVersion: flags.get("model-version"),
    language: flags.get("language"),
    dataId: flags.get("data-id"),
    isOcr: parseBoolean(flags.get("is-ocr"), true),
    enableFormula: parseBoolean(flags.get("enable-formula"), true),
    enableTable: parseBoolean(flags.get("enable-table"), true),
    pageRanges: flags.get("page-ranges"),
    pollIntervalMs: parseSeconds(flags.get("poll-interval"), 10) * 1000,
    timeoutMs: parseSeconds(flags.get("timeout"), 1800) * 1000,
    force: flags.has("force"),
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

function required(flags: Map<string, string>, name: string): string {
  const value = flags.get(name);
  if (value === undefined || value.trim() === "") throw new Error(`Missing required option --${name}.`);
  return value;
}

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  return ["1", "true", "yes", "on"].includes(value.toLowerCase());
}

function parseSeconds(value: string | undefined, fallback: number): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Invalid positive seconds value: ${value}`);
  return parsed;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2))
    .then((code) => {
      process.exitCode = code;
    })
    .catch((error) => {
      process.stderr.write(`${(error as Error).message}\n`);
      process.exitCode = 1;
    });
}
