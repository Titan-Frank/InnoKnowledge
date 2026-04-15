import type { CSSProperties, ReactNode } from 'react';
import { useSigma } from '../hooks/useSigma.js';
import { SigmaCameraControls } from './SigmaCameraControls.js';
import { useGraphStore } from '../store/graphStore.js';
import { getTypeColor, getTypeLabel } from '../graph/layout.js';
import { resolveEdgeVisual } from '../graph/graphPresentation.js';
import { useTokens } from '../hooks/useTokens.js';
import type { TokenSet } from './aiwc/styles/tokens.js';

interface SigmaGraphPanelProps {
  status?: 'idle' | 'loading' | 'error';
  emptyState?: ReactNode;
}

export function SigmaGraphPanel({ status, emptyState }: SigmaGraphPanelProps) {
  const { containerRef, fitToScreen, zoomIn, zoomOut, clearSelection, isLayoutRunning } = useSigma();
  const t = useTokens();
  const data = useGraphStore((s) => s.data);
  const selectedNodeId = useGraphStore((s) => s.selectedNodeId);
  const hoverNodeId = useGraphStore((s) => s.hoverNodeId);
  const communityCount = useGraphStore((s) => s.communityCount);
  const communities = useGraphStore((s) => s.communities);
  const communityMap = useGraphStore((s) => s.communityMap);

  const nodeCount = data?.nodes.length ?? 0;
  const edgeCount = data?.edges.length ?? 0;
  const typeCount = data?.availableTypes.length ?? 0;
  const selectedNode = selectedNodeId ? data?.nodeById.get(selectedNodeId) : null;
  const hoveredNode = hoverNodeId ? data?.nodeById.get(hoverNodeId) : null;

  const isEmpty = status === 'idle' && nodeCount === 0;
  const isLoading = status === 'loading';
  const isError = status === 'error';

  const typeSummary = data?.availableTypes.map((tp) => ({
    type: tp,
    label: getTypeLabel(tp),
    color: getTypeColor(tp),
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

  const selectedCommunityId = selectedNodeId && communityMap.has(selectedNodeId)
    ? communityMap.get(selectedNodeId)!
    : null;

  return (
    <div style={panelStyle(t)}>
      {/* Background gradient */}
      <div style={bgGradientStyle(t)} />

      {/* Sigma canvas — always mounted */}
      <div ref={containerRef} style={canvasStyle} />

      {/* Status overlays */}
      {(isEmpty || isLoading || isError) && (
        <div style={statusOverlayStyle(t)}>
          <div style={statusTextStyle(t)}>
            {isError ? '加载失败，请重试。' : isLoading ? '数据加载中...' : (emptyState ?? '当前筛选下没有可显示的节点。')}
          </div>
        </div>
      )}

      {/* Graph UI overlays */}
      {!isEmpty && !isLoading && !isError && (
        <>
          {/* Hover tooltip — only when hovering and NOT selected */}
          {hoveredNode && !selectedNodeId && (
            <div style={hoverTooltipStyle(t)}>
              <span style={hoverTooltipTextStyle(t)}>{hoveredNode.name}</span>
            </div>
          )}

          {/* Selection info bar — top center */}
          {selectedNode && (
            <div style={selectionBarStyle(t)}>
              <span style={selectionDotStyle(selectedNode.color)} />
              <span style={selectionNameStyle(t)}>{selectedNode.name}</span>
              <span style={selectionTypeStyle(t)}>{getTypeLabel(selectedNode.node_type)}</span>
              {selectedCommunityId !== null && (
                <span style={selectionClusterStyle(t)}>簇 {selectedCommunityId + 1}</span>
              )}
              <button onClick={clearSelection} style={clearBtnStyle(t)}>清除</button>
            </div>
          )}

          {/* Top-left: overview card */}
          <div style={overlayTopLeftStyle}>
            <div style={overviewCardStyle(t)}>
              <div style={overviewTitleStyle(t)}>图谱总览</div>
              <div style={overviewStatsStyle(t)}>
                <span>{nodeCount} 节点</span>
                <span style={dotStyle(t)}>·</span>
                <span>{edgeCount} 关系</span>
                <span style={dotStyle(t)}>·</span>
                <span>{typeCount} 类型</span>
              </div>
              {communityCount > 1 && (
                <div style={communitySectionStyle}>
                  <div style={communityLabelStyle(t)}>{communityCount} 语义簇</div>
                  <div style={communityChipsStyle}>
                    {communities.slice(0, 8).map((c) => (
                      <span key={c.id} style={communityChipStyle(c.color)}>
                        <span style={communityDotStyle(c.color)} />
                        {getTypeLabel(c.dominantType)} · {c.nodeCount}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <div style={typeChipsStyle}>
                {typeSummary.map((tp) => (
                  <span key={tp.type} style={typeChipStyle(tp.color, communityCount > 1)}>{tp.label}</span>
                ))}
              </div>
            </div>
          </div>

          {/* Top-right: guide */}
          <div style={overlayTopRightStyle}>
            <div style={guideCardStyle(t)}>
              <span style={guideChipStyle(t)}>拖拽平移</span>
              <span style={guideChipStyle(t)}>滚轮缩放</span>
              <span style={guideChipStyle(t)}>点击选中</span>
            </div>
          </div>

          {/* Bottom-left: focus node relations */}
          {selectedNode && focusRelations.length > 0 && (
            <div style={overlayBottomStyle}>
              <div style={relationsStripStyle(t)}>
                <div style={relationsLabelStyle(t)}>关键关系</div>
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

function panelStyle(t: TokenSet): CSSProperties {
  return {
    position: 'absolute', inset: 0, width: '100%', height: '100%',
    overflow: 'hidden', background: t.colorPage,
  };
}

function bgGradientStyle(t: TokenSet): CSSProperties {
  return {
    position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 0,
    background: `
      radial-gradient(circle at 50% 50%, rgba(124, 58, 237, 0.03) 0%, transparent 70%),
      linear-gradient(to bottom, ${t.colorPage}, ${t.colorSurfaceMuted})
    `,
  };
}

const canvasStyle: CSSProperties = {
  position: 'absolute', inset: 0, width: '100%', height: '100%',
  zIndex: 1, cursor: 'grab',
};

function statusOverlayStyle(t: TokenSet): CSSProperties {
  return {
    position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
    justifyContent: 'center', background: t.colorPage, zIndex: 10,
  };
}

function statusTextStyle(t: TokenSet): CSSProperties {
  return {
    color: t.colorMuted, fontSize: 14,
    fontFamily: "'PingFang SC', 'Microsoft YaHei', sans-serif",
  };
}

// Hover tooltip (top center)
function hoverTooltipStyle(t: TokenSet): CSSProperties {
  return {
    position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
    zIndex: 20, pointerEvents: 'none',
    background: t.colorSurface, backdropFilter: 'blur(8px)',
    border: `1px solid ${t.colorBorder}`, borderRadius: 8,
    padding: '6px 14px',
  };
}

function hoverTooltipTextStyle(t: TokenSet): CSSProperties {
  return {
    fontSize: 13, fontWeight: 500, color: t.colorText,
    fontFamily: "'PingFang SC', 'Microsoft YaHei', monospace",
  };
}

// Selection info bar
function selectionBarStyle(t: TokenSet): CSSProperties {
  return {
    position: 'absolute', top: 16, left: '50%', transform: 'translateX(-50%)',
    zIndex: 20, display: 'flex', alignItems: 'center', gap: 8,
    background: t.colorAccentSoft, backdropFilter: 'blur(8px)',
    border: `1px solid ${t.colorAccent}`, borderRadius: 12,
    padding: '8px 16px',
  };
}

function selectionDotStyle(color: string): CSSProperties {
  return { width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 };
}

function selectionNameStyle(t: TokenSet): CSSProperties {
  return {
    fontSize: 13, fontWeight: 500, color: t.colorText,
    fontFamily: "'PingFang SC', 'Microsoft YaHei', monospace",
  };
}

function selectionTypeStyle(t: TokenSet): CSSProperties {
  return {
    fontSize: 11, color: t.colorMuted,
  };
}

function selectionClusterStyle(t: TokenSet): CSSProperties {
  return {
    fontSize: 10, fontWeight: 500, color: t.colorAccent,
    background: t.colorAccentSoft, borderRadius: 999, padding: '1px 6px',
  };
}

function clearBtnStyle(t: TokenSet): CSSProperties {
  return {
    marginLeft: 8, padding: '2px 8px', border: 'none', borderRadius: 4,
    background: 'transparent', color: t.colorTextSubtle, fontSize: 11, cursor: 'pointer',
    transition: 'background 120ms ease-out',
  };
}

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
function overviewCardStyle(t: TokenSet): CSSProperties {
  return {
    background: t.colorSurface, backdropFilter: 'blur(10px)',
    border: `1px solid ${t.colorBorder}`, borderRadius: 12,
    display: 'grid', gap: 8, maxWidth: 340, padding: '14px 16px', pointerEvents: 'auto',
  };
}

function overviewTitleStyle(t: TokenSet): CSSProperties {
  return { fontSize: 13, fontWeight: 600, color: t.colorAccent };
}

function overviewStatsStyle(t: TokenSet): CSSProperties {
  return { fontSize: 12, color: t.colorTextSubtle, display: 'flex', gap: 4 };
}

function dotStyle(t: TokenSet): CSSProperties {
  return { color: t.colorBorderStrong };
}

// Community section
const communitySectionStyle: CSSProperties = {
  display: 'grid', gap: 6,
};

function communityLabelStyle(t: TokenSet): CSSProperties {
  return {
    fontSize: 11, fontWeight: 500, color: t.colorTextSubtle,
  };
}

const communityChipsStyle: CSSProperties = {
  display: 'flex', flexWrap: 'wrap', gap: 6,
};

function communityChipStyle(color: string): CSSProperties {
  return {
    display: 'inline-flex', alignItems: 'center', gap: 4,
    background: hexToRgba(color, 0.12), border: `1px solid ${hexToRgba(color, 0.2)}`,
    borderRadius: 999, color, fontSize: 11, fontWeight: 500, padding: '3px 8px',
  };
}

function communityDotStyle(color: string): CSSProperties {
  return {
    width: 6, height: 6, borderRadius: '50%', background: color, flexShrink: 0,
  };
}

// Type chips
const typeChipsStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6 };

function typeChipStyle(color: string, compact = false): CSSProperties {
  return {
    background: hexToRgba(color, 0.15), border: `1px solid ${hexToRgba(color, 0.25)}`,
    borderRadius: 999, color, fontSize: compact ? 10 : 11, fontWeight: 500,
    padding: compact ? '2px 6px' : '3px 8px',
  };
}

// Guide
function guideCardStyle(t: TokenSet): CSSProperties {
  return {
    alignItems: 'center', background: t.colorSurface, backdropFilter: 'blur(10px)',
    border: `1px solid ${t.colorBorder}`, borderRadius: 999,
    display: 'flex', flexWrap: 'wrap', gap: 8, padding: '8px 12px', pointerEvents: 'auto',
  };
}

function guideChipStyle(t: TokenSet): CSSProperties {
  return { fontSize: 11, color: t.colorMuted };
}

// Relations
function relationsStripStyle(t: TokenSet): CSSProperties {
  return {
    background: t.colorSurface, backdropFilter: 'blur(10px)',
    border: `1px solid ${t.colorBorder}`, borderRadius: 10, padding: '10px 14px', pointerEvents: 'auto',
  };
}

function relationsLabelStyle(t: TokenSet): CSSProperties {
  return { fontSize: 11, fontWeight: 500, color: t.colorMuted, marginBottom: 8 };
}

const relationsChipsStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 6 };

function relationChipStyle(stroke: string): CSSProperties {
  return {
    background: hexToRgba(stroke, 0.12), border: `1px solid ${hexToRgba(stroke, 0.2)}`,
    borderRadius: 999, color: stroke, fontSize: 12, fontWeight: 500, padding: '5px 10px',
  };
}

// Layout indicator (uses fixed success colors — visible on both themes)
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
