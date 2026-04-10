import type { GraphNode } from '../store/types.js';

interface Props {
  node: GraphNode;
}

export function DetailAliases({ node }: Props) {
  const aliases = node.aliases && node.aliases.length ? node.aliases : ['无'];

  return (
    <div className="detail-block">
      <h3>别名</h3>
      <div className="pill-row">
        {aliases.map((alias) => (
          <span className="pill" key={alias}>{alias}</span>
        ))}
      </div>
    </div>
  );
}
