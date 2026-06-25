import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CanvasEvent,
  CommonEvent,
  Graph as G6Graph,
  GraphEvent,
  NodeEvent,
  type GraphData,
  type LayoutOptions,
} from '@antv/g6';
import type { G6EdgePair } from '@/lib/graph-adapter';
import type { ThemeMode } from '@/core/graph/types';

interface UseG6Options {
  onNodeClick?: (nodeId: string) => void;
  onNodeHover?: (nodeId: string | null) => void;
  onStageClick?: () => void;
  onLayoutRunningChange?: (running: boolean) => void;
  selectedNodeId: string | null;
  themeMode: ThemeMode;
  showLabels: boolean;
}

interface SetGraphPayload {
  data: GraphData;
  nodeIds: string[];
  edgePairs: G6EdgePair[];
}

const VIEWPORT_ANIMATION = { duration: 360, easing: 'ease-in-out' as const };

const DEFAULT_LAYOUT: LayoutOptions = { type: 'force' };
const DEFAULT_NODE_Z_INDEX = 0;
const DEFAULT_EDGE_Z_INDEX = 0;
const CLICK_MOVE_THRESHOLD_PX = 6;
const POST_DRAG_STAGE_SUPPRESS_MS = 220;
const STAGE_CLEAR_DEDUPE_MS = 180;

type ElementStyle = Record<string, unknown>;

interface PointerGesture {
  startedOnNode: boolean;
  startedAt: number;
  startX: number;
  startY: number;
  moved: boolean;
  endedAt: number;
}

interface GraphStyleSnapshot {
  nodeStyles: Map<string, ElementStyle>;
  edgeStyles: Map<string, ElementStyle>;
}

function getElementId(event: unknown): string | null {
  const target = (event as { target?: { id?: unknown } }).target;
  if (typeof target?.id === 'string' && target.id) return target.id;
  return null;
}

function getThemeName(themeMode: ThemeMode): 'dark' | 'light' {
  return themeMode === 'light' ? 'light' : 'dark';
}

function cloneStyle(style: unknown): ElementStyle {
  if (!style || typeof style !== 'object') return {};
  return { ...(style as ElementStyle) };
}

function createStyleSnapshot(data: GraphData): GraphStyleSnapshot {
  const nodeStyles = new Map<string, ElementStyle>();
  const edgeStyles = new Map<string, ElementStyle>();

  for (const node of data.nodes ?? []) {
    if (node.id == null) continue;
    nodeStyles.set(String(node.id), cloneStyle(node.style));
  }

  for (const edge of data.edges ?? []) {
    if (edge.id == null) continue;
    edgeStyles.set(String(edge.id), cloneStyle(edge.style));
  }

  return { nodeStyles, edgeStyles };
}

function getBaseNodeStyle(snapshot: GraphStyleSnapshot | null, nodeId: string, showLabels: boolean): ElementStyle {
  const base = cloneStyle(snapshot?.nodeStyles.get(nodeId));
  return {
    ...base,
    label: showLabels,
    opacity: 1,
    labelOpacity: 1,
    zIndex: DEFAULT_NODE_Z_INDEX,
    halo: base.halo ?? false,
    haloStrokeOpacity: base.haloStrokeOpacity ?? 0,
    haloLineWidth: base.haloLineWidth ?? 0,
  };
}

function getBaseEdgeStyle(snapshot: GraphStyleSnapshot | null, edgeId: string): ElementStyle {
  const base = cloneStyle(snapshot?.edgeStyles.get(edgeId));
  return {
    ...base,
    zIndex: DEFAULT_EDGE_Z_INDEX,
  };
}

