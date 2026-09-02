import type { Hono } from 'hono';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, mkdirSync } from 'node:fs';
import { cp, mkdir, readFile, readdir, realpath, rm, stat } from 'node:fs/promises';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline as streamPipeline } from 'node:stream/promises';
import type {
  PipelineBookNodesResponse, PipelineFolderPdf, PipelineFolderScanRequest, PipelineFolderScanResponse,
  PipelineJobStage, PipelineOcrInspectRequest, PipelineOcrInspectResponse, PipelinePdfUploadResponse, PipelineStartRequest, PipelineStartResponse, PipelineStartStage, PipelineStopResponse,
  PipelineOutlineChunkContentResponse, PipelineOutlineConfirmRequest, PipelineOutlineConfirmResponse, PipelineOutlinePreviewItem, PipelineOutlinePreviewResponse,
  PipelineOutlineRejectRequest, PipelineOutlineRejectResponse,
  PipelineQualityReviewAction, PipelineQualityReviewUpdateRequest, PipelineQualityReviewUpdateResponse,
  TextbookMetadataRequest, TextbookMetadataResponse,
} from '@okm/types';
import type { Sql } from '../db/connection.js';
import { DATASET_ADVISORY_LOCK_SQL } from '../db/dataset-lock.js';
import {
  resolveDatasetRow,
  loadPipelinePayload,
  loadPipelineJobListPayload,
  loadPipelineJobStatusPayload,
  loadTextbookOutlinePayload,
  loadEnrichBookPayload,
  loadEnrichIndexPayload,
} from '../db/queries.js';
import { loadPipelineQualityPayload } from '../db/quality-dashboard.js';
import { REPO_ROOT } from '../utils/paths.js';

export const MAX_ACTIVE_PIPELINE_JOBS = 4;

interface CommandInvocation {
  command: string;
  args: string[];
}

type JsonValue = Parameters<Sql['json']>[0];

const MAX_PDF_UPLOAD_BYTES = 512 * 1024 * 1024;
const MAX_FOLDER_PDFS = 5000;
const MAX_OUTLINE_SOURCE_BYTES = 100 * 1024 * 1024;
const MAX_CHUNK_CONTENT_CHARACTERS = 120_000;

export async function inspectOcrFolder(folderPath: string): Promise<PipelineOcrInspectResponse> {
  const trimmed = folderPath.trim();
  if (!trimmed || !isAbsolute(trimmed)) throw new Error('OCR folder path must be an absolute path.');
  const root = await realpath(trimmed).catch(() => null);
  if (!root) throw new Error('OCR folder path does not exist or cannot be read.');
  if (!(await stat(root)).isDirectory()) throw new Error('OCR folder path must point to a directory.');

  const candidates: Array<{ path: string; names: string[]; score: number }> = [];
  const pending: Array<{ path: string; depth: number }> = [{ path: root, depth: 0 }];
  while (pending.length > 0) {
    const current = pending.shift()!;
    const entries = await readdir(current.path, { withFileTypes: true });
    const names = entries.map((entry) => entry.name);
    const hasMarkdown = names.some((name) => name.toLowerCase().endsWith('.md'));
    const hasV2 = names.some((name) => /_content_list_v2\.json$/i.test(name));
    const hasContentList = names.some((name) => /_content_list\.json$/i.test(name));
    const hasImages = entries.some((entry) => entry.isDirectory() && entry.name === 'images');
    const score = (hasV2 ? 100 : 0) + (hasMarkdown ? 80 : 0) + (hasContentList ? 20 : 0) + (hasImages ? 10 : 0);
    if (hasV2) candidates.push({ path: current.path, names, score });
    if (current.depth >= 4) continue;
    for (const entry of entries) {
      if (entry.isDirectory() && !entry.isSymbolicLink() && entry.name !== 'images' && !entry.name.startsWith('.')) {
        pending.push({ path: join(current.path, entry.name), depth: current.depth + 1 });
      }
    }
  }
  const selected = candidates.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path))[0];
  if (!selected) throw new Error('No MinerU OCR bundle found. Expected *_content_list_v2.json.');

  const chooseFile = async (pattern: RegExp, preferred?: string): Promise<string | null> => {
    const names = selected.names.filter((name) => pattern.test(name));
    const preferredName = preferred ? names.find((name) => name.toLowerCase() === preferred) : undefined;
    if (preferredName) return join(selected.path, preferredName);
    const sized = await Promise.all(names.map(async (name) => ({ name, size: (await stat(join(selected.path, name))).size })));
    sized.sort((left, right) => right.size - left.size || left.name.localeCompare(right.name));
    return sized[0] ? join(selected.path, sized[0].name) : null;
  };
  const markdownPath = await chooseFile(/\.md$/i, 'full.md');
  const contentListV2Path = await chooseFile(/_content_list_v2\.json$/i);
  const contentListPath = await chooseFile(/_content_list(?!_v2)\.json$/i);
  const imagesPath = selected.names.includes('images') ? join(selected.path, 'images') : null;
  if (!contentListV2Path) throw new Error('OCR bundle is missing required content_list_v2.json.');
  let pageCount: number | null = null;
  let blockCount: number | null = null;
  const contentListV2 = await readFile(contentListV2Path);
  const parsed = JSON.parse(contentListV2.toString('utf8')) as unknown;
  if (!Array.isArray(parsed) || !parsed.every(Array.isArray)) throw new Error('content_list_v2.json must contain an array of pages.');
  pageCount = parsed.length;
  blockCount = parsed.reduce((sum, page) => sum + page.length, 0);
  let imageCount = 0;
  if (imagesPath) {
    const imageEntries = await readdir(imagesPath, { withFileTypes: true });
    imageCount = imageEntries.filter((entry) => entry.isFile()).length;
  }
  const warnings: string[] = [];
  if (!markdownPath) warnings.push('未找到 Markdown；将从 content_list_v2.json 生成兼容 Markdown。');
  if (!imagesPath) warnings.push('未找到 images 目录；图片证据与 VLM 复核不可用。');

  const rootEntries = await readdir(root, { withFileTypes: true });
  const rootPdfNames = rootEntries
    .filter((entry) => entry.isFile() && /\.pdf$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right, 'zh-CN', { numeric: true }));
  const exactPdfName = rootPdfNames.find((name) => name.toLocaleLowerCase() === `${basename(root)}.pdf`.toLocaleLowerCase());
  const pdfPath = exactPdfName || rootPdfNames[0] ? join(root, exactPdfName || rootPdfNames[0]!) : null;

  return {
    source_root_path: root,
    folder_path: selected.path,
    pdf_path: pdfPath,
    markdown_path: markdownPath,
    content_list_path: contentListPath,
    content_list_v2_path: contentListV2Path,
    images_path: imagesPath,
    page_count: pageCount,
    block_count: blockCount,
    image_count: imageCount,
    preferred_input: markdownPath ? 'markdown_with_v2' : 'content_list_v2',
    quality: markdownPath && imagesPath ? 'complete' : 'structured',
    source_fingerprint: createHash('sha256').update(contentListV2).digest('hex'),
    warnings,
  };
}

function ocrRootPriority(path: string): number {
  const normalized = path.toLowerCase();
  if (normalized.includes('hybrid_high_ocr')) return 300;
  if (normalized.includes('hybrid')) return 200;
  return 100;
}

async function resolvePairedOcrRoots(pdfRoot: string, requestedPath = ''): Promise<string[]> {
  const requested = requestedPath.trim();
  const candidates = requested
    ? [requested]
    : [
        `${pdfRoot}_mineru_hybrid_high_ocr`,
        `${pdfRoot}_mineru_ocr`,
        ...(await readdir(pdfRoot, { withFileTypes: true }))
          .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink() && /_mineru.*_ocr$/i.test(entry.name))
          .map((entry) => join(pdfRoot, entry.name)),
      ];
  const roots: string[] = [];
  for (const candidate of [...new Set(candidates)]) {
    if (!isAbsolute(candidate)) {
      if (requested) throw new Error('OCR folder path must be an absolute path.');
      continue;
    }
    const resolved = await realpath(candidate).catch(() => null);
    if (!resolved) {
      if (requested) throw new Error('OCR folder path does not exist or cannot be read.');
      continue;
    }
    if (!(await stat(resolved)).isDirectory()) {
      if (requested) throw new Error('OCR folder path must point to a directory.');
      continue;
    }
    roots.push(resolved);
  }
  return [...new Set(roots)].sort((left, right) => ocrRootPriority(right) - ocrRootPriority(left) || left.localeCompare(right, 'zh-CN'));
}

interface OcrBundleCandidate {
  path: string;
  priority: number;
}

async function indexOcrBundles(roots: string[]): Promise<Map<string, OcrBundleCandidate[]>> {
  const bundles = new Map<string, OcrBundleCandidate[]>();
  const pending: Array<{ path: string; relativePath: string; depth: number; priority: number }> = roots.map((root) => ({
    path: root,
    relativePath: '',
    depth: 0,
    priority: ocrRootPriority(root),
  }));
  while (pending.length > 0) {
    const current = pending.shift()!;
    const entries = await readdir(current.path, { withFileTypes: true });
    const contentList = entries.find((entry) => entry.isFile() && /_content_list_v2\.json$/i.test(entry.name));
    if (contentList) {
      const textbookName = contentList.name.replace(/_content_list_v2\.json$/i, '');
      const relativeParts = current.relativePath.split(sep).filter(Boolean);
      const stage = relativeParts[0] ?? '';
      const keys = [
        `${stage}\u0000${textbookName}`,
        `\u0000${textbookName}`,
      ];
      for (const key of keys) {
        bundles.set(key, [...(bundles.get(key) ?? []), { path: current.path, priority: current.priority }]);
      }
      continue;
    }
    if (current.depth >= 5) continue;
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name === 'images' || entry.name.startsWith('.')) continue;
      pending.push({
        path: join(current.path, entry.name),
        relativePath: join(current.relativePath, entry.name),
        depth: current.depth + 1,
        priority: current.priority,
      });
    }
  }
  return bundles;
}

function matchedOcrBundle(
  bundles: Map<string, OcrBundleCandidate[]>,
  pdfRelativePath: string,
  textbookName: string,
): string | undefined {
  const relativeParts = pdfRelativePath.split(sep).filter(Boolean);
  const stage = relativeParts.length > 1 ? relativeParts.at(-2) ?? '' : '';
  const exact = bundles.get(`${stage}\u0000${textbookName}`) ?? [];
  const byName = bundles.get(`\u0000${textbookName}`) ?? [];
  const candidates = (exact.length > 0 ? exact : byName)
    .filter((candidate, index, all) => all.findIndex((item) => item.path === candidate.path) === index)
    .sort((left, right) => right.priority - left.priority || left.path.localeCompare(right.path, 'zh-CN'));
  return candidates[0]?.path;
}

