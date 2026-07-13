import assert from 'node:assert/strict';
import test from 'node:test';
import type { InterdisciplinaryCandidate } from '@okm/types';
import { candidateMatchesDomainPair, relationTypeLabel, reviewReadiness } from '../src/lib/interdisciplinary.ts';

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

test('bridge path approval requires direct evidence for both segments', () => {
  const bridgeCandidate = candidate({
    candidate_kind: 'bridge_path',
    bridge_node_id: 'node:bridge',
    bridge_node_name: '变化率',
    bridge_node_kind: 'concept',
    bridge_node_definition: '描述量随另一变量变化的快慢。',
    bridge_node_domains: ['general'],
    proposed_edge_type: null,
    proposed_path: [
      {
        from_node_id: 'node:a',
        from_node_name: '导数',
        to_node_id: 'node:bridge',
        to_node_name: '变化率',
        relation_type: 'formalizes',
        relation_type_label_zh: '形式化表达',
        directionality: 'directed',
        evidence_refs: ['evidence:1'],
      },
      {
        from_node_id: 'node:bridge',
        from_node_name: '变化率',
        to_node_id: 'node:b',
        to_node_name: '速度',
        relation_type: 'applies_to',
        relation_type_label_zh: '应用于',
        directionality: 'directed',
        evidence_refs: ['evidence:2'],
      },
    ],
    evidence_refs: ['evidence:1', 'evidence:2'],
    evidence: [
      candidate().evidence[0]!,
      { ...candidate().evidence[0]!, evidence_id: 'evidence:2', excerpt: '速度刻画位置对时间的变化率。' },
    ],
  });

  assert.equal(reviewReadiness(bridgeCandidate, [], [['evidence:1'], []]).ready, false);
  assert.equal(reviewReadiness(bridgeCandidate, [], [['evidence:1'], ['evidence:1']]).ready, false);
  assert.equal(reviewReadiness(bridgeCandidate, [], [['evidence:1'], ['evidence:2']]).ready, true);
});

test('relation selectors use Chinese labels', () => {
  assert.equal(relationTypeLabel('formalizes'), '形式化表达');
  assert.equal(relationTypeLabel('applies_to'), '应用于');
});
