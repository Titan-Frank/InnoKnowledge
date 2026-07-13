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
    proposedPath: [],
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
    proposedPath: [],
    reverseEndpoints: false,
  });
});

test('relation approval accepts a Chinese relation name and stores its stable code', () => {
  const result = validateInterdisciplinaryReview({
    candidateKind: 'relation',
    proposedEdgeType: 'related_to',
    candidateDirection: 'undirected',
    candidateEvidenceIds: ['evidence:a'],
    existingEvidenceIds: new Set(['evidence:a']),
    request: {
      decision: 'approve',
      relation_type: '形式化',
      directionality: 'directed',
      evidence_ids: ['evidence:a'],
    },
  });

  assert.equal(result.proposedEdgeType, 'formalizes');
});

test('bridge path approval keeps the reviewed bridge object and normalizes Chinese relation names', () => {
  const candidatePath = [
    { from_node_id: 'node:derivative', to_node_id: 'node:rate-of-change', evidence_refs: ['evidence:a'] },
    { from_node_id: 'node:rate-of-change', to_node_id: 'node:acceleration', evidence_refs: ['evidence:b'] },
  ];
  const result = validateInterdisciplinaryReview({
    candidateKind: 'bridge_path',
    proposedEdgeType: null,
    candidateDirection: null,
    candidateEvidenceIds: ['evidence:a', 'evidence:b'],
    candidatePath,
    existingEvidenceIds: new Set(['evidence:a', 'evidence:b']),
    request: {
      decision: 'approve',
      path: [
        {
          from_node_id: 'node:derivative',
          to_node_id: 'node:rate-of-change',
          relation_type: '形式化',
          directionality: 'directed',
          evidence_ids: ['evidence:a'],
        },
        {
          from_node_id: 'node:rate-of-change',
          to_node_id: 'node:acceleration',
          relation_type: '应用于',
          directionality: 'directed',
          evidence_ids: ['evidence:b'],
        },
      ],
    },
  });

  assert.deepEqual(result.proposedPath.map((segment) => segment.relation_type), ['formalizes', 'applies_to']);
  assert.deepEqual(result.evidenceIds, ['evidence:a', 'evidence:b']);
});

test('bridge path approval rejects evidence borrowed from another segment', () => {
  assert.throws(() => validateInterdisciplinaryReview({
    candidateKind: 'bridge_path',
    proposedEdgeType: null,
    candidateDirection: null,
    candidateEvidenceIds: ['evidence:a', 'evidence:b'],
    candidatePath: [
      { from_node_id: 'node:a', to_node_id: 'node:bridge', evidence_refs: ['evidence:a'] },
      { from_node_id: 'node:bridge', to_node_id: 'node:b', evidence_refs: ['evidence:b'] },
    ],
    existingEvidenceIds: new Set(['evidence:a', 'evidence:b']),
    request: {
      decision: 'approve',
      path: [
        { from_node_id: 'node:a', to_node_id: 'node:bridge', relation_type: '形式化', directionality: 'directed', evidence_ids: ['evidence:a'] },
        { from_node_id: 'node:bridge', to_node_id: 'node:b', relation_type: '应用于', directionality: 'directed', evidence_ids: ['evidence:a'] },
      ],
    },
  }), (error) => error instanceof InterdisciplinaryRequestError && /不属于本段/.test(error.message));
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
  }), (error) => error instanceof InterdisciplinaryRequestError && /已停用/.test(error.message));
});
