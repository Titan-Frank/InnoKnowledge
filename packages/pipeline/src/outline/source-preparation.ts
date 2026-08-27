import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { parseHeadings, planChunkOutline, type ChunkOutlineItem } from "./chunk-outline.js";
import { iterOutlineItems, safePathToken, type OutlineItem } from "../shared/pathing.js";

type RawRecord = Record<string, unknown>;

type MarkdownAlignmentResult = {
  updated: boolean;
  matched_items: number;
  total_items: number;
  source_path: string;
};

export type SourceMarkdownPreparationResult =
  | {
      status: "completed";
      markdown_path: string;
      outline_source_path: string;
      imported: boolean;
    }
  | {
      status: "blocked";
      error: string;
    };

export type ChunkedOutlinePreparationResult =
  | {
      status: "completed";
      generated_chunks: number;
      unit_kind: "chunk" | "lesson";
      outline_path: string;
    }
  | {
      status: "skipped";
      reason: string;
      outline_path: string;
    }
  | {
      status: "blocked";
      error: string;
      outline_path: string;
    };

export type MarkdownOutlinePreparationResult =
  | {
      status: "completed";
      created: boolean;
      outline_path: string;
      item_count: number;
      source_path: string;
    }
  | {
      status: "blocked";
      error: string;
      outline_path: string;
    };

export type OutlineSourceResetResult = {
  outline_path: string;
  reset_items: number;
  removed_chunks: number;
};

export function resetOutlineForSourceReplacement(input: { outlinePath: string }): OutlineSourceResetResult {
  const outline = loadOutlineRecord(input.outlinePath);
  const itemKey = Array.isArray(outline.items) ? "items" : Array.isArray(outline.structure) ? "structure" : null;
  if (!itemKey) throw new Error(`Outline is missing items/structure: ${input.outlinePath}`);

  let resetItems = 0;
  let removedChunks = 0;
  const resetValues = (values: unknown[]): RawRecord[] => values.flatMap((value) => {
    if (!isRecord(value)) return [];
    if (value.kind === "chunk") {
      removedChunks += 1;
      return [];
    }
    const item = { ...value };
    if ("md_start" in item || "md_end" in item || "raw_line" in item) resetItems += 1;
    delete item.md_start;
    delete item.md_end;
    delete item.raw_line;
    if (Array.isArray(item.children)) item.children = resetValues(item.children);
    return [item];
  });

  writeOutlineRecord(input.outlinePath, {
    ...outline,
    [itemKey]: resetValues(outline[itemKey] as unknown[]),
  });
  return {
    outline_path: input.outlinePath,
    reset_items: resetItems,
    removed_chunks: removedChunks,
  };
}

export function prepareSourceMarkdown(input: {
  bookId: string;
  outlinePath: string;
  repoRoot: string;
  sourceMarkdownPath?: string | null;
}): SourceMarkdownPreparationResult {
  if (input.sourceMarkdownPath && input.sourceMarkdownPath.trim()) {
    const sourcePath = resolveInputPath(input.sourceMarkdownPath, input.repoRoot);
    if (!existsSync(sourcePath)) return { status: "blocked", error: `Source Markdown not found: ${sourcePath}` };

    // MinerU writes Markdown and its sibling image directories under the safe
    // book token. Reuse that same directory so relative image references stay
    // attached to the source instead of copying only full.md elsewhere.
    const targetPath = resolve(input.repoRoot, "data", "mineru", safePathToken(input.bookId), "full.md");
    mkdirSync(dirname(targetPath), { recursive: true });
    const imported = sourcePath !== targetPath;
    if (imported) copyFileSync(sourcePath, targetPath);

    const outlineSourcePath = toRepoRelativePath(targetPath, input.repoRoot);
    if (existsSync(input.outlinePath)) {
      const outline = loadOutlineRecord(input.outlinePath);
      writeOutlineRecord(input.outlinePath, { ...outline, source_path: outlineSourcePath });
    }
    return {
      status: "completed",
      markdown_path: targetPath,
      outline_source_path: outlineSourcePath,
      imported,
    };
  }

  const outline = loadOutlineRecord(input.outlinePath);
  const rawSourcePath = typeof outline.source_path === "string" ? outline.source_path : "";
  if (!rawSourcePath) return { status: "blocked", error: `Outline is missing source_path: ${input.outlinePath}` };
  const markdownPath = resolveInputPath(rawSourcePath, input.repoRoot);
  if (!existsSync(markdownPath)) return { status: "blocked", error: `Markdown not found: ${markdownPath}` };
  return {
    status: "completed",
    markdown_path: markdownPath,
    outline_source_path: rawSourcePath,
    imported: false,
  };
}

