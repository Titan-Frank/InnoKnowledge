import { loadOutlineItems, makeStableSuffix, normalizeTerm, uniqueStable } from "./pathing.js";

export const TEXTBOOK_SOURCE_PREFIX = "textbook:";

const ANCHOR_ID_PATTERN = /^struct:(?<bookId>[^:]+):(?<kind>[^:]+):(?<local>.+)$/;

export const VALID_NODE_KINDS = new Set([
  "entity",
  "concept",
  "property",
  "process",
  "event",
  "method",
  "rule",
  "representation",
  "resource",
]);

export const VALID_DOMAINS = new Set([
  "mathematics",
  "physics",
  "chemistry",
  "biology",
  "earth-science",
  "astronomy",
  "computer-science",
  "engineering",
  "language-arts",
  "linguistics",
  "literature",
  "history",
  "geography",
  "civics",
  "economics",
  "law",
  "education",
  "arts",
  "music",
  "health",
  "sports",
  "philosophy",
  "general",
]);

export const VALID_KNOWLEDGE_FORMS = new Set(["propositional", "practical"]);
export const VALID_LEARNING_MODES = new Set(["factual", "conceptual", "procedural", "metacognitive"]);
export const VALID_SCOPE = new Set(["universal", "domain-specific", "culture-specific"]);

export const VALID_EDGE_TYPES = new Set([
  "is_a",
  "instance_of",
  "part_of",
  "contains",
  "has_property",
  "uses",
  "produces",
  "depends_on",
  "prerequisite_for",
  "causes",
  "affects",
  "represents",
  "about",
  "same_as",
  "related_to",
]);

export const HIERARCHICAL_EDGE_TYPES = new Set([
  "is_a",
  "instance_of",
  "part_of",
  "contains",
  "depends_on",
  "prerequisite_for",
]);

export const VALID_SCHOOL_STAGES = new Set(["primary", "junior-secondary", "senior-secondary", "higher"]);
export const VALID_CURRICULUM_ROLES = new Set(["core", "support", "assessment", "practice", "literacy"]);

export function dumpJsonText(value: unknown): string {
  return JSON.stringify(value);
}

export function utcNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
}

export function loadJsonText(value: string | null | undefined, defaultValue: unknown): unknown {
  if (value === undefined || value === null || value === "") return defaultValue;
  try {
    return JSON.parse(value);
  } catch {
    return defaultValue;
  }
}

export function inferLearningModes(kind: string | null | undefined): string[] {
  if (kind === "method") return ["procedural"];
  if (kind === "representation" || kind === "property") return ["factual", "conceptual"];
  if (kind === "entity" || kind === "event" || kind === "resource") return ["factual"];
  return ["conceptual"];
}

export function normalizeLearningModes(learningModes: Iterable<string> | null | undefined, kind: string | null | undefined): string[] {
  const cleaned = uniqueStable([...(learningModes ?? [])].filter((mode) => VALID_LEARNING_MODES.has(mode)));
  return cleaned.length > 0 ? cleaned : inferLearningModes(kind);
}

export function requireValidEdgeType(edgeType: string): string {
  if (!VALID_EDGE_TYPES.has(edgeType)) {
    const allowed = [...VALID_EDGE_TYPES].sort().join(", ");
    throw new Error(`Invalid edge type '${edgeType}'. Allowed values: ${allowed}`);
  }
  return edgeType;
}

export function makeQueryId(batchAnchor: string, queryText: string): string {
  return `query:${makeStableSuffix([batchAnchor, queryText], 12)}`;
}

export function makeMergeRunId(datasetId: string, lessonRunIds: Iterable<string>): string {
  return `merge:${makeStableSuffix([datasetId, ...[...lessonRunIds].sort()], 12)}`;
}

export function makeCanonicalNodeId(kind: string, name: string, subkind?: string | null): string {
  const prefix = subkind ? `${kind}/${subkind}` : kind;
  return `${prefix}:auto-${makeStableSuffix([prefix, normalizeTerm(name)], 12)}`;
}

