import assert from 'node:assert/strict';
import test from 'node:test';
import {
  clampGraphDevicePixelRatio,
  FINAL_FORCE_LAYOUT,
  LIGHTWEIGHT_FORCE_LAYOUT,
  reuseGraphNodePositions,
  resolveLightweightForceLayout,
  resolveStyledPreviewNodeId,
  seedGraphNodePositions,
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

test('keeps real-time force layout bounded', () => {
  assert.equal(LIGHTWEIGHT_FORCE_LAYOUT.type, 'force');
  assert.equal(LIGHTWEIGHT_FORCE_LAYOUT.animation, true);
  assert.equal(LIGHTWEIGHT_FORCE_LAYOUT.iterations, 240);
  assert.equal(LIGHTWEIGHT_FORCE_LAYOUT.minMovement, 0.9);
  assert.equal(LIGHTWEIGHT_FORCE_LAYOUT.interval, 0.03);
  assert.equal('enableWorker' in LIGHTWEIGHT_FORCE_LAYOUT, false);
});

test('finishes an animated layout with a complete static settling pass', () => {
  const layout = resolveLightweightForceLayout(false, 90);
  assert.ok(Array.isArray(layout));
  assert.equal(layout.length, 2);
  assert.equal(layout[0].animation, true);
  assert.equal(layout[0].iterations, 240);
  assert.equal(layout[1].animation, false);
  assert.equal(layout[1].iterations, 900);
  assert.equal(layout[1].minMovement, 0.4);
});

test('bounds the animated pass for a large graph before final settling', () => {
  const layout = resolveLightweightForceLayout(false, 182);
  assert.ok(Array.isArray(layout));
  assert.equal(layout[0].iterations, 140);
  assert.equal(layout[1], FINAL_FORCE_LAYOUT);
});

test('uses only the static settling pass when reduced motion is preferred', () => {
  const layout = resolveLightweightForceLayout(true, 90);
  assert.ok(!Array.isArray(layout));
  assert.equal(layout.animation, false);
  assert.equal(layout.iterations, 900);
});

test('assigns deterministic initial positions around the requested center', () => {
  const data = {
    nodes: [
      { id: 'leaf', data: { degree: 1 }, style: { size: 20 } },
      { id: 'hub', data: { degree: 8 }, style: { size: 26 } },
      { id: 'middle', data: { degree: 3 }, style: { size: 22 } },
    ],
    edges: [],
  };

  const first = seedGraphNodePositions(data, { x: 500, y: 320 });
  const second = seedGraphNodePositions(data, { x: 500, y: 320 });

  assert.deepEqual(first, second);
  for (const node of first.nodes ?? []) {
    assert.ok(Number.isFinite(Number(node.style?.x)));
    assert.ok(Number.isFinite(Number(node.style?.y)));
  }
  const hub = first.nodes?.find((node) => node.id === 'hub');
  assert.equal(hub?.style?.x, 500);
  assert.equal(hub?.style?.y, 320);
});

test('preserves supplied node positions while seeding only missing nodes', () => {
  const data = {
    nodes: [
      { id: 'fixed', style: { x: 40, y: 60, size: 24 } },
      { id: 'new', style: { size: 24 } },
    ],
    edges: [],
  };

  const result = seedGraphNodePositions(data, { x: 40, y: 60 });
  assert.deepEqual(result.nodes?.[0].style, { x: 40, y: 60, size: 24 });
  assert.ok(Math.hypot(
    Number(result.nodes?.[1].style?.x) - 40,
    Number(result.nodes?.[1].style?.y) - 60,
  ) >= 34);
});

test('reuses existing positions and places new nodes near positioned neighbors', () => {
  const result = reuseGraphNodePositions({
    nodes: [{ id: 'root' }, { id: 'child' }],
    edges: [{ id: 'edge-1', source: 'root', target: 'child' }],
  }, [{ id: 'root', style: { x: 100, y: 120 } }], { x: 500, y: 500 });

  assert.equal(result.shouldReusePositions, true);
  assert.equal(result.reusedNodeCount, 1);
  assert.deepEqual(result.data.nodes?.[0].style, { x: 100, y: 120 });
  const child = result.data.nodes?.[1].style;
  assert.ok(Math.hypot(Number(child?.x) - 100, Number(child?.y) - 120) <= 84);
});

test('runs a fresh layout when the new graph does not overlap the previous graph', () => {
  const data = { nodes: [{ id: 'new-node' }], edges: [] };
  const result = reuseGraphNodePositions(
    data,
    [{ id: 'old-node', style: { x: 10, y: 20 } }],
    { x: 100, y: 100 },
  );

  assert.equal(result.shouldReusePositions, false);
  assert.equal(result.data, data);
});

test('runs a fresh layout when a structural change adds too many nodes at once', () => {
  const previousNodes = Array.from({ length: 20 }, (_, index) => ({
    id: `existing-${index}`,
    style: { x: index * 10, y: index * 5 },
  }));
  const data = {
    nodes: [
      ...previousNodes.map(({ id }) => ({ id })),
      ...Array.from({ length: 20 }, (_, index) => ({ id: `new-${index}` })),
    ],
    edges: [],
  };
  const result = reuseGraphNodePositions(data, previousNodes, { x: 100, y: 100 });

  assert.equal(result.shouldReusePositions, false);
  assert.equal(result.data, data);
});

test('places multiple new siblings without overlap', () => {
  const childIds = Array.from({ length: 12 }, (_, index) => `new-${index}`);
  const result = reuseGraphNodePositions({
    nodes: [{ id: 'root', style: { size: 24 } }, ...childIds.map((id) => ({ id, style: { size: 24 } }))],
    edges: childIds.map((id, index) => ({ id: `edge-${index}`, source: 'root', target: id })),
  }, [{ id: 'root', style: { x: 100, y: 120, size: 24 } }], { x: 500, y: 500 });

  assert.equal(result.shouldReusePositions, true);
  const positions = (result.data.nodes ?? []).slice(1).map((node) => ({
    x: Number(node.style?.x),
    y: Number(node.style?.y),
  }));
  for (let left = 0; left < positions.length; left += 1) {
    for (let right = left + 1; right < positions.length; right += 1) {
      assert.ok(Math.hypot(
        positions[left].x - positions[right].x,
        positions[left].y - positions[right].y,
      ) >= 34);
    }
  }
});

test('falls back to a fresh layout when every incremental placement is occupied', () => {
  const newNodeId = 'crowded-new-node';
  let hash = 0;
  for (const character of newNodeId) hash = Math.imul(hash, 31) + character.charCodeAt(0);
  const baseAngle = ((hash >>> 0) % 360) * (Math.PI / 180);
  const goldenAngle = Math.PI * (3 - Math.sqrt(5));
  const blockers = Array.from({ length: 240 }, (_, attempt) => {
    const distance = 64 + Math.floor(attempt / 12) * 28;
    const angle = baseAngle + attempt * goldenAngle;
    return {
      id: `blocker-${attempt}`,
      style: {
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance,
        size: 24,
      },
    };
  });
  const previousNodes = [
    { id: 'root', style: { x: 0, y: 0, size: 24 } },
    ...blockers,
  ];
  const data = {
    nodes: [...previousNodes.map(({ id, style }) => ({ id, style: { size: style.size } })), { id: newNodeId }],
    edges: [{ id: 'edge-new', source: 'root', target: newNodeId }],
  };

  const result = reuseGraphNodePositions(data, previousNodes, { x: 0, y: 0 });

  assert.equal(result.shouldReusePositions, false);
  assert.equal(result.data, data);
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
});
