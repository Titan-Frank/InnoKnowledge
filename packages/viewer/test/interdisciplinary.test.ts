import assert from 'node:assert/strict';
import test from 'node:test';
import type { InterdisciplinaryCandidate } from '@okm/types';
import { candidateMatchesDomainPair, reviewReadiness } from '../src/lib/interdisciplinary.ts';

function candidate(overrides: Partial<InterdisciplinaryCandidate> = {}): InterdisciplinaryCandidate {
  return {
    candidate_id: 'candidate:1',
    run_id: 'run:1',
    candidate_kind: 'relation',
    from_node_id: 'node:a',
    from_node_name: '能量',
    from_node_kind: 'concept',
    from_node_definition: '物体或系统做功的能力。',
    to_node_id: 'node:b',
    to_node_name: '能量守恒',
    to_node_kind: 'rule',
    to_node_definition: '能量不会凭空产生或消失。',
    proposed_edge_type: 'related_to',
    directionality: 'undirected',
    confidence: 0.72,
    source_domains: ['physics'],
    target_domains: ['chemistry'],
    evidence_refs: ['evidence:1'],
    evidence: [{
      evidence_id: 'evidence:1',
      source_id: 'book-a',
      anchor_ref: 'lesson-a',
      excerpt: '反应前后能量保持守恒。',
      locator: 'p.12',
      modality: 'text',
      page_start: 12,
      page_end: 12,
    }],
    rationale: {},
    status: 'pending',
    reviewer: null,
    review_notes: null,
    reviewed_at: null,
    applied_edge_id: null,
    created_at: '2026-07-13T00:00:00Z',
    updated_at: '2026-07-13T00:00:00Z',
    ...overrides,
  };
}

test('relation approval remains blocked until evidence is selected', () => {
  assert.equal(reviewReadiness(candidate(), []).ready, false);
  assert.equal(reviewReadiness(candidate(), ['evidence:1']).ready, true);
  assert.equal(reviewReadiness(candidate(), ['evidence:stale']).ready, false);
  assert.equal(reviewReadiness(candidate({ evidence: [] }), ['evidence:1']).ready, false);
});

test('node alignment approval does not require relation evidence', () => {
  const result = reviewReadiness(candidate({ candidate_kind: 'node_alignment', evidence: [] }), []);
  assert.equal(result.ready, true);
  assert.match(result.message, /归并/);
});

test('domain-pair filtering is direction independent', () => {
  assert.equal(candidateMatchesDomainPair(candidate(), 'physics', 'chemistry'), true);
  assert.equal(candidateMatchesDomainPair(candidate(), 'chemistry', 'physics'), true);
  assert.equal(candidateMatchesDomainPair(candidate(), 'physics', 'biology'), false);
});