export async function scanPdfFolder(
  folderPath: string,
  recursive = true,
  ocrFolderPath = '',
): Promise<PipelineFolderScanResponse> {
  const trimmed = folderPath.trim();
  if (!trimmed || !isAbsolute(trimmed)) throw new Error('Folder path must be an absolute path.');
  const root = await realpath(trimmed).catch(() => null);
  if (!root) throw new Error('Folder path does not exist or cannot be read.');
  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) throw new Error('Folder path must point to a directory.');

  const ocrRoots = await resolvePairedOcrRoots(root, ocrFolderPath);
  const ocrRootSet = new Set(ocrRoots);
  const ocrBundles = await indexOcrBundles(ocrRoots);
  const files: PipelineFolderPdf[] = [];
  const pending = [root];
  while (pending.length > 0) {
    const current = pending.shift()!;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const entryPath = join(current, entry.name);
      if (entry.isDirectory()) {
        if (recursive && !ocrRootSet.has(entryPath)) pending.push(entryPath);
        continue;
      }
      if (!entry.isFile() || extname(entry.name).toLowerCase() !== '.pdf') continue;
      const fileStat = await stat(entryPath);
      if (fileStat.size <= 0 || fileStat.size > MAX_PDF_UPLOAD_BYTES) continue;
      const relativePath = relative(root, entryPath);
      const textbookName = entry.name.replace(/\.pdf$/i, '');
      const matchedBundle = matchedOcrBundle(ocrBundles, relativePath, textbookName);
      files.push({
        pdf_path: entryPath,
        file_name: entry.name,
        relative_path: relativePath,
        size_bytes: fileStat.size,
        source_fingerprint: createHash('sha256')
          .update(`${relativePath.split(sep).join('/')}\u0000${fileStat.size}`)
          .digest('hex'),
        ocr_status: matchedBundle ? 'ready' : 'missing',
        ...(matchedBundle ? { ocr_folder_path: matchedBundle } : {}),
      });
      if (files.length > MAX_FOLDER_PDFS) {
        throw new Error(`Folder contains more than ${MAX_FOLDER_PDFS} PDF files. Narrow the folder and try again.`);
      }
    }
  }
  files.sort((left, right) => left.relative_path.localeCompare(right.relative_path, 'zh-CN'));
  return {
    folder_path: root,
    ocr_folder_path: ocrRoots[0] ?? null,
    ocr_folder_paths: ocrRoots,
    recursive,
    matched_ocr_count: files.filter((file) => Boolean(file.ocr_folder_path)).length,
    unmatched_ocr_count: files.filter((file) => !file.ocr_folder_path).length,
    files,
  };
}

const PIPELINE_START_STAGES = new Set<PipelineStartStage>([
  'mineru_source_markdown',
  'extract_pdf_outline',
  'prepare_source_markdown',
  'ensure_outline',
  'prepare_outline_chunks',
  'lesson_plan',
  'lesson_staging',
  'staging_quality',
  'canonical_commit',
  'assessment_staging',
  'assessment_quality',
  'assessment_commit',
  'normalize',
  'node_bodies',
  'pedagogical_profiles',
  'node_embeddings',
  'unit_embeddings',
  'strict_qa',
  'graph_integrity',
  'quality_dashboard',
]);

const ENRICH_REQUIRED_START_STAGES = new Set<PipelineStartStage>([
  'mineru_source_markdown',
  'extract_pdf_outline',
  'prepare_source_markdown',
  'ensure_outline',
  'prepare_outline_chunks',
  'lesson_plan',
  'lesson_staging',
  'staging_quality',
]);

export function redactCommand(command: string[]): string {
  return command.map((part) => part.replace(/(\/\/[^:/\s]+:)[^@/\s]+@/g, '$1****@')).join(' ');
}

function databaseTarget(dbUrl: string): string {
  try {
    const parsed = new URL(dbUrl);
    return `${parsed.hostname}:${parsed.port || '5432'}${parsed.pathname}`;
  } catch {
    return 'invalid-database-url';
  }
}

function timestamp(): string {
  return new Date().toISOString();
}

function logPipelineEvent(
  level: 'info' | 'error',
  event: string,
  details: Record<string, unknown>,
): void {
  const message = `[pipeline] ${event} ${JSON.stringify(details)}`;
  if (level === 'error') {
    console.error(message);
  } else {
    console.log(message);
  }
}

export function resolveNpmInvocation(
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    execPath?: string;
    platform?: NodeJS.Platform;
  } = {},
): CommandInvocation {
  const env = options.env ?? process.env;
  const execPath = options.execPath ?? process.execPath;
  const platform = options.platform ?? process.platform;
  const npmExecPath = env.npm_execpath;

  if (npmExecPath) {
    return {
      command: execPath,
      args: [npmExecPath, ...args],
    };
  }

  if (platform === 'win32') {
    return {
      command: env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', 'npm.cmd', ...args],
    };
  }

  return { command: 'npm', args };
}

function waitForSpawn(child: ChildProcess, onError: (error: Error) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    let started = false;

    child.once('spawn', () => {
      started = true;
      resolve();
    });
    child.on('error', (error) => {
      onError(error);
      if (!started) reject(error);
    });
  });
}

async function markPipelineProcessFailed(
  sql: Sql,
  datasetId: string,
  jobId: string,
  error: string,
): Promise<void> {
  const now = new Date().toISOString();
  await sql`
    UPDATE world_pipeline_worker_states
    SET status = 'failed', error = COALESCE(error, ${error}), completed_at = ${now}, updated_at = ${now}
    WHERE dataset_id = ${datasetId} AND job_id = ${jobId} AND status = 'running'
  `;
  await sql`
    UPDATE world_pipeline_job_stages
    SET status = 'blocked', error = COALESCE(error, ${error}), completed_at = ${now}, updated_at = ${now}
    WHERE dataset_id = ${datasetId} AND job_id = ${jobId} AND status = 'running'
  `;
  await sql`
    UPDATE world_pipeline_jobs
    SET status = 'blocked', error = COALESCE(error, ${error}), completed_at = ${now}, updated_at = ${now}
    WHERE dataset_id = ${datasetId} AND job_id = ${jobId} AND status = 'running'
  `;
}

export async function markPipelineJobStopped(
  sql: Sql,
  datasetId: string,
  jobId: string,
  reason = 'Pipeline job stopped by user.',
): Promise<void> {
  const now = new Date().toISOString();
  await sql`
    UPDATE world_pipeline_worker_states
    SET status = 'failed', error = ${reason}, completed_at = ${now}, updated_at = ${now}
    WHERE dataset_id = ${datasetId} AND job_id = ${jobId} AND status = 'running'
  `;
  await sql`
    UPDATE world_pipeline_job_stages
    SET status = 'blocked', error = ${reason}, completed_at = ${now}, updated_at = ${now}
    WHERE dataset_id = ${datasetId} AND job_id = ${jobId} AND status = 'running'
  `;
  await sql`
    UPDATE world_pipeline_jobs
    SET status = 'blocked', error = ${reason}, completed_at = ${now}, updated_at = ${now}
    WHERE dataset_id = ${datasetId} AND job_id = ${jobId} AND status = 'running'
  `;
}

export function latestPipelineProcessPid(logText: string): number | null {
  const matches = [...logText.matchAll(/\[pipeline\] spawned pid=(\d+)/g)];
  const pid = Number(matches.at(-1)?.[1]);
  return Number.isSafeInteger(pid) && pid > 1 ? pid : null;
}

async function stopPipelineProcessTree(pid: number): Promise<boolean> {
  if (!Number.isSafeInteger(pid) || pid <= 1) return false;
  if (process.platform === 'win32') {
    return new Promise((resolveStop) => {
      const killer = spawn('taskkill', ['/pid', String(pid), '/t', '/f'], { windowsHide: true });
      killer.once('error', () => resolveStop(false));
      killer.once('close', (code) => resolveStop(code === 0));
    });
  }
  let target = -pid;
  try {
    process.kill(target, 'SIGTERM');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
    target = pid;
    try {
      process.kill(target, 'SIGTERM');
    } catch (fallbackError) {
      if ((fallbackError as NodeJS.ErrnoException).code === 'ESRCH') return false;
      throw fallbackError;
    }
  }

  const isRunning = () => {
    try {
      process.kill(target, 0);
      return true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
      throw error;
    }
  };
  for (let attempt = 0; attempt < 15; attempt += 1) {
    if (!isRunning()) return true;
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  try {
    process.kill(target, 'SIGKILL');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ESRCH') return true;
    throw error;
  }
  await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  return true;
}

type PipelineRouteOptions = {
  stopProcessTree?: (pid: number) => Promise<boolean>;
};

export async function claimPipelineJobResume(
  sql: Sql,
  datasetId: string,
  jobId: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  return sql.begin(async (tx) => {
    await tx.unsafe(DATASET_ADVISORY_LOCK_SQL, [datasetId]);
    const rows = await tx<{ job_id: string }[]>`
      UPDATE world_pipeline_jobs AS target
      SET status = 'running',
          error = NULL,
          completed_at = NULL,
          updated_at = ${now}
      WHERE target.dataset_id = ${datasetId}
        AND target.job_id = ${jobId}
        AND target.status = 'blocked'
        AND NOT EXISTS (
          SELECT 1
          FROM world_pipeline_jobs AS running
          WHERE running.dataset_id = target.dataset_id
            AND running.book_id = target.book_id
            AND running.status = 'running'
        )
        AND (
          SELECT COUNT(*)
          FROM world_pipeline_jobs AS running
          WHERE running.dataset_id = target.dataset_id
            AND running.status = 'running'
        ) < ${MAX_ACTIVE_PIPELINE_JOBS}
      RETURNING target.job_id
    `;
    if (rows.length !== 1) return false;

    await tx`
      UPDATE world_pipeline_job_stages
      SET status = 'pending',
          error = NULL,
          started_at = NULL,
          completed_at = NULL,
          updated_at = ${now}
      WHERE dataset_id = ${datasetId}
        AND job_id = ${jobId}
        AND status = 'blocked'
    `;
    await tx`
      UPDATE world_pipeline_worker_states
      SET status = 'idle',
          lesson_run_id = NULL,
          batch_anchor = NULL,
          error = NULL,
          data_json = '{}'::jsonb,
          started_at = NULL,
          completed_at = NULL,
          updated_at = ${now}
      WHERE dataset_id = ${datasetId}
        AND job_id = ${jobId}
    `;
    return true;
  }) as Promise<boolean>;
}

export async function reservePipelineJobStart(
  sql: Sql,
  input: {
    datasetId: string;
    jobId: string;
    bookId: string;
    bookTitle: string;
    logPath: string;
    enrichContext?: boolean;
    enrichBookPath?: string;
    ocrFolderPath?: string;
    prepareOnly?: boolean;
  },
): Promise<boolean> {
  const now = new Date().toISOString();
  return sql.begin(async (tx) => {
    await tx.unsafe(DATASET_ADVISORY_LOCK_SQL, [input.datasetId]);
    await tx`
      INSERT INTO world_datasets (
        dataset_id, dataset_name, schema_version, status, is_active,
        root_path, created_at, updated_at, notes
      )
      VALUES (
        ${input.datasetId}, ${input.datasetId}, 'world-v1.2', 'active', 0,
        NULL, ${now}, ${now}, NULL
      )
      ON CONFLICT (dataset_id) DO NOTHING
    `;
    const rows = await tx<{ job_id: string }[]>`
      INSERT INTO world_pipeline_jobs (
        dataset_id, job_id, book_id, status, current_stage_id,
        progress_json, log_path, command_json, context_json,
        created_at, updated_at, completed_at, error
      )
      SELECT
        ${input.datasetId}, ${input.jobId}, ${input.bookId}, 'running', NULL,
        ${tx.json({})}, ${input.logPath}, ${tx.json([])}, ${tx.json({
          reserved_by: 'server',
          book_title: input.bookTitle,
          enrich_context: input.enrichContext ?? true,
          enrich_book_path: input.enrichBookPath || null,
          ocr_folder_path: input.ocrFolderPath || null,
          prepare_only: input.prepareOnly ?? false,
        })},
        ${now}, ${now}, NULL, NULL
      WHERE NOT EXISTS (
        SELECT 1
        FROM world_pipeline_jobs
        WHERE dataset_id = ${input.datasetId}
          AND book_id = ${input.bookId}
          AND status = 'running'
      )
        AND (
          SELECT COUNT(*)
          FROM world_pipeline_jobs
          WHERE dataset_id = ${input.datasetId}
            AND status = 'running'
        ) < ${MAX_ACTIVE_PIPELINE_JOBS}
      ON CONFLICT (dataset_id, job_id) DO NOTHING
      RETURNING job_id
    `;
    return rows.length === 1;
  }) as Promise<boolean>;
}

export function safeToken(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '') || 'job';
}

