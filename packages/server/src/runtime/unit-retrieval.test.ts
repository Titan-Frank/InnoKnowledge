import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSearchTerms, mergeVectorRows, normalizeRetrievalLimit } from './unit-retrieval.js';

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

test('mergeVectorRows keeps node fallback rows when unit embeddings are partial', () => {
  const rows = mergeVectorRows(
    [
      {
        id: 'n1',
        canonical_name: '单元向量命中',
        node_kind: 'concept',
        node_layer: '',
        similarity: 0.71,
        reason: 'apiunit_embedding',
      },
      {
        id: 'shared',
        canonical_name: '重复节点',
        node_kind: 'concept',
        node_layer: '',
        similarity: 0.5,
        reason: 'apiunit_embedding',
      },
    ],
    [
      {
        id: 'n2',
        canonical_name: '节点向量命中',
        node_kind: 'concept',
        node_layer: '',
        similarity: 0.82,
        reason: 'node_embedding',
      },
      {
        id: 'shared',
        canonical_name: '重复节点',
        node_kind: 'concept',
        node_layer: '',
        similarity: 0.42,
        reason: 'node_embedding',
      },
    ],
    10,
  );

  assert.deepEqual(rows.map((row) => row.id), ['n2', 'n1', 'shared']);
  assert.equal(rows.find((row) => row.id === 'shared')?.reason, 'apiunit_embedding');
});
