import { useDeferredValue, useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import type {
  PgAdminBookSummary,
  PipelineBookNodesResponse,
  PipelineFolderPdf,
  PipelineJobSummary,
  PipelineOcrInspectResponse,
  PipelineStartResponse,
} from '@okm/types';
import {
  inferTextbookMetadata,
  inspectPipelineOcrFolder,
  loadEnrichBook,
  loadEnrichBooks,
  loadPgAdminBooks,
  loadPipelineBookNodes,
  scanPipelineFolder,
  uploadPipelinePdf,
  type EnrichBookResponse,
  type EnrichBookSummary,
} from '@/services/backend-client';
import {
  AlertCircle,
  BookOpen,
  Check,
  ExternalLink,
  FileText,
  FolderOpen,
  ListChecks,
  Loader2,
  Network,
  Play,
  Search,
  Upload,
  X,
} from '@/lib/lucide-icons';
import {
  buildPipelineBookWorkbenchRows,
  reconcileScannedQueueSnapshot,
  reconcileTerminalBatchQueue,
  selectBatchLaunchCandidates,
  type PipelineBatchQueueItem,
  type PipelineBookWorkbenchRow as WorkbenchRow,
} from '@/lib/pipeline-start';

type QueueBook = PipelineBatchQueueItem & {
  fileName: string;
  sourceFolder: string;
  enrichConfirmedByUser?: boolean;
  jobId?: string;
  ocrInspection?: Pick<PipelineOcrInspectResponse, 'quality' | 'page_count' | 'block_count' | 'image_count'>;
};

function sourceFolderFromPath(path: string, relative = false): string {
  const parts = path.replace(/\\/g, '/').split('/').filter(Boolean);
  if (parts.length <= 1) return '根目录';
  const folders = parts.slice(0, -1);
  return (relative ? folders : folders.slice(-2)).join(' / ') || '根目录';
}

function sourceFolderLevels(sourceFolder: string): { subject: string; subfolder: string } {
  const [subject = '未分类', ...rest] = sourceFolder.split(/\s*\/\s*/).filter(Boolean);
  return { subject, subfolder: rest.join(' / ') };
}

function fileSizeText(sizeBytes: number): string {
  if (!sizeBytes) return '—';
  if (sizeBytes < 1024 * 1024) return `${Math.max(1, Math.round(sizeBytes / 1024))} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

function rowStatus(row: WorkbenchRow): { label: string; tone: string; detail: string } {
  if (row.queueStatus === 'uploading') return { label: `上传 ${row.progress}%`, tone: 'active', detail: '正在传到工作台存储' };
  if (row.queueStatus === 'starting') return { label: '启动中', tone: 'active', detail: '正在创建后台任务' };
  if (row.queueStatus === 'error') return { label: '待处理', tone: 'warn', detail: row.queueError };
  if (row.job?.status === 'completed' && row.job.current_stage_id === 'prepare_outline_chunks') {
    return { label: '切分待确认', tone: 'warn', detail: '选择该任务并检查目录切分预览' };
  }
  if (row.job?.status === 'completed') return { label: '已完成抽取', tone: 'ok', detail: row.job.completed_at || row.job.updated_at || '' };
  if (row.job?.status === 'blocked') return { label: '抽取阻断', tone: 'warn', detail: row.job.error || row.job.current_stage_label || '需要检查任务详情' };
  if (row.job?.status === 'running' || row.queueStatus === 'started') {
    const preparing = !row.job?.current_stage_id || ['check_postgres', 'mineru_source_markdown', 'extract_pdf_outline', 'prepare_source_markdown', 'ensure_outline', 'prepare_outline_chunks'].includes(row.job.current_stage_id);
    return { label: preparing ? '生成切分中' : '抽取中', tone: 'active', detail: row.job?.current_stage_label || '后台任务已启动' };
  }
  if ((row.database?.canonical_nodes ?? 0) > 0) return { label: '已有抽取结果', tone: 'ok', detail: '数据库中已有教材节点' };
  if ((row.pdfPath || row.ocrFolderPath) && row.enrichContext === null) return { label: '待确认 Enrich', tone: 'warn', detail: '选择对应大纲或明确不使用' };
  if (row.pdfPath || row.ocrFolderPath) return { label: '等待切分', tone: 'neutral', detail: row.selected ? '已加入本次批量准备' : '本次不处理' };
  return { label: '已有教材记录', tone: 'neutral', detail: '未关联可启动的 PDF 路径' };
}

function StatusBadge({ row }: { row: WorkbenchRow }) {
  const status = rowStatus(row);
  const className = status.tone === 'ok'
    ? 'border-node-process/40 bg-node-process/10 text-node-process'
    : status.tone === 'warn'
      ? 'border-node-event/40 bg-node-event/10 text-node-event'
      : status.tone === 'active'
        ? 'border-accent/40 bg-accent/10 text-accent'
        : 'border-border-default bg-surface text-text-secondary';
  return (
    <div className="min-w-[124px]">
      <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium ${className}`}>{status.label}</span>
      <div className="mt-1.5 max-w-[210px] truncate text-xs text-text-muted" title={status.detail}>{status.detail || '—'}</div>
    </div>
  );
}

function nodeOwnershipText(value: 'created' | 'review' | 'matched'): string {
  if (value === 'created') return '本书创建';
  if (value === 'review') return '待复核归并';
  return '匹配已有节点';
}