export type PipelineRuntimeSnapshot = {
  runtime_dir: string;
  entry_path: string;
};

export async function createPipelineRuntimeSnapshot(
  jobId: string,
  options: { source_dir?: string; runtime_root?: string } = {},
): Promise<PipelineRuntimeSnapshot> {
  const sourceDir = resolve(options.source_dir ?? resolve(REPO_ROOT, 'packages', 'pipeline', 'dist'));
  const runtimeRoot = resolve(options.runtime_root ?? resolve(REPO_ROOT, 'tmp', 'pipeline-runtimes'));
  const runtimeDir = join(runtimeRoot, `${safeToken(jobId)}-${randomUUID()}`);
  await mkdir(runtimeRoot, { recursive: true });
  try {
    await cp(sourceDir, runtimeDir, { recursive: true, errorOnExist: true, force: false });
    const entryPath = resolve(runtimeDir, 'cli', 'server-pipeline-run.js');
    if (!(await stat(entryPath)).isFile()) throw new Error(`Pipeline runtime entry is not a file: ${entryPath}`);
    return { runtime_dir: runtimeDir, entry_path: entryPath };
  } catch (error) {
    await rm(runtimeDir, { recursive: true, force: true }).catch(() => undefined);
    throw error;
  }
}

export function createPipelineJobId(bookId: string, now = new Date()): string {
  const compactTimestamp = now.toISOString().replace(/[-:.]/g, '');
  return `${safeToken(bookId)}.${compactTimestamp}`;
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => asString(item)).filter(Boolean))];
}

function normalizeTextbookIdentity(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/(?:_?enriched)?\.json$/i, '')
    .replace(/_?enriched$/i, '')
    .toLocaleLowerCase('zh-CN')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

export function resolveAutomaticEnrichBookPath(
  indexPayload: Record<string, unknown> | null,
  textbookNames: string[],
): string | null {
  const identities = new Set(textbookNames.map(normalizeTextbookIdentity).filter(Boolean));
  if (identities.size === 0) return null;
  const books = Array.isArray(indexPayload?.books) ? indexPayload.books : [];
  const matches = books.filter((value) => {
    const book = asRecord(value);
    return [asString(book.filename), asString(book.title), basename(asString(book.path))]
      .map(normalizeTextbookIdentity)
      .some((identity) => identities.has(identity));
  }).map((value) => asString(asRecord(value).path)).filter(Boolean);
  return matches.length === 1 ? matches[0]! : null;
}

export function restoreResumeEnrichSettings(
  body: PipelineStartRequest,
  context: Record<string, unknown>,
): PipelineStartRequest {
  const hasStoredDecision = typeof context.enrich_context === 'boolean'
    || typeof context.enrich_book_path === 'string';
  if (!hasStoredDecision) return body;
  return {
    ...body,
    enrich_context: context.enrich_context !== false,
    enrich_book_path: asString(context.enrich_book_path) || undefined,
  };
}

export function restoreResumeSourceSettings(
  body: PipelineStartRequest,
  context: Record<string, unknown>,
): PipelineStartRequest {
  const ocrFolderPath = asString(context.ocr_folder_path);
  if (!ocrFolderPath) return body;
  return {
    ...body,
    pdf_path: asString(context.pdf_path) || undefined,
    mineru_file_url: undefined,
    ocr_folder_path: ocrFolderPath,
    ocr_import_mode: context.ocr_import_mode === 'copy' ? 'copy' : 'in_place',
  };
}

