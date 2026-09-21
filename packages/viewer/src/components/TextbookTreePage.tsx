import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppState } from '@/hooks/useAppState';
import { loadEnrichBook, loadEnrichBooks, loadTextbookReaderBooks, loadUnit, type EnrichBookSummary, type EnrichIndexResponse, type EnrichNode } from '@/services/backend-client';
import { MarkdownView } from '@/components/MarkdownView';
import { BookOpen, ChevronDown, ChevronRight, Layers, Network, Search } from '@/lib/lucide-icons';
import type { ApiEvidence, ApiMention, ApiUnit, TextbookReaderBookSummary } from '@okm/types';
import type { OKMBook, OKMNode } from '@/core/graph/types';

type SourceMode = 'dataset' | 'enrich';
type DatasetSection = 'textbooks' | 'outlines';
type TreeMode = 'graph' | 'list';

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

type OutlineTreeItem = OutlineItem & { children: OutlineTreeItem[] };

type WorkbenchNode = {
  id: string;
  parentId?: string;
  title: string;
  subtitle: string;
  badge: string;
  depth: number;
  searchText: string;
  children: WorkbenchNode[];
  source: SourceMode;
  outline?: OutlineItem;
  enrich?: EnrichNode;
};

type RelatedUnitState = {
  unit: ApiUnit | null;
  loading: boolean;
  error: string;
};

const TEXTBOOK_DETAIL_WIDTH_KEY = 'okm-textbook-detail-width';
const DEFAULT_TEXTBOOK_DETAIL_WIDTH = 420;
const MIN_TEXTBOOK_DETAIL_WIDTH = 340;
const MAX_TEXTBOOK_DETAIL_WIDTH = 760;

function clampTextbookDetailWidth(value: number): number {
  const viewportLimit = typeof window === 'undefined'
    ? MAX_TEXTBOOK_DETAIL_WIDTH
    : Math.floor(window.innerWidth - 320 - 420 - 32);
  return Math.min(
    Math.max(value, MIN_TEXTBOOK_DETAIL_WIDTH),
    Math.max(MIN_TEXTBOOK_DETAIL_WIDTH, Math.min(MAX_TEXTBOOK_DETAIL_WIDTH, viewportLimit)),
  );
}

function readTextbookDetailWidth(): number {
  if (typeof window === 'undefined') return DEFAULT_TEXTBOOK_DETAIL_WIDTH;
  const stored = Number(window.localStorage.getItem(TEXTBOOK_DETAIL_WIDTH_KEY));
  return clampTextbookDetailWidth(Number.isFinite(stored) && stored > 0 ? stored : DEFAULT_TEXTBOOK_DETAIL_WIDTH);
}

function text(value: unknown): string {
  return value == null ? '' : String(value);
}

function normalize(value: unknown): string {
  return text(value).toLowerCase().replace(/\s+/g, '');
}

function titleOf(item: OutlineItem): string {
  return [item.label, item.title].filter(Boolean).join(' ') || item.id;
}

function pageLabel(item: OutlineItem): string {
  if (item.page_start == null) return '';
  if (item.page_end != null && item.page_end !== item.page_start) return `p.${item.page_start}-${item.page_end}`;
  return `p.${item.page_start}`;
}

function buildOutlineTree(items: OutlineItem[]): OutlineTreeItem[] {
  const nodes = new Map<string, OutlineTreeItem>();
  items.forEach((item) => nodes.set(item.id, { ...item, children: [] }));

  const roots: OutlineTreeItem[] = [];
  nodes.forEach((node) => {
    const parent = node.parent_id ? nodes.get(node.parent_id) : null;
    if (parent) parent.children.push(node);
    else roots.push(node);
  });

  const sortItems = (rows: OutlineTreeItem[]) => {
    rows.sort((a, b) => text(a.order_path).localeCompare(text(b.order_path), 'zh-CN', { numeric: true }));
    rows.forEach((row) => sortItems(row.children));
  };
  sortItems(roots);
  return roots;
}

function flattenTree<T extends { children: T[] }>(items: T[]): T[] {
  const rows: T[] = [];
  const visit = (item: T) => {
    rows.push(item);
    item.children.forEach(visit);
  };
  items.forEach(visit);
  return rows;
}

