import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clampGraphDevicePixelRatio,
  resolveStyledPreviewNodeId,
  positionEmbeddingCommunities,
  positionRadialFocus,
} from '../src/lib/graph-performance.ts';

test('limits graph canvas pixel density on high-resolution screens', () => {
  assert.equal(clampGraphDevicePixelRatio(2), 1.5);
  assert.equal(clampGraphDevicePixelRatio(1.25), 1.25);
  assert.equal(clampGraphDevicePixelRatio(0), 1);
  assert.equal(clampGraphDevicePixelRatio(-1), 1);
  assert.equal(clampGraphDevicePixelRatio(Number.NaN), 1);
  assert.equal(clampGraphDevicePixelRatio(Number.POSITIVE_INFINITY), 1);
});

test('only applies hover preview styling when search results are visible', () => {
  assert.equal(resolveStyledPreviewNodeId(new Set(), 'node-1'), null);
  assert.equal(resolveStyledPreviewNodeId(new Set(['node-1']), 'node-1'), 'node-1');
  assert.equal(resolveStyledPreviewNodeId(new Set(['node-1']), null), null);
});

test('places embedding communities into stable separated partitions', () => {
  const data = {
    nodes: [
      { id: 'a', data: { community: 0, degree: 3 } },
      { id: 'b', data: { community: 0, degree: 1 } },
      { id: 'c', data: { community: 1, degree: 3 } },
      { id: 'd', data: { community: 1, degree: 1 } },
    ],
    edges: [],
  };
  const first = positionEmbeddingCommunities(data, { x: 500, y: 400 });
  const second = positionEmbeddingCommunities(data, { x: 500, y: 400 });
  assert.deepEqual(first, second);
  const nodes = new Map(first.nodes?.map((node) => [String(node.id), node.style]));
  assert.ok(Math.hypot(
    Number(nodes.get('a')?.x) - Number(nodes.get('c')?.x),
    Number(nodes.get('a')?.y) - Number(nodes.get('c')?.y),
  ) > 700);
});

test('places formal and semantic neighbors on separate rings', () => {
  const data = {
    nodes: ['center', 'formal-a', 'formal-b', 'semantic-a'].map((id) => ({ id })),
    edges: [],
  };
  const result = positionRadialFocus(data, { x: 300, y: 300 }, {
    type: 'radial-focus',
    centerNodeId: 'center',
    formalNeighborIds: ['formal-a', 'formal-b'],
    semanticNeighborIds: ['semantic-a'],
  });
  const nodes = new Map(result.nodes?.map((node) => [String(node.id), node]));
  const distance = (id: string) => Math.hypot(
    Number(nodes.get(id)?.style?.x) - 300,
    Number(nodes.get(id)?.style?.y) - 300,
  );
  assert.equal(distance('center'), 0);
  assert.ok(distance('semantic-a') > distance('formal-a'));
  assert.equal(nodes.get('center')?.data?.focusRole, 'center');
  assert.equal(nodes.get('semantic-a')?.data?.focusRole, 'semantic');
  assert.equal(nodes.get('formal-a')?.style?.label, true);
});
