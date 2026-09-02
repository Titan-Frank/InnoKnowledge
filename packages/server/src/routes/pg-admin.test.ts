import assert from 'node:assert/strict';
import test from 'node:test';
import { strFromU8, unzipSync } from 'fflate';
import { Hono } from 'hono';
import type { Sql } from '../db/connection.js';
import {
  PG_ADMIN_DATASET_ADVISORY_LOCK_SQL,
  PG_ADMIN_EXPORT_MAX_BYTES,
  PG_ADMIN_PIPELINE_MUTATION_LOCK_SQL,
  PG_ADMIN_TABLES,
  isPgAdminTable,
  isPgAdminTableMutable,
  pgAdminBookScopePredicate,
  quoteIdentifier,
  registerPgAdminRoutes,
  rowDeleteConfirmation,
} from './pg-admin.js';

function sqlText(strings: TemplateStringsArray): string {
  return strings.join('$value').replace(/\s+/g, ' ').trim();
}

function routeSql(options: {
  exportBookJsonBytes?: number;
  exportBookRowCount?: number;
  exportJsonBytes?: Record<string, number>;
  exportRowJson?: Record<string, string[]>;
  exportRows?: Record<string, Array<Record<string, unknown>>>;
  matchedOnlyCount?: number;
  runningJobCount?: number;
  stopBookDeleteAtLock?: boolean;
  stopBookDeleteAtTargetMerges?: boolean;
  stopBookDeleteAtTargetNodes?: boolean;
} = {}): {
  sql: Sql;
  queryCalls: Array<{ query: string; values: unknown[] }>;
  unsafeCalls: Array<{ query: string; values: unknown[] }>;
  transactionOptions: string[];
} {
  const queryCalls: Array<{ query: string; values: unknown[] }> = [];
  const unsafeCalls: Array<{ query: string; values: unknown[] }> = [];
  const transactionOptions: string[] = [];
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
    if (text.includes('book_export_rows') && text.includes('AS json_bytes')) {
      return Promise.resolve([{
        row_count: options.exportBookRowCount ?? 0,
        json_bytes: options.exportBookJsonBytes ?? 0,
      }]);
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
    const sizeTable = sql.match(/AS json_bytes FROM "([a-z0-9_]+)" t WHERE t\.dataset_id = \$1/)?.[1];
    if (sizeTable) {
      const rowJson = options.exportRowJson?.[sizeTable]
        ?? (options.exportRows?.[sizeTable] ?? []).map((row) => JSON.stringify(row));
      return [{
        row_count: rowJson.length,
        json_bytes: options.exportJsonBytes?.[sizeTable] ?? Buffer.byteLength(rowJson.join('')),
      }];
    }
    const exportTable = sql.match(/^SELECT to_jsonb\(t\)::text AS row_json FROM "([a-z0-9_]+)" t WHERE t\.dataset_id = \$1/)?.[1];
    if (exportTable) {
      const rowJson = options.exportRowJson?.[exportTable]
        ?? (options.exportRows?.[exportTable] ?? []).map((row) => JSON.stringify(row));
      return rowJson.map((value) => ({ row_json: value }));
    }
    return [];
  }) as Sql['unsafe'];
  query.begin = (async (
    optionsOrCallback: string | ((tx: Sql) => Promise<unknown>),
    maybeCallback?: (tx: Sql) => Promise<unknown>,
  ) => {
    if (typeof optionsOrCallback === 'string') transactionOptions.push(optionsOrCallback);
    const callback = typeof optionsOrCallback === 'string' ? maybeCallback : optionsOrCallback;
    if (!callback) throw new Error('Missing transaction callback');
    return callback(query);
  }) as unknown as Sql['begin'];
  return { sql: query, queryCalls, unsafeCalls, transactionOptions };
}

test('PG admin table allowlist exposes world-v1.2 tables without accepting arbitrary identifiers', () => {
  assert.equal(isPgAdminTable('world_nodes'), true);
  assert.equal(isPgAdminTable('world_evidence'), true);
  assert.equal(isPgAdminTable('users'), false);
  assert.equal(isPgAdminTable('world_nodes; DROP TABLE world_nodes'), false);
});

test('PG admin catalog advertises the enforced export size limit', async () => {
  const { sql } = routeSql();
  const app = new Hono();
  registerPgAdminRoutes(app, sql);

  const response = await app.request('/api/source/main/pg/tables');
  assert.equal(response.status, 200);
  const payload = await response.json() as { export_max_bytes: number };
  assert.equal(payload.export_max_bytes, PG_ADMIN_EXPORT_MAX_BYTES);
  assert.equal(payload.export_max_bytes, 512 * 1024 * 1024);
});

test('PG admin configures every export table for optional textbook scoping', () => {
  const globalTables = new Set(['world_datasets', 'world_enrich_library', 'world_enrich_books', 'world_taxonomy_terms', 'world_taxonomy_edges']);
  for (const table of PG_ADMIN_TABLES) {
    const predicate = pgAdminBookScopePredicate(table);
    if (globalTables.has(table)) assert.equal(predicate, '', table);
    else assert.match(predicate, /\$2::text\[\]/, table);
  }
});

