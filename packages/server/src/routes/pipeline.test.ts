import assert from 'node:assert/strict';
import test from 'node:test';
import { buildPipelineCommand, redactCommand, resolveNpmInvocation } from './pipeline.js';

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
