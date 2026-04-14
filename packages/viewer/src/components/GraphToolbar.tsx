import type { CSSProperties } from 'react';
import { useGraphStore, setShowLabels } from '../store/graphStore.js';
import { getTypeLabel, getTypeColor } from '../graph/layout.js';
import { ActionButton, aiWebComponentTokens } from './aiwc/index.js';

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
        <ActionButton
          variant={showLabels ? 'primary' : 'ghost'}
          onClick={() => setShowLabels(!showLabels)}
        >
          {showLabels ? '隐藏名称' : '显示名称'}
        </ActionButton>
      </div>
    </div>
  );
}

const toolbarStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: 12,
  padding: '16px 16px 10px',
  borderBottom: `1px solid ${aiWebComponentTokens.colorBorder}`,
  background: 'linear-gradient(180deg, rgba(255,255,255,0.96) 0%, rgba(247,248,255,0.92) 100%)',
};

const legendStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  alignItems: 'center',
};

const legendItemStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  padding: '4px 10px',
  borderRadius: aiWebComponentTokens.radiusPill,
  background: 'rgba(255,255,255,0.9)',
  border: `1px solid ${aiWebComponentTokens.colorBorder}`,
  color: aiWebComponentTokens.colorTextSubtle,
  fontSize: '0.8rem',
  boxShadow: aiWebComponentTokens.shadowSoft,
};

const legendDotStyle: CSSProperties = {
  width: 10,
  height: 10,
  borderRadius: '50%',
};

const actionsStyle: CSSProperties = {
  display: 'flex',
  gap: 8,
};
