import type { GraphNode } from '../store/types.js';
import type { AppState } from '../store/types.js';
import { useGraphStore } from '../store/graphStore.js';
import { getVisibleNodes } from './visibility.js';
import { selectNode as selectNodeAction } from '../store/graphStore.js';

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
  canvas: HTMLCanvasElement,
): void {
  const state = useGraphStore.getState();
  const rect = canvas.getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const node = pickNode(x, y, state);

  if (node) {
    useGraphStore.setState({ dragNodeId: node.id });
    node.fx = node.x;
    node.fy = node.y;
    selectNodeAction(node.id);
  } else {
    useGraphStore.setState({ panning: true });
  }

  useGraphStore.setState({ lastPointer: { x: event.clientX, y: event.clientY } });
  canvas.setPointerCapture(event.pointerId);
}

export function onPointerMove(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
): void {
  const state = useGraphStore.getState();
  const rect = canvas.getBoundingClientRect();
  const localX = event.clientX - rect.left;
  const localY = event.clientY - rect.top;
  const hoveredNode = pickNode(localX, localY, state);
  useGraphStore.setState({ hoverNodeId: hoveredNode?.id || null });

  if (state.dragNodeId) {
    const node = state.data?.nodeById.get(state.dragNodeId);
    if (node) {
      const point = screenToGraph(localX, localY, state);
      node.fx = point.x;
      node.fy = point.y;
    }
  } else if (state.panning && state.lastPointer) {
    const dx = event.clientX - state.lastPointer.x;
    const dy = event.clientY - state.lastPointer.y;
    const dpr = window.devicePixelRatio || 1;
    useGraphStore.setState({
      transform: {
        x: state.transform.x + dx * dpr,
        y: state.transform.y + dy * dpr,
        scale: state.transform.scale,
      },
      lastPointer: { x: event.clientX, y: event.clientY },
    });
  }
}

export function onPointerUp(
  event: PointerEvent,
  canvas: HTMLCanvasElement,
): void {
  const state = useGraphStore.getState();
  if (state.dragNodeId) {
    const node = state.data?.nodeById.get(state.dragNodeId);
    if (node) {
      node.fx = null;
      node.fy = null;
    }
  }
  useGraphStore.setState({
    dragNodeId: null,
    panning: false,
    lastPointer: null,
  });
  if (event.pointerId != null) {
    try {
      canvas.releasePointerCapture(event.pointerId);
    } catch {
      // ignore release errors
    }
  }
}

export function onWheel(event: WheelEvent): void {
  event.preventDefault();
  const state = useGraphStore.getState();
  const rect = (event.target as HTMLElement).getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const zoom = Math.exp(-event.deltaY * 0.0012);
  const current = screenToGraph(x, y, state);
  const newScale = clamp(state.transform.scale * zoom, 0.32, 2.45);
  const after = screenToGraph(x, y, { ...state, transform: { ...state.transform, scale: newScale } });
  const dpr = window.devicePixelRatio || 1;
  useGraphStore.setState({
    transform: {
      x: state.transform.x + (after.x - current.x) * newScale * dpr,
      y: state.transform.y + (after.y - current.y) * newScale * dpr,
      scale: newScale,
    },
  });
}
