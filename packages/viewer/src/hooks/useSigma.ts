import { useEffect, useRef, useCallback, useState } from 'react';
import Sigma from 'sigma';
import { createEdgeCurveProgram } from '@sigma/edge-curve';
import { createNodeBorderProgram } from '@sigma/node-border';
import type Graph from 'graphology';
import { useGraphStore, selectNode, setHoverNodeId, setCommunityInfo } from '../store/graphStore.js';
import { getVisibleNodes } from '../graph/visibility.js';
import { buildGraphologyGraph } from '../graph/graph-adapter.js';
import { resolveSingleNodeCollision, startWorkerLayout } from '../graph/graphology-layout.js';
import { createDrawNodeHover, dimColor, brightenColor } from '../components/SigmaHoverRenderer.js';
import type { ThemeMode } from '../components/aiwc/styles/tokens.js';
import { getTokens } from '../components/aiwc/styles/tokens.js';

// ── Drag state (module-level, shared across renders) ──
let dragNodeId: string | null = null;
let dragStartX = 0;
let dragStartY = 0;
let dragMoved = false;
let dragCameraPanningWasEnabled = true;
const DRAG_LERP = 0.22;
const DRAG_SNAP_EPSILON = 0.4;
const DRAG_START_THRESHOLD = 5;
const INERTIA_MIN_SPEED = 0.015;
const INERTIA_MAX_SPEED = 1.2;
const INERTIA_DAMPING = 0.92;
const INERTIA_STOP_SPEED = 0.01;

type NeighborSet = Set<string>;

function getVisibleNodeScale(visibleCount: number): number {
  if (visibleCount > 120) return 0.3;
  if (visibleCount > 80) return 0.35;
  if (visibleCount > 50) return 0.4;
  if (visibleCount > 30) return 0.5;
  if (visibleCount > 16) return 0.65;
  return 0.8;
}

function createNodeReducer(
  selectedId: string | null,
  neighbors: NeighborSet,
  visibleNodeIds: Set<string>,
  mode: ThemeMode,
) {
  const t = getTokens(mode);
  return (_node: string, attrs: Record<string, unknown>) => {
    // Hide nodes not in the current visible set (instead of rebuilding graph)
    if (!visibleNodeIds.has(_node)) {
      return { ...attrs, hidden: true } as Record<string, unknown>;
    }

    const baseSize = (attrs.size as number) || 8;
    const scaledBaseSize = Math.max(4, baseSize * getVisibleNodeScale(visibleNodeIds.size));

    if (_node === dragNodeId) {
      return {
        ...attrs,
        hidden: false,
        size: scaledBaseSize,
        borderColor: brightenColor(attrs.borderColor as string || t.colorAccent, 1.35, mode),
        highlighted: true,
        zIndex: 3,
      } as Record<string, unknown>;
    }

    if (!selectedId) return { ...attrs, hidden: false } as Record<string, unknown>;

    const isSelected = _node === selectedId;
    const isNeighbor = neighbors.has(_node);

    if (isSelected) {
      return {
        ...attrs,
        hidden: false,
        size: scaledBaseSize,
        borderColor: t.colorAccent,
        highlighted: true,
        zIndex: 2,
      } as Record<string, unknown>;
    }
    if (isNeighbor) {
      return {
        ...attrs,
        hidden: false,
        size: scaledBaseSize,
        borderColor: brightenColor(attrs.borderColor as string || t.colorBorderStrong, 1.2, mode),
        zIndex: 1,
      } as Record<string, unknown>;
    }
    return {
      ...attrs,
      hidden: false,
      color: dimColor(attrs.color as string || t.colorMuted, 0.25, mode),
      borderColor: dimColor(attrs.borderColor as string || t.colorText, 0.25, mode),
      size: scaledBaseSize * 0.92,
      label: '',
      zIndex: 0,
    } as Record<string, unknown>;
  };
}