export function makeEvidenceId(lessonRunId: string, rawEvidenceId: string, anchorRef: string, excerpt: string): string {
  return `evidence:auto-${makeStableSuffix([lessonRunId, rawEvidenceId, anchorRef, excerpt], 12)}`;
}

export function makeMentionId(lessonRunId: string, rawMentionId: string, targetType: string, targetId: string): string {
  return `mention:auto-${makeStableSuffix([lessonRunId, rawMentionId, targetType, targetId], 12)}`;
}

export function mergeUniqueStrings(...groups: Array<Iterable<unknown> | null | undefined>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const group of groups) {
    for (const value of group ?? []) {
      if (typeof value !== "string") continue;
      const token = value.trim();
      if (!token || seen.has(token)) continue;
      seen.add(token);
      result.push(token);
    }
  }
  return result;
}

export function mergeTextBlocks(...values: Array<string | null | undefined>): string {
  const parts = mergeUniqueStrings(values.filter((value): value is string => typeof value === "string" && value.trim().length > 0).map((value) => value.trim()));
  return parts.join("\n\n");
}

export function mergeJsonObjects(base: Record<string, unknown>, update: Record<string, unknown>): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(update)) {
    if (!(key in merged) || isEmptyMergeValue(merged[key])) {
      merged[key] = value;
      continue;
    }
    const current = merged[key];
    if (Object.is(current, value)) continue;
    if (isPlainObject(current) && isPlainObject(value)) {
      merged[key] = mergeJsonObjects(current, value);
      continue;
    }
    if (Array.isArray(current) && Array.isArray(value)) {
      merged[key] = mergeUniqueStrings(current, value);
      continue;
    }
    if (typeof current === "string" && typeof value === "string") {
      merged[key] = mergeTextBlocks(current, value);
    }
  }
  return merged;
}

export function cosineSimilarity(left: Iterable<number>, right: Iterable<number>): number {
  const leftValues = [...left].map(Number);
  const rightValues = [...right].map(Number);
  if (leftValues.length === 0 || leftValues.length !== rightValues.length) return 0;
  const numerator = leftValues.reduce((sum, value, index) => sum + value * rightValues[index]!, 0);
  const leftNorm = Math.sqrt(leftValues.reduce((sum, value) => sum + value * value, 0));
  const rightNorm = Math.sqrt(rightValues.reduce((sum, value) => sum + value * value, 0));
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return numerator / (leftNorm * rightNorm);
}

export function loadChunksForBook(bookId: string): Array<Record<string, unknown>> {
  return loadOutlineItems(bookId).filter((item) => item.kind === "chunk");
}

export function bookIdFromAnchor(anchorRef: string | null | undefined): string | null {
  if (!anchorRef) return null;
  const match = ANCHOR_ID_PATTERN.exec(anchorRef);
  return match?.groups?.bookId ?? null;
}

export function stripTextbookSourcePrefix(sourceId: string | null | undefined): string | null | undefined {
  if (!sourceId) return sourceId;
  return sourceId.startsWith(TEXTBOOK_SOURCE_PREFIX) ? sourceId.slice(TEXTBOOK_SOURCE_PREFIX.length) : sourceId;
}

export function normalizeTextbookSourceId(
  sourceType: string | null | undefined,
  sourceId: string | null | undefined,
  anchorRef?: string | null,
  options: { expectedBookId?: string | null } = {},
): string | null | undefined {
  if (sourceType !== "textbook") return sourceId;
  return options.expectedBookId ?? bookIdFromAnchor(anchorRef) ?? stripTextbookSourcePrefix(sourceId) ?? sourceId;
}

function isEmptyMergeValue(value: unknown): boolean {
  if (value === null || value === "") return true;
  if (Array.isArray(value)) return value.length === 0;
  if (isPlainObject(value)) return Object.keys(value).length === 0;
  return false;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
