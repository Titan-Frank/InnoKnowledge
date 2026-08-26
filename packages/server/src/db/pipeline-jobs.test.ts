import assert from 'node:assert/strict';
import test from 'node:test';
import type { Sql } from './connection.js';
import { loadPipelineJobListPayload } from './queries.js';

test('loadPipelineJobListPayload maps recent jobs for the viewer', async () => {
  const values: unknown[] = [];
  const sql = ((
    _strings: TemplateStringsArray,
    ...parameters: unknown[]
  ) => {
    values.push(...parameters);
    return Promise.resolve([{
      job_id: 'physics.123',
      book_id: 'physics',
      book_title: '高中物理 必修一',
      status: 'blocked',
      current_stage_id: 'node_bodies',
      current_stage_label: 'Generate node bodies',
      progress_json: { completed: 3, failed: 1, total_units: 8 },
      log_path: 'runs/server-jobs/physics.123.log',
      created_at: '2026-07-31T08:00:00.000Z',
      updated_at: '2026-07-31T08:10:00.000Z',
      completed_at: '2026-07-31T08:10:00.000Z',
      error: 'model unavailable',
    }]);
  }) as unknown as Sql;

  const payload = await loadPipelineJobListPayload(sql, 'main', 200);

  assert.deepEqual(values, ['main', 100]);
  assert.deepEqual(payload, {
    dataset_id: 'main',
    jobs: [{
      job_id: 'physics.123',
      book_id: 'physics',
      book_title: '高中物理 必修一',
      status: 'blocked',
      current_stage_id: 'node_bodies',
      current_stage_label: 'Generate node bodies',
      progress: { completed: 3, failed: 1, total_units: 8 },
      log_path: 'runs/server-jobs/physics.123.log',
      created_at: '2026-07-31T08:00:00.000Z',
      updated_at: '2026-07-31T08:10:00.000Z',
      completed_at: '2026-07-31T08:10:00.000Z',
      error: 'model unavailable',
    }],
  });
});