test('PG admin exports selected tables from one bounded repeatable-read snapshot', async () => {
  const { sql, unsafeCalls, transactionOptions } = routeSql({
    exportRows: { world_nodes: [{ dataset_id: 'main', id: 'node-1', name: 'Motion' }] },
  });
  const app = new Hono();
  registerPgAdminRoutes(app, sql);

  const response = await app.request('/api/source/main/pg/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tables: ['world_nodes', 'world_nodes'], include_books: false }),
  });

  assert.equal(response.status, 200);
  assert.match(response.headers.get('Content-Type') ?? '', /^application\/json/);
  assert.match(response.headers.get('Content-Disposition') ?? '', /^attachment; filename="okm-pg-main-\d{4}-\d{2}-\d{2}\.json"$/);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  const payload = await response.json() as {
    export_version: string;
    dataset_id: string;
    schema_version: string;
    books?: unknown[];
    tables: Record<string, { columns: unknown[]; rows: unknown[] }>;
  };
  assert.equal(payload.export_version, 'pg-admin-v1');
  assert.equal(payload.dataset_id, 'main');
  assert.equal(payload.schema_version, 'world-v1.2');
  assert.equal('books' in payload, false);
  assert.deepEqual(Object.keys(payload.tables), ['world_nodes']);
  assert.deepEqual(payload.tables.world_nodes?.rows, [{ dataset_id: 'main', id: 'node-1', name: 'Motion' }]);
  assert.ok((payload.tables.world_nodes?.columns.length ?? 0) > 0);
  assert.deepEqual(transactionOptions, ['ISOLATION LEVEL REPEATABLE READ READ ONLY']);
  assert.match(unsafeCalls[0]?.query ?? '', /^SELECT count\(\*\) AS row_count, COALESCE\(sum\(octet_length\(to_jsonb\(t\)::text\)\), 0\) AS json_bytes FROM "world_nodes"/);
  assert.deepEqual(unsafeCalls[0]?.values, ['main']);
  assert.deepEqual(unsafeCalls[1], {
    query: 'SELECT to_jsonb(t)::text AS row_json FROM "world_nodes" t WHERE t.dataset_id = $1 ORDER BY "dataset_id", "id"',
    values: ['main'],
  });
});

test('PG admin preserves exact JSONB numeric tokens in exported rows', async () => {
  const { sql } = routeSql({
    exportRowJson: {
      world_nodes: ['{"dataset_id":"main","id":"node-1","properties_json":{"integer":9007199254740993,"decimal":1234567890.123456789}}'],
    },
  });
  const app = new Hono();
  registerPgAdminRoutes(app, sql);

  const response = await app.request('/api/source/main/pg/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tables: ['world_nodes'], include_books: false }),
  });

  assert.equal(response.status, 200);
  const json = await response.text();
  assert.match(json, /"integer":9007199254740993/);
  assert.match(json, /"decimal":1234567890\.123456789/);
  assert.doesNotMatch(json, /9007199254740992|1234567890\.1234567(?:\D|$)/);
});

test('PG admin limits table exports to selected textbooks and records the scope', async () => {
  const { sql, unsafeCalls } = routeSql({
    exportRows: {
      world_datasets: [{ dataset_id: 'main' }],
      world_nodes: [{ dataset_id: 'main', id: 'node-1', name: 'Motion' }],
    },
  });
  const app = new Hono();
  registerPgAdminRoutes(app, sql);

  const response = await app.request('/api/source/main/pg/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tables: ['world_datasets', 'world_nodes'], include_books: false, book_ids: ['book-a', 'book-a'] }),
  });

  assert.equal(response.status, 200);
  const payload = await response.json() as { book_ids: string[]; tables: Record<string, { rows: unknown[] }> };
  assert.deepEqual(payload.book_ids, ['book-a']);
  assert.equal(payload.tables.world_datasets?.rows.length, 1);
  assert.equal(payload.tables.world_nodes?.rows.length, 1);
  assert.equal(unsafeCalls.length, 4);
  const globalCalls = unsafeCalls.filter((call) => call.query.includes('"world_datasets"'));
  assert.equal(globalCalls.length, 2);
  for (const call of globalCalls) {
    assert.doesNotMatch(call.query, /\$2/);
    assert.deepEqual(call.values, ['main']);
  }
  const scopedCalls = unsafeCalls.filter((call) => call.query.includes('"world_nodes"'));
  assert.equal(scopedCalls.length, 2);
  for (const call of scopedCalls) {
    assert.match(call.query, /world_canonical_node_map/);
    assert.match(call.query, /lr\.book_id = ANY\(\$2::text\[\]\)/);
    assert.deepEqual(call.values, ['main', ['book-a']]);
  }
});

