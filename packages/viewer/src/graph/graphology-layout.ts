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

type RadiusResolver = (nodeId: string, attrs: Record<string, unknown>) => number;

// Light noverlap cleanup — matches GitNexus approach
// Heavy settings cause visible "jump apart" after layout
const NOVERLAP_SETTINGS = {
  maxIterations: 20,
  ratio: 1.1,
  margin: 10,
  expansion: 1.05,
};

const SINGLE_NODE_COLLISION_PASSES = 20;
const SINGLE_NODE_COLLISION_MARGIN = 12;

function getNodeRadius(attrs: Record<string, unknown>): number {
  const collisionRadius = attrs.collisionRadius;
  if (typeof collisionRadius === 'number' && isFinite(collisionRadius)) {
    return collisionRadius * 1.15;
  }

  const size = attrs.size;
  if (typeof size === 'number' && isFinite(size)) {
    return size * 1.8 + 10;
  }

  return 12;
}

function getResolvedNodeRadius(
  nodeId: string,
  attrs: Record<string, unknown>,
  radiusResolver?: RadiusResolver,
): number {
  if (radiusResolver) {
    return radiusResolver(nodeId, attrs);
  }
  return getNodeRadius(attrs);
}

function getFA2Settings(nodeCount: number) {
  const isSmall = nodeCount < 500;
  const isMedium = nodeCount >= 500 && nodeCount < 2000;
  const isLarge = nodeCount >= 2000 && nodeCount < 10000;

  return {
    // Moderate gravity — keeps the graph compact without collapsing
    // isolated nodes onto the center point
    gravity: isSmall ? 0.4 : isMedium ? 0.25 : isLarge ? 0.15 : 0.08,

    // Moderate repulsion — too high pushes everything outward
    scalingRatio: isSmall ? 15 : isMedium ? 30 : isLarge ? 60 : 100,

    slowDown: isSmall ? 1 : isMedium ? 2 : isLarge ? 3 : 5,
    barnesHutOptimize: nodeCount > 200,
    barnesHutTheta: nodeCount > 2000 ? 0.8 : 0.6,

    nodeMassAttribute: 'mass',

    strongGravityMode: false,
    outboundAttractionDistribution: true,

    linLogMode: false,

    adjustSizes: true,
    edgeWeightInfluence: 1,
  };
}

function getLayoutDuration(nodeCount: number): number {
  if (nodeCount > 10000) return 45000;
  if (nodeCount > 5000) return 35000;
  if (nodeCount > 1000) return 25000;
  if (nodeCount > 500) return 20000;
  return 15000;
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

/**
 * Start FA2 in a Web Worker with auto-stop.
 * Stops early when layout converges (sampled node positions stop changing),
 * or when the max duration is reached.
 *
 * When `hasSemanticLayout` is true, nodes already have PCA-based positions,
 * so we skip FA2 entirely and only run noverlap to resolve overlaps.
 */
export function startWorkerLayout(
  graph: Graph,
  onStopped?: () => void,
  hasSemanticLayout = false,
): { stop: () => void; kill: () => void } {
  const nodeCount = graph.order;
  if (nodeCount === 0) return { stop: () => {}, kill: () => {} };

  // Semantic layout (PCA) already provides good positions — just resolve overlaps
  if (hasSemanticLayout) {
    runNoverlapHeavy(graph);
    normalizePositions(graph);
    onStopped?.();
    return { stop: () => {}, kill: () => {} };
  }

  ensureSeedPositions(graph);
  fanOutCoincidentNodes(graph);

  const inferredSettings = forceAtlas2.inferSettings(graph);
  const customSettings = getFA2Settings(nodeCount);
  const settings = { ...inferredSettings, ...customSettings };

  const layout = new FA2Layout(graph, { settings });
  layout.start();

  let stopped = false;
  const doStop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(convergenceInterval);
    clearTimeout(maxTimeout);
    layout.stop();
    onStopped?.();
  };

  // Convergence detection: sample positions every 2s, stop when movement is negligible
  const CONVERGENCE_SAMPLE_INTERVAL = 2000;
  const CONVERGENCE_THRESHOLD = 0.5; // avg pixel movement per node
  const CONVERGENCE_ROUNDS_NEEDED = 2; // must be below threshold this many times in a row

  // Sample a subset of nodes for performance
  const sampleSize = Math.min(nodeCount, 50);
  const allNodeIds = graph.nodes();
  const sampleStep = Math.max(1, Math.floor(allNodeIds.length / sampleSize));
  const sampleIds: string[] = [];
  for (let i = 0; i < allNodeIds.length; i += sampleStep) {
    sampleIds.push(allNodeIds[i]);
  }

  let convergenceCount = 0;
  let prevPositions = new Map<string, { x: number; y: number }>();

  const convergenceInterval = setInterval(() => {
    let totalMovement = 0;
    let count = 0;

    sampleIds.forEach((id) => {
      if (!graph.hasNode(id)) return;
      const attrs = graph.getNodeAttributes(id);
      const x = attrs.x as number;
      const y = attrs.y as number;
      const prev = prevPositions.get(id);

      if (prev) {
        totalMovement += Math.hypot(x - prev.x, y - prev.y);
        count += 1;
      }

      prevPositions.set(id, { x, y });
    });

    if (count === 0) return;

    const avgMovement = totalMovement / count;

    if (avgMovement < CONVERGENCE_THRESHOLD) {
      convergenceCount += 1;
      if (convergenceCount >= CONVERGENCE_ROUNDS_NEEDED) {
        doStop();
      }
    } else {
      convergenceCount = 0;
    }
  }, CONVERGENCE_SAMPLE_INTERVAL);

  // Hard cap — never run longer than this
  const maxDuration = getLayoutDuration(nodeCount);
  const maxTimeout = setTimeout(doStop, maxDuration);

  return {
    stop: doStop,
    kill: () => {
      if (stopped) return;
      stopped = true;
      clearInterval(convergenceInterval);
      clearTimeout(maxTimeout);
      layout.kill();
    },
  };
}

