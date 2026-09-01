import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { Hono } from 'hono';
import type { PipelinePdfUploadResponse, PipelineStopResponse } from '@okm/types';
import type { Sql } from '../db/connection.js';
import { DATASET_ADVISORY_LOCK_SQL } from '../db/dataset-lock.js';
import {
  applyQualityReviewAction,
  assertOutlineConfirmed,
  attachOutlineChunkPreviews,
  buildOutlineChunkContent,
  buildOutlinePreview,
  buildPipelineCommand,
  claimPipelineJobResume,
  createPipelineJobId,
  failedBatchAnchorsForResume,
  generatedBookId,
  inferBookId,
  inspectOcrFolder,
  latestPipelineProcessPid,
  markPipelineJobStopped,
  MAX_ACTIVE_PIPELINE_JOBS,
  pipelineBookNodeLimit,
  outlineFingerprint,
  qualityReviewPatch,
  redactCommand,
  registerPipelineRoutes,
  reservePipelineJobStart,
  resolveAutomaticEnrichBookPath,
  resolvePipelineBookId,
  restoreResumeEnrichSettings,
  restoreResumeSourceSettings,
  resolveNpmInvocation,
  scanPdfFolder,
  safePdfUploadName,
  safeToken,
  shouldValidateEnrichBook,
  updatePendingQualityReview,
} from './pipeline.js';

test('automatic Enrich matching requires one exact normalized textbook identity', () => {
  const index = {
    books: [
      {
        path: 'data/enrich/数学/初中_七年级_数学_人教版_上册_enriched.json',
        filename: '初中_七年级_数学_人教版_上册_enriched.json',
        title: '初中 · 七年级 · 数学 · 人教版 · 上册',
      },
      {
        path: 'data/enrich/数学/初中_七年级_数学_人教版_下册_enriched.json',
        filename: '初中_七年级_数学_人教版_下册_enriched.json',
        title: '初中 · 七年级 · 数学 · 人教版 · 下册',
      },
    ],
  };

  assert.equal(
    resolveAutomaticEnrichBookPath(index, ['初中_七年级_数学_人教版_上册']),
    'data/enrich/数学/初中_七年级_数学_人教版_上册_enriched.json',
  );
  assert.equal(resolveAutomaticEnrichBookPath(index, ['初中_七年级_数学_人教版']), null);
  assert.equal(resolveAutomaticEnrichBookPath({ books: [index.books[0], index.books[0]] }, ['初中_七年级_数学_人教版_上册']), null);
});

test('outline preview exposes hierarchy, ranges, fingerprint, and confirmation state', () => {
  const outline = {
    title: '七年级数学',
    source_kind: 'enrich',
    source_ref: 'data/enrich/math.json',
    source_path: 'data/mineru/math/full.md',
    toc_pages: { start: 5, end: 7 },
    items: [
      { id: 'theme-1', kind: 'theme', title: '第一章', order_path: '1', page_start: 8, page_end: 20, md_start: 10, md_end: 100 },
      { id: 'lesson-1', kind: 'lesson', parent_id: 'theme-1', title: '1.1 正数', order_path: '1.1', page_start: 9, page_end: 12, md_start: 20, md_end: 60 },
      { id: 'chunk-1', kind: 'chunk', parent_id: 'lesson-1', title: '1.1 正数', content_role: 'summary', order_path: '1.1-a', page_start: 9, page_end: 12, md_start: 20, md_end: 60, source_ids: ['lesson-1'] },
    ],
  };
  const fingerprint = outlineFingerprint(outline);
  const pending = buildOutlinePreview('main', 'math-7', outline);

  assert.equal(fingerprint.length, 64);
  assert.equal(pending.review_status, 'pending');
  assert.deepEqual(pending.toc_pages, { start: 5, end: 7 });
  assert.deepEqual(pending.summary, {
    themes: 1,
    topics: 0,
    lessons: 1,
    chunks: 1,
    knowledge_chunks: 0,
    summary_chunks: 1,
    assessment_chunks: 0,
    pages: 13,
  });
  assert.equal(pending.items[2]?.content_role, 'summary');
  assert.deepEqual(pending.items.map((item) => [item.id, item.depth]), [
    ['theme-1', 0],
    ['lesson-1', 1],
    ['chunk-1', 2],
  ]);

  const confirmedOutline = {
    ...outline,
    outline_review: { status: 'confirmed', fingerprint, confirmed_at: '2026-08-27T12:00:00.000Z' },
  };
  assert.equal(buildOutlinePreview('main', 'math-7', confirmedOutline).review_status, 'confirmed');
  assert.doesNotThrow(() => assertOutlineConfirmed(confirmedOutline, fingerprint));
  assert.throws(() => assertOutlineConfirmed(outline, fingerprint), /尚未人工确认/);
  assert.throws(() => assertOutlineConfirmed(confirmedOutline, 'stale'), /已经变化/);
  assert.notEqual(outlineFingerprint({ ...outline, items: outline.items.map((item, index) => index === 2 ? { ...item, md_end: 61 } : item) }), fingerprint);
  assert.notEqual(outlineFingerprint({ ...outline, items: outline.items.map((item, index) => index === 2 ? { ...item, content_role: 'assessment' } : item) }), fingerprint);
});

