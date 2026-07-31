import assert from 'node:assert/strict';
import test from 'node:test';
import type { Sql } from '../db/connection.js';
import {
  buildPipelineCommand,
  claimPipelineJobResume,
  redactCommand,
  resolveNpmInvocation,
} from './pipeline.js';

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
  const sql = ((
    strings: TemplateStringsArray,
  ) => {
    statements.push(strings.join(' '));
    return Promise.resolve(statements.length === 1 ? [{ job_id: 'chemistry.123' }] : []);
  }) as unknown as Sql;

  assert.equal(await claimPipelineJobResume(sql, 'main', 'chemistry.123'), true);
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

  assert.equal(await claimPipelineJobResume(sql, 'main', 'chemistry.123'), false);
  assert.equal(calls, 1);
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
