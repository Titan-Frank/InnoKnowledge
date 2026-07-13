import assert from 'node:assert/strict';
import test from 'node:test';

import type { ApiUnit } from '@okm/types';
import { buildApiUnitCompleteness } from './unit-completeness.js';

function baseUnit(): Omit<ApiUnit, 'completeness'> {
  return {
    node: {
      id: 'n1',
      dataset_id: 'main',
      name: '质量守恒定律',
      kind: 'rule',
      subkind: null,
      definition: '化学反应前后物质的总质量保持不变。',
      aliases: [],
      domains: ['chemistry'],
      knowledge_form: ['propositional'],
      learning_mode: ['conceptual'],
      scope: 'domain-specific',
      properties: {
        semantic_core: {
          core_claims: ['参加化学反应的各物质质量总和等于反应后生成的各物质质量总和。'],
          conditions: ['反应体系封闭，反应物和生成物都计入。'],
        },
      },
      external_ids: {},
      tags: [],
      status: 'active',
      deprecated_by: null,
      created_at: null,
      updated_at: null,
      notes: null,
    },
    relations: {
      outgoing: [{
        id: 'e1',
        dataset_id: 'main',
        type: 'represents',
        type_label_zh: '表示',
        from_id: 'n1',
        to_id: 'n2',
        directionality: 'directed',
        confidence: 0.9,
        source_refs: ['ev1'],
        properties: {},
        status: 'active',
        created_at: null,
        updated_at: null,
      }],
      incoming: [],
    },
    domain_profiles: [{
      id: 'p1',
      dataset_id: 'main',
      node_id: 'n1',
      domain: 'chemistry',
      schema_id: 'domain:chemistry:v1',
      schema_version: '1.0',
      domain_role: 'law',
      source_refs: ['ev1'],
      properties: {},
      status: 'active',
      created_at: null,
      updated_at: null,
    }],
    curriculum_projections: [{
      id: 'cp1',
      dataset_id: 'main',
      node_id: 'n1',
      domain: 'chemistry',
      curriculum_id: 'textbook:chem-grade8',
      school_stage: 'junior-secondary',
      grade_band: '八年级',
      curriculum_roles: ['core'],
      source_refs: ['ev1'],
      properties: {},
      status: 'active',
      created_at: null,
      updated_at: null,
    }],
    mentions: [{
      id: 'm1',
      dataset_id: 'main',
      source_type: 'textbook',
      source_id: 'chem-grade8',
      anchor_ref: 'struct:chem-grade8:lesson:1',
      target_type: 'node',
      target_id: 'n1',
      role: 'defines',
      source_refs: ['ev1'],
      confidence: 0.9,
      properties: {},
    }],
    evidence: [{
      id: 'ev1',
      dataset_id: 'main',
      source_type: 'textbook',
      source_id: 'chem-grade8',
      anchor_ref: 'struct:chem-grade8:lesson:1',
      excerpt: '参加化学反应的各物质的质量总和等于反应后生成的各物质的质量总和。',
      locator: '第 1 页',
      extraction_method: 'model',
      normalized_claims: [],
      properties: {},
      created_at: null,
      updated_at: null,
    }],
    media: [],
    source_fragments: [{
      source_id: 'chem-grade8',
      anchor_ref: 'struct:chem-grade8:lesson:1',
      modalities: ['text'],
      excerpts: [],
    }],
    card: {
      node_id: 'n1',
      card_layer: 'basic',
      title: '质量守恒定律',
      summary: '化学反应前后总质量守恒。',
      pattern_refs: [],
      framework_refs: [],
      profile_refs: [],
      mention_refs: ['m1'],
      source_refs: ['ev1'],
      sections: [],
      properties: {},
      status: 'active',
    },
    body: {
      node_id: 'n1',
      format: 'markdown',
      content: '质量守恒定律说明化学反应前后总质量保持不变。[source:ev1]',
      media_refs: [],
      source_refs: ['ev1'],
      generated_from: 'model_generation',
      properties: {},
      status: 'active',
    },
  };
}

test('scores a complete ApiUnit', () => {
  const completeness = buildApiUnitCompleteness(baseUnit());

  assert.equal(completeness.score, 100);
  assert.equal(completeness.passed, completeness.total);
  assert.deepEqual(
    completeness.signals.map((item) => [item.key, item.passed]),
    [
      ['node_definition', true],
      ['semantic_core', true],
      ['relations', true],
      ['evidence', true],
      ['source_fragments', true],
      ['domain_profiles', true],
      ['curriculum_projections', true],
      ['body_source_refs', true],
      ['card_summary', true],
      ['mentions', true],
    ],
  );
});

test('marks missing ApiUnit contract pieces', () => {
  const unit = baseUnit();
  unit.node.definition = '';
  unit.node.properties = {};
  unit.relations.outgoing = [];
  unit.evidence = [];
  unit.source_fragments = [];
  unit.domain_profiles = [];
  unit.curriculum_projections = [];
  unit.mentions = [];
  unit.card = null;
  unit.body = {
    ...unit.body!,
    source_refs: [],
  };

  const completeness = buildApiUnitCompleteness(unit);

  assert.equal(completeness.score, 0);
  assert.deepEqual(
    completeness.signals
      .filter((item) => !item.passed)
      .map((item) => item.key),
    [
      'node_definition',
      'semantic_core',
      'relations',
      'evidence',
      'source_fragments',
      'domain_profiles',
      'curriculum_projections',
      'body_source_refs',
      'card_summary',
      'mentions',
    ],
  );
  assert.deepEqual(
    completeness.signals
      .filter((item) => item.severity === 'required')
      .map((item) => item.key),
    ['node_definition', 'evidence', 'domain_profiles', 'mentions'],
  );
});