export function shouldValidateEnrichBook(body: PipelineStartRequest): boolean {
  if (!asString(body.resume_job_id)) return true;
  return ENRICH_REQUIRED_START_STAGES.has(body.start_stage as PipelineStartStage);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function finiteNumber(value: unknown): number | null {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function outlineRecords(outline: Record<string, unknown>): Record<string, unknown>[] {
  const roots = Array.isArray(outline.items)
    ? outline.items
    : Array.isArray(outline.structure)
      ? outline.structure
      : [];
  const records: Record<string, unknown>[] = [];
  const visit = (values: unknown[]) => {
    values.forEach((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return;
      const record = value as Record<string, unknown>;
      records.push(record);
      if (Array.isArray(record.children)) visit(record.children);
    });
  };
  visit(roots);
  return records;
}

function outlineItemDepth(item: Record<string, unknown>, byId: Map<string, Record<string, unknown>>): number {
  let depth = 0;
  let parentId = asString(item.parent_id);
  const visited = new Set<string>();
  while (parentId && byId.has(parentId) && !visited.has(parentId) && depth < 12) {
    visited.add(parentId);
    depth += 1;
    parentId = asString(byId.get(parentId)?.parent_id);
  }
  return depth;
}

function compareOutlineRecords(left: Record<string, unknown>, right: Record<string, unknown>): number {
  const leftStart = finiteNumber(left.md_start) ?? Number.POSITIVE_INFINITY;
  const rightStart = finiteNumber(right.md_start) ?? Number.POSITIVE_INFINITY;
  if (leftStart !== rightStart) return leftStart - rightStart;
  return asString(left.order_path).localeCompare(asString(right.order_path), 'zh-CN', { numeric: true });
}

export function outlineFingerprint(outline: Record<string, unknown>): string {
  const items = outlineRecords(outline)
    .map((item) => ({
      id: asString(item.id),
      kind: asString(item.kind),
      parent_id: asString(item.parent_id) || null,
      order_path: asString(item.order_path),
      title: asString(item.title),
      label: asString(item.label),
      md_start: finiteNumber(item.md_start),
      md_end: finiteNumber(item.md_end),
      page_start: finiteNumber(item.page_start),
      page_end: finiteNumber(item.page_end),
      source_ids: Array.isArray(item.source_ids) ? item.source_ids.map(String).sort() : [],
      content_role: asString(item.content_role) || null,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return createHash('sha256').update(JSON.stringify({
    source_kind: asString(outline.source_kind),
    source_ref: asString(outline.source_ref),
    source_path: asString(outline.source_path),
    items,
  })).digest('hex');
}

export function unmatchedOutlineItemIds(outline: Record<string, unknown>): string[] {
  const alignment = asRecord(outline.alignment_report);
  return Array.isArray(alignment.unmatched_item_ids)
    ? [...new Set(alignment.unmatched_item_ids.map(String).filter(Boolean))]
    : [];
}

export function buildOutlinePreview(
  datasetId: string,
  bookId: string,
  outline: Record<string, unknown>,
): PipelineOutlinePreviewResponse {
  const records = outlineRecords(outline);
  const byId = new Map<string, Record<string, unknown>>(records.flatMap((item): Array<[string, Record<string, unknown>]> => {
    const id = asString(item.id);
    return id ? [[id, item]] : [];
  }));
  const children = new Map<string, Record<string, unknown>[]>();
  const roots: Record<string, unknown>[] = [];
  records.forEach((item) => {
    const parentId = asString(item.parent_id);
    if (!parentId || !byId.has(parentId)) {
      roots.push(item);
      return;
    }
    const values = children.get(parentId) ?? [];
    values.push(item);
    children.set(parentId, values);
  });
  const ordered: Record<string, unknown>[] = [];
  const visited = new Set<Record<string, unknown>>();
  const visit = (item: Record<string, unknown>) => {
    if (visited.has(item)) return;
    visited.add(item);
    ordered.push(item);
    (children.get(asString(item.id)) ?? []).sort(compareOutlineRecords).forEach(visit);
  };
  roots.sort(compareOutlineRecords).forEach(visit);
  records.filter((item) => !visited.has(item)).sort(compareOutlineRecords).forEach(visit);

  const items: PipelineOutlinePreviewItem[] = ordered.map((item) => ({
    id: asString(item.id),
    kind: asString(item.kind, 'unknown'),
    title: asString(item.title, asString(item.label, '未命名条目')),
    label: asString(item.label, asString(item.title, '未命名条目')),
    parent_id: asString(item.parent_id) || null,
    order_path: asString(item.order_path),
    depth: outlineItemDepth(item, byId),
    page_start: finiteNumber(item.page_start),
    page_end: finiteNumber(item.page_end),
    md_start: finiteNumber(item.md_start),
    md_end: finiteNumber(item.md_end),
    source_ids: Array.isArray(item.source_ids) ? item.source_ids.map(String) : [],
    content_role: (['knowledge', 'summary', 'assessment', 'excluded'] as const).includes(asString(item.content_role) as never)
      ? asString(item.content_role) as PipelineOutlinePreviewItem['content_role']
      : null,
    preview_text: null,
    line_count: finiteNumber(item.md_start) != null && finiteNumber(item.md_end) != null
      ? Math.max(0, (finiteNumber(item.md_end) ?? 0) - (finiteNumber(item.md_start) ?? 0) + 1)
      : null,
    alignment_status: (['matched', 'warning', 'inferred_from_children', 'unmatched'] as const).includes(asString(item.alignment_status) as never)
      ? asString(item.alignment_status) as PipelineOutlinePreviewItem['alignment_status']
      : ((finiteNumber(item.md_start) == null || finiteNumber(item.md_end) == null) && (item.kind === 'lesson' || item.kind === 'activity') ? 'unmatched' : null),
    alignment_confidence: finiteNumber(item.alignment_confidence),
    alignment_match_type: asString(item.alignment_match_type) || null,
  }));
  const fingerprint = outlineFingerprint(outline);
  const review = asRecord(outline.outline_review);
  const confirmed = review.status === 'confirmed' && asString(review.fingerprint) === fingerprint;
  const rejected = review.status === 'rejected' && asString(review.fingerprint) === fingerprint;
  const alignment = asRecord(outline.alignment_report);
  const warningItemIds = Array.isArray(alignment.warning_item_ids) ? alignment.warning_item_ids.map(String) : [];
  const unmatchedItemIds = Array.isArray(alignment.unmatched_item_ids) ? alignment.unmatched_item_ids.map(String) : [];
  const pageStarts = items.flatMap((item) => item.page_start == null ? [] : [item.page_start]);
  const pageEnds = items.flatMap((item) => item.page_end == null ? [] : [item.page_end]);
  const toc = asRecord(outline.toc_pages);
  const tocStart = finiteNumber(toc.start);
  const tocEnd = finiteNumber(toc.end);
  return {
    dataset_id: datasetId,
    book_id: bookId,
    title: asString(outline.title, bookId),
    source_kind: asString(outline.source_kind, 'unknown'),
    source_ref: asString(outline.source_ref) || null,
    source_path: asString(outline.source_path) || null,
    toc_pages: tocStart == null || tocEnd == null ? null : { start: tocStart, end: tocEnd },
    fingerprint,
    review_status: confirmed ? 'confirmed' : rejected ? 'rejected' : 'pending',
    confirmed_at: confirmed ? asString(review.confirmed_at) || null : null,
    rejected_at: rejected ? asString(review.rejected_at) || null : null,
    alignment_report: Object.keys(alignment).length === 0 ? null : {
      strategy: asString(alignment.strategy, 'unknown'),
      matched_items: asInt(alignment.matched_items, 0),
      total_items: asInt(alignment.total_items, 0),
      matched_lessons: asInt(alignment.matched_lessons, 0),
      total_lessons: asInt(alignment.total_lessons, 0),
      average_confidence: finiteNumber(alignment.average_confidence) ?? 0,
      warning_item_ids: warningItemIds,
      unmatched_item_ids: unmatchedItemIds,
      requires_review: alignment.requires_review === true || warningItemIds.length > 0 || unmatchedItemIds.length > 0,
    },
    summary: {
      themes: items.filter((item) => item.kind === 'theme').length,
      topics: items.filter((item) => item.kind === 'topic').length,
      lessons: items.filter((item) => item.kind === 'lesson' || item.kind === 'activity').length,
      chunks: items.filter((item) => item.kind === 'chunk').length,
      knowledge_chunks: items.filter((item) => item.kind === 'chunk' && (item.content_role === 'knowledge' || item.content_role == null)).length,
      summary_chunks: items.filter((item) => item.kind === 'chunk' && item.content_role === 'summary').length,
      assessment_chunks: items.filter((item) => item.kind === 'chunk' && item.content_role === 'assessment').length,
      pages: pageStarts.length > 0 && pageEnds.length > 0 ? Math.max(...pageEnds) - Math.min(...pageStarts) + 1 : 0,
    },
    items,
  };
}

function outlineChunkLines(item: PipelineOutlinePreviewItem, sourceLines: string[]): string[] | null {
  if (item.kind !== 'chunk' || item.md_start == null || item.md_end == null) return null;
  const start = Math.max(1, Math.trunc(item.md_start));
  const end = Math.min(sourceLines.length, Math.max(start, Math.trunc(item.md_end)));
  return sourceLines.slice(start - 1, end);
}

export function attachOutlineChunkPreviews(
  preview: PipelineOutlinePreviewResponse,
  sourceLines: string[],
): PipelineOutlinePreviewResponse {
  return {
    ...preview,
    items: preview.items.map((item) => {
      const lines = outlineChunkLines(item, sourceLines);
      if (!lines) return item;
      const previewText = lines
        .join('\n')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '[图片]')
        .replace(/\s+/g, ' ')
        .trim();
      return {
        ...item,
        preview_text: previewText ? previewText.slice(0, 360) : null,
        line_count: lines.length,
      };
    }),
  };
}

export function buildOutlineChunkContent(
  preview: PipelineOutlinePreviewResponse,
  itemId: string,
  sourceLines: string[],
  assetBasePath: string | null = null,
): PipelineOutlineChunkContentResponse | null {
  const item = preview.items.find((candidate) => candidate.id === itemId && candidate.kind === 'chunk');
  if (!item || item.md_start == null || item.md_end == null) return null;
  const lines = outlineChunkLines(item, sourceLines);
  if (!lines) return null;
  const fullContent = lines.join('\n').trim();
  const truncated = fullContent.length > MAX_CHUNK_CONTENT_CHARACTERS;
  const content = truncated ? `${fullContent.slice(0, MAX_CHUNK_CONTENT_CHARACTERS)}\n\n[内容过长，已截断]` : fullContent;
  return {
    id: item.id,
    title: item.title,
    content_role: item.content_role,
    page_start: item.page_start,
    page_end: item.page_end,
    md_start: item.md_start,
    md_end: item.md_end,
    line_count: lines.length,
    character_count: fullContent.length,
    source_ids: item.source_ids,
    asset_base_path: assetBasePath,
    content,
    truncated,
  };
}

type OutlineSource = {
  lines: string[];
  assetBasePath: string | null;
};

async function loadOutlineSource(
  outline: Record<string, unknown>,
  allowedSourcePaths: string[] = [],
): Promise<OutlineSource | null> {
  const sourcePath = asString(outline.source_path);
  if (!sourcePath) return null;
  const resolvedPath = isAbsolute(sourcePath) ? resolve(sourcePath) : resolve(REPO_ROOT, sourcePath);
  const resolvedRoot = await realpath(REPO_ROOT).catch(() => resolve(REPO_ROOT));
  const realSourcePath = await realpath(resolvedPath).catch(() => null);
  if (!realSourcePath) return null;
  const isRepositorySource = realSourcePath === resolvedRoot || realSourcePath.startsWith(`${resolvedRoot}${sep}`);
  if (!isRepositorySource) {
    const allowedRoots = await Promise.all(allowedSourcePaths.map(async (value) => {
      if (!value || /^https?:/i.test(value)) return null;
      const candidate = isAbsolute(value) ? resolve(value) : resolve(REPO_ROOT, value);
      const info = await stat(candidate).catch(() => null);
      const directory = info?.isDirectory() ? candidate : info?.isFile() ? dirname(candidate) : null;
      return directory ? realpath(directory).catch(() => null) : null;
    }));
    if (!allowedRoots.some((root) => root && (realSourcePath === root || realSourcePath.startsWith(`${root}${sep}`)))) return null;
  }
  const sourceStat = await stat(realSourcePath).catch(() => null);
  if (!sourceStat?.isFile() || sourceStat.size > MAX_OUTLINE_SOURCE_BYTES) return null;
  const sourceText = await readFile(realSourcePath, 'utf8').catch(() => null);
  if (sourceText == null) return null;
  const relativeAssetBase = isRepositorySource
    ? relative(resolvedRoot, dirname(realSourcePath)).split(sep).join('/')
    : dirname(realSourcePath);
  return {
    lines: sourceText.split(/\r?\n/),
    assetBasePath: relativeAssetBase && relativeAssetBase !== '.' ? relativeAssetBase : null,
  };
}

export function assertOutlineConfirmed(outline: Record<string, unknown> | null, fingerprint: string): void {
  if (!outline) throw new Error('尚未生成切分预览，请先导入教材并完成目录切分。');
  const currentFingerprint = outlineFingerprint(outline);
  const review = asRecord(outline.outline_review);
  if (review.status !== 'confirmed' || asString(review.fingerprint) !== currentFingerprint) {
    throw new Error('切分结果尚未人工确认，不能开始模型抽取。');
  }
  if (!fingerprint || fingerprint !== currentFingerprint) {
    throw new Error('切分结果已经变化，请重新检查并确认最新预览。');
  }
}

export function applyQualityReviewAction(
  propertiesValue: unknown,
  action: PipelineQualityReviewAction,
  note: string,
  reviewedAt: string,
): Record<string, unknown> {
  return {
    ...asRecord(propertiesValue),
    ...qualityReviewPatch(action, note, reviewedAt),
  };
}

export function qualityReviewPatch(
  action: PipelineQualityReviewAction,
  note: string,
  reviewedAt: string,
): Record<string, unknown> {
  return {
    quality_review_required: false,
    quality_review_status: action === 'accept' ? 'accepted' : 'resolved',
    quality_review_note: note,
    quality_reviewed_at: reviewedAt,
    quality_reviewed_via: 'viewer',
  };
}

export async function updatePendingQualityReview(
  sql: Sql,
  input: {
    datasetId: string;
    lessonRunId: string;
    action: PipelineQualityReviewAction;
    note: string;
    reviewedAt: string;
  },
): Promise<boolean> {
  const patch = qualityReviewPatch(input.action, input.note, input.reviewedAt);
  const updatedRows = await sql<{ lesson_run_id: string }[]>`
    UPDATE world_lesson_runs
    SET properties_json = COALESCE(properties_json, '{}'::jsonb)
          || ${sql.json(patch as unknown as JsonValue)}::jsonb,
        updated_at = ${input.reviewedAt}
    WHERE dataset_id = ${input.datasetId}
      AND lesson_run_id = ${input.lessonRunId}
      AND COALESCE((properties_json->>'quality_review_required')::boolean, false) = true
    RETURNING lesson_run_id
  `;
  return updatedRows.length === 1;
}

function asInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(16, Math.floor(parsed)));
}

function asPositiveInt(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.floor(parsed));
}

export function pipelineBookNodeLimit(value: unknown): number {
  return Math.min(500, asPositiveInt(value, 200));
}

function sourceName(value: string): string {
  const clean = value.split(/[?#]/)[0] ?? value;
  try {
    if (/^https?:\/\//i.test(value)) {
      return decodeURIComponent(basename(new URL(value).pathname));
    }
  } catch {
    return basename(clean);
  }
  return basename(clean);
}

function sourceStem(value: string): string {
  return sourceName(value).replace(/\.[^.]+$/, '');
}

function ocrFolderStem(value: string): string {
  const folderName = sourceStem(value);
  return /^(?:hybrid_ocr|auto|ocr|output|result)$/i.test(folderName)
    ? basename(dirname(value)) || folderName
    : folderName;
}

export function safePdfUploadName(value: string): string {
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    // Keep the original header value so validation can return a useful error.
  }
  const name = basename(decoded.trim()).replace(/[\u0000-\u001f\u007f]/g, '');
  if (!name || !name.toLowerCase().endsWith('.pdf')) {
    throw new Error('Only PDF files can be uploaded.');
  }
  return name;
}

async function fileFingerprint(filePath: string): Promise<string> {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(filePath)) digest.update(chunk as Buffer);
  return digest.digest('hex');
}

async function savePdfUpload(
  body: ReadableStream<Uint8Array>,
  destination: string,
): Promise<{ sizeBytes: number; sourceFingerprint: string }> {
  let sizeBytes = 0;
  let signature = Buffer.alloc(0);
  const digest = createHash('sha256');
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      sizeBytes += chunk.length;
      digest.update(chunk);
      if (signature.length < 5) {
        signature = Buffer.concat([signature, chunk.subarray(0, 5 - signature.length)]);
      }
      if (sizeBytes > MAX_PDF_UPLOAD_BYTES) {
        callback(new Error('PDF exceeds the 512 MB upload limit.'));
        return;
      }
      callback(null, chunk);
    },
  });

  await streamPipeline(
    Readable.fromWeb(body as import('node:stream/web').ReadableStream<Uint8Array>),
    limiter,
    createWriteStream(destination, { flags: 'wx' }),
  );
  if (sizeBytes === 0) throw new Error('The uploaded PDF is empty.');
  if (signature.toString('ascii') !== '%PDF-') throw new Error('The selected file is not a valid PDF.');
  return { sizeBytes, sourceFingerprint: digest.digest('hex') };
}

export function generatedBookId(value: string, sourceFingerprint = ''): string {
  const seed = value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('zh-CN')
    .replace(/\s+/g, ' ');
  const readable = seed
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  const prefix = [...readable].slice(0, 48).join('').replace(/-+$/g, '') || 'textbook';
  const identitySeed = sourceFingerprint.trim().toLowerCase()
    ? `${seed}\u0000${sourceFingerprint.trim().toLowerCase()}`
    : seed;
  const digest = createHash('sha256').update(identitySeed).digest('hex').slice(0, 12);
  return `${prefix}-${digest}`;
}

