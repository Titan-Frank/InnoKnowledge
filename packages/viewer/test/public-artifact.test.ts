import assert from 'node:assert/strict';
import test from 'node:test';
import type { ApiNode } from '@okm/types';
import {
  createPublicArtifactBundle,
  createPublicArtifactMeta,
  findPublicArtifactUnitFile,
  searchPublicArtifactNodes,
  type PublicArtifactGraph,
  type PublicArtifactManifest,
} from '../src/services/public-artifact.ts';

const node = {
  id: 'concept:test',
  canonical_name: '电容触摸屏',
  node_kind: 'concept',
  node_subkind: 'application',
  aliases: ['触控屏'],
  definition: '通过电容变化识别触摸位置。',
  tags: ['电学'],
  properties: {},
} as ApiNode;

const graph: PublicArtifactGraph = {
  dataset: { dataset_id: 'main', root_path: 'data/main' },
  source: { key: 'main', label: 'MAIN', description: 'PostgreSQL dataset main' },
  nodes: [node],
  edges: [],
  profiles: [],
};

const manifest: PublicArtifactManifest = {
  artifact_version: 'v0.1.0',
  source_database: {
    dataset_id: 'main',
    dataset_name: 'main',
    root_path: 'data/main',
    sources: [{ book_id: 'physics-book' }],
  },
};

test('adapts the public manifest and graph to the regular viewer contracts', () => {
  const meta = createPublicArtifactMeta(manifest, graph);
  const bundle = createPublicArtifactBundle(graph, '../data/units');

  assert.equal(meta.active_source, 'main');
  assert.equal(meta.sources[0]?.book_count, 1);
  assert.equal(meta.sources[0]?.books[0]?.book_id, 'physics-book');
  assert.equal(meta.manifest.artifact_version, 'v0.1.0');
  assert.equal(bundle.source.nodeCardPath, '../data/units');
  assert.equal(bundle.nodes[0]?.id, node.id);
  assert.deepEqual(bundle.framework.domains, []);
});

test('finds unit files and performs local text search without a server', () => {
  const file = findPublicArtifactUnitFile({
    units: [{ node_id: node.id, name: node.canonical_name!, kind: 'concept', file: 'unit-000001.json' }],
  }, node.id);
  const byName = searchPublicArtifactNodes(graph, '电容触摸', 'main');
  const byAlias = searchPublicArtifactNodes(graph, '触控屏', 'main');
  const missing = searchPublicArtifactNodes(graph, '不存在', 'main');

  assert.equal(file, 'unit-000001.json');
  assert.equal(byName.hits[0]?.id, node.id);
  assert.equal(byName.hits[0]?.score, 0.95);
  assert.equal(byAlias.hits[0]?.id, node.id);
  assert.equal(missing.hits.length, 0);
});
