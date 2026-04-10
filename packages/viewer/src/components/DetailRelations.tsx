import type { GraphNode } from '../store/types.js';
import { useGraphStore, selectNode } from '../store/graphStore.js';
import { getTypeLabel, humanizeKey } from '../graph/layout.js';
import { NODE_LAYER_LABELS, EDGE_LAYER_LABELS } from '../constants/index.js';

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
      <div className="detail-block">
        <h3>关联关系</h3>
        <div className="relation-list">
          <div className="empty-state"><p>这个节点当前还没有关联关系。</p></div>
        </div>
      </div>
    );
  }

  return (
    <div className="detail-block">
      <h3>关联关系</h3>
      <div className="relation-list">
        {relatedEdges.map((edge) => {
          const otherId = edge.from === node.id ? edge.to : edge.from;
          const otherNode = data.nodeById.get(otherId);
          const edgeProps = edge.properties as Record<string, unknown> | undefined;
          return (
            <button
              key={edge.id}
              className="relation-item"
              onClick={() => selectNode(otherId, true)}
            >
              <h4>{edge.edge_type} · {otherNode?.name || otherId}</h4>
              <p>
                {edge.backbone_expand ? '主干展开' : EDGE_LAYER_LABELS[edge.edge_layer ?? 'support'] ?? humanizeKey(edge.edge_layer ?? 'support')} · {NODE_LAYER_LABELS[otherNode?.node_layer ?? 'other'] ?? humanizeKey(otherNode?.node_layer ?? 'other')} · {getTypeLabel(otherNode?.node_type ?? 'other')} · {String(edgeProps?.relation || edgeProps?.relation_note || '无附加说明')}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
