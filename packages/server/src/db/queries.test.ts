import assert from 'node:assert/strict';
import test from 'node:test';
import type { Sql } from './connection.js';
import { loadNodes, loadPipelineJobStatusPayload } from './queries.js';

test('loadNodes uses embedding aliases internally without exposing them in bundle nodes', async () => {
  const sql = (() => Promise.resolve([{
    id: 'node:one',
    dataset_id: 'main',
    name: 'One',
    kind: 'concept',
    subkind: null,
    aliases_json: [],
    domains_json: [],
    knowledge_form_json: [],
    learning_mode_json: [],
    properties_json: {},
    external_ids_json: {},
    tags_json: [],
    embedding: '[1,0]',
    embedding_text: '[1,0]',
    status: 'active',
  }])) as unknown as Sql;

  const [node] = await loadNodes(sql, 'main');

  assert.equal(node.community_id, 0);
  assert.equal(Object.hasOwn(node, 'embedding'), false);
  assert.equal(Object.hasOwn(node, 'embedding_text'), false);
});

test('loadPipelineJobStatusPayload adds readable outline labels to workers and events', async () => {
  const anchor = 'struct:math:chunk:3-f';
  const sql = (async (strings: TemplateStringsArray) => {
    const query = strings.join(' ');
    if (query.includes('FROM world_pipeline_jobs')) return [{
      job_id: 'job-1',
      book_id: 'math',
      status: 'running',
      current_stage_id: 'lesson_staging',
      progress_json: {},
      context_json: {},
      log_path: null,
      updated_at: null,
      completed_at: null,
      error: null,
    }];
    if (query.includes('FROM world_pipeline_job_stages')) return [{
      stage_id: 'lesson_staging',
      status: 'running',
      label: '课时抽取',
      progress_json: {},
      error: null,
      started_at: null,
      completed_at: null,
      updated_at: null,
    }];
    if (query.includes('FROM world_pipeline_worker_states')) return [{
      worker_slot: 0,
      stage_id: 'lesson_staging',
      status: 'running',
      lesson_run_id: 'lesson-run:1',
      batch_anchor: anchor,
      error: null,
      data_json: {},
      started_at: null,
      completed_at: null,
      updated_at: null,
    }];
    if (query.includes('FROM world_pipeline_job_events')) return [{
      event_id: 'event-1',
      stage_id: 'lesson_staging',
      event_type: 'lesson_started',
      status: 'running',
      worker_slot: 0,
      lesson_run_id: 'lesson-run:1',
      batch_anchor: anchor,
      detail: null,
      data_json: {},
      created_at: null,
    }];
    if (query.includes('FROM world_textbook_outlines')) return [{
      title: '初中 七年级 数学 人教版 上册',
      outline_json: {
        items: [{
          id: 'struct:math:lesson:3',
          title: '1.2 有理数及其大小比较',
          children: [{ id: anchor, title: '1.2 有理数及其大小比较 — 归纳' }],
        }],
      },
    }];
    return [];
  }) as unknown as Sql;

  const payload = await loadPipelineJobStatusPayload(sql, 'main', 'job-1');

  assert.equal(payload.book_title, '初中 七年级 数学 人教版 上册');
  assert.equal(payload.worker_states[0]?.batch_label, '1.2 有理数及其大小比较 — 归纳');
  assert.equal(payload.recent_events[0]?.batch_label, '1.2 有理数及其大小比较 — 归纳');
});
