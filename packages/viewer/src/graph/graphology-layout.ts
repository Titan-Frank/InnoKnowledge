import FA2Layout from 'graphology-layout-forceatlas2/worker';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import noverlap from 'graphology-layout-noverlap';
import type Graph from 'graphology';

type LayoutNodeRecord = {
  id: string;
  x: number;
  y: number;
  radius: number;
};

const NOVERLAP_SETTINGS = {
  maxIterations: 160,
  ratio: 1.9,
  margin: 18,
  expansion: 1.25,
};

const FINAL_COLLISION_PASSES = 8;

function getNodeRadius(attrs: Record<string, unknown>): number {
  const collisionRadius = attrs.collisionRadius;
  if (typeof collisionRadius === 'number' && isFinite(collisionRadius)) {
    return collisionRadius;
  }

  const size = attrs.size;
  if (typeof size === 'number' && isFinite(size)) {
    return size + 8;
  }

  return 12;
}

function getFA2Settings(nodeCount: number) {
  const isSmall = nodeCount < 500;
  const isMedium = nodeCount >= 500 && nodeCount < 2000;

  return {
    // Keep the center loose so nodes can claim their own space
    gravity: isSmall ? 0.06 : isMedium ? 0.04 : 0.025,

    // Strong repulsion prevents tight bundles from collapsing into each other
    scalingRatio: isSmall ? 140 : isMedium ? 220 : 360,

    slowDown: isSmall ? 2 : isMedium ? 3 : 4,
    barnesHutOptimize: nodeCount > 200,
    barnesHutTheta: nodeCount > 2000 ? 0.8 : 0.6,

    // Tell FA2 to read our custom 'mass' attribute from each node
    nodeMassAttribute: 'mass',

    strongGravityMode: false,
    outboundAttractionDistribution: true,

    // linLogMode produces tighter clusters with more space between them
    linLogMode: true,

    adjustSizes: true,
    edgeWeightInfluence: 0.7,
  };
}

function getLayoutDuration(nodeCount: number): number {
  if (nodeCount > 10000) return 45000;
  if (nodeCount > 5000) return 35000;
  if (nodeCount > 2000) return 30000;
  if (nodeCount > 500) return 25000;
  return 20000;
}

/** Synchronous layout (fallback) */
export function runLayout(graph: Graph): void {
  const nodeCount = graph.order;
  if (nodeCount === 0) return;

  ensureSeedPositions(graph);
  fanOutCoincidentNodes(graph);

  const inferredSettings = forceAtlas2.inferSettings(graph);
  const customSettings = getFA2Settings(nodeCount);
  const settings = { ...inferredSettings, ...customSettings };

  const iterations = nodeCount > 500 ? 300 : nodeCount > 100 ? 200 : 100;
  forceAtlas2.assign(graph, { iterations, settings });

  runNoverlap(graph);
  normalizePositions(graph);
}

/** Start FA2 in a Web Worker with auto-stop. Returns controls. */
export function startWorkerLayout(
  graph: Graph,
  onStopped?: () => void,
): { stop: () => void; kill: () => void } {
  const nodeCount = graph.order;
  if (nodeCount === 0) return { stop: () => {}, kill: () => {} };

  ensureSeedPositions(graph);
  fanOutCoincidentNodes(graph);

  const inferredSettings = forceAtlas2.inferSettings(graph);
  const customSettings = getFA2Settings(nodeCount);
  const settings = { ...inferredSettings, ...customSettings };

  const layout = new FA2Layout(graph, { settings });
  layout.start();

  const duration = getLayoutDuration(nodeCount);
  const timeout = setTimeout(() => {
    layout.stop();
    runNoverlap(graph);
    normalizePositions(graph);
    onStopped?.();
  }, duration);

  return {
    stop: () => {
      clearTimeout(timeout);
      layout.stop();
      runNoverlap(graph);
      normalizePositions(graph);
      onStopped?.();
    },
    kill: () => {
      clearTimeout(timeout);
      layout.kill();
    },
  };
}

function runNoverlap(graph: Graph): void {
  const passes = [
    {
      maxIterations: NOVERLAP_SETTINGS.maxIterations,
      settings: {
        margin: NOVERLAP_SETTINGS.margin,
        ratio: NOVERLAP_SETTINGS.ratio,
        expansion: NOVERLAP_SETTINGS.expansion,
      },
    },
    {
      maxIterations: Math.round(NOVERLAP_SETTINGS.maxIterations * 0.75),
      settings: {
        margin: NOVERLAP_SETTINGS.margin + 4,
        ratio: NOVERLAP_SETTINGS.ratio + 0.15,
        expansion: NOVERLAP_SETTINGS.expansion + 0.05,
      },
    },
  ];

  for (const pass of passes) {
    noverlap.assign(graph, {
      ...pass,
      inputReducer: (_, attrs) => ({
        ...attrs,
        size: getNodeRadius(attrs as Record<string, unknown>),
      }),
    });
  }

  resolveResidualCollisions(graph);
}

