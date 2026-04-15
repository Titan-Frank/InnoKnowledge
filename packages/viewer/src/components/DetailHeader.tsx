import type { CSSProperties } from 'react';
import type { GraphNode } from '../store/types.js';
import { useGraphStore } from '../store/graphStore.js';
import { getTypeLabel, humanizeKey } from '../graph/layout.js';
import { NODE_LAYER_LABELS } from '../constants/index.js';
import { getVisibleMentions, getVisibleEvidence } from '../graph/visibility.js';
import { ToneBadge } from './aiwc/index.js';
import { resolveNodeLayerVisual } from '../graph/graphPresentation.js';
import { createDetailSectionStyle } from './workspaceStyles.js';
import { useTokens } from '../hooks/useTokens.js';
import type { TokenSet } from './aiwc/styles/tokens.js';

interface Props {
  node: GraphNode;
}

export function DetailHeader({ node }: Props) {
  const t = useTokens();
  const themeMode = useGraphStore((s) => s.themeMode);
  const state = useGraphStore.getState();
  const selectedBook = useGraphStore((s) => s.selectedBook);
  const visibleMentions = getVisibleMentions(node, state);
  const visibleEvidence = getVisibleEvidence(node, state);
  const sourceScopeLabel = selectedBook === 'all' ? '当前来源' : '当前教材';
  const layerVisual = resolveNodeLayerVisual(node.node_layer, themeMode);

  const badges: string[] = [
    node.id,
    `${node.degree} 条关联`,
    `${sourceScopeLabel} ${visibleMentions.length} 条出现`,
    `${sourceScopeLabel} ${visibleEvidence.length} 条证据`,
    ...(node.profiles || []).slice(0, 2).map((p) => `${p.subject} ${p.grade_band}`),
    ...(node.framework_refs || []).slice(0, 2).map((ref) => {
      const topic = state.data?.frameworkTopics.get(ref);
      return topic ? topic.title : ref;
    }),
  ];

  return (
    <div
      style={{
        ...createDetailSectionStyle(t),
        borderColor: layerVisual.stroke,
        background: layerVisual.fill,
        gap: 12,
      }}
    >
      <div>
        <p style={{ ...eyebrowStyle(t), color: layerVisual.stroke }}>{getTypeLabel(node.node_type)}</p>
        <h2 style={titleStyle}>{node.name}</h2>
        <p style={summaryStyle(t)}>
          {node.node_layer === 'backbone'
            ? '主干层节点，适合作为核心概念和跨学科骨架来理解。'
            : '支撑层节点，用于补充方法、实例、表征或局部结构。'}
        </p>
      </div>
      <div style={badgesStyle}>
        <ToneBadge tone={layerVisual.badgeTone}>{layerVisual.label}</ToneBadge>
        <ToneBadge tone="secondary">
          {NODE_LAYER_LABELS[node.node_layer] ?? humanizeKey(node.node_layer)}
        </ToneBadge>
        {badges.map((text, i) => (
          <ToneBadge key={i} tone="neutral">{text}</ToneBadge>
        ))}
      </div>
    </div>
  );
}

function eyebrowStyle(t: TokenSet): CSSProperties {
  return {
    margin: '0 0 4px',
    color: t.colorAccent,
    fontSize: '0.78rem',
    letterSpacing: '0.16em',
    textTransform: 'uppercase',
  };
}

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: '1.7rem',
  lineHeight: 1.1,
  fontWeight: 600,
};

function summaryStyle(t: TokenSet): CSSProperties {
  return {
    margin: '8px 0 0',
    color: t.colorTextSubtle,
    fontSize: '0.92rem',
    lineHeight: 1.65,
    maxWidth: 540,
  };
}

const badgesStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
};
