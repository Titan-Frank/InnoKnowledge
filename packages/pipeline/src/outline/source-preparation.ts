import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

import { parseHeadings, planChunkOutline, type ChunkOutlineItem } from "./chunk-outline.js";
import { classifyOutlineContent } from "./content-role.js";
import { findSiblingContentListV2 } from "./mineru-source.js";
import { iterOutlineItems, safePathToken, type OutlineItem } from "../shared/pathing.js";

type RawRecord = Record<string, unknown>;

type MarkdownHeading = { line: number; level: number; title: string; norm: string; raw: string };

type HeadingMatch = {
  confidence: number;
  matchType: "exact" | "number_and_title" | "containment" | "fuzzy_title" | "marker" | "existing";
};

type MatchedOutlineItem = {
  item: RawRecord;
  line: number;
  confidence: number;
  matchType: HeadingMatch["matchType"];
};

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
  warning_item_ids: string[];
  average_confidence: number;
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
      unmatched_item_ids: string[];
      warning_item_ids: string[];
      average_confidence: number;
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
  reuseSourceInPlace?: boolean;
}): SourceMarkdownPreparationResult {
  if (input.sourceMarkdownPath && input.sourceMarkdownPath.trim()) {
    const sourcePath = resolveInputPath(input.sourceMarkdownPath, input.repoRoot);
    if (!existsSync(sourcePath)) return { status: "blocked", error: `Source Markdown not found: ${sourcePath}` };

    // MinerU writes Markdown and its sibling image directories under the safe
    // book token. Reuse that same directory so relative image references stay
    // attached to the source instead of copying only full.md elsewhere.
    const mineruRoot = resolve(input.repoRoot, "data", "mineru");
    const sourceIsManaged = sourcePath === mineruRoot || sourcePath.startsWith(`${mineruRoot}${sep}`);
    const targetPath = sourceIsManaged || input.reuseSourceInPlace
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
  const contentListV2Path = findSiblingContentListV2(markdownPath);
  const headingSelection = selectEnrichHeadingSequence(lines, contentListV2Path);
  const structuredConstraint = headingSelection.ambiguous ? null : headingSelection.constraint;
  const allowedHeadingLines = structuredConstraint ? new Set(structuredConstraint.headingLines) : null;
  const pageByHeadingLine = new Map((structuredConstraint?.headingPages ?? []).map((entry) => [entry.line, entry.page]));
  const allHeadingRows = lines
    .map((line, index) => {
      const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
      if (!match) return null;
      if (allowedHeadingLines && !allowedHeadingLines.has(index + 1)) return null;
      const heading = match[2]!.trim();
      if (!heading || normalizeHeadingText(heading).length < 2) return null;
      return { line: index + 1, level: match[1]!.length, heading, raw: line.trim() };
    })
    .filter((row): row is { line: number; level: number; heading: string; raw: string } => row !== null);
  const headingRows = structuredConstraint ? allHeadingRows : selectMarkdownBodyHeadingRows(allHeadingRows);

  if (headingRows.length === 0) {
    return {
      status: "blocked",
      outline_path: input.outlinePath,
      error: "Could not derive an outline because Markdown has no headings.",
    };
  }

  const sourcePath = toRepoRelativePath(markdownPath, input.repoRoot);
  const automaticTocItems = structuredConstraint?.tocPages && contentListV2Path
    ? extractStructuredTocOutlineItems(input.bookId, contentListV2Path, structuredConstraint.tocPages)
    : [];
  if (automaticTocItems.length > 0) {
    mkdirSync(dirname(input.outlinePath), { recursive: true });
    writeOutlineRecord(input.outlinePath, {
      book_id: input.bookId,
      title: input.title?.trim() || input.bookId,
      source_path: sourcePath,
      source_kind: "auto_toc",
      generated_at: input.generatedAt ?? new Date().toISOString(),
      toc_pages: structuredConstraint?.tocPages,
      items: automaticTocItems,
    });
    const alignment = alignOutlineToMarkdown({
      outlinePath: input.outlinePath,
      markdownPath,
      repoRoot: input.repoRoot,
      headingLines: structuredConstraint?.headingLines,
      headingPages: structuredConstraint?.headingPages,
      markdownEndLine: structuredConstraint?.markdownEndLine,
      pageEnd: structuredConstraint?.pageEnd,
    });
    const lessonCount = automaticTocItems.filter((item) => item.kind === "lesson" || item.kind === "activity").length;
    const matchedLessonRatio = (lessonCount - alignment.unmatched_item_ids.length) / Math.max(1, lessonCount);
    if (matchedLessonRatio >= 0.5) {
      return {
        status: "completed",
        created: true,
        outline_path: input.outlinePath,
        item_count: automaticTocItems.length,
        source_path: sourcePath,
      };
    }
  }

  const markdownAppendixLine = structuredConstraint ? undefined : allHeadingRows
    .find((row) => isAppendixHeadingTitle(normalizeHeadingText(row.heading)))?.line;
  const finalMarkdownLine = Math.max(1, Math.min(
    lines.length,
    structuredConstraint?.markdownEndLine ?? (markdownAppendixLine === undefined ? lines.length : markdownAppendixLine - 1),
  ));
  const items = buildMarkdownOutlineItems(input.bookId, headingRows, pageByHeadingLine, finalMarkdownLine, structuredConstraint?.pageEnd);

  const outline = {
    book_id: input.bookId,
    title: input.title?.trim() || input.bookId,
    source_path: sourcePath,
    source_kind: "markdown",
    generated_at: input.generatedAt ?? new Date().toISOString(),
    toc_pages: structuredConstraint?.tocPages ?? { start: input.tocStart ?? 1, end: input.tocEnd ?? 1 },
    alignment_report: {
      strategy: structuredConstraint ? "structured_body_headings_v1" : "markdown_heading_hierarchy_v1",
      matched_items: items.length,
      total_items: items.length,
      matched_lessons: items.filter((item) => item.kind === "lesson" || item.kind === "activity").length,
      total_lessons: items.filter((item) => item.kind === "lesson" || item.kind === "activity").length,
      average_confidence: 1,
      warning_item_ids: [],
      unmatched_item_ids: [],
      requires_review: !structuredConstraint,
    },
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
    const matchedLessonCount = lessonCount - alignment.unmatched_item_ids.length;
    const matchedLessonRatio = matchedLessonCount / Math.max(1, lessonCount);
    if (matchedLessonRatio < 0.5) {
      restoreOutline(input.outlinePath, previousOutline);
      return {
        status: "skipped",
        outline_path: input.outlinePath,
        reason: `Enrich outline coverage was too low (${matchedLessonCount}/${lessonCount} lesson item(s) matched).`,
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
      unmatched_item_ids: alignment.unmatched_item_ids,
      warning_item_ids: alignment.warning_item_ids,
      average_confidence: alignment.average_confidence,
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
  const items = (iterOutlineItems(rootItems) as RawRecord[]).filter((item) => item.kind !== "chunk");
  const lines = readPlainLines(markdownPath);
  const markerLines = new Map<string, number>();
  const allowedHeadingLines = input.headingLines ? new Set(input.headingLines) : null;
  const pageByHeadingLine = new Map((input.headingPages ?? []).map((entry) => [entry.line, entry.page]));
  const parsedHeadings = parseMarkdownHeadings(lines);
  const eligibleHeadings = allowedHeadingLines
    ? parsedHeadings.filter((heading) => allowedHeadingLines.has(heading.line))
    : selectMarkdownBodyHeadingRows(parsedHeadings);
  const headings = combineSplitMarkdownHeadings(eligibleHeadings);
  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    const marker = /LESSON_START\s+id="([^"]+)"/.exec(line);
    if (marker) markerLines.set(marker[1]!, lineNumber);
  });

  const orderedItems = [...items].sort(compareHierarchyOrder);
  const matched: MatchedOutlineItem[] = [];
  let pendingItems: RawRecord[] = [];
  let previousFixedLine = 0;
  const flushPending = (nextFixedLine = Number.POSITIVE_INFINITY) => {
    if (pendingItems.length === 0) return;
    const available = headings.filter((heading) => heading.line > previousFixedLine && heading.line < nextFixedLine);
    matched.push(...alignHeadingSequence(pendingItems, available));
    pendingItems = [];
  };
  for (const item of orderedItems) {
    const itemId = typeof item.id === "string" ? item.id : "";
    const existingLine = hasNumber(item.md_start) && hasNumber(item.md_end) ? Number(item.md_start) : null;
    const markerLine = itemId ? markerLines.get(itemId) ?? null : null;
    const fixedLine = existingLine ?? markerLine;
    if (fixedLine === null || fixedLine <= previousFixedLine) {
      pendingItems.push(item);
      continue;
    }
    flushPending(fixedLine);
    matched.push({
      item,
      line: fixedLine,
      confidence: 1,
      matchType: existingLine === null ? "marker" : "existing",
    });
    previousFixedLine = fixedLine;
  }
  flushPending();

  const headingByLine = new Map(headings.map((heading) => [heading.line, heading]));
  for (const item of items) {
    delete item.alignment_confidence;
    delete item.alignment_match_type;
    delete item.alignment_status;
    if (!matched.some((row) => row.item === item) && !(hasNumber(item.md_start) && hasNumber(item.md_end))) {
      delete item.md_start;
      delete item.md_end;
    }
  }
  const matchedSorted = matched.sort((left, right) => left.line - right.line);
  for (const row of matchedSorted) {
    row.item.md_start = row.line;
    row.item.alignment_confidence = roundConfidence(row.confidence);
    row.item.alignment_match_type = row.matchType;
    row.item.alignment_status = row.confidence < 0.85 ? "warning" : "matched";
    const heading = headingByLine.get(row.line);
    if (heading) row.item.raw_line = heading.raw;
    const headingPage = pageByHeadingLine.get(row.line);
    if (headingPage !== undefined) row.item.page_start = headingPage;
  }

  const finalMarkdownLine = Math.max(1, Math.min(lines.length, input.markdownEndLine ?? lines.length));
  inferParentRangeStarts(items, "md_start");
  applyHierarchicalRangeEnds(items, "md_start", "md_end", finalMarkdownLine);
  inferParentRangeStarts(items, "page_start");
  applyHierarchicalRangeEnds(items, "page_start", "page_end", input.pageEnd);

  const sourcePath = toRepoRelativePath(markdownPath, input.repoRoot);
  const unmatchedItemIds = items
    .filter((item) => (item.kind === "lesson" || item.kind === "activity") && (!hasNumber(item.md_start) || !hasNumber(item.md_end)))
    .map((item) => typeof item.id === "string" && item.id ? item.id : String(item.title ?? item.label ?? "unknown-item"));
  const warningItemIds = items
    .filter((item) => (item.kind === "lesson" || item.kind === "activity") && item.alignment_status === "warning")
    .map((item) => String(item.id ?? item.title ?? "unknown-item"));
  const directConfidences = matchedSorted.map((row) => row.confidence);
  const averageConfidence = directConfidences.length > 0
    ? roundConfidence(directConfidences.reduce((sum, value) => sum + value, 0) / directConfidences.length)
    : 0;
  const lessonItems = items.filter((item) => item.kind === "lesson" || item.kind === "activity");
  const alignmentReport = {
    strategy: "global_monotonic_fuzzy_v1",
    matched_items: matchedSorted.length,
    total_items: items.length,
    matched_lessons: lessonItems.length - unmatchedItemIds.length,
    total_lessons: lessonItems.length,
    average_confidence: averageConfidence,
    warning_item_ids: warningItemIds,
    unmatched_item_ids: unmatchedItemIds,
    requires_review: warningItemIds.length > 0 || unmatchedItemIds.length > 0,
  };
  writeOutlineRecord(input.outlinePath, {
    ...outline,
    source_path: sourcePath,
    alignment_report: alignmentReport,
    [itemKey]: rootItems,
  });
  return {
    updated: true,
    matched_items: matchedSorted.length,
    total_items: items.length,
    unmatched_item_ids: unmatchedItemIds,
    warning_item_ids: warningItemIds,
    average_confidence: averageConfidence,
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
  const chunkableItems = itemsWithoutChunks.filter((item) => (
    (item.kind !== "lesson" && item.kind !== "activity") || (hasNumber(item.md_start) && hasNumber(item.md_end))
  ));
  const plan = planChunkOutline(chunkableItems, headings, {
    minLines: input.minLines,
    maxLines: input.maxLines,
    targetLines: input.targetLines,
    preserveLeafBoundaries: outline.source_kind === "enrich" || outline.source_kind === "auto_toc",
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

function selectMarkdownBodyHeadingRows<T extends { level: number; raw: string; heading?: string; title?: string }>(rows: T[]): T[] {
  const rowTitle = (row: T) => row.heading ?? row.title ?? "";
  const tocIndex = rows.findIndex((row) => isTocHeadingTitle(normalizeHeadingText(rowTitle(row))));
  let selected = rows;
  if (tocIndex >= 0) {
    const tocLevel = rows[tocIndex]!.level;
    const bodyOffset = rows.slice(tocIndex + 1).findIndex((row) => (
      row.level <= tocLevel
      && !isTocHeadingTitle(normalizeHeadingText(rowTitle(row)))
      && !isLikelyTocEntry(rowTitle(row))
      && !isAppendixHeadingTitle(normalizeHeadingText(rowTitle(row)))
    ));
    if (bodyOffset >= 0) selected = rows.slice(tocIndex + 1 + bodyOffset);
  }
  const appendixIndex = selected.findIndex((row) => isAppendixHeadingTitle(normalizeHeadingText(rowTitle(row))));
  return appendixIndex < 0 ? selected : selected.slice(0, appendixIndex);
}

function isLikelyTocEntry(value: string): boolean {
  return /(?:\.{2,}|…+|·+|\s{2,})\s*\d{1,4}\s*$/.test(value);
}

function buildMarkdownOutlineItems(
  bookId: string,
  rows: Array<{ line: number; level: number; heading: string; raw: string }>,
  pageByHeadingLine: Map<number, number>,
  markdownEndLine: number,
  pageEnd?: number,
): RawRecord[] {
  type ProvisionalItem = {
    row: { line: number; level: number; heading: string; raw: string };
    parentIndex: number | null;
    order: number[];
  };
  const provisional: ProvisionalItem[] = [];
  const stack: Array<{ rowLevel: number; itemIndex: number; order: number[] }> = [];
  const childCounts = new Map<number | null, number>();
  for (const row of rows) {
    while (stack.length > 0 && stack[stack.length - 1]!.rowLevel >= row.level) stack.pop();
    const parent = stack.at(-1);
    const parentIndex = parent?.itemIndex ?? null;
    const siblingNumber = (childCounts.get(parentIndex) ?? 0) + 1;
    childCounts.set(parentIndex, siblingNumber);
    const order = [...(parent?.order ?? []), siblingNumber];
    provisional.push({ row, parentIndex, order });
    stack.push({ rowLevel: row.level, itemIndex: provisional.length - 1, order });
  }

  const parentIndexes = new Set(provisional.flatMap((item) => item.parentIndex === null ? [] : [item.parentIndex]));
  const identities = provisional.map((item, index) => {
    const depth = item.order.length;
    const kind = parentIndexes.has(index) ? (depth === 1 ? "theme" : "topic") : "lesson";
    const token = item.order.join("-");
    return { kind, id: `struct:${bookId}:${kind}:${token}` };
  });
  const items = provisional.map((item, index): RawRecord => {
    const identity = identities[index]!;
    const parsed = parseOutlineHeading(item.row.heading, item.order.at(-1) ?? index + 1);
    return {
      id: identity.id,
      kind: identity.kind,
      label: parsed.label,
      title: parsed.title,
      level: item.order.length,
      order_path: item.order.join("."),
      raw_line: item.row.raw,
      md_start: item.row.line,
      page_start: pageByHeadingLine.get(item.row.line) ?? 1,
      alignment_confidence: 1,
      alignment_match_type: "exact",
      alignment_status: "matched",
      ...(item.parentIndex === null ? {} : { parent_id: identities[item.parentIndex]!.id }),
    };
  });
  applyHierarchicalRangeEnds(items, "md_start", "md_end", markdownEndLine);
  applyHierarchicalRangeEnds(items, "page_start", "page_end", pageEnd ?? 1);
  return items;
}

function parseOutlineHeading(heading: string, fallbackIndex: number): { label: string; title: string } {
  const match = /^((?:第\s*)?[0-9一二三四五六七八九十百千万]+(?:章|节|课|题|单元)|\d+(?:\s*[.．]\s*\d+)+|[一二三四五六七八九十百千万]+[、.])\s*(.*)$/.exec(heading.trim());
  if (!match) return { label: `第${fallbackIndex}课`, title: heading.trim() };
  const label = match[1]!.replace(/\s+/g, "").replace(/．/g, ".");
  return { label, title: match[2]!.trim() || heading.trim() };
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

function extractStructuredTocOutlineItems(
  bookId: string,
  contentListV2Path: string,
  tocPages: { start: number; end: number },
): RawRecord[] {
  const parsed = JSON.parse(readFileSync(contentListV2Path, "utf8")) as unknown;
  if (!Array.isArray(parsed) || !parsed.every(Array.isArray)) return [];
  const entries = parsed
    .slice(Math.max(0, tocPages.start - 1), Math.max(tocPages.start, tocPages.end))
    .flatMap((page) => page.filter(isRecord))
    .flatMap((block): Array<{ text: string; blockType: string }> => {
      const blockType = String(block.type ?? "");
      const content = isRecord(block.content) ? block.content : {};
      if (blockType === "title") return [{ text: mineruInlineText(content.title_content), blockType }];
      if (blockType === "paragraph") return [{ text: mineruInlineText(content.paragraph_content), blockType }];
      if (blockType === "list" && Array.isArray(content.list_items)) {
        return content.list_items.map((item) => ({ text: mineruInlineText(item), blockType }));
      }
      return [];
    })
    .filter((entry) => entry.text);

  const items: RawRecord[] = [];
  let rootIndex = 0;
  let currentChapter: { id: string; orderPath: string; childIndex: number } | null = null;
  for (const entry of entries) {
    const parsedEntry = parseTocEntry(entry.text, entry.blockType);
    if (!parsedEntry) continue;
    if (parsedEntry.kind === "chapter") {
      rootIndex += 1;
      const id = `struct:${bookId}:theme:${rootIndex}`;
      items.push({
        id,
        kind: "theme",
        label: parsedEntry.label,
        title: parsedEntry.title,
        level: 1,
        order_path: String(rootIndex),
        raw_line: entry.text,
        toc_declared_page: parsedEntry.page,
      });
      currentChapter = { id, orderPath: String(rootIndex), childIndex: 0 };
      continue;
    }
    if (parsedEntry.kind === "section" && currentChapter) {
      currentChapter.childIndex += 1;
      const orderPath = `${currentChapter.orderPath}.${currentChapter.childIndex}`;
      items.push({
        id: `struct:${bookId}:lesson:${orderPath.replace(/\./g, "-")}`,
        kind: "lesson",
        parent_id: currentChapter.id,
        label: parsedEntry.label,
        title: parsedEntry.title,
        level: 2,
        order_path: orderPath,
        raw_line: entry.text,
        toc_declared_page: parsedEntry.page,
      });
      continue;
    }
    if (parsedEntry.kind === "special") {
      rootIndex += 1;
      items.push({
        id: `struct:${bookId}:lesson:${rootIndex}`,
        kind: "lesson",
        label: `第${rootIndex}课`,
        title: parsedEntry.title,
        level: 1,
        order_path: String(rootIndex),
        raw_line: entry.text,
        toc_declared_page: parsedEntry.page,
      });
      currentChapter = null;
    }
  }
  return items;
}

function parseTocEntry(value: string, blockType: string): {
  kind: "chapter" | "section" | "special";
  label: string;
  title: string;
  page: number;
} | null {
  const normalized = value.normalize("NFKC").replace(/[．]/g, ".").replace(/\s+/g, " ").trim();
  const pageMatch = /(?:\.{2,}|…+|·+|\s)\s*(\d{1,4})\s*$/.exec(normalized);
  if (!pageMatch) return null;
  const page = Number(pageMatch[1]);
  const heading = normalized.slice(0, pageMatch.index).replace(/[.…·\s]+$/, "").trim();
  const chapter = /^(第\s*[0-9一二三四五六七八九十百千万]+\s*章)\s*(.+)$/.exec(heading);
  if (chapter) {
    return {
      kind: "chapter",
      label: chapter[1]!.replace(/\s+/g, ""),
      title: chapter[2]!.trim(),
      page,
    };
  }
  const section = /^(\d+(?:\s*\.\s*\d+)+)\s*(.+)$/.exec(heading);
  if (section) {
    return {
      kind: "section",
      label: section[1]!.replace(/\s+/g, ""),
      title: section[2]!.trim(),
      page,
    };
  }
  const normalizedHeading = normalizeHeadingText(heading);
  if (blockType === "title"
    && heading.length >= 4
    && !isTocHeadingTitle(normalizedHeading)
    && !isAppendixHeadingTitle(normalizedHeading)
    && !normalizedHeading.includes("索引")) {
    return { kind: "special", label: "", title: heading, page };
  }
  return null;
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
    const match = /^(#{1,6})\s+(\S.*)$/.exec(line);
    if (!match) return [];
    const title = match[2]!.trim();
    return [{ line: index + 1, level: match[1]!.length, title, norm: normalizeHeadingText(title), raw: line.trim() }];
  });
}

function combineSplitMarkdownHeadings(headings: MarkdownHeading[]): MarkdownHeading[] {
  const combined: MarkdownHeading[] = [];
  for (let index = 0; index < headings.length; index += 1) {
    const current = headings[index]!;
    const next = headings[index + 1];
    const currentTitle = current.raw.replace(/^#{1,6}\s+/, "").trim();
    const nextTitle = next?.raw.replace(/^#{1,6}\s+/, "").trim() ?? "";
    if (next && next.line - current.line <= 3 && isSectionNumberOnly(currentTitle) && !hasExplicitSectionNumber(nextTitle)) {
      const raw = `${current.raw} ${nextTitle}`;
      combined.push({
        line: current.line,
        level: Math.min(current.level, next.level),
        title: `${current.title} ${next.title}`,
        norm: normalizeHeadingText(raw),
        raw,
      });
      index += 1;
      continue;
    }
    combined.push(current);
  }
  return combined;
}

function alignHeadingSequence(items: RawRecord[], headings: MarkdownHeading[]): MatchedOutlineItem[] {
  if (items.length === 0 || headings.length === 0) return [];
  const width = headings.length + 1;
  const choices = new Uint8Array((items.length + 1) * width);
  let previous = new Float64Array(width);
  let current = new Float64Array(width);
  for (let itemIndex = 1; itemIndex <= items.length; itemIndex += 1) {
    current.fill(0);
    choices[itemIndex * width] = 1;
    for (let headingIndex = 1; headingIndex <= headings.length; headingIndex += 1) {
      let best = previous[headingIndex]!;
      let choice = 1;
      if (current[headingIndex - 1]! > best + 1e-9) {
        best = current[headingIndex - 1]!;
        choice = 2;
      }
      const match = headingMatch(items[itemIndex - 1]!, headings[headingIndex - 1]!);
      if (match && match.confidence >= 0.55) {
        const matchedScore = previous[headingIndex - 1]! + 1 + match.confidence;
        if (matchedScore > best + 1e-9) {
          best = matchedScore;
          choice = 3;
        }
      }
      current[headingIndex] = best;
      choices[itemIndex * width + headingIndex] = choice;
    }
    [previous, current] = [current, previous];
  }

  const result: MatchedOutlineItem[] = [];
  let itemIndex = items.length;
  let headingIndex = headings.length;
  while (itemIndex > 0 && headingIndex > 0) {
    const choice = choices[itemIndex * width + headingIndex];
    if (choice === 3) {
      const item = items[itemIndex - 1]!;
      const heading = headings[headingIndex - 1]!;
      const match = headingMatch(item, heading);
      if (match) result.push({ item, line: heading.line, confidence: match.confidence, matchType: match.matchType });
      itemIndex -= 1;
      headingIndex -= 1;
    } else if (choice === 2) {
      headingIndex -= 1;
    } else {
      itemIndex -= 1;
    }
  }
  return result.reverse();
}

function headingMatch(item: RawRecord, heading: MarkdownHeading): HeadingMatch | null {
  const titleRaw = String(item.title ?? "");
  const labelRaw = String(item.label ?? "");
  const titleNorm = normalizeHeadingText(titleRaw);
  const labelNorm = normalizeHeadingText(labelRaw);
  if (!titleNorm && !labelNorm) return null;
  const headingNorm = heading.norm;
  const combinedNorm = normalizeHeadingText(`${labelRaw}${titleRaw}`);
  if (headingNorm === titleNorm || (combinedNorm && headingNorm === combinedNorm)) {
    return { confidence: 0.99, matchType: "exact" };
  }

  const headingTitle = normalizeHeadingText(stripSectionNumber(heading.raw));
  const outlineTitle = normalizeHeadingText(stripSectionNumber(titleRaw));
  const titleSimilarity = characterSimilarity(headingTitle || headingNorm, outlineTitle || titleNorm);
  const level = Number(item.level);
  const levelCompatibility = Number.isFinite(level)
    ? Math.max(0, 1 - Math.abs(level - heading.level) * 0.25)
    : 0.5;
  const headingTokens = extractSectionTokens(heading.raw);
  const outlineTokens = new Set([...extractSectionTokens(titleRaw), ...extractSectionTokens(labelRaw)]);
  const sharedNumber = [...headingTokens].some((token) => outlineTokens.has(token));
  const conflictingNumbers = headingTokens.size > 0 && outlineTokens.size > 0 && !sharedNumber;

  if (!conflictingNumbers && titleNorm && (headingNorm.includes(titleNorm) || titleNorm.includes(headingNorm))) {
    const ratio = Math.min(headingNorm.length, titleNorm.length) / Math.max(1, Math.max(headingNorm.length, titleNorm.length));
    if (ratio >= 0.55) return { confidence: roundConfidence(0.88 + ratio * 0.08), matchType: "containment" };
  }
  if (sharedNumber) {
    const confidence = 0.42 + titleSimilarity * 0.53 + levelCompatibility * 0.05;
    return { confidence: roundConfidence(confidence), matchType: "number_and_title" };
  }
  if (conflictingNumbers && titleSimilarity < 0.92) return null;
  const labelSimilarity = labelNorm ? characterSimilarity(headingNorm, labelNorm) : 0;
  const confidence = Math.max(titleSimilarity * 0.92 + levelCompatibility * 0.08, labelSimilarity * 0.88);
  if (confidence < 0.5) return null;
  return { confidence: roundConfidence(confidence), matchType: "fuzzy_title" };
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

function inferParentRangeStarts(items: RawRecord[], key: "md_start" | "page_start"): void {
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
    const childStarts = children.flatMap((child): number[] => hasNumber(child[key]) ? [Number(child[key])] : []);
    if (!hasNumber(item[key]) && childStarts.length > 0) {
      item[key] = Math.min(...childStarts);
      if (key === "md_start") item.alignment_status = "inferred_from_children";
    }
  }
}

function applyHierarchicalRangeEnds(
  items: RawRecord[],
  startKey: "md_start" | "page_start",
  endKey: "md_end" | "page_end",
  fallbackEnd?: number,
): void {
  const ordered = [...items].sort(compareHierarchyOrder);
  const byId = new Map(ordered.flatMap((item): Array<[string, RawRecord]> => {
    const id = typeof item.id === "string" ? item.id : "";
    return id ? [[id, item]] : [];
  }));
  const isDescendant = (candidate: RawRecord, ancestor: RawRecord): boolean => {
    const ancestorId = typeof ancestor.id === "string" ? ancestor.id : "";
    let parentId = typeof candidate.parent_id === "string" ? candidate.parent_id : "";
    const visited = new Set<string>();
    while (parentId && !visited.has(parentId)) {
      if (parentId === ancestorId) return true;
      visited.add(parentId);
      const parent = byId.get(parentId);
      parentId = parent && typeof parent.parent_id === "string" ? parent.parent_id : "";
    }
    return false;
  };
  ordered.forEach((item, index) => {
    if (!hasNumber(item[startKey])) {
      delete item[endKey];
      return;
    }
    const start = Number(item[startKey]);
    const next = ordered.slice(index + 1).find((candidate) => (
      hasNumber(candidate[startKey]) && !isDescendant(candidate, item)
    ));
    const resolvedEnd = next
      ? Math.max(start, Number(next[startKey]) - 1)
      : Math.max(start, fallbackEnd ?? (hasNumber(item[endKey]) ? Number(item[endKey]) : start));
    item[endKey] = resolvedEnd;
  });
}

function resolveInputPath(path: string, repoRoot: string): string {
  return isAbsolute(path) ? path : resolve(repoRoot, path);
}

function toRepoRelativePath(path: string, repoRoot: string): string {
  const relativePath = relative(repoRoot, path).split(sep).join("/");
  return relativePath.startsWith("../") ? resolve(path) : relativePath;
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

function characterSimilarity(leftValue: string, rightValue: string): number {
  const left = Array.from(leftValue);
  const right = Array.from(rightValue);
  if (left.length === 0 || right.length === 0) return 0;
  if (leftValue === rightValue) return 1;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitution = previous[rightIndex - 1]! + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1);
      current[rightIndex] = Math.min(previous[rightIndex]! + 1, current[rightIndex - 1]! + 1, substitution);
    }
    previous = current;
  }
  const editSimilarity = 1 - previous[right.length]! / Math.max(left.length, right.length);
  const leftBigrams = characterBigrams(left);
  const rightBigrams = characterBigrams(right);
  if (leftBigrams.length === 0 || rightBigrams.length === 0) return Math.max(0, editSimilarity);
  const counts = new Map<string, number>();
  leftBigrams.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));
  let overlap = 0;
  for (const value of rightBigrams) {
    const count = counts.get(value) ?? 0;
    if (count <= 0) continue;
    overlap += 1;
    counts.set(value, count - 1);
  }
  const diceSimilarity = (2 * overlap) / (leftBigrams.length + rightBigrams.length);
  return Math.max(0, Math.min(1, Math.max(editSimilarity, diceSimilarity)));
}

function characterBigrams(value: string[]): string[] {
  if (value.length < 2) return [];
  return value.slice(0, -1).map((character, index) => `${character}${value[index + 1]!}`);
}

function extractSectionTokens(value: string): Set<string> {
  const normalized = value.normalize("NFKC").replace(/[．。]/g, ".").replace(/\s+/g, "");
  const tokens = [
    ...normalized.matchAll(/\d+(?:\.\d+)+/g),
    ...normalized.matchAll(/第[0-9一二三四五六七八九十百千万]+(?:章|节|课|单元)/g),
    ...normalized.matchAll(/(?:^|[^一二三四五六七八九十百千万])([一二三四五六七八九十百千万]+)[、.]/g),
  ].map((match) => (match[1] ?? match[0]).replace(/^[^0-9一二三四五六七八九十百千万第]+/, ""));
  return new Set(tokens.filter(Boolean));
}

function hasExplicitSectionNumber(value: string): boolean {
  return extractSectionTokens(value).size > 0;
}

function isSectionNumberOnly(value: string): boolean {
  const normalized = value.normalize("NFKC").replace(/[．。]/g, ".").replace(/\s+/g, "");
  return /^(?:\d+(?:\.\d+)+|第[0-9一二三四五六七八九十百千万]+(?:章|节|课|单元)|[一二三四五六七八九十百千万]+[、.])$/.test(normalized);
}

function stripSectionNumber(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/^#{1,6}\s*/, "")
    .replace(/^\s*(?:\d+(?:\s*[.．]\s*\d+)+|第\s*[0-9一二三四五六七八九十百千万]+\s*(?:章|节|课|单元)|[一二三四五六七八九十百千万]+[、.])\s*/, "")
    .trim();
}

function roundConfidence(value: number): number {
  return Math.round(Math.max(0, Math.min(1, value)) * 1000) / 1000;
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