function normalizePositions(graph: Graph): void {
  let minX = Infinity;
  let minY = Infinity;
  graph.forEachNode((_, attrs) => {
    if (attrs.x < minX) minX = attrs.x;
    if (attrs.y < minY) minY = attrs.y;
  });
  if (isFinite(minX) && isFinite(minY)) {
    const offsetX = minX - 50;
    const offsetY = minY - 50;
    graph.forEachNode((node, attrs) => {
      graph.setNodeAttribute(node, 'x', attrs.x - offsetX);
      graph.setNodeAttribute(node, 'y', attrs.y - offsetY);
    });
  }
}

function ensureSeedPositions(graph: Graph): void {
  graph.forEachNode((node, attrs) => {
    if (typeof attrs.x !== 'number' || !isFinite(attrs.x)) {
      graph.setNodeAttribute(node, 'x', Math.random() * 100);
    }
    if (typeof attrs.y !== 'number' || !isFinite(attrs.y)) {
      graph.setNodeAttribute(node, 'y', Math.random() * 100);
    }
  });
}

function collectLayoutNodes(graph: Graph): LayoutNodeRecord[] {
  const nodes: LayoutNodeRecord[] = [];

  graph.forEachNode((id, attrs) => {
    nodes.push({
      id,
      x: attrs.x as number,
      y: attrs.y as number,
      radius: getNodeRadius(attrs as Record<string, unknown>),
    });
  });

  return nodes;
}

function fanOutCoincidentNodes(graph: Graph): void {
  const buckets = new Map<string, LayoutNodeRecord[]>();

  graph.forEachNode((id, attrs) => {
    const x = attrs.x as number;
    const y = attrs.y as number;
    const key = `${Math.round(x * 10) / 10}:${Math.round(y * 10) / 10}`;
    const record: LayoutNodeRecord = {
      id,
      x,
      y,
      radius: getNodeRadius(attrs as Record<string, unknown>),
    };

    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(record);
  });

  for (const nodes of buckets.values()) {
    if (nodes.length < 2) continue;

    const maxRadius = nodes.reduce((largest, node) => Math.max(largest, node.radius), 0);
    const spreadRadius = maxRadius * 1.6 + 12;

    nodes.forEach((node, index) => {
      const angle = (index / nodes.length) * Math.PI * 2;
      graph.setNodeAttribute(node.id, 'x', node.x + Math.cos(angle) * spreadRadius);
      graph.setNodeAttribute(node.id, 'y', node.y + Math.sin(angle) * spreadRadius);
    });
  }
}

function resolveResidualCollisions(graph: Graph): void {
  const nodes = collectLayoutNodes(graph);
  if (nodes.length < 2) return;

  const maxRadius = nodes.reduce((largest, node) => Math.max(largest, node.radius), 0);
  const cellSize = Math.max(24, maxRadius * 2.5);

  for (let pass = 0; pass < FINAL_COLLISION_PASSES; pass += 1) {
    const latest = collectLayoutNodes(graph);
    const buckets = new Map<string, LayoutNodeRecord[]>();
    const shifts = new Map<string, { dx: number; dy: number }>();
    let overlapCount = 0;

    latest.forEach((node) => {
      const cellX = Math.floor(node.x / cellSize);
      const cellY = Math.floor(node.y / cellSize);
      const key = `${cellX}:${cellY}`;
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key)!.push(node);
      shifts.set(node.id, { dx: 0, dy: 0 });
    });

    latest.forEach((node) => {
      const cellX = Math.floor(node.x / cellSize);
      const cellY = Math.floor(node.y / cellSize);

      for (let dx = -1; dx <= 1; dx += 1) {
        for (let dy = -1; dy <= 1; dy += 1) {
          const bucket = buckets.get(`${cellX + dx}:${cellY + dy}`);
          if (!bucket) continue;

          for (const other of bucket) {
            if (other.id <= node.id) continue;

            const deltaX = other.x - node.x;
            const deltaY = other.y - node.y;
            const distance = Math.hypot(deltaX, deltaY);
            const minimumDistance = node.radius + other.radius;

            if (distance >= minimumDistance) continue;

            overlapCount += 1;

            const safeDistance = distance || 0.001;
            const overlap = minimumDistance - safeDistance + 1;
            const pushX = (deltaX / safeDistance) * overlap * 0.5;
            const pushY = (deltaY / safeDistance) * overlap * 0.5;

            const currentShift = shifts.get(node.id)!;
            currentShift.dx -= pushX;
            currentShift.dy -= pushY;

            const otherShift = shifts.get(other.id)!;
            otherShift.dx += pushX;
            otherShift.dy += pushY;
          }
        }
      }
    });

    if (overlapCount === 0) break;

    shifts.forEach((shift, nodeId) => {
      const attrs = graph.getNodeAttributes(nodeId);
      graph.setNodeAttribute(nodeId, 'x', (attrs.x as number) + shift.dx);
      graph.setNodeAttribute(nodeId, 'y', (attrs.y as number) + shift.dy);
    });
  }
}
