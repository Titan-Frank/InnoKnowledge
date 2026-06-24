import {
  appendChunkItems,
  planChunkOutline,
  type ChunkOutlineDocument,
  type ChunkOutlineItem,
  type ChunkOutlinePlan,
  type MarkdownHeading,
} from "./chunk-outline.js";

type RawRecord = Record<string, unknown>;

export type ChunkOutlineInput = {
  itemsJson?: string;
  outlineJson?: string;
  headingsJson?: string;
  includeOutline?: boolean;
  minLines?: number;
  maxLines?: number;
  targetLines?: number;
};

export type ChunkOutlineOutput = ChunkOutlinePlan & {
  status: "success";
  outline?: ChunkOutlineDocument;
};

export function runChunkOutline(input: ChunkOutlineInput): ChunkOutlineOutput {
  const outline = input.outlineJson ? parseOutline(input.outlineJson) : null;
  const items = outline ? outline.items : parseItems(required(input.itemsJson, "items-json"));
  const plan = planChunkOutline(items, input.headingsJson ? parseHeadingsJson(input.headingsJson) : [], {
    minLines: input.minLines,
    maxLines: input.maxLines,
    targetLines: input.targetLines,
  });

  return {
    status: "success",
    ...plan,
    ...(input.includeOutline && outline ? { outline: appendChunkItems(outline, plan.chunks) } : {}),
  };
}

function parseOutline(value: string): ChunkOutlineDocument {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid outline-json: ${(error as Error).message}`);
  }
  if (!isRecord(parsed)) {
    throw new Error("Invalid outline-json: expected a JSON object.");
  }
  if (!Array.isArray(parsed.items) || !parsed.items.every(isRecord)) {
    throw new Error("Invalid outline-json: expected field 'items' to be a JSON array of objects.");
  }
  return { ...parsed, items: parsed.items.map((row) => ({ ...row })) };
}

function parseItems(value: string): ChunkOutlineItem[] {
  return parseRecordArray(value, "items-json").map((row) => ({ ...row }));
}

function parseHeadingsJson(value: string): MarkdownHeading[] {
  return parseRecordArray(value, "headings-json").map((row) => ({
    line: requiredNumber(row, "line", "headings-json"),
    text: requiredString(row, "text", "headings-json"),
  }));
}

function parseRecordArray(value: string, name: string): RawRecord[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    throw new Error(`Invalid ${name}: ${(error as Error).message}`);
  }
  if (!Array.isArray(parsed) || !parsed.every(isRecord)) {
    throw new Error(`Invalid ${name}: expected a JSON array of objects.`);
  }
  return parsed;
}

function requiredString(row: RawRecord, key: string, name: string): string {
  const value = row[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Invalid ${name}: row is missing string field '${key}'.`);
  }
  return value;
}

function requiredNumber(row: RawRecord, key: string, name: string): number {
  const value = row[key];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`Invalid ${name}: row is missing numeric field '${key}'.`);
  }
  return value;
}

function required(value: string | undefined, name: string): string {
  if (value === undefined) throw new Error(`Missing required option --${name}.`);
  return value;
}

function isRecord(value: unknown): value is RawRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
