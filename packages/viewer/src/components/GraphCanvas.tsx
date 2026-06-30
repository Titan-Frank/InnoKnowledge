import { useEffect, useMemo, useState, useCallback } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { useG6 } from '@/hooks/useG6';
import { okmKnowledgeGraphToG6 } from '@/lib/graph-adapter';
import { getVisibleNodes } from '@/lib/visibility';
import { getNodeTypeLabel } from '@/core/graph/knowledge-data';
import { ZoomIn, ZoomOut, Maximize2, Play, Pause, RotateCcw } from '@/lib/lucide-icons';

export function GraphCanvas() {
  const appState = useAppState();
  const {
    knowledgeGraph, selectedNodeId, selectedTypes, selectedBook,
    layerMode, expandedBackboneNodeId, showLabels, hoverNodeId,
    themeMode, setSelectedNodeId, setExpandedBackboneNodeId, setHoverNodeId,
    setCommunityInfo, setIsLayoutRunning,
    serverSearchHits,
  } = appState;

  const [hoveredNodeName, setHoveredNodeName] = useState<string | null>(null);

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
      setHoveredNodeName(null);
      setHoverNodeId(null);
      return;
    }
    const node = knowledgeGraph.nodeById.get(nodeId);
    setHoveredNodeName(node?.name ?? null);
    setHoverNodeId(node?.id ?? null);
  }, [knowledgeGraph, setHoverNodeId]);

  const handleStageClick = useCallback(() => {
    setSelectedNodeId(null);
    setHoverNodeId(null);
  }, [setSelectedNodeId, setHoverNodeId]);

  const searchHitIds = useMemo(() => new Set(serverSearchHits.keys()), [serverSearchHits]);

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
    previewNodeId: hoverNodeId,
    themeMode,
    showLabels,
  });

  // Build and set graph ONLY when data or structural filters change
  useEffect(() => {
    if (!knowledgeGraph || !containerReady) return;
    if (visibleNodeIds.size === 0) return;

    const result = okmKnowledgeGraphToG6(knowledgeGraph, visibleNodeIds, themeMode);
    setCommunityInfo(result.communityCount, result.communities, result.communityMap);
    void setGraph({
      data: result.data,
      nodeIds: result.nodeIds,
      edgePairs: result.edgePairs,
    });
  }, [knowledgeGraph, visibleNodeIds, themeMode, containerReady, setGraph, setCommunityInfo]);

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
      {/* Background gradient */}
      <div className="pointer-events-none absolute inset-0">
        <div
          className="absolute inset-0"
          style={{
            background: `
              radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--color-accent) 6%, transparent) 0%, transparent 70%),
              linear-gradient(to bottom, var(--color-void), var(--color-deep))
            `,
          }}
        />
      </div>

      {/* G6 container */}
      <div
        ref={containerRef}
        className="g6-container h-full w-full cursor-grab active:cursor-grabbing"
      />

      {/* Hovered node tooltip */}
      {hoveredNodeName && !selectedNodeId && (
        <div className="pointer-events-none absolute top-4 left-1/2 z-20 -translate-x-1/2 animate-fade-in rounded-lg border border-border-subtle bg-elevated/95 px-3 py-1.5 backdrop-blur-sm">
          <span className="font-mono text-sm text-text-primary">{hoveredNodeName}</span>
        </div>
      )}

      {/* Selection info bar */}
      {selectedNodeId && knowledgeGraph && (
        <div className="absolute top-4 left-1/2 z-20 flex -translate-x-1/2 animate-slide-up items-center gap-2 rounded-xl border border-accent/30 bg-accent/20 px-4 py-2.5 backdrop-blur-sm">
          <div className="h-2 w-2 animate-pulse rounded-full bg-accent" />
          <span className="font-mono text-base text-text-primary">
            {knowledgeGraph.nodeById.get(selectedNodeId)?.name ?? selectedNodeId}
          </span>
          {(() => {
            const node = knowledgeGraph.nodeById.get(selectedNodeId);
            if (!node) return null;
            return <span className="text-sm text-text-muted">({getNodeTypeLabel(node)})</span>;
          })()}
          <button
            onClick={handleClearSelection}
            className="ml-2 rounded px-2 py-0.5 text-xs text-text-secondary transition-colors hover:bg-white/10 hover:text-text-primary"
          >
            清除
          </button>
        </div>
      )}

      {/* Graph Controls - Bottom Right */}
      <div className="absolute right-4 bottom-4 z-10 flex flex-col gap-1">
        <button onClick={zoomIn} aria-label="放大图谱" className="flex h-9 w-9 items-center justify-center rounded-md border border-border-subtle bg-elevated text-text-secondary transition-colors hover:bg-hover hover:text-text-primary" title="放大">
          <ZoomIn className="h-4 w-4" />
        </button>
        <button onClick={zoomOut} aria-label="缩小图谱" className="flex h-9 w-9 items-center justify-center rounded-md border border-border-subtle bg-elevated text-text-secondary transition-colors hover:bg-hover hover:text-text-primary" title="缩小">
          <ZoomOut className="h-4 w-4" />
        </button>
        <button onClick={fitToScreen} aria-label="让图谱适应屏幕" className="flex h-9 w-9 items-center justify-center rounded-md border border-border-subtle bg-elevated text-text-secondary transition-colors hover:bg-hover hover:text-text-primary" title="适应屏幕">
          <Maximize2 className="h-4 w-4" />
        </button>
        <div className="my-1 h-px bg-border-subtle" />
        {selectedNodeId && (
          <button onClick={handleFocusSelected} aria-label="聚焦选中节点" className="flex h-9 w-9 items-center justify-center rounded-md border border-accent/30 bg-accent/20 text-accent transition-colors hover:bg-accent/30" title="聚焦选中节点">
            <RotateCcw className="h-4 w-4" />
          </button>
        )}
        <div className="my-1 h-px bg-border-subtle" />
        <button
          onClick={isLayoutRunning ? stopLayout : startLayout}
          aria-label={isLayoutRunning ? '停止布局优化' : '重新开始布局优化'}
          aria-pressed={isLayoutRunning}
          className={`flex h-9 w-9 items-center justify-center rounded-md border transition-all ${
            isLayoutRunning
              ? 'animate-pulse border-accent bg-accent text-white shadow-glow'
              : 'border-border-subtle bg-elevated text-text-secondary hover:bg-hover hover:text-text-primary'
          }`}
          title={isLayoutRunning ? '停止布局优化' : '重新开始布局优化'}
        >
          {isLayoutRunning ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </button>
      </div>
    </div>
  );
}