function createEdgeReducer(selectedId: string | null, graph: Graph, visibleNodeIds: Set<string>, mode: ThemeMode) {
  const t = getTokens(mode);
  return (_edge: string, attrs: Record<string, unknown>) => {
    const src = graph.source(_edge) as string;
    const tgt = graph.target(_edge) as string;

    // Hide edges where either endpoint is hidden
    if (!visibleNodeIds.has(src) || !visibleNodeIds.has(tgt)) {
      return { ...attrs, hidden: true } as Record<string, unknown>;
    }

    if (!selectedId) return { ...attrs, hidden: false } as Record<string, unknown>;

    const isConnected = src === selectedId || tgt === selectedId;
    const baseSize = (attrs.size as number) || 1;

    if (isConnected) {
      return {
        ...attrs,
        hidden: false,
        color: brightenColor(attrs.color as string || t.colorBorderStrong, 1.5, mode),
        size: Math.max(3, baseSize * 4),
        zIndex: 2,
      } as Record<string, unknown>;
    }
    return {
      ...attrs,
      hidden: false,
      color: dimColor(attrs.color as string || t.colorBorderStrong, 0.1, mode),
      size: 0.3,
      zIndex: 0,
    } as Record<string, unknown>;
  };
}

/** Filter keys that require a full graph rebuild (data + structural filters) */
function getStructuralFilterKey(state: {
  data: unknown;
  selectedTypes: Set<string>;
  selectedBook: string;
  layerMode: string;
  focusConnected: boolean;
  themeMode: ThemeMode;
}): string {
  return [
    state.data ? 'has-data' : 'no-data',
    Array.from(state.selectedTypes).sort().join(','),
    state.selectedBook,
    state.layerMode,
    state.focusConnected ? '1' : '0',
    state.themeMode,
  ].join('|');
}

type LayoutControls = { stop: () => void; kill: () => void } | null;

function makeNodeProgram(mode: ThemeMode) {
  return createNodeBorderProgram({
    borders: [
      {
        color: { attribute: 'borderColor', defaultValue: mode === 'light' ? '#c8c8d4' : '#ffffff' },
        size: { value: 2, mode: 'pixels' },
      },
      {
        color: { attribute: 'color', defaultValue: mode === 'light' ? '#9A9AB0' : '#6b7280' },
        size: { fill: true },
      },
    ],
    drawLabel: undefined,
    drawHover: createDrawNodeHover(mode),
  });
}

function getInteractiveCollisionRadius(
  graph: Graph,
  nodeId: string,
  attrs: Record<string, unknown>,
  selectedId: string | null,
): number {
  const collisionRadius = typeof attrs.collisionRadius === 'number'
    ? attrs.collisionRadius
    : ((attrs.size as number) || 8) + 8;
  void graph;
  void nodeId;
  void selectedId;
  return collisionRadius + 6;
}

function getNodeCameraTarget(
  sigma: Sigma,
  graph: Graph,
  nodeId: string,
): { x: number; y: number } | null {
  if (!graph.hasNode(nodeId)) return null;

  const display = sigma.getNodeDisplayData(nodeId);
  if (
    display
    && typeof display.x === 'number'
    && isFinite(display.x)
    && typeof display.y === 'number'
    && isFinite(display.y)
  ) {
    return { x: display.x, y: display.y };
  }

  const attrs = graph.getNodeAttributes(nodeId);
  if (
    typeof attrs.x === 'number'
    && isFinite(attrs.x)
    && typeof attrs.y === 'number'
    && isFinite(attrs.y)
  ) {
    return { x: attrs.x, y: attrs.y };
  }

  return null;
}