export function inferBookId(input: { book_id?: unknown; book_title?: unknown; pdf_path?: unknown; ocr_folder_path?: unknown; mineru_file_url?: unknown; source_fingerprint?: unknown }): string {
  const explicit = asString(input.book_id);
  if (explicit && /[\p{L}\p{N}]/u.test(explicit)) return explicit;
  const sourceFingerprint = asString(input.source_fingerprint);
  const title = asString(input.book_title);
  if (title) return generatedBookId(title, sourceFingerprint);
  const ocrFolderPath = asString(input.ocr_folder_path);
  const source = asString(input.pdf_path) || ocrFolderPath || asString(input.mineru_file_url);
  return source ? generatedBookId(ocrFolderPath ? ocrFolderStem(ocrFolderPath) : sourceStem(source), sourceFingerprint) : '';
}

async function resolveSourceFingerprint(input: TextbookMetadataRequest): Promise<string> {
  const supplied = asString(input.source_fingerprint);
  if (supplied) return supplied;
  const pdfPath = asString(input.pdf_path);
  if (pdfPath && isAbsolute(pdfPath)) {
    return fileFingerprint(pdfPath).catch(() => '');
  }
  const ocrFolderPath = asString(input.ocr_folder_path);
  if (ocrFolderPath) {
    return inspectOcrFolder(ocrFolderPath)
      .then((inspection) => inspection.source_fingerprint)
      .catch(() => '');
  }
  return '';
}

export function resolvePipelineBookId(input: PipelineStartRequest): string {
  const persistedResumeBookId = asString(input.resume_job_id) ? asString(input.book_id) : '';
  return persistedResumeBookId || inferBookId(input);
}

function inferMineruLanguage(text: string): string {
  if (/english/i.test(text) && !/[\u4e00-\u9fff]/.test(text)) return 'en';
  return 'ch';
}

function extractionTemplateForSubject(subject: string): string {
  if (subject === 'physics' || subject === 'chemistry' || subject === 'biology' || subject === 'mathematics') return `textbook/${subject}`;
  return 'auto';
}

function parseLessonBackendKind(value: unknown): 'openai_responses' | 'openai_chat_completions' {
  const raw = asString(value, 'openai_chat_completions');
  if (raw === 'openai_responses' || raw === 'openai_chat_completions') return raw;
  throw new Error(`Unsupported lesson backend '${raw}'. Use openai_responses or openai_chat_completions.`);
}

function toPipelineApiMode(kind: 'openai_responses' | 'openai_chat_completions'): 'responses' | 'chat_completions' {
  return kind === 'openai_chat_completions' ? 'chat_completions' : 'responses';
}

function inferTextbookMetadata(
  input: TextbookMetadataRequest,
  outline: Record<string, unknown> | null = null,
  resolvedBookId = '',
): TextbookMetadataResponse {
  const bookId = resolvedBookId || inferBookId(input);
  if (!bookId) throw new Error('Textbook name, PDF path, OCR folder, MinerU file URL, or book_id is required.');
  const requestedTitle = asString(input.book_title);
  const ocrFolderPath = asString(input.ocr_folder_path);
  const sourcePath = asString(input.pdf_path) || ocrFolderPath || asString(input.mineru_file_url);
  const pdfName = sourcePath ? (ocrFolderPath ? ocrFolderStem(ocrFolderPath) : sourceName(sourcePath)) : '';
  let outlineText = '';
  if (outline) {
    outlineText = JSON.stringify({
      title: outline.title,
      book_title: outline.book_title,
      structure: Array.isArray(outline.structure) ? outline.structure.slice(0, 12) : outline.items,
    });
  }

  const rawHaystack = `${requestedTitle} ${bookId} ${pdfName} ${outlineText}`;
  const haystack = rawHaystack.toLowerCase();
  const signals: string[] = [];
  let subject = 'general';
  let schoolStage = 'higher';
  let gradeBand = 'unknown';
  let title = requestedTitle || pdfName.replace(/\.[^.]+$/, '') || bookId;
  let confidence = 0.25;

  const subjectRules: Array<[string, string, RegExp]> = [
    ['chemistry', '化学', /chem|化学/],
    ['physics', '物理', /phys|物理/],
    ['biology', '生物', /bio|生物/],
    ['mathematics', '数学', /math|数学/],
    ['geography', '地理', /geo|地理/],
    ['history', '历史', /history|历史/],
    ['language-arts', '语文', /语文|chinese/],
    ['english', '英语', /english|英语/],
    ['computer-science', '信息科技', /computer|cs|信息科技|信息技术|编程/],
  ];
  for (const [value, label, pattern] of subjectRules) {
    if (pattern.test(haystack)) {
      subject = value;
      signals.push(label);
      confidence += 0.25;
      break;
    }
  }

  const gradeRules: Array<[string, string, RegExp]> = [
    ['grade1', '一年级', /grade[-_ ]?1|一年级|1年级/],
    ['grade2', '二年级', /grade[-_ ]?2|二年级|2年级/],
    ['grade3', '三年级', /grade[-_ ]?3|三年级|3年级/],
    ['grade4', '四年级', /grade[-_ ]?4|四年级|4年级/],
    ['grade5', '五年级', /grade[-_ ]?5|五年级|5年级/],
    ['grade6', '六年级', /grade[-_ ]?6|六年级|6年级/],
    ['grade7', '七年级', /grade[-_ ]?7|七年级|7年级|初一/],
    ['grade8', '八年级', /grade[-_ ]?8|八年级|8年级|初二/],
    ['grade9', '九年级', /grade[-_ ]?9|九年级|9年级|初三/],
    ['grade10', '高一', /grade[-_ ]?10|高一|必修一|必修1/],
    ['grade11', '高二', /grade[-_ ]?11|高二|选择性必修/],
    ['grade12', '高三', /grade[-_ ]?12|高三/],
  ];
  for (const [value, label, pattern] of gradeRules) {
    if (pattern.test(haystack)) {
      gradeBand = value;
      signals.push(label);
      confidence += 0.25;
      break;
    }
  }

  if (/primary|小学|一年级|二年级|三年级|四年级|五年级|六年级|grade[-_ ]?[1-6]\b/.test(haystack)) {
    schoolStage = 'primary';
    signals.push('小学');
    confidence += 0.15;
  } else if (/junior|初中|七年级|八年级|九年级|初一|初二|初三|grade[-_ ]?[7-9]\b/.test(haystack)) {
    schoolStage = 'junior-secondary';
    signals.push('初中');
    confidence += 0.15;
  } else if (/senior|高中|高一|高二|高三|必修|选择性必修|grade[-_ ]?1[0-2]\b/.test(haystack)) {
    schoolStage = 'senior-secondary';
    signals.push('高中');
    confidence += 0.15;
  }

  const titleMatch = outlineText.match(/"title"\s*:\s*"([^"]+)"/) || outlineText.match(/"book_title"\s*:\s*"([^"]+)"/);
  if (titleMatch?.[1]) title = titleMatch[1];

  return {
    book_id: bookId,
    title,
    lesson_subject: subject,
    lesson_school_stage: schoolStage,
    lesson_grade_band: gradeBand,
    mineru_language: inferMineruLanguage(rawHaystack),
    mineru_page_ranges: '',
    outline_start_page: 1,
    outline_end_page: 20,
    extraction_template: extractionTemplateForSubject(subject),
    confidence: Math.min(confidence, 0.95),
    signals,
  };
}

export function buildPipelineCommand(
  body: PipelineStartRequest,
  jobId: string,
  logPath: string,
  dbUrl: string,
  outline: Record<string, unknown> | null = null,
  pipelineEntryPath = resolve(REPO_ROOT, 'packages', 'pipeline', 'dist', 'cli', 'server-pipeline-run.js'),
): string[] {
  const bookId = resolvePipelineBookId(body);
  if (!bookId) throw new Error('Textbook name, PDF path, OCR folder, MinerU file URL, or book_id is required.');
  const inferred = inferTextbookMetadata({
    book_id: bookId,
    book_title: body.book_title,
    pdf_path: body.pdf_path,
    ocr_folder_path: body.ocr_folder_path,
    mineru_file_url: body.mineru_file_url,
  }, outline, bookId);

  const outputRoot = asString(body.output_root, 'data/main');
  const datasetId = asString(body.dataset_id, outputRoot.split('/').filter(Boolean).at(-1) || 'main');
  const lessonBackendKind = parseLessonBackendKind(body.lesson_backend_kind);
  const command = [
    process.execPath,
    pipelineEntryPath,
    '--book-id',
    bookId,
    '--dataset-id',
    datasetId,
    '--output-root',
    outputRoot,
    '--parallelism',
    String(asInt(body.parallelism, 8)),
    '--db',
    dbUrl,
    '--job-id',
    jobId,
    '--log-path',
    logPath,
    '--api-mode',
    toPipelineApiMode(lessonBackendKind),
    '--extraction-template',
    asString(body.extraction_template, inferred.extraction_template),
    '--quality-retry-count',
    String(asInt(body.quality_retry_count, 1)),
    '--model-retry-count',
    String(asInt(body.model_retry_count, 2)),
    '--subject',
    asString(body.lesson_subject, inferred.lesson_subject),
    '--school-stage',
    asString(body.lesson_school_stage, inferred.lesson_school_stage),
    '--grade-band',
    asString(body.lesson_grade_band, inferred.lesson_grade_band),
  ];
  const openaiBaseUrl = asString(body.openai_base_url);
  if (openaiBaseUrl) {
    command.push('--base-url', openaiBaseUrl);
  }
  const openaiModel = asString(body.openai_model);
  if (openaiModel) {
    command.push('--model', openaiModel);
  }
  const vlmApiUrl = asString(body.vlm_api_url);
  if (vlmApiUrl) {
    command.push('--vlm-api-url', vlmApiUrl);
  }
  const vlmModel = asString(body.vlm_model);
  if (vlmModel) {
    command.push('--vlm-model', vlmModel);
  }
  const pdfPath = asString(body.pdf_path);
  if (pdfPath) command.push('--pdf-path', pdfPath);
  const ocrFolderPath = asString(body.ocr_folder_path);
  if (ocrFolderPath) command.push('--ocr-folder-path', ocrFolderPath);
  if (ocrFolderPath && body.ocr_import_mode === 'in_place') command.push('--ocr-import-mode', 'in_place');
  command.push('--book-title', asString(body.book_title, inferred.title));
  if (body.outline_start_page) command.push('--outline-start-page', String(asPositiveInt(body.outline_start_page, 1)));
  if (body.outline_end_page) command.push('--outline-end-page', String(asPositiveInt(body.outline_end_page, 20)));
  const mineruFileUrl = asString(body.mineru_file_url);
  if (mineruFileUrl) command.push('--mineru-file-url', mineruFileUrl);
  const mineruBaseUrl = asString(body.mineru_base_url);
  if (mineruBaseUrl) command.push('--mineru-base-url', mineruBaseUrl);
  const mineruModelVersion = asString(body.mineru_model_version);
  if (mineruModelVersion) command.push('--mineru-model-version', mineruModelVersion);
  const mineruLanguage = asString(body.mineru_language);
  command.push('--mineru-language', mineruLanguage || inferred.mineru_language);
  const mineruPageRanges = asString(body.mineru_page_ranges);
  if (mineruPageRanges) command.push('--mineru-page-ranges', mineruPageRanges);
  if (body.mineru_force === true) command.push('--mineru-force');
  const enrichBookPath = asString(body.enrich_book_path);
  if (body.enrich_context === false && enrichBookPath) {
    throw new Error('enrich_book_path cannot be set when enrich_context is false.');
  }
  if (body.enrich_context === false) command.push('--enrich-context', 'false');
  if (enrichBookPath) command.push('--enrich-book-path', enrichBookPath);
  const startStage = asString(body.start_stage);
  const resumeJobId = asString(body.resume_job_id);
  if (body.prepare_only && startStage && !['mineru_source_markdown', 'extract_pdf_outline', 'prepare_source_markdown', 'ensure_outline', 'prepare_outline_chunks'].includes(startStage)) {
    throw new Error(`prepare_only cannot start at '${startStage}' because that stage is after outline preparation.`);
  }
  if (resumeJobId && !startStage) {
    throw new Error('resume_job_id requires start_stage.');
  }
  if (startStage) {
    if (!PIPELINE_START_STAGES.has(startStage as PipelineStartStage)) {
      throw new Error(`Unknown pipeline start stage '${startStage}'.`);
    }
    command.push('--start-stage', startStage);
  }
  const resumeBatchAnchors = uniqueStrings(body.resume_batch_anchors);
  if (resumeBatchAnchors.length > 0) {
    if (!resumeJobId || (startStage !== 'lesson_staging' && startStage !== 'assessment_staging')) {
      throw new Error('resume_batch_anchors requires a model-stage job resume.');
    }
    command.push('--resume-batch-anchors', JSON.stringify(resumeBatchAnchors));
  }
  if (resumeJobId) command.push('--resume-existing-job');
  if (body.prepare_only) command.push('--prepare-only');
  return command;
}