export function ensureOutlineFromMarkdown(input: {
  bookId: string;
  outlinePath: string;
  repoRoot: string;
  markdownPath: string;
  title?: string;
  tocStart?: number;
  tocEnd?: number;
  generatedAt?: string;
}): MarkdownOutlinePreparationResult {
  if (existsSync(input.outlinePath)) {
    const alignment = alignOutlineToMarkdown({
      outlinePath: input.outlinePath,
      markdownPath: input.markdownPath,
      repoRoot: input.repoRoot,
    });
    return {
      status: "completed",
      created: false,
      outline_path: input.outlinePath,
      item_count: alignment.total_items,
      source_path: alignment.source_path,
    };
  }

  const markdownPath = resolveInputPath(input.markdownPath, input.repoRoot);
  if (!existsSync(markdownPath)) return { status: "blocked", outline_path: input.outlinePath, error: `Markdown not found: ${markdownPath}` };

  const lines = readPlainLines(markdownPath);
  const headingRows = lines
    .map((line, index) => {
      const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
      if (!match) return null;
      const heading = match[2]!.trim();
      if (!heading || normalizeHeadingText(heading).length < 2) return null;
      return { line: index + 1, level: match[1]!.length, heading, raw: line.trim() };
    })
    .filter((row): row is { line: number; level: number; heading: string; raw: string } => row !== null);

  if (headingRows.length === 0) {
    return {
      status: "blocked",
      outline_path: input.outlinePath,
      error: "Could not derive an outline because Markdown has no headings.",
    };
  }

  const h1Rows = headingRows.filter((row) => row.level === 1);
  const selected = h1Rows.length >= 2 ? h1Rows : headingRows.filter((row) => row.level <= 2);
  const selectedRows = selected.length > 0 ? selected : headingRows.slice(0, 1);
  const items = selectedRows.map((row, index) => {
    const nextStart = selectedRows[index + 1]?.line ?? lines.length + 1;
    const heading = row.heading.trim();
    const labelMatch = /^((?:第\s*)?[0-9一二三四五六七八九十百千万]+[章节课题单元]+)\s*(.*)$/.exec(heading);
    const label = labelMatch ? labelMatch[1]!.replace(/\s+/g, "") : `第${index + 1}课`;
    const itemTitle = labelMatch ? labelMatch[2]!.trim() || heading : heading;
    return {
      id: `struct:${input.bookId}:lesson:${index + 1}`,
      kind: "lesson",
      label,
      title: itemTitle,
      page_start: 1,
      page_end: 1,
      level: 1,
      order_path: String(index + 1),
      raw_line: row.raw,
      md_start: row.line,
      md_end: Math.max(row.line, nextStart - 1),
    };
  });

  const sourcePath = toRepoRelativePath(markdownPath, input.repoRoot);
  const outline = {
    book_id: input.bookId,
    title: input.title?.trim() || input.bookId,
    source_path: sourcePath,
    generated_at: input.generatedAt ?? new Date().toISOString(),
    toc_pages: { start: input.tocStart ?? 1, end: input.tocEnd ?? 1 },
    items,
  };
  mkdirSync(dirname(input.outlinePath), { recursive: true });
  writeOutlineRecord(input.outlinePath, outline);
  return {
    status: "completed",
    created: true,
    outline_path: input.outlinePath,
    item_count: items.length,
    source_path: sourcePath,
  };
}

