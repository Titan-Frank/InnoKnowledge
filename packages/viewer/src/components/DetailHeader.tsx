import type { GraphNode } from '../store/types.js';
import { useGraphStore } from '../store/graphStore.js';
import { getTypeLabel, humanizeKey } from '../graph/layout.js';
import { NODE_LAYER_LABELS } from '../constants/index.js';
import { getVisibleMentions, getVisibleEvidence } from '../graph/visibility.js';

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
    <div className="detail-header">
      <div>
        <p className="eyebrow">{getTypeLabel(node.node_type)}</p>
        <h2>{node.name}</h2>
      </div>
      <div className="meta-badges">
        {badges.map((text, i) => (
          <span key={i} className="badge active">{text}</span>
        ))}
      </div>
    </div>
  );
}
