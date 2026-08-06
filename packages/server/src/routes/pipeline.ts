import type { Hono } from 'hono';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream, mkdirSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline as streamPipeline } from 'node:stream/promises';
import type {
  PipelinePdfUploadResponse, PipelineStartRequest, PipelineStartResponse, PipelineStartStage,
  TextbookMetadataRequest, TextbookMetadataResponse,
} from '@okm/types';
import type { Sql } from '../db/connection.js';
import {
  resolveDatasetRow,
  loadPipelinePayload,
  loadPipelineJobListPayload,
  loadPipelineJobStatusPayload,
  loadTextbookOutlinePayload,
} from '../db/queries.js';
import { loadPipelineQualityPayload } from '../db/quality-dashboard.js';
import { REPO_ROOT } from '../utils/paths.js';

interface CommandInvocation {
  command: string;
  args: string[];
}

const MAX_PDF_UPLOAD_BYTES = 512 * 1024 * 1024;

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
  'normalize',
  'node_bodies',
  'pedagogical_profiles',
  'node_embeddings',
  'unit_embeddings',
  'strict_qa',
  'graph_integrity',
  'quality_dashboard',
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

export async function claimPipelineJobResume(
  sql: Sql,
  datasetId: string,
  jobId: string,
): Promise<boolean> {
  const now = new Date().toISOString();
  const rows = await sql<{ job_id: string }[]>`
    UPDATE world_pipeline_jobs
    SET status = 'running',
        error = NULL,
        completed_at = NULL,
        updated_at = ${now}
    WHERE dataset_id = ${datasetId}
      AND job_id = ${jobId}
      AND status = 'blocked'
    RETURNING job_id
  `;
  if (rows.length !== 1) return false;

  try {
    await sql`
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
    await sql`
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
  } catch (error) {
    await sql`
      UPDATE world_pipeline_jobs
      SET status = 'blocked',
          error = ${`Failed to prepare job retry: ${(error as Error).message}`},
          completed_at = ${now},
          updated_at = ${now}
      WHERE dataset_id = ${datasetId}
        AND job_id = ${jobId}
        AND status = 'running'
    `;
    throw error;
  }
  return true;
}

function safeToken(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '__').replace(/^_+|_+$/g, '') || 'job';
}

