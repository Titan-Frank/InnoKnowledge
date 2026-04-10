import type { AppState, GraphNode } from '../state.js';
import type { DomElements } from '../types/dom-elements.js';
import { getVisibleNodes } from './visibility.js';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function screenToGraph(x: number, y: number, state: AppState): { x: number; y: number } {
  const dpr = window.devicePixelRatio || 1;
  return {
    x: (x - state.transform.x / dpr) / state.transform.scale,
    y: (y - state.transform.y / dpr) / state.transform.scale,
  };
}

export function graphToScreen(node: GraphNode, state: AppState): { x: number; y: number } {
  const dpr = window.devicePixelRatio || 1;
  return {
    x: node.x * state.transform.scale + state.transform.x / dpr,
    y: node.y * state.transform.scale + state.transform.y / dpr,
  };
}

function pickNode(x: number, y: number, state: AppState): GraphNode | null {
  const point = screenToGraph(x, y, state);
  const visibleNodes = getVisibleNodes(state);
  for (let i = visibleNodes.length - 1; i >= 0; i -= 1) {
    const node = visibleNodes[i];
    const dx = point.x - node.x;
    const dy = point.y - node.y;
    if (Math.sqrt(dx * dx + dy * dy) <= node.radius + 6) {
      return node;
    }
  }
  return null;
}

export function onPointerDown(
  event: PointerEvent,
  state: AppState,
  els: DomElements,
  selectNode: (nodeId: string, recenter?: boolean) => void,
): void {
  const rect = els.canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const node = pickNode(x, y, state);

  if (node) {
    state.dragNodeId = node.id;
    node.fx = node.x;
    node.fy = node.y;
    selectNode(node.id);
  } else {
    state.panning = true;
  }

  state.lastPointer = { x: event.clientX, y: event.clientY };
  els.canvas.setPointerCapture(event.pointerId);
}

export function onPointerMove(
  event: PointerEvent,
  state: AppState,
  els: DomElements,
  draw: () => void,
): void {
  const rect = els.canvas.getBoundingClientRect();
  const localX = event.clientX - rect.left;
  const localY = event.clientY - rect.top;
  const hoveredNode = pickNode(localX, localY, state);
  state.hoverNodeId = hoveredNode?.id || null;

  if (state.dragNodeId) {
    const node = state.data!.nodeById.get(state.dragNodeId);
    if (node) {
      const point = screenToGraph(localX, localY, state);
      node.fx = point.x;
      node.fy = point.y;
    }
  } else if (state.panning && state.lastPointer) {
    const dx = event.clientX - state.lastPointer.x;
    const dy = event.clientY - state.lastPointer.y;
    state.transform.x += dx * (window.devicePixelRatio || 1);
    state.transform.y += dy * (window.devicePixelRatio || 1);
    state.lastPointer = { x: event.clientX, y: event.clientY };
  }

  draw();
}

export function onPointerUp(
  event: PointerEvent,
  state: AppState,
  els: DomElements,
): void {
  if (state.dragNodeId) {
    const node = state.data!.nodeById.get(state.dragNodeId);
    if (node) {
      node.fx = null;
      node.fy = null;
    }
  }
  state.dragNodeId = null;
  state.panning = false;
  state.lastPointer = null;
  if (event.pointerId != null) {
    try {
      els.canvas.releasePointerCapture(event.pointerId);
    } catch {
      // ignore release errors
    }
  }
}

export function onWheel(event: WheelEvent, state: AppState, draw: () => void): void {
  event.preventDefault();
  const rect = (event.target as HTMLElement).getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const zoom = Math.exp(-event.deltaY * 0.0012);
  const current = screenToGraph(x, y, state);
  state.transform.scale = clamp(state.transform.scale * zoom, 0.32, 2.45);
  const after = screenToGraph(x, y, state);
  const dpr = window.devicePixelRatio || 1;
  state.transform.x += (after.x - current.x) * state.transform.scale * dpr;
  state.transform.y += (after.y - current.y) * state.transform.scale * dpr;
  draw();
}
