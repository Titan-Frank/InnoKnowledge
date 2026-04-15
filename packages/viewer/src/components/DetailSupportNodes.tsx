import type { CSSProperties } from 'react';
import type { GraphNode } from '../store/types.js';
import { useGraphStore, selectNode } from '../store/graphStore.js';
import { getNeighborEntries } from '../graph/visibility.js';
import { isBackboneNode, isSupportNode, getTypeLabel, humanizeKey } from '../graph/layout.js';
import { NODE_LAYER_LABELS } from '../constants/index.js';
import { ToneBadge, ActionButton } from './aiwc/index.js';
import { resolveEdgeVisual, resolveNodeLayerVisual } from '../graph/graphPresentation.js';
import {
  createDetailBodyTextStyle,
  createDetailEmptyCardStyle,
  detailSectionHeaderStyle,
  createDetailSectionMetaStyle,
  createDetailSectionStyle,
  createDetailSectionTitleStyle,
  createDetailSubcardStyle,
} from './workspaceStyles.js';
import { useTokens } from '../hooks/useTokens.js';

interface Props {
  node: GraphNode;
}

export function DetailSupportNodes({ node }: Props) {
  const t = useTokens();
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
      <div style={createDetailSectionStyle(t)}>
        <div style={detailSectionHeaderStyle}>
          <h3 style={createDetailSectionTitleStyle(t)}>支撑节点</h3>
          <span style={createDetailSectionMetaStyle(t)}>{noteText}</span>
        </div>
        <div style={createDetailEmptyCardStyle(t)}>
          <p style={createDetailBodyTextStyle(t)}>{fallbackNote}</p>
        </div>
      </div>
    );
  }

  return (
    <div style={createDetailSectionStyle(t)}>
      <div style={detailSectionHeaderStyle}>
        <h3 style={createDetailSectionTitleStyle(t)}>支撑节点</h3>
        <span style={createDetailSectionMetaStyle(t)}>{noteText}</span>
      </div>
      <div style={listStyle}>
        {items.map(({ edge, otherNode }) => {
          const layerVisual = resolveNodeLayerVisual(otherNode.node_layer);
          const edgeVisual = resolveEdgeVisual(edge.edge_type);
          return (
            <div
              key={otherNode.id}
              style={{
                ...createDetailSubcardStyle(t),
                borderLeft: `4px solid ${edgeVisual.stroke}`,
              }}
            >
              <ActionButton
                variant="ghost"
                onClick={() => selectNode(otherNode.id, true)}
              >
                <strong>{otherNode.name}</strong>
                <ToneBadge tone={layerVisual.badgeTone}>{layerVisual.label}</ToneBadge>
              </ActionButton>
              <div style={itemBadgeRowStyle}>
                <ToneBadge tone={edgeVisual.labelTone}>{edgeVisual.category}</ToneBadge>
                <ToneBadge tone="secondary">{edge.edge_type}</ToneBadge>
                <ToneBadge tone="neutral">
                  {isBackbone
                    ? getTypeLabel(otherNode.node_type)
                    : `${NODE_LAYER_LABELS[otherNode.node_layer] ?? humanizeKey(otherNode.node_layer)} · ${getTypeLabel(otherNode.node_type)}`}
                </ToneBadge>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

const listStyle: CSSProperties = {
  display: 'grid',
  gap: 8,
};

const itemBadgeRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
  marginTop: 8,
};
