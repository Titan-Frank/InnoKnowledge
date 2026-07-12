import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { OKMNode } from '../src/core/graph/types.ts';
import { DetailObjectOverview } from '../src/components/sections/DetailObjectOverview.tsx';
import { DetailProperties } from '../src/components/sections/DetailProperties.tsx';

function makeNode(overrides: Partial<OKMNode> = {}): OKMNode {
  return {
    id: 'node:fossil-fuel',
    name: '化石燃料',
    description: '煤、石油、天然气等在漫长地质历史中形成的不可再生能源。',
    nodeType: 'concept',
    displayTypeLabel: null,
    displayColor: null,
    nodeKind: 'concept',
    nodeSubkind: null,
    nodeLayer: 'backbone',
    aliases: ['传统能源', '化石能源'],
    frameworkRefs: [],
    properties: {
      domains: ['chemistry'],
      knowledge_form: ['propositional'],
      learning_modes: ['conceptual'],
      scope: 'domain-specific',
      tags: ['不可再生', '环境污染源', '工业历史'],
    },
    degree: 3,
    mentions: [],
    profiles: [],
    mentionBookIds: new Set<string>(),
    scopeBookIds: new Set<string>(),
    communityId: null,
    ...overrides,
  };
}

test('groups the object definition and governed attributes with accurate labels', () => {
  const html = renderToStaticMarkup(createElement(DetailObjectOverview, { node: makeNode() }));

  assert.match(html, /对象概览/);
  assert.match(html, /定义/);
  assert.match(html, /别名/);
  assert.match(html, /知识属性/);
  assert.match(html, /领域归属/);
  assert.match(html, /化学/);
  assert.match(html, /知识形式/);
  assert.match(html, /命题式/);
  assert.match(html, /知识维度/);
  assert.match(html, /概念性/);
  assert.match(html, /适用范围/);
  assert.match(html, /领域特定/);
  assert.match(html, /主题标签/);
  assert.match(html, /环境污染源/);
  assert.doesNotMatch(html, /学习模式|桥梁概念/);
});

test('uses legacy bridge tags only as a fallback for topic tags', () => {
  const node = makeNode({
    properties: {
      tags: [],
      bridge_tags: ['system'],
    },
  });
  const html = renderToStaticMarkup(createElement(DetailObjectOverview, { node }));

  assert.match(html, /主题标签/);
  assert.match(html, /系统/);
  assert.doesNotMatch(html, /桥梁概念/);
});

test('keeps governed and internal fields out of the collapsed supplemental properties', () => {
  const node = makeNode({
    properties: {
      semantic_core: { core_claims: ['核心命题'] },
      domains: ['chemistry'],
      knowledge_form: ['propositional'],
      learning_modes: ['conceptual'],
      scope: 'domain-specific',
      tags: ['能源'],
      template_display: { label: '概念' },
      extraction_template: 'chemistry',
      version: 'v1',
    },
  });
  const html = renderToStaticMarkup(createElement(DetailProperties, { node }));

  assert.match(html, /补充属性/);
  assert.match(html, /版本/);
  assert.doesNotMatch(html, /语义核心|知识形式|知识维度|主题标签|抽取模板|展示模板/);
});
