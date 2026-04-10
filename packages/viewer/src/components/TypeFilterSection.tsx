import { useMemo } from 'react';
import { useGraphStore, toggleType, resetTypes } from '../store/graphStore.js';
import { getTypeLabel } from '../graph/layout.js';
import { getVisibleNodes } from '../graph/visibility.js';

export function TypeFilterSection() {
  const data = useGraphStore((s) => s.data);
  const selectedTypes = useGraphStore((s) => s.selectedTypes);

  const countsByType = useMemo(() => {
    if (!data) return new Map<string, number>();
    const state = useGraphStore.getState();
    const scopedNodes = getVisibleNodes(state, { ignoreTypeFilter: true });
    const counts = new Map<string, number>();
    scopedNodes.forEach((node) => {
      counts.set(node.node_type, (counts.get(node.node_type) || 0) + 1);
    });
    return counts;
  }, [data, useGraphStore.getState().selectedBook, useGraphStore.getState().layerMode,
      useGraphStore.getState().expandedBackboneNodeId, useGraphStore.getState().focusConnected]);

  if (!data) return null;

  return (
    <section className="panel-section">
      <div className="section-head">
        <h2>节点类型</h2>
        <button className="ghost-button" onClick={resetTypes}>重置</button>
      </div>
      <div className="chip-grid">
        {data.availableTypes.map((type) => {
          const label = getTypeLabel(type);
          const count = countsByType.get(type) || 0;
          const active = selectedTypes.has(type);
          return (
            <button
              key={type}
              className={`chip ${active ? 'active' : ''} ${count === 0 ? 'empty' : ''}`}
              onClick={() => toggleType(type)}
            >
              {label} <span className="section-note">{count}</span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
