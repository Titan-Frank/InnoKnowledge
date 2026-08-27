import {
  cpSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import yauzl from "yauzl";

type RawRecord = Record<string, unknown>;

export const MINERU_DONE_STATES = new Set(["done"]);
export const MINERU_FAILED_STATES = new Set(["failed"]);
export const MINERU_PENDING_STATES = new Set(["waiting-file", "pending", "running", "converting"]);

export type MineruSourceOptions = {
  bookId: string;
  outputDir: string;
  apiKey: string;
  pdfPath?: string;
  fileUrl?: string;
  baseUrl?: string;
  modelVersion?: string;
  language?: string;
  dataId?: string;
  isOcr?: boolean;
  enableFormula?: boolean;
  enableTable?: boolean;
  pageRanges?: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
  force?: boolean;
};

export type MineruSourceResult =
  | {
      status: "success";
      created: boolean;
      source_markdown_path: string;
      book_id?: string;
      batch_id?: string;
      zip_url?: string;
      zip_path?: string;
      extract_dir?: string;
      raw_markdown_path?: string;
    }
  | {
      status: "blocked";
      error: string;
    };

export type OcrBundleInspection = {
  folder_path: string;
  markdown_path: string | null;
  content_list_path: string | null;
  content_list_v2_path: string | null;
  images_path: string | null;
  page_count: number | null;
  block_count: number | null;
  image_count: number;
  preferred_input: "markdown_with_v2" | "markdown" | "content_list_v2";
  quality: "complete" | "structured" | "markdown_only";
  warnings: string[];
};

export type ImportedOcrSourceResult = Extract<MineruSourceResult, { status: "success" }> & {
  source_kind: "ocr_import";
  inspection: OcrBundleInspection;
};

export type MineruSourceDependencies = {
  requestJson?: (method: "GET" | "POST", url: string, payload?: RawRecord) => Promise<RawRecord>;
  putFile?: (uploadUrl: string, path: string) => Promise<void>;
  downloadFile?: (url: string, outPath: string) => Promise<void>;
  extractZip?: (zipPath: string, targetDir: string) => Promise<void>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
};

export function bearerToken(raw: string): string {
  const token = raw.trim();
  if (!token) return "";
  return token.toLowerCase().startsWith("bearer ") ? token : `Bearer ${token}`;
}

export function buildMineruTaskPayload(
  options: Pick<MineruSourceOptions, "bookId" | "modelVersion" | "language" | "dataId" | "isOcr" | "enableFormula" | "enableTable" | "pageRanges">,
  filePayload: RawRecord,
): RawRecord {
  const payload: RawRecord = {
    enable_formula: options.enableFormula ?? true,
    enable_table: options.enableTable ?? true,
    language: options.language ?? "ch",
    model_version: options.modelVersion ?? "vlm",
    files: [{ ...filePayload, is_ocr: options.isOcr ?? true, data_id: options.dataId || options.bookId }],
  };
  if (options.pageRanges) payload.page_ranges = options.pageRanges;
  return payload;
}

export function extractMineruResults(body: RawRecord): RawRecord[] {
  const data = isRecord(body.data) ? body.data : {};
  const results = data.extract_result;
  if (Array.isArray(results)) return results.filter(isRecord);
  return isRecord(results) ? [results] : [];
}

export function selectMineruResult(results: RawRecord[], input: { dataId: string; fileName: string }): RawRecord {
  const byDataId = results.find((result) => input.dataId && String(result.data_id ?? "") === input.dataId);
  if (byDataId) return byDataId;
  const byFileName = results.find((result) => input.fileName && String(result.file_name ?? "") === input.fileName);
  return byFileName ?? results[0] ?? {};
}

export function parseMineruBatchId(body: RawRecord, context: string): string {
  if (body.code !== 0) throw new Error(`${context} failed: ${String(body.msg ?? JSON.stringify(body))}`);
  const data = isRecord(body.data) ? body.data : {};
  const batchId = String(data.batch_id ?? "").trim();
  if (!batchId) throw new Error(`${context} returned no batch_id: ${JSON.stringify(body)}`);
  return batchId;
}

export function parseMineruUploadUrl(body: RawRecord): string {
  const data = isRecord(body.data) ? body.data : {};
  const fileUrls = data.file_urls;
  if (!Array.isArray(fileUrls) || fileUrls.length === 0) throw new Error(`MinerU returned an invalid upload-url response: ${JSON.stringify(body)}`);
  const first = fileUrls[0];
  if (typeof first === "string") return first;
  if (isRecord(first)) {
    const uploadUrl = String(first.upload_url ?? first.url ?? first.file_url ?? "").trim();
    if (uploadUrl) return uploadUrl;
  }
  throw new Error(`MinerU upload URL was missing: ${JSON.stringify(first)}`);
}

export async function runMineruSourceMarkdown(options: MineruSourceOptions, dependencies: MineruSourceDependencies = {}): Promise<MineruSourceResult> {
  const outputDir = resolve(options.outputDir);
  mkdirSync(outputDir, { recursive: true });
  const finalMarkdown = join(outputDir, "full.md");

  if (existsSync(finalMarkdown) && !options.force) {
    return {
      status: "success",
      created: false,
      source_markdown_path: finalMarkdown,
    };
  }

  if (!options.pdfPath && !options.fileUrl) return { status: "blocked", error: "Missing --pdf-path or --file-url for MinerU source Markdown." };
  if (!options.apiKey.trim()) return { status: "blocked", error: "Missing MinerU API key." };

  try {
    const deps = withDefaultDependencies(options.apiKey, dependencies);
    const baseUrl = (options.baseUrl ?? "https://mineru.net").replace(/\/+$/, "");
    const dataId = options.dataId || options.bookId;
    const fileName = options.pdfPath ? basename(options.pdfPath) : basename(String(options.fileUrl).split("?", 1)[0] || `${options.bookId}.pdf`);
    const batchId = options.pdfPath
      ? await submitLocalFile(options, deps, baseUrl)
      : await submitFileUrl(options, deps, baseUrl);
    const zipUrl = await pollForZipUrl(options, deps, baseUrl, batchId, { dataId, fileName });
    const zipPath = join(outputDir, "mineru-result.zip");
    const extractDir = join(outputDir, "extract");
    await deps.downloadFile(zipUrl, zipPath);
    await deps.extractZip(zipPath, extractDir);
    const rawMarkdown = findFullMarkdown(extractDir);
    const sourceMarkdown = copyMarkdownForPipeline(rawMarkdown, outputDir);
    const payload: Extract<MineruSourceResult, { status: "success" }> = {
      status: "success",
      created: true,
      book_id: options.bookId,
      batch_id: batchId,
      zip_url: zipUrl,
      zip_path: zipPath,
      extract_dir: extractDir,
      raw_markdown_path: rawMarkdown,
      source_markdown_path: sourceMarkdown,
    };
    return payload;
  } catch (error) {
    return { status: "blocked", error: (error as Error).message };
  }
}

export function inspectOcrBundle(folderPath: string): OcrBundleInspection {
  const requestedPath = resolveRequiredPath(folderPath);
  if (!existsSync(requestedPath) || !statSync(requestedPath).isDirectory()) {
    throw new Error(`OCR folder not found: ${requestedPath}`);
  }

  const bundleDir = findOcrBundleDirectory(requestedPath);
  if (!bundleDir) {
    throw new Error("No MinerU OCR bundle found. Expected a Markdown file or *_content_list_v2.json within the selected folder.");
  }
  const entries = readdirSync(bundleDir);
  const markdownPath = chooseLargestFile(bundleDir, entries.filter((name) => name.toLowerCase().endsWith(".md")), "full.md");
  const contentListV2Path = chooseLargestFile(bundleDir, entries.filter((name) => /_content_list_v2\.json$/i.test(name)));
  const contentListPath = chooseLargestFile(bundleDir, entries.filter((name) => /_content_list\.json$/i.test(name) && !/_v2\.json$/i.test(name)));
  const imagesPath = existsSync(join(bundleDir, "images")) && statSync(join(bundleDir, "images")).isDirectory()
    ? join(bundleDir, "images")
    : null;
  const warnings: string[] = [];
  let pageCount: number | null = null;
  let blockCount: number | null = null;

  if (contentListV2Path) {
    try {
      const parsed = JSON.parse(readFileSync(contentListV2Path, "utf8")) as unknown;
      if (!Array.isArray(parsed) || !parsed.every(Array.isArray)) throw new Error("top-level value is not an array of pages");
      pageCount = parsed.length;
      blockCount = parsed.reduce((sum, page) => sum + page.length, 0);
    } catch (error) {
      throw new Error(`Invalid MinerU content_list_v2 JSON: ${(error as Error).message}`);
    }
  } else if (contentListPath) {
    try {
      const parsed = JSON.parse(readFileSync(contentListPath, "utf8")) as unknown;
      if (!Array.isArray(parsed)) throw new Error("top-level value is not an array");
      blockCount = parsed.length;
      const pageIndexes = parsed
        .map((item) => isRecord(item) ? Number(item.page_idx) : Number.NaN)
        .filter(Number.isFinite);
      pageCount = pageIndexes.length > 0 ? Math.max(...pageIndexes) + 1 : null;
    } catch (error) {
      throw new Error(`Invalid MinerU content_list JSON: ${(error as Error).message}`);
    }
  }

  if (!markdownPath) warnings.push("未找到 Markdown；将从 content_list_v2.json 生成兼容 Markdown。");
  if (!contentListV2Path) warnings.push("未找到 content_list_v2.json；页结构、块类型和 bbox 无法完整校验。");
  if (!imagesPath) warnings.push("未找到 images 目录；图片证据与 VLM 复核不可用。");

  const preferredInput = markdownPath && contentListV2Path
    ? "markdown_with_v2"
    : markdownPath
      ? "markdown"
      : "content_list_v2";
  return {
    folder_path: bundleDir,
    markdown_path: markdownPath,
    content_list_path: contentListPath,
    content_list_v2_path: contentListV2Path,
    images_path: imagesPath,
    page_count: pageCount,
    block_count: blockCount,
    image_count: imagesPath ? walkFiles(imagesPath).length : 0,
    preferred_input: preferredInput,
    quality: markdownPath && contentListV2Path && imagesPath
      ? "complete"
      : contentListV2Path
        ? "structured"
        : "markdown_only",
    warnings,
  };
}

export function importOcrBundle(input: { bookId: string; folderPath: string; outputDir: string }): ImportedOcrSourceResult {
  const inspection = inspectOcrBundle(input.folderPath);
  const outputDir = resolve(input.outputDir);
  const sourceNames = readdirSync(inspection.folder_path);
  mkdirSync(dirname(outputDir), { recursive: true });
  const stagingDir = mkdtempSync(join(dirname(outputDir), `.${basename(outputDir)}-ocr-import-`));
  const backupDir = `${stagingDir}.previous`;
  let installed = false;
  try {
    for (const name of sourceNames) {
      const sourcePath = join(inspection.folder_path, name);
      const targetPath = join(stagingDir, name);
      if (resolve(sourcePath) === outputDir) continue;
      if (statSync(sourcePath).isDirectory()) {
        cpSync(sourcePath, targetPath, { recursive: true, force: true });
      } else if (name.toLowerCase().endsWith(".json")) {
        cpSync(sourcePath, targetPath, { force: true });
      }
    }

    const stagedMarkdown = join(stagingDir, "full.md");
    if (inspection.markdown_path) {
      cpSync(inspection.markdown_path, stagedMarkdown, { force: true });
      const stagedRawMarkdown = join(stagingDir, basename(inspection.markdown_path));
      if (resolve(stagedRawMarkdown) !== resolve(stagedMarkdown)) {
        cpSync(inspection.markdown_path, stagedRawMarkdown, { force: true });
      }
    } else if (inspection.content_list_v2_path) {
      writeFileSync(stagedMarkdown, renderContentListV2Markdown(inspection.content_list_v2_path), "utf8");
    }

    if (existsSync(outputDir)) renameSync(outputDir, backupDir);
    try {
      renameSync(stagingDir, outputDir);
      installed = true;
    } catch (error) {
      if (existsSync(backupDir) && !existsSync(outputDir)) renameSync(backupDir, outputDir);
      throw error;
    }
    rmSync(backupDir, { recursive: true, force: true });
  } finally {
    if (!installed) rmSync(stagingDir, { recursive: true, force: true });
  }

  const finalMarkdown = join(outputDir, "full.md");
  return {
    status: "success",
    created: false,
    source_kind: "ocr_import",
    book_id: input.bookId,
    source_markdown_path: finalMarkdown,
    raw_markdown_path: inspection.markdown_path ?? undefined,
    extract_dir: inspection.folder_path,
    inspection,
  };
}

export function findFullMarkdown(targetDir: string): string {
  const allMarkdown = walkFiles(targetDir).filter((path) => path.endsWith(".md")).sort();
  const fullMarkdown = allMarkdown.find((path) => basename(path) === "full.md");
  const chosen = fullMarkdown ?? allMarkdown[0];
  if (!chosen) throw new Error(`No Markdown file found in MinerU zip output: ${targetDir}`);
  return chosen;
}

export function copyMarkdownForPipeline(markdownPath: string, outputDir: string): string {
  mkdirSync(outputDir, { recursive: true });
  const target = join(outputDir, "full.md");
  if (resolve(markdownPath) !== resolve(target)) cpSync(markdownPath, target);
  const sourceDir = dirname(markdownPath);
  for (const child of readdirSync(sourceDir)) {
    const sourceChild = join(sourceDir, child);
    if (!statSync(sourceChild).isDirectory()) continue;
    const targetChild = join(outputDir, child);
    if (existsSync(targetChild)) continue;
    cpSync(sourceChild, targetChild, { recursive: true });
  }
  return target;
}

async function submitLocalFile(options: MineruSourceOptions, deps: Required<MineruSourceDependencies>, baseUrl: string): Promise<string> {
  const pdfPath = resolveRequiredPath(options.pdfPath ?? "");
  if (!existsSync(pdfPath)) throw new Error(`PDF not found: ${pdfPath}`);
  const payload = buildMineruTaskPayload(options, { name: basename(pdfPath) });
  const body = await deps.requestJson("POST", `${baseUrl}/api/v4/file-urls/batch`, payload);
  const batchId = parseMineruBatchId(body, "MinerU upload-url request");
  await deps.putFile(parseMineruUploadUrl(body), pdfPath);
  return batchId;
}

async function submitFileUrl(options: MineruSourceOptions, deps: Required<MineruSourceDependencies>, baseUrl: string): Promise<string> {
  const payload = buildMineruTaskPayload(options, { url: options.fileUrl ?? "" });
  const body = await deps.requestJson("POST", `${baseUrl}/api/v4/extract/task/batch`, payload);
  return parseMineruBatchId(body, "MinerU task submission");
}

async function pollForZipUrl(
  options: MineruSourceOptions,
  deps: Required<MineruSourceDependencies>,
  baseUrl: string,
  batchId: string,
  selector: { dataId: string; fileName: string },
): Promise<string> {
  const deadline = deps.now() + (options.timeoutMs ?? 1_800_000);
  let lastState = "";
  while (deps.now() < deadline) {
    const body = await deps.requestJson("GET", `${baseUrl}/api/v4/extract-results/batch/${batchId}`);
    if (body.code !== 0) throw new Error(`MinerU result polling failed: ${String(body.msg ?? JSON.stringify(body))}`);
    const result = selectMineruResult(extractMineruResults(body), selector);
    const state = String(result.state ?? "").trim();
    lastState = state || lastState;
    if (MINERU_DONE_STATES.has(state)) {
      const zipUrl = String(result.full_zip_url ?? "").trim();
      if (!zipUrl) throw new Error(`MinerU task finished but full_zip_url was missing: ${JSON.stringify(result)}`);
      return zipUrl;
    }
    if (MINERU_FAILED_STATES.has(state)) throw new Error(String(result.err_msg ?? "MinerU task failed."));
    if (state && !MINERU_PENDING_STATES.has(state)) throw new Error(`MinerU returned unknown task state '${state}': ${JSON.stringify(result)}`);
    await deps.sleep(Math.max(1_000, options.pollIntervalMs ?? 10_000));
  }
  throw new Error(`MinerU task timed out after ${Math.trunc((options.timeoutMs ?? 1_800_000) / 1000)}s; last state: ${lastState || "unknown"}`);
}

function withDefaultDependencies(apiKey: string, deps: MineruSourceDependencies): Required<MineruSourceDependencies> {
  return {
    requestJson: deps.requestJson ?? ((method, url, payload) => defaultRequestJson(method, url, apiKey, payload)),
    putFile: deps.putFile ?? defaultPutFile,
    downloadFile: deps.downloadFile ?? defaultDownloadFile,
    extractZip: deps.extractZip ?? extractZipArchive,
    sleep: deps.sleep ?? ((ms) => new Promise((resolvePromise) => setTimeout(resolvePromise, ms))),
    now: deps.now ?? (() => Date.now()),
  };
}

async function defaultRequestJson(method: "GET" | "POST", url: string, apiKey: string, payload?: RawRecord): Promise<RawRecord> {
  const response = await fetch(url, {
    method,
    headers: {
      Authorization: bearerToken(apiKey),
      Accept: "*/*",
      ...(payload ? { "Content-Type": "application/json" } : {}),
    },
    body: payload ? JSON.stringify(payload) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`MinerU HTTP ${response.status} for ${url}: ${text}`);
  const parsed = JSON.parse(text) as unknown;
  if (!isRecord(parsed)) throw new Error(`MinerU returned non-object JSON for ${url}.`);
  return parsed;
}

async function defaultPutFile(uploadUrl: string, path: string): Promise<void> {
  const response = await fetch(uploadUrl, { method: "PUT", body: readFileSync(path) });
  if (!response.ok) throw new Error(`MinerU upload failed with HTTP ${response.status}: ${await response.text()}`);
}

async function defaultDownloadFile(url: string, outPath: string): Promise<void> {
  const response = await fetch(url, { method: "GET", headers: { Accept: "*/*" } });
  if (!response.ok) throw new Error(`MinerU download failed with HTTP ${response.status}: ${await response.text()}`);
  writeFileSync(outPath, Buffer.from(await response.arrayBuffer()));
}

export async function extractZipArchive(zipPath: string, targetDir: string): Promise<void> {
  const zipFile = await yauzl.openPromise(zipPath, {
    autoClose: false,
    lazyEntries: true,
    strictFileNames: true,
    validateEntrySizes: true,
  });
  rmSync(targetDir, { recursive: true, force: true });
  mkdirSync(targetDir, { recursive: true });
  try {
    for await (const entry of zipFile.eachEntry()) {
      const destination = assertSafeZipMember(entry.fileName, targetDir);
      if (entry.fileName.endsWith("/")) {
        mkdirSync(destination, { recursive: true });
        continue;
      }
      mkdirSync(dirname(destination), { recursive: true });
      const source = await zipFile.openReadStreamPromise(entry);
      await pipeline(source, createWriteStream(destination));
    }
  } finally {
    zipFile.close();
  }
}

export function assertSafeZipMember(member: string, targetDir: string): string {
  const normalizedMember = member.replace(/\\/g, "/");
  if (
    !normalizedMember
    || normalizedMember.includes("\0")
    || isAbsolute(normalizedMember)
    || /^[a-zA-Z]:/.test(normalizedMember)
  ) {
    throw new Error(`Refusing unsafe zip member path: ${member}`);
  }
  const destination = resolve(targetDir, normalizedMember);
  const relativePath = relative(resolve(targetDir), destination);
  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) throw new Error(`Refusing unsafe zip member path: ${member}`);
  return destination;
}

function walkFiles(root: string): string[] {
  if (!existsSync(root)) return [];
  const result: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) result.push(...walkFiles(path));
    else if (stats.isFile()) result.push(path);
  }
  return result;
}

