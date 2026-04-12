import type { CSSProperties } from 'react';
import type { GraphNode } from '../store/types.js';
import { useGraphStore, selectNode } from '../store/graphStore.js';
import { getTypeLabel, humanizeKey } from '../graph/layout.js';
import { NODE_LAYER_LABELS, EDGE_LAYER_LABELS } from '../constants/index.js';
import { ToneBadge, ActionButton, aiWebComponentTokens } from './aiwc/index.js';

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
      <div style={blockStyle}>
        <h3 style={blockTitleStyle}>关联关系</h3>
        <div style={emptyStyle}>
          <p style={emptyTextStyle}>这个节点当前还没有关联关系。</p>
        </div>
      </div>
    );
  }

  return (
    <div style={blockStyle}>
      <h3 style={blockTitleStyle}>关联关系</h3>
      <div style={listStyle}>
        {relatedEdges.map((edge) => {
          const otherId = edge.from === node.id ? edge.to : edge.from;
          const otherNode = data.nodeById.get(otherId);
          const edgeProps = edge.properties as Record<string, unknown> | undefined;
          return (
            <div style={relationStyle} key={edge.id}>
              <ActionButton variant="ghost" onClick={() => selectNode(otherId, true)}>
                {edge.edge_type} · {otherNode?.name || otherId}
              </ActionButton>
              <p style={descStyle}>
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

const blockStyle: CSSProperties = {
  marginTop: 16,
};

const blockTitleStyle: CSSProperties = {
  margin: 0,
  fontSize: '1.06rem',
  fontWeight: 600,
};

const listStyle: CSSProperties = {
  display: 'grid',
  gap: 8,
  marginTop: 8,
};

const relationStyle: CSSProperties = {
  border: `1px solid ${aiWebComponentTokens.colorBorder}`,
  borderRadius: aiWebComponentTokens.radiusSmall,
  background: aiWebComponentTokens.colorSurface,
  padding: 12,
  display: 'grid',
  gap: 6,
};

const descStyle: CSSProperties = {
  margin: 0,
  color: aiWebComponentTokens.colorMuted,
  fontSize: '0.88rem',
  lineHeight: 1.6,
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
