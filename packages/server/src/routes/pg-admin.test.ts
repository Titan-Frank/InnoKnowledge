import assert from 'node:assert/strict';
import test from 'node:test';
import { Hono } from 'hono';
import type { Sql } from '../db/connection.js';
import {
  PG_ADMIN_DATASET_ADVISORY_LOCK_SQL,
  isPgAdminTable,
  isPgAdminTableMutable,
  quoteIdentifier,
  registerPgAdminRoutes,
  rowDeleteConfirmation,
} from './pg-admin.js';

function sqlText(strings: TemplateStringsArray): string {
  return strings.join('$value').replace(/\s+/g, ' ').trim();
}

function routeSql(options: { matchedOnlyCount?: number; stopBookDeleteAtLock?: boolean; stopBookDeleteAtTargetNodes?: boolean } = {}): {
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
        { table_name: 'world_staging_nodes', column_name: 'dataset_id', data_type: 'text', udt_name: 'text', is_nullable: 'NO', estimated_rows: 1, primary_key: true },
        { table_name: 'world_staging_nodes', column_name: 'lesson_run_id', data_type: 'text', udt_name: 'text', is_nullable: 'NO', estimated_rows: 1, primary_key: true },
        { table_name: 'world_staging_nodes', column_name: 'raw_node_id', data_type: 'text', udt_name: 'text', is_nullable: 'NO', estimated_rows: 1, primary_key: true },
        { table_name: 'world_staging_nodes', column_name: 'name', data_type: 'text', udt_name: 'text', is_nullable: 'NO', estimated_rows: 1, primary_key: false },
      ]);
    }
    if (text.includes('CREATE TEMP TABLE _pg_admin_target_nodes') && options.stopBookDeleteAtTargetNodes) {
      throw new Error('book-delete-reached-target-nodes');
    }
    if (text === 'SELECT count(*) AS count FROM _pg_admin_target_matched_only_nodes') {
      return Promise.resolve([{ count: options.matchedOnlyCount ?? 0 }]);
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
  assert.match(unsafeCalls[1]?.query ?? '', /^UPDATE "world_staging_nodes"/);

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
  assert.match(deleteRoute.unsafeCalls[1]?.query ?? '', /^DELETE FROM "world_staging_nodes"/);
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
