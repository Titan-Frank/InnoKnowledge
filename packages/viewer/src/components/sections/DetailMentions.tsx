import type { OKMNode } from '@/core/graph/types';
import { BookOpen } from '@/lib/lucide-icons';

export function DetailMentions({ node, selectedBook }: { node: OKMNode; selectedBook: string }) {
  const mentions = (node.mentions || []).filter(
    (m) => selectedBook === 'all' || (m as Record<string, unknown>).book_id === selectedBook,
  );

  if (mentions.length === 0) return null;

  return (
    <div>
      <div className="mb-1 flex items-center gap-1 text-xs font-medium text-text-muted">
        <BookOpen className="h-3 w-3" />
        提及 ({mentions.length})
      </div>
      <div className="space-y-1">
        {mentions.map((mention, i) => {
          const props = mention.properties as Record<string, unknown>;
          return (
            <div key={i} className="flex items-center gap-2 rounded-md bg-elevated px-2 py-1 text-xs text-text-secondary">
              <span className="text-text-muted truncate">{String(mention.book_id ?? '')}</span>
              {props?.page != null && <span className="shrink-0">p.{String(props.page)}</span>}
              {mention.anchor != null && <span className="shrink-0 text-text-muted">{String(mention.anchor)}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
