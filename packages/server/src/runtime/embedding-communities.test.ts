import assert from 'node:assert/strict';
import test from 'node:test';
import { clusterEmbeddingCommunities } from './embedding-communities.js';

test('clusters nearby embedding directions deterministically', () => {
  const points = [
    { id: 'a', embedding: [1, 0, 0, 0] },
    { id: 'b', embedding: [0.99, 0.01, 0, 0] },
    { id: 'c', embedding: [0, 1, 0, 0] },
    { id: 'd', embedding: [0.01, 0.99, 0, 0] },
    { id: 'e', embedding: [0, 0, 1, 0] },
    { id: 'f', embedding: [0, 0.01, 0.99, 0] },
    { id: 'g', embedding: [0, 0, 0, 1] },
    { id: 'h', embedding: [0.01, 0, 0, 0.99] },
  ];
  const forward = clusterEmbeddingCommunities(points);
  const reverse = clusterEmbeddingCommunities([...points].reverse());

  assert.deepEqual([...forward], [...reverse]);
  assert.equal(forward.get('a'), forward.get('b'));
  assert.equal(forward.get('c'), forward.get('d'));
  assert.equal(forward.get('e'), forward.get('f'));
  assert.equal(forward.get('g'), forward.get('h'));
});

test('ignores invalid embeddings', () => {
  const result = clusterEmbeddingCommunities([
    { id: 'valid', embedding: '[1,0]' },
    { id: 'invalid', embedding: '[]' },
  ]);
  assert.equal(result.has('valid'), true);
  assert.equal(result.has('invalid'), false);
});
