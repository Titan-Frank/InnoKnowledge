import type { OKMNode } from '@/core/graph/types';
import { humanizeKey } from '@/core/graph/knowledge-data';

const SKIP_KEYS = new Set([
  'id',
  'source_id',
  'source_ids',
  'book_id',
  'anchor',
  'anchor_ref',
  'chunk_id',
  'chunk_ids',
  'batch_anchor',
  'learning_modes',
  'bridge_tags',
  'node_layer',
  'node_type',
  'node_kind',
  'node_subkind',
  'backbone',
  'support',
]);

export function DetailProperties({ node }: { node: OKMNode }) {
  const props = node.properties as Record<string, unknown>;
  if (!props) return null;

  const entries = Object.entries(props).filter(([key]) => !SKIP_KEYS.has(key));
  if (entries.length === 0) return null;

  return (
    <div className="rounded-lg border border-border-subtle bg-elevated p-4">
      <div className="mb-2 text-sm font-semibold text-text-primary">属性</div>
      <div className="space-y-1.5">
        {entries.map(([key, value]) => (
          <div key={key} className="flex gap-2 rounded-md bg-surface px-2.5 py-2 text-sm">
            <span className="shrink-0 text-text-muted">{humanizeKey(key)}</span>
            <span className="text-text-secondary">{String(value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
