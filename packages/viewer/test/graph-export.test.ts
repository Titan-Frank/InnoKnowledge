import assert from 'node:assert/strict';
import test from 'node:test';
import type { KnowledgeGraph, OKMNode } from '../src/core/graph/types.ts';
import type { ApiUnit } from '@okm/types';
import {
  collectApiUnitsForExport,
  createKnowledgePackageExport,
  createKnowledgePackageExportFilename,
  safeExportName,
} from '../src/lib/graph-export.ts';

const node: OKMNode = {
  id: 'concept:test',
  name: '电容触摸屏',
  description: '通过电容变化识别触摸位置。',
  nodeType: 'concept/application',
  displayTypeLabel: '应用',
  displayColor: null,
  nodeKind: 'concept',
  nodeSubkind: 'application',
  nodeLayer: 'backbone',
  aliases: ['触控屏'],
  frameworkRefs: [],
  properties: {},
  degree: 0,
  mentions: [],
  profiles: [],
  mentionBookIds: new Set(['physics-book']),
  scopeBookIds: new Set(['physics-book', 'shared-book']),
  communityId: null,
};

const graph = {
  nodes: [node],
  edges: [],
  nodeById: new Map([[node.id, node]]),
  edgeById: new Map(),
  booksById: new Map([['physics-book', {
    bookId: 'physics-book',
    outline: { title: '物理' },
    mentions: [],
    evidence: [],
  }]]),
  frameworkTopics: new Map(),
  frameworkDomains: new Map(),
  patternsById: new Map(),
  patternsByType: new Map(),
  evidenceById: new Map(),
  availableTypes: ['concept/application'],
  loadWarnings: [],
  source: { key: 'main', label: 'MAIN' },
  manifest: { executable_schema: 'world-v1.2' },
  nodeCount: 1,
  edgeCount: 0,
} satisfies KnowledgeGraph;

const unit = {
  node: { id: node.id },
  relations: { outgoing: [], incoming: [] },
  domain_profiles: [],
  mentions: [],
  evidence: [],
  media: [],
  source_fragments: [],
  card: null,
  body: null,
  completeness: { score: 0, passed: 0, total: 0, signals: [] },
} as unknown as ApiUnit;

test('exports a complete JSON-safe knowledge package with every ApiUnit', () => {
  const payload = createKnowledgePackageExport(graph, [unit], {
    datasetId: 'main',
    datasetLabel: '主知识库',
    exportedAt: '2026-08-04T08:30:00.000Z',
  });

  assert.equal(payload.export_format, 'okm-knowledge-package');
  assert.equal(payload.export_format_version, '2.0');
  assert.deepEqual(payload.dataset, { id: 'main', label: '主知识库' });
  assert.deepEqual(payload.counts, { nodes: 1, edges: 0, books: 1, evidence: 0, api_units: 1 });
  assert.deepEqual(payload.nodes[0]?.mentionBookIds, ['physics-book']);
  assert.deepEqual(payload.nodes[0]?.scopeBookIds, ['physics-book', 'shared-book']);
  assert.equal(payload.books[0]?.bookId, 'physics-book');
  assert.equal(payload.api_units[0]?.node.id, node.id);
  assert.equal(payload.asset_packaging, 'references-only');
  assert.equal(JSON.parse(JSON.stringify(payload)).nodes[0].name, '电容触摸屏');
});

test('loads ApiUnits with bounded concurrency, stable order, progress, and failure reporting', async () => {
  const progress: number[] = [];
  let active = 0;
  let maxActive = 0;
  const result = await collectApiUnitsForExport(
    ['node-a', 'node-b', 'node-c', 'node-d'],
    async (nodeId) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, nodeId === 'node-a' ? 8 : 1));
      active -= 1;
      if (nodeId === 'node-b') return null;
      if (nodeId === 'node-c') throw new Error('network');
      return { ...unit, node: { ...unit.node, id: nodeId } };
    },
    { concurrency: 2, onProgress: (completed) => progress.push(completed) },
  );

  assert.equal(maxActive, 2);
  assert.deepEqual(result.units.map((item) => item.node.id), ['node-a', 'node-d']);
  assert.deepEqual(result.failedNodeIds, ['node-b', 'node-c']);
  assert.deepEqual(progress, [1, 2, 3, 4]);
});

test('refuses to label an incomplete ApiUnit collection as a full knowledge package', () => {
  assert.throws(
    () => createKnowledgePackageExport(graph, [], { datasetId: 'main' }),
    /exactly one ApiUnit per graph node/,
  );
});

test('creates filesystem-safe and predictable JSON filenames', () => {
  assert.equal(safeExportName('  主库 / 2026  '), '主库-2026');
  assert.equal(safeExportName('***'), 'knowledge-graph');
  assert.equal(
    createKnowledgePackageExportFilename('main/data', '2026-08-04T08:30:00.000Z'),
    'okm-full-main-data-2026-08-04.json',
  );
});
