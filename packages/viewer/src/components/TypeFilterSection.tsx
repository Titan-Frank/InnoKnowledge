import { useMemo, type CSSProperties } from 'react';
import { useGraphStore, toggleType, resetTypes } from '../store/graphStore.js';
import { getTypeLabel } from '../graph/layout.js';
import { getVisibleNodes } from '../graph/visibility.js';
import { ActionButton, ToneBadge } from './aiwc/index.js';
import {
  workspaceSectionHeaderStyle,
  createWorkspaceSectionStyle,
  createWorkspaceSectionTitleStyle,
} from './workspaceStyles.js';
import { useTokens } from '../hooks/useTokens.js';

export function TypeFilterSection() {
  const t = useTokens();
  const data = useGraphStore((s) => s.data);
  const selectedTypes = useGraphStore((s) => s.selectedTypes);
  const selectedBook = useGraphStore((s) => s.selectedBook);
  const layerMode = useGraphStore((s) => s.layerMode);
  const expandedBackboneNodeId = useGraphStore((s) => s.expandedBackboneNodeId);
  const focusConnected = useGraphStore((s) => s.focusConnected);

  const countsByType = useMemo(() => {
    if (!data) return new Map<string, number>();
    const state = useGraphStore.getState();
    const scopedNodes = getVisibleNodes(state, { ignoreTypeFilter: true });
    const counts = new Map<string, number>();
    scopedNodes.forEach((node) => {
      counts.set(node.node_type, (counts.get(node.node_type) || 0) + 1);
    });
    return counts;
  }, [data, selectedBook, layerMode, expandedBackboneNodeId, focusConnected]);

  if (!data) return null;

  return (
    <div style={createWorkspaceSectionStyle(t)}>
      <div style={workspaceSectionHeaderStyle}>
        <h2 style={createWorkspaceSectionTitleStyle(t)}>节点类型</h2>
        <ActionButton variant="ghost" onClick={resetTypes}>重置</ActionButton>
      </div>
      <div style={chipGridStyle}>
        {data.availableTypes.map((type) => {
          const label = getTypeLabel(type);
          const count = countsByType.get(type) || 0;
          const active = selectedTypes.has(type);
          return (
            <button
              key={type}
              onClick={() => toggleType(type)}
              style={{
                ...chipBaseStyle,
                ...(count === 0 ? chipEmptyStyle : null),
              }}
            >
              <ToneBadge tone={active ? 'accent' : 'neutral'}>
                {label}
              </ToneBadge>
              <span style={countStyle(t)}>{count}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const chipGridStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
};

const chipBaseStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  padding: 0,
  fontFamily: 'inherit',
};

const chipEmptyStyle: CSSProperties = {
  opacity: 0.5,
};

function countStyle(t: ReturnType<typeof useTokens>): CSSProperties {
  return {
    color: t.colorMuted,
    fontSize: '0.82rem',
  };
}
