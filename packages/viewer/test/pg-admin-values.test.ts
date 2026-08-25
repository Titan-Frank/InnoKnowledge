import assert from 'node:assert/strict';
import test from 'node:test';
import type { PgAdminColumn } from '@okm/types';
import { parsePgAdminEditorValue } from '../src/lib/pg-admin-values';

function column(overrides: Partial<PgAdminColumn>): PgAdminColumn {
  return {
    name: 'page_start',
    data_type: 'integer',
    udt_name: 'int4',
    nullable: true,
    primary_key: false,
    editable: true,
    ...overrides,
  };
}

test('clearing a nullable PG field preserves null across editor types', () => {
  assert.equal(parsePgAdminEditorValue(column({}), ''), null);
  assert.equal(parsePgAdminEditorValue(column({ data_type: 'numeric' }), '   '), null);
  assert.equal(parsePgAdminEditorValue(column({ data_type: 'text' }), ''), null);
  assert.equal(parsePgAdminEditorValue(column({ data_type: 'jsonb' }), '   '), null);
  assert.equal(parsePgAdminEditorValue(column({ data_type: 'boolean' }), ''), null);
});

test('non-empty PG editor values retain their existing conversions', () => {
  assert.equal(parsePgAdminEditorValue(column({}), '42'), 42);
  assert.equal(parsePgAdminEditorValue(column({ data_type: 'boolean' }), 'false'), false);
  assert.equal(parsePgAdminEditorValue(column({ data_type: 'text', nullable: false }), ''), '');
});
