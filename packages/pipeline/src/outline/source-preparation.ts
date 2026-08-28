import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { parseHeadings, planChunkOutline, type ChunkOutlineItem } from "./chunk-outline.js";
import { classifyOutlineContent } from "./content-role.js";
import { findSiblingContentListV2 } from "./mineru-source.js";
import { iterOutlineItems, safePathToken, type OutlineItem } from "../shared/pathing.js";

type RawRecord = Record<string, unknown>;

type MarkdownHeading = { line: number; norm: string; raw: string };

type MineruV2Heading = {
  pageIndex: number;
  blockIndex: number;
  norm: string;
};

type StructuredHeadingConstraint = {
  headingLines: number[];
  headingPages: Array<{ line: number; page: number }>;
  markdownEndLine?: number;
  pageEnd: number;
  tocPages?: { start: number; end: number };
};

type EnrichHeadingSelection =
  | { ambiguous: false; constraint: StructuredHeadingConstraint }
  | { ambiguous: true; reason: string };

type MarkdownAlignmentResult = {
  updated: boolean;
  matched_items: number;
  total_items: number;
  unmatched_item_ids: string[];
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

export type EnrichOutlinePreparationResult =
  | {
      status: "completed";
      outline_path: string;
      item_count: number;
      lesson_count: number;
      source_path: string;
      source_ref: string;
    }
  | {
      status: "skipped";
      outline_path: string;
      reason: string;
      unmatched_item_ids?: string[];
    }
  | {
      status: "blocked";
      outline_path: string;
      error: string;
    };

export type OutlineSourceResetResult = {
  outline_path: string;
  reset_items: number;
  removed_chunks: number;
};

export function resetOutlineForSourceReplacement(input: { outlinePath: string; sourcePath?: string }): OutlineSourceResetResult {
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
    source_path: input.sourcePath ?? outline.source_path,
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
    const mineruRoot = resolve(input.repoRoot, "data", "mineru");
    const sourceIsManaged = sourcePath === mineruRoot || sourcePath.startsWith(`${mineruRoot}${sep}`);
    const targetPath = sourceIsManaged
      ? sourcePath
      : resolve(mineruRoot, safePathToken(input.bookId), "full.md");
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
  replaceExisting?: boolean;
  title?: string;
  tocStart?: number;
  tocEnd?: number;
  generatedAt?: string;
}): MarkdownOutlinePreparationResult {
  if (existsSync(input.outlinePath) && !input.replaceExisting) {
    const alignment = alignOutlineToMarkdown({
      outlinePath: input.outlinePath,
      markdownPath: input.markdownPath,
      repoRoot: input.repoRoot,
    });
    if (alignment.unmatched_item_ids.length > 0) {
      return {
        status: "blocked",
        outline_path: input.outlinePath,
        error: `Could not align extraction items to Markdown headings: ${alignment.unmatched_item_ids.slice(0, 10).join(", ")}`,
      };
    }
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
    source_kind: "markdown",
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

export function ensureOutlineFromEnrich(input: {
  bookId: string;
  bookTitle?: string;
  enrichBookTitle?: string;
  enrichBookPath: string;
  enrichTree: RawRecord[];
  outlinePath: string;
  repoRoot: string;
  markdownPath: string;
  generatedAt?: string;
}): EnrichOutlinePreparationResult {
  const markdownPath = resolveInputPath(input.markdownPath, input.repoRoot);
  if (!existsSync(markdownPath)) {
    return { status: "blocked", outline_path: input.outlinePath, error: `Markdown not found: ${markdownPath}` };
  }

  const items = flattenEnrichOutline(input.bookId, input.enrichTree);
  const lessonCount = items.filter((item) => item.kind === "lesson").length;
  if (lessonCount === 0) {
    return {
      status: "skipped",
      outline_path: input.outlinePath,
      reason: `Selected Enrich book '${input.enrichBookPath}' has no lesson leaves.`,
    };
  }

  const markdownLines = readPlainLines(markdownPath);
  const contentListV2Path = findSiblingContentListV2(markdownPath);
  const headingSelection = selectEnrichHeadingSequence(markdownLines, contentListV2Path);
  if (headingSelection.ambiguous) {
    return {
      status: "skipped",
      outline_path: input.outlinePath,
      reason: headingSelection.reason,
    };
  }

  const previousOutline = existsSync(input.outlinePath) ? readFileSync(input.outlinePath, "utf8") : null;
  const sourcePath = toRepoRelativePath(markdownPath, input.repoRoot);
  mkdirSync(dirname(input.outlinePath), { recursive: true });
  writeOutlineRecord(input.outlinePath, {
    book_id: input.bookId,
    title: input.bookTitle?.trim() || input.enrichBookTitle?.trim() || input.bookId,
    source_path: sourcePath,
    source_kind: "enrich",
    source_ref: input.enrichBookPath,
    generated_at: input.generatedAt ?? new Date().toISOString(),
    toc_pages: headingSelection.constraint.tocPages ?? { start: 1, end: 1 },
    items,
  });

  try {
    const alignment = alignOutlineToMarkdown({
      outlinePath: input.outlinePath,
      markdownPath,
      repoRoot: input.repoRoot,
      headingLines: headingSelection.constraint.headingLines,
      headingPages: headingSelection.constraint.headingPages,
      markdownEndLine: headingSelection.constraint.markdownEndLine,
      pageEnd: headingSelection.constraint.pageEnd,
    });
    if (alignment.unmatched_item_ids.length > 0) {
      restoreOutline(input.outlinePath, previousOutline);
      return {
        status: "skipped",
        outline_path: input.outlinePath,
        reason: `Enrich outline did not align completely to Markdown (${alignment.unmatched_item_ids.length} unmatched lesson item(s)).`,
        unmatched_item_ids: alignment.unmatched_item_ids,
      };
    }
    const alignedOutline = loadOutlineRecord(input.outlinePath);
    const alignedItems = Array.isArray(alignedOutline.items) ? alignedOutline.items.filter(isRecord) : [];
    const outOfOrderItemIds = outOfOrderLessonIds(alignedItems);
    if (outOfOrderItemIds.length > 0) {
      restoreOutline(input.outlinePath, previousOutline);
      return {
        status: "skipped",
        outline_path: input.outlinePath,
        reason: `Enrich outline did not align monotonically to Markdown (${outOfOrderItemIds.length} out-of-order lesson item(s)).`,
        unmatched_item_ids: outOfOrderItemIds,
      };
    }
    return {
      status: "completed",
      outline_path: input.outlinePath,
      item_count: items.length,
      lesson_count: lessonCount,
      source_path: alignment.source_path,
      source_ref: input.enrichBookPath,
    };
  } catch (error) {
    restoreOutline(input.outlinePath, previousOutline);
    return {
      status: "skipped",
      outline_path: input.outlinePath,
      reason: `Could not use the selected Enrich outline: ${(error as Error).message}`,
    };
  }
}

export function alignOutlineToMarkdown(input: {
  outlinePath: string;
  markdownPath: string;
  repoRoot: string;
  headingLines?: number[];
  headingPages?: Array<{ line: number; page: number }>;
  markdownEndLine?: number;
  pageEnd?: number;
}): MarkdownAlignmentResult {
  const markdownPath = resolveInputPath(input.markdownPath, input.repoRoot);
  if (!existsSync(markdownPath)) throw new Error(`Markdown not found: ${markdownPath}`);
  const outline = loadOutlineRecord(input.outlinePath);
  const itemKey = Array.isArray(outline.items) ? "items" : Array.isArray(outline.structure) ? "structure" : null;
  if (!itemKey) throw new Error(`Outline has no items list: ${input.outlinePath}`);
  const rootItems = (outline[itemKey] as unknown[]).filter(isRecord) as OutlineItem[];
  const items = iterOutlineItems(rootItems) as RawRecord[];
  const lines = readPlainLines(markdownPath);
  const markerLines = new Map<string, number>();
  const allowedHeadingLines = input.headingLines ? new Set(input.headingLines) : null;
  const pageByHeadingLine = new Map((input.headingPages ?? []).map((entry) => [entry.line, entry.page]));
  const headings = parseMarkdownHeadings(lines)
    .filter((heading) => !allowedHeadingLines || allowedHeadingLines.has(heading.line));
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const marker = /LESSON_START\s+id="([^"]+)"/.exec(line);
    if (marker) markerLines.set(marker[1]!, lineNumber);
  });

  const usedLines = new Set<number>();
  const matched: Array<{ item: RawRecord; line: number }> = [];
  let lastLine = 0;
  for (const item of [...items].sort(compareHierarchyOrder)) {
    const itemId = typeof item.id === "string" ? item.id : "";
    if (hasNumber(item.md_start) && hasNumber(item.md_end)) {
      const line = Number(item.md_start);
      lastLine = Math.max(lastLine, line);
      matched.push({ item, line });
      continue;
    }
    if (itemId && markerLines.has(itemId)) {
      const line = markerLines.get(itemId)!;
      if (line <= lastLine) continue;
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
      .filter((heading) => !usedLines.has(heading.line) && heading.line > lastLine)
      .map((heading) => ({
        score: headingScore(
          heading.norm,
          titleNorm,
          labelNorm,
          heading.raw,
          String(item.title ?? ""),
          String(item.label ?? ""),
        ),
        heading,
      }))
      .filter((candidate) => candidate.score > 0);
    if (candidates.length === 0) continue;
    const chosen = [...candidates].sort((left, right) => right.score - left.score || left.heading.line - right.heading.line)[0]!.heading;
    item.md_start = chosen.line;
    item.raw_line = item.raw_line || chosen.raw;
    const headingPage = pageByHeadingLine.get(chosen.line);
    if (headingPage !== undefined) item.page_start = headingPage;
    usedLines.add(chosen.line);
    lastLine = Math.max(lastLine, chosen.line);
    matched.push({ item, line: chosen.line });
  }

  const matchedSorted = matched.sort((left, right) => left.line - right.line);
  const finalMarkdownLine = Math.max(1, Math.min(lines.length, input.markdownEndLine ?? lines.length));
  matchedSorted.forEach((row, index) => {
    row.item.md_end = index + 1 < matchedSorted.length
      ? Math.max(row.line, matchedSorted[index + 1]!.line - 1)
      : Math.max(row.line, finalMarkdownLine);
  });

  matchedSorted.forEach((row, index) => {
    if (!hasNumber(row.item.page_start) || !pageByHeadingLine.has(row.line)) return;
    const currentPage = Number(row.item.page_start);
    const later = matchedSorted.slice(index + 1).find((candidate) => hasNumber(candidate.item.page_start));
    row.item.page_end = later
      ? Math.max(currentPage, Number(later.item.page_start) - 1)
      : Math.max(currentPage, input.pageEnd ?? currentPage);
  });

  fillParentPageRanges(items);

  const orderedItems = [...items].sort(compareOrderPath);
  orderedItems.forEach((item, index) => {
    if (hasNumber(item.page_end) || !hasNumber(item.page_start)) return;
    const later = orderedItems.slice(index + 1).find((candidate) => hasNumber(candidate.page_start));
    if (later) item.page_end = Math.max(Number(item.page_start), Number(later.page_start) - 1);
  });

  const sourcePath = toRepoRelativePath(markdownPath, input.repoRoot);
  writeOutlineRecord(input.outlinePath, { ...outline, source_path: sourcePath, [itemKey]: rootItems });
  const unmatchedItemIds = items
    .filter((item) => (item.kind === "lesson" || item.kind === "activity") && (!hasNumber(item.md_start) || !hasNumber(item.md_end)))
    .map((item) => typeof item.id === "string" && item.id ? item.id : String(item.title ?? item.label ?? "unknown-item"));
  return {
    updated: true,
    matched_items: matchedSorted.length,
    total_items: items.length,
    unmatched_item_ids: unmatchedItemIds,
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
  const rootItems = (outline[itemKey] as unknown[]).filter(isRecord) as OutlineItem[];
  const items = (iterOutlineItems(rootItems) as ChunkOutlineItem[]).sort(compareDocumentOrder);
  if (input.noChunks) {
    return { status: "skipped", outline_path: input.outlinePath, reason: "--no-chunks requested lesson-level extraction." };
  }

  const existingChunks = items.filter((item) => item.kind === "chunk");
  const coveredLeafIds = new Set(existingChunks.flatMap((chunk) => [
    typeof chunk.parent_id === "string" ? chunk.parent_id : "",
    ...(Array.isArray(chunk.source_ids) ? chunk.source_ids.map(String) : []),
  ]).filter(Boolean));
  const extractableLeaves = items.filter((item) =>
    (item.kind === "lesson" || item.kind === "activity") && classifyOutlineContent(item) !== "excluded",
  );
  const needsRoleMigration = existingChunks.some((chunk) =>
    (chunk.content_role !== "knowledge" && chunk.content_role !== "summary" && chunk.content_role !== "assessment")
      || chunkRoleConflictsWithTitle(chunk),
  );
  const hasUncoveredLeaves = extractableLeaves.some((item) => typeof item.id === "string" && !coveredLeafIds.has(item.id));
  if (existingChunks.length > 0 && !needsRoleMigration && !hasUncoveredLeaves) {
    return { status: "skipped", outline_path: input.outlinePath, reason: "Outline already contains classified chunk items." };
  }

  const sourcePath = typeof outline.source_path === "string" ? resolveInputPath(outline.source_path, input.repoRoot) : "";
  const headings = sourcePath && existsSync(sourcePath) ? parseHeadings(readTextLines(sourcePath)) : [];
  const rootsWithoutChunks = stripChunkItems(rootItems);
  const itemsWithoutChunks = (iterOutlineItems(rootsWithoutChunks) as ChunkOutlineItem[]).sort(compareDocumentOrder);
  const plan = planChunkOutline(itemsWithoutChunks, headings, {
    minLines: input.minLines,
    maxLines: input.maxLines,
    targetLines: input.targetLines,
    preserveLeafBoundaries: outline.source_kind === "enrich",
  });
  if (plan.chunks.length === 0) {
    return { status: "skipped", outline_path: input.outlinePath, reason: "No chunks generated from outline items." };
  }

  writeOutlineRecord(input.outlinePath, {
    ...outline,
    [itemKey]: [...rootsWithoutChunks, ...plan.chunks],
  });
  return {
    status: "completed",
    outline_path: input.outlinePath,
    generated_chunks: plan.chunks.length,
    unit_kind: "chunk",
  };
}

function stripChunkItems(items: OutlineItem[]): OutlineItem[] {
  return items
    .filter((item) => item.kind !== "chunk")
    .map((item) => ({
      ...item,
      ...(Array.isArray(item.children) ? { children: stripChunkItems(item.children) } : {}),
    }));
}

function chunkRoleConflictsWithTitle(chunk: ChunkOutlineItem): boolean {
  const inferred = classifyOutlineContent({ kind: chunk.kind, title: chunk.title, label: chunk.label });
  return (inferred === "summary" || inferred === "assessment") && chunk.content_role !== inferred;
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

function flattenEnrichOutline(bookId: string, roots: RawRecord[]): RawRecord[] {
  const items: RawRecord[] = [];
  const visit = (nodes: RawRecord[], parentId: string | undefined, parentOrder: number[]) => {
    nodes.forEach((node, index) => {
      const title = String(node.title ?? "").trim();
      if (!title) return;
      const order = [...parentOrder, index + 1];
      const orderPath = order.join(".");
      const children = Array.isArray(node.child_nodes) ? node.child_nodes.filter(isRecord) : [];
      const kind = children.length > 0 ? (order.length === 1 ? "theme" : "topic") : "lesson";
      const id = `struct:${bookId}:${kind}:${order.join("-")}`;
      items.push({
        id,
        kind,
        label: title,
        title,
        level: Math.min(4, order.length),
        order_path: orderPath,
        raw_line: title,
        ...(parentId ? { parent_id: parentId } : {}),
      });
      visit(children, id, order);
    });
  };
  visit(roots.filter(isRecord), undefined, []);
  return items;
}

function selectEnrichHeadingSequence(lines: string[], contentListV2Path: string | null): EnrichHeadingSelection {
  const headings = parseMarkdownHeadings(lines);
  if (!contentListV2Path) {
    return {
      ambiguous: true,
      reason: "Enrich alignment requires MinerU content_list_v2.json; Markdown-only OCR sources are not supported.",
    };
  }
  try {
    return selectStructuredEnrichHeadingSequence(headings, contentListV2Path);
  } catch (error) {
    return {
      ambiguous: true,
      reason: `Could not verify Enrich alignment against MinerU content_list_v2.json: ${(error as Error).message}`,
    };
  }
}

function selectStructuredEnrichHeadingSequence(
  markdownHeadings: MarkdownHeading[],
  contentListV2Path: string,
): EnrichHeadingSelection {
  const parsed = JSON.parse(readFileSync(contentListV2Path, "utf8")) as unknown;
  if (!Array.isArray(parsed) || !parsed.every(Array.isArray)) {
    throw new Error("top-level value must be an array of pages");
  }
  const pages = parsed.map((page) => page.filter(isRecord));
  const mineruHeadings = pages.flatMap((page, pageIndex) => page.flatMap((block, blockIndex): MineruV2Heading[] => {
    if (String(block.type ?? "") !== "title") return [];
    const content = isRecord(block.content) ? block.content : {};
    const title = mineruInlineText(content.title_content);
    const norm = normalizeHeadingText(title);
    if (!norm) return [];
    return [{
      pageIndex,
      blockIndex,
      norm,
    }];
  }));
  if (mineruHeadings.length === 0) {
    throw new Error("no title blocks were found");
  }

  const mappedHeadings = mapMineruHeadingsToMarkdown(mineruHeadings, markdownHeadings);
  const tocStartPage = mineruHeadings.find((heading) => isTocHeadingTitle(heading.norm))?.pageIndex ?? -1;
  const tocEndPage = tocStartPage >= 0 ? findTocEndPage(pages, tocStartPage) : -1;
  const bodyStartPage = tocEndPage + 1;
  const appendixHeading = mineruHeadings
    .filter((heading) => heading.pageIndex >= bodyStartPage && isAppendixHeadingTitle(heading.norm))
    .sort(compareMineruHeadingPosition)[0];
  const appendixStartPage = appendixHeading?.pageIndex;
  const bodyMappings = mappedHeadings.filter(({ mineru }) => (
    mineru.pageIndex >= bodyStartPage
    && (appendixStartPage === undefined || mineru.pageIndex < appendixStartPage)
  ));
  const bodyHeadings = bodyMappings.map(({ markdown }) => markdown).sort((left, right) => left.line - right.line);
  if (bodyHeadings.length === 0) {
    return {
      ambiguous: true,
      reason: "MinerU content_list_v2.json did not establish any body headings that map uniquely to Markdown.",
    };
  }

  const appendixLine = appendixHeading === undefined
    ? undefined
    : mappedHeadings.find(({ mineru }) => mineru === appendixHeading)?.markdown.line;
  if (appendixStartPage !== undefined && appendixLine === undefined) {
    return {
      ambiguous: true,
      reason: "MinerU identified an appendix page, but its boundary did not map uniquely to Markdown.",
    };
  }
  return {
    ambiguous: false,
    constraint: {
      headingLines: [...new Set(bodyHeadings.map((heading) => heading.line))].sort((left, right) => left - right),
      headingPages: bodyMappings.map(({ mineru, markdown }) => ({
        line: markdown.line,
        page: mineru.pageIndex + 1,
      })),
      ...(appendixLine === undefined ? {} : { markdownEndLine: Math.max(1, appendixLine - 1) }),
      pageEnd: appendixStartPage ?? pages.length,
      ...(tocStartPage < 0 ? {} : {
        tocPages: {
          start: tocStartPage + 1,
          end: Math.max(tocStartPage, tocEndPage) + 1,
        },
      }),
    },
  };
}

function parseMarkdownHeadings(lines: string[]): MarkdownHeading[] {
  return lines.flatMap((line, index): MarkdownHeading[] => {
    if (!/^#{1,6}\s+\S/.test(line)) return [];
    const title = line.replace(/^#{1,6}\s+/, "").trim();
    return [{ line: index + 1, norm: normalizeHeadingText(title), raw: line.trim() }];
  });
}

function mapMineruHeadingsToMarkdown(
  mineruHeadings: MineruV2Heading[],
  markdownHeadings: MarkdownHeading[],
): Array<{ mineru: MineruV2Heading; markdown: MarkdownHeading }> {
  const mineruByNorm = new Map<string, MineruV2Heading[]>();
  const markdownByNorm = new Map<string, MarkdownHeading[]>();
  for (const heading of mineruHeadings) {
    const values = mineruByNorm.get(heading.norm) ?? [];
    values.push(heading);
    mineruByNorm.set(heading.norm, values);
  }
  for (const heading of markdownHeadings) {
    const values = markdownByNorm.get(heading.norm) ?? [];
    values.push(heading);
    markdownByNorm.set(heading.norm, values);
  }

  const mapped: Array<{ mineru: MineruV2Heading; markdown: MarkdownHeading }> = [];
  for (const [norm, structuredValues] of mineruByNorm) {
    const markdownValues = markdownByNorm.get(norm) ?? [];
    if (structuredValues.length !== markdownValues.length) continue;
    structuredValues
      .sort(compareMineruHeadingPosition)
      .forEach((mineru, index) => mapped.push({ mineru, markdown: markdownValues[index]! }));
  }
  return mapped.sort((left, right) => compareMineruHeadingPosition(left.mineru, right.mineru));
}

function findTocEndPage(pages: RawRecord[][], tocStartPage: number): number {
  let tocEndPage = tocStartPage;
  for (let pageIndex = tocStartPage + 1; pageIndex < pages.length; pageIndex += 1) {
    const page = pages[pageIndex]!;
    const meaningfulBlocks = mineruPageTextBlocks(page);
    if (meaningfulBlocks.length === 0) {
      tocEndPage = pageIndex;
      continue;
    }
    if (!isTocContinuationPage(page)) break;
    tocEndPage = pageIndex;
  }
  return tocEndPage;
}

function isTocContinuationPage(page: RawRecord[]): boolean {
  if (page.some((block) => {
    if (String(block.type ?? "") !== "title") return false;
    const content = isRecord(block.content) ? block.content : {};
    return isTocHeadingTitle(normalizeHeadingText(mineruInlineText(content.title_content)));
  })) return true;
  const texts = mineruPageTextBlocks(page);
  if (texts.length < 2 || texts.some((text) => text.length > 120)) return false;
  if (page.some((block) => ["equation_interline", "table"].includes(String(block.type ?? "")))) return false;
  const numberedEntries = texts.filter((text) => /(?:\s|\.{2,}|…+|·+)\d{1,4}\s*$/.test(text)).length;
  return numberedEntries >= 2 && numberedEntries / texts.length >= 0.3;
}

function mineruPageTextBlocks(page: RawRecord[]): string[] {
  return page.flatMap((block): string[] => {
    const type = String(block.type ?? "");
    if (type.startsWith("page_") || type === "image" || type === "chart") return [];
    const content = isRecord(block.content) ? block.content : {};
    const text = type === "title"
      ? mineruInlineText(content.title_content)
      : type === "paragraph"
        ? mineruInlineText(content.paragraph_content)
        : type === "list"
          ? mineruInlineText(content.list_items)
          : "";
    return text ? [text] : [];
  });
}

function mineruInlineText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(mineruInlineText).filter(Boolean).join("");
  if (!isRecord(value)) return "";
  if (typeof value.content === "string" || Array.isArray(value.content)) return mineruInlineText(value.content);
  if (value.item_content !== undefined) return mineruInlineText(value.item_content);
  return "";
}

function compareMineruHeadingPosition(left: MineruV2Heading, right: MineruV2Heading): number {
  return left.pageIndex - right.pageIndex || left.blockIndex - right.blockIndex;
}

function isAppendixHeadingTitle(normalizedTitle: string): boolean {
  const exactMarkers = new Set([
    "答案",
    "index",
  ]);
  const prefixMarkers = [
    "附录",
    "词汇表",
    "术语表",
    "名词解释",
    "索引",
    "后记",
    "answerkey",
    "answers",
    "appendix",
    "glossary",
  ];
  const containedMarkers = [
    "参考答案",
    "答案与提示",
  ];
  return exactMarkers.has(normalizedTitle)
    || prefixMarkers.some((marker) => normalizedTitle.startsWith(marker))
    || containedMarkers.some((marker) => normalizedTitle.includes(marker));
}

function isTocHeadingTitle(normalizedTitle: string): boolean {
  return ["目录", "目次", "contents", "tableofcontents", "目录contents"].includes(normalizedTitle);
}

function restoreOutline(path: string, previousOutline: string | null): void {
  if (previousOutline === null) {
    rmSync(path, { force: true });
    return;
  }
  writeFileSync(path, previousOutline, "utf8");
}

function outOfOrderLessonIds(items: RawRecord[]): string[] {
  const lessons = items
    .filter((item) => item.kind === "lesson")
    .sort(compareOrderPath);
  const outOfOrder: string[] = [];
  let previousStart = 0;
  for (const lesson of lessons) {
    const currentStart = Number(lesson.md_start);
    if (!Number.isFinite(currentStart)) continue;
    if (currentStart <= previousStart) {
      outOfOrder.push(String(lesson.id ?? lesson.title ?? "unknown-item"));
    }
    previousStart = currentStart;
  }
  return outOfOrder;
}

function fillParentPageRanges(items: RawRecord[]): void {
  const childrenByParent = new Map<string, RawRecord[]>();
  for (const item of items) {
    const parentId = typeof item.parent_id === "string" ? item.parent_id : "";
    if (!parentId) continue;
    const children = childrenByParent.get(parentId) ?? [];
    children.push(item);
    childrenByParent.set(parentId, children);
  }
  for (const item of [...items].sort(compareHierarchyOrder).reverse()) {
    const itemId = typeof item.id === "string" ? item.id : "";
    const children = itemId ? childrenByParent.get(itemId) ?? [] : [];
    const childStarts = children.flatMap((child): number[] => hasNumber(child.page_start) ? [Number(child.page_start)] : []);
    const childEnds = children.flatMap((child): number[] => hasNumber(child.page_end) ? [Number(child.page_end)] : []);
    if (!hasNumber(item.page_start) && childStarts.length > 0) item.page_start = Math.min(...childStarts);
    if (!hasNumber(item.page_end) && childEnds.length > 0) item.page_end = Math.max(...childEnds);
  }
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

function headingScore(
  headingNorm: string,
  titleNorm: string,
  labelNorm: string,
  headingRaw = "",
  titleRaw = "",
  labelRaw = "",
): number {
  if (titleNorm && labelNorm && headingNorm.includes(titleNorm) && headingNorm.includes(labelNorm)) return 110;
  if (titleNorm && titleNorm === headingNorm) return 100;
  if (titleNorm && headingNorm.includes(titleNorm)) return 90;
  if (sharesSectionPath(headingRaw, titleRaw, labelRaw)) return 85;
  if (titleNorm && titleNorm.includes(headingNorm) && headingNorm.length / Math.max(1, titleNorm.length) >= 0.75) return 70;
  if (labelNorm && headingNorm.includes(labelNorm)) return 50;
  return 0;
}

function sharesSectionPath(heading: string, ...outlineValues: string[]): boolean {
  const headingPaths = extractSectionPaths(heading);
  if (headingPaths.size === 0) return false;
  return outlineValues.some((value) => [...extractSectionPaths(value)].some((path) => headingPaths.has(path)));
}

function extractSectionPaths(value: string): Set<string> {
  const normalized = value.replace(/[．。]/g, ".");
  return new Set(
    [...normalized.matchAll(/(?:^|[^\d.])(\d+(?:\.\d+)+)(?=$|[^\d.])/g)]
      .map((match) => match[1]!)
      .filter(Boolean),
  );
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

function compareHierarchyOrder(left: RawRecord, right: RawRecord): number {
  const leftKey = orderKey(left);
  const rightKey = orderKey(right);
  const sharedSize = Math.min(leftKey.length, rightKey.length);
  for (let index = 0; index < sharedSize; index += 1) {
    const delta = leftKey[index]! - rightKey[index]!;
    if (delta !== 0) return delta;
  }
  return leftKey.length - rightKey.length;
}

function compareDocumentOrder(left: RawRecord, right: RawRecord): number {
  const leftStart = hasNumber(left.md_start) ? Number(left.md_start) : Number.POSITIVE_INFINITY;
  const rightStart = hasNumber(right.md_start) ? Number(right.md_start) : Number.POSITIVE_INFINITY;
  if (leftStart !== rightStart) return leftStart - rightStart;
  return compareOrderPath(left, right);
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
