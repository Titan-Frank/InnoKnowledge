import assert from 'node:assert/strict';
import test from 'node:test';

import { stringArray } from './quality-dashboard.js';

test('quality dashboard reads native and legacy stringified arrays', () => {
  assert.deepEqual(stringArray(['node-a', ' node-b ']), ['node-a', 'node-b']);
  assert.deepEqual(stringArray('["node-a","node-b"]'), ['node-a', 'node-b']);
  assert.deepEqual(stringArray('not-json'), []);
  assert.deepEqual(stringArray('{"node":"a"}'), []);
});
