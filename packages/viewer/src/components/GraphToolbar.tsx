import type { CSSProperties } from 'react';
import { useGraphStore, setShowLabels } from '../store/graphStore.js';
import { getTypeLabel, getTypeColor } from '../graph/layout.js';

export function GraphToolbar() {
  const data = useGraphStore((s) => s.data);
  const showLabels = useGraphStore((s) => s.showLabels);

  return (
    <div style={toolbarStyle}>
      <div style={legendStyle}>
        {(data?.availableTypes || []).map((type) => (
          <div style={legendItemStyle} key={type}>
            <span style={{ ...legendDotStyle, background: getTypeColor(type) }} />
            <span>{getTypeLabel(type)}</span>
          </div>
        ))}
      </div>
      <div style={actionsStyle}>
        <button
          style={showLabels ? activeBtnStyle : ghostBtnStyle}
          onClick={() => setShowLabels(!showLabels)}
        >
          {showLabels ? '隐藏名称' : '显示名称'}
        </button>
      </div>
    </div>
  );
}

const toolbarStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
  padding: '12px 14px 8px',
  borderBottom: '1px solid #1e1e2a',
  background: 'linear-gradient(180deg, rgba(16,16,24,0.98) 0%, rgba(10,10,16,0.95) 100%)',
};

const legendStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 6,
  alignItems: 'center',
};

const legendItemStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
  padding: '3px 8px',
  borderRadius: 999,
  background: 'rgba(22, 22, 31, 0.8)',
  border: '1px solid #1e1e2a',
  color: '#8888a0',
  fontSize: 11,
  fontWeight: 500,
};

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

const activeBtnStyle: CSSProperties = {
  ...baseBtnStyle,
  background: 'rgba(124, 58, 237, 0.2)',
  border: '1px solid rgba(124, 58, 237, 0.3)',
  color: '#a78bfa',
};

const ghostBtnStyle: CSSProperties = {
  ...baseBtnStyle,
  background: 'rgba(22, 22, 31, 0.8)',
  border: '1px solid #1e1e2a',
  color: '#5a5a70',
};
