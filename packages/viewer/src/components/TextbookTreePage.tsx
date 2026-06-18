import { useEffect, useMemo, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import type { ApiEvidence, ApiMention } from '@okm/types';

type OutlineItem = {
  id: string;
  kind?: string;
  label?: string;
  title?: string;
  parent_id?: string;
  page_start?: number | null;
  page_end?: number | null;
  level?: number;
  order_path?: string;
  md_start?: number | null;
  md_end?: number | null;
};

type TreeItem = OutlineItem & { children: TreeItem[] };

function text(value: unknown): string {
  return value == null ? '' : String(value);
}

function titleOf(item: OutlineItem): string {
  return [item.label, item.title].filter(Boolean).join(' ') || item.id;
}

function pageLabel(item: OutlineItem): string {
  if (item.page_start == null) return '';
  if (item.page_end != null && item.page_end !== item.page_start) return `p.${item.page_start}-${item.page_end}`;
  return `p.${item.page_start}`;
}

function buildTree(items: OutlineItem[]): TreeItem[] {
  const nodes = new Map<string, TreeItem>();
  items.forEach((item) => nodes.set(item.id, { ...item, children: [] }));

  const roots: TreeItem[] = [];
  nodes.forEach((node) => {
    const parent = node.parent_id ? nodes.get(node.parent_id) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });

  const sortItems = (rows: TreeItem[]) => {
    rows.sort((a, b) => text(a.order_path).localeCompare(text(b.order_path), 'zh-CN', { numeric: true }));
    rows.forEach((row) => sortItems(row.children));
  };
  sortItems(roots);
  return roots;
}

function flattenTree(items: TreeItem[]): TreeItem[] {
  const rows: TreeItem[] = [];
  const visit = (item: TreeItem) => {
    rows.push(item);
    item.children.forEach(visit);
  };
  items.forEach(visit);
  return rows;
}

function matchesQuery(item: TreeItem, query: string): boolean {
  if (!query) return true;
  const selfMatch = [item.id, item.label, item.title, item.kind, item.order_path]
    .join(' ')
    .toLowerCase()
    .includes(query);
  return selfMatch || item.children.some((child) => matchesQuery(child, query));
}

function modalityLabel(value: unknown): string {
  const modality = text(value) || 'text';
  const labels: Record<string, string> = {
    text: '文本',
    image: '图片',
    equation: '公式',
    table: '表格',
  };
  return labels[modality] || modality;
}

export function TextbookTreePage() {
  const { knowledgeGraph, selectedBook, setSelectedBook, setSelectedNodeId, setWorkspace } = useAppState();
  const [query, setQuery] = useState('');
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);

  const books = useMemo(() => Array.from(knowledgeGraph?.booksById.values() || []), [knowledgeGraph]);
  const activeBook = useMemo(() => {
    if (!books.length) return null;
    if (selectedBook !== 'all') return books.find((book) => book.bookId === selectedBook) || books[0];
    return books[0];
  }, [books, selectedBook]);

  const outlineItems = useMemo(() => {
    const raw = activeBook?.outline as Record<string, unknown> | null | undefined;
    const items = Array.isArray(raw?.items) ? raw.items : Array.isArray(raw?.structure) ? raw.structure : [];
    return items as OutlineItem[];
  }, [activeBook]);

  const tree = useMemo(() => buildTree(outlineItems), [outlineItems]);
  const flatItems = useMemo(() => flattenTree(tree), [tree]);
  const selectedItem = useMemo(
    () => flatItems.find((item) => item.id === selectedItemId) || flatItems[0] || null,
    [flatItems, selectedItemId],
  );

  useEffect(() => {
    if (!selectedItemId && flatItems[0]) setSelectedItemId(flatItems[0].id);
    if (selectedItemId && !flatItems.some((item) => item.id === selectedItemId)) {
      setSelectedItemId(flatItems[0]?.id || null);
    }
  }, [flatItems, selectedItemId]);

  const mentionsByAnchor = useMemo(() => {
    const map = new Map<string, ApiMention[]>();
    activeBook?.mentions.forEach((mention) => {
      if (!map.has(mention.anchor_ref)) map.set(mention.anchor_ref, []);
      map.get(mention.anchor_ref)!.push(mention);
    });
    return map;
  }, [activeBook]);

  const evidenceByAnchor = useMemo(() => {
    const map = new Map<string, ApiEvidence[]>();
    activeBook?.evidence.forEach((evidence) => {
      if (!map.has(evidence.anchor_ref)) map.set(evidence.anchor_ref, []);
      map.get(evidence.anchor_ref)!.push(evidence);
    });
    return map;
  }, [activeBook]);

  const selectedMentions = selectedItem ? mentionsByAnchor.get(selectedItem.id) || [] : [];
  const selectedEvidence = selectedItem ? evidenceByAnchor.get(selectedItem.id) || [] : [];
  const selectedNodes = selectedMentions
    .map((mention) => knowledgeGraph?.nodeById.get(mention.target_id))
    .filter(Boolean)
    .filter((node, index, arr) => arr.findIndex((item) => item?.id === node?.id) === index);

  const stats = {
    items: flatItems.length,
    lessons: flatItems.filter((item) => item.kind === 'lesson').length,
    chunks: flatItems.filter((item) => item.kind === 'chunk').length,
    evidence: activeBook?.evidence.length || 0,
  };

  if (!knowledgeGraph || books.length === 0) {
    return (
      <main className="flex min-h-0 flex-1 items-center justify-center bg-void p-6">
        <div className="border border-border-subtle bg-surface p-6 text-sm text-text-secondary">
          当前数据源还没有教材目录。
        </div>
      </main>
    );
  }

  const renderTreeItem = (item: TreeItem, depth = 0) => {
    if (!matchesQuery(item, query.trim().toLowerCase())) return null;
    const mentions = mentionsByAnchor.get(item.id) || [];
    const evidence = evidenceByAnchor.get(item.id) || [];
    const active = selectedItem?.id === item.id;
    return (
      <div key={item.id}>
        <button
          type="button"
          onClick={() => setSelectedItemId(item.id)}
          className={`grid w-full grid-cols-[1fr_auto] gap-3 border-b border-border-subtle px-3 py-2 text-left text-xs transition-colors hover:bg-hover ${
            active ? 'bg-accent/10 text-text-primary' : 'text-text-secondary'
          }`}
          style={{ paddingLeft: 12 + depth * 18 }}
        >
          <span className="min-w-0">
            <span className="block truncate font-medium">{titleOf(item)}</span>
            <span className="mt-0.5 block truncate text-[10px] text-text-muted">
              {item.kind || 'item'} {pageLabel(item)} {mentions.length ? ` · ${mentions.length} 提及` : ''}
            </span>
          </span>
          <span className="text-[10px] text-text-muted">{evidence.length || ''}</span>
        </button>
        {item.children.map((child) => renderTreeItem(child, depth + 1))}
      </div>
    );
  };

  return (
    <main className="flex min-h-0 flex-1 bg-void">
      <aside className="flex w-80 flex-col border-r border-border-subtle bg-surface">
        <div className="border-b border-border-subtle p-3">
          <div className="mb-2 text-xs font-medium text-text-muted">教材</div>
          <select
            value={activeBook?.bookId || ''}
            onChange={(event) => setSelectedBook(event.target.value)}
            className="w-full rounded-md border border-border-subtle bg-elevated px-2 py-1.5 text-xs text-text-secondary outline-none focus:border-accent"
          >
            {books.map((book) => (
              <option key={book.bookId} value={book.bookId}>{book.bookId}</option>
            ))}
          </select>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索目录节点..."
            className="mt-2 w-full rounded-md border border-border-subtle bg-elevated px-2 py-1.5 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
          />
        </div>
        <div className="grid grid-cols-2 gap-px border-b border-border-subtle bg-border-subtle text-center text-xs">
          {Object.entries(stats).map(([key, value]) => (
            <div key={key} className="bg-surface p-2">
              <div className="font-semibold text-text-primary">{value}</div>
              <div className="text-[10px] text-text-muted">{key}</div>
            </div>
          ))}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          {tree.map((item) => renderTreeItem(item))}
        </div>
      </aside>

      <section className="min-w-0 flex-1 overflow-y-auto p-5 scrollbar-thin">
        {selectedItem ? (
          <div className="mx-auto max-w-5xl space-y-4">
            <header className="border border-border-subtle bg-surface p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-text-muted">
                <span>{selectedItem.kind || 'item'}</span>
                {pageLabel(selectedItem) && <span>{pageLabel(selectedItem)}</span>}
                {selectedItem.md_start != null && <span>md {selectedItem.md_start}-{selectedItem.md_end}</span>}
              </div>
              <h2 className="text-xl font-semibold text-text-primary">{titleOf(selectedItem)}</h2>
              <div className="mt-3 grid grid-cols-4 gap-2 text-center text-xs">
                <div className="border border-border-subtle bg-surface-muted p-2">
                  <div className="font-semibold text-text-primary">{selectedMentions.length}</div>
                  <div className="text-text-muted">节点提及</div>
                </div>
                <div className="border border-border-subtle bg-surface-muted p-2">
                  <div className="font-semibold text-text-primary">{selectedEvidence.length}</div>
                  <div className="text-text-muted">证据</div>
                </div>
                <div className="border border-border-subtle bg-surface-muted p-2">
                  <div className="font-semibold text-text-primary">
                    {selectedEvidence.filter((item) => item.modality === 'image').length}
                  </div>
                  <div className="text-text-muted">图片</div>
                </div>
                <div className="border border-border-subtle bg-surface-muted p-2">
                  <div className="font-semibold text-text-primary">
                    {selectedEvidence.filter((item) => item.modality === 'equation').length}
                  </div>
                  <div className="text-text-muted">公式</div>
                </div>
              </div>
            </header>

            <section className="border border-border-subtle bg-surface p-4">
              <div className="mb-3 text-xs font-medium text-text-muted">关联知识节点</div>
              {selectedNodes.length ? (
                <div className="flex flex-wrap gap-2">
                  {selectedNodes.map((node) => (
                    <button
                      key={node!.id}
                      type="button"
                      onClick={() => {
                        setSelectedNodeId(node!.id);
                        setWorkspace('graph');
                      }}
                      className="rounded-md border border-border-subtle bg-elevated px-2 py-1 text-xs text-text-secondary hover:bg-hover hover:text-text-primary"
                    >
                      {node!.name}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-text-muted">这个目录节点暂时没有关联到知识节点。</p>
              )}
            </section>

            <section className="border border-border-subtle bg-surface p-4">
              <div className="mb-3 text-xs font-medium text-text-muted">教材证据</div>
              {selectedEvidence.length ? (
                <div className="space-y-2">
                  {selectedEvidence.slice(0, 80).map((item) => (
                    <div key={item.id} className="border border-border-subtle bg-elevated p-3">
                      <div className="mb-1 flex flex-wrap gap-2 text-[10px] text-text-muted">
                        <span>{item.id}</span>
                        <span>{modalityLabel(item.modality)}</span>
                        {item.page_start != null && <span>p.{text(item.page_start)}</span>}
                        {text(item.locator) && <span>{text(item.locator)}</span>}
                      </div>
                      <p className="whitespace-pre-wrap text-xs leading-relaxed text-text-secondary">
                        {text(item.excerpt) || '无文本摘录'}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-text-muted">这个目录节点暂时没有证据。</p>
              )}
            </section>
          </div>
        ) : (
          <div className="text-sm text-text-muted">请选择一个目录节点。</div>
        )}
      </section>
    </main>
  );
}
