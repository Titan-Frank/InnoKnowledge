import FA2Layout from 'graphology-layout-forceatlas2/worker';
import forceAtlas2 from 'graphology-layout-forceatlas2';
import noverlap from 'graphology-layout-noverlap';
import type Graph from 'graphology';

const NOVERLAP_SETTINGS = {
  maxIterations: 80,
  ratio: 1.5,
  margin: 15,
  expansion: 1.15,
};

function getFA2Settings(nodeCount: number) {
  const isSmall = nodeCount < 500;
  const isMedium = nodeCount >= 500 && nodeCount < 2000;

  return {
    // Low gravity — let clusters drift apart instead of collapsing to center
    gravity: isSmall ? 0.3 : isMedium ? 0.15 : 0.08,

    // Very high scalingRatio — strong repulsion pushes nodes apart
    scalingRatio: isSmall ? 80 : isMedium ? 150 : 300,

    slowDown: isSmall ? 1 : isMedium ? 2 : 3,
    barnesHutOptimize: nodeCount > 200,
    barnesHutTheta: nodeCount > 2000 ? 0.8 : 0.6,

    // Tell FA2 to read our custom 'mass' attribute from each node
    nodeMassAttribute: 'mass',

    strongGravityMode: false,
    outboundAttractionDistribution: true,

    // linLogMode produces tighter clusters with more space between them
    linLogMode: true,

    adjustSizes: true,
    edgeWeightInfluence: 1,
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

  graph.forEachNode((node, attrs) => {
    if (typeof attrs.x !== 'number' || !isFinite(attrs.x)) {
      graph.setNodeAttribute(node, 'x', Math.random() * 100);
    }
    if (typeof attrs.y !== 'number' || !isFinite(attrs.y)) {
      graph.setNodeAttribute(node, 'y', Math.random() * 100);
    }
  });

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

  graph.forEachNode((node, attrs) => {
    if (typeof attrs.x !== 'number' || !isFinite(attrs.x)) {
      graph.setNodeAttribute(node, 'x', Math.random() * 100);
    }
    if (typeof attrs.y !== 'number' || !isFinite(attrs.y)) {
      graph.setNodeAttribute(node, 'y', Math.random() * 100);
    }
  });

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
  noverlap.assign(graph, {
    maxIterations: NOVERLAP_SETTINGS.maxIterations,
    settings: {
      margin: NOVERLAP_SETTINGS.margin,
      ratio: NOVERLAP_SETTINGS.ratio,
      expansion: NOVERLAP_SETTINGS.expansion,
    },
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
