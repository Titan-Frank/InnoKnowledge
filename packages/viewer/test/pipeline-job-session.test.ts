import assert from 'node:assert/strict';
import test from 'node:test';
import type { PipelineStartResponse } from '@okm/types';
import {
  forgetPipelineJob,
  rememberPipelineJob,
  restorePipelineJob,
  type PipelineJobStorage,
} from '../src/lib/pipeline-job-session.ts';

function memoryStorage(): PipelineJobStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

function startResult(jobId: string): PipelineStartResponse {
  return {
    job_id: jobId,
    status: 'started',
    command: ['node', 'pipeline.js', '--db', 'postgresql://secret'],
    log_path: `runs/${jobId}.log`,
  };
}

test('restores the active pipeline job independently for each source', () => {
  const storage = memoryStorage();
  rememberPipelineJob(storage, 'main', startResult('main-job'));
  rememberPipelineJob(storage, 'textbook', startResult('textbook-job'));

  assert.equal(restorePipelineJob(storage, 'main')?.job_id, 'main-job');
  assert.equal(restorePipelineJob(storage, 'textbook')?.job_id, 'textbook-job');
});

test('stores only the job identity and log path, not the command', () => {
  const storage = memoryStorage();
  rememberPipelineJob(storage, 'main', startResult('job-safe'));

  const restored = restorePipelineJob(storage, 'main');
  assert.deepEqual(restored?.command, []);
  assert.equal(restored?.log_path, 'runs/job-safe.log');
});

test('forgets a stale pipeline job', () => {
  const storage = memoryStorage();
  rememberPipelineJob(storage, 'main', startResult('old-job'));
  forgetPipelineJob(storage, 'main');

  assert.equal(restorePipelineJob(storage, 'main'), null);
});
