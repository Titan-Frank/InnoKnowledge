import type { PgAdminColumn } from '@okm/types';

const NUMERIC_TYPES = new Set([
  'smallint',
  'integer',
  'bigint',
  'real',
  'double precision',
  'numeric',
  'decimal',
]);

export function parsePgAdminEditorValue(column: PgAdminColumn, value: string): unknown {
  if (column.nullable && value.trim() === '') return null;
  if (column.data_type === 'boolean') return value === 'true';
  if (NUMERIC_TYPES.has(column.data_type)) {
    if (value.trim() === '') throw new Error(`${column.name} cannot be blank.`);
    return Number(value);
  }
  return value;
}
