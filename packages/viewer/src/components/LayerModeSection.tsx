import type { CSSProperties } from 'react';
import { useGraphStore, setLayerMode, collapseSupport } from '../store/graphStore.js';
import { LAYER_MODE_OPTIONS } from '../constants/index.js';
import { SegmentedControl, ActionButton, aiWebComponentTokens } from './aiwc/index.js';

export function LayerModeSection() {
  const layerMode = useGraphStore((s) => s.layerMode);
  const expandedBackboneNodeId = useGraphStore((s) => s.expandedBackboneNodeId);
  const data = useGraphStore((s) => s.data);

  const expandedNode = expandedBackboneNodeId && data?.nodeById.get(expandedBackboneNodeId);
  const layerNote = layerMode === 'all'
    ? '全部可见'
    : expandedNode
      ? `已展开 ${expandedNode.name}`
      : '主干优先';

  const activeMode = LAYER_MODE_OPTIONS.find((o) => o.id === layerMode);
  const hints = [activeMode?.description];
  if (layerMode === 'backbone-expand') {
    hints.push(
      expandedNode
        ? `当前展开主干: ${expandedNode.name}`
        : '点一个主干节点，就会把它的一跳支撑节点展开出来。',
    );
  }
  const showCollapse = layerMode === 'backbone-expand' && expandedNode;

  return (
    <div style={sectionStyle}>
      <div style={sectionHeadStyle}>
        <h2 style={sectionTitleStyle}>层级视图</h2>
        <span style={noteStyle}>{layerNote}</span>
      </div>
      <SegmentedControl
        value={layerMode}
        items={LAYER_MODE_OPTIONS.map((o) => ({ id: o.id, label: o.label }))}
        onChange={(v) => setLayerMode(v as typeof layerMode)}
        ariaLabel="层级视图"
      />
      <p style={hintStyle}>{hints.filter(Boolean).join(' | ')}</p>
      {showCollapse && (
        <ActionButton variant="ghost" onClick={collapseSupport}>
          收起当前支撑展开
        </ActionButton>
      )}
    </div>
  );
}

const sectionStyle: CSSProperties = {
  padding: '16px 16px 12px',
  borderTop: `1px solid ${aiWebComponentTokens.colorBorder}`,
};

const sectionHeadStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
  marginBottom: 12,
};

const sectionTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: '1.06rem',
  fontWeight: 600,
};

const noteStyle: CSSProperties = {
  color: aiWebComponentTokens.colorMuted,
  fontSize: '0.82rem',
};

const hintStyle: CSSProperties = {
  margin: '8px 0 0',
  color: aiWebComponentTokens.colorMuted,
  fontSize: '0.84rem',
  lineHeight: 1.6,
};
