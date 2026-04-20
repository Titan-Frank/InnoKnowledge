import type { OKMNode } from '@/core/graph/types';
import { useNodeCardLoader } from '@/hooks/useNodeCardLoader';
import { Loader2 } from '@/lib/lucide-icons';

export function DetailNodeCard({ node }: { node: OKMNode }) {
  const { card, loading } = useNodeCardLoader(node);

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-xs text-text-muted">
        <Loader2 className="h-3 w-3 animate-spin" />
        加载节点卡片…
      </div>
    );
  }

  if (!card || !card.sections || card.sections.length === 0) return null;

  return (
    <div>
      <div className="mb-1 text-xs font-medium text-text-muted">节点卡片</div>
      <div className="space-y-3">
        {card.sections.map((section, i) => (
          <div key={i}>
            {section.title && (
              <div className="mb-1 text-xs font-medium text-text-secondary">{section.title}</div>
            )}
            <div className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">
              {String(section.content ?? '')}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
