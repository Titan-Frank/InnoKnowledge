import type { CSSProperties } from 'react';
import type { GraphNode } from '../store/types.js';
import { useGraphStore, selectNode } from '../store/graphStore.js';
import { getTypeLabel, humanizeKey } from '../graph/layout.js';
import { NODE_LAYER_LABELS, EDGE_LAYER_LABELS } from '../constants/index.js';
import { ToneBadge, ActionButton } from './aiwc/index.js';
import { resolveEdgeVisual, resolveNodeLayerVisual } from '../graph/graphPresentation.js';
import {
  detailBodyTextStyle,
  detailEmptyCardStyle,
  detailSectionStyle,
  detailSectionTitleStyle,
  detailSubcardStyle,
} from './workspaceStyles.js';

interface Props {
  node: GraphNode;
}

export function DetailRelations({ node }: Props) {
  const data = useGraphStore((s) => s.data);
  if (!data) return null;

  const relatedEdges = data.edges
    .filter((edge) => edge.from === node.id || edge.to === node.id)
    .slice()
    .sort((a, b) => b.confidence - a.confidence);

  if (relatedEdges.length === 0) {
    return (
      <div style={detailSectionStyle}>
        <h3 style={detailSectionTitleStyle}>关联关系</h3>
        <div style={detailEmptyCardStyle}>
          <p style={detailBodyTextStyle}>这个节点当前还没有关联关系。</p>
        </div>
      </div>
    );
  }

  return (
    <div style={detailSectionStyle}>
      <h3 style={detailSectionTitleStyle}>关联关系</h3>
      <div style={listStyle}>
        {relatedEdges.map((edge) => {
          const otherId = edge.from === node.id ? edge.to : edge.from;
          const otherNode = data.nodeById.get(otherId);
          const edgeProps = edge.properties as Record<string, unknown> | undefined;
          const edgeVisual = resolveEdgeVisual(edge.edge_type);
          const nodeLayerVisual = resolveNodeLayerVisual(otherNode?.node_layer);
          return (
            <div
              style={{
                ...detailSubcardStyle,
                borderLeft: `4px solid ${edgeVisual.stroke}`,
                gap: 8,
                display: 'grid',
              }}
              key={edge.id}
            >
              <ActionButton variant="ghost" onClick={() => selectNode(otherId, true)}>
                {edge.edge_type} · {otherNode?.name || otherId}
              </ActionButton>
              <div style={badgeRowStyle}>
                <ToneBadge tone={edgeVisual.labelTone}>{edgeVisual.category}</ToneBadge>
                <ToneBadge tone="secondary">{edge.edge_type}</ToneBadge>
                <ToneBadge tone={nodeLayerVisual.badgeTone}>{nodeLayerVisual.label}</ToneBadge>
              </div>
              <div style={edgeLegendStyle}>
                <span style={edgeLegendLabelStyle}>关系线型</span>
                <span
                  style={edgeLegendSampleStyle(edgeVisual.stroke, edgeVisual.dashArray)}
                  aria-hidden
                />
              </div>
              <p style={detailBodyTextStyle}>
                {edge.backbone_expand ? '主干展开' : EDGE_LAYER_LABELS[edge.edge_layer ?? 'support'] ?? humanizeKey(edge.edge_layer ?? 'support')} · {NODE_LAYER_LABELS[otherNode?.node_layer ?? 'other'] ?? humanizeKey(otherNode?.node_layer ?? 'other')} · {getTypeLabel(otherNode?.node_type ?? 'other')}
              </p>
              {edgeProps?.relation ? (
                <ToneBadge tone="neutral">{String(edgeProps.relation || edgeProps.relation_note || '无附加说明')}</ToneBadge>
              ) : null}
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

const badgeRowStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
};

const edgeLegendStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
};

const edgeLegendLabelStyle: CSSProperties = {
  color: detailBodyTextStyle.color,
  fontSize: '0.84rem',
  whiteSpace: 'nowrap',
};

function edgeLegendSampleStyle(stroke: string, dashArray?: string): CSSProperties {
  const lineStyle = dashArray === '3 6' ? 'dotted' : dashArray ? 'dashed' : 'solid';
  return {
    display: 'inline-block',
    width: 84,
    borderTop: `2px solid ${stroke}`,
    borderTopStyle: lineStyle,
    opacity: 0.9,
  };
}
