import type { OKMNode } from '@/core/graph/types';
import { getTypeLabel } from '@/core/graph/knowledge-data';
import { TYPE_META, NODE_LAYER_LABELS } from '@/lib/constants';

export function DetailHeader({ node }: { node: OKMNode }) {
  const typeColor = TYPE_META[node.nodeType]?.color ?? '#9A9AB0';

  return (
    <div>
      <div className="flex items-center gap-2 mb-1">
        <div className="h-3 w-3 rounded-full" style={{ backgroundColor: typeColor }} />
        <h2 className="text-lg font-semibold text-text-primary">{node.name}</h2>
      </div>
      <div className="flex items-center gap-2">
        <span className="rounded-md px-1.5 py-0.5 text-xs" style={{ backgroundColor: `${typeColor}20`, color: typeColor }}>
          {getTypeLabel(node.nodeType)}
        </span>
        <span className="rounded-md px-1.5 py-0.5 text-xs bg-elevated text-text-muted">
          {NODE_LAYER_LABELS[node.nodeLayer] ?? node.nodeLayer}
        </span>
        {node.degree > 0 && (
          <span className="text-xs text-text-muted">度 {node.degree}</span>
        )}
      </div>
    </div>
  );
}
