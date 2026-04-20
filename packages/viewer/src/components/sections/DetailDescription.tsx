import type { OKMNode } from '@/core/graph/types';

export function DetailDescription({ node }: { node: OKMNode }) {
  if (!node.description) return null;

  return (
    <div>
      <div className="mb-1 text-xs font-medium text-text-muted">描述</div>
      <p className="text-sm text-text-secondary leading-relaxed">{node.description}</p>
    </div>
  );
}
