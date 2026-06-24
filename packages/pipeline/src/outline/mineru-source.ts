import { spawn } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

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
      manifest_path: string;
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
  const manifestPath = join(outputDir, "mineru-result.json");

  if (existsSync(finalMarkdown) && !options.force) {
    return {
      status: "success",
      created: false,
      source_markdown_path: finalMarkdown,
      manifest_path: manifestPath,
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
      manifest_path: manifestPath,
    };
    writeFileSync(manifestPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return payload;
  } catch (error) {
    return { status: "blocked", error: (error as Error).message };
  }
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
    extractZip: deps.extractZip ?? defaultExtractZip,
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

async function defaultExtractZip(zipPath: string, targetDir: string): Promise<void> {
  mkdirSync(targetDir, { recursive: true });
  const members = (await runProcess("unzip", ["-Z1", zipPath])).split(/\r?\n/).filter(Boolean);
  for (const member of members) {
    assertSafeZipMember(member, targetDir);
  }
  await runProcess("unzip", ["-q", zipPath, "-d", targetDir]);
}

function assertSafeZipMember(member: string, targetDir: string): void {
  if (isAbsolute(member)) throw new Error(`Refusing unsafe zip member path: ${member}`);
  const destination = resolve(targetDir, member);
  const relativePath = relative(resolve(targetDir), destination);
  if (relativePath === "" || relativePath.startsWith("..") || isAbsolute(relativePath)) throw new Error(`Refusing unsafe zip member path: ${member}`);
}

function runProcess(command: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise(stdout);
      else reject(new Error(stderr.trim() || `${command} exited with code ${code ?? "unknown"}.`));
    });
  });
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

function resolveRequiredPath(path: string): string {
  if (!path.trim()) throw new Error("Missing required path.");
  return resolve(path);
}

function isRecord(value: unknown): value is RawRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
