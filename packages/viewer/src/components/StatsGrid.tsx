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

  const items: Array<{ label: string; value: number; accent: string }> = [
    { label: '节点数', value: stats.nodes, accent: t.colorAccent },
    { label: '主干', value: stats.backbone, accent: t.colorSuccess },
    { label: '支撑', value: stats.support, accent: t.colorSecondaryAccent },
    { label: '关系数', value: stats.edges, accent: t.colorWarning },
  ];

  return (
    <div style={gridStyle}>
      {items.map((item) => (
        <div key={item.label} style={cardStyle(t)}>
          <span style={cardDotStyle(item.accent)} />
          <strong style={valueStyle}>{item.value}</strong>
          <span style={labelStyle(t)}>{item.label}</span>
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
    position: 'relative',
    display: 'grid',
    gap: 6,
    minHeight: 108,
    padding: '16px 16px 14px',
    border: `1px solid ${t.colorBorder}`,
    borderRadius: 20,
    background: `linear-gradient(180deg, ${t.colorSurface} 0%, ${t.colorSurfaceRaised} 100%)`,
    boxShadow: t.shadowSoft,
  };
}

function cardDotStyle(color: string): CSSProperties {
  return {
    width: 10,
    height: 10,
    borderRadius: '50%',
    background: color,
    boxShadow: `0 0 0 6px ${color}22`,
  };
}

const valueStyle: CSSProperties = {
  display: 'block',
  fontSize: '2rem',
  fontWeight: 800,
  lineHeight: 1,
  letterSpacing: '-0.04em',
};

function labelStyle(t: TokenSet): CSSProperties {
  return {
    display: 'block',
    color: t.colorMuted,
    fontSize: '0.88rem',
    fontWeight: 600,
  };
}
