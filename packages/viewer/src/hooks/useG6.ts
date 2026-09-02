import { useCallback, useEffect, useRef, useState } from 'react';
import {
  CanvasEvent,
  CommonEvent,
  Graph as G6Graph,
  NodeEvent,
  type GraphData,
} from '@antv/g6';
import type { G6EdgePair } from '@/lib/graph-adapter';
import type { ThemeMode } from '@/core/graph/types';
import {
  clampGraphDevicePixelRatio,
  resolveStyledPreviewNodeId,
  positionGraphPreset,
  type GraphPresetPositioning,
} from '@/lib/graph-performance';

interface UseG6Options {
  onNodeClick?: (nodeId: string) => void;
  onNodeHover?: (nodeId: string | null) => void;
  onStageClick?: () => void;
  selectedNodeId: string | null;
  searchHitIds: Set<string>;
  previewNodeId: string | null;
  themeMode: ThemeMode;
  showLabels: boolean;
}

interface SetGraphPayload {
  data: GraphData;
  nodeIds: string[];
  edgePairs: G6EdgePair[];
  positioning: GraphPresetPositioning;
}

const VIEWPORT_ANIMATION = { duration: 360, easing: 'ease-in-out' as const };
const ELEMENT_UPDATE_ANIMATION = { duration: 0 };

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
  const labelVisible = showLabels && base.label !== false;
  return {
    ...base,
    label: labelVisible,
    opacity: 1,
    labelOpacity: labelVisible ? 1 : 0,
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

function waitForNextFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

export function useG6(options: UseG6Options) {
  const styledPreviewNodeId = resolveStyledPreviewNodeId(options.searchHitIds, options.previewNodeId);
  const containerRef = useRef<HTMLDivElement>(null);
  const graphRef = useRef<G6Graph | null>(null);
  const dataRef = useRef<SetGraphPayload | null>(null);
  const callbacksRef = useRef({
    onNodeClick: options.onNodeClick,
    onNodeHover: options.onNodeHover,
    onStageClick: options.onStageClick,
  });
  const selectedNodeRef = useRef<string | null>(options.selectedNodeId);
  const searchHitIdsRef = useRef<Set<string>>(options.searchHitIds);
  const previewNodeIdRef = useRef<string | null>(styledPreviewNodeId);
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
  const graphMutationQueueRef = useRef<Promise<void>>(Promise.resolve());
  const renderTokenRef = useRef(0);
  const styleSnapshotRef = useRef<GraphStyleSnapshot | null>(null);
  const showLabelsRef = useRef(options.showLabels);
  const [containerReady, setContainerReady] = useState(false);

  const enqueueGraphMutation = useCallback((mutation: () => Promise<void>): Promise<void> => {
    const operation = graphMutationQueueRef.current.catch(() => undefined).then(mutation);
    const guardedOperation = operation.catch((error: unknown) => {
      console.error('图谱更新失败', error);
    });
    graphMutationQueueRef.current = guardedOperation;
    return guardedOperation;
  }, []);

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
    };
  }, [options.onNodeClick, options.onNodeHover, options.onStageClick]);

  useEffect(() => {
    selectedNodeRef.current = options.selectedNodeId;
  }, [options.selectedNodeId]);

  useEffect(() => {
    searchHitIdsRef.current = options.searchHitIds;
  }, [options.searchHitIds]);

  useEffect(() => {
    previewNodeIdRef.current = styledPreviewNodeId;
  }, [styledPreviewNodeId]);

  useEffect(() => {
    showLabelsRef.current = options.showLabels;
  }, [options.showLabels]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const checkSize = () => {
      const { width, height } = container.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      setContainerReady(true);
      graphRef.current?.resize(Math.floor(width), Math.floor(height));
    };

    checkSize();
    const observer = new ResizeObserver(checkSize);
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const applySelectionStyle = useCallback((
    selectedNodeId: string | null,
    searchHitIds: Set<string>,
    previewNodeId: string | null,
  ) => {
    const version = selectionVersionRef.current + 1;
    selectionVersionRef.current = version;

    void enqueueGraphMutation(async () => {
      if (version !== selectionVersionRef.current) return;

      const graph = graphRef.current;
      const payload = dataRef.current;
      if (!graph || graph.destroyed || !payload) return;

      await waitForNextFrame();
      if (
        version !== selectionVersionRef.current ||
        graphRef.current !== graph ||
        graph.destroyed
      ) return;

      const snapshot = styleSnapshotRef.current;
      const nodeUpdates: Array<{ id: string; style: ElementStyle }> = [];
      const edgeUpdates: Array<{ id: string; style: ElementStyle }> = [];
      const relatedNodeIds = new Set<string>();
      const activeNodeId = selectedNodeId && payload.nodeIds.includes(selectedNodeId) ? selectedNodeId : null;
      const activePreviewNodeId = previewNodeId && payload.nodeIds.includes(previewNodeId) ? previewNodeId : null;
      const visibleSearchHitIds = new Set(payload.nodeIds.filter((nodeId) => searchHitIds.has(nodeId)));
      const hasSearchHits = visibleSearchHitIds.size > 0;

      if (activeNodeId) {
        for (const edge of payload.edgePairs) {
          const baseStyle = getBaseEdgeStyle(snapshot, edge.id);
          const sourceHit = visibleSearchHitIds.has(edge.source);
          const targetHit = visibleSearchHitIds.has(edge.target);
          if (edge.source === activeNodeId) {
            relatedNodeIds.add(edge.target);
            edgeUpdates.push({
              id: edge.id,
              style: {
                ...baseStyle,
                lineWidth: 3,
                strokeOpacity: 0.92,
                label: showLabelsRef.current,
                labelOpacity: showLabelsRef.current ? 1 : 0,
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
                label: showLabelsRef.current,
                labelOpacity: showLabelsRef.current ? 1 : 0,
                zIndex: 10,
              },
            });
          } else {
            const searchStrokeOpacity = sourceHit && targetHit ? 0.34 : sourceHit || targetHit ? 0.18 : 0.08;
            edgeUpdates.push({
              id: edge.id,
              style: {
                ...baseStyle,
                lineWidth: sourceHit && targetHit ? 2 : baseStyle.lineWidth,
                strokeOpacity: searchStrokeOpacity,
                zIndex: sourceHit || targetHit ? 4 : 0,
              },
            });
          }
        }

        for (const nodeId of payload.nodeIds) {
          const baseStyle = getBaseNodeStyle(snapshot, nodeId, showLabelsRef.current);
          const isHit = visibleSearchHitIds.has(nodeId);
          const isPreview = nodeId === activePreviewNodeId;
          if (nodeId === activeNodeId) {
            nodeUpdates.push({
              id: nodeId,
              style: {
                ...baseStyle,
                label: showLabelsRef.current,
                labelOpacity: showLabelsRef.current ? 1 : 0,
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
                label: showLabelsRef.current,
                labelOpacity: showLabelsRef.current ? 1 : 0,
                lineWidth: 3,
                halo: true,
                haloLineWidth: 10,
                haloStrokeOpacity: 0.2,
                zIndex: 12,
              },
            });
          } else if (isHit) {
            nodeUpdates.push({
              id: nodeId,
              style: {
                ...baseStyle,
                label: showLabelsRef.current,
                opacity: isPreview ? 0.92 : 0.62,
                labelOpacity: showLabelsRef.current ? (isPreview ? 1 : 0.78) : 0,
                lineWidth: isPreview ? 4 : 2.5,
                halo: true,
                haloLineWidth: isPreview ? 13 : 8,
                haloStrokeOpacity: isPreview ? 0.28 : 0.17,
                zIndex: isPreview ? 18 : 8,
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
      } else if (hasSearchHits) {
        const previewNeighborIds = new Set<string>();
        for (const edge of payload.edgePairs) {
          const baseStyle = getBaseEdgeStyle(snapshot, edge.id);
          const sourceHit = visibleSearchHitIds.has(edge.source);
          const targetHit = visibleSearchHitIds.has(edge.target);
          const touchesPreview = Boolean(activePreviewNodeId && (edge.source === activePreviewNodeId || edge.target === activePreviewNodeId));
          if (touchesPreview) {
            previewNeighborIds.add(edge.source === activePreviewNodeId ? edge.target : edge.source);
          }
          edgeUpdates.push({
            id: edge.id,
            style: {
              ...baseStyle,
              lineWidth: touchesPreview || (sourceHit && targetHit) ? 2.5 : sourceHit || targetHit ? 1.8 : baseStyle.lineWidth,
              strokeOpacity: touchesPreview ? 0.7 : sourceHit && targetHit ? 0.44 : sourceHit || targetHit ? 0.22 : 0.06,
              zIndex: touchesPreview ? 12 : sourceHit || targetHit ? 6 : 0,
            },
          });
        }

        for (const nodeId of payload.nodeIds) {
          const baseStyle = getBaseNodeStyle(snapshot, nodeId, showLabelsRef.current);
          const isHit = visibleSearchHitIds.has(nodeId);
          const isPreview = nodeId === activePreviewNodeId;
          const isPreviewNeighbor = previewNeighborIds.has(nodeId);
          if (isPreview) {
            nodeUpdates.push({
              id: nodeId,
              style: {
                ...baseStyle,
                label: showLabelsRef.current,
                labelOpacity: showLabelsRef.current ? 1 : 0,
                lineWidth: 4,
                halo: true,
                haloLineWidth: 16,
                haloStrokeOpacity: 0.34,
                zIndex: 20,
              },
            });
          } else if (isHit) {
            nodeUpdates.push({
              id: nodeId,
              style: {
                ...baseStyle,
                label: showLabelsRef.current,
                opacity: 0.95,
                labelOpacity: showLabelsRef.current ? 1 : 0,
                lineWidth: 3,
                halo: true,
                haloLineWidth: 11,
                haloStrokeOpacity: 0.24,
                zIndex: 14,
              },
            });
          } else if (isPreviewNeighbor) {
            nodeUpdates.push({
              id: nodeId,
              style: {
                ...baseStyle,
                label: showLabelsRef.current,
                opacity: 0.72,
                labelOpacity: showLabelsRef.current ? 0.7 : 0,
                lineWidth: 2,
                halo: true,
                haloLineWidth: 7,
                haloStrokeOpacity: 0.12,
                zIndex: 7,
              },
            });
          } else {
            nodeUpdates.push({
              id: nodeId,
              style: {
                ...baseStyle,
                opacity: 0.26,
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
  }, [enqueueGraphMutation]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || graphRef.current) return;

    const graph = new G6Graph({
      container,
      autoResize: false,
      devicePixelRatio: clampGraphDevicePixelRatio(window.devicePixelRatio || 1),
      theme: getThemeName(options.themeMode),
      animation: ELEMENT_UPDATE_ANIMATION,
      data: { nodes: [], edges: [] },
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
        {
          type: 'optimize-viewport-transform',
          shapes: { node: ['key'] },
          debounce: 120,
        },
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
    return () => {
      container.removeEventListener('pointerdown', onContainerPointerDown);
      container.removeEventListener('pointermove', onContainerPointerMove);
      container.removeEventListener('pointerup', onContainerPointerUp);
      renderTokenRef.current += 1;
      selectionVersionRef.current += 1;
      dataRef.current = null;
      styleSnapshotRef.current = null;
      graphRef.current = null;
      graph.destroy();
    };
  }, [clearSelectionFromStage]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void enqueueGraphMutation(async () => {
      const graph = graphRef.current;
      if (!graph || graph.destroyed) return;
      graph.setTheme(getThemeName(options.themeMode));
    });
  }, [enqueueGraphMutation, options.themeMode]);

  useEffect(() => {
    applySelectionStyle(selectedNodeRef.current, searchHitIdsRef.current, previewNodeIdRef.current);
  }, [applySelectionStyle, options.showLabels]);

  useEffect(() => {
    applySelectionStyle(options.selectedNodeId, options.searchHitIds, styledPreviewNodeId);
  }, [applySelectionStyle, options.selectedNodeId, options.searchHitIds, styledPreviewNodeId]);

  const setGraph = useCallback((payload: SetGraphPayload): Promise<void> => {
    const token = ++renderTokenRef.current;
    selectionVersionRef.current += 1;
    return enqueueGraphMutation(async () => {
      const graph = graphRef.current;
      if (!graph || graph.destroyed || token !== renderTokenRef.current) return;

      const previousPayload = dataRef.current;
      const containerBounds = containerRef.current?.getBoundingClientRect();
      const [centerX, centerY] = previousPayload && graph.rendered
        ? graph.getViewportCenter()
        : [
            Math.max(0, (containerBounds?.width ?? 0) / 2),
            Math.max(0, (containerBounds?.height ?? 0) / 2),
          ];
      const positionedData = positionGraphPreset(payload.data, { x: centerX, y: centerY }, payload.positioning);
      const nextPayload = { ...payload, data: positionedData };
      dataRef.current = nextPayload;
      styleSnapshotRef.current = createStyleSnapshot(nextPayload.data);
      graph.setData(nextPayload.data);
      await graph.draw();
      if (
        token !== renderTokenRef.current ||
        graphRef.current !== graph ||
        graph.destroyed
      ) return;
      applySelectionStyle(selectedNodeRef.current, searchHitIdsRef.current, previewNodeIdRef.current);
      await graph.fitView({ when: 'always', direction: 'both' }, VIEWPORT_ANIMATION);
      if (payload.positioning.type === 'radial-focus' && payload.positioning.viewportRightInset) {
        const viewportWidth = containerRef.current?.getBoundingClientRect().width ?? 0;
        const availableWidthRatio = viewportWidth > 0
          ? Math.max(0.1, (viewportWidth - payload.positioning.viewportRightInset - 48) / viewportWidth)
          : 1;
        const visibleRatio = viewportWidth > 0
          ? Math.max(0.7, Math.min(0.95, Math.sqrt(Math.sqrt(availableWidthRatio))))
          : 1;
        await graph.zoomBy(visibleRatio, false);
        await graph.translateBy([-payload.positioning.viewportRightInset / 2, 0], VIEWPORT_ANIMATION);
      }
    });
  }, [applySelectionStyle, enqueueGraphMutation]);

  const zoomIn = useCallback(() => {
    void graphRef.current?.zoomBy(1.35, VIEWPORT_ANIMATION);
  }, []);

  const zoomOut = useCallback(() => {
    void graphRef.current?.zoomBy(1 / 1.35, VIEWPORT_ANIMATION);
  }, []);

  const fitToScreen = useCallback(() => {
    void enqueueGraphMutation(async () => {
      const graph = graphRef.current;
      if (!graph || graph.destroyed) return;
      await graph.fitView({ when: 'always', direction: 'both' }, VIEWPORT_ANIMATION);
      const positioning = dataRef.current?.positioning;
      if (positioning?.type === 'radial-focus' && positioning.viewportRightInset) {
        const viewportWidth = containerRef.current?.getBoundingClientRect().width ?? 0;
        const availableWidthRatio = viewportWidth > 0
          ? Math.max(0.1, (viewportWidth - positioning.viewportRightInset - 48) / viewportWidth)
          : 1;
        const visibleRatio = viewportWidth > 0
          ? Math.max(0.7, Math.min(0.95, Math.sqrt(Math.sqrt(availableWidthRatio))))
          : 1;
        await graph.zoomBy(visibleRatio, false);
        await graph.translateBy([-positioning.viewportRightInset / 2, 0], VIEWPORT_ANIMATION);
      }
    });
  }, [enqueueGraphMutation]);

  const focusNode = useCallback((nodeId: string) => {
    void graphRef.current?.focusElement(nodeId, VIEWPORT_ANIMATION);
  }, []);

  return {
    containerRef,
    graphRef,
    setGraph,
    zoomIn,
    zoomOut,
    focusNode,
    fitToScreen,
    containerReady,
  };
}