export function alignOutlineToMarkdown(input: { outlinePath: string; markdownPath: string; repoRoot: string }): MarkdownAlignmentResult {
  const markdownPath = resolveInputPath(input.markdownPath, input.repoRoot);
  if (!existsSync(markdownPath)) throw new Error(`Markdown not found: ${markdownPath}`);
  const outline = loadOutlineRecord(input.outlinePath);
  const itemKey = Array.isArray(outline.items) ? "items" : Array.isArray(outline.structure) ? "structure" : null;
  if (!itemKey) throw new Error(`Outline has no items list: ${input.outlinePath}`);
  const rootItems = (outline[itemKey] as unknown[]).filter(isRecord) as OutlineItem[];
  const items = iterOutlineItems(rootItems) as RawRecord[];
  const lines = readPlainLines(markdownPath);
  const markerLines = new Map<string, number>();
  const headings: Array<{ line: number; title: string; norm: string; raw: string }> = [];
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const marker = /LESSON_START\s+id="([^"]+)"/.exec(line);
    if (marker) markerLines.set(marker[1]!, lineNumber);
    if (!/^#{1,6}\s+\S/.test(line)) return;
    const title = line.replace(/^#{1,6}\s+/, "").trim();
    headings.push({ line: lineNumber, title, norm: normalizeHeadingText(title), raw: line.trim() });
  });

  const usedLines = new Set<number>();
  const matched: Array<{ item: RawRecord; line: number }> = [];
  let lastLine = 0;
  for (const item of [...items].sort(compareOrderPath)) {
    const itemId = typeof item.id === "string" ? item.id : "";
    if (hasNumber(item.md_start) && hasNumber(item.md_end)) {
      const line = Number(item.md_start);
      lastLine = Math.max(lastLine, line);
      matched.push({ item, line });
      continue;
    }
    if (itemId && markerLines.has(itemId)) {
      const line = markerLines.get(itemId)!;
      item.md_start = line;
      usedLines.add(line);
      lastLine = Math.max(lastLine, line);
      matched.push({ item, line });
      continue;
    }
    const titleNorm = normalizeHeadingText(item.title);
    const labelNorm = normalizeHeadingText(item.label);
    if (!titleNorm && !labelNorm) continue;
    const candidates = headings
      .filter((heading) => !usedLines.has(heading.line))
      .map((heading) => ({ score: headingScore(heading.norm, titleNorm, labelNorm), heading }))
      .filter((candidate) => candidate.score > 0);
    if (candidates.length === 0) continue;
    const afterPrevious = candidates.filter((candidate) => candidate.heading.line > lastLine);
    const chosen = [...(afterPrevious.length > 0 ? afterPrevious : candidates)].sort((left, right) => right.score - left.score || left.heading.line - right.heading.line)[0]!.heading;
    item.md_start = chosen.line;
    item.raw_line = item.raw_line || chosen.raw;
    usedLines.add(chosen.line);
    lastLine = Math.max(lastLine, chosen.line);
    matched.push({ item, line: chosen.line });
  }

  const matchedSorted = matched.sort((left, right) => left.line - right.line);
  matchedSorted.forEach((row, index) => {
    row.item.md_end = index + 1 < matchedSorted.length ? Math.max(row.line, matchedSorted[index + 1]!.line - 1) : lines.length;
  });

  const orderedItems = [...items].sort(compareOrderPath);
  orderedItems.forEach((item, index) => {
    if (hasNumber(item.page_end)) return;
    const later = orderedItems.slice(index + 1).find((candidate) => hasNumber(candidate.page_start));
    if (later) item.page_end = Math.max(Number(item.page_start ?? 1), Number(later.page_start) - 1);
  });

  const sourcePath = toRepoRelativePath(markdownPath, input.repoRoot);
  writeOutlineRecord(input.outlinePath, { ...outline, source_path: sourcePath, [itemKey]: rootItems });
  return {
    updated: true,
    matched_items: matchedSorted.length,
    total_items: items.length,
    source_path: sourcePath,
  };
}

