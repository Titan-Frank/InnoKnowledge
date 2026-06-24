export const DEFAULT_MAX_LINES = 300;
export const DEFAULT_MIN_LINES = 150;
export const DEFAULT_TARGET_LINES = 250;
export const CHUNK_SUFFIXES = "abcdefghijklmnopqrstuvwxyz";

const REVIEW_PATTERN = /小结|习题|复习|练习巩固|归纳小结|总结|参考文献|编程作业|人物专访|Wireshark/;

export type ChunkOutlineItem = {
  id?: string;
  kind?: string;
  parent_id?: string | null;
  md_start?: unknown;
  md_end?: unknown;
  page_start?: unknown;
  page_end?: unknown;
  title?: unknown;
  [key: string]: unknown;
};

export type MarkdownHeading = {
  line: number;
  text: string;
};

export type ChunkItem = ChunkOutlineItem & {
  id: string;
  kind: "chunk";
  label: string;
  title: string;
  level: 4;
  order_path: string;
  parent_id: string;
  source_ids: string[];
  raw_line: "";
};

export type ChunkOutlineStats = {
  split: number;
  merged: number;
  normal: number;
  review_skipped: number;
};

export type ChunkOutlinePlan = {
  chunks: ChunkItem[];
  stats: ChunkOutlineStats;
  size_summary: {
    min: number;
    max: number;
    avg: number;
  } | null;
};

export type ChunkOutlineDocument = Record<string, unknown> & {
  items: ChunkOutlineItem[];
};

type LogicalSection = {
  start: number;
  end: number;
  title: string;
};

export function mdSpan(item: ChunkOutlineItem): number {
  const start = item.md_start;
  const end = item.md_end;
  if (start !== undefined && start !== null && end !== undefined && end !== null) {
    const numericStart = Number(start);
    const numericEnd = Number(end);
    if (Number.isFinite(numericStart) && Number.isFinite(numericEnd)) return numericEnd - numericStart + 1;
  }
  return 0;
}

export function pageSpan(item: ChunkOutlineItem): number {
  const start = item.page_start;
  const end = item.page_end;
  if (start !== undefined && start !== null && end !== undefined && end !== null) {
    const numericStart = Number.parseInt(String(start), 10);
    const numericEnd = Number.parseInt(String(end), 10);
    if (Number.isFinite(numericStart) && Number.isFinite(numericEnd)) return numericEnd - numericStart + 1;
  }
  return 0;
}

export function topicIdFor(item: ChunkOutlineItem, items: ChunkOutlineItem[]): string | null {
  const parentId = item.parent_id;
  if (parentId === undefined || parentId === null) {
    return item.kind === "topic" && item.id ? item.id : null;
  }
  const byId = new Map(items.filter((candidate) => candidate.id).map((candidate) => [candidate.id as string, candidate]));
  const parent = byId.get(parentId);
  if (!parent) return parentId;
  if (parent.kind === "topic") return parent.id ?? null;
  return topicIdFor(parent, items);
}

