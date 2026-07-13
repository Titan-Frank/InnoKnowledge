#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";

import postgres from "postgres";

import {
  createPostgresPipelineAssetStore,
  type MineruSourceRecord,
} from "../shared/pg-assets.js";
import { REPO_ROOT } from "../shared/pathing.js";

type RawRecord = Record<string, unknown>;

type ImportSummary = {
  dataset_id: string;
  outlines: number;
  enrich_books: number;
  mineru_sources: number;
};

type ImportAssetDirs = {
  outlineDir?: string;
  enrichDir?: string;
  mineruDir?: string;
};

async function main(argv: string[]): Promise<number> {
  try {
    const flags = parseFlags(argv);
    const dbUrl = required(flags, "db");
    const datasetId = flags.get("dataset-id") ?? "main";
    const repoRoot = resolve(flags.get("repo-root") ?? REPO_ROOT);
    const summary = await importFileAssets({ dbUrl, datasetId, repoRoot });
    process.stdout.write(`${JSON.stringify(summary)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 1;
  }
}

export async function importFileAssets(input: {
  dbUrl: string;
  datasetId: string;
  repoRoot?: string;
}): Promise<ImportSummary> {
  const repoRoot = resolve(input.repoRoot ?? REPO_ROOT);
  const assetDirs = resolveImportAssetDirs(repoRoot);
  const sql = postgres(input.dbUrl, { max: 2 });
  const assetStore = createPostgresPipelineAssetStore(input.dbUrl);
  try {
    await ensureDataset(sql, input.datasetId, repoRoot);
    const outlines = await importOutlines({ datasetId: input.datasetId, repoRoot, outlineDir: assetDirs.outlineDir, assetStore });
    const enrichBooks = await importEnrich({ sql, datasetId: input.datasetId, repoRoot, enrichDir: assetDirs.enrichDir });
    const mineruSources = await importMineru({ datasetId: input.datasetId, repoRoot, mineruDir: assetDirs.mineruDir, assetStore });
    return {
      dataset_id: input.datasetId,
      outlines,
      enrich_books: enrichBooks,
      mineru_sources: mineruSources,
    };
  } finally {
    await assetStore.close();
    await sql.end({ timeout: 1 });
  }
}

export function resolveImportAssetDirs(repoRoot: string): ImportAssetDirs {
  const root = resolve(repoRoot);
  return {
    outlineDir: firstDirWith(root, [["data", "outlines"], ["examples", "sample-data", "outlines"]], hasOutlineFiles),
    enrichDir: firstDirWith(root, [["data", "enrich"], ["examples", "sample-data", "enrich"]], hasEnrichIndex),
    mineruDir: firstDirWith(root, [["data", "mineru"], ["examples", "sample-data", "mineru"]], hasMineruSources),
  };
}

async function ensureDataset(sql: postgres.Sql, datasetId: string, repoRoot: string): Promise<void> {
  const now = nowIso();
  await sql`
    INSERT INTO world_datasets (
      dataset_id, dataset_name, schema_version, status, is_active, root_path, created_at, updated_at, notes
    )
    VALUES (
      ${datasetId}, ${datasetId}, 'world-v1.3', 'active', 0, ${relativeRepoPath(repoRoot, resolve(repoRoot, "data", datasetId))}, ${now}, ${now}, NULL
    )
    ON CONFLICT (dataset_id) DO UPDATE SET
      root_path = COALESCE(world_datasets.root_path, EXCLUDED.root_path),
      updated_at = EXCLUDED.updated_at
  `;
}

async function importOutlines(input: {
  datasetId: string;
  repoRoot: string;
  outlineDir?: string;
  assetStore: ReturnType<typeof createPostgresPipelineAssetStore>;
}): Promise<number> {
  const outlineDir = input.outlineDir;
  if (!outlineDir || !existsSync(outlineDir)) return 0;
  let count = 0;
  for (const filename of readdirSync(outlineDir).sort()) {
    if (!filename.endsWith(".outline.json")) continue;
    const outlinePath = join(outlineDir, filename);
    if (!statSync(outlinePath).isFile()) continue;
    const outline = readJsonRecord(outlinePath);
    const bookId = filename.slice(0, -".outline.json".length);
    await input.assetStore.upsertOutline({
      datasetId: input.datasetId,
      record: {
        bookId,
        title: stringValue(outline.title) || stringValue(outline.book_title) || bookId,
        sourcePath: stringValue(outline.source_path),
        outlinePath: relativeRepoPath(input.repoRoot, outlinePath),
        outline,
      },
    });
    count += 1;
  }
  return count;
}

async function importEnrich(input: {
  sql: postgres.Sql;
  datasetId: string;
  repoRoot: string;
  enrichDir?: string;
}): Promise<number> {
  const enrichDir = input.enrichDir;
  if (!enrichDir) return 0;
  const indexPath = join(enrichDir, "enrich_books_index.json");
  if (!existsSync(indexPath)) return 0;
  const index = readJsonRecord(indexPath);
  const books = Array.isArray(index.books) ? index.books.filter(isRecord) : [];
  const now = nowIso();
  const subjectCount = Number(index.subject_count ?? new Set(books.map((book) => stringValue(book.subject)).filter(Boolean)).size);
  const nodeCount = Number(index.node_count ?? books.reduce((sum, book) => sum + Number(book.node_count || 0), 0));
  let inserted = 0;

  await input.sql.begin(async (transaction) => {
    await transaction`
      INSERT INTO world_enrich_library (
        dataset_id, generated_at, book_count, subject_count, node_count, properties_json, updated_at
      )
      VALUES (
        ${input.datasetId},
        ${stringValue(index.generated_at) || null},
        ${books.length},
        ${Number.isFinite(subjectCount) ? subjectCount : 0},
        ${Number.isFinite(nodeCount) ? nodeCount : 0},
        ${transaction.json(toJson(stripField(index, "books")))},
        ${now}
      )
      ON CONFLICT (dataset_id) DO UPDATE SET
        generated_at = EXCLUDED.generated_at,
        book_count = EXCLUDED.book_count,
        subject_count = EXCLUDED.subject_count,
        node_count = EXCLUDED.node_count,
        properties_json = EXCLUDED.properties_json,
        updated_at = EXCLUDED.updated_at
    `;
    await transaction`DELETE FROM world_enrich_books WHERE dataset_id = ${input.datasetId}`;

    for (const book of books) {
      const bookPath = stringValue(book.path);
      if (!bookPath) continue;
      const resolved = resolve(input.repoRoot, bookPath.replace(/^data\//, "data/"));
      if (!resolved.startsWith(`${enrichDir}/`) || !existsSync(resolved)) continue;
      const tree = readJson(resolved);
      await transaction`
        INSERT INTO world_enrich_books (
          dataset_id, path, filename, title, subject, stage, grade, course,
          publisher, volume, root_count, node_count, max_depth,
          metadata_json, tree_json, created_at, updated_at
        )
        VALUES (
          ${input.datasetId},
          ${bookPath},
          ${stringValue(book.filename) || basename(bookPath)},
          ${bookTitle(book)},
          ${nullableString(book.subject)},
          ${nullableString(book.stage)},
          ${nullableString(book.grade)},
          ${nullableString(book.course)},
          ${nullableString(book.publisher)},
          ${nullableString(book.volume)},
          ${integerValue(book.root_count)},
          ${integerValue(book.node_count)},
          ${integerValue(book.max_depth)},
          ${transaction.json(toJson(book))},
          ${transaction.json(toJson(Array.isArray(tree) ? tree : []))},
          ${now},
          ${now}
        )
      `;
      inserted += 1;
    }
  });
  return inserted;
}

async function importMineru(input: {
  datasetId: string;
  repoRoot: string;
  mineruDir?: string;
  assetStore: ReturnType<typeof createPostgresPipelineAssetStore>;
}): Promise<number> {
  const mineruDir = input.mineruDir;
  if (!mineruDir || !existsSync(mineruDir)) return 0;
  let count = 0;
  for (const dirname of readdirSync(mineruDir).sort()) {
    const bookDir = join(mineruDir, dirname);
    if (!statSync(bookDir).isDirectory()) continue;
    const manifestPath = join(bookDir, "mineru-result.json");
    const markdownPath = join(bookDir, "full.md");
    if (!existsSync(manifestPath) && !existsSync(markdownPath)) continue;
    const manifest = existsSync(manifestPath) ? readJsonRecord(manifestPath) : {};
    const record = mineruRecordFromManifest({
      bookId: dirname,
      manifest,
      fallbackMarkdownPath: existsSync(markdownPath) ? relativeRepoPath(input.repoRoot, markdownPath) : "",
    });
    await input.assetStore.upsertMineruSource({ datasetId: input.datasetId, record });
    count += 1;
  }
  return count;
}

function firstDirWith(root: string, candidates: string[][], predicate: (dir: string) => boolean): string | undefined {
  for (const parts of candidates) {
    const dir = resolve(root, ...parts);
    if (existsSync(dir) && predicate(dir)) return dir;
  }
  return undefined;
}

function hasOutlineFiles(dir: string): boolean {
  return readdirSync(dir).some((filename) => filename.endsWith(".outline.json") && statSync(join(dir, filename)).isFile());
}

function hasEnrichIndex(dir: string): boolean {
  return existsSync(join(dir, "enrich_books_index.json"));
}

function hasMineruSources(dir: string): boolean {
  return readdirSync(dir).some((dirname) => {
    const bookDir = join(dir, dirname);
    if (!statSync(bookDir).isDirectory()) return false;
    return existsSync(join(bookDir, "mineru-result.json")) || existsSync(join(bookDir, "full.md"));
  });
}

function mineruRecordFromManifest(input: {
  bookId: string;
  manifest: RawRecord;
  fallbackMarkdownPath: string;
}): MineruSourceRecord {
  const status = stringValue(input.manifest.status);
  return {
    bookId: stringValue(input.manifest.book_id) || input.bookId,
    status: status === "success" || status === "blocked" ? status : input.fallbackMarkdownPath ? "success" : "unknown",
    sourceMarkdownPath: stringValue(input.manifest.source_markdown_path) || input.fallbackMarkdownPath,
    batchId: stringValue(input.manifest.batch_id),
    zipUrl: stringValue(input.manifest.zip_url),
    zipPath: stringValue(input.manifest.zip_path),
    extractDir: stringValue(input.manifest.extract_dir),
    rawMarkdownPath: stringValue(input.manifest.raw_markdown_path),
    createdByMineru: Boolean(input.manifest.created),
  };
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
  if (!value) throw new Error(`Missing required option --${name}.`);
  return value;
}

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readJsonRecord(path: string): RawRecord {
  const value = readJson(path);
  if (!isRecord(value)) throw new Error(`Expected JSON object: ${path}`);
  return value;
}

function isRecord(value: unknown): value is RawRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stripField(record: RawRecord, field: string): RawRecord {
  const next = { ...record };
  delete next[field];
  return next;
}

function bookTitle(book: RawRecord): string {
  return [book.stage, book.grade, book.course, book.publisher, book.volume]
    .map(stringValue)
    .filter(Boolean)
    .join(" · ") || stringValue(book.filename) || stringValue(book.path) || "未命名教材";
}

function relativeRepoPath(repoRoot: string, path: string): string {
  return relative(repoRoot, resolve(path)).split(/[\\/]+/).join("/");
}

function nullableString(value: unknown): string | null {
  return stringValue(value) || null;
}

function stringValue(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function integerValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function toJson(value: unknown): postgres.JSONValue {
  return value as postgres.JSONValue;
}

function nowIso(): string {
  return new Date().toISOString();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  raise(main(process.argv.slice(2)));
}

function raise(promise: Promise<number>): void {
  promise.then((code) => {
    process.exitCode = code;
  });
}
