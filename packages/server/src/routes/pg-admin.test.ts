import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import type { Sql } from '../db/connection.js';
import {
  PG_ADMIN_DATASET_ADVISORY_LOCK_SQL,
  PG_ADMIN_PIPELINE_MUTATION_LOCK_SQL,
  isPgAdminTable,
  isPgAdminTableMutable,
  quoteIdentifier,
  registerPgAdminRoutes,
  rowDeleteConfirmation,
} from './pg-admin.js';

function sqlText(strings: TemplateStringsArray): string {
  return strings.join('$value').replace(/\s+/g, ' ').trim();
}

function routeSql(options: {
  matchedOnlyCount?: number;
  runningJobCount?: number;
  stopBookDeleteAtLock?: boolean;
  stopBookDeleteAtTargetMerges?: boolean;
  stopBookDeleteAtTargetNodes?: boolean;
} = {}): {
  sql: Sql;
  queryCalls: Array<{ query: string; values: unknown[] }>;
  unsafeCalls: Array<{ query: string; values: unknown[] }>;
} {
  const queryCalls: Array<{ query: string; values: unknown[] }> = [];
  const unsafeCalls: Array<{ query: string; values: unknown[] }> = [];
  const query = ((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = sqlText(strings);
    queryCalls.push({ query: text, values });
    if (text.includes('FROM world_datasets')) {
      return Promise.resolve([{
        dataset_id: 'main',
        version_key: 'main',
        schema_version: 'world-v1.2',
        root_path: '',
        is_active: 1,
      }]);
    }
    if (text.includes('FROM information_schema.columns')) {
      return Promise.resolve([
        { table_name: 'world_datasets', column_name: 'dataset_id', data_type: 'text', udt_name: 'text', is_nullable: 'NO', estimated_rows: 1, primary_key: true },
        { table_name: 'world_nodes', column_name: 'dataset_id', data_type: 'text', udt_name: 'text', is_nullable: 'NO', estimated_rows: 1, primary_key: true },
        { table_name: 'world_nodes', column_name: 'id', data_type: 'text', udt_name: 'text', is_nullable: 'NO', estimated_rows: 1, primary_key: true },
        { table_name: 'world_nodes', column_name: 'name', data_type: 'text', udt_name: 'text', is_nullable: 'NO', estimated_rows: 1, primary_key: false },
        { table_name: 'world_evidence', column_name: 'dataset_id', data_type: 'text', udt_name: 'text', is_nullable: 'NO', estimated_rows: 1, primary_key: true },
        { table_name: 'world_lesson_runs', column_name: 'dataset_id', data_type: 'text', udt_name: 'text', is_nullable: 'NO', estimated_rows: 1, primary_key: true },
        { table_name: 'world_pipeline_jobs', column_name: 'dataset_id', data_type: 'text', udt_name: 'text', is_nullable: 'NO', estimated_rows: 1, primary_key: true },
        { table_name: 'world_merge_runs', column_name: 'dataset_id', data_type: 'text', udt_name: 'text', is_nullable: 'NO', estimated_rows: 1, primary_key: true },
        { table_name: 'world_canonical_node_map', column_name: 'dataset_id', data_type: 'text', udt_name: 'text', is_nullable: 'NO', estimated_rows: 1, primary_key: true },
        { table_name: 'world_unit_embeddings', column_name: 'dataset_id', data_type: 'text', udt_name: 'text', is_nullable: 'NO', estimated_rows: 1, primary_key: true },
        { table_name: 'world_textbook_outlines', column_name: 'dataset_id', data_type: 'text', udt_name: 'text', is_nullable: 'NO', estimated_rows: 1, primary_key: true },
        { table_name: 'world_textbook_outlines', column_name: 'book_id', data_type: 'text', udt_name: 'text', is_nullable: 'NO', estimated_rows: 1, primary_key: true },
        { table_name: 'world_textbook_outlines', column_name: 'title', data_type: 'text', udt_name: 'text', is_nullable: 'NO', estimated_rows: 1, primary_key: false },
        { table_name: 'world_staging_nodes', column_name: 'dataset_id', data_type: 'text', udt_name: 'text', is_nullable: 'NO', estimated_rows: 1, primary_key: true },
        { table_name: 'world_staging_nodes', column_name: 'lesson_run_id', data_type: 'text', udt_name: 'text', is_nullable: 'NO', estimated_rows: 1, primary_key: true },
        { table_name: 'world_staging_nodes', column_name: 'raw_node_id', data_type: 'text', udt_name: 'text', is_nullable: 'NO', estimated_rows: 1, primary_key: true },
        { table_name: 'world_staging_nodes', column_name: 'name', data_type: 'text', udt_name: 'text', is_nullable: 'NO', estimated_rows: 1, primary_key: false },
        { table_name: 'world_staging_nodes', column_name: 'confidence', data_type: 'real', udt_name: 'float4', is_nullable: 'NO', estimated_rows: 1, primary_key: false },
        { table_name: 'world_staging_nodes', column_name: 'exact_counter', data_type: 'bigint', udt_name: 'int8', is_nullable: 'NO', estimated_rows: 1, primary_key: false },
      ]);
    }
    if (text.includes('CREATE TEMP TABLE _pg_admin_target_nodes') && options.stopBookDeleteAtTargetNodes) {
      throw new Error('book-delete-reached-target-nodes');
    }
    if (text === 'SELECT count(*) AS count FROM _pg_admin_target_matched_only_nodes') {
      return Promise.resolve([{ count: options.matchedOnlyCount ?? 0 }]);
    }
    if (text.includes('FROM world_pipeline_jobs') && text.includes("status = 'running'")) {
      return Promise.resolve([{ count: options.runningJobCount ?? 0 }]);
    }
    if (text.includes('CREATE TEMP TABLE _pg_admin_target_merges') && options.stopBookDeleteAtTargetMerges) {
      throw new Error('book-delete-reached-target-merges');
    }
    return Promise.resolve([]);
  }) as unknown as Sql;
  query.unsafe = (async (sql: string, values: unknown[] = []) => {
    unsafeCalls.push({ query: sql, values });
    if (options.stopBookDeleteAtLock) throw new Error('book-delete-reached-shared-lock');
    return [];
  }) as Sql['unsafe'];
  query.begin = (async (callback: (tx: Sql) => Promise<unknown>) => callback(query)) as unknown as Sql['begin'];
  return { sql: query, queryCalls, unsafeCalls };
}

