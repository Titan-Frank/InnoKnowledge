import type { CSSProperties } from 'react';
import type { GraphNode } from '../store/types.js';
import { useGraphStore } from '../store/graphStore.js';
import { getTypeLabel, humanizeKey } from '../graph/layout.js';
import { NODE_LAYER_LABELS } from '../constants/index.js';
import { getVisibleMentions, getVisibleEvidence } from '../graph/visibility.js';
import { ToneBadge, aiWebComponentTokens } from './aiwc/index.js';

interface Props {
  node: GraphNode;
}

export function DetailHeader({ node }: Props) {
  const state = useGraphStore.getState();
  const selectedBook = useGraphStore((s) => s.selectedBook);
  const visibleMentions = getVisibleMentions(node, state);
  const visibleEvidence = getVisibleEvidence(node, state);
  const sourceScopeLabel = selectedBook === 'all' ? '当前来源' : '当前教材';

  const badges: string[] = [
    NODE_LAYER_LABELS[node.node_layer] ?? humanizeKey(node.node_layer),
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
    <div style={headerStyle}>
      <div>
        <p style={eyebrowStyle}>{getTypeLabel(node.node_type)}</p>
        <h2 style={titleStyle}>{node.name}</h2>
      </div>
      <div style={badgesStyle}>
        {badges.map((text, i) => (
          <ToneBadge key={i} tone="accent">{text}</ToneBadge>
        ))}
      </div>
    </div>
  );
}

const headerStyle: CSSProperties = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'flex-start',
  gap: 12,
};

const eyebrowStyle: CSSProperties = {
  margin: '0 0 4px',
  color: aiWebComponentTokens.colorAccent,
  fontSize: '0.78rem',
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
};

const titleStyle: CSSProperties = {
  margin: 0,
  fontSize: '1.7rem',
  lineHeight: 1.1,
  fontWeight: 600,
};

const badgesStyle: CSSProperties = {
  display: 'flex',
  flexWrap: 'wrap',
  gap: 8,
};
