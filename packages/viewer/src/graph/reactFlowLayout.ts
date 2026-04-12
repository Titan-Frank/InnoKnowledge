import type { GraphNode, GraphEdge } from '../store/types.js';

/**
 * Compute force-directed layout positions for the visible graph.
 * Runs a fixed number of iterations and returns final positions.
 * Does NOT mutate the store's node x/y/vx/vy — works on local copies.
 */
export function computeForceLayout(
  visibleNodes: GraphNode[],
  visibleEdges: GraphEdge[],
  iterations = 300,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();

  if (visibleNodes.length === 0) return positions;

  // Create local copies with better initial spread
  const localState = new Map<string, { x: number; y: number; vx: number; vy: number }>();

  // Initialize positions in a grid to avoid initial overlap
  const cols = Math.ceil(Math.sqrt(visibleNodes.length));
  const spacingX = 200;
  const spacingY = 200;
  visibleNodes.forEach((node, index) => {
    const col = index % cols;
    const row = Math.floor(index / cols);
    // Use grid as initial position, ignoring the tiny circular layout from prepareGraphData
    localState.set(node.id, {
      x: col * spacingX,
      y: row * spacingY,
      vx: 0,
      vy: 0,
    });
  });

  // Build edge lookup using node IDs (not GraphNode refs)
  const edgePairs = visibleEdges.map((edge) => ({
    sourceId: edge.from,
    targetId: edge.to,
  }));

  const centering = 0.002;
  const repulsion = 8000;
  const spring = 0.006;
  const idealLength = 180;
  const damping = 0.85;

  for (let iter = 0; iter < iterations; iter++) {
    // Reduce forces over time for stability
    const cooling = 1 - iter / iterations;

    // Repulsion between all node pairs
    for (let i = 0; i < visibleNodes.length; i++) {
      const a = localState.get(visibleNodes[i].id)!;
      for (let j = i + 1; j < visibleNodes.length; j++) {
        const b = localState.get(visibleNodes[j].id)!;
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let distSq = dx * dx + dy * dy;
        if (distSq < 1) {
          dx = (Math.random() - 0.5) * 2;
          dy = (Math.random() - 0.5) * 2;
          distSq = dx * dx + dy * dy;
        }
        const force = repulsion * cooling / distSq;
        const dist = Math.sqrt(distSq);
        const nx = dx / dist;
        const ny = dy / dist;
        a.vx -= nx * force;
        a.vy -= ny * force;
        b.vx += nx * force;
        b.vy += ny * force;
      }
    }

    // Spring forces along edges
    for (const { sourceId, targetId } of edgePairs) {
      const source = localState.get(sourceId);
      const target = localState.get(targetId);
      if (!source || !target) continue;

      const dx = target.x - source.x;
      const dy = target.y - source.y;
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const delta = dist - idealLength;
      const nx = dx / dist;
      const ny = dy / dist;
      const force = delta * spring;
      source.vx += nx * force;
      source.vy += ny * force;
      target.vx -= nx * force;
      target.vy -= ny * force;
    }

    // Apply centering, damping, and update positions
    for (const node of visibleNodes) {
      const s = localState.get(node.id)!;
      s.vx += -s.x * centering;
      s.vy += -s.y * centering;
      s.vx *= damping;
      s.vy *= damping;
      // Clamp velocity to prevent explosion
      const maxV = 50;
      s.vx = Math.max(-maxV, Math.min(maxV, s.vx));
      s.vy = Math.max(-maxV, Math.min(maxV, s.vy));
      s.x += s.vx;
      s.y += s.vy;
    }
  }

  // Extract final positions
  visibleNodes.forEach((node) => {
    const s = localState.get(node.id)!;
    positions.set(node.id, { x: s.x, y: s.y });
  });

  return positions;
}