export function useG6(options: UseG6Options) {
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<G6Graph | null>(null);
  const dataRef = useRef<SetGraphPayload | null>(null);
  const callbacksRef = useRef({
    onNodeClick: options.onNodeClick,
    onNodeHover: options.onNodeHover,
    onStageClick: options.onStageClick,
    onLayoutRunningChange: options.onLayoutRunningChange,
  });
  const selectedNodeRef = useRef<string | null>(options.selectedNodeId);
  const suppressStageClickUntilRef = useRef(0);
  const nodePointerDownAtRef = useRef(0);
  const pointerGestureRef = useRef<PointerGesture>({
    startedOnNode: false,
    startedAt: 0,
    startX: 0,
    startY: 0,
    moved: false,
    endedAt: 0,
  });
  const lastPointerGestureRef = useRef<PointerGesture>({
    startedOnNode: false,
    startedAt: 0,
    startX: 0,
    startY: 0,
    moved: false,
    endedAt: 0,
  });
  const selectionVersionRef = useRef(0);
  const styleQueueRef = useRef<Promise<void>>(Promise.resolve());
  const renderTokenRef = useRef(0);
  const styleSnapshotRef = useRef<GraphStyleSnapshot | null>(null);
  const showLabelsRef = useRef(options.showLabels);
  const [containerReady, setContainerReady] = useState(false);

  const clearSelectionFromStage = useCallback(() => {
    const now = performance.now();
    if (now < suppressStageClickUntilRef.current) return;
    if (!selectedNodeRef.current) return;

    const lastGesture = lastPointerGestureRef.current;
    const isRecentDragGesture = (
      now - lastGesture.endedAt < POST_DRAG_STAGE_SUPPRESS_MS &&
      (lastGesture.startedOnNode || lastGesture.moved)
    );
    if (isRecentDragGesture) return;

    suppressStageClickUntilRef.current = now + STAGE_CLEAR_DEDUPE_MS;
    selectedNodeRef.current = null;
    callbacksRef.current.onStageClick?.();
  }, []);

  useEffect(() => {
    callbacksRef.current = {
      onNodeClick: options.onNodeClick,
      onNodeHover: options.onNodeHover,
      onStageClick: options.onStageClick,
      onLayoutRunningChange: options.onLayoutRunningChange,
    };
  }, [options.onNodeClick, options.onNodeHover, options.onStageClick, options.onLayoutRunningChange]);

  useEffect(() => {
    selectedNodeRef.current = options.selectedNodeId;
  }, [options.selectedNodeId]);

  useEffect(() => {
    showLabelsRef.current = options.showLabels;
  }, [options.showLabels]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const checkSize = () => {
      const { width, height } = container.getBoundingClientRect();
      if (width > 0 && height > 0) setContainerReady(true);
      graphRef.current?.resize(Math.floor(width), Math.floor(height));
    };

    checkSize();
    const observer = new ResizeObserver(checkSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const applySelectionStyle = useCallback((selectedNodeId: string | null) => {
    const version = selectionVersionRef.current + 1;
    selectionVersionRef.current = version;

    styleQueueRef.current = styleQueueRef.current.catch(() => undefined).then(async () => {
      if (version !== selectionVersionRef.current) return;

      const graph = graphRef.current;
      const payload = dataRef.current;
      if (!graph || !payload) return;

      const snapshot = styleSnapshotRef.current;
      const nodeUpdates: Array<{ id: string; style: ElementStyle }> = [];
      const edgeUpdates: Array<{ id: string; style: ElementStyle }> = [];
      const relatedNodeIds = new Set<string>();
      const activeNodeId = selectedNodeId && payload.nodeIds.includes(selectedNodeId) ? selectedNodeId : null;

      if (activeNodeId) {
        for (const edge of payload.edgePairs) {
          const baseStyle = getBaseEdgeStyle(snapshot, edge.id);
          if (edge.source === activeNodeId) {
            relatedNodeIds.add(edge.target);
            edgeUpdates.push({
              id: edge.id,
              style: {
                ...baseStyle,
                lineWidth: 3,
                strokeOpacity: 0.92,
                zIndex: 10,
              },
            });
          } else if (edge.target === activeNodeId) {
            relatedNodeIds.add(edge.source);
            edgeUpdates.push({
              id: edge.id,
              style: {
                ...baseStyle,
                lineWidth: 3,
                strokeOpacity: 0.92,
                zIndex: 10,
              },
            });
          } else {
            edgeUpdates.push({
              id: edge.id,
              style: {
                ...baseStyle,
                strokeOpacity: 0.08,
                zIndex: 0,
              },
            });
          }
        }

        for (const nodeId of payload.nodeIds) {
          const baseStyle = getBaseNodeStyle(snapshot, nodeId, showLabelsRef.current);
          if (nodeId === activeNodeId) {
            nodeUpdates.push({
              id: nodeId,
              style: {
                ...baseStyle,
                lineWidth: 4,
                halo: true,
                haloLineWidth: 16,
                haloStrokeOpacity: 0.34,
                zIndex: 20,
              },
            });
          } else if (relatedNodeIds.has(nodeId)) {
            nodeUpdates.push({
              id: nodeId,
              style: {
                ...baseStyle,
                lineWidth: 3,
                halo: true,
                haloLineWidth: 10,
                haloStrokeOpacity: 0.2,
                zIndex: 12,
              },
            });
          } else {
            nodeUpdates.push({
              id: nodeId,
              style: {
                ...baseStyle,
                opacity: 0.22,
                labelOpacity: 0,
                zIndex: 1,
              },
            });
          }
        }
      } else {
        for (const edge of payload.edgePairs) {
          edgeUpdates.push({ id: edge.id, style: getBaseEdgeStyle(snapshot, edge.id) });
        }

        for (const nodeId of payload.nodeIds) {
          nodeUpdates.push({ id: nodeId, style: getBaseNodeStyle(snapshot, nodeId, showLabelsRef.current) });
        }
      }

      if (version !== selectionVersionRef.current) return;
      if (edgeUpdates.length > 0) graph.updateEdgeData(edgeUpdates);
      if (nodeUpdates.length > 0) graph.updateNodeData(nodeUpdates);
      await graph.draw();
    });
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || graphRef.current) return;

    const graph = new G6Graph({
      container,
      autoResize: true,
      theme: getThemeName(options.themeMode),
      animation: { duration: 260 },
      data: { nodes: [], edges: [] },
      layout: DEFAULT_LAYOUT,
      node: {
        type: 'circle',
      },
      edge: {
        type: 'line',
      },
      behaviors: [
        'drag-canvas',
        'zoom-canvas',
        'drag-element',
        'auto-adapt-label',
        'optimize-viewport-transform',
      ],
    });

    graphRef.current = graph;

    graph.on(NodeEvent.POINTER_DOWN, () => {
      const now = performance.now();
      nodePointerDownAtRef.current = now;
      pointerGestureRef.current.startedOnNode = true;
      suppressStageClickUntilRef.current = now + 260;
    });
    graph.on(NodeEvent.CLICK, (event) => {
      const nodeId = getElementId(event);
      if (nodeId) {
        suppressStageClickUntilRef.current = performance.now() + 180;
        callbacksRef.current.onNodeClick?.(nodeId);
      }
    });
    graph.on(NodeEvent.POINTER_ENTER, (event) => {
      const nodeId = getElementId(event);
      if (nodeId) callbacksRef.current.onNodeHover?.(nodeId);
      if (containerRef.current) containerRef.current.style.cursor = 'pointer';
    });
    graph.on(NodeEvent.POINTER_LEAVE, () => {
      callbacksRef.current.onNodeHover?.(null);
      if (containerRef.current) containerRef.current.style.cursor = 'grab';
    });
    graph.on(CanvasEvent.CLICK, clearSelectionFromStage);
    graph.on(CommonEvent.CLICK, (event) => {
      if ((event as { targetType?: string }).targetType === 'canvas') clearSelectionFromStage();
    });

    const onContainerPointerDown = (event: PointerEvent) => {
      const now = performance.now();
      const startedOnNode = now - nodePointerDownAtRef.current < 80;
      pointerGestureRef.current = {
        startedOnNode,
        startedAt: now,
        startX: event.clientX,
        startY: event.clientY,
        moved: false,
        endedAt: 0,
      };
    };
    const onContainerPointerMove = (event: PointerEvent) => {
      const gesture = pointerGestureRef.current;
      const dx = event.clientX - gesture.startX;
      const dy = event.clientY - gesture.startY;
      if (Math.hypot(dx, dy) > CLICK_MOVE_THRESHOLD_PX) {
        gesture.moved = true;
      }
    };
    const onContainerPointerUp = () => {
      const now = performance.now();
      const gesture = pointerGestureRef.current;
      const nodePointerBelongsToGesture = (
        nodePointerDownAtRef.current >= gesture.startedAt - 80 &&
        nodePointerDownAtRef.current <= now
      );
      const endedGesture = {
        ...gesture,
        startedOnNode: gesture.startedOnNode || nodePointerBelongsToGesture,
        endedAt: now,
      };
      lastPointerGestureRef.current = endedGesture;

      if (endedGesture.startedOnNode || endedGesture.moved) {
        suppressStageClickUntilRef.current = Math.max(
          suppressStageClickUntilRef.current,
          endedGesture.endedAt + POST_DRAG_STAGE_SUPPRESS_MS,
        );
        return;
      }

      window.setTimeout(clearSelectionFromStage, 0);
    };
    container.addEventListener('pointerdown', onContainerPointerDown);
    container.addEventListener('pointermove', onContainerPointerMove);
    container.addEventListener('pointerup', onContainerPointerUp);
    graph.on(GraphEvent.BEFORE_LAYOUT, () => {
      callbacksRef.current.onLayoutRunningChange?.(true);
    });
    graph.on(GraphEvent.AFTER_LAYOUT, () => {
      callbacksRef.current.onLayoutRunningChange?.(false);
    });

    return () => {
      callbacksRef.current.onLayoutRunningChange?.(false);
      container.removeEventListener('pointerdown', onContainerPointerDown);
      container.removeEventListener('pointermove', onContainerPointerMove);
      container.removeEventListener('pointerup', onContainerPointerUp);
      graph.destroy();
      graphRef.current = null;
    };
  }, [clearSelectionFromStage]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    graphRef.current?.setTheme(getThemeName(options.themeMode));
  }, [options.themeMode]);

  useEffect(() => {
    const graph = graphRef.current;
    const payload = dataRef.current;
    if (!graph || !payload) return;

    graph.updateNodeData(payload.nodeIds.map((id) => ({
      id,
      style: { label: options.showLabels },
    })));
    void graph.draw();
  }, [options.showLabels]);

  useEffect(() => {
    applySelectionStyle(options.selectedNodeId);
  }, [applySelectionStyle, options.selectedNodeId]);

  const setGraph = useCallback(async (payload: SetGraphPayload) => {
    const graph = graphRef.current;
    if (!graph) return;

    const token = ++renderTokenRef.current;
    dataRef.current = payload;
    styleSnapshotRef.current = createStyleSnapshot(payload.data);
    callbacksRef.current.onLayoutRunningChange?.(true);
    graph.setData(payload.data);
    graph.setLayout(DEFAULT_LAYOUT);

    try {
      await graph.render();
      if (token !== renderTokenRef.current) return;
      applySelectionStyle(selectedNodeRef.current);
    } finally {
      if (token === renderTokenRef.current) callbacksRef.current.onLayoutRunningChange?.(false);
    }
  }, [applySelectionStyle]);

  const zoomIn = useCallback(() => {
    void graphRef.current?.zoomBy(1.35, VIEWPORT_ANIMATION);
  }, []);

  const zoomOut = useCallback(() => {
    void graphRef.current?.zoomBy(1 / 1.35, VIEWPORT_ANIMATION);
  }, []);

  const fitToScreen = useCallback(() => {
    void graphRef.current?.fitView({ when: 'always', direction: 'both' }, VIEWPORT_ANIMATION);
  }, []);

  const focusNode = useCallback((nodeId: string) => {
    void graphRef.current?.focusElement(nodeId, VIEWPORT_ANIMATION);
  }, []);

  const startLayout = useCallback(async () => {
    const graph = graphRef.current;
    const payload = dataRef.current;
    if (!graph || !payload || payload.nodeIds.length === 0) return;

    callbacksRef.current.onLayoutRunningChange?.(true);
    try {
      await graph.layout(DEFAULT_LAYOUT);
      applySelectionStyle(selectedNodeRef.current);
    } finally {
      callbacksRef.current.onLayoutRunningChange?.(false);
    }
  }, [applySelectionStyle]);

  const stopLayout = useCallback(() => {
    graphRef.current?.stopLayout();
    callbacksRef.current.onLayoutRunningChange?.(false);
  }, []);

  return {
    containerRef,
    graphRef,
    setGraph,
    zoomIn,
    zoomOut,
    focusNode,
    fitToScreen,
    startLayout,
    stopLayout,
    containerReady,
  };
}
