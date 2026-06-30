import type { OKMNode } from '@/core/graph/types';
import { BookOpen } from '@/lib/lucide-icons';

function mentionPageText(value: unknown): string | null {
  if (value == null || value === '') return null;
  return `第 ${String(value)} 页`;
}

export function DetailMentions({ node, selectedBook }: { node: OKMNode; selectedBook: string }) {
  const mentions = (node.mentions || []).filter(
    (m) => selectedBook === 'all' || (m as Record<string, unknown>).book_id === selectedBook,
  );

  if (mentions.length === 0) return null;

  return (
    <div className="rounded-lg border border-border-subtle bg-elevated p-4">
      <div className="mb-2 flex items-center gap-1.5 text-sm font-semibold text-text-primary">
        <BookOpen className="h-3 w-3" />
        教材位置
        <span className="ml-auto text-xs font-normal text-text-muted">{mentions.length} 处</span>
      </div>
      <div className="space-y-1.5">
        {mentions.map((mention, i) => {
          const props = mention.properties as Record<string, unknown>;
          const pageText = mentionPageText(props?.page);
          return (
            <div key={i} className="flex items-center gap-2 rounded-md border border-border-subtle bg-surface px-2.5 py-2 text-sm text-text-secondary">
              <span className="font-medium text-text-primary">位置 {i + 1}</span>
              {pageText && <span className="text-text-muted">{pageText}</span>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