export function useSigma() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const layoutRef = useRef<LayoutControls>(null);
  const dragLayoutWasRunningRef = useRef(false);
  const dragTargetRef = useRef<{ x: number; y: number } | null>(null);
  const dragAnimationFrameRef = useRef<number | null>(null);
  const inertiaAnimationFrameRef = useRef<number | null>(null);
  const dragVelocityRef = useRef<{ x: number; y: number; at: number } | null>(null);
  const suppressStageClickUntilRef = useRef(0);
  const pressedNodeIdRef = useRef<string | null>(null);
  const [containerReady, setContainerReady] = useState(false);
  const [isLayoutRunning, setIsLayoutRunning] = useState(false);
  // Track the structural filter key used to build the current graph
  const currentStructKeyRef = useRef<string | null>(null);
  // Track ALL node IDs ever added to graph (so we never need to rebuild for expansion)
  const allNodeIdsRef = useRef<Set<string>>(new Set());

  const data = useGraphStore((s) => s.data);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const showLabels = useGraphStore((s) => s.showLabels);
  const selectedTypes = useGraphStore((s) => s.selectedTypes);
  const selectedBook = useGraphStore((s) => s.selectedBook);
  const layerMode = useGraphStore((s) => s.layerMode);
  const expandedBackboneNodeId = useGraphStore((s) => s.expandedBackboneNodeId);
  const focusConnected = useGraphStore((s) => s.focusConnected);
  const themeMode = useGraphStore((s) => s.themeMode);

  // Observe container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const check = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width > 0 && height > 0) setContainerReady(true);
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Build/rebuild Sigma ONLY when structural filters change (types, book, layer, data)
  // NOT when selection or expansion changes — those are handled by reducers
  const structuralKey = getStructuralFilterKey({
    data,
    selectedTypes,
    selectedBook,
    layerMode,
    focusConnected,
    themeMode,
  });

  useEffect(() => {
    if (!data || !containerRef.current || !containerReady) return;

    const { width, height } = containerRef.current.getBoundingClientRect();
    if (width === 0 || height === 0) return;

    const state = useGraphStore.getState();
    const currentMode = state.themeMode;
    const t = getTokens(currentMode);
    // Build with ALL nodes (backbone + support) so expansion doesn't require rebuild
    const allNodeIds = new Set(data.nodes.map((n) => n.id));

    if (allNodeIds.size === 0) {
      if (layoutRef.current) { layoutRef.current.kill(); layoutRef.current = null; }
      if (sigmaRef.current) { sigmaRef.current.kill(); sigmaRef.current = null; graphRef.current = null; }
      setIsLayoutRunning(false);
      return;
    }

    const { graph, communityCount, communities, communityMap, hasSemanticLayout } = buildGraphologyGraph(data, allNodeIds);
    graphRef.current = graph;
    allNodeIdsRef.current = allNodeIds;
    setCommunityInfo(communityCount, communities, communityMap);

    // Kill existing layout
    if (layoutRef.current) { layoutRef.current.kill(); layoutRef.current = null; }

    // Compute visible set for reducers
    const visibleNodes = getVisibleNodes(state);
    const visibleNodeIds = new Set(visibleNodes.map((n) => n.id));

    const startLayoutWorker = (targetGraph: Graph) => {
      setIsLayoutRunning(true);
      const layout = startWorkerLayout(targetGraph, () => {
        setIsLayoutRunning(false);
        sigmaRef.current?.refresh();
      }, hasSemanticLayout);
      layoutRef.current = layout;
    };

    // If Sigma already exists, swap the graph data smoothly
    if (sigmaRef.current) {
      setIsLayoutRunning(false);
      sigmaRef.current.setGraph(graph);
      sigmaRef.current.refresh();

      const selId = state.selectedNodeId;
      let neighbors: NeighborSet = new Set();
      if (selId && graph.hasNode(selId)) {
        neighbors = new Set(graph.neighbors(selId));
        neighbors.add(selId);
      }
      sigmaRef.current.setSetting('nodeReducer', createNodeReducer(selId, neighbors, visibleNodeIds, currentMode));
      sigmaRef.current.setSetting('edgeReducer', createEdgeReducer(selId, graph, visibleNodeIds, currentMode));

      startLayoutWorker(graph);

      sigmaRef.current.getCamera().animatedReset({ duration: 600, easing: 'cubicInOut' });
      currentStructKeyRef.current = structuralKey;
      return;
    }

    // First time: create Sigma instance
    setIsLayoutRunning(false);

    const selId = state.selectedNodeId;
    let neighbors: NeighborSet = new Set();
    if (selId && graph.hasNode(selId)) {
      neighbors = new Set(graph.neighbors(selId));
      neighbors.add(selId);
    }

    const sigma = new Sigma(graph, containerRef.current, {
      defaultEdgeType: 'curved',
      edgeProgramClasses: { curved: createEdgeCurveProgram() },
      nodeProgramClasses: {
        bordered: makeNodeProgram(currentMode),
      },
      defaultNodeType: 'bordered',
      renderLabels: state.showLabels,
      labelFont: "'PingFang SC', 'Microsoft YaHei', 'Noto Sans SC', monospace",
      labelSize: 11,
      labelWeight: '500',
      labelColor: { color: t.colorText },
      labelRenderedSizeThreshold: 8,
      labelDensity: 0.1,
      labelGridCellSize: 70,
      defaultNodeColor: currentMode === 'light' ? '#9A9AB0' : '#6b7280',
      defaultEdgeColor: t.colorBorderStrong,
      minCameraRatio: 0.002,
      maxCameraRatio: 50,
      hideEdgesOnMove: false,
      zIndex: true,
      nodeReducer: createNodeReducer(selId, neighbors, visibleNodeIds, currentMode),
      edgeReducer: createEdgeReducer(selId, graph, visibleNodeIds, currentMode),
    });

    sigmaRef.current = sigma;

    // Cursor management
    sigma.on('enterNode', () => {
      if (containerRef.current) containerRef.current.style.cursor = 'pointer';
    });
    sigma.on('leaveNode', () => {
      if (containerRef.current) containerRef.current.style.cursor = 'grab';
    });

    // Node interactions
    sigma.on('clickNode', ({ node }) => {
      suppressStageClickUntilRef.current = performance.now() + 250;
      selectNode(node, false);
    });
    sigma.on('clickStage', () => {
      if (performance.now() < suppressStageClickUntilRef.current) return;
      selectNode(null, false);
    });
    sigma.on('enterNode', ({ node }) => {
      setHoverNodeId(node);
    });
    sigma.on('leaveNode', () => {
      setHoverNodeId(null);
    });

    // ── Node drag ──
    const stopDragAnimation = () => {
      if (dragAnimationFrameRef.current !== null) {
        cancelAnimationFrame(dragAnimationFrameRef.current);
        dragAnimationFrameRef.current = null;
      }
    };

    const stopInertiaAnimation = () => {
      if (inertiaAnimationFrameRef.current !== null) {
        cancelAnimationFrame(inertiaAnimationFrameRef.current);
        inertiaAnimationFrameRef.current = null;
      }
    };

    const nudgeEdgeRefresh = () => {
      const activeSigma = sigmaRef.current;
      if (!activeSigma) return;
      const camera = activeSigma.getCamera();
      camera.animate(
        { ratio: camera.getBoundedRatio(camera.ratio * 1.0001) },
        { duration: 50, easing: 'cubicInOut' },
      );
    };

    const animateDraggedNode = () => {
      const activeSigma = sigmaRef.current;
      const activeGraph = graphRef.current;
      const target = dragTargetRef.current;
      if (!activeSigma || !activeGraph || !target || dragNodeId === null || !activeGraph.hasNode(dragNodeId)) {
        dragAnimationFrameRef.current = null;
        return;
      }

      const attrs = activeGraph.getNodeAttributes(dragNodeId);
      const currentX = (attrs.x as number) || 0;
      const currentY = (attrs.y as number) || 0;
      const nextX = currentX + (target.x - currentX) * DRAG_LERP;
      const nextY = currentY + (target.y - currentY) * DRAG_LERP;
      const distance = Math.hypot(target.x - currentX, target.y - currentY);

      activeGraph.setNodeAttribute(dragNodeId, 'x', distance <= DRAG_SNAP_EPSILON ? target.x : nextX);
      activeGraph.setNodeAttribute(dragNodeId, 'y', distance <= DRAG_SNAP_EPSILON ? target.y : nextY);
      const resolvedPosition = resolveSingleNodeCollision(
        activeGraph,
        dragNodeId,
        (nodeId, nodeAttrs) => getInteractiveCollisionRadius(activeGraph, nodeId, nodeAttrs, useGraphStore.getState().selectedNodeId),
      );
      if (resolvedPosition) {
        dragTargetRef.current = resolvedPosition;
      }
      activeSigma.refresh();

      dragAnimationFrameRef.current = requestAnimationFrame(animateDraggedNode);
    };

    const ensureDragAnimation = () => {
      if (dragAnimationFrameRef.current !== null) return;
      dragAnimationFrameRef.current = requestAnimationFrame(animateDraggedNode);
    };

    const finalizeNodeDrag = (nodeId: string) => {
      const activeGraph = graphRef.current;
      if (activeGraph && activeGraph.hasNode(nodeId)) {
        const target = dragTargetRef.current;
        if (target) {
          activeGraph.setNodeAttribute(nodeId, 'x', target.x);
          activeGraph.setNodeAttribute(nodeId, 'y', target.y);
        }
        const resolvedPosition = resolveSingleNodeCollision(
          activeGraph,
          nodeId,
          (candidateId, nodeAttrs) => getInteractiveCollisionRadius(activeGraph, candidateId, nodeAttrs, useGraphStore.getState().selectedNodeId),
        );
        if (resolvedPosition) {
          dragTargetRef.current = resolvedPosition;
        }
      }
      sigmaRef.current?.refresh();
      nudgeEdgeRefresh();
      if (dragLayoutWasRunningRef.current && activeGraph) {
        startLayoutWorker(activeGraph);
      }
      dragLayoutWasRunningRef.current = false;
      dragVelocityRef.current = null;
    };

    const startInertiaAnimation = (nodeId: string, velocity: { x: number; y: number }) => {
      const initialSpeed = Math.hypot(velocity.x, velocity.y);
      if (initialSpeed < INERTIA_MIN_SPEED) {
        finalizeNodeDrag(nodeId);
        return;
      }

      let vx = Math.max(-INERTIA_MAX_SPEED, Math.min(INERTIA_MAX_SPEED, velocity.x));
      let vy = Math.max(-INERTIA_MAX_SPEED, Math.min(INERTIA_MAX_SPEED, velocity.y));
      let lastTime = performance.now();

      const step = (now: number) => {
        const activeGraph = graphRef.current;
        const activeSigma = sigmaRef.current;
        if (!activeGraph || !activeSigma || !activeGraph.hasNode(nodeId)) {
          inertiaAnimationFrameRef.current = null;
          dragLayoutWasRunningRef.current = false;
          return;
        }

        const dt = Math.min(now - lastTime, 32);
        lastTime = now;

        const attrs = activeGraph.getNodeAttributes(nodeId);
        const nextX = (attrs.x as number) + vx * dt;
        const nextY = (attrs.y as number) + vy * dt;
        activeGraph.setNodeAttribute(nodeId, 'x', nextX);
        activeGraph.setNodeAttribute(nodeId, 'y', nextY);
        const resolvedPosition = resolveSingleNodeCollision(
          activeGraph,
          nodeId,
          (candidateId, nodeAttrs) => getInteractiveCollisionRadius(activeGraph, candidateId, nodeAttrs, useGraphStore.getState().selectedNodeId),
        );
        dragTargetRef.current = resolvedPosition ?? { x: nextX, y: nextY };
        activeSigma.refresh();

        vx *= INERTIA_DAMPING;
        vy *= INERTIA_DAMPING;

        if (Math.hypot(vx, vy) <= INERTIA_STOP_SPEED) {
          inertiaAnimationFrameRef.current = null;
          finalizeNodeDrag(nodeId);
          return;
        }

        inertiaAnimationFrameRef.current = requestAnimationFrame(step);
      };

      stopInertiaAnimation();
      inertiaAnimationFrameRef.current = requestAnimationFrame(step);
    };

    sigma.on('downNode', (e) => {
      stopInertiaAnimation();
      pressedNodeIdRef.current = e.node;
      suppressStageClickUntilRef.current = performance.now() + 300;
      // Don't selectNode here — wait for mouseup to distinguish click vs drag
      dragNodeId = e.node;
      const orig = e.event.original;
      if ('clientX' in orig) {
        dragStartX = orig.clientX;
        dragStartY = orig.clientY;
      }
      const attrs = graph.getNodeAttributes(e.node);
      dragTargetRef.current = { x: attrs.x as number, y: attrs.y as number };
      dragVelocityRef.current = null;
      dragMoved = false;
      dragCameraPanningWasEnabled = sigma.getCamera().enabledPanning;
      sigma.getCamera().enabledPanning = false;
      sigma.refresh();
    });

    const onMove = (e: MouseEvent) => {
      if (dragNodeId === null || !sigmaRef.current || !graphRef.current || !containerRef.current) return;
      const dx = e.clientX - dragStartX;
      const dy = e.clientY - dragStartY;
      if (!dragMoved && Math.abs(dx) < DRAG_START_THRESHOLD && Math.abs(dy) < DRAG_START_THRESHOLD) return;

      const sigma = sigmaRef.current;
      const graph = graphRef.current;
      if (!graph.hasNode(dragNodeId)) return;

      if (!dragMoved) {
        dragMoved = true;
        graph.setNodeAttribute(dragNodeId, 'fixed', true);

        // Restart layout after drop so the worker rebuilds with the node's
        // latest position and fixed state, instead of freezing permanently.
        dragLayoutWasRunningRef.current = layoutRef.current !== null;
        if (layoutRef.current) {
          layoutRef.current.kill();
          layoutRef.current = null;
          setIsLayoutRunning(false);
        }
      }

      const rect = containerRef.current.getBoundingClientRect();
      const pos = sigma.viewportToGraph({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      const now = performance.now();
      const previousTarget = dragTargetRef.current;
      if (previousTarget) {
        const dt = Math.max(now - (dragVelocityRef.current?.at ?? now), 1);
        const nextVelocityX = (pos.x - previousTarget.x) / dt;
        const nextVelocityY = (pos.y - previousTarget.y) / dt;
        const previousVelocity = dragVelocityRef.current;
        dragVelocityRef.current = {
          x: previousVelocity ? previousVelocity.x * 0.55 + nextVelocityX * 0.45 : nextVelocityX,
          y: previousVelocity ? previousVelocity.y * 0.55 + nextVelocityY * 0.45 : nextVelocityY,
          at: now,
        };
      }
      dragTargetRef.current = { x: pos.x, y: pos.y };
      ensureDragAnimation();

      if (containerRef.current) containerRef.current.style.cursor = 'grabbing';
    };

    const onUp = () => {
      if (dragNodeId === null) return;
      stopDragAnimation();
      if (sigmaRef.current) {
        sigmaRef.current.getCamera().enabledPanning = dragCameraPanningWasEnabled;
      }
      const currentNodeId = dragNodeId;
      const activeGraph = graphRef.current;
      const target = dragTargetRef.current;
      if (dragMoved && activeGraph && target && activeGraph.hasNode(currentNodeId)) {
        activeGraph.setNodeAttribute(currentNodeId, 'x', target.x);
        activeGraph.setNodeAttribute(currentNodeId, 'y', target.y);
        sigmaRef.current?.refresh();
        const velocity = dragVelocityRef.current;
        if (velocity) startInertiaAnimation(currentNodeId, velocity);
        else finalizeNodeDrag(currentNodeId);
      }
      if (!dragMoved) {
        suppressStageClickUntilRef.current = performance.now() + 250;
        selectNode(dragNodeId, false);
      }
      dragNodeId = null;
      pressedNodeIdRef.current = null;
      dragTargetRef.current = null;
      dragMoved = false;
      sigmaRef.current?.refresh();
      if (containerRef.current) containerRef.current.style.cursor = 'grab';
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);

    // Start FA2 worker layout
    startLayoutWorker(graph);

    sigma.getCamera().animatedReset({ duration: 600, easing: 'cubicInOut' });
    currentStructKeyRef.current = structuralKey;

    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      stopDragAnimation();
      stopInertiaAnimation();
      dragTargetRef.current = null;
      dragVelocityRef.current = null;
      if (sigmaRef.current) {
        sigmaRef.current.getCamera().enabledPanning = true;
      }
      if (layoutRef.current) { layoutRef.current.kill(); layoutRef.current = null; }
      sigma.kill();
      if (sigmaRef.current === sigma) {
        sigmaRef.current = null;
        graphRef.current = null;
      }
      setIsLayoutRunning(false);
    };
  }, [data, structuralKey, containerReady]);

  // Update reducers when selection OR expansion changes — NO graph rebuild
  useEffect(() => {
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    if (!sigma || !graph) return;

    const state = useGraphStore.getState();
    const currentMode = state.themeMode;
    const visibleNodes = getVisibleNodes(state);
    const visibleNodeIds = new Set(visibleNodes.map((n) => n.id));

    let neighbors: NeighborSet = new Set();
    if (selectedNodeId && graph.hasNode(selectedNodeId)) {
      neighbors = new Set(graph.neighbors(selectedNodeId));
      neighbors.add(selectedNodeId);
    }

    sigma.setSetting('nodeReducer', createNodeReducer(selectedNodeId, neighbors, visibleNodeIds, currentMode));
    sigma.setSetting('edgeReducer', createEdgeReducer(selectedNodeId, graph, visibleNodeIds, currentMode));
    sigma.refresh();

    // Smooth camera: focus on selected node, or reset when deselected
    const camera = sigma.getCamera();
    if (selectedNodeId && graph.hasNode(selectedNodeId)) {
      const target = getNodeCameraTarget(sigma, graph, selectedNodeId);
      if (!target) return;
      camera.animate(
        { x: target.x, y: target.y, ratio: Math.max(camera.ratio, 0.08) },
        { duration: 500, easing: 'cubicInOut' },
      );
    } else if (!selectedNodeId) {
      camera.animatedReset({ duration: 600, easing: 'cubicInOut' });
    }
  }, [selectedNodeId, expandedBackboneNodeId]);

  // Update label visibility
  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    sigma.setSetting('renderLabels', showLabels);
  }, [showLabels]);

  const fitToScreen = useCallback(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    const camera = sigma.getCamera();
    camera.enable();
    camera.enabledZooming = true;
    camera.enabledPanning = true;
    camera.animate(
      { x: 0.5, y: 0.5, ratio: 1, angle: 0 },
      { duration: 600, easing: 'cubicInOut' },
    );
  }, []);

  const focusOnNode = useCallback((nodeId: string) => {
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    if (!sigma || !graph || !graph.hasNode(nodeId)) return;
    const target = getNodeCameraTarget(sigma, graph, nodeId);
    if (!target) return;
    sigma.getCamera().animate(
      { x: target.x, y: target.y, ratio: 0.15 },
      { duration: 500, easing: 'cubicInOut' },
    );
  }, []);

  const zoomIn = useCallback(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    const camera = sigma.getCamera();
    camera.enable();
    camera.enabledZooming = true;
    camera.animate(
      { ratio: camera.getBoundedRatio(camera.ratio / 1.5) },
      { duration: 300, easing: 'cubicInOut' },
    );
  }, []);

  const zoomOut = useCallback(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    const camera = sigma.getCamera();
    camera.enable();
    camera.enabledZooming = true;
    camera.animate(
      { ratio: camera.getBoundedRatio(camera.ratio * 1.5) },
      { duration: 300, easing: 'cubicInOut' },
    );
  }, []);

  const clearSelection = useCallback(() => {
    selectNode(null, false);
    sigmaRef.current?.getCamera().animatedReset({ duration: 600, easing: 'cubicInOut' });
  }, []);

  return { containerRef, fitToScreen, focusOnNode, zoomIn, zoomOut, clearSelection, isLayoutRunning };
}
