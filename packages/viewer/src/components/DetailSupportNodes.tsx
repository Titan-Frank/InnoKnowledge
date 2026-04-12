import type { CSSProperties } from 'react';
import type { GraphNode } from '../store/types.js';
import { useGraphStore, selectNode } from '../store/graphStore.js';
import { getNeighborEntries } from '../graph/visibility.js';
import { isBackboneNode, isSupportNode, getTypeLabel, humanizeKey } from '../graph/layout.js';
import { NODE_LAYER_LABELS } from '../constants/index.js';
import { ToneBadge, ActionButton, aiWebComponentTokens } from './aiwc/index.js';

interface Props {
  node: GraphNode;
}

export function DetailSupportNodes({ node }: Props) {
  const state = useGraphStore.getState();

  const neighborEntries = getNeighborEntries(node, state).sort((a, b) =>
    a.otherNode.name.localeCompare(b.otherNode.name, 'zh-CN'),
  );
  const expansionEntries = neighborEntries.filter((entry) => entry.edge.backbone_expand);
  const supportEntries = expansionEntries.filter((entry) => isSupportNode(entry.otherNode));
  const backboneEntries = expansionEntries.filter((entry) => isBackboneNode(entry.otherNode));

  const isBackbone = isBackboneNode(node);

  const noteText = isBackbone
    ? supportEntries.length
      ? `${supportEntries.length} 个一跳支撑节点`
      : '当前没有一跳支撑节点'
    : backboneEntries.length
      ? `${backboneEntries.length} 个所属主干`
      : '当前是支撑节点';

  const items = isBackbone ? supportEntries : backboneEntries;

  if (items.length === 0) {
    const fallbackNote = isBackbone
      ? '这个主干节点目前还没有拆出支撑节点，后续可以继续补方法、实验、表征等支撑层。'
      : '这个支撑节点暂时还没有挂接到明确的主干节点。';
    return (
      <div style={blockStyle}>
        <div style={headStyle}>
          <h3 style={blockTitleStyle}>支撑节点</h3>
          <span style={noteStyle}>{noteText}</span>
        </div>
        <div style={emptyStyle}>
          <p style={emptyTextStyle}>{fallbackNote}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={blockStyle}>
      <div style={headStyle}>
        <h3 style={blockTitleStyle}>支撑节点</h3>
        <span style={noteStyle}>{noteText}</span>
      </div>
      <div style={listStyle}>
        {items.map(({ edge, otherNode }) => (
          <ActionButton
            key={otherNode.id}
            variant="ghost"
            onClick={() => selectNode(otherNode.id, true)}
          >
            <strong>{otherNode.name}</strong>
            <ToneBadge tone="neutral">
              {isBackbone
                ? `${getTypeLabel(otherNode.node_type)} · ${edge.edge_type}`
                : `${NODE_LAYER_LABELS[otherNode.node_layer] ?? humanizeKey(otherNode.node_layer)} · ${edge.edge_type}`}
            </ToneBadge>
          </ActionButton>
        ))}
      </div>
    </div>
  );
}

const blockStyle: CSSProperties = {
  marginTop: 16,
};

const blockTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: '1.06rem',
  fontWeight: 600,
};

const headStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 8,
};

const noteStyle: CSSProperties = {
  color: aiWebComponentTokens.colorMuted,
  fontSize: '0.82rem',
};

const listStyle: CSSProperties = {
  display: 'grid',
  gap: 8,
  marginTop: 8,
};

const emptyStyle: CSSProperties = {
  border: `1px solid ${aiWebComponentTokens.colorBorder}`,
  borderRadius: aiWebComponentTokens.radiusSmall,
  background: aiWebComponentTokens.colorSurfaceMuted,
  padding: 12,
  marginTop: 8,
};

const emptyTextStyle: CSSProperties = {
  margin: 0,
  color: aiWebComponentTokens.colorMuted,
  fontSize: '0.88rem',
  lineHeight: 1.6,
};