export function failedBatchAnchorsForResume(stage: PipelineJobStage | null): string[] {
  const results = Array.isArray(stage?.progress.results) ? stage.progress.results : [];
  const failedExtractionAnchors = results.flatMap((result) => {
    const record = asRecord(result);
    const exitCode = Number(record.exit_code);
    if (!Number.isFinite(exitCode) || exitCode === 0) return [];
    const anchor = asString(record.batch_anchor);
    return anchor ? [anchor] : [];
  });
  const qualityAttempts = Array.isArray(stage?.progress.attempts) ? stage.progress.attempts : [];
  const failedQualityAnchors = qualityAttempts.flatMap((attempt) => (
    uniqueStrings(asRecord(attempt).blocked_batch_anchors)
  ));
  return uniqueStrings([...failedExtractionAnchors, ...failedQualityAnchors]);
}

export function registerPipelineRoutes(app: Hono, sql: Sql, dbUrl: string, options: PipelineRouteOptions = {}) {
  const runningProcesses = new Map<string, ChildProcess>();
  const processKey = (datasetId: string, jobId: string) => `${datasetId}\u0000${jobId}`;
  const stopProcess = options.stopProcessTree ?? stopPipelineProcessTree;
  app.get('/api/source/:key/pipeline', async (c) => {
    const key = c.req.param('key');
    const datasetRow = await resolveDatasetRow(sql, key);

    if (!datasetRow) {
      return c.json({ error: `Unknown source '${key}'` }, 404);
    }

    const payload = await loadPipelinePayload(sql, datasetRow.dataset_id);
    return c.json(payload);
  });

  app.get('/api/source/:key/pipeline/quality', async (c) => {
    const key = c.req.param('key');
    const datasetRow = await resolveDatasetRow(sql, key);

    if (!datasetRow) {
      return c.json({ error: `Unknown source '${key}'` }, 404);
    }

    return c.json(await loadPipelineQualityPayload(sql, datasetRow.dataset_id));
  });

  app.post('/api/source/:key/pipeline/quality-reviews/:lesson_run_id', async (c) => {
    const key = c.req.param('key');
    const lessonRunId = decodeURIComponent(c.req.param('lesson_run_id'));
    const datasetRow = await resolveDatasetRow(sql, key);
    if (!datasetRow) return c.json({ error: `Unknown source '${key}'` }, 404);

    const body = await c.req.json<PipelineQualityReviewUpdateRequest>().catch(() => null);
    if (!body || (body.action !== 'accept' && body.action !== 'resolved')) {
      return c.json({ error: 'Invalid quality review action.' }, 400);
    }
    const note = typeof body.note === 'string' ? body.note.trim().slice(0, 1000) : '';
    const lessonRows = await sql`
      SELECT properties_json
      FROM world_lesson_runs
      WHERE dataset_id = ${datasetRow.dataset_id}
        AND lesson_run_id = ${lessonRunId}
      LIMIT 1
    `;
    if (!lessonRows.length) return c.json({ error: `Lesson run not found: ${lessonRunId}` }, 404);

    const properties = asRecord((lessonRows[0] as Record<string, unknown>).properties_json);
    if (properties.quality_review_required !== true) {
      return c.json({ error: 'This quality review is no longer pending.' }, 409);
    }

    const reviewedAt = timestamp();
    const updated = await updatePendingQualityReview(sql, {
      datasetId: datasetRow.dataset_id,
      lessonRunId,
      action: body.action,
      note,
      reviewedAt,
    });
    if (!updated) return c.json({ error: 'This quality review is no longer pending.' }, 409);

    const response: PipelineQualityReviewUpdateResponse = {
      status: 'success',
      lesson_run_id: lessonRunId,
      action: body.action,
      reviewed_at: reviewedAt,
    };
    return c.json(response);
  });

  app.post('/api/source/:key/pipeline/upload-pdf', async (c) => {
    let fileName: string;
    try {
      fileName = safePdfUploadName(c.req.header('x-file-name') || '');
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }

    const contentLength = Number(c.req.header('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > MAX_PDF_UPLOAD_BYTES) {
      return c.json({ error: 'PDF exceeds the 512 MB upload limit.' }, 413);
    }
    const body = c.req.raw.body;
    if (!body) return c.json({ error: 'PDF upload body is required.' }, 400);

    const uploadDir = join(REPO_ROOT, 'storage', 'pipeline-uploads', randomUUID());
    const pdfPath = join(uploadDir, fileName);
    try {
      await mkdir(uploadDir, { recursive: true });
      const { sizeBytes, sourceFingerprint } = await savePdfUpload(body, pdfPath);
      const response: PipelinePdfUploadResponse = {
        pdf_path: pdfPath,
        file_name: fileName,
        size_bytes: sizeBytes,
        source_fingerprint: sourceFingerprint,
      };
      return c.json(response, 201);
    } catch (error) {
      await rm(uploadDir, { recursive: true, force: true }).catch(() => undefined);
      const message = (error as Error).message || 'PDF upload failed.';
      return c.json({ error: message }, message.includes('512 MB') ? 413 : 400);
    }
  });

  app.post('/api/source/:key/pipeline/inspect-ocr', async (c) => {
    const body = await c.req.json<PipelineOcrInspectRequest>().catch(() => null);
    if (!body) return c.json({ error: 'Invalid JSON body.' }, 400);
    try {
      return c.json(await inspectOcrFolder(asString(body.folder_path)));
    } catch (error) {
      return c.json({ error: (error as Error).message || 'OCR folder inspection failed.' }, 400);
    }
  });

  app.post('/api/source/:key/pipeline/scan-folder', async (c) => {
    const body = await c.req.json<PipelineFolderScanRequest>().catch(() => null);
    if (!body) return c.json({ error: 'Invalid JSON body.' }, 400);
    try {
      return c.json(await scanPdfFolder(
        asString(body.folder_path),
        body.recursive !== false,
        asString(body.ocr_folder_path),
      ));
    } catch (error) {
      return c.json({ error: (error as Error).message || 'Folder scan failed.' }, 400);
    }
  });

  app.get('/api/source/:key/pipeline/books/:book_id/nodes', async (c) => {
    const key = c.req.param('key');
    const datasetRow = await resolveDatasetRow(sql, key);
    if (!datasetRow) return c.json({ error: `Unknown source '${key}'` }, 404);
    const datasetId = datasetRow.dataset_id;
    const bookId = c.req.param('book_id');
    const limit = pipelineBookNodeLimit(c.req.query('limit'));
    const rows = await sql`
      WITH mapped AS (
        SELECT
          cm.canonical_node_id,
          CASE
            WHEN bool_or(cm.resolution = 'created') THEN 'created'
            WHEN bool_or(cm.resolution = 'review') THEN 'review'
            ELSE 'matched'
          END AS ownership,
          count(DISTINCT lr.lesson_run_id) AS lesson_count
        FROM world_lesson_runs lr
        JOIN world_canonical_node_map cm
          ON cm.dataset_id = lr.dataset_id AND cm.lesson_run_id = lr.lesson_run_id
        WHERE lr.dataset_id = ${datasetId} AND lr.book_id = ${bookId}
        GROUP BY cm.canonical_node_id
      )
      SELECT
        n.id, n.name, n.kind, n.subkind, n.definition, n.status, n.updated_at,
        mapped.ownership, mapped.lesson_count,
        EXISTS (
          SELECT 1
          FROM world_canonical_node_map other_map
          JOIN world_lesson_runs other_lesson
            ON other_lesson.dataset_id = other_map.dataset_id
           AND other_lesson.lesson_run_id = other_map.lesson_run_id
          WHERE other_map.dataset_id = ${datasetId}
            AND other_map.canonical_node_id = n.id
            AND other_lesson.book_id <> ${bookId}
        ) AS shared,
        count(*) OVER() AS total
      FROM mapped
      JOIN world_nodes n ON n.dataset_id = ${datasetId} AND n.id = mapped.canonical_node_id
      ORDER BY mapped.ownership <> 'created', n.kind, n.name
      LIMIT ${limit}
    ` as unknown as Array<Record<string, unknown>>;
    const response: PipelineBookNodesResponse = {
      dataset_id: datasetId,
      book_id: bookId,
      total: Number(rows[0]?.total ?? 0),
      nodes: rows.map((row) => ({
        id: String(row.id),
        name: String(row.name),
        kind: String(row.kind),
        subkind: row.subkind == null ? null : String(row.subkind),
        definition: String(row.definition ?? ''),
        status: String(row.status ?? ''),
        ownership: String(row.ownership) as 'created' | 'review' | 'matched',
        lesson_count: Number(row.lesson_count ?? 0),
        shared: row.shared === true,
        updated_at: row.updated_at == null ? null : String(row.updated_at),
      })),
    };
    return c.json(response);
  });

  app.get('/api/source/:key/pipeline/books/:book_id/outline-preview', async (c) => {
    const key = c.req.param('key');
    const bookId = c.req.param('book_id');
    const datasetRow = await resolveDatasetRow(sql, key);
    if (!datasetRow) return c.json({ error: `Unknown source '${key}'` }, 404);
    const outline = await loadTextbookOutlinePayload(sql, datasetRow.dataset_id, bookId);
    if (!outline) return c.json({ error: `尚未生成教材 '${bookId}' 的切分预览。` }, 404);
    const preview = buildOutlinePreview(datasetRow.dataset_id, bookId, outline);
    const sourceRows = await sql<Record<string, unknown>[]>`
      SELECT source_markdown_path, raw_markdown_path, extract_dir
      FROM world_mineru_sources
      WHERE dataset_id = ${datasetRow.dataset_id} AND book_id = ${bookId}
      LIMIT 1
    `;
    const source = await loadOutlineSource(outline, sourceRows.flatMap((row) => [
      asString(row.source_markdown_path), asString(row.raw_markdown_path), asString(row.extract_dir),
    ]));
    return c.json(source ? attachOutlineChunkPreviews(preview, source.lines) : preview);
  });

  app.get('/api/source/:key/pipeline/books/:book_id/outline-preview/items/:item_id/content', async (c) => {
    const key = c.req.param('key');
    const bookId = c.req.param('book_id');
    const itemId = c.req.param('item_id');
    const datasetRow = await resolveDatasetRow(sql, key);
    if (!datasetRow) return c.json({ error: `Unknown source '${key}'` }, 404);
    const outline = await loadTextbookOutlinePayload(sql, datasetRow.dataset_id, bookId);
    if (!outline) return c.json({ error: `尚未生成教材 '${bookId}' 的切分预览。` }, 404);
    const sourceRows = await sql<Record<string, unknown>[]>`
      SELECT source_markdown_path, raw_markdown_path, extract_dir
      FROM world_mineru_sources
      WHERE dataset_id = ${datasetRow.dataset_id} AND book_id = ${bookId}
      LIMIT 1
    `;
    const source = await loadOutlineSource(outline, sourceRows.flatMap((row) => [
      asString(row.source_markdown_path), asString(row.raw_markdown_path), asString(row.extract_dir),
    ]));
    if (!source) return c.json({ error: '切分源 Markdown 不可读取，暂时无法显示块内容。' }, 404);
    const content = buildOutlineChunkContent(
      buildOutlinePreview(datasetRow.dataset_id, bookId, outline),
      itemId,
      source.lines,
      source.assetBasePath,
    );
    if (!content) return c.json({ error: `未找到切分块 '${itemId}'。` }, 404);
    return c.json(content);
  });

  app.post('/api/source/:key/pipeline/books/:book_id/outline-confirmation', async (c) => {
    const key = c.req.param('key');
    const bookId = c.req.param('book_id');
    const body = await c.req.json<PipelineOutlineConfirmRequest>().catch(() => null);
    if (!body || !asString(body.fingerprint)) return c.json({ error: 'fingerprint is required.' }, 400);
    const datasetRow = await resolveDatasetRow(sql, key);
    if (!datasetRow) return c.json({ error: `Unknown source '${key}'` }, 404);
    const outline = await loadTextbookOutlinePayload(sql, datasetRow.dataset_id, bookId);
    if (!outline) return c.json({ error: `尚未生成教材 '${bookId}' 的切分预览。` }, 404);
    const fingerprint = outlineFingerprint(outline);
    if (fingerprint !== asString(body.fingerprint)) {
      return c.json({ error: '切分结果已经变化，请刷新后重新确认。' }, 409);
    }
    const unmatchedItemIds = unmatchedOutlineItemIds(outline);
    if (unmatchedItemIds.length > 0 && body.allow_unmatched !== true) {
      return c.json({ error: `仍有 ${unmatchedItemIds.length} 个课节未对齐正文；如需继续，请明确允许跳过这些课节。` }, 409);
    }
    const confirmedAt = new Date().toISOString();
    const patch = {
      outline_review: {
        status: 'confirmed',
        fingerprint,
        confirmed_at: confirmedAt,
        confirmed_via: 'viewer',
        confirmed_with_unmatched: unmatchedItemIds.length > 0,
        confirmed_unmatched_item_ids: unmatchedItemIds,
      },
    };
    const rows = await sql<{ book_id: string }[]>`
      UPDATE world_textbook_outlines
      SET outline_json = COALESCE(outline_json, '{}'::jsonb) || ${sql.json(patch)}::jsonb,
          updated_at = ${confirmedAt}
      WHERE dataset_id = ${datasetRow.dataset_id}
        AND book_id = ${bookId}
        AND outline_json = ${sql.json(outline as JsonValue)}::jsonb
      RETURNING book_id
    `;
    if (rows.length !== 1) return c.json({ error: '切分结果在确认时发生变化，请刷新后重试。' }, 409);
    const response: PipelineOutlineConfirmResponse = {
      status: 'confirmed',
      book_id: bookId,
      fingerprint,
      confirmed_at: confirmedAt,
      confirmed_with_unmatched: unmatchedItemIds.length > 0,
      unmatched_item_ids: unmatchedItemIds,
    };
    return c.json(response);
  });

  app.post('/api/source/:key/pipeline/books/:book_id/outline-rejection', async (c) => {
    const key = c.req.param('key');
    const bookId = c.req.param('book_id');
    const body = await c.req.json<PipelineOutlineRejectRequest>().catch(() => null);
    if (!body || !asString(body.fingerprint)) return c.json({ error: 'fingerprint is required.' }, 400);
    const datasetRow = await resolveDatasetRow(sql, key);
    if (!datasetRow) return c.json({ error: `Unknown source '${key}'` }, 404);
    const outline = await loadTextbookOutlinePayload(sql, datasetRow.dataset_id, bookId);
    if (!outline) return c.json({ error: `尚未生成教材 '${bookId}' 的切分预览。` }, 404);
    const fingerprint = outlineFingerprint(outline);
    if (fingerprint !== asString(body.fingerprint)) {
      return c.json({ error: '切分结果已经变化，请刷新后重新审核。' }, 409);
    }
    const rejectedAt = new Date().toISOString();
    const patch = {
      outline_review: {
        status: 'rejected',
        fingerprint,
        rejected_at: rejectedAt,
        rejected_via: 'viewer',
      },
    };
    const rows = await sql<{ book_id: string }[]>`
      UPDATE world_textbook_outlines
      SET outline_json = COALESCE(outline_json, '{}'::jsonb) || ${sql.json(patch)}::jsonb,
          updated_at = ${rejectedAt}
      WHERE dataset_id = ${datasetRow.dataset_id}
        AND book_id = ${bookId}
        AND outline_json = ${sql.json(outline as JsonValue)}::jsonb
      RETURNING book_id
    `;
    if (rows.length !== 1) return c.json({ error: '切分结果在驳回时发生变化，请刷新后重试。' }, 409);
    const response: PipelineOutlineRejectResponse = {
      status: 'rejected',
      book_id: bookId,
      fingerprint,
      rejected_at: rejectedAt,
    };
    return c.json(response);
  });

  app.post('/api/source/:key/pipeline/infer-textbook', async (c) => {
    const key = c.req.param('key');
    const body = await c.req.json<TextbookMetadataRequest>().catch(() => null);
    if (!body) return c.json({ error: 'Invalid JSON body.' }, 400);
    try {
      const sourceFingerprint = await resolveSourceFingerprint(body);
      const fingerprintedBody = sourceFingerprint
        ? { ...body, source_fingerprint: sourceFingerprint }
        : body;
      const datasetRow = await resolveDatasetRow(sql, key);
      const bookId = inferBookId(fingerprintedBody);
      const outline = datasetRow && bookId
        ? await loadTextbookOutlinePayload(sql, datasetRow.dataset_id, bookId)
        : null;
      const inferred = inferTextbookMetadata(fingerprintedBody, outline);
      if (!datasetRow) return c.json(inferred);
      const enrichIndex = await loadEnrichIndexPayload(sql, datasetRow.dataset_id);
      const enrichBookPath = resolveAutomaticEnrichBookPath(enrichIndex, [
        inferred.title,
        asString(body.book_title),
        basename(dirname(asString(body.ocr_folder_path))),
        basename(asString(body.ocr_folder_path)),
        basename(asString(body.pdf_path), extname(asString(body.pdf_path))),
      ]);
      if (!enrichBookPath) return c.json(inferred);
      const enrichBook = (Array.isArray(enrichIndex?.books) ? enrichIndex.books : [])
        .map(asRecord)
        .find((book) => asString(book.path) === enrichBookPath);
      return c.json({
        ...inferred,
        enrich_book_path: enrichBookPath,
        enrich_book_title: asString(enrichBook?.title, basename(enrichBookPath)),
      });
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }
  });

  app.get('/api/source/:key/pipeline/jobs', async (c) => {
    const key = c.req.param('key');
    const datasetRow = await resolveDatasetRow(sql, key);
    if (!datasetRow) {
      return c.json({ error: `Unknown source '${key}'` }, 404);
    }
    return c.json(await loadPipelineJobListPayload(
      sql,
      datasetRow.dataset_id,
      asInt(c.req.query('limit'), 50),
    ));
  });

  app.get('/api/source/:key/pipeline/jobs/:job_id', async (c) => {
    const key = c.req.param('key');
    const datasetRow = await resolveDatasetRow(sql, key);
    if (!datasetRow) {
      return c.json({ error: `Unknown source '${key}'` }, 404);
    }
    return c.json(await loadPipelineJobStatusPayload(sql, datasetRow.dataset_id, c.req.param('job_id')));
  });

  app.post('/api/source/:key/pipeline/jobs/:job_id/stop', async (c) => {
    const key = c.req.param('key');
    const jobId = c.req.param('job_id');
    const datasetRow = await resolveDatasetRow(sql, key);
    if (!datasetRow) return c.json({ error: `Unknown source '${key}'` }, 404);

    const jobStatus = await loadPipelineJobStatusPayload(sql, datasetRow.dataset_id, jobId);
    if (jobStatus.status === 'unknown') return c.json({ error: `Pipeline job '${jobId}' does not exist.` }, 404);
    if (jobStatus.status !== 'running') {
      return c.json({ error: `Pipeline job '${jobId}' is '${jobStatus.status}', not running.` }, 409);
    }

    const tracked = runningProcesses.get(processKey(datasetRow.dataset_id, jobId));
    let pid = tracked?.pid ?? Number(jobStatus.context.process_pid);
    if (!Number.isSafeInteger(pid) || pid <= 1) {
      const jobRoot = resolve(REPO_ROOT, 'runs', 'server-jobs');
      const logPath = resolve(jobStatus.log_path || '');
      if (logPath.startsWith(`${jobRoot}${sep}`)) {
        const logText = await readFile(logPath, 'utf8').catch(() => '');
        pid = latestPipelineProcessPid(logText) ?? 0;
      }
    }
    if (!Number.isSafeInteger(pid) || pid <= 1) {
      return c.json({ error: `Cannot stop '${jobId}' because its process ID is unavailable.` }, 409);
    }

    const stopped = await stopProcess(pid).catch(() => false);
    if (!stopped) {
      return c.json({ error: `Cannot stop '${jobId}' because its process is no longer available.` }, 409);
    }
    const reason = '用户停止了教材处理任务，可从当前步骤继续运行。';
    await markPipelineJobStopped(sql, datasetRow.dataset_id, jobId, reason);
    runningProcesses.delete(processKey(datasetRow.dataset_id, jobId));
    const response: PipelineStopResponse = { job_id: jobId, status: 'stopped', message: reason };
    return c.json(response);
  });

  app.post('/api/source/:key/pipeline/start', async (c) => {
    const key = c.req.param('key');
    const body = await c.req.json<PipelineStartRequest>().catch(() => null);
    if (!body) return c.json({ error: 'Invalid JSON body.' }, 400);

    const requestedResumeJobId = asString(body.resume_job_id);
    if (body.ocr_import_mode === 'in_place' && asString(body.ocr_folder_path)) {
      try {
        const inspection = await inspectOcrFolder(asString(body.ocr_folder_path));
        if (!inspection.markdown_path) {
          return c.json({ error: '原目录模式要求 OCR bundle 自带 Markdown；仅有 content_list_v2 时请使用复制导入。' }, 400);
        }
      } catch (error) {
        return c.json({ error: (error as Error).message || 'OCR folder inspection failed.' }, 400);
      }
    }
    let bookId = resolvePipelineBookId(body);
    if (!bookId && !requestedResumeJobId) {
      return c.json({ error: 'Textbook name, PDF path, OCR folder, MinerU file URL, or book_id is required.' }, 400);
    }
    let jobId = requestedResumeJobId || createPipelineJobId(bookId);
    const jobDir = join(REPO_ROOT, 'runs', 'server-jobs');
    mkdirSync(jobDir, { recursive: true });
    let logPath = join(jobDir, `${safeToken(jobId)}.log`);

    let command: string[];
    let runtimeSnapshot: PipelineRuntimeSnapshot | null = null;
    let datasetKey: string;
    let statusDatasetId: string;
    let resumeDatasetId: string | null = null;
    let effectiveBody = body;
    try {
      const outputRoot = asString(body.output_root, 'data/main');
      datasetKey = asString(body.dataset_id, outputRoot.split('/').filter(Boolean).at(-1) || key || 'main');
      const datasetRow = await resolveDatasetRow(sql, datasetKey);
      statusDatasetId = datasetRow?.dataset_id ?? datasetKey;
      if (requestedResumeJobId) {
        if (body.prepare_only) {
          throw new Error('prepare_only cannot resume an extraction job; start a new preparation job instead.');
        }
        if (!body.start_stage) {
          throw new Error('Resuming an existing job requires start_stage.');
        }
        if (!datasetRow) {
          throw new Error(`Cannot resume job '${requestedResumeJobId}' because dataset '${datasetKey}' does not exist.`);
        }
        const existingJob = await loadPipelineJobStatusPayload(sql, datasetRow.dataset_id, requestedResumeJobId);
        if (existingJob.status === 'unknown') {
          throw new Error(`Pipeline job '${requestedResumeJobId}' does not exist in dataset '${datasetKey}'.`);
        }
        if (existingJob.status !== 'blocked') {
          throw new Error(`Pipeline job '${requestedResumeJobId}' is '${existingJob.status}', not blocked.`);
        }
        const requestedBookId = asString(body.book_id);
        if (requestedBookId && existingJob.book_id !== requestedBookId) {
          throw new Error(
            `Pipeline job '${requestedResumeJobId}' belongs to book '${existingJob.book_id}', not '${requestedBookId}'.`,
          );
        }
        bookId = existingJob.book_id;
        jobId = existingJob.job_id;
        logPath = existingJob.log_path || logPath;
        resumeDatasetId = datasetRow.dataset_id;
        effectiveBody = restoreResumeSourceSettings(
          restoreResumeEnrichSettings(body, existingJob.context),
          existingJob.context,
        );
        effectiveBody = { ...effectiveBody, book_id: existingJob.book_id };
        if (body.start_stage === 'lesson_staging' || body.start_stage === 'assessment_staging') {
          const failedBatchAnchors = failedBatchAnchorsForResume(existingJob.current_stage);
          if (failedBatchAnchors.length === 0) {
            throw new Error(`Cannot resume '${requestedResumeJobId}' at '${body.start_stage}': no failed units were recorded for selective retry.`);
          }
          effectiveBody = { ...effectiveBody, resume_batch_anchors: failedBatchAnchors };
        } else {
          effectiveBody = { ...effectiveBody, resume_batch_anchors: undefined };
        }
      }
      if (!requestedResumeJobId && effectiveBody.enrich_context !== false && !asString(effectiveBody.enrich_book_path) && datasetRow) {
        const enrichIndex = await loadEnrichIndexPayload(sql, datasetRow.dataset_id);
        const automaticEnrichBookPath = resolveAutomaticEnrichBookPath(enrichIndex, [
          asString(effectiveBody.book_title),
          basename(dirname(asString(effectiveBody.ocr_folder_path))),
          basename(asString(effectiveBody.ocr_folder_path)),
          basename(asString(effectiveBody.pdf_path), extname(asString(effectiveBody.pdf_path))),
        ]);
        if (automaticEnrichBookPath) {
          effectiveBody = {
            ...effectiveBody,
            enrich_context: true,
            enrich_book_path: automaticEnrichBookPath,
          };
        }
      }
      const enrichBookPath = asString(effectiveBody.enrich_book_path);
      if (enrichBookPath && shouldValidateEnrichBook(effectiveBody)) {
        if (!datasetRow) {
          throw new Error(`无法选择参考教材目录，因为数据集 '${datasetKey}' 不存在。`);
        }
        const enrichBook = await loadEnrichBookPayload(sql, datasetRow.dataset_id, enrichBookPath);
        if (!enrichBook) {
          throw new Error(`所选参考教材目录 '${enrichBookPath}' 不在数据集 '${datasetKey}' 中。`);
        }
      }
      const outline = datasetRow ? await loadTextbookOutlinePayload(sql, datasetRow.dataset_id, bookId) : null;
      if (!effectiveBody.prepare_only && !requestedResumeJobId) {
        assertOutlineConfirmed(outline, asString(effectiveBody.outline_confirmation));
        effectiveBody = { ...effectiveBody, start_stage: effectiveBody.start_stage ?? 'lesson_plan' };
      }
      command = buildPipelineCommand(effectiveBody, jobId, logPath, dbUrl, outline);
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }

    if (resumeDatasetId) {
      const claimed = await claimPipelineJobResume(sql, resumeDatasetId, jobId);
      if (!claimed) {
        return c.json({
          error: `Cannot resume '${jobId}': it is no longer blocked, this book already has a running job, or the dataset has reached its ${MAX_ACTIVE_PIPELINE_JOBS}-job limit.`,
        }, 409);
      }
    } else {
      const reserved = await reservePipelineJobStart(sql, {
        datasetId: statusDatasetId,
        jobId,
        bookId,
        bookTitle: asString(body.book_title, bookId),
        logPath,
        enrichContext: effectiveBody.enrich_context,
        enrichBookPath: asString(effectiveBody.enrich_book_path),
        ocrFolderPath: asString(effectiveBody.ocr_folder_path)
          ? resolve(REPO_ROOT, asString(effectiveBody.ocr_folder_path))
          : undefined,
        prepareOnly: effectiveBody.prepare_only,
      });
      if (!reserved) {
        return c.json({
          error: `Cannot start '${jobId}': this book already has a running job, the dataset has reached its ${MAX_ACTIVE_PIPELINE_JOBS}-job limit, or the job ID already exists.`,
        }, 409);
      }
    }

    try {
      runtimeSnapshot = await createPipelineRuntimeSnapshot(jobId);
      command[1] = runtimeSnapshot.entry_path;
    } catch (error) {
      const message = `Failed to prepare an isolated pipeline runtime: ${(error as Error).message}`;
      await markPipelineProcessFailed(sql, statusDatasetId, jobId, message);
      return c.json({ error: message }, 500);
    }
    const cleanupPipelineRuntime = async () => {
      const runtimeDir = runtimeSnapshot?.runtime_dir;
      runtimeSnapshot = null;
      if (runtimeDir) await rm(runtimeDir, { recursive: true, force: true });
    };

    const startedAt = Date.now();
    const targetDatabase = databaseTarget(dbUrl);
    logPipelineEvent('info', 'starting', {
      jobId,
      bookId,
      datasetId: datasetKey,
      database: targetDatabase,
      logPath,
    });
    const logStream = createWriteStream(logPath, { flags: 'a' });
    logStream.write(
      `[${timestamp()}] [pipeline] starting job=${jobId} book=${bookId} dataset=${datasetKey} database=${targetDatabase}\n`
      + `$ ${redactCommand(command)}\n\n`,
    );
    const vlmApiKey = asString(body.vlm_api_key);
    const invocation = {
      command: command[0]!,
      args: command.slice(1),
    };

    const child = spawn(invocation.command, invocation.args, {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        OKM_REPO_ROOT: REPO_ROOT,
        DATABASE_URL: dbUrl,
        ...(vlmApiKey ? { VLM_API_KEY: vlmApiKey } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      windowsHide: true,
    });
    child.stdout.pipe(logStream, { end: false });
    child.stderr.pipe(logStream, { end: false });
    let logEnded = false;
    const endLog = (message: string) => {
      if (logEnded) return;
      logEnded = true;
      logStream.end(message);
    };
    try {
      await waitForSpawn(child, (error) => {
        logPipelineEvent('error', 'spawn-error', {
          jobId,
          message: error.message,
          durationMs: Date.now() - startedAt,
        });
        endLog(`\n[${timestamp()}] [pipeline] spawn-error message=${JSON.stringify(error.message)}\n`);
      });
    } catch (error) {
      await cleanupPipelineRuntime().catch(() => undefined);
      await markPipelineProcessFailed(
        sql,
        statusDatasetId,
        jobId,
        `Failed to start pipeline process: ${(error as Error).message}`,
      );
      return c.json({ error: `Failed to start pipeline: ${(error as Error).message}` }, 500);
    }
    logPipelineEvent('info', 'spawned', {
      jobId,
      pid: child.pid ?? null,
      database: targetDatabase,
    });
    logStream.write(`[${timestamp()}] [pipeline] spawned pid=${child.pid ?? 'unknown'}\n\n`);
    runningProcesses.set(processKey(statusDatasetId, jobId), child);
    if (child.pid) {
      await sql`
        UPDATE world_pipeline_jobs
        SET context_json = COALESCE(context_json, '{}'::jsonb) || ${sql.json({
          process_pid: child.pid,
          process_started_at: new Date(startedAt).toISOString(),
        })}::jsonb
        WHERE dataset_id = ${statusDatasetId} AND job_id = ${jobId} AND status = 'running'
      `.catch((error) => {
        logPipelineEvent('error', 'process-pid-status-update-error', {
          jobId,
          message: (error as Error).message,
        });
      });
    }
    child.on('close', (code, signal) => {
      if (runningProcesses.get(processKey(statusDatasetId, jobId)) === child) {
        runningProcesses.delete(processKey(statusDatasetId, jobId));
      }
      const durationMs = Date.now() - startedAt;
      const event = code === 0 ? 'completed' : 'failed';
      const details = {
        jobId,
        exitCode: code,
        signal,
        durationMs,
        logPath,
      };
      logPipelineEvent(code === 0 ? 'info' : 'error', event, details);
      endLog(
        `\n[${timestamp()}] [pipeline] ${event} exitCode=${code ?? 'unknown'}`
        + ` signal=${signal ?? 'none'} durationMs=${durationMs}\n`,
      );
      if (code !== 0) {
        const processError = `Pipeline process exited with code ${code ?? 'unknown'}${signal ? ` (${signal})` : ''}.`;
        void markPipelineProcessFailed(sql, statusDatasetId, jobId, processError).catch((error) => {
          logPipelineEvent('error', 'status-update-error', {
            jobId,
            message: (error as Error).message,
          });
        });
      }
      void cleanupPipelineRuntime().catch((error) => {
        logPipelineEvent('error', 'runtime-cleanup-error', {
          jobId,
          message: (error as Error).message,
        });
      });
    });
    child.unref();

    const response: PipelineStartResponse = {
      job_id: jobId,
      status: 'started',
      command,
      log_path: logPath,
    };
    return c.json(response);
  });
}