test('PG admin table allowlist exposes world-v1.2 tables without accepting arbitrary identifiers', () => {
  assert.equal(isPgAdminTable('world_nodes'), true);
  assert.equal(isPgAdminTable('world_evidence'), true);
  assert.equal(isPgAdminTable('users'), false);
  assert.equal(isPgAdminTable('world_nodes; DROP TABLE world_nodes'), false);
});

test('canonical, reducer-output, and pipeline-lineage tables are browse-only in generic PG admin routes', async () => {
  assert.equal(isPgAdminTableMutable('world_nodes'), false);
  assert.equal(isPgAdminTableMutable('world_edges'), false);
  assert.equal(isPgAdminTableMutable('world_evidence'), false);
  assert.equal(isPgAdminTableMutable('world_evidence_links'), false);
  assert.equal(isPgAdminTableMutable('world_node_cards'), false);
  assert.equal(isPgAdminTableMutable('world_node_bodies'), false);
  assert.equal(isPgAdminTableMutable('world_datasets'), false);
  assert.equal(isPgAdminTableMutable('world_lesson_runs'), false);
  assert.equal(isPgAdminTableMutable('world_pipeline_jobs'), false);
  assert.equal(isPgAdminTableMutable('world_pipeline_job_events'), false);
  assert.equal(isPgAdminTableMutable('world_merge_runs'), false);
  assert.equal(isPgAdminTableMutable('world_canonical_node_map'), false);
  assert.equal(isPgAdminTableMutable('world_unit_embeddings'), false);
  assert.equal(isPgAdminTableMutable('retrieval_candidates'), true);
  assert.equal(isPgAdminTableMutable('world_staging_nodes'), true);

  const { sql, unsafeCalls } = routeSql();
  const app = new Hono();
  registerPgAdminRoutes(app, sql);

  const updateResponse = await app.request('/api/source/main/pg/tables/world_nodes/rows', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ primary_key: { dataset_id: 'main', id: 'node-1' }, changes: { name: 'Changed' } }),
  });
  assert.equal(updateResponse.status, 403);
  assert.match((await updateResponse.json() as { error: string }).error, /read-only.*dedicated workflow/);

  const deleteResponse = await app.request('/api/source/main/pg/tables/world_nodes/rows', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ primary_key: { dataset_id: 'main', id: 'node-1' }, confirmation: 'DELETE world_nodes main / node-1' }),
  });
  assert.equal(deleteResponse.status, 403);

  for (const table of ['world_datasets', 'world_evidence', 'world_lesson_runs', 'world_pipeline_jobs', 'world_merge_runs', 'world_canonical_node_map', 'world_unit_embeddings']) {
    const protectedDeleteResponse = await app.request(`/api/source/main/pg/tables/${table}/rows`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ primary_key: { dataset_id: 'main' }, confirmation: `DELETE ${table} main` }),
    });
    assert.equal(protectedDeleteResponse.status, 403, table);
  }
  assert.equal(unsafeCalls.length, 0);
});

