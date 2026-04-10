import type { DomElements } from '../types/dom-elements.js';

export function initializeViewport(state: { transform: { x: number; y: number; scale: number } }, els: DomElements): void {
  resizeCanvas(els);
  state.transform = {
    x: els.canvas.width / 2,
    y: els.canvas.height / 2,
    scale: Math.min(1.2, els.canvas.width / 1200 + 0.25),
  };
}

export function resizeCanvas(els: DomElements): void {
  const dpr = window.devicePixelRatio || 1;
  const rect = els.canvasWrap.getBoundingClientRect();
  els.canvas.width = rect.width * dpr;
  els.canvas.height = rect.height * dpr;
  const ctx = els.canvas.getContext('2d');
  if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

export function centerOnNode(nodeId: string, state: { data: { nodeById: Map<string, { x: number; y: number }> } | null; transform: { x: number; y: number; scale: number } }, canvas: HTMLCanvasElement): void {
  const node = state.data?.nodeById.get(nodeId);
  if (!node) return;
  const dpr = window.devicePixelRatio || 1;
  state.transform.x = canvas.width / 2 - node.x * state.transform.scale * dpr;
  state.transform.y = canvas.height / 2 - node.y * state.transform.scale * dpr;
}
