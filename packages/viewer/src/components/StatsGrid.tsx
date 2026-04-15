import { useMemo, type CSSProperties } from 'react';
import { useGraphStore } from '../store/graphStore.js';
import { getVisibleNodes } from '../graph/visibility.js';
import { isBackboneNode, isSupportNode } from '../graph/layout.js';
import { useTokens } from '../hooks/useTokens.js';
import type { TokenSet } from './aiwc/styles/tokens.js';

export function StatsGrid() {
  const t = useTokens();
  const data = useGraphStore((s) => s.data);
  const selectedTypes = useGraphStore((s) => s.selectedTypes);
  const selectedBook = useGraphStore((s) => s.selectedBook);
  const layerMode = useGraphStore((s) => s.layerMode);
  const expandedBackboneNodeId = useGraphStore((s) => s.expandedBackboneNodeId);
  const focusConnected = useGraphStore((s) => s.focusConnected);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);

  const stats = useMemo(() => {
    if (!data) return { nodes: 0, backbone: 0, support: 0, edges: 0 };
    const state = useGraphStore.getState();
    const visibleNodes = getVisibleNodes(state);
    const visibleNodeIds = new Set(visibleNodes.map((n) => n.id));
    const visibleEdgeCount = data.edges.filter(
      (e) => visibleNodeIds.has(e.from) && visibleNodeIds.has(e.to),
    ).length;
    return {
      nodes: visibleNodeIds.size,
      backbone: visibleNodes.filter((n) => isBackboneNode(n)).length,
      support: visibleNodes.filter((n) => isSupportNode(n)).length,
      edges: visibleEdgeCount,
    };
  }, [data, selectedTypes, selectedBook, layerMode, expandedBackboneNodeId, focusConnected, selectedNodeId]);

  const items: Array<[string, number]> = [
    ['节点数', stats.nodes],
    ['主干', stats.backbone],
    ['支撑', stats.support],
    ['关系数', stats.edges],
  ];

  return (
    <div style={gridStyle}>
      {items.map(([label, value]) => (
        <div key={label} style={cardStyle(t)}>
          <strong style={valueStyle}>{value}</strong>
          <span style={labelStyle(t)}>{label}</span>
        </div>
      ))}
    </div>
  );
}

const gridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
  gap: 12,
};

function cardStyle(t: TokenSet): CSSProperties {
  return {
    padding: 16,
    border: `1px solid ${t.colorBorder}`,
    borderRadius: t.radiusSmall,
    background: t.colorSurface,
    boxShadow: t.shadowSoft,
  };
}

const valueStyle: CSSProperties = {
  display: 'block',
  fontSize: '1.7rem',
  fontWeight: 700,
};

function labelStyle(t: TokenSet): CSSProperties {
  return {
    display: 'block',
    marginTop: 4,
    color: t.colorMuted,
    fontSize: '0.92rem',
  };
}
