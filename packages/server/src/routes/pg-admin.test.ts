import assert from 'node:assert/strict';
import test from 'node:test';
import { isPgAdminTable, quoteIdentifier, rowDeleteConfirmation } from './pg-admin.js';

test('PG admin table allowlist exposes world-v1.2 tables without accepting arbitrary identifiers', () => {
  assert.equal(isPgAdminTable('world_nodes'), true);
  assert.equal(isPgAdminTable('world_evidence'), true);
  assert.equal(isPgAdminTable('users'), false);
  assert.equal(isPgAdminTable('world_nodes; DROP TABLE world_nodes'), false);
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
