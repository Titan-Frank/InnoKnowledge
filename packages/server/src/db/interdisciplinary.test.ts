import assert from 'node:assert/strict';
import test from 'node:test';
import {
  InterdisciplinaryRequestError,
  validateInterdisciplinaryReview,
} from './interdisciplinary.js';

test('node alignment approval cannot create a relation', () => {
  const result = validateInterdisciplinaryReview({
    candidateKind: 'node_alignment',
    proposedEdgeType: null,
    candidateDirection: null,
    candidateEvidenceIds: ['evidence:a'],
    existingEvidenceIds: new Set(['evidence:a']),
    request: {
      decision: 'approve',
      relation_type: 'causes',
      evidence_ids: ['evidence:a'],
    },
  });

  assert.deepEqual(result, {
    status: 'approved',
    proposedEdgeType: null,
    directionality: null,
    evidenceIds: ['evidence:a'],
    reverseEndpoints: false,
  });
});

test('relation approval requires existing candidate evidence', () => {
  assert.throws(() => validateInterdisciplinaryReview({
    candidateKind: 'relation',
    proposedEdgeType: 'related_to',
    candidateDirection: 'undirected',
    candidateEvidenceIds: ['evidence:a'],
    existingEvidenceIds: new Set(),
    request: { decision: 'approve', evidence_ids: ['evidence:a'] },
  }), (error) => error instanceof InterdisciplinaryRequestError && /已不存在/.test(error.message));

  assert.throws(() => validateInterdisciplinaryReview({
    candidateKind: 'relation',
    proposedEdgeType: 'related_to',
    candidateDirection: 'undirected',
    candidateEvidenceIds: ['evidence:a'],
    existingEvidenceIds: new Set(['evidence:a']),
    request: { decision: 'approve' },
  }), (error) => error instanceof InterdisciplinaryRequestError && /至少要选择一条/.test(error.message));
});

test('relation approval preserves the reviewed relation contract', () => {
  const result = validateInterdisciplinaryReview({
    candidateKind: 'relation',
    proposedEdgeType: 'related_to',
    candidateDirection: 'undirected',
    candidateEvidenceIds: ['evidence:a', 'evidence:b'],
    existingEvidenceIds: new Set(['evidence:a', 'evidence:b']),
    request: {
      decision: 'approve',
      relation_type: 'causes',
      directionality: 'directed',
      evidence_ids: ['evidence:b'],
    },
  });

  assert.deepEqual(result, {
    status: 'approved',
    proposedEdgeType: 'causes',
    directionality: 'directed',
    evidenceIds: ['evidence:b'],
    reverseEndpoints: false,
  });
});

test('directed relation review can reverse endpoints but undirected review cannot', () => {
  const reversed = validateInterdisciplinaryReview({
    candidateKind: 'relation',
    proposedEdgeType: 'related_to',
    candidateDirection: 'undirected',
    candidateEvidenceIds: ['evidence:a'],
    existingEvidenceIds: new Set(['evidence:a']),
    request: {
      decision: 'approve',
      relation_type: 'causes',
      directionality: 'directed',
      reverse_direction: true,
      evidence_ids: ['evidence:a'],
    },
  });
  assert.equal(reversed.reverseEndpoints, true);

  assert.throws(() => validateInterdisciplinaryReview({
    candidateKind: 'relation',
    proposedEdgeType: 'related_to',
    candidateDirection: 'undirected',
    candidateEvidenceIds: ['evidence:a'],
    existingEvidenceIds: new Set(['evidence:a']),
    request: {
      decision: 'approve',
      directionality: 'undirected',
      reverse_direction: true,
      evidence_ids: ['evidence:a'],
    },
  }), (error) => error instanceof InterdisciplinaryRequestError && /有向关系/.test(error.message));
});

test('same_as must use identity alignment instead of a relation candidate', () => {
  assert.throws(() => validateInterdisciplinaryReview({
    candidateKind: 'relation',
    proposedEdgeType: 'related_to',
    candidateDirection: 'undirected',
    candidateEvidenceIds: ['evidence:a'],
    existingEvidenceIds: new Set(['evidence:a']),
    request: {
      decision: 'approve',
      relation_type: 'same_as',
      evidence_ids: ['evidence:a'],
    },
  }), (error) => error instanceof InterdisciplinaryRequestError && /对象对齐/.test(error.message));
});
