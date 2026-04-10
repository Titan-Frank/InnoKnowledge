import { useMemo } from 'react';
import { useGraphStore, selectNode } from '../store/graphStore.js';
import { getSearchMatches } from '../graph/visibility.js';
import { getTypeLabel } from '../graph/layout.js';
import { NODE_LAYER_LABELS } from '../constants/index.js';
import { humanizeKey } from '../graph/layout.js';

export function SearchResultList() {
  const searchTerm = useGraphStore((s) => s.searchTerm);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);

  const matches = useMemo(() => {
    return getSearchMatches(useGraphStore.getState()).slice(0, 60);
  }, [searchTerm, selectedNodeId, useGraphStore.getState().selectedTypes,
      useGraphStore.getState().selectedBook, useGraphStore.getState().layerMode,
      useGraphStore.getState().focusConnected, useGraphStore.getState().expandedBackboneNodeId]);

  if (matches.length === 0) {
    return (
      <section className="panel-section">
        <div className="section-head"><h2>搜索结果</h2></div>
        <div className="result-list">
          <div className="empty-state">
            <p>当前筛选下没有匹配结果，可以放宽类型筛选或切换来源范围。</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="panel-section">
      <div className="section-head"><h2>搜索结果</h2></div>
      <div className="result-list">
        {matches.map((node) => (
          <button
            key={node.id}
            className={`result-item ${selectedNodeId === node.id ? 'active' : ''}`}
            onClick={() => selectNode(node.id, true)}
          >
            <strong>{node.name}</strong>
            <span>
              {NODE_LAYER_LABELS[node.node_layer] ?? humanizeKey(node.node_layer)} · {getTypeLabel(node.node_type)} · {node.id}
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