test('PG admin can package every selected table as an individual JSON file', async () => {
  const { sql } = routeSql({
    exportRowJson: {
      world_nodes: ['{"dataset_id":"main","id":"node-1","properties_json":{"exact":9007199254740993}}'],
      world_evidence: ['{"dataset_id":"main","id":"evidence-1","source_id":"book-a"}'],
    },
  });
  const app = new Hono();
  registerPgAdminRoutes(app, sql);

  const response = await app.request('/api/source/main/pg/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tables: ['world_nodes', 'world_evidence'], include_books: true, format: 'separate' }),
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Content-Type'), 'application/zip');
  assert.match(response.headers.get('Content-Disposition') ?? '', /^attachment; filename="okm-pg-main-\d{4}-\d{2}-\d{2}-tables\.zip"$/);
  const files = unzipSync(new Uint8Array(await response.arrayBuffer()));
  assert.deepEqual(Object.keys(files).sort(), ['books.json', 'manifest.json', 'world_evidence.json', 'world_nodes.json']);
  const manifest = JSON.parse(strFromU8(files['manifest.json']!)) as { format: string; files: string[] };
  assert.equal(manifest.format, 'separate-json');
  assert.deepEqual(manifest.files, ['books.json', 'world_nodes.json', 'world_evidence.json']);
  assert.match(strFromU8(files['books.json']!), /"type":"textbook-summary"/);
  assert.match(strFromU8(files['world_nodes.json']!), /"table":"world_nodes"/);
  assert.match(strFromU8(files['world_nodes.json']!), /"exact":9007199254740993/);
  assert.match(strFromU8(files['world_evidence.json']!), /"table":"world_evidence"/);
});

test('PG admin rejects oversized exports before materializing table rows', async () => {
  const { sql, unsafeCalls, transactionOptions } = routeSql({
    exportJsonBytes: { world_nodes: PG_ADMIN_EXPORT_MAX_BYTES + 1 },
  });
  const app = new Hono();
  registerPgAdminRoutes(app, sql);

  const response = await app.request('/api/source/main/pg/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tables: ['world_nodes'], include_books: false }),
  });

  assert.equal(response.status, 413);
  assert.match((await response.json() as { error: string }).error, /limit is 512 MiB.*Select fewer tables/);
  assert.deepEqual(transactionOptions, ['ISOLATION LEVEL REPEATABLE READ READ ONLY']);
  assert.equal(unsafeCalls.length, 1);
  assert.match(unsafeCalls[0]?.query ?? '', /AS json_bytes FROM "world_nodes"/);
});

test('PG admin rejects oversized book summaries before loading the aggregate payload', async () => {
  const { sql, queryCalls, unsafeCalls, transactionOptions } = routeSql({
    exportBookJsonBytes: PG_ADMIN_EXPORT_MAX_BYTES + 1,
    exportBookRowCount: 1,
  });
  const app = new Hono();
  registerPgAdminRoutes(app, sql);

  const response = await app.request('/api/source/main/pg/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tables: [], include_books: true }),
  });

  assert.equal(response.status, 413);
  assert.match((await response.json() as { error: string }).error, /limit is 512 MiB.*Select fewer tables/);
  assert.deepEqual(transactionOptions, ['ISOLATION LEVEL REPEATABLE READ READ ONLY']);
  assert.equal(unsafeCalls.length, 0);
  assert.equal(queryCalls.filter((call) => call.query.includes('book_export_rows')).length, 1);
  assert.equal(queryCalls.some((call) => call.query.includes('book_node_mappings')), false);
});

test('PG admin export rejects empty and unsupported selections without reading table rows', async () => {
  const { sql, unsafeCalls } = routeSql();
  const app = new Hono();
  registerPgAdminRoutes(app, sql);

  const emptyResponse = await app.request('/api/source/main/pg/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tables: [], include_books: false }),
  });
  assert.equal(emptyResponse.status, 400);
  assert.match((await emptyResponse.json() as { error: string }).error, /Select at least one/);

  const unsupportedResponse = await app.request('/api/source/main/pg/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tables: ['users; DROP TABLE users'], include_books: false }),
  });
  assert.equal(unsupportedResponse.status, 400);
  assert.match((await unsupportedResponse.json() as { error: string }).error, /unsupported PostgreSQL table/);

  const emptyBookScopeResponse = await app.request('/api/source/main/pg/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tables: ['world_nodes'], include_books: false, book_ids: [] }),
  });
  assert.equal(emptyBookScopeResponse.status, 400);
  assert.match((await emptyBookScopeResponse.json() as { error: string }).error, /book_ids must be a non-empty array/);

  const invalidFormatResponse = await app.request('/api/source/main/pg/export', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ tables: ['world_nodes'], include_books: false, format: 'csv' }),
  });
  assert.equal(invalidFormatResponse.status, 400);
  assert.match((await invalidFormatResponse.json() as { error: string }).error, /Unsupported export format/);
  assert.equal(unsafeCalls.length, 0);
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

test('book deletion rejects match-only mappings whose source textbook cannot be attributed safely', async () => {
  const { sql } = routeSql({ matchedOnlyCount: 1 });
  const app = new Hono();
  registerPgAdminRoutes(app, sql);

  const response = await app.request('/api/source/main/pg/books/book-1', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ confirmation: 'DELETE BOOK book-1' }),
  });
  assert.equal(response.status, 409);
  assert.match((await response.json() as { error: string }).error, /只有匹配记录.*无法安全判断.*教材产生/);
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
