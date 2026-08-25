import assert from 'node:assert/strict';
import test from 'node:test';
import { isCurrentPgAdminRequest } from '../src/lib/pg-admin-requests';

test('accepts only the latest request for the active PG source', () => {
  assert.equal(isCurrentPgAdminRequest('main', 3, 'main', 3), true);
  assert.equal(isCurrentPgAdminRequest('main', 2, 'main', 3), false);
  assert.equal(isCurrentPgAdminRequest('archive', 3, 'main', 3), false);
});