function BookNodesDialog({
  bookTitle,
  payload,
  loading,
  error,
  onClose,
}: {
  bookTitle: string;
  payload: PipelineBookNodesResponse | null;
  loading: boolean;
  error: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/55 p-0 backdrop-blur-sm sm:items-center sm:p-6" role="dialog" aria-modal="true" aria-label="教材节点明细">
      <section className="flex max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-t-xl border border-border-default bg-elevated shadow-panel sm:rounded-xl">
        <header className="flex items-start justify-between gap-4 border-b border-border-subtle px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-text-primary"><Network className="h-4 w-4 text-accent" />教材节点明细</div>
            <div className="mt-1 truncate text-[11px] text-text-muted">
              {bookTitle || '读取中'}
              {payload ? ` · ${payload.total} 个关联节点${payload.nodes.length < payload.total ? ` · 当前展示前 ${payload.nodes.length} 个` : ''}` : ''}
            </div>
          </div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-border-subtle text-text-muted transition-colors hover:bg-hover hover:text-text-primary" aria-label="关闭节点明细">
            <X className="h-4 w-4" />
          </button>
        </header>
        {loading ? (
          <div className="flex min-h-64 items-center justify-center gap-2 text-sm text-text-muted"><Loader2 className="h-4 w-4 animate-spin text-accent" />正在读取节点…</div>
        ) : error ? (
          <div className="m-4 flex items-start gap-2 rounded-lg border border-node-event/40 bg-node-event/10 p-3 text-sm text-node-event"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />{error}</div>
        ) : (
          <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
            <table className="w-full min-w-[820px] text-left text-xs">
              <thead className="sticky top-0 z-10 bg-elevated text-text-muted">
                <tr>
                  <th className="px-4 py-2 font-medium">节点</th>
                  <th className="px-3 py-2 font-medium">类型</th>
                  <th className="px-3 py-2 font-medium">归属</th>
                  <th className="px-3 py-2 font-medium">课时数</th>
                  <th className="px-3 py-2 font-medium">定义</th>
                </tr>
              </thead>
              <tbody>
                {(payload?.nodes ?? []).map((node) => (
                  <tr key={node.id} className="border-t border-border-subtle align-top transition-colors hover:bg-hover/60">
                    <td className="max-w-[260px] px-4 py-2.5">
                      <div className="font-medium text-text-primary">{node.name}</div>
                      <div className="mt-1 truncate font-mono text-[10px] text-text-muted" title={node.id}>{node.id}</div>
                    </td>
                    <td className="px-3 py-2.5 text-text-secondary">{node.kind}{node.subkind ? ` / ${node.subkind}` : ''}</td>
                    <td className="px-3 py-2.5 text-text-secondary">{nodeOwnershipText(node.ownership)}{node.shared ? ' · 跨书复用' : ''}</td>
                    <td className="px-3 py-2.5 tabular-nums text-text-secondary">{node.lesson_count}</td>
                    <td className="max-w-[360px] px-3 py-2.5 leading-5 text-text-secondary">{node.definition || '—'}</td>
                  </tr>
                ))}
                {payload?.nodes.length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-14 text-center text-text-muted">这本书还没有 canonical 节点映射。</td></tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function normalizeEnrichSearch(value: string): string {
  return value.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function enrichSearchTerms(value: string): string[] {
  const lower = value.toLowerCase();
  const terms = value.split(/[\s/_·-]+/).map(normalizeEnrichSearch).filter((term) => term.length >= 2);
  const aliases: Array<[RegExp, string[]]> = [
    [/physics|物理/, ['物理']],
    [/chemistry|chem|化学/, ['化学']],
    [/biology|bio|生物/, ['生物']],
    [/mathematics|math|数学/, ['数学']],
    [/hukj|沪科技|沪科教/, ['沪科技', '沪科教']],
    [/pep|\brj\b|人教/, ['人教']],
    [/junior|初中/, ['初中']],
    [/senior|高中/, ['高中']],
  ];
  aliases.forEach(([pattern, values]) => {
    if (pattern.test(lower)) terms.push(...values.map(normalizeEnrichSearch));
  });
  const compulsory = lower.match(/(?:compulsory|必修)[\s_-]*(?:第)?([1-6一二三四五六])/);
  if (compulsory?.[1]) {
    const numerals: Record<string, string> = { '1': '一', '2': '二', '3': '三', '4': '四', '5': '五', '6': '六' };
    const numeral = numerals[compulsory[1]] || compulsory[1];
    terms.push(normalizeEnrichSearch(`必修第${numeral}册`), normalizeEnrichSearch(`必修${numeral}`));
  }
  const selective = lower.match(/(?:xb|选择性必修)[\s_-]*([1-6一二三四五六])/);
  if (selective?.[1]) {
    const numerals: Record<string, string> = { '1': '一', '2': '二', '3': '三', '4': '四', '5': '五', '6': '六' };
    const numeral = numerals[selective[1]] || selective[1];
    terms.push(normalizeEnrichSearch(`选择性必修第${numeral}册`), normalizeEnrichSearch(`选择性必修${numeral}`));
  }
  return [...new Set(terms)];
}

function scoreEnrichBook(book: EnrichBookSummary, query: string): number {
  const haystack = normalizeEnrichSearch([
    book.title, book.path, book.subject, book.stage, book.grade, book.course, book.publisher, book.volume,
  ].filter(Boolean).join(' '));
  const normalizedQuery = normalizeEnrichSearch(query);
  const terms = enrichSearchTerms(query);
  if (!normalizedQuery && terms.length === 0) return 1;
  let score = normalizedQuery.length >= 3 && haystack.includes(normalizedQuery) ? 200 : 0;
  terms.forEach((term) => {
    if (haystack.includes(term)) score += Math.min(40, 8 + term.length * 2);
  });
  return score;
}

function topEnrichBook(books: EnrichBookSummary[], query: string): EnrichBookSummary | null {
  let bestBook: EnrichBookSummary | null = null;
  let bestScore = -1;
  for (const book of books) {
    const score = scoreEnrichBook(book, query);
    if (score <= 0) continue;
    if (!bestBook || score > bestScore || (score === bestScore && book.title.localeCompare(bestBook.title, 'zh-CN') < 0)) {
      bestBook = book;
      bestScore = score;
    }
  }
  return bestBook;
}

function flattenEnrichOutline(payload: EnrichBookResponse | null): Array<{ id: string; title: string; depth: number }> {
  const result: Array<{ id: string; title: string; depth: number }> = [];
  const visit = (nodes: EnrichBookResponse['tree']) => {
    nodes.forEach((node) => {
      result.push({ id: node.id, title: String(node.title || '未命名条目'), depth: node.depth });
      if (result.length < 160) visit(node.child_nodes);
    });
  };
  if (payload) visit(payload.tree);
  return result.slice(0, 160);
}

function EnrichOutlineDialog({
  sourceKey,
  item,
  onClose,
  onConfirm,
}: {
  sourceKey: string;
  item: QueueBook;
  onClose: () => void;
  onConfirm: (selection: { enrichContext: boolean; enrichBookPath?: string; enrichBookTitle?: string }) => void;
}) {
  const [query, setQuery] = useState(item.title || item.fileName);
  const deferredQuery = useDeferredValue(query);
  const [books, setBooks] = useState<EnrichBookSummary[]>([]);
  const [booksLoading, setBooksLoading] = useState(true);
  const [booksError, setBooksError] = useState('');
  const [activePath, setActivePath] = useState(item.enrichBookPath || '');
  const [outline, setOutline] = useState<EnrichBookResponse | null>(null);
  const [outlineLoading, setOutlineLoading] = useState(false);
  const [outlineError, setOutlineError] = useState('');

  useEffect(() => {
    let cancelled = false;
    setBooksLoading(true);
    void loadEnrichBooks(sourceKey).then((payload) => {
      if (!cancelled) setBooks(payload.books);
    }).catch((loadError) => {
      if (!cancelled) setBooksError((loadError as Error).message || '读取 Enrich 教材库失败');
    }).finally(() => {
      if (!cancelled) setBooksLoading(false);
    });
    return () => { cancelled = true; };
  }, [sourceKey]);

  useEffect(() => {
    if (!activePath) {
      setOutline(null);
      return;
    }
    let cancelled = false;
    setOutlineLoading(true);
    setOutlineError('');
    void loadEnrichBook(sourceKey, activePath).then((payload) => {
      if (!cancelled) setOutline(payload);
    }).catch((loadError) => {
      if (!cancelled) setOutlineError((loadError as Error).message || '读取 Enrich 目录失败');
    }).finally(() => {
      if (!cancelled) setOutlineLoading(false);
    });
    return () => { cancelled = true; };
  }, [activePath, sourceKey]);

  const candidates = useMemo(() => books
    .map((book) => ({ book, score: scoreEnrichBook(book, deferredQuery) }))
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.book.title.localeCompare(right.book.title, 'zh-CN'))
    .slice(0, 80), [books, deferredQuery]);

  useEffect(() => {
    if (!activePath && candidates[0]?.book.path) setActivePath(candidates[0].book.path);
  }, [activePath, candidates]);
  const selectedBook = books.find((book) => book.path === activePath) || outline?.book || null;
  const outlineRows = useMemo(() => flattenEnrichOutline(outline), [outline]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-labelledby="enrich-dialog-title">
      <section className="flex h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-t-xl border border-border-default bg-elevated shadow-panel sm:h-[82vh] sm:rounded-xl">
        <header className="flex items-start justify-between gap-4 border-b border-border-subtle px-4 py-3 sm:px-5">
          <div className="min-w-0">
            <div id="enrich-dialog-title" className="flex items-center gap-2 text-sm font-semibold text-text-primary"><BookOpen className="h-4 w-4 text-accent" />为教材确认 Enrich 目录</div>
            <div className="mt-1 truncate text-[11px] text-text-muted" title={item.title}>{item.title} · 选择后优先用该目录生成抽取大纲，并只从这一本 Enrich 教材检索辅助提示</div>
          </div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md border border-border-subtle text-text-muted transition-colors hover:bg-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent" aria-label="关闭 Enrich 目录选择"><X className="h-4 w-4" /></button>
        </header>

        <div className="grid min-h-0 flex-1 md:grid-cols-[minmax(300px,0.9fr)_minmax(0,1.4fr)]">
          <section className="flex min-h-0 flex-col border-b border-border-subtle md:border-b-0 md:border-r" aria-label="Enrich 教材候选">
            <div className="border-b border-border-subtle p-3">
              <label htmlFor="enrich-outline-search" className="mb-1.5 block text-[11px] font-medium text-text-secondary">检索教材名称、出版社或册次</label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
                <input id="enrich-outline-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="例如：高中物理 沪科技版 必修第三册" className="h-9 w-full rounded-md border border-border-default bg-surface pl-9 pr-3 text-xs text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent" autoFocus />
              </div>
              <div className="mt-1.5 text-[10px] text-text-muted">{booksLoading ? '正在读取教材库…' : `找到 ${candidates.length} 个候选，最多显示 80 个`}</div>
            </div>
            {booksError ? (
              <div className="m-3 flex items-start gap-2 rounded-md border border-node-event/40 bg-node-event/10 p-3 text-xs text-node-event" role="alert"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{booksError}</div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto p-2 scrollbar-thin">
                {candidates.map(({ book }) => {
                  const active = book.path === activePath;
                  return (
                    <button key={book.path} type="button" onClick={() => setActivePath(book.path)} className={`mb-1 w-full cursor-pointer rounded-md border px-3 py-2.5 text-left transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent ${active ? 'border-accent bg-accent/10' : 'border-transparent hover:border-border-default hover:bg-hover'}`}>
                      <div className="text-xs font-medium text-text-primary">{book.title}</div>
                      <div className="mt-1 flex flex-wrap gap-x-2 gap-y-1 text-[10px] text-text-muted"><span>{book.node_count ?? 0} 个条目</span>{book.subject && <span>{book.subject}</span>}{book.stage && <span>{book.stage}</span>}</div>
                    </button>
                  );
                })}
                {!booksLoading && candidates.length === 0 && <div className="px-3 py-12 text-center text-xs text-text-muted">没有检索到候选，请缩短关键词后重试。</div>}
              </div>
            )}
          </section>

          <section className="flex min-h-0 flex-col" aria-label="Enrich 目录预览">
            <div className="border-b border-border-subtle px-4 py-3">
              <div className="text-xs font-semibold text-text-primary">大纲预览</div>
              <div className="mt-1 truncate text-[10px] text-text-muted" title={selectedBook?.path}>{selectedBook?.title || '请从左侧选择一本 Enrich 教材'}</div>
            </div>
            {outlineLoading ? (
              <div className="flex min-h-52 flex-1 items-center justify-center gap-2 text-xs text-text-muted"><Loader2 className="h-4 w-4 animate-spin text-accent" />正在读取大纲…</div>
            ) : outlineError ? (
              <div className="m-4 flex items-start gap-2 rounded-md border border-node-event/40 bg-node-event/10 p-3 text-xs text-node-event" role="alert"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{outlineError}</div>
            ) : outline ? (
              <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 scrollbar-thin">
                {outlineRows.map((row) => (
                  <div key={row.id} className="border-b border-border-subtle/70 py-1.5 text-[11px] leading-5 text-text-secondary" style={{ paddingLeft: `${Math.min(row.depth, 6) * 16 + 8}px` }}>
                    <span className={row.depth === 0 ? 'font-semibold text-text-primary' : ''}>{row.title}</span>
                  </div>
                ))}
                {outlineRows.length === 0 && <div className="px-3 py-12 text-center text-xs text-text-muted">这本 Enrich 教材没有可预览的大纲条目。</div>}
              </div>
            ) : (
              <div className="flex min-h-52 flex-1 items-center justify-center px-6 text-center text-xs leading-5 text-text-muted">选择候选教材后，在这里核对章节与课时是否对应。</div>
            )}
          </section>
        </div>

        <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle px-4 py-3 sm:px-5">
          <button type="button" onClick={() => onConfirm({ enrichContext: false })} className="cursor-pointer rounded-md border border-border-default bg-surface px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:bg-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">确认本书不使用 Enrich</button>
          <div className="flex items-center gap-2">
            <button type="button" onClick={onClose} className="cursor-pointer rounded-md border border-border-default px-3 py-2 text-xs font-medium text-text-secondary transition-colors hover:bg-hover hover:text-text-primary">取消</button>
            <button type="button" disabled={!selectedBook || outlineLoading || Boolean(outlineError)} onClick={() => selectedBook && onConfirm({ enrichContext: true, enrichBookPath: selectedBook.path, enrichBookTitle: selectedBook.title })} className="cursor-pointer rounded-md bg-accent px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-accent-dim focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:bg-surface disabled:text-text-muted">确认使用此目录</button>
          </div>
        </footer>
      </section>
    </div>
  );
}

export function PipelineBookWorkbench({
  sourceKey,
  jobs,
  onStartBook,
  onRefreshJobs,
}: {
  sourceKey: string;
  jobs: PipelineJobSummary[];
  onStartBook: (book: {
    bookId: string;
    title: string;
    pdfPath?: string;
    ocrFolderPath?: string;
    ocrImportMode?: 'in_place' | 'copy';
    enrichContext: boolean;
    enrichBookPath?: string;
  }) => Promise<PipelineStartResponse>;
  onRefreshJobs: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const reinferredSourceKeyRef = useRef('');
  const enrichBooksPromiseRef = useRef<Promise<EnrichBookSummary[]> | null>(null);
  const [queue, setQueue] = useState<QueueBook[]>([]);
  const [databaseBooks, setDatabaseBooks] = useState<PgAdminBookSummary[]>([]);
  const [folderPath, setFolderPath] = useState('/srv/innospark-disks/disk06/05_enrich书名对齐');
  const [pairedOcrFolderPath, setPairedOcrFolderPath] = useState('');
  const [ocrFolderPath, setOcrFolderPath] = useState('');
  const [bookFilter, setBookFilter] = useState('');
  const [subjectFilter, setSubjectFilter] = useState('all');
  const [subfolderFilter, setSubfolderFilter] = useState('all');
  const [ocrFilter, setOcrFilter] = useState<'all' | 'ready' | 'missing'>('all');
  const [scanning, setScanning] = useState(false);
  const [inspectingOcr, setInspectingOcr] = useState(false);
  const [batchStarting, setBatchStarting] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [nodePayload, setNodePayload] = useState<PipelineBookNodesResponse | null>(null);
  const [nodeLoading, setNodeLoading] = useState(false);
  const [nodeError, setNodeError] = useState('');
  const [nodeDialogOpen, setNodeDialogOpen] = useState(false);
  const [nodeBookTitle, setNodeBookTitle] = useState('');
  const [enrichItem, setEnrichItem] = useState<QueueBook | null>(null);

  const refreshBooks = async () => {
    try {
      setDatabaseBooks((await loadPgAdminBooks(sourceKey)).books);
    } catch {
      setDatabaseBooks([]);
    }
  };

  useEffect(() => {
    enrichBooksPromiseRef.current = null;
  }, [sourceKey]);

  useEffect(() => {
    void refreshBooks();
  }, [sourceKey, jobs.map((job) => `${job.job_id}:${job.status}:${job.updated_at}`).join('|')]);

  useEffect(() => {
    setQueue([]);
    window.localStorage.removeItem(`okm.pipeline.batch-books.v2:${sourceKey}`);
  }, [sourceKey]);

  useEffect(() => {
    setQueue((current) => reconcileTerminalBatchQueue(current, jobs));
  }, [jobs]);

  const updateQueue = (id: string, changes: Partial<QueueBook>) => {
    setQueue((current) => current.map((item) => item.id === id ? { ...item, ...changes } : item));
  };

  const loadSuggestionBooks = async (): Promise<EnrichBookSummary[]> => {
    if (!enrichBooksPromiseRef.current) {
      enrichBooksPromiseRef.current = loadEnrichBooks(sourceKey)
        .then((payload) => payload.books)
        .catch((loadError) => {
          enrichBooksPromiseRef.current = null;
          throw loadError;
        });
    }
    return enrichBooksPromiseRef.current;
  };

  const suggestEnrichBooks = async (items: QueueBook[]): Promise<number> => {
    const pending = items.filter((item) => item.enrichContext === undefined && !item.enrichBookPath);
    if (pending.length === 0) return 0;
    try {
      const books = await loadSuggestionBooks();
      const suggestions = new Map<string, EnrichBookSummary>();
      pending.forEach((item) => {
        const suggestion = topEnrichBook(books, item.title || item.fileName);
        if (suggestion) suggestions.set(item.id, suggestion);
      });
      if (suggestions.size > 0) {
        setQueue((current) => current.map((item) => {
          const suggestion = suggestions.get(item.id);
          if (!suggestion || item.enrichContext !== undefined || item.enrichBookPath) return item;
          return {
            ...item,
            enrichBookPath: suggestion.path,
            enrichBookTitle: suggestion.title,
            enrichConfirmedByUser: false,
          };
        }));
      }
      return suggestions.size;
    } catch {
      return 0;
    }
  };

  const inferQueueBook = async (item: QueueBook) => {
    try {
      const metadata = await inferTextbookMetadata(sourceKey, item.sourceKind === 'ocr'
        ? {
            pdf_path: item.pdfPath || undefined,
            ocr_folder_path: item.ocrFolderPath,
            source_fingerprint: item.sourceFingerprint,
          }
        : { pdf_path: item.pdfPath, source_fingerprint: item.sourceFingerprint });
      const inferredItem: QueueBook = {
        ...item,
        bookId: metadata.book_id,
        title: metadata.title,
      };
      updateQueue(item.id, {
        bookId: inferredItem.bookId,
        title: inferredItem.title,
        ...(metadata.enrich_book_path && item.enrichContext === undefined ? {
          enrichContext: undefined,
          enrichBookPath: metadata.enrich_book_path,
          enrichBookTitle: metadata.enrich_book_title || metadata.enrich_book_path,
          enrichConfirmedByUser: false,
        } : {}),
      });
      if (!metadata.enrich_book_path && item.enrichContext === undefined) await suggestEnrichBooks([inferredItem]);
    } catch {
      // Filename-derived identifiers remain usable when metadata inference is unavailable.
    }
  };

  const inferQueueBooks = async (items: QueueBook[]) => {
    for (let index = 0; index < items.length; index += 4) {
      await Promise.all(items.slice(index, index + 4).map(inferQueueBook));
    }
  };

  useEffect(() => {
    if (reinferredSourceKeyRef.current === sourceKey) return;
    reinferredSourceKeyRef.current = sourceKey;
    const restoredItems = queue.filter((item) => item.selected && (item.pdfPath || item.ocrFolderPath));
    if (restoredItems.length > 0) void inferQueueBooks(restoredItems);
    const itemsWithoutSuggestion = queue.filter((item) => item.enrichContext === undefined && !item.enrichBookPath);
    if (itemsWithoutSuggestion.length > 0) void suggestEnrichBooks(itemsWithoutSuggestion);
  }, [sourceKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const replaceScannedFiles = (files: PipelineFolderPdf[]): QueueBook[] => {
    const next = files.map<QueueBook>((file) => ({
      id: file.pdf_path,
      queueOrigin: 'scan',
      pdfPath: file.pdf_path,
      ocrFolderPath: file.ocr_folder_path || '',
      ocrImportMode: file.ocr_folder_path ? 'in_place' : undefined,
      sourceKind: file.ocr_folder_path ? 'ocr' : 'pdf',
      fileName: file.file_name,
      sourceFolder: sourceFolderFromPath(file.relative_path, true),
      sizeBytes: file.size_bytes,
      sourceFingerprint: file.source_fingerprint,
      bookId: file.file_name.replace(/\.pdf$/i, ''),
      title: file.file_name.replace(/\.pdf$/i, ''),
      selected: false,
      status: 'ready',
      progress: 100,
      error: '',
    }));
    setQueue((current) => reconcileScannedQueueSnapshot(current, next));
    return next;
  };

  const uploadFiles = async (selectedFiles: File[]) => {
    const files = selectedFiles.filter((file) => file.name.toLowerCase().endsWith('.pdf'));
    if (files.length === 0) {
      setError('所选内容中没有 PDF 文件。');
      return;
    }
    setError('');
    setNotice(`正在上传 ${files.length} 个 PDF…`);
    const pending = files.map<QueueBook>((file) => ({
      id: `upload:${file.name}:${file.size}:${file.lastModified}:${crypto.randomUUID()}`,
      queueOrigin: 'upload',
      pdfPath: '',
      ocrFolderPath: '',
      sourceKind: 'pdf',
      fileName: file.name,
      sourceFolder: '手动上传',
      sizeBytes: file.size,
      bookId: file.name.replace(/\.pdf$/i, ''),
      title: file.name.replace(/\.pdf$/i, ''),
      selected: true,
      status: 'uploading',
      progress: 0,
      error: '',
    }));
    setQueue((current) => [...current, ...pending]);
    let successCount = 0;
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]!;
      const item = pending[index]!;
      if (file.size > 512 * 1024 * 1024) {
        updateQueue(item.id, { status: 'error', error: 'PDF 不能超过 512 MB。' });
        continue;
      }
      try {
        const uploaded = await uploadPipelinePdf(sourceKey, file, (progress) => updateQueue(item.id, { progress }));
        const ready = {
          status: 'ready' as const,
          progress: 100,
          pdfPath: uploaded.pdf_path,
          sourceFingerprint: uploaded.source_fingerprint,
        };
        updateQueue(item.id, ready);
        successCount += 1;
        await inferQueueBook({ ...item, ...ready });
      } catch (uploadError) {
        updateQueue(item.id, { status: 'error', error: (uploadError as Error).message || 'PDF 上传失败' });
      }
    }
    setNotice(`已加入 ${successCount}/${files.length} 本教材。`);
  };

  const handleFiles = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    void uploadFiles(files);
  };

  const scanFolder = async () => {
    if (!folderPath.trim()) return;
    setScanning(true);
    setError('');
    setNotice('');
    try {
      const result = await scanPipelineFolder(sourceKey, {
        folder_path: folderPath.trim(),
        ...(pairedOcrFolderPath.trim() ? { ocr_folder_path: pairedOcrFolderPath.trim() } : {}),
        recursive: true,
      });
      const refreshed = replaceScannedFiles(result.files);
      if (refreshed.length > 0) void suggestEnrichBooks(refreshed);
      setFolderPath(result.folder_path);
      setNotice(
        `扫描到 ${result.files.length} 本教材：${result.matched_ocr_count} 本已 OCR，${result.unmatched_ocr_count} 本未 OCR；`
        + '列表已按本次硬盘扫描结果刷新，系统会自动绑定 Enrich 检索第一名供人工确认。',
      );
    } catch (scanError) {
      setError((scanError as Error).message || '读取目录失败');
    } finally {
      setScanning(false);
    }
  };

  const addOcrFolder = async () => {
    const requestedPath = ocrFolderPath.trim();
    if (!requestedPath) return;
    setInspectingOcr(true);
    setError('');
    setNotice('正在校验 OCR 目录结构…');
    try {
      const inspection = await inspectPipelineOcrFolder(sourceKey, { folder_path: requestedPath });
      if (queue.some((item) => item.ocrFolderPath === inspection.source_root_path)) {
        setOcrFolderPath(inspection.source_root_path);
        setNotice('该 OCR 教材已经在任务队列中。');
        return;
      }
      const fallbackName = inspection.source_root_path.split(/[\\/]+/).filter(Boolean).at(-1)
        || '已完成 OCR 教材';
      const item: QueueBook = {
        id: `ocr:${inspection.source_root_path}`,
        queueOrigin: 'manual_ocr',
        pdfPath: '',
        ocrFolderPath: inspection.source_root_path,
        ocrImportMode: 'in_place',
        sourceKind: 'ocr',
        fileName: fallbackName,
        sourceFolder: '单独加入的 OCR',
        sizeBytes: 0,
        sourceFingerprint: inspection.source_fingerprint,
        bookId: fallbackName,
        title: fallbackName,
        selected: true,
        status: 'ready',
        progress: 100,
        error: '',
        ocrInspection: {
          quality: inspection.quality,
          page_count: inspection.page_count,
          block_count: inspection.block_count,
          image_count: inspection.image_count,
        },
      };
      setQueue((current) => [...current, item]);
      setOcrFolderPath(inspection.source_root_path);
      await inferQueueBook(item);
      const qualityLabel = inspection.quality === 'complete' ? '完整组合输入' : '结构化输入';
      setNotice(`OCR 校验通过：${inspection.page_count ?? '未知'} 页、${inspection.block_count ?? '未知'} 块、${inspection.image_count} 张图片 · ${qualityLabel}。`);
    } catch (inspectError) {
      setNotice('');
      setError((inspectError as Error).message || 'OCR 目录校验失败');
    } finally {
      setInspectingOcr(false);
    }
  };

  const rows = useMemo(
    () => buildPipelineBookWorkbenchRows(queue, databaseBooks, jobs),
    [databaseBooks, jobs, queue],
  );

  const folderHierarchy = useMemo(() => {
    const hierarchy = new Map<string, { count: number; subfolders: Map<string, number> }>();
    queue.forEach((item) => {
      const { subject, subfolder } = sourceFolderLevels(item.sourceFolder);
      const entry = hierarchy.get(subject) ?? { count: 0, subfolders: new Map<string, number>() };
      entry.count += 1;
      if (subfolder) entry.subfolders.set(subfolder, (entry.subfolders.get(subfolder) ?? 0) + 1);
      hierarchy.set(subject, entry);
    });
    return hierarchy;
  }, [queue]);

  const subjectOptions = useMemo(() => [...folderHierarchy.entries()]
    .map(([value, entry]) => ({ value, count: entry.count }))
    .sort((left, right) => left.value.localeCompare(right.value, 'zh-CN', { numeric: true })), [folderHierarchy]);

  const subfolderOptions = useMemo(() => [...(folderHierarchy.get(subjectFilter)?.subfolders.entries() ?? [])]
    .map(([value, count]) => ({ value, count }))
    .sort((left, right) => left.value.localeCompare(right.value, 'zh-CN', { numeric: true })), [folderHierarchy, subjectFilter]);

  const folderByRowKey = useMemo(
    () => new Map(queue.map((item) => [item.id, item.sourceFolder])),
    [queue],
  );

  const visibleRows = useMemo(() => {
    const query = bookFilter.trim().toLocaleLowerCase();
    return rows.filter((row) => {
      const sourceFolder = folderByRowKey.get(row.key) ?? '';
      const { subject, subfolder } = sourceFolderLevels(sourceFolder);
      const matchesQuery = !query || [row.title, row.bookId, row.pdfPath, row.ocrFolderPath, sourceFolder]
        .some((value) => value.toLocaleLowerCase().includes(query));
      const matchesSubject = subjectFilter === 'all' || subject === subjectFilter;
      const matchesSubfolder = subfolderFilter === 'all' || subfolder === subfolderFilter;
      const matchesOcr = ocrFilter === 'all'
        || (ocrFilter === 'ready' ? row.sourceKind === 'ocr' : row.sourceKind === 'pdf' && Boolean(row.pdfPath));
      return matchesQuery && matchesSubject && matchesSubfolder && matchesOcr;
    });
  }, [bookFilter, folderByRowKey, ocrFilter, rows, subjectFilter, subfolderFilter]);

  const queueOcrCount = queue.filter((item) => Boolean(item.ocrFolderPath)).length;
  const queueMissingOcrCount = queue.filter((item) => Boolean(item.pdfPath) && !item.ocrFolderPath).length;

  const selectedReady = useMemo(() => selectBatchLaunchCandidates(queue, jobs), [jobs, queue]);

  const startSelected = async () => {
    if (selectedReady.length === 0) return;
    setBatchStarting(true);
    setError('');
    setNotice(`正在为 ${selectedReady.length} 本教材生成目录切分…`);
    let started = 0;
    for (const item of selectedReady) {
      updateQueue(item.id, { status: 'starting', error: '' });
      try {
        const result = await onStartBook({
          bookId: item.bookId,
          title: item.title,
          pdfPath: item.pdfPath || undefined,
          ocrFolderPath: item.ocrFolderPath || undefined,
          ocrImportMode: item.ocrImportMode,
          enrichContext: item.enrichContext!,
          enrichBookPath: item.enrichBookPath || undefined,
        });
        updateQueue(item.id, { status: 'started', jobId: result.job_id });
        started += 1;
      } catch (startError) {
        updateQueue(item.id, { status: 'error', error: (startError as Error).message || '启动失败' });
      }
    }
    setBatchStarting(false);
    setNotice(`已启动 ${started}/${selectedReady.length} 本教材的切分准备任务。`);
    onRefreshJobs();
  };

  const showNodes = async (bookId: string, bookTitle: string) => {
    setNodeDialogOpen(true);
    setNodeBookTitle(bookTitle);
    setNodeLoading(true);
    setNodeError('');
    setNodePayload(null);
    try {
      setNodePayload(await loadPipelineBookNodes(sourceKey, bookId));
    } catch (nodesError) {
      setNodeError((nodesError as Error).message || '读取教材节点失败');
    } finally {
      setNodeLoading(false);
    }
  };

  const updateSelected = (row: WorkbenchRow, selected: boolean) => {
    setQueue((current) => current.map((item) => item.id === row.key ? { ...item, selected } : item));
    const item = queue.find((candidate) => candidate.id === row.key);
    if (selected && item && item.enrichContext === undefined) void inferQueueBook(item);
  };

  const selectVisibleRows = (selected: boolean) => {
    const visibleKeys = new Set(visibleRows
      .filter((row) => (row.pdfPath || row.ocrFolderPath) && row.queueStatus !== 'uploading' && row.queueStatus !== 'starting' && row.job?.status !== 'running')
      .map((row) => row.key));
    setQueue((current) => current.map((item) => visibleKeys.has(item.id) ? { ...item, selected } : item));
  };

  const confirmEnrich = (selection: { enrichContext: boolean; enrichBookPath?: string; enrichBookTitle?: string }) => {
    if (!enrichItem) return;
    updateQueue(enrichItem.id, {
      enrichContext: selection.enrichContext,
      enrichBookPath: selection.enrichBookPath || '',
      enrichBookTitle: selection.enrichBookTitle || '',
      enrichConfirmedByUser: true,
      error: '',
    });
    setNotice(selection.enrichContext
      ? `已为《${enrichItem.title}》锁定 Enrich 目录：${selection.enrichBookTitle}。`
      : `已确认《${enrichItem.title}》本次不使用 Enrich。`);
    setEnrichItem(null);
  };

  const confirmSuggestedEnrich = (item: QueueBook) => {
    if (!item.enrichBookPath) return;
    updateQueue(item.id, {
      enrichContext: true,
      enrichConfirmedByUser: true,
      error: '',
    });
    setNotice(`已确认《${item.title}》使用 Enrich 建议：${item.enrichBookTitle || item.enrichBookPath}。`);
  };

  return (
    <section className="mb-5 overflow-hidden rounded-xl border border-border-default bg-elevated shadow-panel">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border-subtle px-4 py-4 sm:px-5">
        <h2 className="flex items-center gap-2 text-base font-semibold text-text-primary"><ListChecks className="h-5 w-5 text-accent" />教材抽取工作台</h2>
        <button type="button" onClick={() => void startSelected()} disabled={batchStarting || selectedReady.length === 0} className="flex h-10 cursor-pointer items-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-white transition-colors hover:bg-accent-dim focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:bg-surface disabled:text-text-muted">
          {batchStarting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          生成已选 {selectedReady.length} 本切分
        </button>
      </div>

      <div className="grid grid-cols-2 gap-y-2 border-b border-border-subtle bg-surface/40 px-4 py-3 text-xs sm:grid-cols-5 sm:px-5 sm:text-sm">
        {['1  添加教材来源', '2  自动匹配 Enrich', '3  自动生成切分', '4  人工确认边界', '5  启动模型抽取'].map((label, index) => (
          <div key={label} className={`flex items-center gap-2 ${index === 0 ? 'font-medium text-accent' : 'text-text-muted'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${index === 0 ? 'bg-accent' : 'bg-border-strong'}`} />{label}
          </div>
        ))}
      </div>

      <div className="grid gap-3 border-b border-border-subtle p-4 xl:grid-cols-2 sm:p-5">
        <section className="rounded-lg border border-border-default bg-surface p-4" aria-labelledby="pdf-source-title">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent"><FileText className="h-5 w-5" /></span>
              <h3 id="pdf-source-title" className="text-base font-semibold text-text-primary">教材根目录</h3>
            </div>
            <span className="rounded-full border border-border-default bg-elevated px-2.5 py-1 text-xs text-text-secondary">自动识别 OCR</span>
          </div>
          <input ref={fileInputRef} type="file" accept=".pdf,application/pdf" multiple onChange={handleFiles} className="sr-only" aria-label="批量选择 PDF 文件" />
          <input ref={folderInputRef} type="file" accept=".pdf,application/pdf" multiple onChange={handleFiles} className="sr-only" aria-label="选择本地 PDF 文件夹" />
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            <button type="button" onClick={() => fileInputRef.current?.click()} className="flex min-h-12 cursor-pointer items-center gap-2.5 rounded-md border border-dashed border-accent/50 bg-accent/5 px-3 text-left text-sm font-semibold text-text-primary transition-colors hover:border-accent hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
              <Upload className="h-5 w-5 shrink-0 text-accent" />批量选择 PDF
            </button>
            <button type="button" onClick={() => { folderInputRef.current?.setAttribute('webkitdirectory', ''); folderInputRef.current?.click(); }} className="flex min-h-12 cursor-pointer items-center gap-2.5 rounded-md border border-dashed border-border-default bg-elevated px-3 text-left text-sm font-semibold text-text-primary transition-colors hover:border-accent hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
              <FolderOpen className="h-5 w-5 shrink-0 text-accent" />选择 PDF 文件夹
            </button>
          </div>
          <label htmlFor="pipeline-folder-path" className="mt-4 block text-sm font-medium text-text-secondary">服务端根目录（自动扫描 PDF 与 OCR）</label>
          <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
            <input id="pipeline-folder-path" value={folderPath} onChange={(event) => setFolderPath(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void scanFolder(); }} placeholder="/srv/innospark-disks/disk06/05_enrich书名对齐" className="h-10 min-w-0 flex-1 rounded-md border border-border-default bg-elevated px-3 font-mono text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent" />
            <button type="button" onClick={() => void scanFolder()} disabled={scanning || !folderPath.trim()} className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md border border-border-default bg-elevated px-3.5 text-sm font-medium text-text-secondary transition-colors hover:bg-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50">
              {scanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}扫描书籍
            </button>
          </div>
          <details className="mt-3 text-xs text-text-muted">
            <summary className="cursor-pointer select-none font-medium text-text-secondary">OCR 目录覆盖（通常无需填写）</summary>
            <label htmlFor="pipeline-paired-ocr-folder-path" className="mt-2 block">填写后只在该 OCR 根目录中匹配；留空会自动发现根目录内及相邻的 *_mineru_*_ocr。</label>
            <input id="pipeline-paired-ocr-folder-path" value={pairedOcrFolderPath} onChange={(event) => setPairedOcrFolderPath(event.target.value)} placeholder="/srv/.../数学_mineru_hybrid_high_ocr" className="mt-1.5 h-10 w-full rounded-md border border-border-default bg-elevated px-3 font-mono text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent" />
          </details>
        </section>

        <section className="order-first rounded-lg border border-accent/40 bg-accent/5 p-4 xl:order-none" aria-labelledby="ocr-source-title">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-accent/15 text-accent"><FolderOpen className="h-5 w-5" /></span>
              <h3 id="ocr-source-title" className="text-base font-semibold text-text-primary">已完成 OCR</h3>
            </div>
            <span className="rounded-full border border-node-process/40 bg-node-process/10 px-2.5 py-1 text-xs text-node-process">无需再次 OCR</span>
          </div>
          <label htmlFor="pipeline-ocr-folder-path" className="mt-4 block text-sm font-medium text-text-secondary">服务端 OCR 文件夹路径</label>
          <div className="mt-1.5 flex flex-col gap-2 sm:flex-row">
            <input id="pipeline-ocr-folder-path" value={ocrFolderPath} onChange={(event) => setOcrFolderPath(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void addOcrFolder(); }} placeholder="/Users/.../初中_七年级_数学_人教版_上册" className="h-10 min-w-0 flex-1 rounded-md border border-accent/40 bg-elevated px-3 font-mono text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent" />
            <button type="button" onClick={() => void addOcrFolder()} disabled={inspectingOcr || !ocrFolderPath.trim()} className="flex h-10 cursor-pointer items-center justify-center gap-2 rounded-md bg-accent px-3.5 text-sm font-semibold text-white transition-colors hover:bg-accent-dim focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:bg-surface disabled:text-text-muted">
              {inspectingOcr ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}校验并加入
            </button>
          </div>
        </section>
      </div>

      {(notice || error) && (
        <div role={error ? 'alert' : 'status'} aria-live="polite" className={`mx-4 mt-3 flex items-start gap-2 rounded-md border px-3 py-2 text-xs sm:mx-5 ${error ? 'border-node-event/40 bg-node-event/10 text-node-event' : 'border-node-process/30 bg-node-process/10 text-text-secondary'}`}>
          {error ? <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-node-process" />}{error || notice}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 sm:px-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1"><h3 className="text-base font-semibold text-text-primary">书籍选择列表</h3><span className="text-sm text-text-secondary">{queue.length} 本已扫描 · <span className="text-node-process">{queueOcrCount} 本已 OCR</span> · <span className="text-node-event">{queueMissingOcrCount} 本未 OCR</span> · {queue.filter((item) => item.selected).length} 本已选</span></div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => selectVisibleRows(true)} className="cursor-pointer text-sm font-medium text-accent transition-colors hover:text-accent-dim">全选当前列表</button>
          <span className="text-border-strong">/</span>
          <button type="button" onClick={() => selectVisibleRows(false)} className="cursor-pointer text-sm font-medium text-text-secondary transition-colors hover:text-text-primary">取消当前列表</button>
        </div>
      </div>

      <div className="flex flex-col gap-2 border-t border-border-subtle bg-surface/30 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-muted" />
          <input value={bookFilter} onChange={(event) => setBookFilter(event.target.value)} placeholder="按书名、book ID 或路径筛选" aria-label="筛选教材列表" className="h-9 w-full rounded-md border border-border-default bg-elevated pl-9 pr-3 text-sm text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent" />
        </div>
        <label htmlFor="pipeline-subject-filter" className="sr-only">按学科筛选教材</label>
        <select id="pipeline-subject-filter" value={subjectFilter} onChange={(event) => { setSubjectFilter(event.target.value); setSubfolderFilter('all'); }} className="h-9 w-full cursor-pointer rounded-md border border-border-default bg-elevated px-3 text-sm font-medium text-text-secondary outline-none transition-colors hover:border-border-strong focus:border-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent sm:w-44" aria-label="按学科筛选教材">
          <option value="all">全部学科（{queue.length}）</option>
          {subjectOptions.map((subject) => <option key={subject.value} value={subject.value}>{subject.value}（{subject.count}）</option>)}
        </select>
        <label htmlFor="pipeline-subfolder-filter" className="sr-only">按学段或子文件夹筛选教材</label>
        <select id="pipeline-subfolder-filter" value={subfolderFilter} onChange={(event) => setSubfolderFilter(event.target.value)} disabled={subjectFilter === 'all' || subfolderOptions.length === 0} className="h-9 w-full cursor-pointer rounded-md border border-border-default bg-elevated px-3 text-sm text-text-secondary outline-none transition-colors hover:border-border-strong focus:border-accent focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50 sm:w-52" aria-label="按学段或子文件夹筛选教材">
          <option value="all">{subjectFilter === 'all' ? '先选学科' : `全部学段 / 目录（${folderHierarchy.get(subjectFilter)?.count ?? 0}）`}</option>
          {subfolderOptions.map((folder) => <option key={folder.value} value={folder.value}>{folder.value}（{folder.count}）</option>)}
        </select>
        <div className="flex gap-1 rounded-md border border-border-default bg-elevated p-1" aria-label="OCR 状态筛选">
          {([['all', `全部 ${rows.length}`], ['ready', `已 OCR ${queueOcrCount}`], ['missing', `未 OCR ${queueMissingOcrCount}`]] as const).map(([value, label]) => (
            <button key={value} type="button" onClick={() => setOcrFilter(value)} aria-pressed={ocrFilter === value} className={`cursor-pointer rounded px-3 py-1 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-accent ${ocrFilter === value ? 'bg-accent text-white' : 'text-text-secondary hover:bg-hover hover:text-text-primary'}`}>{label}</button>
          ))}
        </div>
        <span className="shrink-0 text-xs text-text-muted">当前显示 {visibleRows.length} 本</span>
      </div>

      <div className="max-h-[480px] overflow-auto border-t border-border-subtle scrollbar-thin">
        <table className="w-full min-w-[1380px] text-left text-sm">
          <thead className="sticky top-0 z-10 bg-elevated text-text-muted">
            <tr>
              <th className="w-20 px-4 py-2.5 font-semibold">是否抽取</th>
              <th className="px-3 py-2.5 font-semibold">来源</th>
              <th className="px-3 py-2.5 font-semibold">教材</th>
              <th className="px-3 py-2.5 font-semibold">来源路径与质量</th>
              <th className="px-3 py-2.5 font-semibold">Enrich 目录</th>
              <th className="px-3 py-2.5 font-semibold">抽取状态</th>
              <th className="px-3 py-2.5 font-semibold">节点结果</th>
              <th className="px-3 py-2.5 font-semibold">操作</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((row) => {
              const queueItem = queue.find((item) => item.id === row.key);
              const canSelect = Boolean((row.pdfPath || row.ocrFolderPath) && row.queueStatus !== 'uploading' && row.queueStatus !== 'starting' && row.job?.status !== 'running');
              const sourcePath = row.ocrFolderPath || row.pdfPath;
              return (
                <tr key={row.key} className="border-t border-border-subtle transition-colors hover:bg-hover/60">
                  <td className="px-4 py-3">
                    <label className={`inline-flex items-center gap-2 ${canSelect ? 'cursor-pointer' : 'cursor-not-allowed opacity-55'}`}>
                      <input type="checkbox" checked={row.selected} disabled={!canSelect} onChange={(event) => updateSelected(row, event.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" aria-label={`${row.title} 是否参与抽取`} />
                      <span className="text-sm text-text-secondary">{row.selected ? '是' : '否'}</span>
                    </label>
                  </td>
                  <td className="px-3 py-3">
                    {row.sourceKind ? (
                      <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${row.sourceKind === 'ocr' ? 'border-node-process/40 bg-node-process/10 text-node-process' : 'border-node-event/40 bg-node-event/10 text-node-event'}`}>
                        {row.sourceKind === 'ocr' ? <FolderOpen className="h-3 w-3" /> : <FileText className="h-3 w-3" />}{row.sourceKind === 'ocr' ? '已 OCR' : '未 OCR'}
                      </span>
                    ) : <span className="text-xs text-text-muted">数据库</span>}
                  </td>
                  <td className="max-w-[260px] px-3 py-3">
                    <div className="truncate font-medium text-text-primary" title={row.title}>{row.title}</div>
                  </td>
                  <td className="max-w-[390px] px-3 py-3">
                    {row.pdfPath && <div className="truncate text-text-secondary" title={row.pdfPath}>PDF：{row.pdfPath}</div>}
                    {row.ocrFolderPath && <div className="mt-1 truncate text-node-process" title={row.ocrFolderPath}>OCR：{row.ocrFolderPath}</div>}
                    {!sourcePath && <div className="text-text-secondary">数据库已有记录</div>}
                    {row.sourceKind === 'ocr' && row.ocrImportMode === 'in_place' && (
                      <div className="mt-1 text-[10px] font-medium text-node-process">使用原目录 · 不复制教材文件</div>
                    )}
                    <div className="mt-1.5 text-xs text-text-muted">
                      {row.sourceKind === 'ocr' && queueItem?.ocrInspection
                        ? `${queueItem.ocrInspection.page_count ?? '未知'} 页 · ${queueItem.ocrInspection.block_count ?? '未知'} 块 · ${queueItem.ocrInspection.image_count} 图 · ${queueItem.ocrInspection.quality === 'complete' ? '完整组合' : '结构化'}`
                        : fileSizeText(row.sizeBytes)}
                    </div>
                  </td>
                  <td className="max-w-[300px] px-3 py-3">
                    {queueItem ? (
                      <div>
                        {queueItem.enrichContext === undefined && queueItem.enrichBookPath ? (
                          <div title={queueItem.enrichBookTitle || queueItem.enrichBookPath}>
                            <div className="text-[10px] font-semibold text-node-event">检索第一名 · 待确认</div>
                            <div className="mt-0.5 truncate text-sm font-medium text-text-primary">{queueItem.enrichBookTitle || queueItem.enrichBookPath}</div>
                          </div>
                        ) : (
                          <div className={`truncate text-sm font-medium ${queueItem.enrichContext === undefined ? 'text-node-event' : queueItem.enrichContext ? 'text-text-primary' : 'text-text-secondary'}`} title={queueItem.enrichBookTitle}>
                            {queueItem.enrichContext === undefined ? '待生成 Enrich 建议' : queueItem.enrichContext ? queueItem.enrichBookTitle : '已确认不使用 Enrich'}
                          </div>
                        )}
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {queueItem.enrichContext === undefined && queueItem.enrichBookPath && (
                            <button type="button" onClick={() => confirmSuggestedEnrich(queueItem)} disabled={row.queueStatus === 'starting' || row.job?.status === 'running'} className="inline-flex cursor-pointer items-center gap-1 rounded-md bg-accent px-2.5 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-accent-dim focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50">
                              <Check className="h-3.5 w-3.5" />确认建议
                            </button>
                          )}
                          <button type="button" onClick={() => setEnrichItem(queueItem)} disabled={row.queueStatus === 'starting' || row.job?.status === 'running'} className="cursor-pointer rounded-md border border-border-default bg-surface px-2.5 py-1.5 text-xs font-medium text-accent transition-colors hover:border-accent hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent disabled:cursor-not-allowed disabled:opacity-50">
                            {queueItem.enrichContext === undefined && !queueItem.enrichBookPath ? '检索并选择' : '修改'}
                          </button>
                        </div>
                      </div>
                    ) : <span className="text-xs text-text-muted">仅查看</span>}
                  </td>
                  <td className="px-3 py-3"><StatusBadge row={row} /></td>
                  <td className="px-3 py-3">
                    <div className="font-semibold tabular-nums text-text-primary">{row.database?.canonical_nodes ?? 0} 个</div>
                    {(row.database?.shared_nodes ?? 0) > 0 && <div className="mt-1 text-xs text-text-muted">{row.database!.shared_nodes} 个复用/匹配</div>}
                  </td>
                  <td className="px-3 py-3">
                    <button type="button" onClick={() => void showNodes(row.bookId, row.title)} disabled={!row.bookId} className="flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-border-default bg-surface px-3 text-sm font-medium text-text-secondary transition-colors hover:border-accent hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50">
                      <ExternalLink className="h-3.5 w-3.5" />查看节点
                    </button>
                  </td>
                </tr>
              );
            })}
            {visibleRows.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-14 text-center text-text-muted">{rows.length === 0 ? '输入根目录并扫描后，这里会列出可选教材及 OCR 状态。' : '当前筛选条件下没有教材。'}</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {nodeDialogOpen && <BookNodesDialog bookTitle={nodeBookTitle} payload={nodePayload} loading={nodeLoading} error={nodeError} onClose={() => setNodeDialogOpen(false)} />}
      {enrichItem && <EnrichOutlineDialog sourceKey={sourceKey} item={enrichItem} onClose={() => setEnrichItem(null)} onConfirm={confirmEnrich} />}
    </section>
  );
}