function findOcrBundleDirectory(root: string): string | null {
  const candidates: Array<{ path: string; score: number }> = [];
  const visit = (path: string, depth: number) => {
    const entries = readdirSync(path, { withFileTypes: true });
    const names = entries.map((entry) => entry.name);
    const hasMarkdown = names.some((name) => name.toLowerCase().endsWith(".md"));
    const hasV2 = names.some((name) => /_content_list_v2\.json$/i.test(name));
    const hasContentList = names.some((name) => /_content_list\.json$/i.test(name));
    const hasImages = entries.some((entry) => entry.isDirectory() && entry.name === "images");
    const score = (hasV2 ? 100 : 0) + (hasMarkdown ? 80 : 0) + (hasContentList ? 20 : 0) + (hasImages ? 10 : 0);
    if (hasMarkdown || hasV2) candidates.push({ path, score });
    if (depth >= 4) return;
    for (const entry of entries) {
      if (entry.isDirectory() && entry.name !== "images" && !entry.name.startsWith(".")) {
        visit(join(path, entry.name), depth + 1);
      }
    }
  };
  visit(root, 0);
  candidates.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
  return candidates[0]?.path ?? null;
}

function chooseLargestFile(directory: string, names: string[], preferredName?: string): string | null {
  const preferred = preferredName ? names.find((name) => name.toLowerCase() === preferredName.toLowerCase()) : undefined;
  if (preferred) return join(directory, preferred);
  const sorted = names
    .map((name) => ({ name, size: statSync(join(directory, name)).size }))
    .sort((left, right) => right.size - left.size || left.name.localeCompare(right.name));
  return sorted[0] ? join(directory, sorted[0].name) : null;
}

