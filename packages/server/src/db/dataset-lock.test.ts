import assert from 'node:assert/strict';
import test from 'node:test';

import type { Sql } from './connection.js';
import {
  PIPELINE_MUTATION_SESSION_LOCK_SQL,
  PIPELINE_MUTATION_SESSION_UNLOCK_SQL,
  withPipelineMutationSessionLock,
} from './dataset-lock.js';

test('server standalone mutations retain the maintenance lock through completion', async () => {
  const calls: string[] = [];
  const connection = {
    unsafe: async (query: string) => {
      calls.push(query === PIPELINE_MUTATION_SESSION_LOCK_SQL ? 'lock' : query === PIPELINE_MUTATION_SESSION_UNLOCK_SQL ? 'unlock' : query);
      return [];
    },
    release: () => { calls.push('release'); },
  };
  const sql = { reserve: async () => connection } as unknown as Sql;

  const result = await withPipelineMutationSessionLock(sql, async () => {
    calls.push('operation');
    return 'done';
  });

  assert.equal(result, 'done');
  assert.deepEqual(calls, ['lock', 'operation', 'unlock', 'release']);
});