export function ensureChunkedOutline(input: {
  outlinePath: string;
  repoRoot: string;
  noChunks?: boolean;
  minLines?: number;
  maxLines?: number;
  targetLines?: number;
}): ChunkedOutlinePreparationResult {
  const outline = loadOutlineRecord(input.outlinePath);
  const itemKey = Array.isArray(outline.items) ? "items" : Array.isArray(outline.structure) ? "structure" : null;
  if (!itemKey) return { status: "blocked", outline_path: input.outlinePath, error: `Outline is missing items/structure: ${input.outlinePath}` };
  const items = (outline[itemKey] as unknown[]).filter(isRecord) as ChunkOutlineItem[];
  if (items.some((item) => item.kind === "chunk")) {
    return { status: "skipped", outline_path: input.outlinePath, reason: "Outline already contains chunk items." };
  }
  if (input.noChunks) {
    return { status: "skipped", outline_path: input.outlinePath, reason: "--no-chunks requested lesson-level extraction." };
  }

  const sourcePath = typeof outline.source_path === "string" ? resolveInputPath(outline.source_path, input.repoRoot) : "";
  const headings = sourcePath && existsSync(sourcePath) ? parseHeadings(readTextLines(sourcePath)) : [];
  const plan = planChunkOutline(items, headings, {
    minLines: input.minLines,
    maxLines: input.maxLines,
    targetLines: input.targetLines,
  });
  if (plan.chunks.length === 0) {
    return { status: "skipped", outline_path: input.outlinePath, reason: "No chunks generated from outline items." };
  }

  writeOutlineRecord(input.outlinePath, {
    ...outline,
    [itemKey]: [...items, ...plan.chunks],
  });
  return {
    status: "completed",
    outline_path: input.outlinePath,
    generated_chunks: plan.chunks.length,
    unit_kind: "chunk",
  };
}

function loadOutlineRecord(path: string): RawRecord {
  if (!existsSync(path)) throw new Error(`Outline not found: ${path}`);
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!isRecord(parsed)) throw new Error(`Invalid outline file ${path}: expected a JSON object.`);
  return parsed;
}

function writeOutlineRecord(path: string, outline: RawRecord): void {
  writeFileSync(path, `${JSON.stringify(outline, null, 2)}\n`, "utf8");
}

function resolveInputPath(path: string, repoRoot: string): string {
  return isAbsolute(path) ? path : resolve(repoRoot, path);
}

function toRepoRelativePath(path: string, repoRoot: string): string {
  return relative(repoRoot, path).split(sep).join("/");
}

function readTextLines(path: string): string[] {
  const text = readFileSync(path, "utf8");
  if (text.length === 0) return [];
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return normalized.endsWith("\n") ? normalized.slice(0, -1).split("\n").map((line) => `${line}\n`) : normalized.split("\n");
}

function readPlainLines(path: string): string[] {
  const text = readFileSync(path, "utf8");
  if (text.length === 0) return [];
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return normalized.endsWith("\n") ? normalized.slice(0, -1).split("\n") : normalized.split("\n");
}

function headingScore(headingNorm: string, titleNorm: string, labelNorm: string): number {
  if (titleNorm && labelNorm && headingNorm.includes(titleNorm) && headingNorm.includes(labelNorm)) return 110;
  if (titleNorm && titleNorm === headingNorm) return 100;
  if (titleNorm && headingNorm.includes(titleNorm)) return 90;
  if (titleNorm && titleNorm.includes(headingNorm) && headingNorm.length / Math.max(1, titleNorm.length) >= 0.75) return 70;
  if (labelNorm && headingNorm.includes(labelNorm)) return 50;
  return 0;
}

function compareOrderPath(left: RawRecord, right: RawRecord): number {
  const leftKey = orderKey(left);
  const rightKey = orderKey(right);
  const size = Math.max(leftKey.length, rightKey.length);
  for (let index = 0; index < size; index += 1) {
    const delta = (leftKey[index] ?? 999999) - (rightKey[index] ?? 999999);
    if (delta !== 0) return delta;
  }
  return 0;
}

function orderKey(item: RawRecord): number[] {
  const parts = String(item.order_path ?? "")
    .split(".")
    .map((part) => Number.parseInt(part, 10))
    .filter(Number.isFinite);
  return parts.length > 0 ? parts : [999999];
}

function hasNumber(value: unknown): boolean {
  return typeof value === "number" && Number.isFinite(value);
}

function isRecord(value: unknown): value is RawRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function normalizeHeadingText(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/[#*_`~[\]().,，。:：;；!?！？/\\|"《》“”‘’、-]+/g, " ")
    .replace(/\s+/g, "");
}