export function parseHeadings(lines: string[]): MarkdownHeading[] {
  const result: MarkdownHeading[] = [];
  lines.forEach((line, index) => {
    const match = /^(#{1,6})\s+(.+)/.exec(line);
    if (match) result.push({ line: index + 1, text: match[2]!.trim() });
  });
  return result;
}

export function isReviewItem(item: ChunkOutlineItem): boolean {
  return REVIEW_PATTERN.test(String(item.title ?? ""));
}

export function mergeUndersized(itemsInTopic: ChunkOutlineItem[], minLines: number, maxLines: number): ChunkOutlineItem[][] {
  const groups: ChunkOutlineItem[][] = [];
  let index = 0;

  while (index < itemsInTopic.length) {
    const item = itemsInTopic[index]!;
    const span = mdSpan(item);

    if (item.kind === "activity") {
      if (groups.length > 0 && groups[groups.length - 1]!.length === 1) {
        const previous = groups[groups.length - 1]![0]!;
        const previousSpan = mdSpan(previous);
        const combined = previousSpan + span;
        if (previousSpan <= maxLines && combined <= maxLines) {
          groups[groups.length - 1]!.push(item);
          index += 1;
          continue;
        }
      }
      groups.push([item]);
      index += 1;
      continue;
    }

    if (span < minLines && item.kind === "lesson") {
      const group = [item];
      let nextIndex = index + 1;
      while (nextIndex < itemsInTopic.length) {
        const nextItem = itemsInTopic[nextIndex]!;
        const nextSpan = mdSpan(nextItem);
        const combined = group.reduce((sum, groupItem) => sum + mdSpan(groupItem), 0) + nextSpan;
        const mergeable = (nextItem.kind === "activity" || mdSpan(nextItem) < minLines) && combined <= maxLines;
        if (!mergeable) break;
        group.push(nextItem);
        nextIndex += 1;
      }
      groups.push(group);
      index = nextIndex;
      continue;
    }

    groups.push([item]);
    index += 1;
  }

  return groups;
}

export function splitOversized(item: ChunkOutlineItem, headings: MarkdownHeading[], target: number, maxLines: number): ChunkItem[] {
  const start = Number(item.md_start ?? 0);
  const end = Number(item.md_end ?? 0);
  const span = end - start + 1;

  if (span <= maxLines) return [makeSingleChunk(item)];

  const inner = headings.filter((heading) => start <= heading.line && heading.line <= end);
  if (inner.length === 0) return [makeSingleChunk(item)];

  const boundaries = [start, ...inner.map((heading) => heading.line), end + 1];
  const rawSections: LogicalSection[] = [];
  for (let index = 0; index < boundaries.length - 1; index += 1) {
    const sectionStart = boundaries[index]!;
    const sectionEnd = boundaries[index + 1]! - 1;
    const heading = inner.find((candidate) => sectionStart <= candidate.line && candidate.line <= sectionEnd);
    rawSections.push({ start: sectionStart, end: sectionEnd, title: heading?.text ?? "" });
  }

  const minSection = Math.max(Math.trunc(target / 4), 30);
  const logicalSections = mergeTinySections(rawSections, minSection);
  let chunkStart = logicalSections[0]!.start;
  let titleParts: string[] = [];
  let accumulated = 0;
  let chunks: ChunkItem[] = [];

  for (const section of logicalSections) {
    const sectionLength = section.end - section.start + 1;
    if (accumulated > 0 && accumulated + sectionLength > target * 1.3) {
      chunks.push(makeChunk(item, chunkStart, section.start - 1, CHUNK_SUFFIXES[chunks.length]!, titleParts));
      chunkStart = section.start;
      titleParts = section.title ? [section.title] : [];
      accumulated = sectionLength;
    } else {
      if (section.title && titleParts.length === 0) titleParts.push(section.title);
      accumulated += sectionLength;
    }
  }

  if (accumulated > 0) {
    chunks.push(makeChunk(item, chunkStart, end, CHUNK_SUFFIXES[chunks.length]!, titleParts));
  }

  if (chunks.length > 1) {
    const merged: ChunkItem[] = [chunks[0]!];
    for (const chunk of chunks.slice(1)) {
      if (mdSpan(chunk) < minSection && merged.length > 0) {
        const previous = merged[merged.length - 1]!;
        previous.md_end = chunk.md_end;
        previous.source_ids = uniqueStrings([...previous.source_ids, ...chunk.source_ids]);
        if (chunk.page_end) previous.page_end = chunk.page_end;
      } else {
        merged.push(chunk);
      }
    }
    chunks = merged;
  }

  return chunks;
}

export function planChunkOutline(
  items: ChunkOutlineItem[],
  headings: MarkdownHeading[],
  options: { minLines?: number; maxLines?: number; targetLines?: number } = {},
): ChunkOutlinePlan {
  const minLines = options.minLines ?? DEFAULT_MIN_LINES;
  const maxLines = options.maxLines ?? DEFAULT_MAX_LINES;
  const targetLines = options.targetLines ?? DEFAULT_TARGET_LINES;
  const leafItems = items.filter((item) => item.kind === "lesson" || item.kind === "activity");
  const topicGroups = new Map<string, ChunkOutlineItem[]>();
  for (const item of leafItems) {
    const topicId = topicIdFor(item, items) ?? "__none__";
    const group = topicGroups.get(topicId) ?? [];
    group.push(item);
    topicGroups.set(topicId, group);
  }

  const chunks: ChunkItem[] = [];
  const stats: ChunkOutlineStats = { split: 0, merged: 0, normal: 0, review_skipped: 0 };
  const byId = new Map(items.filter((item) => item.id).map((item) => [item.id as string, item]));

  for (const topicLeaves of topicGroups.values()) {
    const contentLeaves: ChunkOutlineItem[] = [];
    for (const item of topicLeaves) {
      if (isReviewItem(item)) {
        stats.review_skipped += 1;
      } else {
        contentLeaves.push(item);
      }
    }
    if (contentLeaves.length === 0) continue;

    const byChapter = new Map<string, ChunkOutlineItem[]>();
    for (const item of contentLeaves) {
      const chapterKey = chapterKeyFor(item, byId);
      const chapterItems = byChapter.get(chapterKey) ?? [];
      chapterItems.push(item);
      byChapter.set(chapterKey, chapterItems);
    }

    const mergeGroups: ChunkOutlineItem[][] = [];
    for (const chapterLeaves of byChapter.values()) {
      mergeGroups.push(...mergeUndersized(chapterLeaves, minLines, maxLines));
    }

    for (const group of mergeGroups) {
      if (group.length > 1) {
        chunks.push(makeMergedChunk(group, CHUNK_SUFFIXES[chunks.length % 26]!));
        stats.merged += 1;
        continue;
      }
      const item = group[0]!;
      if (mdSpan(item) > maxLines) {
        chunks.push(...splitOversized(item, headings, targetLines, maxLines));
        stats.split += 1;
      } else {
        chunks.push(makeSingleChunk(item));
        stats.normal += 1;
      }
    }
  }

  return {
    chunks,
    stats,
    size_summary: summarizeChunkSizes(chunks),
  };
}

export function appendChunkItems<T extends ChunkOutlineDocument>(outline: T, chunks: ChunkItem[]): T {
  return {
    ...outline,
    items: [...outline.items, ...chunks],
  };
}

export function makeSingleChunk(item: ChunkOutlineItem): ChunkItem {
  return makeChunk(item, item.md_start ?? null, item.md_end ?? null, CHUNK_SUFFIXES[0]!, []);
}

export function makeChunk(
  parent: ChunkOutlineItem,
  mdStart: unknown,
  mdEnd: unknown,
  suffix: string,
  titleParts: string[],
): ChunkItem {
  const parentId = requiredId(parent);
  const bookId = parentId.includes(":") ? parentId.split(":")[1]! : "";
  const local = parentId.includes(":") ? parentId.split(":").at(-1)! : parentId;
  const chunkOrder = `${local}-${suffix}`;
  const labelSuffix = ({ a: "上", b: "中", c: "下" } as Record<string, string>)[suffix] ?? suffix;
  const label = `${String(parent.label ?? "")} (${labelSuffix})`;

  let title = String(parent.title ?? "");
  if (titleParts.length > 0) {
    const subtitle = titleParts.filter(Boolean).join(" — ");
    if (subtitle && subtitle !== title) title = `${title} — ${subtitle}`;
  }

  const [pageStart, pageEnd] = interpolateChunkPages(parent, mdStart, mdEnd);

  return {
    id: `struct:${bookId}:chunk:${chunkOrder}`,
    kind: "chunk",
    label,
    title,
    page_start: pageStart,
    page_end: pageEnd,
    md_start: mdStart,
    md_end: mdEnd,
    level: 4,
    order_path: `${String(parent.order_path ?? "")}-${suffix}`,
    parent_id: parentId,
    source_ids: [parentId],
    raw_line: "",
  };
}

export function makeMergedChunk(mergedItems: ChunkOutlineItem[], suffix: string): ChunkItem {
  if (mergedItems.length === 0) throw new Error("mergedItems must contain at least one item.");
  const first = mergedItems[0]!;
  const last = mergedItems[mergedItems.length - 1]!;
  const firstId = requiredId(first);
  const bookId = firstId.includes(":") ? firstId.split(":")[1]! : "";
  const local = firstId.includes(":") ? firstId.split(":").at(-1)! : firstId;
  const chunkOrder = `${local}-${suffix}`;

  return {
    id: `struct:${bookId}:chunk:${chunkOrder}`,
    kind: "chunk",
    label: mergedItems.map((item) => String(item.label ?? "")).join(" + "),
    title: mergedItems.map((item) => String(item.title ?? "")).join(" & "),
    page_start: first.page_start,
    page_end: last.page_end,
    md_start: first.md_start,
    md_end: last.md_end,
    level: 4,
    order_path: `${String(first.order_path ?? "")}-${suffix}`,
    parent_id: firstId,
    source_ids: mergedItems.map(requiredId),
    raw_line: "",
  };
}

function interpolateChunkPages(parent: ChunkOutlineItem, mdStart: unknown, mdEnd: unknown): [unknown, unknown] {
  let chunkPageStart = parent.page_start;
  let chunkPageEnd = parent.page_end;
  if (mdStart && mdEnd && parent.page_start && parent.page_end) {
    try {
      const parentMdStart = Number.parseInt(String(parent.md_start ?? 0), 10);
      const parentMdEnd = Number.parseInt(String(parent.md_end ?? 0), 10);
      const parentSpan = parentMdEnd - parentMdStart;
      if (parentSpan > 0) {
        const fractionStart = (Number.parseInt(String(mdStart), 10) - parentMdStart) / parentSpan;
        const fractionEnd = (Number.parseInt(String(mdEnd), 10) - parentMdStart) / parentSpan;
        const pageStart = Number.parseInt(String(parent.page_start), 10);
        const pageEnd = Number.parseInt(String(parent.page_end), 10);
        if ([fractionStart, fractionEnd, pageStart, pageEnd].every(Number.isFinite)) {
          chunkPageStart = pageStart + Math.round(fractionStart * (pageEnd - pageStart));
          chunkPageEnd = pageStart + Math.round(fractionEnd * (pageEnd - pageStart));
        }
      }
    } catch {
      return [chunkPageStart, chunkPageEnd];
    }
  }
  return [chunkPageStart, chunkPageEnd];
}

function requiredId(item: ChunkOutlineItem): string {
  if (!item.id) throw new Error("Outline item is missing id.");
  return item.id;
}

function mergeTinySections(rawSections: LogicalSection[], minSection: number): LogicalSection[] {
  if (rawSections.length === 0) return [];
  const logical: LogicalSection[] = [];
  let current = { ...rawSections[0]! };
  for (const section of rawSections.slice(1)) {
    const currentLength = current.end - current.start + 1;
    if (currentLength < minSection) {
      current.end = section.end;
      if (!current.title) current.title = section.title;
    } else {
      logical.push(current);
      current = { ...section };
    }
  }
  logical.push(current);
  return logical;
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values)];
}

function chapterKeyFor(item: ChunkOutlineItem, byId: Map<string, ChunkOutlineItem>): string {
  const parentId = String(item.parent_id ?? "");
  let parent = byId.get(parentId);
  while (parent && parent.kind !== "theme" && parent.parent_id) {
    parent = byId.get(String(parent.parent_id));
  }
  return parent?.kind === "theme" && parent.id ? parent.id : parentId;
}

function summarizeChunkSizes(chunks: ChunkItem[]): ChunkOutlinePlan["size_summary"] {
  if (chunks.length === 0) return null;
  const sizes = chunks.map(mdSpan);
  return {
    min: Math.min(...sizes),
    max: Math.max(...sizes),
    avg: Math.trunc(sizes.reduce((sum, size) => sum + size, 0) / sizes.length),
  };
}
