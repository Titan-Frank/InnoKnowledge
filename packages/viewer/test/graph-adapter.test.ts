import assert from 'node:assert/strict';
import test from 'node:test';
import type { KnowledgeGraph, OKMEdge, OKMNode } from '../src/core/graph/types.ts';
import { buildRadialFocusGraph, okmKnowledgeGraphToG6 } from '../src/lib/graph-adapter.ts';

function makeNode(id: string): OKMNode {
  return {
    id,
    name: id,
    description: '',
    nodeType: 'concept',
    displayTypeLabel: null,
    displayColor: null,
    nodeKind: 'concept',
    nodeSubkind: null,
    nodeLayer: 'backbone',
    aliases: [],
    frameworkRefs: [],
    properties: {},
    degree: 1,
    mentions: [],
    profiles: [],
    mentionBookIds: new Set(),
    scopeBookIds: new Set(),
    communityId: null,
  };
}

function makeEdge(id: string, from: string, to: string): OKMEdge {
  return {
    id,
    from,
    to,
    edgeType: 'related_to',
    displayLabel: null,
    displayCategory: null,
    displayColor: null,
    edgeLayer: 'backbone',
    backboneExpand: true,
    properties: {},
  };
}

test('radial focus keeps formal and semantic neighbors inside structural filters', () => {
  const nodes = [
    makeNode('center'),
    makeNode('formal-visible'),
    makeNode('formal-filtered'),
    makeNode('semantic-visible'),
    makeNode('semantic-filtered'),
  ];
  const edges = [
    makeEdge('edge-visible', 'center', 'formal-visible'),
    makeEdge('edge-filtered', 'center', 'formal-filtered'),
  ];
  const graph = {
    nodes,
    edges,
    nodeById: new Map(nodes.map((node) => [node.id, node])),
    edgeById: new Map(edges.map((edge) => [edge.id, edge])),
    booksById: new Map(),
    frameworkTopics: new Map(),
    frameworkDomains: new Map(),
    patternsById: new Map(),
    patternsByType: new Map(),
    evidenceById: new Map(),
    availableTypes: ['concept'],
    loadWarnings: [],
    source: { key: 'main' },
    manifest: null,
    nodeCount: nodes.length,
    edgeCount: edges.length,
  } satisfies KnowledgeGraph;

  const result = buildRadialFocusGraph(graph, 'center', [
    { node_id: 'semantic-visible', similarity: 0.9 },
    { node_id: 'semantic-filtered', similarity: 0.8 },
  ], new Set(['center', 'formal-visible', 'semantic-visible']));

  assert.deepEqual(result.formalNeighborIds, ['formal-visible']);
  assert.deepEqual(result.semanticNeighborIds, ['semantic-visible']);
  assert.deepEqual(result.nodeIds.sort(), ['center', 'formal-visible', 'semantic-visible']);
  assert.deepEqual(
    result.edgePairs.map((edge) => edge.id).sort(),
    ['edge-visible', 'semantic:center:semantic-visible'],
  );
});

test('2D edges carry readable relation labels while keeping them hidden in overview', () => {
  const nodes = [makeNode('source'), makeNode('target')];
  const edge = {
    ...makeEdge('edge-labelled', 'source', 'target'),
    edgeType: 'prerequisite_for',
    displayLabel: '先学这个',
    displayCategory: '学习关系',
  };
  const graph = {
    nodes,
    edges: [edge],
    nodeById: new Map(nodes.map((node) => [node.id, node])),
    edgeById: new Map([[edge.id, edge]]),
    booksById: new Map(),
    frameworkTopics: new Map(),
    frameworkDomains: new Map(),
    patternsById: new Map(),
    patternsByType: new Map(),
    evidenceById: new Map(),
    availableTypes: ['concept'],
    loadWarnings: [],
    source: { key: 'main' },
    manifest: null,
    nodeCount: nodes.length,
    edgeCount: 1,
  } satisfies KnowledgeGraph;

  const result = okmKnowledgeGraphToG6(graph, new Set(['source', 'target']), 'light');
  const renderedEdge = result.data.edges?.[0];

  assert.equal((renderedEdge?.data as Record<string, unknown>).label, '先学这个');
  assert.equal((renderedEdge?.data as Record<string, unknown>).category, '学习关系');
  assert.equal((renderedEdge?.style as Record<string, unknown>).labelText, '先学这个');
  assert.equal((renderedEdge?.style as Record<string, unknown>).label, false);
  assert.equal((renderedEdge?.style as Record<string, unknown>).labelBackground, true);
});
