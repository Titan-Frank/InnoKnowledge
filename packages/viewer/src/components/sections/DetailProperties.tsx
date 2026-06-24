import type { OKMNode } from '@/core/graph/types';
import { humanizeKey } from '@/core/graph/knowledge-data';

const SKIP_KEYS = new Set(['learning_modes', 'bridge_tags', 'node_layer', 'node_type', 'node_kind', 'node_subkind', 'backbone', 'support']);

export function DetailProperties({ node }: { node: OKMNode }) {
  const props = node.properties as Record<string, unknown>;
  if (!props) return null;

  const entries = Object.entries(props).filter(([key]) => !SKIP_KEYS.has(key));
  if (entries.length === 0) return null;

  return (
    <div>
      <div className="mb-1 text-xs font-medium text-text-muted">属性</div>
      <div className="space-y-1">
        {entries.map(([key, value]) => (
          <div key={key} className="flex gap-2 text-xs">
            <span className="text-text-muted shrink-0">{humanizeKey(key)}</span>
            <span className="text-text-secondary">{String(value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
