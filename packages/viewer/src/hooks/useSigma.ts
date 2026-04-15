import { useEffect, useRef, useCallback, useState } from 'react';
import Sigma from 'sigma';
import { createEdgeCurveProgram } from '@sigma/edge-curve';
import { createNodeBorderProgram } from '@sigma/node-border';
import type Graph from 'graphology';
import { useGraphStore, selectNode, setHoverNodeId, setCommunityInfo } from '../store/graphStore.js';
import { getVisibleNodes } from '../graph/visibility.js';
import { buildGraphologyGraph } from '../graph/graph-adapter.js';
import { startWorkerLayout } from '../graph/graphology-layout.js';
import { createDrawNodeHover, dimColor, brightenColor } from '../components/SigmaHoverRenderer.js';
import type { ThemeMode } from '../components/aiwc/styles/tokens.js';
import { getTokens } from '../components/aiwc/styles/tokens.js';

type NeighborSet = Set<string>;

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

    if (!selectedId) return { ...attrs, hidden: false } as Record<string, unknown>;

    const isSelected = _node === selectedId;
    const isNeighbor = neighbors.has(_node);
    const baseSize = (attrs.size as number) || 8;

    if (isSelected) {
      return { ...attrs, hidden: false, size: baseSize * 1.3, highlighted: true, zIndex: 2 } as Record<string, unknown>;
    }
    if (isNeighbor) {
      return { ...attrs, hidden: false, size: baseSize * 1.1, zIndex: 1 } as Record<string, unknown>;
    }
    return {
      ...attrs,
      hidden: false,
      color: dimColor(attrs.color as string || t.colorMuted, 0.25, mode),
      borderColor: dimColor(attrs.borderColor as string || t.colorText, 0.25, mode),
      size: baseSize * 0.7,
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
}): string {
  return [
    state.data ? 'has-data' : 'no-data',
    Array.from(state.selectedTypes).sort().join(','),
    state.selectedBook,
    state.layerMode,
    state.focusConnected ? '1' : '0',
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

export function useSigma() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sigmaRef = useRef<Sigma | null>(null);
  const graphRef = useRef<Graph | null>(null);
  const layoutRef = useRef<LayoutControls>(null);
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

    const { graph, communityCount, communities, communityMap } = buildGraphologyGraph(data, allNodeIds);
    graphRef.current = graph;
    allNodeIdsRef.current = allNodeIds;
    setCommunityInfo(communityCount, communities, communityMap);

    // Kill existing layout
    if (layoutRef.current) { layoutRef.current.kill(); layoutRef.current = null; }

    // Compute visible set for reducers
    const visibleNodes = getVisibleNodes(state);
    const visibleNodeIds = new Set(visibleNodes.map((n) => n.id));

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

      // Start FA2 worker layout
      setIsLayoutRunning(true);
      const layout = startWorkerLayout(graph, () => {
        setIsLayoutRunning(false);
        sigmaRef.current?.refresh();
      });
      layoutRef.current = layout;

      sigmaRef.current.getCamera().animatedReset({ duration: 600, easing: 'easeInOutCubic' });
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
      hideEdgesOnMove: true,
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
      selectNode(node, false);
    });
    sigma.on('clickStage', () => {
      selectNode(null, false);
    });
    sigma.on('enterNode', ({ node }) => {
      setHoverNodeId(node);
    });
    sigma.on('leaveNode', () => {
      setHoverNodeId(null);
    });

    // Start FA2 worker layout
    setIsLayoutRunning(true);
    const layout = startWorkerLayout(graph, () => {
      setIsLayoutRunning(false);
      sigma.refresh();
    });
    layoutRef.current = layout;

    sigma.getCamera().animatedReset({ duration: 600, easing: 'easeInOutCubic' });
    currentStructKeyRef.current = structuralKey;

    return () => {
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
      const attrs = graph.getNodeAttributes(selectedNodeId);
      camera.animate(
        { x: attrs.x, y: attrs.y, ratio: Math.max(camera.ratio, 0.08) },
        { duration: 500, easing: 'easeInOutCubic' },
      );
    } else if (!selectedNodeId) {
      camera.animatedReset({ duration: 600, easing: 'easeInOutCubic' });
    }
  }, [selectedNodeId, expandedBackboneNodeId]);

  // Update label visibility
  useEffect(() => {
    const sigma = sigmaRef.current;
    if (!sigma) return;
    sigma.setSetting('renderLabels', showLabels);
  }, [showLabels]);

  // React to theme changes — update Sigma settings without rebuilding the graph
  useEffect(() => {
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    if (!sigma || !graph) return;

    const t = getTokens(themeMode);

    // Swap node program (includes new drawHover callback)
    try {
      sigma.setSetting('nodeProgramClasses', { bordered: makeNodeProgram(themeMode) });
    } catch {
      // Sigma v3 may not support hot-swapping node programs — fallback: add to structural key
    }

    // Update label and default colors
    sigma.setSetting('labelColor', { color: t.colorText });
    sigma.setSetting('defaultNodeColor', themeMode === 'light' ? '#9A9AB0' : '#6b7280');
    sigma.setSetting('defaultEdgeColor', t.colorBorderStrong);

    // Refresh reducers with theme-aware dimColor
    const state = useGraphStore.getState();
    const visibleNodes = getVisibleNodes(state);
    const visibleNodeIds = new Set(visibleNodes.map((n) => n.id));
    const selId = state.selectedNodeId;
    let neighbors: NeighborSet = new Set();
    if (selId && graph.hasNode(selId)) {
      neighbors = new Set(graph.neighbors(selId));
      neighbors.add(selId);
    }
    sigma.setSetting('nodeReducer', createNodeReducer(selId, neighbors, visibleNodeIds, themeMode));
    sigma.setSetting('edgeReducer', createEdgeReducer(selId, graph, visibleNodeIds, themeMode));

    sigma.refresh();
  }, [themeMode]);

  const fitToScreen = useCallback(() => {
    sigmaRef.current?.getCamera().animatedReset({ duration: 600, easing: 'easeInOutCubic' });
  }, []);

  const focusOnNode = useCallback((nodeId: string) => {
    const sigma = sigmaRef.current;
    const graph = graphRef.current;
    if (!sigma || !graph || !graph.hasNode(nodeId)) return;
    const attrs = graph.getNodeAttributes(nodeId);
    sigma.getCamera().animate(
      { x: attrs.x, y: attrs.y, ratio: 0.15 },
      { duration: 500, easing: 'easeInOutCubic' },
    );
  }, []);

  const zoomIn = useCallback(() => {
    sigmaRef.current?.getCamera().animatedZoom({ duration: 300, easing: 'easeInOutCubic' });
  }, []);

  const zoomOut = useCallback(() => {
    sigmaRef.current?.getCamera().animatedUnzoom({ duration: 300, easing: 'easeInOutCubic' });
  }, []);

  const clearSelection = useCallback(() => {
    selectNode(null, false);
    sigmaRef.current?.getCamera().animatedReset({ duration: 600, easing: 'easeInOutCubic' });
  }, []);

  return { containerRef, fitToScreen, focusOnNode, zoomIn, zoomOut, clearSelection, isLayoutRunning };
}