test('outline chunk preview exposes a compact hover excerpt and full on-demand content', () => {
  const outline = {
    title: '七年级数学',
    source_path: 'data/mineru/math/full.md',
    items: [
      { id: 'lesson-1', kind: 'lesson', title: '1.1 正数', md_start: 1, md_end: 4 },
      { id: 'chunk-1', kind: 'chunk', parent_id: 'lesson-1', title: '正数 — 引入', order_path: '1.1-a', md_start: 2, md_end: 4, source_ids: ['lesson-1'] },
    ],
  };
  const sourceLines = ['# 1.1 正数', '## 引入', '正数大于零。', '![数轴](images/axis.png)', '不属于本块'];
  const preview = attachOutlineChunkPreviews(buildOutlinePreview('main', 'math-7', outline), sourceLines);
  const chunk = preview.items.find((item) => item.id === 'chunk-1');

  assert.equal(chunk?.preview_text, '## 引入 正数大于零。 [图片]');
  assert.equal(chunk?.line_count, 3);
  assert.deepEqual(buildOutlineChunkContent(preview, 'chunk-1', sourceLines, 'data/mineru/math'), {
    id: 'chunk-1',
    title: '正数 — 引入',
    content_role: null,
    page_start: null,
    page_end: null,
    md_start: 2,
    md_end: 4,
    line_count: 3,
    character_count: 35,
    source_ids: ['lesson-1'],
    asset_base_path: 'data/mineru/math',
    content: '## 引入\n正数大于零。\n![数轴](images/axis.png)',
    truncated: false,
  });
  assert.equal(buildOutlineChunkContent(preview, 'lesson-1', sourceLines), null);
});

test('prepare-only command stops before model extraction', () => {
  const command = buildPipelineCommand({
    book_id: 'math-7',
    book_title: '七年级数学',
    dataset_id: 'main',
    output_root: 'data/main',
    prepare_only: true,
  }, 'job-1', '/tmp/job-1.log', 'postgresql://okm:okm@localhost:5432/knowledge');
  assert.equal(command.includes('--prepare-only'), true);
  assert.throws(() => buildPipelineCommand({
    book_id: 'math-7',
    prepare_only: true,
    start_stage: 'lesson_plan',
  }, 'job-2', '/tmp/job-2.log', 'postgresql://okm:okm@localhost:5432/knowledge'), /prepare_only cannot start/);
});

test('quality review action closes the pending flag and preserves review evidence', () => {
  const next = applyQualityReviewAction({
    quality_review_required: true,
    review_node_ids: ['node-a'],
    quality_warnings: ['Node node-a has no staged relations.'],
  }, 'accept', '确认允许保持孤立', '2026-08-26T04:00:00.000Z');

  assert.equal(next.quality_review_required, false);
  assert.equal(next.quality_review_status, 'accepted');
  assert.equal(next.quality_review_note, '确认允许保持孤立');
  assert.deepEqual(next.review_node_ids, ['node-a']);
  assert.deepEqual(next.quality_warnings, ['Node node-a has no staged relations.']);
});

test('quality review patch contains only atomic review metadata', () => {
  assert.deepEqual(qualityReviewPatch('resolved', '已修正', '2026-08-26T04:05:00.000Z'), {
    quality_review_required: false,
    quality_review_status: 'resolved',
    quality_review_note: '已修正',
    quality_reviewed_at: '2026-08-26T04:05:00.000Z',
    quality_reviewed_via: 'viewer',
  });
});

test('quality review update merges review metadata into the current JSONB value', async () => {
  let statement = '';
  let parameters: unknown[] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    statement = strings.join(' ').replace(/\s+/g, ' ').trim();
    parameters = values;
    return Promise.resolve([{ lesson_run_id: 'lesson-1' }]);
  }) as unknown as Sql;
  sql.json = ((value: unknown) => value) as Sql['json'];

  assert.equal(await updatePendingQualityReview(sql, {
    datasetId: 'main',
    lessonRunId: 'lesson-1',
    action: 'accept',
    note: '确认接受',
    reviewedAt: '2026-08-26T04:10:00.000Z',
  }), true);
  assert.match(statement, /COALESCE\(properties_json, '\{\}'::jsonb\) \|\| .*::jsonb/);
  assert.deepEqual(parameters.find((value) => (
    value != null && typeof value === 'object' && 'quality_review_status' in value
  )), qualityReviewPatch('accept', '确认接受', '2026-08-26T04:10:00.000Z'));
});

