import type { GraphNode } from '../store/types.js';

interface Props {
  node: GraphNode;
}

export function DetailDescription({ node }: Props) {
  return (
    <div className="detail-block">
      <h3>摘要</h3>
      <p>{node.description || '暂无摘要。'}</p>
    </div>
  );
}
