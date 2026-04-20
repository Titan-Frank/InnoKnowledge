import { useAppState } from '@/hooks/useAppState';
import { getSearchMatches } from '@/lib/visibility';
import { TYPE_META, LAYER_MODE_OPTIONS } from '@/lib/constants';
import { BookOpen, Layers, Eye, EyeOff, ChevronDown, ChevronRight } from '@/lib/lucide-icons';
import { useMemo, useState, useCallback } from 'react';

export function FilterPanel() {
  const appState = useAppState();
  const {
    knowledgeGraph, selectedNodeId, selectedTypes, selectedBook,
    layerMode, focusConnected, showLabels,
    setSelectedNodeId, setExpandedBackboneNodeId,
    toggleType, resetTypes,
    setSelectedBook, setLayerMode, setFocusConnected,
    setShowLabels, sourceConfigs, switchSource,
    searchTerm,
  } = appState;

  const [typeSectionOpen, setTypeSectionOpen] = useState(true);

  const visibilityState = useMemo(() => ({
    knowledgeGraph,
    selectedTypes,
    selectedBook,
    layerMode,
    expandedBackboneNodeId: appState.expandedBackboneNodeId,
    focusConnected,
    selectedNodeId,
    searchTerm,
    serverSearchHits: appState.serverSearchHits,
  }), [knowledgeGraph, selectedTypes, selectedBook, layerMode, appState.expandedBackboneNodeId, focusConnected, selectedNodeId, searchTerm, appState.serverSearchHits]);

  const searchMatches = useMemo(() => {
    if (!knowledgeGraph) return [];
    return getSearchMatches(visibilityState);
  }, [visibilityState, knowledgeGraph]);

  const books = useMemo(() => {
    if (!knowledgeGraph) return [];
    return Array.from(knowledgeGraph.booksById.keys());
  }, [knowledgeGraph]);

  const handleSelectNode = useCallback((nodeId: string) => {
    setSelectedNodeId(nodeId);
    const node = knowledgeGraph?.nodeById.get(nodeId);
    if (node && node.nodeLayer === 'backbone' && layerMode === 'backbone-expand') {
      setExpandedBackboneNodeId(nodeId);
    }
  }, [knowledgeGraph, layerMode, setSelectedNodeId, setExpandedBackboneNodeId]);

  if (!knowledgeGraph) return null;

  return (
    <aside className="flex w-72 flex-col border-r border-border-subtle bg-surface overflow-hidden">
      <div className="flex-1 overflow-y-auto scrollbar-thin p-3 space-y-4">
        {/* Source selector */}
        {sourceConfigs.size > 1 && (
          <section>
            <select
              value={appState.selectedSourceKey || ''}
              onChange={(e) => switchSource(e.target.value)}
              className="w-full rounded-md border border-border-subtle bg-elevated px-2 py-1.5 text-xs text-text-secondary outline-none focus:border-accent"
            >
              {Array.from(sourceConfigs.entries()).map(([key, config]) => (
                <option key={key} value={key}>{config.label}</option>
              ))}
            </select>
          </section>
        )}

        {/* Search results */}
        {searchTerm && (
          <section>
            <div className="mb-1.5 text-xs font-medium text-text-muted">搜索结果 ({searchMatches.length})</div>
            <div className="space-y-0.5 max-h-48 overflow-y-auto scrollbar-thin">
              {searchMatches.map((node) => (
                <button
                  key={node.id}
                  onClick={() => handleSelectNode(node.id)}
                  className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors ${
                    selectedNodeId === node.id
                      ? 'bg-accent/20 text-text-primary'
                      : 'text-text-secondary hover:bg-hover'
                  }`}
                >
                  <div className="h-2 w-2 rounded-full" style={{ backgroundColor: TYPE_META[node.nodeType]?.color ?? '#9A9AB0' }} />
                  <span className="truncate">{node.name}</span>
                </button>
              ))}
              {searchMatches.length === 0 && (
                <div className="px-2 py-2 text-xs text-text-muted">未找到匹配节点</div>
              )}
            </div>
          </section>
        )}

        {/* Book filter */}
        {books.length > 1 && (
          <section>
            <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-text-muted">
              <BookOpen className="h-3.5 w-3.5" />
              教材筛选
            </div>
            <div className="flex flex-wrap gap-1">
              <button
                onClick={() => setSelectedBook('all')}
                className={`rounded-md px-2 py-1 text-xs transition-colors ${
                  selectedBook === 'all' ? 'bg-accent/20 text-accent' : 'bg-elevated text-text-secondary hover:bg-hover'
                }`}
              >
                全部
              </button>
              {books.map((bookId) => (
                <button
                  key={bookId}
                  onClick={() => setSelectedBook(bookId)}
                  className={`rounded-md px-2 py-1 text-xs transition-colors ${
                    selectedBook === bookId ? 'bg-accent/20 text-accent' : 'bg-elevated text-text-secondary hover:bg-hover'
                  }`}
                >
                  {bookId}
                </button>
              ))}
            </div>
          </section>
        )}

        {/* Layer mode */}
        <section>
          <div className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-text-muted">
            <Layers className="h-3.5 w-3.5" />
            显示模式
          </div>
          <div className="flex gap-1">
            {LAYER_MODE_OPTIONS.map((option) => (
              <button
                key={option.id}
                onClick={() => setLayerMode(option.id)}
                className={`flex-1 rounded-md px-2 py-1.5 text-xs transition-colors ${
                  layerMode === option.id ? 'bg-accent/20 text-accent' : 'bg-elevated text-text-secondary hover:bg-hover'
                }`}
                title={option.description}
              >
                {option.label}
              </button>
            ))}
          </div>
          {/* Controls */}
          <div className="mt-2 flex items-center gap-2">
            <button
              onClick={() => setFocusConnected(!focusConnected)}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
                focusConnected ? 'bg-accent/20 text-accent' : 'bg-elevated text-text-secondary hover:bg-hover'
              }`}
            >
              {focusConnected ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              关联
            </button>
            <button
              onClick={() => setShowLabels(!showLabels)}
              className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
                showLabels ? 'bg-accent/20 text-accent' : 'bg-elevated text-text-secondary hover:bg-hover'
              }`}
            >
              {showLabels ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
              标签
            </button>
          </div>
        </section>

        {/* Type filter */}
        <section>
          <button
            onClick={() => setTypeSectionOpen(!typeSectionOpen)}
            className="mb-1.5 flex w-full items-center justify-between text-xs font-medium text-text-muted"
          >
            <span>类型筛选 ({selectedTypes.size}/{knowledgeGraph.availableTypes.length})</span>
            {typeSectionOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </button>
          {typeSectionOpen && (
            <div className="flex flex-wrap gap-1">
              <button
                onClick={resetTypes}
                className="rounded-md px-2 py-1 text-xs text-text-muted hover:bg-hover transition-colors"
              >
                全选
              </button>
              {knowledgeGraph.availableTypes.map((type) => (
                <button
                  key={type}
                  onClick={() => toggleType(type)}
                  className={`flex items-center gap-1 rounded-md px-2 py-1 text-xs transition-colors ${
                    selectedTypes.has(type)
                      ? 'bg-elevated text-text-primary'
                      : 'bg-elevated/40 text-text-muted line-through'
                  }`}
                >
                  <div className="h-2 w-2 rounded-full" style={{ backgroundColor: TYPE_META[type]?.color ?? '#9A9AB0' }} />
                  {TYPE_META[type]?.label ?? type}
                </button>
              ))}
            </div>
          )}
        </section>
      </div>
    </aside>
  );
}
