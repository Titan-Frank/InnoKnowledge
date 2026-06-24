import type { OKMNode, KnowledgeGraph } from '@/core/graph/types';
import type { ApiEvidence } from '@okm/types';

export function DetailEvidence({ node, selectedBook, knowledgeGraph }: { node: OKMNode; selectedBook: string; knowledgeGraph: KnowledgeGraph }) {
  const mentions = (node.mentions || []).filter(
    (m) => selectedBook === 'all' || (m as Record<string, unknown>).book_id === selectedBook,
  );

  const evidenceIds = [...new Set(mentions.flatMap((m) => m.source_refs || []))];
  const evidences = evidenceIds
    .map((id) => knowledgeGraph.evidenceById.get(id))
    .filter((e): e is ApiEvidence => e != null)
    .sort((a, b) => {
      const aPage = a.page_start as number ?? Number.MAX_SAFE_INTEGER;
      const bPage = b.page_start as number ?? Number.MAX_SAFE_INTEGER;
      return aPage - bPage;
    });

  if (evidences.length === 0) return null;

  return (
    <div>
      <div className="mb-1 text-xs font-medium text-text-muted">证据 ({evidences.length})</div>
      <div className="space-y-2">
        {evidences.map((ev) => (
          <div key={ev.id} className="rounded-md border border-border-subtle bg-elevated p-2.5">
            <div className="flex items-center gap-2 mb-1 text-[10px] text-text-muted">
              <span>{String(ev.book_id ?? ev.source_id ?? '')}</span>
              {ev.page_start != null && <span>p.{String(ev.page_start)}{ev.page_end ? `-${String(ev.page_end)}` : ''}</span>}
            </div>
            <p className="text-xs text-text-secondary leading-relaxed line-clamp-4">
              {String(ev.snippet || ev.excerpt || '')}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
