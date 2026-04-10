import type { GraphNode } from '../store/types.js';
import { humanizeKey, renderValue } from '../graph/layout.js';

interface Props {
  node: GraphNode;
}

export function DetailProperties({ node }: Props) {
  const properties = (node.properties ?? {}) as Record<string, unknown>;
  const entries = Object.entries(properties);

  if (entries.length === 0) {
    return (
      <div className="detail-block">
        <h3>结构属性</h3>
        <div className="property-tree">
          <div className="empty-state">
            <p>这个节点目前还没有结构属性。</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="detail-block">
      <h3>结构属性</h3>
      <div className="property-tree">
        {entries.map(([key, value]) => (
          <div className="property-group" key={key}>
            <div className="property-label">{humanizeKey(key)}</div>
            <div className="property-value">{renderValue(value)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
