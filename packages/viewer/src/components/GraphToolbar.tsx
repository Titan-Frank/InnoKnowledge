import type { CSSProperties } from 'react';
import { useGraphStore, setShowLabels } from '../store/graphStore.js';
import { getTypeLabel, getTypeColor } from '../graph/layout.js';
import { useTokens } from '../hooks/useTokens.js';
import type { TokenSet } from './aiwc/styles/tokens.js';

export function GraphToolbar() {
  const t = useTokens();
  const data = useGraphStore((s) => s.data);
  const showLabels = useGraphStore((s) => s.showLabels);

  return (
    <div style={toolbarStyle(t)}>
      <div style={legendStyle}>
        {(data?.availableTypes || []).map((type) => (
          <div style={legendItemStyle(t)} key={type}>
            <span style={{ ...legendDotStyle, background: getTypeColor(type) }} />
            <span>{getTypeLabel(type)}</span>
          </div>
        ))}
      </div>
      <div style={actionsStyle}>
        <button
          style={showLabels ? activeBtnStyle(t) : ghostBtnStyle(t)}
          onClick={() => setShowLabels(!showLabels)}
        >
          {showLabels ? '隐藏名称' : '显示名称'}
        </button>
      </div>
    </div>
  );
}

function toolbarStyle(t: TokenSet): CSSProperties {
  return {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    padding: '12px 14px 8px',
    borderBottom: `1px solid ${t.colorBorder}`,
    background: t.colorSurface,
  };
}

const legendStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  alignItems: 'center',
};

function legendItemStyle(t: TokenSet): CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 5,
    padding: '3px 8px',
    borderRadius: 999,
    background: t.colorSurfaceRaised,
    border: `1px solid ${t.colorBorder}`,
    color: t.colorTextSubtle,
    fontSize: 11,
    fontWeight: 500,
  };
}

const legendDotStyle: CSSProperties = {
  width: 8,
  height: 8,
  borderRadius: '50%',
  flexShrink: 0,
};

const actionsStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
};

const baseBtnStyle: CSSProperties = {
  border: 'none',
  borderRadius: 6,
  fontSize: 12,
  fontWeight: 500,
  padding: '5px 12px',
  cursor: 'pointer',
  fontFamily: "'PingFang SC', 'Microsoft YaHei', sans-serif",
  transition: 'background 120ms ease-out, color 120ms ease-out',
};

function activeBtnStyle(t: TokenSet): CSSProperties {
  return {
    ...baseBtnStyle,
    background: t.colorAccentSoft,
    border: `1px solid ${t.colorAccent}`,
    color: t.colorAccent,
  };
}

function ghostBtnStyle(t: TokenSet): CSSProperties {
  return {
    ...baseBtnStyle,
    background: t.colorSurfaceRaised,
    border: `1px solid ${t.colorBorder}`,
    color: t.colorMuted,
  };
}
