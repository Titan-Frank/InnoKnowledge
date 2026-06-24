import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export type OutlineItem = {
  id?: string;
  kind?: string;
  parent_id?: string;
  order_path?: string;
  children?: OutlineItem[];
  [key: string]: unknown;
};

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(MODULE_DIR, "../../../..");
export const OUTLINES_DIR = resolve(REPO_ROOT, "data/outlines");
const ANCHOR_ID_PATTERN = /^struct:(?<bookId>[^:]+):(?<kind>[^:]+):(?<local>.+)$/;

export function loadJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

export function normalizeTerm(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function makeStableSuffix(parts: readonly string[], length = 16): string {
  return createHash("sha1").update(parts.join("||"), "utf8").digest("hex").slice(0, length);
}

export function makeStableSuffixWithLength(parts: string[], length = 16): string {
  return makeStableSuffix(parts, length);
}

export function makeEdgeId(fromNodeId: string, edgeType: string, toNodeId: string): string {
  const suffix = makeStableSuffixWithLength([fromNodeId, edgeType, toNodeId], 12);
  return `edge:auto-${suffix}`;
}

export function makeLessonRunId(bookId: string, batchAnchor: string): string {
  const suffix = makeStableSuffixWithLength([bookId, batchAnchor], 12);
  return `lesson-run:${suffix}`;
}

export function makeProfileId(nodeId: string, contextKey: string): string {
  const suffix = makeStableSuffixWithLength([nodeId, contextKey], 12);
  return `profile:auto-${suffix}`;
}

export function makeDomainProfileId(nodeId: string, domain: string): string {
  const suffix = makeStableSuffixWithLength([nodeId, domain], 12);
  return `domain-profile:auto-${suffix}`;
}

export function makeNodeCardId(nodeId: string): string {
  const suffix = makeStableSuffixWithLength([nodeId], 12);
  return `node-card:auto-${suffix}`;
}

export function safePathToken(value: string): string {
  const token = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "__").replace(/^[._]+|[._]+$/g, "");
  return token || "item";
}

export function uniqueStable<T>(values: Iterable<T>): T[] {
  const result: T[] = [];
  const seen = new Set<T>();
  for (const value of values) {
    if (seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

export function outlinePathForBook(bookId: string): string {
  return resolve(OUTLINES_DIR, `${bookId}.outline.json`);
}

export function iterOutlineItems(items: Iterable<OutlineItem>): OutlineItem[] {
  const result: OutlineItem[] = [];
  const queue = [...items];
  while (queue.length > 0) {
    const item = queue.shift();
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    result.push(item);
    if (Array.isArray(item.children)) {
      queue.push(...item.children.filter((child): child is OutlineItem => Boolean(child) && typeof child === "object"));
    }
  }
  return result;
}

export function loadOutlineItems(bookId: string): OutlineItem[] {
  const outlinePath = outlinePathForBook(bookId);
  if (!existsSync(outlinePath)) return [];
  const outline = loadJson(outlinePath);
  const items =
    outline && typeof outline === "object" && !Array.isArray(outline)
      ? ((outline as { structure?: unknown; items?: unknown }).structure ?? (outline as { items?: unknown }).items ?? [])
      : [];
  return Array.isArray(items) ? iterOutlineItems(items as OutlineItem[]) : [];
}

export function anchorTokenVariants(anchorId: string, bookId?: string): string[] {
  const variants = [anchorId];
  const match = ANCHOR_ID_PATTERN.exec(anchorId);
  if (match?.groups && (bookId === undefined || match.groups.bookId === bookId)) {
    const { kind, local } = match.groups;
    const scoped = `${kind}:${local}`;
    variants.push(scoped, scoped.replace(":", "-"), local);
  }
  return uniqueStable(variants);
}

export function resolveOutlineAnchor(bookId: string, anchor: string, options: { strict?: boolean } = {}): string {
  const items = loadOutlineItems(bookId);
  if (items.length === 0) {
    if (options.strict) {
      throw new Error(`Outline not found for book '${bookId}': ${outlinePathForBook(bookId)}`);
    }
    return anchor;
  }

  const byId = new Map(items.filter((item) => item.id).map((item) => [item.id as string, item]));
  if (byId.has(anchor)) return anchor;

  const matches = uniqueStable([...byId.keys()].filter((itemId) => anchorTokenVariants(itemId, bookId).includes(anchor)));
  if (matches.length === 1) return matches[0];
  if (matches.length > 0 && options.strict) {
    throw new Error(`Anchor '${anchor}' is ambiguous for book '${bookId}'. Matches: ${matches.slice(0, 5).join(", ")}`);
  }
  if (options.strict) {
    throw new Error(
      `Anchor '${anchor}' was not found in outline for book '${bookId}'. Use a canonical outline id such as: ${[...byId.keys()]
        .sort()
        .slice(0, 5)
        .join(", ")}`,
    );
  }
  return anchor;
}

export function resolveChunkOrLesson(bookId: string, anchor: string): OutlineItem | OutlineItem[] | null {
  const items = loadOutlineItems(bookId);
  const byId = new Map(items.filter((item) => item.id).map((item) => [item.id as string, item]));
  const resolved = resolveOutlineAnchor(bookId, anchor, { strict: false });
  const item = byId.get(resolved);
  if (!item) return null;
  if (item.kind === "chunk") return item;
  const chunks = items.filter((candidate) => candidate.parent_id === resolved && candidate.kind === "chunk");
  if (chunks.length > 0) {
    return chunks.sort((left, right) => {
      const leftOrder = String(left.order_path ?? "");
      const rightOrder = String(right.order_path ?? "");
      if (leftOrder < rightOrder) return -1;
      if (leftOrder > rightOrder) return 1;
      return 0;
    });
  }
  return item;
}