function renderContentListV2Markdown(path: string): string {
  const pages = JSON.parse(readFileSync(path, "utf8")) as unknown[][];
  const lines: string[] = [];
  pages.forEach((page, pageIndex) => {
    lines.push(`<!-- page:${pageIndex + 1} -->`);
    for (const value of page) {
      if (!isRecord(value)) continue;
      const type = String(value.type ?? "");
      const content = isRecord(value.content) ? value.content : {};
      if (type === "title") {
        const level = Math.max(1, Math.min(6, Number(content.level) || 2));
        lines.push(`${"#".repeat(level)} ${inlineContent(content.title_content)}`);
      } else if (type === "equation_interline") {
        lines.push("$$", String(content.math_content ?? "").trim(), "$$");
      } else if (type === "image" || type === "chart") {
        const imageSource = isRecord(content.image_source) ? String(content.image_source.path ?? "") : "";
        const caption = inlineContent(content.image_caption) || String(content.content ?? "").trim() || type;
        if (imageSource) lines.push(`![${caption.replace(/[\[\]]/g, "")}](${imageSource})`);
      } else if (type === "list" && Array.isArray(content.list_items)) {
        for (const item of content.list_items) {
          if (isRecord(item)) lines.push(`- ${inlineContent(item.item_content)}`);
        }
      } else if (type === "table") {
        const tableParts = [
          inlineContent(content.table_caption),
          typeof content.html === "string" ? content.html.trim() : "",
          inlineContent(content.table_footnote),
        ].filter(Boolean);
        if (tableParts.length > 0) lines.push(tableParts.join("\n\n"));
      } else if (!type.startsWith("page_")) {
        const text = inlineContent(
          content.paragraph_content
          ?? content.page_footnote_content
          ?? content,
        );
        if (text) lines.push(text);
      }
    }
    lines.push("");
  });
  return `${lines.join("\n").trim()}\n`;
}

function inlineContent(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (Array.isArray(value)) return value.map(inlineContent).filter(Boolean).join("");
  if (!isRecord(value)) return "";
  if (value.type === "equation_inline") return `$${String(value.content ?? "").trim()}$`;
  if (typeof value.content === "string") return value.content.trim();
  return Object.values(value).map(inlineContent).filter(Boolean).join("");
}

function resolveRequiredPath(path: string): string {
  if (!path.trim()) throw new Error("Missing required path.");
  return resolve(path);
}

function isRecord(value: unknown): value is RawRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