test('book deletion keeps the Hono-decoded id and acquires the reducer lock key', async () => {
  const { sql, unsafeCalls } = routeSql({ stopBookDeleteAtLock: true });
  const app = new Hono();
  registerPgAdminRoutes(app, sql);
  const bookId = 'book%2Fpart';

  const response = await app.request(`/api/source/main/pg/books/${encodeURIComponent(bookId)}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmation: `DELETE BOOK ${bookId}` }),
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'book-delete-reached-shared-lock' });
  assert.deepEqual(unsafeCalls, [{ query: PG_ADMIN_DATASET_ADVISORY_LOCK_SQL, values: ['main'] }]);
});

test('book deletion blocks while any pipeline job in the dataset is running', async () => {
  const { sql, queryCalls, unsafeCalls } = routeSql({ runningJobCount: 1 });
  const app = new Hono();
  registerPgAdminRoutes(app, sql);

  const response = await app.request('/api/source/main/pg/books/book-1', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmation: 'DELETE BOOK book-1' }),
  });
  assert.equal(response.status, 409);
  assert.match((await response.json() as { error: string }).error, /数据集.*运行中的流水线任务/);
  const runningQuery = queryCalls.find((call) => call.query.includes('FROM world_pipeline_jobs') && call.query.includes("status = 'running'"));
  assert.ok(runningQuery);
  assert.deepEqual(runningQuery.values, ['main']);
  assert.doesNotMatch(runningQuery.query, /book_id/);
  assert.deepEqual(unsafeCalls, [
    { query: PG_ADMIN_DATASET_ADVISORY_LOCK_SQL, values: ['main'] },
    { query: PG_ADMIN_PIPELINE_MUTATION_LOCK_SQL, values: [] },
  ]);
});

test('book deletion targets canonical nodes created or queued for review by the selected lessons', async () => {
  const { sql, queryCalls } = routeSql({ stopBookDeleteAtTargetNodes: true });
  const app = new Hono();
  registerPgAdminRoutes(app, sql);

  const response = await app.request('/api/source/main/pg/books/book-1', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmation: 'DELETE BOOK book-1' }),
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'book-delete-reached-target-nodes' });

  const targetNodeQuery = queryCalls.find((call) => call.query.includes('CREATE TEMP TABLE _pg_admin_target_nodes'));
  assert.ok(targetNodeQuery);
  assert.match(targetNodeQuery.query, /cm\.resolution IN \('created', 'review'\)/);
});

test('book deletion rejects matched-only mappings whose reducer outputs cannot be attributed safely', async () => {
  const { sql } = routeSql({ matchedOnlyCount: 1 });
  const app = new Hono();
  registerPgAdminRoutes(app, sql);

  const response = await app.request('/api/source/main/pg/books/book-1', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmation: 'DELETE BOOK book-1' }),
  });
  assert.equal(response.status, 409);
  assert.match((await response.json() as { error: string }).error, /matched.*schema.*reducer/);
});

test('book deletion discovers merge runs from selection JSON when lessons have no node mappings', async () => {
  const { sql, queryCalls } = routeSql({ stopBookDeleteAtTargetMerges: true });
  const app = new Hono();
  registerPgAdminRoutes(app, sql);

  const response = await app.request('/api/source/main/pg/books/book-1', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmation: 'DELETE BOOK book-1' }),
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: 'book-delete-reached-target-merges' });

  const targetMergeQuery = queryCalls.find((call) => call.query.includes('CREATE TEMP TABLE _pg_admin_target_merges'));
  assert.ok(targetMergeQuery);
  assert.match(targetMergeQuery.query, /jsonb_array_elements_text/);
  assert.match(targetMergeQuery.query, /JOIN _pg_admin_target_lessons/);
});

test('mutable staging changes acquire the reducer dataset lock in the same transaction', async () => {
  const { sql, unsafeCalls } = routeSql();
  const app = new Hono();
  registerPgAdminRoutes(app, sql);

  const response = await app.request('/api/source/main/pg/tables/world_staging_nodes/rows', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      primary_key: { dataset_id: 'main', lesson_run_id: 'lesson-1', raw_node_id: 'raw-1' },
      changes: { name: 'Changed' },
    }),
  });
  assert.equal(response.status, 404);
  assert.deepEqual(unsafeCalls[0], { query: PG_ADMIN_DATASET_ADVISORY_LOCK_SQL, values: ['main'] });
  assert.deepEqual(unsafeCalls[1], { query: PG_ADMIN_PIPELINE_MUTATION_LOCK_SQL, values: [] });
  assert.match(unsafeCalls[2]?.query ?? '', /^UPDATE "world_staging_nodes"/);

  const deleteRoute = routeSql();
  const deleteApp = new Hono();
  registerPgAdminRoutes(deleteApp, deleteRoute.sql);
  const deleteResponse = await deleteApp.request('/api/source/main/pg/tables/world_staging_nodes/rows', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      primary_key: { dataset_id: 'main', lesson_run_id: 'lesson-1', raw_node_id: 'raw-1' },
      confirmation: 'DELETE world_staging_nodes main / lesson-1 / raw-1',
    }),
  });
  assert.equal(deleteResponse.status, 404);
  assert.deepEqual(deleteRoute.unsafeCalls[0], { query: PG_ADMIN_DATASET_ADVISORY_LOCK_SQL, values: ['main'] });
  assert.deepEqual(deleteRoute.unsafeCalls[1], { query: PG_ADMIN_PIPELINE_MUTATION_LOCK_SQL, values: [] });
  assert.match(deleteRoute.unsafeCalls[2]?.query ?? '', /^DELETE FROM "world_staging_nodes"/);
});

test('PG admin rejects blank required numeric values before issuing an update', async () => {
  const { sql, unsafeCalls } = routeSql();
  const app = new Hono();
  registerPgAdminRoutes(app, sql);

  const response = await app.request('/api/source/main/pg/tables/world_staging_nodes/rows', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      primary_key: { dataset_id: 'main', lesson_run_id: 'lesson-1', raw_node_id: 'raw-1' },
      changes: { confidence: '' },
    }),
  });
  assert.equal(response.status, 400);
  assert.match((await response.json() as { error: string }).error, /confidence cannot be blank/);
  assert.equal(unsafeCalls.length, 0);
});

test('PG admin rejects non-numeric JSON values instead of coercing them', async () => {
  const { sql, unsafeCalls } = routeSql();
  const app = new Hono();
  registerPgAdminRoutes(app, sql);

  for (const value of [false, [], [1]]) {
    const response = await app.request('/api/source/main/pg/tables/world_staging_nodes/rows', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        primary_key: { dataset_id: 'main', lesson_run_id: 'lesson-1', raw_node_id: 'raw-1' },
        changes: { confidence: value },
      }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json() as { error: string }).error, /confidence must be a number/);
  }

  const bigintResponse = await app.request('/api/source/main/pg/tables/world_staging_nodes/rows', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      primary_key: { dataset_id: 'main', lesson_run_id: 'lesson-1', raw_node_id: 'raw-1' },
      changes: { exact_counter: Number.MAX_SAFE_INTEGER + 1 },
    }),
  });
  assert.equal(bigintResponse.status, 400);
  assert.match((await bigintResponse.json() as { error: string }).error, /exact integer string/);
  assert.equal(unsafeCalls.length, 0);
});

test('PG admin rejects structured values for text columns instead of coercing them', async () => {
  const { sql, unsafeCalls } = routeSql();
  const app = new Hono();
  registerPgAdminRoutes(app, sql);

  for (const value of [{}, [], 42, true]) {
    const response = await app.request('/api/source/main/pg/tables/world_staging_nodes/rows', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        primary_key: { dataset_id: 'main', lesson_run_id: 'lesson-1', raw_node_id: 'raw-1' },
        changes: { name: value },
      }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json() as { error: string }).error, /name must be a string/);
  }
  assert.equal(unsafeCalls.length, 0);
});

test('PG admin blocks mutable staging and catalog rows while a pipeline job is running', async () => {
  const { sql, unsafeCalls } = routeSql({ runningJobCount: 1 });
  const app = new Hono();
  registerPgAdminRoutes(app, sql);

  const mutations = [
    {
      table: 'world_staging_nodes',
      primary_key: { dataset_id: 'main', lesson_run_id: 'lesson-1', raw_node_id: 'raw-1' },
      changes: { name: 'Changed' },
    },
    {
      table: 'world_textbook_outlines',
      primary_key: { dataset_id: 'main', book_id: 'book-1' },
      changes: { title: 'Changed' },
    },
  ];
  for (const mutation of mutations) {
    const response = await app.request(`/api/source/main/pg/tables/${mutation.table}/rows`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ primary_key: mutation.primary_key, changes: mutation.changes }),
    });
    assert.equal(response.status, 409);
    assert.match((await response.json() as { error: string }).error, /pipeline job is running/);
  }
  assert.deepEqual(unsafeCalls, [
    { query: PG_ADMIN_DATASET_ADVISORY_LOCK_SQL, values: ['main'] },
    { query: PG_ADMIN_PIPELINE_MUTATION_LOCK_SQL, values: [] },
    { query: PG_ADMIN_DATASET_ADVISORY_LOCK_SQL, values: ['main'] },
    { query: PG_ADMIN_PIPELINE_MUTATION_LOCK_SQL, values: [] },
  ]);
});

test('quoteIdentifier only quotes normalized PostgreSQL identifiers', () => {
  assert.equal(quoteIdentifier('world_pipeline_jobs'), '"world_pipeline_jobs"');
  assert.throws(() => quoteIdentifier('world_nodes; DELETE'), /Invalid SQL identifier/);
  assert.throws(() => quoteIdentifier('WorldNodes'), /Invalid SQL identifier/);
});

test('row deletion requires the table and complete ordered primary-key identity', () => {
  assert.equal(
    rowDeleteConfirmation(
      'world_nodes',
      { dataset_id: 'main', id: 'concept:motion:velocity' },
      ['dataset_id', 'id'],
    ),
    'DELETE world_nodes main / concept:motion:velocity',
  );
});
