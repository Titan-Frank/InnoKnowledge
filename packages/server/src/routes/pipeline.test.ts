import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
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
  pipelineBookNodeLimit,
  redactCommand,
  registerPipelineRoutes,
  reservePipelineJobStart,
  resolveNpmInvocation,
  scanPdfFolder,
  safePdfUploadName,
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
  const unsafeCalls: Array<{ query: string; values: unknown[] }> = [];
  const sql = ((
    strings: TemplateStringsArray,
  ) => {
    statements.push(strings.join(' '));
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
  }), true);
  assert.deepEqual(unsafeCalls, [{ query: DATASET_ADVISORY_LOCK_SQL, values: ['main'] }]);
  assert.equal(statements.length, 2);
  assert.match(statements[0]!, /INSERT INTO world_datasets/);
  assert.match(statements[1]!, /INSERT INTO world_pipeline_jobs/);
  assert.deepEqual(parameterSets[1]?.find((value) => (
    value != null && typeof value === 'object' && 'reserved_by' in value
  )), { reserved_by: 'server', book_title: '八年级化学' });
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
