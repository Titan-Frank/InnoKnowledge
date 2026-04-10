import type { AppState } from '../state.js';
import { getVisibleNodes, getVisibleEdges } from './visibility.js';

export function startSimulation(state: AppState, draw: () => void): void {
  const tick = () => {
    stepSimulation(state);
    draw();
    state.raf = requestAnimationFrame(tick);
  };
  if (!state.raf) {
    state.raf = requestAnimationFrame(tick);
  }
}

export function stepSimulation(state: AppState): void {
  const visibleNodes = getVisibleNodes(state);
  const visibleNodeIds = new Set(visibleNodes.map((node) => node.id));
  const visibleEdges = getVisibleEdges(visibleNodeIds, state);

  if (visibleNodes.length === 0) return;

  const centering = 0.0018;
  const repulsion = 4200;
  const spring = 0.009;
  const idealLength = 135;

  for (let i = 0; i < visibleNodes.length; i += 1) {
    const a = visibleNodes[i];
    for (let j = i + 1; j < visibleNodes.length; j += 1) {
      const b = visibleNodes[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      let distSq = dx * dx + dy * dy;
      if (distSq < 1) {
        dx = (Math.random() - 0.5) * 0.2;
        dy = (Math.random() - 0.5) * 0.2;
        distSq = dx * dx + dy * dy;
      }
      const force = repulsion / distSq;
      const dist = Math.sqrt(distSq);
      const nx = dx / dist;
      const ny = dy / dist;
      a.vx -= nx * force;
      a.vy -= ny * force;
      b.vx += nx * force;
      b.vy += ny * force;
    }
  }

  visibleEdges.forEach((edge) => {
    const dx = edge.target.x - edge.source.x;
    const dy = edge.target.y - edge.source.y;
    const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
    const delta = dist - idealLength;
    const nx = dx / dist;
    const ny = dy / dist;
    const force = delta * spring;
    edge.source.vx += nx * force;
    edge.source.vy += ny * force;
    edge.target.vx -= nx * force;
    edge.target.vy -= ny * force;
  });

  visibleNodes.forEach((node) => {
    if (node.fx != null && node.fy != null) {
      node.x = node.fx;
      node.y = node.fy;
      node.vx = 0;
      node.vy = 0;
      return;
    }

    node.vx += -node.x * centering;
    node.vy += -node.y * centering;
    node.vx *= 0.84;
    node.vy *= 0.84;
    node.x += node.vx;
    node.y += node.vy;
  });
}
