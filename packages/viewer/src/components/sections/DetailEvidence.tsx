import type { OKMNode, KnowledgeGraph } from '@/core/graph/types';
import type { ApiEvidence } from '@okm/types';
import { useAppState } from '@/hooks/useAppState';
import { BookOpen } from '@/lib/lucide-icons';

export function DetailEvidence({ node, selectedBook, knowledgeGraph }: { node: OKMNode; selectedBook: string; knowledgeGraph: KnowledgeGraph }) {
  const { openTextbookReader } = useAppState();
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
            <div className="mb-1 flex items-start justify-between gap-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2 text-[10px] text-text-muted">
                <span>{String(ev.book_id ?? ev.source_id ?? '')}</span>
                {ev.page_start != null && <span>p.{String(ev.page_start)}{ev.page_end ? `-${String(ev.page_end)}` : ''}</span>}
              </div>
              <button
                type="button"
                onClick={() => openTextbookReader({
                  bookId: String(ev.book_id ?? ev.source_id ?? ''),
                  evidenceId: ev.id,
                  pageNumber: ev.page_start == null ? undefined : Number(ev.page_start),
                })}
                className="flex shrink-0 cursor-pointer items-center gap-1 rounded border border-accent/30 bg-accent/10 px-1.5 py-1 text-[10px] font-medium text-accent transition-colors hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                <BookOpen className="h-3 w-3" />
                原文
              </button>
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