function filterTree(items: WorkbenchNode[], query: string): WorkbenchNode[] {
  if (!query) return items;
  const visit = (item: WorkbenchNode): WorkbenchNode | null => {
    const children = item.children.map(visit).filter(Boolean) as WorkbenchNode[];
    if (item.searchText.includes(query) || children.length) return { ...item, children };
    return null;
  };
  return items.map(visit).filter(Boolean) as WorkbenchNode[];
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

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function normalizeAssetRef(value: string): string {
  const clean = value.trim().split(/[?#]/, 1)[0] ?? '';
  try {
    return decodeURIComponent(clean).replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  } catch {
    return clean.replace(/\\/g, '/').replace(/^\.\//, '').toLowerCase();
  }
}

function basename(value: string): string {
  const normalized = normalizeAssetRef(value);
  return normalized.split('/').filter(Boolean).pop() ?? normalized;
}

function dirname(value: string): string {
  const normalized = text(value).replace(/\\/g, '/');
  const index = normalized.lastIndexOf('/');
  return index >= 0 ? normalized.slice(0, index) : '';
}

function imageSrcFromMarkdown(value: string): string {
  const match = value.match(/!\[[^\]]*\]\(([^)\n]+)\)/);
  return match ? match[1].trim() : '';
}

function isRemoteAsset(value: string): boolean {
  return /^(https?:|data:|blob:)/i.test(value);
}

function imageSrcFromEvidence(row: ApiEvidence): string {
  const properties = asRecord(row.properties);
  const candidates = [
    properties.path,
    properties.image_path,
    properties.src,
    row.locator,
    row.excerpt,
  ];
  for (const candidate of candidates) {
    const value = text(candidate).trim();
    if (!value) continue;
    const src = imageSrcFromMarkdown(value) || value;
    if (/\.(png|jpe?g|webp|gif|bmp|svg)(\?.*)?$/i.test(src) || src.includes('/images/')) return src;
  }
  return '';
}

function sourcePathFromEvidence(row: ApiEvidence): string {
  const properties = asRecord(row.properties);
  return text(row.source_path || properties.source_path || properties.md_path || properties.file_path).trim();
}

function resolveEvidenceAssetPath(src: string, row: ApiEvidence): string {
  if (!src || isRemoteAsset(src)) return src;
  const cleanSrc = src.replace(/\\/g, '/').replace(/^\.\//, '');
  if (cleanSrc.startsWith('data/') || cleanSrc.startsWith('ocr/') || cleanSrc.startsWith('/')) return cleanSrc;
  const sourcePath = sourcePathFromEvidence(row);
  const baseDir = dirname(sourcePath);
  return baseDir ? `${baseDir}/${cleanSrc}` : cleanSrc;
}

function assetUrl(sourceKey: string | null, path: string): string | undefined {
  if (!path) return undefined;
  if (isRemoteAsset(path)) return path;
  const normalized = path.replace(/\\/g, '/').replace(/^\.\//, '');
  if (!sourceKey || (!normalized.startsWith('data/') && !normalized.startsWith('ocr/') && !normalized.startsWith('/'))) {
    return undefined;
  }
  return `/api/source/${encodeURIComponent(sourceKey)}/assets/${encodeURIComponent(normalized)}`;
}

function evidenceImageContent(row: ApiEvidence): string {
  const excerpt = text(row.excerpt).trim();
  if (excerpt) return excerpt;
  const src = imageSrcFromEvidence(row);
  return src ? `![](${src})` : '无文本摘录';
}

function sameImageRef(a: string, b: string): boolean {
  if (!a || !b) return false;
  const normalizedA = normalizeAssetRef(a);
  const normalizedB = normalizeAssetRef(b);
  const nameA = basename(a).replace(/…$/, '');
  const nameB = basename(b).replace(/…$/, '');
  return (
    normalizedA === normalizedB ||
    normalizedA.endsWith(`/${normalizedB}`) ||
    normalizedB.endsWith(`/${normalizedA}`) ||
    nameA === nameB ||
    (nameA.length >= 8 && nameB.startsWith(nameA)) ||
    (nameB.length >= 8 && nameA.startsWith(nameB))
  );
}

function relatedUnitCacheKey(sourceKey: string, nodeId: string): string {
  return `${sourceKey}:${nodeId}`;
}

function unitBodyContent(unit: ApiUnit | null | undefined): string {
  return unit?.body?.content?.trim() || '';
}

function resolveUnitMarkdownImage(unit: ApiUnit | null | undefined, src: string): string | undefined {
  if (/^(https?:|data:|blob:)/i.test(src) || src.startsWith('/api/source/')) return src;
  const normalized = normalizeAssetRef(src);
  const fileName = basename(src);
  const filePrefix = fileName.replace(/…$/, '');
  const media = Array.isArray(unit?.media) ? unit.media : [];
  const match = media.find((item) => {
    const itemPath = normalizeAssetRef(text(item.path));
    const itemName = basename(itemPath);
    return (
      itemPath === normalized ||
      itemPath.endsWith(`/${normalized}`) ||
      itemName === fileName ||
      (filePrefix.length >= 8 && itemName.startsWith(filePrefix))
    );
  });
  return match?.url;
}

function nodeKindLabel(node: OKMNode): string {
  return node.displayTypeLabel || node.nodeSubkind || node.nodeKind || node.nodeType || '知识节点';
}

function describeBook(book: EnrichBookSummary): string {
  return [book.subject, book.stage, book.grade, book.course, book.publisher, book.volume]
    .filter(Boolean)
    .join(' · ');
}

function datasetBookTitle(book: OKMBook): string {
  return book.bookId;
}

function makeDatasetNode(
  item: OutlineTreeItem,
  depth: number,
  mentionsByAnchor: Map<string, ApiMention[]>,
  evidenceByAnchor: Map<string, ApiEvidence[]>,
  parentId?: string,
): WorkbenchNode {
  const mentions = mentionsByAnchor.get(item.id) || [];
  const evidence = evidenceByAnchor.get(item.id) || [];
  const children = item.children.map((child) => makeDatasetNode(child, depth + 1, mentionsByAnchor, evidenceByAnchor, item.id));
  return {
    id: item.id,
    parentId,
    title: titleOf(item),
    subtitle: [item.kind || 'item', pageLabel(item), mentions.length ? `${mentions.length} 提及` : '']
      .filter(Boolean)
      .join(' · '),
    badge: evidence.length ? String(evidence.length) : children.length ? String(children.length) : '叶',
    depth,
    source: 'dataset',
    outline: item,
    children,
    searchText: normalize([
      item.id,
      item.label,
      item.title,
      item.kind,
      item.order_path,
      pageLabel(item),
      ...mentions.map((mention) => mention.target_id),
      ...evidence.map((row) => row.excerpt),
    ].join(' ')),
  };
}

function makeEnrichNode(item: EnrichNode, parentId?: string): WorkbenchNode {
  const enrichment = item.enrichment || {};
  const children = item.child_nodes.map((child) => makeEnrichNode(child, item.id));
  return {
    id: item.id,
    parentId,
    title: item.title || '(未命名节点)',
    subtitle: `第 ${item.depth + 1} 层${children.length ? ` · ${children.length} 个子节点` : ' · 叶节点'}`,
    badge: children.length ? String(children.length) : '叶',
    depth: item.depth,
    source: 'enrich',
    enrich: item,
    children,
    searchText: normalize([
      item.id,
      item.title,
      item.order_path,
      item.title_path?.join(' '),
      enrichment.definition,
      enrichment.content,
      enrichment.academic_requirements,
      enrichment.academic_quality,
    ].join(' ')),
  };
}

function countNodes(items: WorkbenchNode[]): number {
  return flattenTree(items).length;
}

function StatCell({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="border-r border-border-subtle px-3 py-2 last:border-r-0">
      <div className="text-sm font-semibold text-text-primary">{value}</div>
      <div className="mt-0.5 text-[10px] text-text-muted">{label}</div>
    </div>
  );
}

export function TextbookTreePage() {
  const {
    knowledgeGraph,
    selectedBook,
    selectedSourceKey,
    setSelectedBook,
    setSelectedNodeId,
    setWorkspace,
    openTextbookReader,
  } = useAppState();

  const [sourceMode, setSourceMode] = useState<SourceMode>('dataset');
  const [datasetSection, setDatasetSection] = useState<DatasetSection>('textbooks');
  const [treeMode, setTreeMode] = useState<TreeMode>('graph');
  const [bookQuery, setBookQuery] = useState('');
  const [treeQuery, setTreeQuery] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('');
  const [selectedTreeId, setSelectedTreeId] = useState<string | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [enrichIndex, setEnrichIndex] = useState<EnrichIndexResponse | null>(null);
  const [enrichIndexError, setEnrichIndexError] = useState('');
  const [selectedEnrichPath, setSelectedEnrichPath] = useState('');
  const [enrichTree, setEnrichTree] = useState<WorkbenchNode[]>([]);
  const [activeEnrichBook, setActiveEnrichBook] = useState<EnrichBookSummary | null>(null);
  const [enrichLoading, setEnrichLoading] = useState(false);
  const [enrichError, setEnrichError] = useState('');
  const [relatedUnitCache, setRelatedUnitCache] = useState<Map<string, RelatedUnitState>>(new Map());
  const [readerBooks, setReaderBooks] = useState<TextbookReaderBookSummary[]>([]);
  const [expandedRelatedNodeIds, setExpandedRelatedNodeIds] = useState<Set<string>>(new Set());
  const [detailPanelWidth, setDetailPanelWidth] = useState(readTextbookDetailWidth);
  const [isDetailResizing, setIsDetailResizing] = useState(false);
  const [isWideLayout, setIsWideLayout] = useState(() => (
    typeof window !== 'undefined' && window.matchMedia('(min-width: 1280px)').matches
  ));

  const datasetBooks = useMemo(() => (
    Array.from(knowledgeGraph?.booksById.values() || [])
      .sort((a, b) => a.bookId.localeCompare(b.bookId, 'zh-CN', { numeric: true }))
  ), [knowledgeGraph]);

  const activeDatasetBook = useMemo(() => {
    if (!datasetBooks.length) return null;
    if (selectedBook !== 'all') return datasetBooks.find((book) => book.bookId === selectedBook) || datasetBooks[0];
    return datasetBooks[0];
  }, [datasetBooks, selectedBook]);

  const mentionsByAnchor = useMemo(() => {
    const map = new Map<string, ApiMention[]>();
    activeDatasetBook?.mentions.forEach((mention) => {
      if (!map.has(mention.anchor_ref)) map.set(mention.anchor_ref, []);
      map.get(mention.anchor_ref)!.push(mention);
    });
    return map;
  }, [activeDatasetBook]);

  const evidenceByAnchor = useMemo(() => {
    const map = new Map<string, ApiEvidence[]>();
    activeDatasetBook?.evidence.forEach((evidence) => {
      if (!map.has(evidence.anchor_ref)) map.set(evidence.anchor_ref, []);
      map.get(evidence.anchor_ref)!.push(evidence);
    });
    return map;
  }, [activeDatasetBook]);

  const datasetTree = useMemo(() => {
    const raw = activeDatasetBook?.outline as Record<string, unknown> | null | undefined;
    const items = Array.isArray(raw?.items) ? raw.items : Array.isArray(raw?.structure) ? raw.structure : [];
    return buildOutlineTree(items as OutlineItem[])
      .map((item) => makeDatasetNode(item, 0, mentionsByAnchor, evidenceByAnchor));
  }, [activeDatasetBook, mentionsByAnchor, evidenceByAnchor]);

  const enrichSubjects = useMemo(() => (
    [...new Set((enrichIndex?.books || []).map((book) => book.subject).filter(Boolean) as string[])]
      .sort((a, b) => a.localeCompare(b, 'zh-CN'))
  ), [enrichIndex]);

  const filteredEnrichBooks = useMemo(() => {
    const query = normalize(bookQuery);
    const parts = bookQuery.trim().split(/\s+/).map(normalize).filter(Boolean);
    return (enrichIndex?.books || []).filter((book) => {
      const subjectOk = !subjectFilter || book.subject === subjectFilter;
      const haystack = normalize([book.title, book.subject, book.stage, book.grade, book.course, book.publisher, book.volume, book.filename].join(' '));
      const queryOk = !query || haystack.includes(query) || parts.every((part) => haystack.includes(part));
      return subjectOk && queryOk;
    });
  }, [bookQuery, enrichIndex, subjectFilter]);

  const filteredDatasetBooks = useMemo(() => {
    const query = normalize(bookQuery);
    return datasetBooks.filter((book) => !query || normalize(book.bookId).includes(query));
  }, [bookQuery, datasetBooks]);

  const filteredReaderBooks = useMemo(() => {
    const query = normalize(bookQuery);
    return readerBooks.filter((book) => !query || normalize(`${book.title} ${book.book_id}`).includes(query));
  }, [bookQuery, readerBooks]);

  const activeTree = sourceMode === 'enrich' ? enrichTree : datasetTree;
  const visibleTree = useMemo(() => filterTree(activeTree, normalize(treeQuery)), [activeTree, treeQuery]);
  const visibleFlat = useMemo(() => flattenTree(visibleTree), [visibleTree]);
  const activeFlat = useMemo(() => flattenTree(activeTree), [activeTree]);
  const selectedNode = useMemo(
    () => activeFlat.find((item) => item.id === selectedTreeId) || activeFlat[0] || null,
    [activeFlat, selectedTreeId],
  );
  const readerBookIds = useMemo(() => new Set(readerBooks.map((book) => book.book_id)), [readerBooks]);

  useEffect(() => {
    if (!selectedSourceKey) return;
    let cancelled = false;
    loadEnrichBooks(selectedSourceKey)
      .then((payload) => {
        if (cancelled) return;
        setEnrichIndex(payload);
        setEnrichIndexError('');
      })
      .catch((error) => {
        if (cancelled) return;
        setEnrichIndexError((error as Error).message || '参考教材目录加载失败');
      });
    return () => { cancelled = true; };
  }, [selectedSourceKey]);

  useEffect(() => {
    if (!selectedSourceKey) {
      setReaderBooks([]);
      return;
    }
    let cancelled = false;
    loadTextbookReaderBooks(selectedSourceKey)
      .then((payload) => {
        if (!cancelled) setReaderBooks(payload.books);
      })
      .catch(() => {
        if (!cancelled) setReaderBooks([]);
      });
    return () => { cancelled = true; };
  }, [selectedSourceKey]);

  useEffect(() => {
    window.localStorage.setItem(TEXTBOOK_DETAIL_WIDTH_KEY, String(detailPanelWidth));
  }, [detailPanelWidth]);

  useEffect(() => {
    const handleResize = () => setDetailPanelWidth((current) => clampTextbookDetailWidth(current));
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const query = window.matchMedia('(min-width: 1280px)');
    const handleChange = () => setIsWideLayout(query.matches);
    handleChange();
    query.addEventListener('change', handleChange);
    return () => query.removeEventListener('change', handleChange);
  }, []);

  useEffect(() => {
    if (sourceMode !== 'enrich') return;
    if (selectedEnrichPath || !filteredEnrichBooks[0]) return;
    setSelectedEnrichPath(filteredEnrichBooks[0].path);
  }, [filteredEnrichBooks, selectedEnrichPath, sourceMode]);

  useEffect(() => {
    if (sourceMode !== 'enrich' || !selectedEnrichPath || !selectedSourceKey) return;
    let cancelled = false;
    setEnrichLoading(true);
    setEnrichError('');
    loadEnrichBook(selectedSourceKey, selectedEnrichPath)
      .then((payload) => {
        if (cancelled) return;
        setActiveEnrichBook(payload.book);
        setEnrichTree(payload.tree.map((node) => makeEnrichNode(node)));
      })
      .catch((error) => {
        if (cancelled) return;
        setEnrichError((error as Error).message || '教材树加载失败');
        setActiveEnrichBook(null);
        setEnrichTree([]);
      })
      .finally(() => {
        if (!cancelled) setEnrichLoading(false);
      });
    return () => { cancelled = true; };
  }, [selectedEnrichPath, selectedSourceKey, sourceMode]);

  useEffect(() => {
    if (!activeFlat.length) {
      setSelectedTreeId(null);
      setExpandedIds(new Set());
      return;
    }
    if (!selectedTreeId || !activeFlat.some((item) => item.id === selectedTreeId)) {
      setSelectedTreeId(activeFlat[0].id);
    }
    setExpandedIds((current) => {
      if (current.size) return current;
      return new Set(activeTree.map((item) => item.id));
    });
  }, [activeFlat, activeTree, selectedTreeId]);

  const selectedMentions = selectedNode?.outline ? mentionsByAnchor.get(selectedNode.outline.id) || [] : [];
  const selectedEvidence = selectedNode?.outline ? evidenceByAnchor.get(selectedNode.outline.id) || [] : [];
  const evidenceImageCandidates = useMemo(() => (
    (activeDatasetBook?.evidence || [])
      .map((row) => {
        const src = imageSrcFromEvidence(row);
        const path = resolveEvidenceAssetPath(src, row);
        const url = assetUrl(selectedSourceKey, path);
        return src && url ? { src, path, url } : null;
      })
      .filter(Boolean) as Array<{ src: string; path: string; url: string }>
  ), [activeDatasetBook, selectedSourceKey]);
  const resolveEvidenceImage = (src: string, row: ApiEvidence): string | undefined => {
    const directPath = resolveEvidenceAssetPath(src, row);
    const directUrl = assetUrl(selectedSourceKey, directPath);
    if (directUrl) return directUrl;

    const match = evidenceImageCandidates.find((candidate) => (
      sameImageRef(candidate.src, src) || sameImageRef(candidate.path, src)
    ));
    return match?.url;
  };
  const selectedKnowledgeNodes = useMemo(() => (
    selectedMentions
      .map((mention) => knowledgeGraph?.nodeById.get(mention.target_id))
      .filter(Boolean)
      .filter((node, index, arr) => arr.findIndex((item) => item?.id === node?.id) === index) as OKMNode[]
  ), [knowledgeGraph, selectedMentions]);
  const expandedKnowledgeNodeKey = selectedKnowledgeNodes
    .filter((node) => expandedRelatedNodeIds.has(node.id))
    .map((node) => node.id)
    .join('\u0000');

  useEffect(() => {
    setExpandedRelatedNodeIds(new Set());
  }, [selectedTreeId, selectedSourceKey, sourceMode]);

  useEffect(() => {
    if (sourceMode !== 'dataset' || !selectedSourceKey || !expandedKnowledgeNodeKey) return;
    const nodeIds = expandedKnowledgeNodeKey.split('\u0000').filter(Boolean);
    const missingNodeIds = nodeIds.filter((nodeId) => (
      !relatedUnitCache.has(relatedUnitCacheKey(selectedSourceKey, nodeId))
    ));
    if (!missingNodeIds.length) return;

    setRelatedUnitCache((current) => {
      const next = new Map(current);
      missingNodeIds.forEach((nodeId) => {
        const key = relatedUnitCacheKey(selectedSourceKey, nodeId);
        if (!next.has(key)) next.set(key, { unit: null, loading: true, error: '' });
      });
      return next;
    });

    Promise.all(missingNodeIds.map(async (nodeId) => {
      try {
        return { nodeId, unit: await loadUnit(selectedSourceKey, nodeId), error: '' };
      } catch (error) {
        return {
          nodeId,
          unit: null,
          error: (error as Error)?.message || '知识正文加载失败',
        };
      }
    })).then((rows) => {
      setRelatedUnitCache((current) => {
        const next = new Map(current);
        rows.forEach((row) => {
          next.set(relatedUnitCacheKey(selectedSourceKey, row.nodeId), {
            unit: row.unit,
            loading: false,
            error: row.error,
          });
        });
        return next;
      });
    });
  }, [expandedKnowledgeNodeKey, relatedUnitCache, selectedSourceKey, sourceMode]);

  const sourceStats = sourceMode === 'enrich'
    ? [
      { label: '教材', value: enrichIndex?.book_count || 0 },
      { label: '节点', value: enrichIndex?.node_count || 0 },
      { label: '学科', value: enrichIndex?.subject_count || 0 },
      { label: '当前', value: activeEnrichBook?.node_count || countNodes(enrichTree) },
    ]
    : datasetSection === 'textbooks'
      ? [
        { label: '教材', value: readerBooks.length },
        { label: '总页数', value: readerBooks.reduce((sum, book) => sum + book.page_count, 0) },
        { label: '原 PDF', value: readerBooks.filter((book) => book.pdf_available).length },
        { label: '仅 OCR', value: readerBooks.filter((book) => !book.pdf_available).length },
      ]
      : [
        { label: '大纲', value: datasetBooks.length },
        { label: '目录节点', value: countNodes(datasetTree) },
        { label: '提及', value: activeDatasetBook?.mentions.length || 0 },
        { label: '证据', value: activeDatasetBook?.evidence.length || 0 },
      ];

  const expandAll = () => setExpandedIds(new Set(activeFlat.map((item) => item.id)));
  const collapseAll = () => setExpandedIds(new Set(activeTree.map((item) => item.id)));

  const toggleExpanded = (id: string) => {
    setExpandedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleRelatedNode = (id: string) => {
    setExpandedRelatedNodeIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const startDetailResize = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!isWideLayout) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = detailPanelWidth;
    setIsDetailResizing(true);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';

    const handleMove = (moveEvent: PointerEvent) => {
      setDetailPanelWidth(clampTextbookDetailWidth(startWidth + startX - moveEvent.clientX));
    };
    const handleUp = () => {
      setIsDetailResizing(false);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleUp);
      window.removeEventListener('pointercancel', handleUp);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleUp);
    window.addEventListener('pointercancel', handleUp);
  }, [detailPanelWidth, isWideLayout]);

  const nudgeDetailWidth = useCallback((delta: number) => {
    setDetailPanelWidth((current) => clampTextbookDetailWidth(current + delta));
  }, []);

  const renderBookList = () => {
    if (sourceMode === 'dataset') {
      if (datasetSection === 'textbooks') {
        if (!filteredReaderBooks.length) {
          return <div className="p-4 text-sm text-text-muted">当前数据源没有匹配的电子教材。</div>;
        }
        return filteredReaderBooks.map((book) => (
          <button
            key={`reader:${book.book_id}`}
            type="button"
            onClick={() => openTextbookReader({ bookId: book.book_id, title: book.title })}
            className="w-full cursor-pointer border-b border-border-subtle px-3 py-2 text-left text-text-secondary transition-colors hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
          >
            <span className="flex items-center gap-1.5 truncate text-xs font-medium text-text-primary"><BookOpen className="h-3.5 w-3.5 text-accent" />{book.title}</span>
            <span className="mt-1 block text-[10px] text-text-muted">{book.page_count} 页 · {book.pdf_available ? '原 PDF 对照' : 'OCR 坐标预览'}</span>
          </button>
        ));
      }

      if (!knowledgeGraph || !filteredDatasetBooks.length) {
        return <div className="p-4 text-sm text-text-muted">当前数据源没有匹配的教材大纲。</div>;
      }
      return filteredDatasetBooks.map((book) => {
        const active = activeDatasetBook?.bookId === book.bookId;
        return (
          <button
            key={book.bookId}
            type="button"
            onClick={() => {
              setSelectedBook(book.bookId);
              setSelectedTreeId(null);
            }}
            className={`w-full border-b border-border-subtle px-3 py-2 text-left transition-colors hover:bg-hover ${
              active ? 'bg-accent/15 text-text-primary' : 'text-text-secondary'
            }`}
          >
            <span className="block truncate text-xs font-medium">{datasetBookTitle(book)}</span>
            <span className="mt-1 block text-[10px] text-text-muted">
              {book.mentions.length} 提及 · {book.evidence.length} 证据
            </span>
          </button>
        );
      });
    }

    if (enrichIndexError) return <div className="p-4 text-sm text-text-muted">{enrichIndexError}</div>;
    if (!enrichIndex) return <div className="p-4 text-sm text-text-muted">正在加载参考教材库。</div>;
    if (!filteredEnrichBooks.length) return <div className="p-4 text-sm text-text-muted">没有匹配的参考教材。</div>;

    return filteredEnrichBooks.slice(0, 500).map((book) => {
      const active = selectedEnrichPath === book.path;
      return (
        <button
          key={book.path}
          type="button"
          onClick={() => {
            setSelectedEnrichPath(book.path);
            setSelectedTreeId(null);
          }}
          className={`w-full border-b border-border-subtle px-3 py-2 text-left transition-colors hover:bg-hover ${
            active ? 'bg-accent/15 text-text-primary' : 'text-text-secondary'
          }`}
        >
          <span className="block truncate text-xs font-medium">{book.title || book.filename}</span>
          <span className="mt-1 block truncate text-[10px] text-text-muted">
            {describeBook(book)} · {book.node_count || 0} 节点 · 深度 {book.max_depth || 0}
          </span>
        </button>
      );
    });
  };

  const renderListNode = (node: WorkbenchNode) => {
    const hasChildren = node.children.length > 0;
    const expanded = expandedIds.has(node.id) || Boolean(treeQuery);
    const active = selectedNode?.id === node.id;

    return (
      <div key={`${node.source}:${node.id}`}>
        <div
          className={`grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-2 border-b border-border-subtle px-2 py-1.5 transition-colors ${
            active ? 'bg-accent/15 text-text-primary' : 'text-text-secondary hover:bg-hover'
          }`}
          style={{ paddingLeft: 8 + node.depth * 18 }}
        >
          <button
            type="button"
            onClick={() => hasChildren && toggleExpanded(node.id)}
            disabled={!hasChildren}
            aria-label={expanded ? '折叠节点' : '展开节点'}
            className={`flex h-5 w-5 items-center justify-center rounded text-text-muted transition-colors ${
              hasChildren ? 'hover:bg-elevated hover:text-text-primary' : 'opacity-40'
            }`}
          >
            {hasChildren ? (
              expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />
            ) : (
              <span className="h-1.5 w-1.5 rounded-full bg-border-strong" />
            )}
          </button>
          <button
            type="button"
            onClick={() => setSelectedTreeId(node.id)}
            className="min-w-0 text-left"
          >
            <span className="block truncate text-xs font-medium">{node.title}</span>
            <span className="mt-0.5 block truncate text-[10px] text-text-muted">{node.subtitle}</span>
          </button>
          <span className="rounded border border-border-subtle bg-elevated px-1.5 py-0.5 text-[10px] text-text-muted">
            {node.badge}
          </span>
        </div>
        {hasChildren && expanded && node.children.map(renderListNode)}
      </div>
    );
  };

  const renderGraph = () => {
    if (!visibleFlat.length) {
      return <div className="p-5 text-sm text-text-muted">没有可显示的目录节点。</div>;
    }

    const cardHeight = 48;
    const cardMinWidth = 168;
    const cardMaxWidth = 250;
    const rowGap = 66;
    const colGap = 286;
    const margin = { top: 24, right: 40, bottom: 34, left: 24 };
    const maxDepth = Math.max(...visibleFlat.map((row) => row.depth));
    const width = margin.left + margin.right + cardMaxWidth + Math.max(0, maxDepth) * colGap;
    const height = margin.top + margin.bottom + Math.max(visibleFlat.length, 1) * rowGap;
    const positions = new Map<string, WorkbenchNode & { x: number; y: number; width: number; centerY: number }>();

    visibleFlat.forEach((row, index) => {
      const nodeWidth = Math.min(cardMaxWidth, Math.max(cardMinWidth, 112 + row.title.length * 10));
      positions.set(row.id, {
        ...row,
        width: nodeWidth,
        x: margin.left + row.depth * colGap,
        y: margin.top + index * rowGap,
        centerY: margin.top + index * rowGap + cardHeight / 2,
      });
    });

    const graphNodes = visibleFlat.map((node) => {
      const pos = positions.get(node.id)!;
      const active = selectedNode?.id === node.id;
      const shortTitle = node.title.length > 16 ? `${node.title.slice(0, 16)}...` : node.title;
      const parent = node.parentId ? positions.get(node.parentId) : null;
      const depthColor = ['fill-accent/15 stroke-accent', 'fill-node-concept/15 stroke-node-concept', 'fill-node-experiment/15 stroke-node-experiment', 'fill-node-method/15 stroke-node-method'][Math.min(node.depth, 3)];
      return (
        <g key={node.id}>
          {parent && (
            <path
              d={`M ${parent.x + parent.width} ${parent.centerY} C ${parent.x + parent.width + 72} ${parent.centerY}, ${pos.x - 72} ${pos.centerY}, ${pos.x} ${pos.centerY}`}
              className="fill-none stroke-border-strong"
              strokeWidth="1.5"
            />
          )}
          <g
            role="button"
            tabIndex={0}
            transform={`translate(${pos.x}, ${pos.y})`}
            onClick={() => setSelectedTreeId(node.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') setSelectedTreeId(node.id);
            }}
            className="cursor-pointer outline-none"
          >
            <rect
              width={pos.width}
              height={cardHeight}
              rx="7"
              className={`${active ? 'fill-accent/20 stroke-accent' : `${depthColor} hover:stroke-accent`} transition-colors`}
              strokeWidth={active ? 2 : 1}
            />
            <circle cx="21" cy="24" r="10" className={active ? 'fill-accent' : 'fill-elevated stroke-border-default'} />
            <text x="21" y="27" textAnchor="middle" className={active ? 'fill-white text-[10px] font-semibold' : 'fill-text-muted text-[10px] font-semibold'}>
              {node.depth + 1}
            </text>
            <text x="39" y="18" className="fill-text-primary text-[12px] font-semibold">
              {shortTitle}
            </text>
            <text x="39" y="35" className="fill-text-muted text-[10px]">
              {node.subtitle.length > 20 ? `${node.subtitle.slice(0, 20)}...` : node.subtitle}
            </text>
            <title>{node.title}</title>
          </g>
        </g>
      );
    });

    return (
      <div className="h-full overflow-auto p-4 scrollbar-thin">
        <svg
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          aria-label="教材目录树图"
          className="min-w-full rounded-lg border border-border-subtle bg-surface shadow-panel"
        >
          {graphNodes}
        </svg>
      </div>
    );
  };

  const renderDetails = () => {
    if (enrichLoading) return <div className="p-4 text-sm text-text-muted">正在加载教材树。</div>;
    if (enrichError) return <div className="p-4 text-sm text-text-muted">{enrichError}</div>;
    if (!selectedNode) return <div className="p-4 text-sm text-text-muted">请选择一个目录节点。</div>;

    if (selectedNode.source === 'enrich') {
      const node = selectedNode.enrich!;
      const enrichment = node.enrichment || {};
      const sections = [
        ['definition', '定义'],
        ['content', '学习内容'],
        ['academic_requirements', '学业要求'],
        ['academic_quality', '学业质量'],
      ] as const;
      return (
        <div className="space-y-4 p-4">
          <section className="overflow-hidden rounded-lg border border-border-subtle bg-elevated shadow-panel">
            <div className="border-b border-border-subtle bg-surface p-4">
              <div className="mb-2 text-[10px] text-text-muted">{node.title_path.concat(node.title || '').filter(Boolean).join(' > ')}</div>
              <h2 className="text-lg font-semibold text-text-primary">{selectedNode.title}</h2>
              <div className="mt-3 grid grid-cols-3 rounded-lg border border-border-subtle bg-elevated text-center">
                <StatCell label="层级" value={node.depth + 1} />
                <StatCell label="序号" value={node.order_path} />
                <StatCell label="子节点" value={node.child_count} />
              </div>
            </div>
            {sections.map(([key, label]) => (
              <div key={key} className="border-b border-border-subtle p-4 last:border-b-0">
                <h3 className="mb-2 text-xs font-semibold text-accent">{label}</h3>
                <p className="whitespace-pre-wrap text-xs leading-6 text-text-secondary">
                  {text(enrichment[key]) || '无内容'}
                </p>
              </div>
            ))}
          </section>
        </div>
      );
    }

    return (
      <div className="space-y-4 p-4">
        <section className="rounded-lg border border-border-subtle bg-elevated p-4 shadow-panel">
          <div className="mb-2 flex flex-wrap items-center gap-2 text-[10px] text-text-muted">
            <span>{selectedNode.outline?.kind || 'item'}</span>
            {selectedNode.outline && pageLabel(selectedNode.outline) && <span>{pageLabel(selectedNode.outline)}</span>}
            {selectedNode.outline?.md_start != null && <span>md {selectedNode.outline.md_start}-{selectedNode.outline.md_end}</span>}
          </div>
          <h2 className="text-lg font-semibold text-text-primary">{selectedNode.title}</h2>
          <div className="mt-3 grid grid-cols-4 rounded-lg border border-border-subtle bg-surface text-center">
            <StatCell label="节点提及" value={selectedMentions.length} />
            <StatCell label="证据" value={selectedEvidence.length} />
            <StatCell label="图片" value={selectedEvidence.filter((item) => item.modality === 'image').length} />
            <StatCell label="公式" value={selectedEvidence.filter((item) => item.modality === 'equation').length} />
          </div>
        </section>

        <section className="rounded-lg border border-border-subtle bg-elevated p-4 shadow-panel">
          <div className="mb-3 flex items-center gap-2 text-xs font-medium text-text-muted">
            <Network className="h-3.5 w-3.5" />
            关联知识节点
            {selectedKnowledgeNodes.length > 0 && (
              <span className="ml-auto text-[10px] font-normal">{selectedKnowledgeNodes.length} 个</span>
            )}
          </div>
          {selectedKnowledgeNodes.length ? (
            <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface">
              {selectedKnowledgeNodes.map((node) => {
                const unitState = selectedSourceKey
                  ? relatedUnitCache.get(relatedUnitCacheKey(selectedSourceKey, node.id))
                  : null;
                const expanded = expandedRelatedNodeIds.has(node.id);
                const loadingBody = Boolean(expanded && selectedSourceKey && (!unitState || unitState.loading));
                const body = unitBodyContent(unitState?.unit);
                return (
                  <article key={node.id}>
                    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-stretch">
                      <button
                        type="button"
                        onClick={() => toggleRelatedNode(node.id)}
                        aria-expanded={expanded}
                        className="flex min-w-0 items-center gap-2 px-3 py-2.5 text-left transition-colors hover:bg-hover"
                      >
                        {expanded ? (
                          <ChevronDown className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-muted" />
                        )}
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-semibold text-text-primary">{node.name}</span>
                          <span className="mt-1 block truncate text-[10px] font-normal text-text-muted">{nodeKindLabel(node)}</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        aria-label={`在图谱中查看 ${node.name}`}
                        onClick={() => {
                          setSelectedNodeId(node.id);
                          setWorkspace('graph');
                        }}
                        className="m-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border-subtle bg-elevated text-text-muted transition-colors hover:bg-hover hover:text-text-primary"
                      >
                        <Network className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {expanded && (
                      <div className="border-t border-border-subtle bg-surface px-3 py-3">
                        <div className="border-l-2 border-accent/30 pl-3">
                          {loadingBody ? (
                            <p className="text-xs leading-6 text-text-muted">正在加载知识正文...</p>
                          ) : unitState?.error ? (
                            <p className="text-xs leading-6 text-red-300">{unitState.error}</p>
                          ) : body ? (
                            <MarkdownView
                              content={body}
                              className="text-xs leading-6 text-text-secondary"
                              resolveImageUrl={(src) => resolveUnitMarkdownImage(unitState?.unit, src)}
                              imageLayout="preview"
                            />
                          ) : (
                            <p className="text-xs leading-6 text-text-muted">这个知识节点还没有知识正文。</p>
                          )}
                        </div>
                      </div>
                    )}
                  </article>
                );
              })}
            </div>
          ) : (
            <p className="text-sm text-text-muted">这个目录节点暂时没有关联到知识节点。</p>
          )}
        </section>

        <section className="rounded-lg border border-border-subtle bg-elevated p-4 shadow-panel">
          <div className="mb-3 text-xs font-medium text-text-muted">教材证据</div>
          {selectedEvidence.length ? (
            <div className="space-y-2">
              {selectedEvidence.slice(0, 80).map((item) => (
                <div key={item.id} className="rounded-md border border-border-subtle bg-surface p-3">
                  <div className="mb-1 flex items-start justify-between gap-3">
                    <div className="flex min-w-0 flex-wrap gap-2 text-[10px] text-text-muted">
                      <span>{item.id}</span>
                      <span>{modalityLabel(item.modality)}</span>
                      {item.page_start != null && <span>p.{text(item.page_start)}</span>}
                      {text(item.locator) && <span>{text(item.locator)}</span>}
                    </div>
                    {activeDatasetBook && readerBookIds.has(activeDatasetBook.bookId) && (
                      <button
                        type="button"
                        onClick={() => openTextbookReader({
                          bookId: activeDatasetBook.bookId,
                          title: datasetBookTitle(activeDatasetBook),
                          evidenceId: item.id,
                          pageNumber: item.page_start == null ? undefined : Number(item.page_start),
                        })}
                        className="flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-accent/30 bg-accent/10 px-2 py-1 text-[10px] font-medium text-accent transition-colors hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      >
                        <BookOpen className="h-3 w-3" />
                        原文定位
                      </button>
                    )}
                  </div>
                  <MarkdownView
                    content={evidenceImageContent(item)}
                    className="text-xs leading-relaxed text-text-secondary"
                    resolveImageUrl={(src) => resolveEvidenceImage(src, item)}
                    hideDecorativeImages={false}
                  />
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-text-muted">这个目录节点暂时没有证据。</p>
          )}
        </section>
      </div>
    );
  };

  const activeTitle = sourceMode === 'enrich'
    ? activeEnrichBook?.title || '参考教材库'
    : activeDatasetBook?.bookId || '当前数据源教材';
  const activeMeta = sourceMode === 'enrich'
    ? activeEnrichBook ? describeBook(activeEnrichBook) : '从参考教材库读取'
    : activeDatasetBook ? `${activeDatasetBook.mentions.length} 提及 · ${activeDatasetBook.evidence.length} 证据` : '从当前知识图数据源读取';
  const isTextbookLibraryView = sourceMode === 'dataset' && datasetSection === 'textbooks';

  return (
    <main
      className="grid min-h-0 flex-1 grid-cols-[320px_minmax(420px,1fr)_420px] bg-deep max-xl:grid-cols-[300px_minmax(420px,1fr)] max-lg:flex max-lg:flex-col max-lg:overflow-y-auto"
      style={isWideLayout ? { gridTemplateColumns: `320px minmax(420px,1fr) ${detailPanelWidth}px` } : undefined}
    >
      <aside className="flex min-h-0 flex-col border-r border-border-subtle bg-surface/95 shadow-panel max-lg:min-h-[260px] max-lg:max-h-[34vh] max-lg:border-b max-lg:border-r-0">
        <div className="border-b border-border-subtle p-3">
          <div className="mb-3 flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-accent" />
            <div>
              <div className="text-sm font-semibold text-text-primary">教材工作台</div>
            </div>
          </div>
          <div role="tablist" aria-label="教材工作台数据来源" className="grid grid-cols-2 rounded-lg border border-border-subtle bg-elevated p-0.5">
            <button
              type="button"
              role="tab"
              aria-selected={sourceMode === 'dataset'}
              onClick={() => {
                setSourceMode('dataset');
                setSelectedTreeId(null);
                setTreeQuery('');
              }}
              className={`cursor-pointer rounded-md px-2 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${sourceMode === 'dataset' ? 'bg-accent text-white' : 'text-text-secondary hover:bg-hover hover:text-text-primary'}`}
            >
              当前数据源
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={sourceMode === 'enrich'}
              onClick={() => {
                setSourceMode('enrich');
                setSelectedTreeId(null);
                setTreeQuery('');
              }}
              className={`cursor-pointer rounded-md px-2 py-1.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${sourceMode === 'enrich' ? 'bg-accent text-white' : 'text-text-secondary hover:bg-hover hover:text-text-primary'}`}
            >
              参考教材库
            </button>
          </div>
          <div className="mt-3 grid gap-2">
            {sourceMode === 'dataset' && (
              <div role="tablist" aria-label="当前数据源资源类型" className="grid grid-cols-2 rounded-md bg-elevated p-0.5 ring-1 ring-inset ring-border-subtle">
                <button
                  type="button"
                  role="tab"
                  aria-selected={datasetSection === 'textbooks'}
                  onClick={() => {
                    setDatasetSection('textbooks');
                    setBookQuery('');
                  }}
                  className={`cursor-pointer rounded px-2 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${datasetSection === 'textbooks' ? 'bg-surface text-accent shadow-sm ring-1 ring-inset ring-border-subtle' : 'text-text-muted hover:bg-hover hover:text-text-primary'}`}
                >
                  教材
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={datasetSection === 'outlines'}
                  onClick={() => {
                    setDatasetSection('outlines');
                    setBookQuery('');
                    setSelectedTreeId(null);
                  }}
                  className={`cursor-pointer rounded px-2 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${datasetSection === 'outlines' ? 'bg-surface text-accent shadow-sm ring-1 ring-inset ring-border-subtle' : 'text-text-muted hover:bg-hover hover:text-text-primary'}`}
                >
                  大纲
                </button>
              </div>
            )}
            {sourceMode === 'enrich' && (
              <select
                value={subjectFilter}
                onChange={(event) => setSubjectFilter(event.target.value)}
                className="w-full rounded-md border border-border-subtle bg-elevated px-2 py-1.5 text-xs text-text-secondary outline-none transition-colors focus:border-accent"
              >
                <option value="">全部学科</option>
                {enrichSubjects.map((subject) => (
                  <option key={subject} value={subject}>{subject}</option>
                ))}
              </select>
            )}
            <label className="flex items-center gap-2 rounded-md border border-border-subtle bg-elevated px-2 py-1.5 transition-colors focus-within:border-accent">
              <Search className="h-3.5 w-3.5 text-text-muted" />
              <input
                value={bookQuery}
                onChange={(event) => setBookQuery(event.target.value)}
                aria-label={sourceMode === 'enrich' ? '搜索参考教材' : datasetSection === 'textbooks' ? '搜索电子教材' : '搜索教材大纲'}
                placeholder={sourceMode === 'enrich' ? '搜索教材，例如：化学 人教 上册' : datasetSection === 'textbooks' ? '搜索电子教材' : '搜索教材大纲'}
                className="min-w-0 flex-1 bg-transparent text-xs text-text-primary outline-none placeholder:text-text-muted"
              />
            </label>
          </div>
        </div>
        <div className="grid grid-cols-4 border-b border-border-subtle bg-elevated text-center">
          {sourceStats.map((stat) => <StatCell key={stat.label} label={stat.label} value={stat.value} />)}
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          {renderBookList()}
        </div>
      </aside>

      {isTextbookLibraryView ? (
        <section className="col-span-2 flex min-h-0 min-w-0 items-center justify-center bg-deep p-6 max-xl:col-span-1 max-lg:min-h-[420px]">
          <div className="max-w-sm rounded-xl border border-border-subtle bg-surface/95 p-6 text-center shadow-panel">
            <div className="mx-auto flex h-11 w-11 items-center justify-center rounded-xl bg-accent/10 text-accent">
              <BookOpen className="h-5 w-5" />
            </div>
            <h1 className="mt-4 text-base font-semibold text-text-primary">电子教材</h1>
            <p className="mt-2 text-xs leading-5 text-text-muted">从左侧选择教材，打开原 PDF 或 OCR 坐标阅读器。教材大纲、知识提及和证据已移到“大纲”。</p>
          </div>
        </section>
      ) : (
      <>
      <section className="flex min-h-0 min-w-0 flex-col bg-deep max-lg:min-h-[420px]">
        <div className="border-b border-border-subtle bg-surface/95 p-3 shadow-panel">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <h1 className="truncate text-base font-semibold text-text-primary">{activeTitle}</h1>
              <div className="mt-1 truncate text-xs text-text-muted">{activeMeta}</div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {sourceMode === 'dataset' && activeDatasetBook && readerBookIds.has(activeDatasetBook.bookId) && (
                <button
                  type="button"
                  onClick={() => openTextbookReader({
                    bookId: activeDatasetBook.bookId,
                    title: datasetBookTitle(activeDatasetBook),
                    pageNumber: selectedNode?.outline?.page_start == null ? undefined : Number(selectedNode.outline.page_start),
                  })}
                  className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-accent/30 bg-accent/10 px-2.5 py-1.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <BookOpen className="h-3.5 w-3.5" />
                  电子教材
                </button>
              )}
              <div className="flex rounded-lg border border-border-subtle bg-elevated p-0.5">
                <button
                  type="button"
                  onClick={() => setTreeMode('graph')}
                  className={`flex items-center gap-1 rounded-md px-2.5 py-1 text-xs transition-colors ${treeMode === 'graph' ? 'bg-accent text-white' : 'text-text-secondary hover:bg-hover hover:text-text-primary'}`}
                >
                  <Layers className="h-3.5 w-3.5" />
                  图形
                </button>
                <button
                  type="button"
                  onClick={() => setTreeMode('list')}
                  className={`rounded-md px-2.5 py-1 text-xs transition-colors ${treeMode === 'list' ? 'bg-accent text-white' : 'text-text-secondary hover:bg-hover hover:text-text-primary'}`}
                >
                  列表
                </button>
              </div>
            </div>
          </div>
          <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2 max-sm:grid-cols-2">
            <label className="flex min-w-0 items-center gap-2 rounded-md border border-border-subtle bg-elevated px-2 py-1.5 transition-colors focus-within:border-accent max-sm:col-span-2">
              <Search className="h-3.5 w-3.5 text-text-muted" />
              <input
                value={treeQuery}
                onChange={(event) => setTreeQuery(event.target.value)}
                placeholder="搜索当前教材树中的标题、解释或证据"
                className="min-w-0 flex-1 bg-transparent text-xs text-text-primary outline-none placeholder:text-text-muted"
              />
            </label>
            <button
              type="button"
              onClick={expandAll}
              disabled={treeMode === 'graph'}
              className="rounded-md border border-border-subtle bg-elevated px-2.5 py-1 text-xs text-text-secondary transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              展开
            </button>
            <button
              type="button"
              onClick={collapseAll}
              disabled={treeMode === 'graph'}
              className="rounded-md border border-border-subtle bg-elevated px-2.5 py-1 text-xs text-text-secondary transition-colors hover:bg-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              折叠
            </button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-hidden">
          {treeMode === 'graph' ? (
            renderGraph()
          ) : (
            <div className="h-full overflow-y-auto scrollbar-thin">
              {visibleTree.length ? visibleTree.map(renderListNode) : <div className="p-5 text-sm text-text-muted">没有匹配的目录节点。</div>}
            </div>
          )}
        </div>
      </section>

      <aside className="relative flex min-h-0 flex-col border-l border-border-subtle bg-surface/95 shadow-panel max-xl:col-span-2 max-xl:min-h-[420px] max-xl:border-l-0 max-xl:border-t max-lg:col-span-1 max-lg:min-h-[360px]">
        {isWideLayout && (
          <div
            role="separator"
            aria-label="调整节点详情宽度"
            aria-orientation="vertical"
            tabIndex={0}
            onPointerDown={startDetailResize}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft') {
                event.preventDefault();
                nudgeDetailWidth(24);
              }
              if (event.key === 'ArrowRight') {
                event.preventDefault();
                nudgeDetailWidth(-24);
              }
            }}
            className={`absolute left-0 top-0 z-20 h-full w-3 -translate-x-1.5 cursor-col-resize outline-none transition-colors ${
              isDetailResizing ? 'bg-accent/25' : 'hover:bg-accent/20 focus:bg-accent/20'
            }`}
          >
            <span className="absolute left-1/2 top-1/2 h-12 w-0.5 -translate-x-1/2 -translate-y-1/2 bg-border-strong" />
          </div>
        )}
        <div className="border-b border-border-subtle bg-elevated p-3">
          <div className="text-sm font-semibold text-text-primary">节点详情</div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto scrollbar-thin">
          {renderDetails()}
        </div>
      </aside>
      </>
      )}
    </main>
  );
}
