import assert from 'node:assert/strict';
import test from 'node:test';
import type { KnowledgeGraph, OKMNode } from '../src/core/graph/types.ts';
import { okmKnowledgeGraphToG6 } from '../src/lib/graph-adapter.ts';

function createNode(
  id: string,
  communityId: number | null,
  layout?: { x: number; y: number },
): OKMNode {
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
    properties: layout ? { layout } : {},
    degree: 0,
    mentions: [],
    profiles: [],
    mentionBookIds: new Set(),
    scopeBookIds: new Set(),
    communityId,
  };
}

function createGraph(nodes: OKMNode[]): KnowledgeGraph {
  return {
    nodes,
    edges: [],
    nodeById: new Map(nodes.map((node) => [node.id, node])),
    edgeById: new Map(),
    booksById: new Map(),
    frameworkTopics: new Map(),
    frameworkDomains: new Map(),
    patternsById: new Map(),
    patternsByType: new Map(),
    evidenceById: new Map(),
    availableTypes: ['concept'],
    loadWarnings: [],
    source: {},
    manifest: null,
    nodeCount: nodes.length,
    edgeCount: 0,
  };
}

function nodePosition(graph: ReturnType<typeof okmKnowledgeGraphToG6>, id: string) {
  const node = graph.data.nodes?.find((candidate) => candidate.id === id);
  return { x: Number(node?.style?.x), y: Number(node?.style?.y) };
}

test('builds complete stable positions from stored semantic groups', () => {
  const graph = createGraph([
    createNode('a', 0, { x: -0.4, y: -0.2 }),
    createNode('b', 0, { x: -0.3, y: -0.1 }),
    createNode('c', 0, { x: -0.2, y: -0.15 }),
    createNode('d', 1, { x: 0.2, y: 0.1 }),
    createNode('e', 1, { x: 0.4, y: 0.3 }),
    createNode('legacy', null),
  ]);

  const full = okmKnowledgeGraphToG6(graph, new Set(graph.nodes.map((node) => node.id)));
  for (const node of full.data.nodes ?? []) {
    assert.ok(Number.isFinite(Number(node.style?.x)));
    assert.ok(Number.isFinite(Number(node.style?.y)));
  }

  const filtered = okmKnowledgeGraphToG6(graph, new Set(['a']));
  assert.deepEqual(nodePosition(filtered, 'a'), nodePosition(full, 'a'));
  assert.ok(Math.hypot(
    nodePosition(full, 'a').x - nodePosition(full, 'd').x,
    nodePosition(full, 'a').y - nodePosition(full, 'd').y,
  ) > 200);
});

test('leaves layout to the force fallback when stored coverage is insufficient', () => {
  const graph = createGraph([
    createNode('a', 0, { x: 0, y: 0 }),
    createNode('b', null),
  ]);
  const result = okmKnowledgeGraphToG6(graph, new Set(['a', 'b']));

  for (const node of result.data.nodes ?? []) {
    assert.equal(node.style?.x, undefined);
    assert.equal(node.style?.y, undefined);
  }
});