function runNoverlap(graph: Graph): void {
  // Single light pass — GitNexus-style
  noverlap.assign(graph, {
    maxIterations: NOVERLAP_SETTINGS.maxIterations,
    settings: {
      ratio: NOVERLAP_SETTINGS.ratio,
      margin: NOVERLAP_SETTINGS.margin,
      expansion: NOVERLAP_SETTINGS.expansion,
    },
    inputReducer: (_, attrs) => ({
      ...attrs,
      size: getNodeRadius(attrs as Record<string, unknown>),
    }),
  });
}

function runNoverlapHeavy(graph: Graph): void {
  // Heavy pass for PCA-based layouts — more iterations and margin to spread
  // overlapping nodes since FA2 is not running to push them apart
  noverlap.assign(graph, {
    maxIterations: 100,
    settings: {
      ratio: 1.2,
      margin: 18,
      expansion: 1.1,
    },
    inputReducer: (_, attrs) => ({
      ...attrs,
      size: getNodeRadius(attrs as Record<string, unknown>),
    }),
  });
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

export function resolveSingleNodeCollision(
  graph: Graph,
  nodeId: string,
  radiusResolver?: RadiusResolver,
): { x: number; y: number } | null {
  if (!graph.hasNode(nodeId)) return null;

  for (let pass = 0; pass < SINGLE_NODE_COLLISION_PASSES; pass += 1) {
    const attrs = graph.getNodeAttributes(nodeId);
    const movingNode: LayoutNodeRecord = {
      id: nodeId,
      x: attrs.x as number,
      y: attrs.y as number,
      radius: getResolvedNodeRadius(nodeId, attrs as Record<string, unknown>, radiusResolver),
    };

    let shiftX = 0;
    let shiftY = 0;
    let overlapCount = 0;

    graph.forEachNode((otherId, otherAttrs) => {
      if (otherId === nodeId) return;

      const otherNode: LayoutNodeRecord = {
        id: otherId,
        x: otherAttrs.x as number,
        y: otherAttrs.y as number,
        radius: getResolvedNodeRadius(otherId, otherAttrs as Record<string, unknown>, radiusResolver),
      };

      const deltaX = movingNode.x - otherNode.x;
      const deltaY = movingNode.y - otherNode.y;
      const distance = Math.hypot(deltaX, deltaY);
      const minimumDistance = movingNode.radius + otherNode.radius + SINGLE_NODE_COLLISION_MARGIN;

      if (distance >= minimumDistance) return;

      overlapCount += 1;

      const safeDistance = distance || 0.001;
      const angle = distance > 0
        ? Math.atan2(deltaY, deltaX)
        : ((nodeId.length + otherId.length + pass) % 16) * (Math.PI / 8);
      const overlap = minimumDistance - safeDistance + 1;
      shiftX += Math.cos(angle) * overlap;
      shiftY += Math.sin(angle) * overlap;
    });

    if (overlapCount === 0) {
      return { x: movingNode.x, y: movingNode.y };
    }

    const nextX = movingNode.x + shiftX / overlapCount;
    const nextY = movingNode.y + shiftY / overlapCount;
    graph.setNodeAttribute(nodeId, 'x', nextX);
    graph.setNodeAttribute(nodeId, 'y', nextY);
  }

  const finalAttrs = graph.getNodeAttributes(nodeId);
  return { x: finalAttrs.x as number, y: finalAttrs.y as number };
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
