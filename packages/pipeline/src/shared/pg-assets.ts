import postgres from "postgres";

import { type OutlineItem, iterOutlineItems } from "./pathing.js";

type RawRecord = Record<string, unknown>;

export type TextbookOutlineRecord = {
  bookId: string;
  title?: string;
  sourcePath?: string;
  outlinePath?: string;
  outline: RawRecord;
};

export type MineruSourceRecord = {
  bookId: string;
  status: "unknown" | "success" | "blocked";
  sourceMarkdownPath?: string;
  batchId?: string;
  zipUrl?: string;
  zipPath?: string;
  extractDir?: string;
  rawMarkdownPath?: string;
  createdByMineru?: boolean;
};

export type PipelineAssetStore = {
  loadOutline(input: { datasetId: string; bookId: string }): Promise<RawRecord | null>;
  upsertOutline(input: { datasetId: string; record: TextbookOutlineRecord }): Promise<void>;
  upsertMineruSource(input: { datasetId: string; record: MineruSourceRecord }): Promise<void>;
  close(): Promise<void>;
};

export function createNoopPipelineAssetStore(): PipelineAssetStore {
  return {
    async loadOutline() {
      return null;
    },
    async upsertOutline() {},
    async upsertMineruSource() {},
    async close() {},
  };
}

export function createPostgresPipelineAssetStore(databaseUrl: string): PipelineAssetStore {
  const sql = postgres(databaseUrl, { max: 2 });
  return {
    async loadOutline(input) {
      const rows = await sql<{ outline_json: unknown }[]>`
        SELECT outline_json
        FROM world_textbook_outlines
        WHERE dataset_id = ${input.datasetId}
          AND book_id = ${input.bookId}
        LIMIT 1
      `;
      const outline = rows[0]?.outline_json;
      return isRecord(outline) ? outline : null;
    },
    async upsertOutline(input) {
      const now = nowIso();
      const items = outlineItemsFromRecord(input.record.outline);
      await sql`
        INSERT INTO world_textbook_outlines (
          dataset_id, book_id, title, source_path, outline_path, outline_json,
          item_count, chunk_count, created_at, updated_at
        )
        VALUES (
          ${input.datasetId},
          ${input.record.bookId},
          ${input.record.title ?? titleFromOutline(input.record.outline, input.record.bookId)},
          ${input.record.sourcePath ?? sourcePathFromOutline(input.record.outline)},
          ${input.record.outlinePath ?? null},
          ${sql.json(toJson(input.record.outline))},
          ${items.length},
          ${items.filter((item) => item.kind === "chunk").length},
          ${now},
          ${now}
        )
        ON CONFLICT (dataset_id, book_id) DO UPDATE SET
          title = EXCLUDED.title,
          source_path = EXCLUDED.source_path,
          outline_path = EXCLUDED.outline_path,
          outline_json = EXCLUDED.outline_json,
          item_count = EXCLUDED.item_count,
          chunk_count = EXCLUDED.chunk_count,
          updated_at = EXCLUDED.updated_at
      `;
    },
    async upsertMineruSource(input) {
      const now = nowIso();
      await sql`
        INSERT INTO world_mineru_sources (
          dataset_id, book_id, status, source_markdown_path, batch_id,
          zip_url, zip_path, extract_dir, raw_markdown_path,
          created_by_mineru, created_at, updated_at
        )
        VALUES (
          ${input.datasetId},
          ${input.record.bookId},
          ${input.record.status},
          ${input.record.sourceMarkdownPath ?? null},
          ${input.record.batchId ?? null},
          ${input.record.zipUrl ?? null},
          ${input.record.zipPath ?? null},
          ${input.record.extractDir ?? null},
          ${input.record.rawMarkdownPath ?? null},
          ${input.record.createdByMineru ? 1 : 0},
          ${now},
          ${now}
        )
        ON CONFLICT (dataset_id, book_id) DO UPDATE SET
          status = EXCLUDED.status,
          source_markdown_path = EXCLUDED.source_markdown_path,
          batch_id = EXCLUDED.batch_id,
          zip_url = EXCLUDED.zip_url,
          zip_path = EXCLUDED.zip_path,
          extract_dir = EXCLUDED.extract_dir,
          raw_markdown_path = EXCLUDED.raw_markdown_path,
          created_by_mineru = EXCLUDED.created_by_mineru,
          updated_at = EXCLUDED.updated_at
      `;
    },
    async close() {
      await sql.end({ timeout: 1 });
    },
  };
}

export function outlineItemsFromRecord(outline: RawRecord | null | undefined): OutlineItem[] {
  if (!outline) return [];
  const rawItems = Array.isArray(outline.items)
    ? outline.items
    : Array.isArray(outline.structure)
      ? outline.structure
      : [];
  return iterOutlineItems(rawItems as OutlineItem[]);
}

function titleFromOutline(outline: RawRecord, fallback: string): string {
  return stringValue(outline.title) || stringValue(outline.book_title) || fallback;
}

function sourcePathFromOutline(outline: RawRecord): string | null {
  return stringValue(outline.source_path) || null;
}

function stringValue(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function isRecord(value: unknown): value is RawRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toJson(value: unknown): postgres.JSONValue {
  return value as postgres.JSONValue;
}

function nowIso(): string {
  return new Date().toISOString();
}
