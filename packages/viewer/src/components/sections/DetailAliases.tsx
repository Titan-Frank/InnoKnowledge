import type { OKMNode } from '@/core/graph/types';

export function DetailAliases({ node }: { node: OKMNode }) {
  if (!node.aliases || node.aliases.length === 0) return null;

  return (
    <div>
      <div className="mb-1 text-xs font-medium text-text-muted">别名</div>
      <div className="flex flex-wrap gap-1">
        {node.aliases.map((alias) => (
          <span key={alias} className="rounded-md bg-elevated px-2 py-0.5 text-xs text-text-secondary">
            {alias}
          </span>
        ))}
      </div>
    </div>
  );
}
