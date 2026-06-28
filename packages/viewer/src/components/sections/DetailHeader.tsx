import type { OKMNode } from '@/core/graph/types';
import { getNodeTypeLabel } from '@/core/graph/knowledge-data';
import { TYPE_META, NODE_LAYER_LABELS } from '@/lib/constants';

export function DetailHeader({ node }: { node: OKMNode }) {
  const typeColor = node.displayColor || TYPE_META[node.nodeType]?.color || '#9A9AB0';

  return (
    <div className="rounded-lg border border-border-subtle bg-elevated p-4">
      <div className="mb-3 flex items-start gap-3">
        <div className="mt-1.5 h-3 w-3 shrink-0 rounded-full shadow-sm" style={{ backgroundColor: typeColor }} />
        <div className="min-w-0">
          <h2 className="break-words text-xl font-semibold leading-tight text-text-primary">{node.name}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="rounded-full px-2 py-0.5 text-xs font-medium" style={{ backgroundColor: `${typeColor}20`, color: typeColor }}>
              {getNodeTypeLabel(node)}
            </span>
            <span className="rounded-full bg-surface px-2 py-0.5 text-xs text-text-muted">
              {NODE_LAYER_LABELS[node.nodeLayer] ?? node.nodeLayer}
            </span>
            {node.degree > 0 && (
              <span className="rounded-full bg-surface px-2 py-0.5 text-xs text-text-muted">连接 {node.degree}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
