import type { GraphNode } from '../store/types.js';
import { useGraphStore, selectNode } from '../store/graphStore.js';
import { getNeighborEntries } from '../graph/visibility.js';
import { isBackboneNode, isSupportNode, getTypeLabel, humanizeKey } from '../graph/layout.js';
import { NODE_LAYER_LABELS } from '../constants/index.js';

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
      <div className="detail-block">
        <div className="section-head">
          <h3>支撑节点</h3>
          <span className="section-note">{noteText}</span>
        </div>
        <div className="support-list">
          <div className="empty-state">
            <p>{fallbackNote}</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="detail-block">
      <div className="section-head">
        <h3>支撑节点</h3>
        <span className="section-note">{noteText}</span>
      </div>
      <div className="support-list">
        {items.map(({ edge, otherNode }) => (
          <button
            key={otherNode.id}
            className={`support-item ${isBackbone ? '' : 'support-item-backbone'}`}
            onClick={() => selectNode(otherNode.id, true)}
          >
            <strong>{otherNode.name}</strong>
            <span>
              {isBackbone
                ? `${getTypeLabel(otherNode.node_type)} · ${edge.edge_type} · 主干展开`
                : `${NODE_LAYER_LABELS[otherNode.node_layer] ?? humanizeKey(otherNode.node_layer)} · ${edge.edge_type} · 主干展开`}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}
