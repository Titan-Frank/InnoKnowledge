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
    const normalized = value.trim();
    if (!normalized) throw new Error(`${column.name} cannot be blank.`);
    if (['smallint', 'integer', 'bigint'].includes(column.data_type)) {
      if (!/^[+-]?\d+$/.test(normalized)) throw new Error(`${column.name} must be an integer.`);
      if (column.data_type === 'bigint') return normalized;
      const parsed = Number(normalized);
      if (!Number.isSafeInteger(parsed)) throw new Error(`${column.name} must be a safe integer.`);
      return parsed;
    }
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized)) throw new Error(`${column.name} must be a number.`);
    if (column.data_type === 'numeric' || column.data_type === 'decimal') return normalized;
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) throw new Error(`${column.name} must be a number.`);
    return parsed;
  }
  return value;
}