test('textbook IDs combine a readable name with a stable collision-resistant suffix', () => {
  assert.equal(
    inferBookId({ book_title: '高中物理 必修 第一册', pdf_path: '/tmp/random-a/book.pdf' }),
    inferBookId({ book_title: '高中物理 必修 第一册', pdf_path: '/tmp/random-b/renamed.pdf' }),
  );
  assert.equal(
    inferBookId({ pdf_path: '/tmp/upload-a/八年级化学.pdf' }),
    inferBookId({ pdf_path: '/tmp/upload-b/八年级化学.pdf' }),
  );
  assert.equal(generatedBookId('Chemistry Grade 8'), 'chemistry-grade-8-170e5d4725c0');
  assert.equal(generatedBookId('数学'), '数学-872c1fa141b5');
  assert.equal(generatedBookId('高中物理 必修 第一册'), '高中物理-必修-第一册-8467fadd00f3');
  assert.equal(generatedBookId('初中_七年级_数学_人教版_上册'), '初中-七年级-数学-人教版-上册-82c1289c80ac');
  assert.notEqual(
    generatedBookId('高中物理：必修第一册'),
    generatedBookId('高中物理/必修第一册'),
  );
  assert.equal(
    generatedBookId('同名教材', 'same-content'),
    generatedBookId('同名教材', 'same-content'),
  );
  assert.notEqual(
    generatedBookId('同名教材', 'content-a'),
    generatedBookId('同名教材', 'content-b'),
  );
  assert.equal(
    inferBookId({ book_id: '_-_-_-_', book_title: '初中_七年级_数学_人教版_上册' }),
    '初中-七年级-数学-人教版-上册-82c1289c80ac',
  );
  assert.equal(
    inferBookId({ ocr_folder_path: '/data/初中_七年级_数学_人教版_上册/hybrid_ocr' }),
    generatedBookId('初中_七年级_数学_人教版_上册'),
  );
});

test('pipeline job IDs keep readable Chinese book IDs and use a sortable timestamp', () => {
  assert.equal(safeToken(' 初中_七年级/数学：上册 '), '初中_七年级-数学-上册');
  assert.equal(
    createPipelineJobId('初中_七年级_数学_人教版_上册', new Date('2026-08-28T06:07:08.123Z')),
    '初中_七年级_数学_人教版_上册.20260828T060708123Z',
  );
});

test('OCR folder inspection prefers the Markdown plus content_list_v2 combination', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'okm-ocr-folder-'));
  const bundle = join(folder, 'book', 'hybrid_ocr');
  await mkdir(join(bundle, 'images'), { recursive: true });
  await writeFile(join(bundle, 'book.md'), '# 第一章\n正文\n');
  await writeFile(join(bundle, 'book_content_list.json'), JSON.stringify([{ type: 'text', page_idx: 0, text: '正文' }]));
  await writeFile(join(bundle, 'book_content_list_v2.json'), JSON.stringify([
    [{ type: 'title', content: { level: 1, title_content: [{ type: 'text', content: '第一章' }] } }],
    [{ type: 'paragraph', content: { paragraph_content: [{ type: 'text', content: '正文' }] } }],
  ]));
  await writeFile(join(bundle, 'images', 'a.jpg'), 'image');
  try {
    const result = await inspectOcrFolder(folder);
    assert.equal(result.folder_path, await realpath(bundle));
    assert.equal(result.preferred_input, 'markdown_with_v2');
    assert.equal(result.quality, 'complete');
    assert.equal(result.page_count, 2);
    assert.equal(result.block_count, 2);
    assert.equal(result.image_count, 1);
    assert.deepEqual(result.warnings, []);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('OCR folder inspection rejects Markdown-only bundles', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'okm-ocr-markdown-only-'));
  await writeFile(join(folder, 'book.md'), '# 第一章\n正文\n');
  try {
    await assert.rejects(
      inspectOcrFolder(folder),
      /Expected \*_content_list_v2\.json/,
    );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('book node detail limits preserve the 200-row default and cap large requests', () => {
  assert.equal(pipelineBookNodeLimit(undefined), 200);
  assert.equal(pipelineBookNodeLimit('350'), 350);
  assert.equal(pipelineBookNodeLimit('1000'), 500);
  assert.equal(pipelineBookNodeLimit('invalid'), 200);
});

test('safePdfUploadName accepts encoded PDF names and removes path components', () => {
  assert.equal(safePdfUploadName(encodeURIComponent('八年级化学.pdf')), '八年级化学.pdf');
  assert.equal(safePdfUploadName('../../chemistry.pdf'), 'chemistry.pdf');
  assert.throws(() => safePdfUploadName('chemistry.txt'), /Only PDF files/);
  assert.throws(() => safePdfUploadName(''), /Only PDF files/);
});

test('pipeline PDF upload stores a validated file and returns its server path', async () => {
  const app = new Hono();
  const sql = (() => Promise.resolve([])) as unknown as Sql;
  registerPipelineRoutes(app, sql, 'postgresql://okm:okm@localhost:5432/knowledge');

  const response = await app.request('/api/source/main/pipeline/upload-pdf', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/pdf',
      'X-File-Name': encodeURIComponent('八年级化学.pdf'),
    },
    body: '%PDF-1.7\nlocal upload test',
  });
  assert.equal(response.status, 201);
  const payload = await response.json() as PipelinePdfUploadResponse;
  assert.equal(payload.file_name, '八年级化学.pdf');
  assert.equal(payload.size_bytes, 26);
  assert.equal(payload.source_fingerprint, '5fd0d1e720aa65ad8ec2ecc27b10ac4c051b4f8c3d14ec95d28d83b8503fc808');
  assert.match(payload.pdf_path, /storage\/pipeline-uploads\/.+\/八年级化学\.pdf$/);
  await rm(dirname(payload.pdf_path), { recursive: true, force: true });

  const invalidResponse = await app.request('/api/source/main/pipeline/upload-pdf', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/pdf',
      'X-File-Name': 'not-a-pdf.pdf',
    },
    body: 'plain text',
  });
  assert.equal(invalidResponse.status, 400);
  assert.match((await invalidResponse.json() as { error: string }).error, /not a valid PDF/);
});

