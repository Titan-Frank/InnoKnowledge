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

test('clearing a required numeric PG field reports a validation error', () => {
  assert.throws(
    () => parsePgAdminEditorValue(column({ nullable: false }), ''),
    /page_start cannot be blank/,
  );
});

test('invalid numeric editor input is rejected without losing exact decimal values', () => {
  assert.throws(() => parsePgAdminEditorValue(column({}), 'not-a-number'), /must be an integer/);
  assert.equal(
    parsePgAdminEditorValue(column({ data_type: 'numeric' }), '1234567890.123456789'),
    '1234567890.123456789',
  );
  assert.equal(
    parsePgAdminEditorValue(column({ data_type: 'bigint' }), '9007199254740993'),
    '9007199254740993',
  );
});