function asString(value: unknown, fallback = ''): string {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
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

async function savePdfUpload(body: ReadableStream<Uint8Array>, destination: string): Promise<number> {
  let sizeBytes = 0;
  let signature = Buffer.alloc(0);
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      sizeBytes += chunk.length;
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
  return sizeBytes;
}

function generatedBookId(value: string): string {
  const ascii = sourceStem(value)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-');
  if (ascii.length >= 3) return ascii;
  const digest = createHash('sha1').update(value).digest('hex').slice(0, 8);
  return `textbook-${digest}`;
}

function inferBookId(input: { book_id?: unknown; pdf_path?: unknown; mineru_file_url?: unknown }): string {
  const explicit = asString(input.book_id);
  if (explicit) return explicit;
  const source = asString(input.pdf_path) || asString(input.mineru_file_url);
  return source ? generatedBookId(source) : '';
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
): TextbookMetadataResponse {
  const bookId = inferBookId(input);
  if (!bookId) throw new Error('PDF path, MinerU file URL, or book_id is required.');
  const sourcePath = asString(input.pdf_path) || asString(input.mineru_file_url);
  const pdfName = sourcePath ? sourceName(sourcePath) : '';
  let outlineText = '';
  if (outline) {
    outlineText = JSON.stringify({
      title: outline.title,
      book_title: outline.book_title,
      structure: Array.isArray(outline.structure) ? outline.structure.slice(0, 12) : outline.items,
    });
  }

  const rawHaystack = `${bookId} ${pdfName} ${outlineText}`;
  const haystack = rawHaystack.toLowerCase();
  const signals: string[] = [];
  let subject = 'general';
  let schoolStage = 'higher';
  let gradeBand = 'unknown';
  let title = pdfName.replace(/\.[^.]+$/, '') || bookId;
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
): string[] {
  const bookId = inferBookId(body);
  if (!bookId) throw new Error('PDF path, MinerU file URL, or book_id is required.');
  const inferred = inferTextbookMetadata({ book_id: bookId, pdf_path: body.pdf_path, mineru_file_url: body.mineru_file_url }, outline);

  const outputRoot = asString(body.output_root, 'data/main');
  const datasetId = asString(body.dataset_id, outputRoot.split('/').filter(Boolean).at(-1) || 'main');
  const lessonBackendKind = parseLessonBackendKind(body.lesson_backend_kind);
  const command = [
    'npm',
    'run',
    'server-pipeline-run',
    '-w',
    'packages/pipeline',
    '--',
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
  const startStage = asString(body.start_stage);
  const resumeJobId = asString(body.resume_job_id);
  if (resumeJobId && !startStage) {
    throw new Error('resume_job_id requires start_stage.');
  }
  if (startStage) {
    if (!PIPELINE_START_STAGES.has(startStage as PipelineStartStage)) {
      throw new Error(`Unknown pipeline start stage '${startStage}'.`);
    }
    command.push('--start-stage', startStage);
  }
  if (resumeJobId) command.push('--resume-existing-job');
  return command;
}

export function registerPipelineRoutes(app: Hono, sql: Sql, dbUrl: string) {
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
      const sizeBytes = await savePdfUpload(body, pdfPath);
      const response: PipelinePdfUploadResponse = {
        pdf_path: pdfPath,
        file_name: fileName,
        size_bytes: sizeBytes,
      };
      return c.json(response, 201);
    } catch (error) {
      await rm(uploadDir, { recursive: true, force: true }).catch(() => undefined);
      const message = (error as Error).message || 'PDF upload failed.';
      return c.json({ error: message }, message.includes('512 MB') ? 413 : 400);
    }
  });

  app.post('/api/source/:key/pipeline/infer-textbook', async (c) => {
    const key = c.req.param('key');
    const body = await c.req.json<TextbookMetadataRequest>().catch(() => null);
    if (!body) return c.json({ error: 'Invalid JSON body.' }, 400);
    try {
      const datasetRow = await resolveDatasetRow(sql, key);
      const bookId = inferBookId(body);
      const outline = datasetRow && bookId
        ? await loadTextbookOutlinePayload(sql, datasetRow.dataset_id, bookId)
        : null;
      return c.json(inferTextbookMetadata(body, outline));
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

  app.post('/api/source/:key/pipeline/start', async (c) => {
    const key = c.req.param('key');
    const body = await c.req.json<PipelineStartRequest>().catch(() => null);
    if (!body) return c.json({ error: 'Invalid JSON body.' }, 400);

    const bookId = inferBookId(body);
    if (!bookId) return c.json({ error: 'PDF path, MinerU file URL, or book_id is required.' }, 400);

    const requestedResumeJobId = asString(body.resume_job_id);
    let jobId = requestedResumeJobId || `${safeToken(bookId)}.${Date.now()}`;
    const jobDir = join(REPO_ROOT, 'runs', 'server-jobs');
    mkdirSync(jobDir, { recursive: true });
    let logPath = join(jobDir, `${safeToken(jobId)}.log`);

    let command: string[];
    let datasetKey: string;
    let statusDatasetId: string;
    let resumeDatasetId: string | null = null;
    try {
      const outputRoot = asString(body.output_root, 'data/main');
      datasetKey = asString(body.dataset_id, outputRoot.split('/').filter(Boolean).at(-1) || key || 'main');
      const datasetRow = await resolveDatasetRow(sql, datasetKey);
      statusDatasetId = datasetRow?.dataset_id ?? datasetKey;
      if (requestedResumeJobId) {
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
        if (existingJob.book_id !== bookId) {
          throw new Error(
            `Pipeline job '${requestedResumeJobId}' belongs to book '${existingJob.book_id}', not '${bookId}'.`,
          );
        }
        jobId = existingJob.job_id;
        logPath = existingJob.log_path || logPath;
        resumeDatasetId = datasetRow.dataset_id;
      }
      const outline = datasetRow ? await loadTextbookOutlinePayload(sql, datasetRow.dataset_id, bookId) : null;
      command = buildPipelineCommand(body, jobId, logPath, dbUrl, outline);
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }

    if (resumeDatasetId) {
      const claimed = await claimPipelineJobResume(sql, resumeDatasetId, jobId);
      if (!claimed) {
        return c.json({ error: `Pipeline job '${jobId}' is no longer blocked and cannot be resumed.` }, 409);
      }
    }

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
    const invocation = resolveNpmInvocation(command.slice(1));

    const child = spawn(invocation.command, invocation.args, {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
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
      if (resumeDatasetId) {
        await markPipelineProcessFailed(
          sql,
          resumeDatasetId,
          jobId,
          `Failed to restart pipeline process: ${(error as Error).message}`,
        );
      }
      return c.json({ error: `Failed to start pipeline: ${(error as Error).message}` }, 500);
    }
    logPipelineEvent('info', 'spawned', {
      jobId,
      pid: child.pid ?? null,
      database: targetDatabase,
    });
    logStream.write(`[${timestamp()}] [pipeline] spawned pid=${child.pid ?? 'unknown'}\n\n`);
    child.on('close', (code, signal) => {
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
