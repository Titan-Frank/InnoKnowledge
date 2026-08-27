import assert from 'node:assert/strict';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { Hono } from 'hono';
import type { PipelinePdfUploadResponse } from '@okm/types';
import type { Sql } from '../db/connection.js';
import { DATASET_ADVISORY_LOCK_SQL } from '../db/dataset-lock.js';
import {
  applyQualityReviewAction,
  buildPipelineCommand,
  claimPipelineJobResume,
  generatedBookId,
  inferBookId,
  inspectOcrFolder,
  MAX_ACTIVE_PIPELINE_JOBS,
  pipelineBookNodeLimit,
  qualityReviewPatch,
  redactCommand,
  registerPipelineRoutes,
  reservePipelineJobStart,
  resolveNpmInvocation,
  scanPdfFolder,
  safePdfUploadName,
  updatePendingQualityReview,
} from './pipeline.js';

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

test('textbook IDs are stable internal keys derived from the displayed name', () => {
  assert.equal(
    inferBookId({ book_title: '高中物理 必修 第一册', pdf_path: '/tmp/random-a/book.pdf' }),
    inferBookId({ book_title: '高中物理 必修 第一册', pdf_path: '/tmp/random-b/renamed.pdf' }),
  );
  assert.equal(
    inferBookId({ pdf_path: '/tmp/upload-a/八年级化学.pdf' }),
    inferBookId({ pdf_path: '/tmp/upload-b/八年级化学.pdf' }),
  );
  assert.equal(generatedBookId('Chemistry Grade 8'), 'chemistry-grade-8');
  assert.equal(
    inferBookId({ ocr_folder_path: '/data/初中_七年级_数学_人教版_上册/hybrid_ocr' }),
    generatedBookId('初中_七年级_数学_人教版_上册'),
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
