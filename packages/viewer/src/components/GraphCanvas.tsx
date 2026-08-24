import { useEffect, useMemo, useState, useCallback } from 'react';
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
import { ZoomIn, ZoomOut, Maximize2, RefreshCw, Pause, RotateCcw } from '@/lib/lucide-icons';

const EMPTY_SEARCH_HIT_IDS = new Set<string>();
const DEFAULT_DETAIL_PANEL_WIDTH = 384;

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
  const selectedNode = selectedNodeId && knowledgeGraph ? knowledgeGraph.nodeById.get(selectedNodeId) ?? null : null;
  const sourceKey = String(knowledgeGraph?.source.key ?? '');

  useEffect(() => {
    if (!selectedNodeId || !sourceKey) {
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
  }, [selectedNodeId, sourceKey]);

  const graphBuild = useMemo(() => {
    if (!knowledgeGraph || visibleNodeIds.size === 0) return null;
    if (selectedNodeId && knowledgeGraph.nodeById.has(selectedNodeId)) {
      const semanticNeighbors = semanticResult?.nodeId === selectedNodeId ? semanticResult.neighbors : [];
      return buildRadialFocusGraph(knowledgeGraph, selectedNodeId, semanticNeighbors, themeMode);
    }
    return okmKnowledgeGraphToG6(knowledgeGraph, visibleNodeIds, themeMode);
  }, [knowledgeGraph, visibleNodeIds, selectedNodeId, semanticResult, themeMode]);

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

  // Build and set graph ONLY when data or structural filters change
  useEffect(() => {
    if (!graphBuild || !containerReady) return;
    setCommunityInfo(graphBuild.communityCount, graphBuild.communities, graphBuild.communityMap);
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
  }, [graphBuild, selectedNodeId, containerReady, setGraph, setCommunityInfo]);

  // Focus on selected node
  const handleFocusSelected = useCallback(() => {
    if (selectedNodeId) focusNode(selectedNodeId);
  }, [selectedNodeId, focusNode]);

  // Clear selection
  const handleClearSelection = useCallback(() => {
    setSelectedNodeId(null);
    fitToScreen();
  }, [setSelectedNodeId, fitToScreen]);

  const isLayoutRunning = appState.isLayoutRunning;

  return (
    <div className="relative h-full w-full bg-void">
      <div className="okm-canvas-grid" />
      <div className="okm-canvas-spotlight" />

      {/* G6 container */}
      <div
        ref={containerRef}
        className="g6-container h-full w-full cursor-grab active:cursor-grabbing"
      />

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
              onClick={fitToScreen}
              className="rounded-md border border-border-subtle bg-surface px-2 py-1 text-xs text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
            >
              适应
            </button>
          )}
        </div>
      </div>

      {selectedNode && radialBuild && (
        <div className="pointer-events-none absolute left-4 top-[76px] z-20 max-w-[min(560px,calc(100%-2rem))] rounded-lg border border-border-subtle bg-elevated/90 px-3 py-2 text-[11px] leading-5 text-text-muted shadow-panel backdrop-blur-sm">
          <span className="mr-3 inline-flex items-center gap-1.5 text-text-secondary">
            <span className="h-0.5 w-4 bg-accent" />正式关系
          </span>
          <span className="inline-flex items-center gap-1.5 text-text-secondary">
            <span className="w-4 border-t border-dashed border-slate-400" />Embedding 语义相似
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
      <div className="okm-tool-dock absolute bottom-4 right-4 z-10 flex flex-col gap-1 rounded-lg border border-border-subtle bg-elevated/95 p-1 shadow-panel backdrop-blur-sm">
        <button onClick={zoomIn} aria-label="放大图谱" className="flex h-9 w-9 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-hover hover:text-text-primary" title="放大">
          <ZoomIn className="h-4 w-4" />
        </button>
        <button onClick={zoomOut} aria-label="缩小图谱" className="flex h-9 w-9 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-hover hover:text-text-primary" title="缩小">
          <ZoomOut className="h-4 w-4" />
        </button>
        <button onClick={fitToScreen} aria-label="让图谱适应屏幕" className="flex h-9 w-9 items-center justify-center rounded-md text-text-secondary transition-colors hover:bg-hover hover:text-text-primary" title="适应屏幕">
          <Maximize2 className="h-4 w-4" />
        </button>
        <div className="my-1 h-px bg-border-subtle" />
        {selectedNodeId && (
          <button onClick={handleFocusSelected} aria-label="聚焦选中节点" className="flex h-9 w-9 items-center justify-center rounded-md bg-accent/15 text-accent transition-colors hover:bg-accent/25" title="聚焦选中节点">
            <RotateCcw className="h-4 w-4" />
          </button>
        )}
        {!selectedNode && graphBuild?.communitySource !== 'embedding' && (
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
