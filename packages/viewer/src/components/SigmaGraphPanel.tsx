import type { CSSProperties, ReactNode } from 'react';
import { useSigma } from '../hooks/useSigma.js';
import { SigmaCameraControls } from './SigmaCameraControls.js';
import { useGraphStore } from '../store/graphStore.js';
import { getTypeColor, getTypeLabel } from '../graph/layout.js';
import { resolveEdgeVisual } from '../graph/graphPresentation.js';

interface SigmaGraphPanelProps {
  status?: 'idle' | 'loading' | 'error';
  emptyState?: ReactNode;
}

export function SigmaGraphPanel({ status, emptyState }: SigmaGraphPanelProps) {
  const { containerRef, fitToScreen, zoomIn, zoomOut, clearSelection, isLayoutRunning } = useSigma();
  const data = useGraphStore((s) => s.data);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const hoverNodeId = useGraphStore((s) => s.hoverNodeId);

  const nodeCount = data?.nodes.length ?? 0;
  const edgeCount = data?.edges.length ?? 0;
  const typeCount = data?.availableTypes.length ?? 0;
  const selectedNode = selectedNodeId ? data?.nodeById.get(selectedNodeId) : null;
  const hoveredNode = hoverNodeId ? data?.nodeById.get(hoverNodeId) : null;

  const isEmpty = status === 'idle' && nodeCount === 0;
  const isLoading = status === 'loading';
  const isError = status === 'error';

  const typeSummary = data?.availableTypes.map((t) => ({
    type: t,
    label: getTypeLabel(t),
    color: getTypeColor(t),
  })) ?? [];

  const focusRelations: Array<{ label: string; otherName: string; edgeColor: string }> = [];
  if (selectedNode && data) {
    for (const edge of data.edges) {
      if (focusRelations.length >= 6) break;
      if (edge.from === selectedNode.id) {
        const target = data.nodeById.get(edge.to);
        if (target) {
          const visual = resolveEdgeVisual(edge.edge_type);
          focusRelations.push({ label: edge.edge_type, otherName: target.name, edgeColor: visual.stroke });
        }
      } else if (edge.to === selectedNode.id) {
        const source = data.nodeById.get(edge.from);
        if (source) {
          const visual = resolveEdgeVisual(edge.edge_type);
          focusRelations.push({ label: edge.edge_type, otherName: source.name, edgeColor: visual.stroke });
        }
      }
    }
  }

  return (
    <div style={panelStyle}>
      {/* Background gradient */}
      <div style={bgGradientStyle} />

      {/* Sigma canvas — always mounted */}
      <div ref={containerRef} style={canvasStyle} />

      {/* Status overlays */}
      {(isEmpty || isLoading || isError) && (
        <div style={statusOverlayStyle}>
          <div style={statusTextStyle}>
            {isError ? '加载失败，请重试。' : isLoading ? '数据加载中...' : (emptyState ?? '当前筛选下没有可显示的节点。')}
          </div>
        </div>
      )}

      {/* Graph UI overlays */}
      {!isEmpty && !isLoading && !isError && (
        <>
          {/* Hover tooltip — only when hovering and NOT selected */}
          {hoveredNode && !selectedNodeId && (
            <div style={hoverTooltipStyle}>
              <span style={hoverTooltipTextStyle}>{hoveredNode.name}</span>
            </div>
          )}

          {/* Selection info bar — top center */}
          {selectedNode && (
            <div style={selectionBarStyle}>
              <span style={selectionDotStyle(selectedNode.color)} />
              <span style={selectionNameStyle}>{selectedNode.name}</span>
              <span style={selectionTypeStyle}>{getTypeLabel(selectedNode.node_type)}</span>
              <button onClick={clearSelection} style={clearBtnStyle}>清除</button>
            </div>
          )}

          {/* Top-left: overview card */}
          <div style={overlayTopLeftStyle}>
            <div style={overviewCardStyle}>
              <div style={overviewTitleStyle}>图谱总览</div>
              <div style={overviewStatsStyle}>
                <span>{nodeCount} 节点</span>
                <span style={dotStyle}>·</span>
                <span>{edgeCount} 关系</span>
                <span style={dotStyle}>·</span>
                <span>{typeCount} 类型</span>
              </div>
              <div style={typeChipsStyle}>
                {typeSummary.map((t) => (
                  <span key={t.type} style={typeChipStyle(t.color)}>{t.label}</span>
                ))}
              </div>
            </div>
          </div>

          {/* Top-right: guide */}
          <div style={overlayTopRightStyle}>
            <div style={guideCardStyle}>
              <span style={guideChipStyle}>拖拽平移</span>
              <span style={guideChipStyle}>滚轮缩放</span>
              <span style={guideChipStyle}>点击选中</span>
            </div>
          </div>

          {/* Bottom-left: focus node relations */}
          {selectedNode && focusRelations.length > 0 && (
            <div style={overlayBottomStyle}>
              <div style={relationsStripStyle}>
                <div style={relationsLabelStyle}>关键关系</div>
                <div style={relationsChipsStyle}>
                  {focusRelations.map((rel, i) => (
                    <span key={i} style={relationChipStyle(rel.edgeColor)}>
                      {rel.otherName} · {rel.label}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Layout indicator — bottom center */}
          {isLayoutRunning && (
            <div style={layoutIndicatorStyle}>
              <span style={layoutDotStyle} />
              <span style={layoutTextStyle}>布局优化中...</span>
            </div>
          )}

          {/* Camera controls */}
          <SigmaCameraControls
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            onFitToScreen={fitToScreen}
          />
        </>
      )}
    </div>
  );
}

// ── Styles ──

const panelStyle: CSSProperties = {
  position: 'absolute', inset: 0, width: '100%', height: '100%',
  overflow: 'hidden', background: '#06060a',
};

const bgGradientStyle: CSSProperties = {
  position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
  background: `
    radial-gradient(circle at 50% 50%, rgba(124, 58, 237, 0.03) 0%, transparent 70%),
    linear-gradient(to bottom, #06060a, #0a0a10)
  `,
};

const canvasStyle: CSSProperties = {
  position: 'absolute', inset: 0, width: '100%', height: '100%',
  zIndex: 1, cursor: 'grab',
};

const statusOverlayStyle: CSSProperties = {
  position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
  justifyContent: 'center', background: '#06060a', zIndex: 10,
};

const statusTextStyle: CSSProperties = {
  color: '#5a5a70', fontSize: 14,
  fontFamily: "'PingFang SC', 'Microsoft YaHei', sans-serif",
};

// Hover tooltip (top center)
const hoverTooltipStyle: CSSProperties = {
  position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
  zIndex: 20, pointerEvents: 'none',
  background: 'rgba(22, 22, 31, 0.95)', backdropFilter: 'blur(8px)',
  border: '1px solid #1e1e2a', borderRadius: 8,
  padding: '6px 14px',
};

const hoverTooltipTextStyle: CSSProperties = {
  fontSize: 13, fontWeight: 500, color: '#e4e4ed',
  fontFamily: "'PingFang SC', 'Microsoft YaHei', monospace",
};

// Selection info bar
const selectionBarStyle: CSSProperties = {
  position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
  zIndex: 20, display: 'flex', alignItems: 'center', gap: 8,
  background: 'rgba(124, 58, 237, 0.18)', backdropFilter: 'blur(8px)',
  border: '1px solid rgba(124, 58, 237, 0.3)', borderRadius: 12,
  padding: '8px 16px',
};

function selectionDotStyle(color: string): CSSProperties {
  return { width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 };
}

const selectionNameStyle: CSSProperties = {
  fontSize: 13, fontWeight: 500, color: '#e4e4ed',
  fontFamily: "'PingFang SC', 'Microsoft YaHei', monospace",
};

const selectionTypeStyle: CSSProperties = {
  fontSize: 11, color: '#5a5a70',
};

const clearBtnStyle: CSSProperties = {
  marginLeft: 8, padding: '2px 8px', border: 'none', borderRadius: 4,
  background: 'transparent', color: '#8888a0', fontSize: 11, cursor: 'pointer',
  transition: 'background 120ms ease-out',
};

// Overlays
const overlayTopLeftStyle: CSSProperties = {
  position: 'absolute', top: 16, left: 16, zIndex: 5, pointerEvents: 'none',
};

const overlayTopRightStyle: CSSProperties = {
  position: 'absolute', top: 16, right: 16, zIndex: 5, pointerEvents: 'none',
};

const overlayBottomStyle: CSSProperties = {
  position: 'absolute', bottom: 16, left: 16, maxWidth: 560,
  display: 'grid', gap: 10, pointerEvents: 'none', zIndex: 5,
};

// Overview
const overviewCardStyle: CSSProperties = {
  background: 'rgba(22, 22, 31, 0.9)', backdropFilter: 'blur(10px)',
  border: '1px solid #1e1e2a', borderRadius: 12,
  display: 'grid', gap: 8, maxWidth: 340, padding: '14px 16px', pointerEvents: 'auto',
};

const overviewTitleStyle: CSSProperties = { fontSize: 13, fontWeight: 600, color: '#7c3aed' };

const overviewStatsStyle: CSSProperties = { fontSize: 12, color: '#8888a0', display: 'flex', gap: 4 };

const dotStyle: CSSProperties = { color: '#2a2a3a' };

const typeChipsStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6 };

function typeChipStyle(color: string): CSSProperties {
  return {
    background: hexToRgba(color, 0.15), border: `1px solid ${hexToRgba(color, 0.25)}`,
    borderRadius: 999, color, fontSize: 11, fontWeight: 500, padding: '3px 8px',
  };
}

// Guide
const guideCardStyle: CSSProperties = {
  alignItems: 'center', background: 'rgba(22, 22, 31, 0.85)', backdropFilter: 'blur(10px)',
  border: '1px solid #1e1e2a', borderRadius: 999,
  display: 'flex', flexWrap: 'wrap', gap: 8, padding: '8px 12px', pointerEvents: 'auto',
};

const guideChipStyle: CSSProperties = { fontSize: 11, color: '#5a5a70' };

// Relations
const relationsStripStyle: CSSProperties = {
  background: 'rgba(22, 22, 31, 0.85)', backdropFilter: 'blur(10px)',
  border: '1px solid #1e1e2a', borderRadius: 10, padding: '10px 14px', pointerEvents: 'auto',
};

const relationsLabelStyle: CSSProperties = { fontSize: 11, fontWeight: 500, color: '#5a5a70', marginBottom: 8 };

const relationsChipsStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6 };

function relationChipStyle(stroke: string): CSSProperties {
  return {
    background: hexToRgba(stroke, 0.12), border: `1px solid ${hexToRgba(stroke, 0.2)}`,
    borderRadius: 999, color: stroke, fontSize: 12, fontWeight: 500, padding: '5px 10px',
  };
}

// Layout indicator
const layoutIndicatorStyle: CSSProperties = {
  position: 'absolute', bottom: 16, left: '50%', transform: 'translateX(-50%)',
  zIndex: 10, display: 'flex', alignItems: 'center', gap: 8,
  background: 'rgba(16, 185, 129, 0.18)', backdropFilter: 'blur(8px)',
  border: '1px solid rgba(16, 185, 129, 0.3)', borderRadius: 999,
  padding: '6px 14px',
};

const layoutDotStyle: CSSProperties = {
  width: 8, height: 8, borderRadius: '50%', background: '#34d399',
  animation: 'pulse-dot 1.5s ease-in-out infinite',
};

const layoutTextStyle: CSSProperties = {
  fontSize: 12, fontWeight: 500, color: '#34d399',
  fontFamily: "'PingFang SC', 'Microsoft YaHei', sans-serif",
};

function hexToRgba(hex: string, alpha: number): string {
  if (hex.startsWith('rgba')) return hex;
  const cleaned = hex.replace('#', '');
  const full = cleaned.length === 3
    ? cleaned[0] + cleaned[0] + cleaned[1] + cleaned[1] + cleaned[2] + cleaned[2] : cleaned;
  const r = parseInt(full.substring(0, 2), 16);
  const g = parseInt(full.substring(2, 4), 16);
  const b = parseInt(full.substring(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
