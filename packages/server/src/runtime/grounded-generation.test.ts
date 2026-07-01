import assert from 'node:assert/strict';
import test from 'node:test';
import type { ApiUnit, UnitRetrievalResponse } from '@okm/types';
import { normalizeModelJson, validateCitations } from './grounded-generation.js';

test('normalizeModelJson keeps only structured grounded-generation fields', () => {
  const parsed = normalizeModelJson({
    answer: '电场强度描述电场的强弱和方向。',
    citations: [{ node_id: 'n1', evidence_id: 'e1', note: 'definition' }],
    unsupported_claims: ['extra claim'],
    used_node_ids: ['n1'],
  });

  assert.equal(parsed.answer, '电场强度描述电场的强弱和方向。');
  assert.deepEqual(parsed.citations, [{ node_id: 'n1', evidence_id: 'e1', note: 'definition' }]);
  assert.deepEqual(parsed.unsupported_claims, ['extra claim']);
  assert.deepEqual(parsed.used_node_ids, ['n1']);
});

test('validateCitations rejects evidence outside retrieved ApiUnits', () => {
  const retrieval: UnitRetrievalResponse = {
    query: '电场强度',
    source: 'main',
    mode: 'text_only',
    requested_mode: 'text',
    hits: [{
      node_id: 'n1',
      canonical_name: '电场强度',
      node_kind: 'property',
      node_layer: '',
      score: 1,
      text_match: true,
      vector_match: false,
      similarity: null,
      reasons: ['name'],
      unit: {
        evidence: [{ id: 'e1', excerpt: 'evidence text' }],
      } as unknown as ApiUnit,
    }],
  };

  const result = validateCitations([
    { node_id: 'n1', evidence_id: 'e1' },
    { node_id: 'n1', evidence_id: 'missing' },
    { node_id: 'missing', evidence_id: 'e1' },
  ], retrieval);

  assert.deepEqual(result.valid, [{ node_id: 'n1', evidence_id: 'e1', note: undefined }]);
  assert.equal(result.invalid.length, 2);
});
