import { lazy, Suspense, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import type { SemanticNeighbor } from '@okm/types';
import { useAppState } from '@/hooks/useAppState';
import { useG6 } from '@/hooks/useG6';
import {
  buildRadialFocusGraph,
  okmKnowledgeGraphToG6,
  type BuildResult,
  type RadialFocusResult,
} from '@/lib/graph-adapter';
import { getVisibleNodes } from '@/lib/visibility';
import { getNodeTypeLabel } from '@/core/graph/knowledge-data';
import { loadSemanticNeighbors } from '@/services/backend-client';
import { ZoomIn, ZoomOut, Maximize2, RefreshCw, Pause, RotateCcw, Network, Box, Loader2 } from '@/lib/lucide-icons';
import type { GraphCanvas3DHandle } from './GraphCanvas3D';

const LazyGraphCanvas3D = lazy(() => import('./GraphCanvas3D'));

const EMPTY_SEARCH_HIT_IDS = new Set<string>();
const DEFAULT_DETAIL_PANEL_WIDTH = 384;
const GRAPH_DISPLAY_MODE_KEY = 'okm-graph-display-mode';

type GraphDisplayMode = '2d' | '3d';

function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function getInitialDisplayMode(): GraphDisplayMode {
  if (typeof window === 'undefined') return '2d';
  return window.localStorage.getItem(GRAPH_DISPLAY_MODE_KEY) === '3d' && supportsWebGL() ? '3d' : '2d';
}

function isRadialFocusResult(result: BuildResult): result is RadialFocusResult {
  return Array.isArray((result as RadialFocusResult).formalNeighborIds);
}

function getDetailPanelRightInset(): number {
  if (!window.matchMedia('(min-width: 1024px)').matches) return 0;
  const stored = Number(window.localStorage.getItem('okm-detail-panel-width'));
  return Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_DETAIL_PANEL_WIDTH;
}

export function GraphCanvas() {
  const appState = useAppState();
  const {
    knowledgeGraph, selectedNodeId, selectedTypes, selectedBook,
    layerMode, expandedBackboneNodeId, showLabels, hoverNodeId,
    themeMode, setSelectedNodeId, setExpandedBackboneNodeId, setHoverNodeId,
    setCommunityInfo, setIsLayoutRunning,
    serverSearchHits,
  } = appState;

  const [hoveredNode, setHoveredNode] = useState<{ id: string; name: string } | null>(null);
  const [displayMode, setDisplayModeState] = useState<GraphDisplayMode>(getInitialDisplayMode);
  const [hasLoaded3D, setHasLoaded3D] = useState(() => getInitialDisplayMode() === '3d');
  const canUse3D = useMemo(supportsWebGL, []);
  const graph3DRef = useRef<GraphCanvas3DHandle>(null);
  const [semanticResult, setSemanticResult] = useState<{
    nodeId: string;
    neighbors: SemanticNeighbor[];
    loading: boolean;
  } | null>(null);

  // Compute visible node IDs — only structural filters (not selection)
  const structuralVisibility = useMemo(() => ({
    knowledgeGraph,
    selectedTypes,
    selectedBook,
    layerMode,
    expandedBackboneNodeId,
    focusConnected: false,
    selectedNodeId: null,
    searchTerm: '',
    serverSearchHits: new Map<string, { score: number }>(),
  }), [knowledgeGraph, selectedTypes, selectedBook, layerMode, expandedBackboneNodeId]);

  const visibleNodeIds = useMemo(() => {
    if (!knowledgeGraph) return new Set<string>();
    const nodes = getVisibleNodes(structuralVisibility);
    return new Set(nodes.map((n) => n.id));
  }, [structuralVisibility, knowledgeGraph]);

  useEffect(() => {
    setHoveredNode((current) => current && visibleNodeIds.has(current.id) ? current : null);
  }, [visibleNodeIds]);

  // Handle node click — only updates state, no graph rebuild
  const handleNodeClick = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    const node = knowledgeGraph?.nodeById.get(nodeId);
    if (node && node.nodeLayer === 'backbone' && layerMode === 'backbone-expand') {
      setExpandedBackboneNodeId(nodeId);
    }
  }, [setSelectedNodeId, setExpandedBackboneNodeId, knowledgeGraph, layerMode]);

  const handleNodeHover = useCallback((nodeId: string | null) => {
    if (!nodeId || !knowledgeGraph) {
      setHoveredNode(null);
      return;
    }
    const node = knowledgeGraph.nodeById.get(nodeId);
    setHoveredNode(node ? { id: node.id, name: node.name } : null);
  }, [knowledgeGraph]);

  const handleStageClick = useCallback(() => {
    setSelectedNodeId(null);
    setHoverNodeId(null);
  }, [setSelectedNodeId, setHoverNodeId]);

  const searchHitIds = useMemo(
    () => serverSearchHits.size > 0 ? new Set(serverSearchHits.keys()) : EMPTY_SEARCH_HIT_IDS,
    [serverSearchHits],
  );
  const selectedNode = selectedNodeId && visibleNodeIds.has(selectedNodeId) && knowledgeGraph
    ? knowledgeGraph.nodeById.get(selectedNodeId) ?? null
    : null;
  const sourceKey = String(knowledgeGraph?.source.key ?? '');

  useEffect(() => {
    if (!selectedNodeId || !sourceKey || !visibleNodeIds.has(selectedNodeId)) {
      setSemanticResult(null);
      return;
    }
    let active = true;
    setSemanticResult({ nodeId: selectedNodeId, neighbors: [], loading: true });
    void loadSemanticNeighbors(sourceKey, selectedNodeId, 10)
      .then((response) => {
        if (active && response.node_id === selectedNodeId) {
          setSemanticResult({ nodeId: selectedNodeId, neighbors: response.neighbors, loading: false });
        }
      })
      .catch(() => {
        if (active) setSemanticResult({ nodeId: selectedNodeId, neighbors: [], loading: false });
      });
    return () => {
      active = false;
    };
  }, [selectedNodeId, sourceKey, visibleNodeIds]);

  const graphBuild = useMemo(() => {
    if (!knowledgeGraph || visibleNodeIds.size === 0) return null;
    if (selectedNodeId && visibleNodeIds.has(selectedNodeId)) {
      const semanticNeighbors = semanticResult?.nodeId === selectedNodeId ? semanticResult.neighbors : [];
      return buildRadialFocusGraph(knowledgeGraph, selectedNodeId, semanticNeighbors, visibleNodeIds, themeMode);
    }
    return okmKnowledgeGraphToG6(knowledgeGraph, visibleNodeIds, themeMode);
  }, [knowledgeGraph, visibleNodeIds, selectedNodeId, semanticResult, themeMode]);

  // Keep 2D and 3D on the same overview/focus data contract. Selecting a node
  // therefore shows the same formal and semantic neighbors in either mode.
  const graph3DBuild = graphBuild;

  const radialBuild = graphBuild && isRadialFocusResult(graphBuild) ? graphBuild : null;
  const canvasSummary = selectedNode
    ? radialBuild
      ? `${getNodeTypeLabel(selectedNode)} · ${radialBuild.formalNeighborIds.length} 个正式邻居 · ${radialBuild.semanticNeighborIds.length} 个语义邻居`
      : getNodeTypeLabel(selectedNode)
    : searchHitIds.size > 0
      ? `${searchHitIds.size} 个检索命中`
      : `${visibleNodeIds.size} 个可见节点`;

  const {
    containerRef, setGraph, zoomIn, zoomOut, fitToScreen,
    focusNode, startLayout, stopLayout, containerReady,
  } = useG6({
    onNodeClick: handleNodeClick,
    onNodeHover: handleNodeHover,
    onStageClick: handleStageClick,
    onLayoutRunningChange: setIsLayoutRunning,
    selectedNodeId,
    searchHitIds,
    previewNodeId: hoveredNode?.id ?? hoverNodeId,
    themeMode,
    showLabels,
  });

  const setDisplayMode = useCallback((mode: GraphDisplayMode) => {
    if (mode === '3d' && !canUse3D) return;
    window.localStorage.setItem(GRAPH_DISPLAY_MODE_KEY, mode);
    if (mode === '3d') setHasLoaded3D(true);
    setDisplayModeState(mode);
  }, [canUse3D]);

  useEffect(() => {
    if (displayMode === '3d') stopLayout();
  }, [displayMode, stopLayout]);

  // Community metadata is shared by both renderers.
  useEffect(() => {
    if (!graphBuild) return;
    setCommunityInfo(graphBuild.communityCount, graphBuild.communities, graphBuild.communityMap);
  }, [graphBuild, setCommunityInfo]);

  // Keep the hidden G6 instance idle while 3D is active. Including displayMode
  // ensures it receives the latest focused graph as soon as the user returns.
  useEffect(() => {
    if (displayMode !== '2d' || !graphBuild || !containerReady) return;
    const positioning = isRadialFocusResult(graphBuild)
      ? {
          type: 'radial-focus' as const,
          centerNodeId: selectedNodeId!,
          formalNeighborIds: graphBuild.formalNeighborIds,
          semanticNeighborIds: graphBuild.semanticNeighborIds,
          viewportRightInset: getDetailPanelRightInset(),
        }
      : graphBuild.communitySource === 'embedding'
        ? { type: 'embedding-overview' as const }
        : undefined;
    void setGraph({
      data: graphBuild.data,
      nodeIds: graphBuild.nodeIds,
      edgePairs: graphBuild.edgePairs,
      positioning,
    });
  }, [displayMode, graphBuild, selectedNodeId, containerReady, setGraph]);

  // Focus on selected node
  const handleFocusSelected = useCallback(() => {
    if (!selectedNodeId) return;
    if (displayMode === '3d') graph3DRef.current?.focusNode(selectedNodeId);
    else focusNode(selectedNodeId);
  }, [displayMode, selectedNodeId, focusNode]);

  const handleZoomIn = useCallback(() => {
    if (displayMode === '3d') graph3DRef.current?.zoomIn();
    else zoomIn();
  }, [displayMode, zoomIn]);

  const handleZoomOut = useCallback(() => {
    if (displayMode === '3d') graph3DRef.current?.zoomOut();
    else zoomOut();
  }, [displayMode, zoomOut]);

  const handleFitToScreen = useCallback(() => {
    if (displayMode === '3d') graph3DRef.current?.fitToScreen();
    else fitToScreen();
  }, [displayMode, fitToScreen]);

  // Clear selection
  const handleClearSelection = useCallback(() => {
    setSelectedNodeId(null);
    handleFitToScreen();
  }, [setSelectedNodeId, handleFitToScreen]);

  const isLayoutRunning = appState.isLayoutRunning;

  return (
    <div className="relative h-full w-full bg-void">
      <div className="okm-canvas-grid" />
      <div className="okm-canvas-spotlight" />

      {/* G6 container */}
      <div
        ref={containerRef}
        aria-hidden={displayMode === '3d'}
        className={`g6-container h-full w-full cursor-grab active:cursor-grabbing ${
          displayMode === '3d' ? 'invisible pointer-events-none' : ''
        }`}
      />

      {hasLoaded3D && graph3DBuild && (
        <div
          aria-hidden={displayMode !== '3d'}
          className={`absolute inset-0 z-[5] ${displayMode !== '3d' ? 'invisible pointer-events-none' : ''}`}
        >
          <Suspense fallback={(
            <div className="absolute inset-0 flex items-center justify-center bg-void" role="status">
              <div className="flex items-center gap-2 rounded-lg border border-border-subtle bg-elevated/95 px-4 py-3 text-sm text-text-secondary shadow-panel">
                <Loader2 className="h-4 w-4 animate-spin text-accent" />
                正在加载 3D 图谱…
              </div>
            </div>
          )}>
            <LazyGraphCanvas3D
              ref={graph3DRef}
              active={displayMode === '3d'}
              build={graph3DBuild}
              selectedNodeId={selectedNodeId}
              searchHitIds={searchHitIds}
              previewNodeId={hoveredNode?.id ?? hoverNodeId}
              themeMode={themeMode}
              showLabels={showLabels}
              onNodeClick={handleNodeClick}
              onNodeHover={handleNodeHover}
              onStageClick={handleStageClick}
              onLayoutRunningChange={setIsLayoutRunning}
            />
          </Suspense>
        </div>
      )}

      <div className="absolute left-4 top-4 z-20 flex max-w-[min(660px,calc(100%-2rem))] animate-slide-up items-center gap-2 rounded-lg border border-border-subtle bg-elevated/95 px-3 py-2 shadow-panel backdrop-blur-sm">
        <div className={`h-2.5 w-2.5 shrink-0 rounded-full ${selectedNode ? 'bg-accent shadow-glow' : 'bg-node-process'}`} />
        <div className="min-w-0">
          <span className="block truncate text-sm font-semibold text-text-primary">
            {selectedNode?.name ?? '图谱画布'}
          </span>
          <span className="block truncate text-[11px] text-text-muted">{canvasSummary}</span>
        </div>
        <div className="ml-1 flex shrink-0 items-center gap-1">
          {selectedNode ? (
            <>
              <button
                onClick={handleFocusSelected}
                className="rounded-md border border-border-subtle bg-surface px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
              >
                聚焦
              </button>
              <button
                onClick={handleClearSelection}
                className="rounded-md border border-border-subtle bg-surface px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
              >
                清除
              </button>
            </>
          ) : (
            <button
              onClick={handleFitToScreen}
              className="rounded-md border border-border-subtle bg-surface px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
            >
              适应
            </button>
          )}
        </div>
      </div>

      <div
        className="okm-detail-aware-right absolute top-4 z-30 flex items-center rounded-lg border border-border-subtle bg-elevated/95 p-1 shadow-panel backdrop-blur-sm"
        data-detail-open={Boolean(selectedNode)}
        role="group"
        aria-label="图谱显示模式"
      >
        <button
          type="button"
          onClick={() => setDisplayMode('2d')}
          aria-pressed={displayMode === '2d'}
          className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors ${
            displayMode === '2d' ? 'bg-accent text-white shadow-glow-soft' : 'text-text-secondary hover:bg-hover hover:text-text-primary'
          }`}
          title="二维分析视图"
        >
          <Network className="h-3.5 w-3.5" />
          2D
        </button>
        <button
          type="button"
          onClick={() => setDisplayMode('3d')}
          disabled={!canUse3D}
          aria-pressed={displayMode === '3d'}
          className={`flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors disabled:opacity-40 ${
            displayMode === '3d' ? 'bg-accent text-white shadow-glow-soft' : 'text-text-secondary hover:bg-hover hover:text-text-primary'
          }`}
          title={canUse3D ? '三维探索视图' : '当前浏览器不支持 WebGL'}
        >
          <Box className="h-3.5 w-3.5" />
          3D
        </button>
      </div>

      {displayMode === '3d' && (
        <div
          className="okm-detail-aware-right pointer-events-none absolute top-[60px] z-20 rounded-md border border-border-subtle bg-elevated/82 px-2.5 py-1.5 text-[11px] text-text-muted shadow-panel backdrop-blur-sm"
          data-detail-open={Boolean(selectedNode)}
        >
          拖拽旋转 · 滚轮缩放 · 点击节点查看关联节点
        </div>
      )}

      {selectedNode && radialBuild && (
        <div className="pointer-events-none absolute left-4 top-[76px] z-20 max-w-[min(560px,calc(100%-2rem))] rounded-lg border border-border-subtle bg-elevated/90 px-3 py-2 text-[11px] leading-5 text-text-muted shadow-panel backdrop-blur-sm">
          <span className="mr-3 inline-flex items-center gap-1.5 text-text-secondary">
            <span className="h-0.5 w-4 bg-accent" />正式关系
          </span>
          <span className="inline-flex items-center gap-1.5 text-text-secondary">
            <span className="w-4 border-t border-dashed border-slate-400" />内容语义相似
          </span>
          <span className="ml-2">语义相似不代表图谱中的正式关系</span>
          {semanticResult?.loading && <span className="ml-2 text-accent">正在查找相关节点…</span>}
        </div>
      )}

      {/* Hovered node tooltip */}
      {hoveredNode && !selectedNodeId && (
        <div className="pointer-events-none absolute left-1/2 top-4 z-20 -translate-x-1/2 animate-fade-in rounded-lg border border-border-subtle bg-elevated/95 px-3 py-1.5 shadow-panel backdrop-blur-sm">
          <span className="font-mono text-sm text-text-primary">{hoveredNode.name}</span>
        </div>
      )}

      {knowledgeGraph && visibleNodeIds.size === 0 && (
        <div className="absolute inset-0 z-10 flex items-center justify-center p-4">
          <div className="max-w-sm rounded-lg border border-border-subtle bg-elevated/95 px-4 py-3 text-center shadow-panel backdrop-blur-sm">
            <div className="text-sm font-semibold text-text-primary">没有可见节点</div>
            <div className="mt-1 text-xs leading-5 text-text-muted">调整左侧筛选条件后会重新显示图谱</div>
          </div>
        </div>
      )}

      {/* Graph Controls - Bottom Right */}
      <div
        className="okm-detail-aware-right okm-tool-dock absolute bottom-4 z-10 flex flex-col gap-1 rounded-lg border border-border-subtle bg-elevated/95 p-1 shadow-panel backdrop-blur-sm"
        data-detail-open={Boolean(selectedNode)}
      >
        <button onClick={handleZoomIn} aria-label="放大图谱" className="flex h-9 w-9 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-hover hover:text-text-primary" title="放大">
          <ZoomIn className="h-4 w-4" />
        </button>
        <button onClick={handleZoomOut} aria-label="缩小图谱" className="flex h-9 w-9 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-hover hover:text-text-primary" title="缩小">
          <ZoomOut className="h-4 w-4" />
        </button>
        <button onClick={handleFitToScreen} aria-label="让图谱适应屏幕" className="flex h-9 w-9 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-hover hover:text-text-primary" title="适应屏幕">
          <Maximize2 className="h-4 w-4" />
        </button>
        <div className="my-1 h-px bg-border-subtle" />
        {selectedNodeId && (
          <button onClick={handleFocusSelected} aria-label="聚焦选中节点" className="flex h-9 w-9 items-center justify-center rounded-md bg-accent/15 text-accent transition-colors hover:bg-accent/25" title="聚焦选中节点">
            <RotateCcw className="h-4 w-4" />
          </button>
        )}
        {displayMode === '2d' && !selectedNode && graphBuild?.communitySource !== 'embedding' && (
          <>
            <div className="my-1 h-px bg-border-subtle" />
            <button
              onClick={isLayoutRunning ? stopLayout : startLayout}
              aria-label={isLayoutRunning ? '停止自动布局' : '重新整理图谱'}
              aria-pressed={isLayoutRunning}
              className={`flex h-9 w-9 items-center justify-center rounded-md transition-colors ${
                isLayoutRunning
                  ? 'animate-pulse bg-accent text-white shadow-glow'
                  : 'text-text-secondary hover:bg-hover hover:text-text-primary'
              }`}
              title={isLayoutRunning ? '停止自动布局' : '重新整理图谱'}
            >
              {isLayoutRunning ? <Pause className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
