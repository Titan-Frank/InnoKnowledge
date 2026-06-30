import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSearchTerms, normalizeRetrievalLimit } from './unit-retrieval.js';

test('buildSearchTerms extracts useful Chinese object terms from a question', () => {
  const terms = buildSearchTerms('电场强度表示什么？');
  assert.ok(terms.includes('电场强度'));
  assert.ok(terms.includes('电场'));
  assert.ok(terms.length <= 40);
});

test('normalizeRetrievalLimit clamps invalid and oversized values', () => {
  assert.equal(normalizeRetrievalLimit(undefined), 8);
  assert.equal(normalizeRetrievalLimit(0), 1);
  assert.equal(normalizeRetrievalLimit(500), 30);
});
