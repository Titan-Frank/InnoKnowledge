import type { Hono } from 'hono';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import type {
  PipelineStartRequest, PipelineStartResponse,
  TextbookMetadataRequest, TextbookMetadataResponse,
} from '@okm/types';
import type { Sql } from '../db/connection.js';
import { resolveDatasetRow, loadPipelinePayload, loadPipelineJobStatusPayload, loadTextbookOutlinePayload } from '../db/queries.js';
import { loadPipelineQualityPayload } from '../db/quality-dashboard.js';
import { DEFAULT_DATABASE_URL, REPO_ROOT } from '../utils/paths.js';

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
  if (subject === 'physics' || subject === 'chemistry' || subject === 'biology') return `textbook/${subject}`;
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

function buildPipelineCommand(
  body: PipelineStartRequest,
  jobId: string,
  logPath: string,
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
    process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
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
  return command;
}

export function registerPipelineRoutes(app: Hono, sql: Sql) {
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

    const jobId = `${safeToken(bookId)}.${Date.now()}`;
    const jobDir = join(REPO_ROOT, 'runs', 'server-jobs');
    mkdirSync(jobDir, { recursive: true });
    const logPath = join(jobDir, `${jobId}.log`);

    let command: string[];
    try {
      const outputRoot = asString(body.output_root, 'data/main');
      const datasetKey = asString(body.dataset_id, outputRoot.split('/').filter(Boolean).at(-1) || key || 'main');
      const datasetRow = await resolveDatasetRow(sql, datasetKey);
      const outline = datasetRow ? await loadTextbookOutlinePayload(sql, datasetRow.dataset_id, bookId) : null;
      command = buildPipelineCommand(body, jobId, logPath, outline);
    } catch (error) {
      return c.json({ error: (error as Error).message }, 400);
    }

    const logStream = createWriteStream(logPath, { flags: 'a' });
    logStream.write(`$ ${command.join(' ')}\n\n`);
    const vlmApiKey = asString(body.vlm_api_key);

    const child = spawn(command[0], command.slice(1), {
      cwd: REPO_ROOT,
      env: {
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL || DEFAULT_DATABASE_URL,
        ...(vlmApiKey ? { VLM_API_KEY: vlmApiKey } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    });
    child.stdout.pipe(logStream, { end: false });
    child.stderr.pipe(logStream, { end: false });
    child.on('close', (code) => {
      logStream.write(`\n[exit ${code ?? 'unknown'}]\n`);
      logStream.end();
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
