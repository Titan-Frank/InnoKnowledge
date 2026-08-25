import assert from 'node:assert/strict';
import test from 'node:test';
import type { BuildResult } from '../src/lib/graph-adapter';
import { buildGraph3DData, escapeGraphTooltip, resolveGraph3DLabelIds } from '../src/lib/graph-3d';

const BUILD: BuildResult = {
  data: {
    nodes: [
      { id: 'n1', data: { label: '力', nodeType: 'concept', nodeLayer: 'backbone', degree: 8 }, style: { fill: '#555aff', size: 26 } },
      { id: 'n2', data: { label: '物体', nodeType: 'entity', nodeLayer: 'support', degree: 2 }, style: { fill: '#3782ff', size: 20 } },
    ],
    edges: [
      { id: 'e1', source: 'n1', target: 'n2', data: { category: '关联' }, style: { stroke: '#8c55ff', lineWidth: 1.5 } },
    ],
  },
  communityCount: 0,
  communities: [],
  communityMap: new Map(),
  nodeIds: ['n1', 'n2'],
  edgePairs: [{ id: 'e1', source: 'n1', target: 'n2' }],
  communitySource: 'topology',
};

test('buildGraph3DData preserves graph identity and visual metadata', () => {
  const result = buildGraph3DData(BUILD);
  assert.deepEqual(result.nodes.map((node) => node.id), ['n1', 'n2']);
  assert.equal(result.nodes[0]?.label, '力');
  assert.equal(result.nodes[0]?.color, '#555aff');
  assert.equal(result.nodes[0]?.visibleDegree, 1);
  assert.equal(result.links[0]?.source, 'n1');
  assert.equal(result.links[0]?.target, 'n2');
  assert.equal(result.links[0]?.label, '关联');
  assert.equal(result.links[0]?.arrowLength, 3.4);
  assert.equal(result.links[0]?.dashed, false);
});

test('buildGraph3DData keeps semantic similarity links undirected', () => {
  const result = buildGraph3DData({
    ...BUILD,
    data: {
      nodes: BUILD.data.nodes,
      edges: [{
        id: 'semantic:n1:n2',
        source: 'n1',
        target: 'n2',
        data: { category: 'Embedding 语义相似' },
        style: { stroke: '#94a3b8', lineWidth: 1.2, endArrow: false },
      }],
    },
  });

  assert.equal(result.links[0]?.arrowLength, 0);
  assert.equal(result.links[0]?.dashed, false);
});

test('buildGraph3DData carries dashed semantic-link styling into 3D', () => {
  const result = buildGraph3DData({
    ...BUILD,
    data: {
      nodes: BUILD.data.nodes,
      edges: [{
        id: 'semantic:n1:n2',
        source: 'n1',
        target: 'n2',
        data: { category: 'Embedding 语义相似' },
        style: { stroke: '#94a3b8', lineWidth: 1.2, lineDash: [5, 3], endArrow: false },
      }],
    },
  });

  assert.equal(result.links[0]?.dashed, true);
  assert.equal(result.links[0]?.dashSize, 5);
  assert.equal(result.links[0]?.gapSize, 3);
});

test('resolveGraph3DLabelIds prioritizes interaction targets and important nodes', () => {
  const data = buildGraph3DData(BUILD);
  const ids = resolveGraph3DLabelIds(data.nodes, true, 'n2', new Set(['search']), null, 3);
  assert.deepEqual([...ids], ['n2', 'search', 'n1']);
  assert.equal(resolveGraph3DLabelIds(data.nodes, false, 'n2', new Set(), null).size, 0);
});

test('escapeGraphTooltip prevents graph labels from injecting markup', () => {
  assert.equal(
    escapeGraphTooltip('<img src=x onerror="alert(1)">'),
    '&lt;img src=x onerror=&quot;alert(1)&quot;&gt;',
  );
});