test('scanPdfFolder discovers nested PDFs and ignores non-PDF files', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'okm-pdf-folder-'));
  await mkdir(join(folder, 'nested'));
  await writeFile(join(folder, 'book-a.pdf'), '%PDF-1.7\nA');
  await writeFile(join(folder, 'notes.txt'), 'not a PDF');
  await writeFile(join(folder, 'nested', 'book-b.PDF'), '%PDF-1.7\nB');
  try {
    const recursive = await scanPdfFolder(folder);
    assert.deepEqual(recursive.files.map((file) => file.relative_path), ['book-a.pdf', join('nested', 'book-b.PDF')]);
    const topLevel = await scanPdfFolder(folder, false);
    assert.deepEqual(topLevel.files.map((file) => file.relative_path), ['book-a.pdf']);
    await assert.rejects(() => scanPdfFolder(join(folder, 'missing')), /does not exist/);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test('scanPdfFolder pairs a sibling subject OCR library by stage and textbook filename', async () => {
  const folder = await mkdtemp(join(tmpdir(), 'okm-subject-library-'));
  const ocrRoot = `${folder}_mineru_hybrid_high_ocr`;
  const textbookName = '初中_七年级_数学_人教版_上册';
  const pdfPath = join(folder, '初中', `${textbookName}.pdf`);
  const bundle = join(ocrRoot, '初中', textbookName, textbookName, 'hybrid_ocr');
  await mkdir(dirname(pdfPath), { recursive: true });
  await mkdir(bundle, { recursive: true });
  await writeFile(pdfPath, '%PDF-1.7\nmath');
  await writeFile(join(bundle, `${textbookName}_content_list_v2.json`), '[]');
  try {
    const result = await scanPdfFolder(folder);
    assert.equal(result.ocr_folder_path, await realpath(ocrRoot));
    assert.equal(result.matched_ocr_count, 1);
    assert.equal(result.files[0]?.ocr_folder_path, await realpath(bundle));
  } finally {
    await rm(folder, { recursive: true, force: true });
    await rm(ocrRoot, { recursive: true, force: true });
  }
});

test('scanPdfFolder discovers mixed-root OCR libraries and reports every book OCR status', async () => {
  const root = await mkdtemp(join(tmpdir(), 'okm-mixed-library-'));
  const textbookName = '高中_数学_人教版_必修第一册';
  const missingName = '高中_数学_人教版_必修第二册';
  const pdfDir = join(root, '数学', '高中');
  const ordinaryBundle = join(root, '数学_mineru_ocr', '高中', textbookName, textbookName, 'ocr');
  const preferredBundle = join(root, '数学_mineru_hybrid_high_ocr', '高中', textbookName, textbookName, 'hybrid_ocr');
  await mkdir(pdfDir, { recursive: true });
  await mkdir(ordinaryBundle, { recursive: true });
  await mkdir(preferredBundle, { recursive: true });
  await writeFile(join(pdfDir, `${textbookName}.pdf`), '%PDF-1.7\nmath-1');
  await writeFile(join(pdfDir, `${missingName}.pdf`), '%PDF-1.7\nmath-2');
  await writeFile(join(ordinaryBundle, `${textbookName}_content_list_v2.json`), '[]');
  await writeFile(join(preferredBundle, `${textbookName}_content_list_v2.json`), '[]');
  try {
    const result = await scanPdfFolder(root);
    assert.equal(result.ocr_folder_paths.length, 2);
    assert.equal(result.matched_ocr_count, 1);
    assert.equal(result.unmatched_ocr_count, 1);
    assert.deepEqual(result.files.map((file) => file.ocr_status).sort(), ['missing', 'ready']);
    assert.equal(
      result.files.find((file) => file.file_name === `${textbookName}.pdf`)?.ocr_folder_path,
      await realpath(preferredBundle),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('resolveNpmInvocation uses the npm CLI inherited from npm', () => {
  assert.deepEqual(
    resolveNpmInvocation(['run', 'build'], {
      env: { npm_execpath: 'D:\\Node\\node_modules\\npm\\bin\\npm-cli.js' },
      execPath: 'D:\\Node\\node.exe',
      platform: 'win32',
    }),
    {
      command: 'D:\\Node\\node.exe',
      args: ['D:\\Node\\node_modules\\npm\\bin\\npm-cli.js', 'run', 'build'],
    },
  );
});

test('resolveNpmInvocation uses cmd.exe for npm.cmd on Windows without npm_execpath', () => {
  assert.deepEqual(
    resolveNpmInvocation(['run', 'build'], {
      env: { ComSpec: 'C:\\Windows\\System32\\cmd.exe' },
      execPath: 'D:\\Node\\node.exe',
      platform: 'win32',
    }),
    {
      command: 'C:\\Windows\\System32\\cmd.exe',
      args: ['/d', '/s', '/c', 'npm.cmd', 'run', 'build'],
    },
  );
});

test('resolveNpmInvocation executes npm directly on non-Windows platforms', () => {
  assert.deepEqual(
    resolveNpmInvocation(['run', 'build'], {
      env: {},
      execPath: '/usr/bin/node',
      platform: 'linux',
    }),
    {
      command: 'npm',
      args: ['run', 'build'],
    },
  );
});

test('buildPipelineCommand uses the Viewer database URL', () => {
  const dbUrl = 'postgresql://okm:okm@127.0.0.1:5432/okm_demo';
  const command = buildPipelineCommand(
    { pdf_path: 'E:\\books\\chemistry.pdf' },
    'chemistry.123',
    'E:\\runs\\chemistry.123.log',
    dbUrl,
  );
  const dbIndex = command.indexOf('--db');

  assert.equal(command[0], process.execPath);
  assert.match(command[1] ?? '', /packages[\\/]pipeline[\\/]dist[\\/]cli[\\/]server-pipeline-run\.js$/);
  assert.notEqual(dbIndex, -1);
  assert.equal(command[dbIndex + 1], dbUrl);
});

test('buildPipelineCommand forwards an imported OCR folder without requiring a PDF', () => {
  const command = buildPipelineCommand(
    { ocr_folder_path: '/data/初中_七年级_数学_人教版_上册/hybrid_ocr' },
    'math.123',
    '/tmp/math.123.log',
    'postgresql://okm:okm@127.0.0.1:5432/knowledge',
  );
  const index = command.indexOf('--ocr-folder-path');
  assert.notEqual(index, -1);
  assert.equal(command[index + 1], '/data/初中_七年级_数学_人教版_上册/hybrid_ocr');
  assert.equal(command.includes('--pdf-path'), false);
});

test('buildPipelineCommand forwards the manual enrich decision', () => {
  const selected = buildPipelineCommand(
    {
      book_id: 'physics',
      enrich_context: true,
      enrich_book_path: 'data/enrich/物理/高中物理必修三.json',
    },
    'physics.123',
    '/tmp/physics.123.log',
    'postgresql://okm:okm@127.0.0.1:5432/knowledge',
  );
  assert.equal(selected[selected.indexOf('--enrich-book-path') + 1], 'data/enrich/物理/高中物理必修三.json');

  const disabled = buildPipelineCommand(
    { book_id: 'physics', enrich_context: false },
    'physics.124',
    '/tmp/physics.124.log',
    'postgresql://okm:okm@127.0.0.1:5432/knowledge',
  );
  assert.equal(disabled[disabled.indexOf('--enrich-context') + 1], 'false');
  assert.throws(() => buildPipelineCommand(
    { book_id: 'physics', enrich_context: false, enrich_book_path: 'data/enrich/physics.json' },
    'physics.125',
    '/tmp/physics.125.log',
    'postgresql://okm:okm@127.0.0.1:5432/knowledge',
  ), /cannot be set/);
});

test('restoreResumeEnrichSettings reuses the blocked job decision', () => {
  const selected = restoreResumeEnrichSettings(
    {
      book_id: 'physics',
      resume_job_id: 'physics.123',
      start_stage: 'lesson_plan',
      enrich_context: false,
      enrich_book_path: 'data/enrich/request-change.json',
    },
    {
      enrich_context: true,
      enrich_book_path: 'data/enrich/locked-book.json',
    },
  );
  assert.equal(selected.enrich_context, true);
  assert.equal(selected.enrich_book_path, 'data/enrich/locked-book.json');

  const disabled = restoreResumeEnrichSettings(
    { book_id: 'physics', enrich_context: true, enrich_book_path: 'data/enrich/new-book.json' },
    { enrich_context: false, enrich_book_path: null },
  );
  assert.equal(disabled.enrich_context, false);
  assert.equal(disabled.enrich_book_path, undefined);

  const legacy = { book_id: 'physics', enrich_context: true };
  assert.equal(restoreResumeEnrichSettings(legacy, {}), legacy);
});

test('restoreResumeSourceSettings reuses the blocked OCR folder', () => {
  const restored = restoreResumeSourceSettings(
    {
      book_id: 'physics',
      resume_job_id: 'physics.123',
      start_stage: 'mineru_source_markdown',
      pdf_path: '/data/request-change.pdf',
      mineru_file_url: 'https://example.com/request-change.pdf',
    },
    {
      source_kind: 'ocr_import',
      ocr_folder_path: '/data/original/hybrid_ocr',
    },
  );
  assert.equal(restored.ocr_folder_path, '/data/original/hybrid_ocr');
  assert.equal(restored.pdf_path, undefined);
  assert.equal(restored.mineru_file_url, undefined);

  const legacy = { book_id: 'physics', pdf_path: '/data/physics.pdf' };
  assert.equal(restoreResumeSourceSettings(legacy, { source_kind: 'ocr_import' }), legacy);
});

test('shouldValidateEnrichBook skips reducer-only resumes', () => {
  assert.equal(shouldValidateEnrichBook({ book_id: 'physics', enrich_book_path: 'data/enrich/physics.json' }), true);
  assert.equal(shouldValidateEnrichBook({
    book_id: 'physics',
    resume_job_id: 'physics.123',
    start_stage: 'lesson_staging',
  }), true);
  assert.equal(shouldValidateEnrichBook({
    book_id: 'physics',
    resume_job_id: 'physics.123',
    start_stage: 'staging_quality',
  }), true);
  assert.equal(shouldValidateEnrichBook({
    book_id: 'physics',
    resume_job_id: 'physics.123',
    start_stage: 'canonical_commit',
  }), false);
});

test('buildPipelineCommand forwards the requested resume stage', () => {
  const command = buildPipelineCommand(
    {
      book_id: 'chemistry',
      start_stage: 'node_bodies',
      resume_job_id: 'chemistry.123',
    },
    'chemistry.123',
    'E:\\runs\\chemistry.123.log',
    'postgresql://okm:okm@127.0.0.1:5432/okm_demo',
  );

  const stageIndex = command.indexOf('--start-stage');
  assert.notEqual(stageIndex, -1);
  assert.equal(command[stageIndex + 1], 'node_bodies');
  assert.equal(command.includes('--resume-existing-job'), true);
  assert.throws(
    () => buildPipelineCommand(
      { book_id: 'chemistry', resume_job_id: 'chemistry.123' },
      'chemistry.123',
      'E:\\runs\\chemistry.123.log',
      'postgresql://okm:okm@127.0.0.1:5432/okm_demo',
    ),
    /requires start_stage/,
  );
  assert.throws(
    () => buildPipelineCommand(
      { book_id: 'chemistry', start_stage: 'unknown' as never },
      'chemistry.124',
      'E:\\runs\\chemistry.124.log',
      'postgresql://okm:okm@127.0.0.1:5432/okm_demo',
    ),
    /Unknown pipeline start stage/,
  );
});

test('resume requests preserve persisted legacy book IDs', () => {
  const legacyBookId = '_-_-_-_';
  const request = {
    book_id: legacyBookId,
    resume_job_id: `${legacyBookId}.123`,
    start_stage: 'lesson_staging' as const,
  };
  assert.equal(resolvePipelineBookId(request), legacyBookId);
  const command = buildPipelineCommand(
    request,
    request.resume_job_id,
    '/tmp/legacy-resume.log',
    'postgresql://okm:okm@127.0.0.1:5432/knowledge',
  );
  assert.equal(command[command.indexOf('--book-id') + 1], legacyBookId);
  assert.equal(command.includes('--resume-existing-job'), true);
});

test('selective model resume forwards only persisted failed batch anchors', () => {
  const failedAnchors = failedBatchAnchorsForResume({
    id: 'lesson_staging',
    status: 'blocked',
    label: '提取课时知识',
    progress: {
      results: [
        { batch_anchor: 'struct:math:chunk:1-a', exit_code: 0 },
        { batch_anchor: 'struct:math:chunk:1-b', exit_code: 2 },
        { batch_anchor: 'struct:math:chunk:1-c', exit_code: 2 },
        { batch_anchor: 'struct:math:chunk:1-c', exit_code: 2 },
      ],
    },
    started_at: null,
    completed_at: null,
    updated_at: null,
  });
  assert.deepEqual(failedAnchors, ['struct:math:chunk:1-b', 'struct:math:chunk:1-c']);

  const command = buildPipelineCommand(
    {
      book_id: 'math',
      start_stage: 'lesson_staging',
      resume_job_id: 'math.123',
      resume_batch_anchors: failedAnchors,
    },
    'math.123',
    '/tmp/math.123.log',
    'postgresql://okm:okm@127.0.0.1:5432/knowledge',
  );
  const anchorsIndex = command.indexOf('--resume-batch-anchors');
  assert.notEqual(anchorsIndex, -1);
  assert.deepEqual(JSON.parse(command[anchorsIndex + 1] ?? '[]'), failedAnchors);
});

test('claimPipelineJobResume reuses one blocked job and resets its runtime state', async () => {
  const statements: string[] = [];
  const parameterSets: unknown[][] = [];
  const unsafeCalls: Array<{ query: string; values: unknown[] }> = [];
  const sql = ((
    strings: TemplateStringsArray,
    ...parameters: unknown[]
  ) => {
    statements.push(strings.join(' '));
    parameterSets.push(parameters);
    return Promise.resolve(statements.length === 1 ? [{ job_id: 'chemistry.123' }] : []);
  }) as unknown as Sql;
  sql.unsafe = (async (query: string, values: unknown[] = []) => {
    unsafeCalls.push({ query, values });
    return [];
  }) as Sql['unsafe'];
  sql.begin = (async (callback: (tx: Sql) => Promise<unknown>) => callback(sql)) as unknown as Sql['begin'];

  assert.equal(await claimPipelineJobResume(sql, 'main', 'chemistry.123'), true);
  assert.deepEqual(unsafeCalls, [{ query: DATASET_ADVISORY_LOCK_SQL, values: ['main'] }]);
  assert.equal(statements.length, 3);
  assert.match(statements[0]!, /UPDATE world_pipeline_jobs/);
  assert.match(statements[0]!, /NOT EXISTS[\s\S]*running\.book_id = target\.book_id/);
  assert.match(statements[0]!, /SELECT COUNT\(\*\)[\s\S]*running\.status = 'running'[\s\S]*</);
  assert.ok(parameterSets[0]?.includes(MAX_ACTIVE_PIPELINE_JOBS));
  assert.match(statements[1]!, /UPDATE world_pipeline_job_stages/);
  assert.match(statements[2]!, /UPDATE world_pipeline_worker_states/);
});

test('claimPipelineJobResume rejects a job that is no longer blocked', async () => {
  let calls = 0;
  const sql = ((
    _strings: TemplateStringsArray,
  ) => {
    calls += 1;
    return Promise.resolve([]);
  }) as unknown as Sql;
  sql.unsafe = (async () => []) as unknown as Sql['unsafe'];
  sql.begin = (async (callback: (tx: Sql) => Promise<unknown>) => callback(sql)) as unknown as Sql['begin'];

  assert.equal(await claimPipelineJobResume(sql, 'main', 'chemistry.123'), false);
  assert.equal(calls, 1);
});

test('latestPipelineProcessPid selects the newest spawned process', () => {
  assert.equal(latestPipelineProcessPid([
    '[pipeline] spawned pid=120',
    '[pipeline] failed exitCode=2',
    '[pipeline] spawned pid=345',
  ].join('\n')), 345);
  assert.equal(latestPipelineProcessPid('[pipeline] spawned pid=unknown'), null);
});

test('markPipelineJobStopped blocks the running stage and workers for resume', async () => {
  const statements: string[] = [];
  const parameters: unknown[][] = [];
  const sql = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    statements.push(strings.join(' '));
    parameters.push(values);
    return Promise.resolve([]);
  }) as unknown as Sql;

  await markPipelineJobStopped(sql, 'main', 'chemistry.123', '用户停止');

  assert.equal(statements.length, 3);
  assert.match(statements[0]!, /UPDATE world_pipeline_worker_states[\s\S]*status = 'failed'/);
  assert.match(statements[1]!, /UPDATE world_pipeline_job_stages[\s\S]*status = 'blocked'/);
  assert.match(statements[2]!, /UPDATE world_pipeline_jobs[\s\S]*status = 'blocked'/);
  assert.ok(parameters.every((values) => values.includes('用户停止')));
});

test('pipeline stop endpoint terminates the recorded process before blocking the job', async () => {
  let stoppedPid = 0;
  const sql = ((strings: TemplateStringsArray) => {
    const statement = strings.join(' ').replace(/\s+/g, ' ').trim();
    if (statement.includes('FROM world_datasets')) return Promise.resolve([{
      dataset_id: 'main',
      version_key: 'main',
      schema_version: 'world-v1.2',
      root_path: '',
      is_active: 1,
    }]);
    if (statement.includes('FROM world_pipeline_jobs') && statement.includes('job_id =')) return Promise.resolve([{
      job_id: 'chemistry.123',
      book_id: 'chemistry',
      status: 'running',
      current_stage_id: 'lesson_staging',
      progress_json: {},
      context_json: { process_pid: 4567 },
      log_path: '/tmp/chemistry.123.log',
      updated_at: null,
      completed_at: null,
      error: null,
    }]);
    if (statement.includes('FROM world_pipeline_job_stages')) return Promise.resolve([]);
    if (statement.includes('FROM world_pipeline_worker_states')) return Promise.resolve([]);
    if (statement.includes('FROM world_pipeline_job_events')) return Promise.resolve([]);
    if (statement.includes('FROM world_textbook_outlines')) return Promise.resolve([]);
    return Promise.resolve([]);
  }) as unknown as Sql;
  const app = new Hono();
  registerPipelineRoutes(app, sql, 'postgresql://okm:okm@localhost:5432/knowledge', {
    stopProcessTree: async (pid) => {
      stoppedPid = pid;
      return true;
    },
  });

  const response = await app.request('/api/source/main/pipeline/jobs/chemistry.123/stop', { method: 'POST' });
  const payload = await response.json() as PipelineStopResponse;

  assert.equal(response.status, 200);
  assert.equal(stoppedPid, 4567);
  assert.equal(payload.status, 'stopped');
  assert.equal(payload.job_id, 'chemistry.123');
});

test('reservePipelineJobStart records a running job under the shared dataset lock', async () => {
  const statements: string[] = [];
  const parameterSets: unknown[][] = [];
  const unsafeCalls: Array<{ query: string; values: unknown[] }> = [];
  const sql = ((strings: TemplateStringsArray, ...parameters: unknown[]) => {
    const statement = strings.join(' ').replace(/\s+/g, ' ').trim();
    statements.push(statement);
    parameterSets.push(parameters);
    return Promise.resolve(statement.includes('INSERT INTO world_pipeline_jobs') ? [{ job_id: 'chemistry.123' }] : []);
  }) as unknown as Sql;
  sql.unsafe = (async (query: string, values: unknown[] = []) => {
    unsafeCalls.push({ query, values });
    return [];
  }) as Sql['unsafe'];
  sql.begin = (async (callback: (tx: Sql) => Promise<unknown>) => callback(sql)) as unknown as Sql['begin'];
  sql.json = ((value: unknown) => value) as Sql['json'];

  assert.equal(await reservePipelineJobStart(sql, {
    datasetId: 'main',
    jobId: 'chemistry.123',
    bookId: 'chemistry',
    bookTitle: '八年级化学',
    logPath: '/tmp/chemistry.123.log',
    enrichContext: true,
    enrichBookPath: 'data/enrich/chemistry.json',
    ocrFolderPath: '/data/chemistry/hybrid_ocr',
  }), true);
  assert.deepEqual(unsafeCalls, [{ query: DATASET_ADVISORY_LOCK_SQL, values: ['main'] }]);
  assert.equal(statements.length, 2);
  assert.match(statements[0]!, /INSERT INTO world_datasets/);
  assert.match(statements[1]!, /INSERT INTO world_pipeline_jobs/);
  assert.match(statements[1]!, /WHERE NOT EXISTS .*book_id = .*status = 'running'/);
  assert.match(statements[1]!, /SELECT COUNT\(\*\).*status = 'running'.*</);
  assert.ok(parameterSets[1]?.includes(MAX_ACTIVE_PIPELINE_JOBS));
  assert.deepEqual(parameterSets[1]?.find((value) => (
    value != null && typeof value === 'object' && 'reserved_by' in value
  )), {
    reserved_by: 'server',
    book_title: '八年级化学',
    enrich_context: true,
    enrich_book_path: 'data/enrich/chemistry.json',
    ocr_folder_path: '/data/chemistry/hybrid_ocr',
    prepare_only: false,
  });
});

test('redactCommand removes passwords from database URLs', () => {
  assert.equal(
    redactCommand([
      'npm',
      'run',
      'server-pipeline-run',
      '--db',
      'postgresql://okm:secret-value@127.0.0.1:5432/okm_demo',
    ]),
    'npm run server-pipeline-run --db postgresql://okm:****@127.0.0.1:5432/okm_demo',
  );
});
