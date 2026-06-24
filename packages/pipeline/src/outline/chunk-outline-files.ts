import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, resolve } from "node:path";

import { appendChunkItems, parseHeadings, planChunkOutline, type ChunkOutlineDocument, type ChunkOutlinePlan } from "./chunk-outline.js";
import { OUTLINES_DIR, REPO_ROOT } from "../shared/pathing.js";

export type ChunkOutlineFileInput = {
  bookId?: string;
  outlinePath?: string;
  markdownPath?: string;
  repoRoot?: string;
  outlinesDir?: string;
  includeOutline?: boolean;
  minLines?: number;
  maxLines?: number;
  targetLines?: number;
};

export type ChunkOutlineFileOutput = ChunkOutlinePlan & {
  status: "success";
  outline_path: string;
  markdown_path: string | null;
  warnings: string[];
  outline?: ChunkOutlineDocument;
};

export function runChunkOutlineFile(input: ChunkOutlineFileInput): ChunkOutlineFileOutput {
  const repoRoot = input.repoRoot ?? REPO_ROOT;
  const outlinePath = resolveOutlinePath(input, repoRoot);
  const outline = loadOutlineFile(outlinePath);
  const { path: markdownPath, warnings } = resolveMarkdownInput(outline, input, repoRoot);
  const headings = markdownPath && existsSync(markdownPath) ? parseHeadings(readTextLines(markdownPath)) : [];
  const plan = planChunkOutline(outline.items, headings, {
    minLines: input.minLines,
    maxLines: input.maxLines,
    targetLines: input.targetLines,
  });

  return {
    status: "success",
    outline_path: outlinePath,
    markdown_path: markdownPath,
    warnings,
    ...plan,
    ...(input.includeOutline ? { outline: appendChunkItems(outline, plan.chunks) } : {}),
  };
}

export function loadOutlineFile(path: string): ChunkOutlineDocument {
  if (!existsSync(path)) throw new Error(`Outline not found: ${path}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Invalid outline file ${path}: ${(error as Error).message}`);
  }
  if (!isRecord(parsed)) throw new Error(`Invalid outline file ${path}: expected a JSON object.`);
  if (!Array.isArray(parsed.items) || !parsed.items.every(isRecord)) {
    throw new Error(`Invalid outline file ${path}: expected field 'items' to be a JSON array of objects.`);
  }
  return { ...parsed, items: parsed.items.map((item) => ({ ...item })) };
}

export function resolveOutlinePath(input: ChunkOutlineFileInput, repoRoot = REPO_ROOT): string {
  if (input.outlinePath) return resolveInputPath(input.outlinePath, repoRoot);
  if (!input.bookId) throw new Error("Missing required option --book-id or --outline-path.");
  return resolve(input.outlinesDir ?? OUTLINES_DIR, `${input.bookId}.outline.json`);
}

export function resolveInputPath(path: string, repoRoot = REPO_ROOT): string {
  return isAbsolute(path) ? path : resolve(repoRoot, path);
}

function resolveMarkdownInput(
  outline: ChunkOutlineDocument,
  input: ChunkOutlineFileInput,
  repoRoot: string,
): { path: string | null; warnings: string[] } {
  const warnings: string[] = [];
  const rawPath = input.markdownPath ?? (typeof outline.source_path === "string" ? outline.source_path : "");
  if (!rawPath) return { path: null, warnings };

  const markdownPath = resolveInputPath(rawPath, repoRoot);
  if (!existsSync(markdownPath)) {
    warnings.push(`Markdown not found at ${rawPath}; skipping heading analysis.`);
  }
  return { path: markdownPath, warnings };
}

function readTextLines(path: string): string[] {
  const text = readFileSync(path, "utf8");
  if (text.length === 0) return [];
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return normalized.endsWith("\n") ? normalized.slice(0, -1).split("\n").map((line) => `${line}\n`) : normalized.split("\n");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
