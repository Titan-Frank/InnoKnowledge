import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import type {
  PgAdminBookSummary,
  PgAdminBooksResponse,
  PgAdminCatalogResponse,
  PgAdminColumn,
  PgAdminExportFormat,
  PgAdminRowsResponse,
  PgAdminTable,
} from '@okm/types';
import { useAppState } from '@/hooks/useAppState';
import {
  AlertCircle,
  BookOpen,
  Check,
  ChevronLeft,
  ChevronRight,
  Database,
  Download,
  Info,
  KeyRound,
  Loader2,
  Pencil,
  RefreshCw,
  Rows3,
  Save,
  Search,
  Server,
  ShieldAlert,
  Table2,
  Trash2,
  X,
} from '@/lib/lucide-icons';
import {
  deletePgAdminBook,
  deletePgAdminRow,
  exportPgAdminData,
  loadPgAdminBooks,
  loadPgAdminCatalog,
  loadPgAdminRows,
  updatePgAdminRow,
} from '@/services/backend-client';
import { isCurrentPgAdminRequest } from '@/lib/pg-admin-requests';
import { parsePgAdminEditorValue } from '@/lib/pg-admin-values';

type AdminView = 'books' | 'tables';
type DialogTarget = { kind: 'book'; book: PgAdminBookSummary } | { kind: 'row'; row: Record<string, unknown> } | null;

const GROUP_LABELS: Record<PgAdminTable['group'], string> = {
  catalog: '数据目录',
  canonical: '正式知识数据',
  evidence: '证据与内容',
  pipeline: '处理任务',
  staging: '临时处理结果',
  runtime: '检索与生成',
};

const GROUP_ORDER: PgAdminTable['group'][] = ['catalog', 'canonical', 'evidence', 'pipeline', 'staging', 'runtime'];
const PAGE_SIZE = 50;

const TABLE_DESCRIPTIONS: Record<string, string> = {
  world_datasets: '数据集本身的名称、架构版本、启用状态、根目录和更新时间等元数据。按教材导出时仍会保留当前数据集这一行。',
  world_source_artifacts: '已登记的教材源文件与产物，包括 source_id、book_id、标题、文件路径、目录路径和扩展属性。',
  world_textbook_outlines: '教材目录及切分结构，包括书名、章节树、课时与分块数量、来源路径和更新时间。',
  world_enrich_library: '参考教材目录库的整体统计与生成信息，属于数据集共享配置；按教材导出时仍会完整保留。',
  world_enrich_books: '参考教材库中的书目、学科、学段、年级、出版社和目录树；它们是抽取辅助资料，不等同于本次处理教材。',
  world_mineru_sources: '教材的 MinerU/OCR 处理状态及 Markdown、PDF、压缩包和解压目录等来源路径。',
  world_nodes: '归并后的正式知识点，包含名称、类型、定义、别名、领域、标签、状态及扩展属性。',
  world_node_terms: '从正式知识点生成的规范名、别名和标签检索词，用于关键词搜索和去重匹配。',
  world_edges: '正式知识点之间的关系边，包含关系类型、起止节点、方向、置信度、来源引用和状态。',
  world_taxonomy_terms: '领域、知识形态、学习方式、学段等共享分类词表；按教材导出时仍会完整保留。',
  world_taxonomy_edges: '共享分类词之间的上下位或关联关系；按教材导出时仍会完整保留。',
  world_domain_profiles: '知识点在特定学科中的教学画像，包括适用学段、课程角色、属性和来源引用。',
  world_mentions: '教材原文对知识点、关系或领域画像的提及位置、角色、锚点和识别置信度。',
  world_evidence: '可追溯的教材证据片段，包括原文摘录、页码、定位信息、模态和抽取方式。',
  world_evidence_links: '证据与关系、画像、提及、知识卡片及卡片章节之间的关联记录。',
  world_node_cards: '知识点的精简知识卡片，包含标题、摘要、定义、要点、例子、应用和误区等结构化章节。',
  world_node_bodies: '知识点的扩展 Markdown 正文、媒体引用、生成来源和状态，供阅读与内容生成使用。',
  world_unit_embeddings: '知识单元的向量、检索文本、内容哈希、向量模型和生成时间，用于语义检索。',
  retrieval_candidates: '检索过程产生的候选知识点、排名、得分、检索方式和过滤条件，主要用于调试与评估。',
  world_lesson_runs: '每个教材课时的抽取批次、状态、数量统计和处理属性，是教材与暂存/正式数据之间的主链路。',
  world_pipeline_jobs: '整本教材处理任务的状态、当前阶段、进度、命令、上下文、日志路径和错误信息。',
  world_pipeline_job_stages: '教材处理任务中每个阶段的顺序、状态、进度、开始/完成时间和错误。',
  world_pipeline_job_events: '处理任务的事件流水，记录阶段变化、工作槽、课时、明细和结构化事件数据。',
  world_pipeline_worker_states: '并行工作槽的当前状态、正在处理的课时、阶段、时间和错误信息。',
  world_staging_nodes: '课时抽取后、正式归并前的临时知识点，包含原始 ID、定义、分类、置信信息和来源引用。',
  world_staging_edges: '课时抽取后、正式归并前的临时关系边及其原始起止节点、类型、方向和置信度。',
  world_staging_domain_profiles: '课时抽取阶段生成的临时学科教学画像，尚未写入正式知识数据。',
  world_staging_mentions: '课时抽取阶段生成的临时原文提及及其目标、角色、锚点和置信度。',
  world_staging_evidence: '课时抽取阶段生成的临时证据摘录、页码、定位信息和规范化主张。',
  world_staging_node_cards: '课时抽取阶段生成的临时知识卡片和结构化章节，等待归并与质量检查。',
  world_merge_runs: '归并器每次运行选择了哪些课时、执行状态和统计结果；指定教材时包含涉及其课时的归并记录。',
  world_canonical_node_map: '临时知识点到正式知识点的映射、处理方式、相似度和判定依据。',
};

function InfoTooltip({ label, text }: { label: string; text: string }) {
  const id = `pg-info-${label.replace(/[^a-z0-9_-]/gi, '-')}`;
  return (
    <span className="group/info relative inline-flex shrink-0">
      <button
        type="button"
        aria-label={`查看 ${label} 的中文说明`}
        aria-describedby={id}
        onClick={(event) => event.stopPropagation()}
        className="flex h-6 w-6 cursor-help items-center justify-center rounded-md text-text-muted transition-colors hover:bg-accent/10 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <Info className="h-3.5 w-3.5" />
      </button>
      <span id={id} role="tooltip" className="pointer-events-none absolute bottom-full right-0 z-30 mb-2 hidden w-72 rounded-lg border border-border-default bg-elevated px-3 py-2.5 text-left text-[11px] font-normal leading-5 tracking-normal text-text-secondary shadow-panel group-hover/info:block group-focus-within/info:block">
        <span className="mb-1 block font-mono text-[10px] font-semibold text-text-primary">{label}</span>
        {text}
      </span>
    </span>
  );
}

function primaryKeyFor(table: PgAdminTable, row: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(table.primary_key.map((column) => [column, row[column]]));
}

function rowIdentity(table: PgAdminTable, row: Record<string, unknown>): string {
  return table.primary_key.map((column) => String(row[column] ?? '')).join(' / ');
}

function rowDeleteText(table: PgAdminTable, row: Record<string, unknown>): string {
  return `DELETE ${table.name} ${rowIdentity(table, row)}`;
}

function displayValue(value: unknown, column?: PgAdminColumn): string {
  if (value === null || value === undefined) return '—';
  if (column?.udt_name === 'vector') return '[vector]';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function editorValue(value: unknown, column: PgAdminColumn): string {
  if (value === null || value === undefined) return '';
  if (column.data_type === 'json' || column.data_type === 'jsonb') return JSON.stringify(value, null, 2);
  return String(value);
}

function formatTime(value: string | null): string {
  if (!value) return '暂无时间';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false });
}

function Metric({ label, value, icon }: { label: string; value: number | string; icon: ReactNode }) {
  return (
    <div className="rounded-lg border border-border-subtle bg-surface px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted">
        {icon}
        {label}
      </div>
      <div className="mt-1 font-mono text-xl font-semibold text-text-primary">{value}</div>
    </div>
  );
}

function EmptyState({ icon, title, detail }: { icon: ReactNode; title: string; detail: string }) {
  return (
    <div className="flex min-h-56 flex-col items-center justify-center px-6 text-center">
      <div className="flex h-11 w-11 items-center justify-center rounded-lg border border-border-subtle bg-surface text-text-muted">{icon}</div>
      <div className="mt-3 text-sm font-medium text-text-primary">{title}</div>
      <div className="mt-1 max-w-md text-xs leading-5 text-text-muted">{detail}</div>
    </div>
  );
}

function ConfirmDialog({
  target,
  table,
  confirmation,
  setConfirmation,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  target: Exclude<DialogTarget, null>;
  table: PgAdminTable | null;
  confirmation: string;
  setConfirmation: (value: string) => void;
  busy: boolean;
  error: string;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const isBook = target.kind === 'book';
  const expected = isBook ? `DELETE BOOK ${target.book.book_id}` : table ? rowDeleteText(table, target.row) : '';
  const title = isBook ? `删除整本教材：${target.book.title}` : `删除 ${table?.name ?? ''} 记录`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-void/75 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="w-full max-w-xl overflow-hidden rounded-xl border border-node-event/45 bg-elevated shadow-panel" role="dialog" aria-modal="true" aria-labelledby="pg-delete-title">
        <div className="flex items-start justify-between border-b border-border-subtle px-5 py-4">
          <div className="flex min-w-0 gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-node-event/12 text-node-event"><ShieldAlert className="h-4.5 w-4.5" /></div>
            <div className="min-w-0">
              <h2 id="pg-delete-title" className="truncate text-sm font-semibold text-text-primary">{title}</h2>
              <p className="mt-1 text-xs leading-5 text-text-muted">
                {isBook
                  ? '将在一个事务内删除教材目录、处理记录、证据及未被其他教材复用的正式知识数据。源文件不会删除。'
                  : '这是原始表级删除，PostgreSQL 外键级联可能同时删除关联记录。'}
              </p>
            </div>
          </div>
          <button type="button" onClick={onClose} className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors hover:bg-hover hover:text-text-primary" aria-label="关闭删除确认"><X className="h-4 w-4" /></button>
        </div>

        {isBook && (
          <div className="grid grid-cols-3 gap-2 border-b border-border-subtle px-5 py-3 text-center text-[11px] sm:grid-cols-6">
            {[
              ['节点', target.book.canonical_nodes], ['边', target.book.edges], ['证据', target.book.evidence],
              ['原文提及', target.book.mentions], ['课时', target.book.lesson_runs], ['任务', target.book.pipeline_jobs],
            ].map(([label, value]) => <div key={String(label)} className="rounded-md bg-surface p-2"><div className="font-mono font-semibold text-text-primary">{value}</div><div className="mt-0.5 text-text-muted">{label}</div></div>)}
          </div>
        )}

        <div className="px-5 py-4">
          <label className="block text-xs text-text-secondary">
            输入以下文本确认
            <code className="mt-2 block select-all overflow-x-auto rounded-md border border-border-subtle bg-void px-3 py-2 font-mono text-[11px] text-node-event">{expected}</code>
            <input
              autoFocus
              value={confirmation}
              onChange={(event) => setConfirmation(event.target.value)}
              className="mt-3 h-10 w-full rounded-md border border-border-default bg-surface px-3 font-mono text-xs text-text-primary outline-none transition-colors focus:border-node-event"
              aria-label="删除确认文本"
            />
          </label>
          {error && <div className="mt-3 flex items-start gap-2 rounded-md border border-node-event/35 bg-node-event/10 p-2.5 text-xs text-node-event" role="alert"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</div>}
        </div>

        <div className="flex justify-end gap-2 border-t border-border-subtle bg-surface/50 px-5 py-3">
          <button type="button" onClick={onClose} disabled={busy} className="h-9 cursor-pointer rounded-md border border-border-subtle bg-elevated px-4 text-xs text-text-secondary transition-colors hover:bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50">取消</button>
          <button type="button" onClick={onConfirm} disabled={busy || confirmation !== expected} className="flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-node-event/45 bg-node-event/12 px-4 text-xs font-medium text-node-event transition-colors hover:bg-node-event/20 disabled:cursor-not-allowed disabled:opacity-40">
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            确认删除
          </button>
        </div>
      </div>
    </div>
  );
}

function BooksView({
  payload,
  loading,
  query,
  setQuery,
  onDelete,
}: {
  payload: PgAdminBooksResponse | null;
  loading: boolean;
  query: string;
  setQuery: (value: string) => void;
  onDelete: (book: PgAdminBookSummary) => void;
}) {
  const books = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase();
    return (payload?.books ?? []).filter((book) => !normalized || `${book.title} ${book.book_id}`.toLocaleLowerCase().includes(normalized));
  }, [payload, query]);

  return (
    <section className="min-h-0 flex-1 overflow-hidden rounded-lg border border-border-subtle bg-elevated">
      <div className="flex flex-col gap-3 border-b border-border-subtle px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">教材数据</h2>
          <p className="mt-0.5 text-[11px] text-text-muted">按教材编号汇总目录、处理记录、正式知识点与证据。</p>
        </div>
        <label className="flex h-9 w-full items-center gap-2 rounded-md border border-border-subtle bg-surface px-3 sm:w-72 focus-within:border-accent">
          <Search className="h-3.5 w-3.5 text-text-muted" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索教材名或 book_id" className="min-w-0 flex-1 bg-transparent text-xs text-text-primary outline-none placeholder:text-text-muted" />
        </label>
      </div>
      {loading ? (
        <EmptyState icon={<Loader2 className="h-5 w-5 animate-spin" />} title="正在读取教材汇总数据" detail="统计会合并课时记录、正式知识点映射和证据。" />
      ) : books.length === 0 ? (
        <EmptyState icon={<BookOpen className="h-5 w-5" />} title="没有匹配的教材" detail="当前数据集没有教材记录，或搜索条件未命中。" />
      ) : (
        <div className="h-full max-h-[calc(100vh-300px)] overflow-auto scrollbar-thin">
          <table className="w-full min-w-[1040px] text-left text-xs">
            <thead className="sticky top-0 z-10 bg-surface text-[10px] uppercase tracking-[0.1em] text-text-muted">
              <tr>
                <th className="px-4 py-2.5 font-medium">教材</th>
                <th className="px-3 py-2.5 text-right font-medium">节点</th>
                <th className="px-3 py-2.5 text-right font-medium">共享</th>
                <th className="px-3 py-2.5 text-right font-medium">边</th>
                <th className="px-3 py-2.5 text-right font-medium">证据</th>
                <th className="px-3 py-2.5 text-right font-medium">原文提及</th>
                <th className="px-3 py-2.5 text-right font-medium">课时 / 任务</th>
                <th className="px-3 py-2.5 font-medium">更新</th>
                <th className="px-4 py-2.5 text-right font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border-subtle">
              {books.map((book) => (
                <tr key={book.book_id} className="transition-colors hover:bg-hover/55">
                  <td className="max-w-sm px-4 py-3">
                    <div className="truncate font-medium text-text-primary" title={book.title}>{book.title}</div>
                    <div className="mt-1 truncate font-mono text-[10px] text-text-muted" title={book.book_id}>{book.book_id}</div>
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-text-secondary">{book.canonical_nodes}</td>
                  <td className={`px-3 py-3 text-right font-mono ${book.shared_nodes ? 'text-node-method' : 'text-text-muted'}`}>{book.shared_nodes}</td>
                  <td className="px-3 py-3 text-right font-mono text-text-secondary">{book.edges}</td>
                  <td className="px-3 py-3 text-right font-mono text-text-secondary">{book.evidence}</td>
                  <td className="px-3 py-3 text-right font-mono text-text-secondary">{book.mentions}</td>
                  <td className="px-3 py-3 text-right font-mono text-text-secondary">{book.lesson_runs} / {book.pipeline_jobs}</td>
                  <td className="whitespace-nowrap px-3 py-3 text-[11px] text-text-muted">{formatTime(book.updated_at)}</td>
                  <td className="px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => onDelete(book)}
                      disabled={!book.deletable}
                      title={book.blocker || '删除这本教材的 PostgreSQL 数据'}
                      className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-node-event/35 bg-node-event/8 px-2.5 text-[11px] text-node-event transition-colors hover:bg-node-event/15 disabled:cursor-not-allowed disabled:border-border-subtle disabled:bg-transparent disabled:text-text-muted"
                    >
                      {book.deletable ? <Trash2 className="h-3.5 w-3.5" /> : <ShieldAlert className="h-3.5 w-3.5" />}
                      {book.deletable ? '删除' : '已保护'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function TableSidebar({ catalog, activeTable, onSelect }: { catalog: PgAdminCatalogResponse; activeTable: string; onSelect: (table: string) => void }) {
  return (
    <aside className="min-h-0 w-full shrink-0 overflow-y-auto border-b border-border-subtle bg-surface/45 p-2 scrollbar-thin lg:w-64 lg:border-b-0 lg:border-r">
      {GROUP_ORDER.map((group) => {
        const tables = catalog.tables.filter((table) => table.group === group);
        if (!tables.length) return null;
        return (
          <div key={group} className="mb-3 last:mb-0">
            <div className="px-2 pb-1.5 pt-1 text-[9px] font-semibold uppercase tracking-[0.15em] text-text-muted">{GROUP_LABELS[group]}</div>
            <div className="grid grid-cols-2 gap-1 sm:grid-cols-3 lg:grid-cols-1">
              {tables.map((table) => (
                <button key={table.name} type="button" onClick={() => onSelect(table.name)} className={`flex min-w-0 cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left transition-colors ${activeTable === table.name ? 'bg-accent text-white shadow-glow-soft' : 'text-text-secondary hover:bg-hover hover:text-text-primary'}`}>
                  <Table2 className="h-3.5 w-3.5 shrink-0" />
                  <span className="min-w-0 flex-1 truncate font-mono text-[10px]">{table.name}</span>
                  <span className={`shrink-0 font-mono text-[9px] ${activeTable === table.name ? 'text-white/70' : 'text-text-muted'}`}>~{table.estimated_rows}</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </aside>
  );
}

function RowEditor({
  table,
  row,
  saving,
  onSave,
  onDelete,
  onClose,
}: {
  table: PgAdminTable;
  row: Record<string, unknown>;
  saving: boolean;
  onSave: (changes: Record<string, unknown>) => Promise<void>;
  onDelete: () => void;
  onClose: () => void;
}) {
  const editableColumns = table.columns.filter((column) => column.editable);
  const [draft, setDraft] = useState<Record<string, string>>(() => Object.fromEntries(editableColumns.map((column) => [column.name, editorValue(row[column.name], column)])));
  const [error, setError] = useState('');

  useEffect(() => {
    setDraft(Object.fromEntries(editableColumns.map((column) => [column.name, editorValue(row[column.name], column)])));
    setError('');
  }, [row, table.name]); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    const changes: Record<string, unknown> = {};
    for (const column of editableColumns) {
      const before = editorValue(row[column.name], column);
      const after = draft[column.name] ?? '';
      if (before === after) continue;
      changes[column.name] = parsePgAdminEditorValue(column, after);
    }
    if (!Object.keys(changes).length) {
      setError('没有需要保存的更改。');
      return;
    }
    try {
      await onSave(changes);
    } catch (saveError) {
      setError((saveError as Error).message || '保存失败');
    }
  };

  return (
    <aside className="min-h-0 w-full shrink-0 overflow-y-auto border-t border-border-subtle bg-surface/55 scrollbar-thin xl:w-[390px] xl:border-l xl:border-t-0">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border-subtle bg-elevated px-4 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-text-primary"><Pencil className="h-3.5 w-3.5 text-accent" />记录编辑器</div>
          <div className="mt-1 truncate font-mono text-[9px] text-text-muted" title={rowIdentity(table, row)}>{rowIdentity(table, row)}</div>
        </div>
        <button type="button" onClick={onClose} className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors hover:bg-hover hover:text-text-primary" aria-label="关闭记录编辑器"><X className="h-4 w-4" /></button>
      </div>
      <div className="border-b border-border-subtle px-4 py-3">
        <div className="mb-2 flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-text-muted"><KeyRound className="h-3 w-3" />Primary key</div>
        <div className="space-y-1.5">
          {table.primary_key.map((column) => <div key={column} className="grid grid-cols-[100px_minmax(0,1fr)] gap-2 rounded-md bg-elevated px-2.5 py-2 text-[10px]"><span className="truncate font-mono text-text-muted">{column}</span><span className="break-all font-mono text-text-secondary">{displayValue(row[column])}</span></div>)}
        </div>
      </div>
      <form onSubmit={submit} className="p-4">
        {!table.mutable && (
          <div className="mb-4 flex gap-2 rounded-md border border-node-method/35 bg-node-method/10 p-2.5 text-xs text-node-method">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />受保护的图谱与 lineage 表在管理台中只读；修改必须通过专用流程完成。
          </div>
        )}
        <div className="space-y-4">
          {editableColumns.map((column) => {
            const value = draft[column.name] ?? '';
            const multiline = column.data_type === 'json' || column.data_type === 'jsonb' || value.length > 120 || ['definition', 'content', 'excerpt', 'notes'].includes(column.name);
            return (
              <label key={column.name} className="block">
                <span className="flex items-center justify-between gap-2 text-[11px] font-medium text-text-secondary"><span className="truncate font-mono">{column.name}</span><span className="shrink-0 text-[9px] font-normal text-text-muted">{column.data_type}{column.nullable ? ' · nullable' : ''}</span></span>
                {column.data_type === 'boolean' ? (
                  <select value={value} onChange={(event) => setDraft((current) => ({ ...current, [column.name]: event.target.value }))} className="mt-1.5 h-9 w-full rounded-md border border-border-subtle bg-elevated px-2.5 text-xs text-text-primary outline-none focus:border-accent"><option value="true">true</option><option value="false">false</option></select>
                ) : multiline ? (
                  <textarea value={value} onChange={(event) => setDraft((current) => ({ ...current, [column.name]: event.target.value }))} rows={column.data_type === 'json' || column.data_type === 'jsonb' ? 7 : 4} className="mt-1.5 w-full resize-y rounded-md border border-border-subtle bg-elevated px-2.5 py-2 font-mono text-[10px] leading-5 text-text-primary outline-none transition-colors focus:border-accent" />
                ) : (
                  <input value={value} onChange={(event) => setDraft((current) => ({ ...current, [column.name]: event.target.value }))} className="mt-1.5 h-9 w-full rounded-md border border-border-subtle bg-elevated px-2.5 font-mono text-[10px] text-text-primary outline-none transition-colors focus:border-accent" />
                )}
              </label>
            );
          })}
        </div>
        {error && <div className="mt-4 flex gap-2 rounded-md border border-node-event/35 bg-node-event/10 p-2.5 text-xs text-node-event"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</div>}
        <div className="mt-5 grid grid-cols-2 gap-2">
          <button type="submit" disabled={saving || editableColumns.length === 0} className="flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-accent px-3 text-xs font-medium text-white transition-colors hover:bg-accent-dim disabled:cursor-not-allowed disabled:opacity-45">{saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}保存修改</button>
          <button type="button" onClick={onDelete} disabled={!table.mutable} className="flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-node-event/35 bg-node-event/8 px-3 text-xs font-medium text-node-event transition-colors hover:bg-node-event/15 disabled:cursor-not-allowed disabled:border-border-subtle disabled:bg-transparent disabled:text-text-muted"><Trash2 className="h-3.5 w-3.5" />删除记录</button>
        </div>
      </form>
    </aside>
  );
}

function TableView({
  catalog,
  activeTableName,
  setActiveTableName,
  rows,
  loading,
  query,
  setQuery,
  onSearch,
  offset,
  setOffset,
  selectedRow,
  setSelectedRow,
  onSave,
  onDelete,
  saving,
}: {
  catalog: PgAdminCatalogResponse;
  activeTableName: string;
  setActiveTableName: (value: string) => void;
  rows: PgAdminRowsResponse | null;
  loading: boolean;
  query: string;
  setQuery: (value: string) => void;
  onSearch: () => void;
  offset: number;
  setOffset: (value: number) => void;
  selectedRow: Record<string, unknown> | null;
  setSelectedRow: (row: Record<string, unknown> | null) => void;
  onSave: (changes: Record<string, unknown>) => Promise<void>;
  onDelete: () => void;
  saving: boolean;
}) {
  const table = catalog.tables.find((item) => item.name === activeTableName) ?? null;
  const visibleColumns = rows?.table.columns ?? table?.columns ?? [];
  const pageStart = rows?.total ? offset + 1 : 0;
  const pageEnd = rows ? Math.min(offset + rows.rows.length, rows.total) : 0;

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border border-border-subtle bg-elevated lg:flex-row">
      <TableSidebar catalog={catalog} activeTable={activeTableName} onSelect={(name) => { setActiveTableName(name); setOffset(0); setSelectedRow(null); }} />
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="flex flex-col gap-3 border-b border-border-subtle px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2"><h2 className="truncate font-mono text-sm font-semibold text-text-primary">{activeTableName}</h2>{rows && <span className="rounded-full border border-border-subtle bg-surface px-2 py-0.5 font-mono text-[9px] text-text-muted">{rows.total} rows</span>}</div>
            <p className="mt-0.5 text-[10px] text-text-muted">点击任意行打开记录编辑器。向量列为只读。</p>
          </div>
          <form onSubmit={(event) => { event.preventDefault(); onSearch(); }} className="flex w-full items-center gap-2 sm:w-auto">
            <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-border-subtle bg-surface px-3 focus-within:border-accent sm:w-72"><Search className="h-3.5 w-3.5 text-text-muted" /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索当前表的任意字段" className="min-w-0 flex-1 bg-transparent text-xs text-text-primary outline-none placeholder:text-text-muted" /></label>
            <button type="submit" className="h-9 cursor-pointer rounded-md border border-border-subtle bg-surface px-3 text-xs text-text-secondary transition-colors hover:bg-hover hover:text-text-primary">检索</button>
          </form>
        </div>
        <div className="min-h-0 flex-1 overflow-auto scrollbar-thin">
          {loading ? (
            <EmptyState icon={<Loader2 className="h-5 w-5 animate-spin" />} title="正在读取表数据" detail={`PostgreSQL 正在分页查询 ${activeTableName}。`} />
          ) : !rows?.rows.length ? (
            <EmptyState icon={<Rows3 className="h-5 w-5" />} title="没有记录" detail="当前数据集和检索条件下没有可显示的行。" />
          ) : (
            <table className="min-w-max text-left text-[10px]">
              <thead className="sticky top-0 z-10 bg-surface text-[9px] uppercase tracking-[0.08em] text-text-muted">
                <tr>{visibleColumns.map((column) => <th key={column.name} className="max-w-64 border-b border-r border-border-subtle px-3 py-2 font-medium last:border-r-0"><span className="flex items-center gap-1.5">{column.primary_key && <KeyRound className="h-2.5 w-2.5 text-node-method" />}{column.name}</span><span className="mt-0.5 block font-normal normal-case tracking-normal text-text-muted/70">{column.udt_name}</span></th>)}</tr>
              </thead>
              <tbody>
                {rows.rows.map((row) => {
                  const identity = rowIdentity(rows.table, row);
                  const active = selectedRow && rowIdentity(rows.table, selectedRow) === identity;
                  return (
                    <tr key={identity} onClick={() => setSelectedRow(row)} className={`cursor-pointer border-b border-border-subtle transition-colors ${active ? 'bg-accent/12' : 'hover:bg-hover/55'}`}>
                      {visibleColumns.map((column) => <td key={column.name} className="max-w-64 border-r border-border-subtle px-3 py-2 align-top font-mono text-text-secondary last:border-r-0"><div className="max-h-12 min-w-20 overflow-hidden text-ellipsis whitespace-pre-wrap break-all" title={displayValue(row[column.name], column)}>{displayValue(row[column.name], column)}</div></td>)}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
        <div className="flex items-center justify-between border-t border-border-subtle bg-surface/55 px-4 py-2 text-[10px] text-text-muted">
          <span>{pageStart}–{pageEnd} / {rows?.total ?? 0}</span>
          <div className="flex gap-1.5">
            <button type="button" onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} disabled={offset === 0 || loading} className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-border-subtle bg-elevated transition-colors hover:bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-35" aria-label="上一页"><ChevronLeft className="h-3.5 w-3.5" /></button>
            <button type="button" onClick={() => setOffset(offset + PAGE_SIZE)} disabled={!rows || offset + PAGE_SIZE >= rows.total || loading} className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md border border-border-subtle bg-elevated transition-colors hover:bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-35" aria-label="下一页"><ChevronRight className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      </div>
      {selectedRow && table && <RowEditor key={`${table.name}:${rowIdentity(table, selectedRow)}`} table={table} row={selectedRow} saving={saving} onSave={onSave} onDelete={onDelete} onClose={() => setSelectedRow(null)} />}
    </section>
  );
}

function ExportDialog({
  catalog,
  books,
  includeBooks,
  exportFormat,
  bookScope,
  selectedBookIds,
  selectedTables,
  busy,
  error,
  onIncludeBooksChange,
  onExportFormatChange,
  onBookScopeChange,
  onSelectedBookIdsChange,
  onSelectedTablesChange,
  onSelectCurrent,
  onClose,
  onExport,
}: {
  catalog: PgAdminCatalogResponse;
  books: PgAdminBooksResponse | null;
  includeBooks: boolean;
  exportFormat: PgAdminExportFormat;
  bookScope: 'all' | 'selected';
  selectedBookIds: string[];
  selectedTables: string[];
  busy: boolean;
  error: string;
  onIncludeBooksChange: (value: boolean) => void;
  onExportFormatChange: (value: PgAdminExportFormat) => void;
  onBookScopeChange: (value: 'all' | 'selected') => void;
  onSelectedBookIdsChange: (bookIds: string[]) => void;
  onSelectedTablesChange: (tables: string[]) => void;
  onSelectCurrent: () => void;
  onClose: () => void;
  onExport: () => void;
}) {
  const selected = new Set(selectedTables);
  const selectionCount = selectedTables.length + (includeBooks ? 1 : 0);
  const estimatedRows = catalog.tables
    .filter((table) => selected.has(table.name))
    .reduce((sum, table) => sum + table.estimated_rows, 0);
  const availableBooks = books?.books ?? [];
  const hasValidBookScope = bookScope === 'all' || selectedBookIds.length > 0;

  const toggleTable = (tableName: string, checked: boolean) => {
    onSelectedTablesChange(checked
      ? [...selectedTables, tableName]
      : selectedTables.filter((name) => name !== tableName));
  };

  const toggleGroup = (group: PgAdminTable['group'], checked: boolean) => {
    const groupNames = catalog.tables.filter((table) => table.group === group).map((table) => table.name);
    const next = checked
      ? [...new Set([...selectedTables, ...groupNames])]
      : selectedTables.filter((name) => !groupNames.includes(name));
    onSelectedTablesChange(next);
  };

  const toggleBook = (bookId: string, checked: boolean) => {
    onSelectedBookIdsChange(checked
      ? [...new Set([...selectedBookIds, bookId])]
      : selectedBookIds.filter((id) => id !== bookId));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-void/75 p-4 backdrop-blur-sm" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="flex max-h-[min(820px,calc(100vh-2rem))] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-border-default bg-elevated shadow-panel" role="dialog" aria-modal="true" aria-labelledby="pg-export-title">
        <div className="flex items-start justify-between border-b border-border-subtle px-5 py-4">
          <div className="flex min-w-0 gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent/12 text-accent"><Download className="h-4.5 w-4.5" /></div>
            <div className="min-w-0">
              <h2 id="pg-export-title" className="text-sm font-semibold text-text-primary">导出 PostgreSQL 数据</h2>
              <p className="mt-1 text-xs leading-5 text-text-muted">选择教材范围、文件组织方式，以及要导出的汇总和原始数据表。</p>
            </div>
          </div>
          <button type="button" onClick={onClose} disabled={busy} className="flex h-8 w-8 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors hover:bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50" aria-label="关闭导出面板"><X className="h-4 w-4" /></button>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border-subtle bg-surface/45 px-5 py-2.5">
          <div className="flex flex-wrap gap-1.5">
            <button type="button" onClick={onSelectCurrent} className="h-7 cursor-pointer rounded-md border border-border-subtle bg-elevated px-2.5 text-[11px] text-text-secondary transition-colors hover:bg-hover hover:text-text-primary">当前内容</button>
            <button type="button" onClick={() => { onIncludeBooksChange(true); onSelectedTablesChange(catalog.tables.map((table) => table.name)); }} className="h-7 cursor-pointer rounded-md border border-border-subtle bg-elevated px-2.5 text-[11px] text-text-secondary transition-colors hover:bg-hover hover:text-text-primary">全选</button>
            <button type="button" onClick={() => { onIncludeBooksChange(false); onSelectedTablesChange([]); }} className="h-7 cursor-pointer rounded-md border border-border-subtle bg-elevated px-2.5 text-[11px] text-text-secondary transition-colors hover:bg-hover hover:text-text-primary">清空</button>
          </div>
          <div className="text-[11px] text-text-muted">已选 <span className="font-mono font-semibold text-text-primary">{selectionCount}</span> 项 · {bookScope === 'selected' ? `${selectedBookIds.length} 本教材` : '全部教材'} · 表总量约 <span className="font-mono text-text-primary">{estimatedRows.toLocaleString()}</span> 行</div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 scrollbar-thin">
          <fieldset className="rounded-lg border border-border-subtle bg-surface p-3">
            <legend className="px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">教材范围</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              <label className="flex cursor-pointer items-center gap-2 text-xs text-text-primary">
                <input type="radio" name="pg-export-book-scope" checked={bookScope === 'all'} onChange={() => onBookScopeChange('all')} className="h-3.5 w-3.5 cursor-pointer accent-accent" />
                全部教材
              </label>
              <label className="flex cursor-pointer items-center gap-2 text-xs text-text-primary">
                <input type="radio" name="pg-export-book-scope" checked={bookScope === 'selected'} onChange={() => onBookScopeChange('selected')} className="h-3.5 w-3.5 cursor-pointer accent-accent" />
                指定教材
              </label>
            </div>
            <p className="mt-2 text-[10px] leading-4 text-text-muted">指定教材后，各表会按教材及其关联的课时、知识点、关系、证据和任务过滤；共享分类与参考教材库会保留当前数据集的完整记录。</p>
            {bookScope === 'selected' && (
              <div className="mt-3 border-t border-border-subtle pt-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="text-[10px] text-text-muted">已选 {selectedBookIds.length}/{availableBooks.length} 本</span>
                  <span className="flex gap-1.5">
                    <button type="button" onClick={() => onSelectedBookIdsChange(availableBooks.map((book) => book.book_id))} className="cursor-pointer text-[10px] text-accent transition-colors hover:text-accent/80">全选教材</button>
                    <button type="button" onClick={() => onSelectedBookIdsChange([])} className="cursor-pointer text-[10px] text-text-muted transition-colors hover:text-text-primary">清空</button>
                  </span>
                </div>
                {availableBooks.length ? (
                  <div className="grid max-h-36 gap-1.5 overflow-y-auto pr-1 scrollbar-thin sm:grid-cols-2">
                    {availableBooks.map((book) => (
                      <label key={book.book_id} className="flex cursor-pointer items-start gap-2 rounded-md border border-border-subtle bg-elevated px-2.5 py-2 transition-colors hover:border-border-default hover:bg-hover/60">
                        <input type="checkbox" checked={selectedBookIds.includes(book.book_id)} onChange={(event) => toggleBook(book.book_id, event.target.checked)} className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-accent" />
                        <span className="min-w-0"><span className="block truncate text-[11px] font-medium text-text-primary" title={book.title}>{book.title}</span><span className="mt-0.5 block truncate font-mono text-[9px] text-text-muted" title={book.book_id}>{book.book_id}</span></span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-md border border-node-event/30 bg-node-event/8 px-3 py-2 text-[10px] text-node-event">当前数据集没有可选教材，请返回后刷新教材列表。</div>
                )}
                {availableBooks.length > 0 && selectedBookIds.length === 0 && <p className="mt-2 text-[10px] text-node-event">请至少选择一本教材后再下载。</p>}
              </div>
            )}
          </fieldset>

          <fieldset className="mt-4 rounded-lg border border-border-subtle bg-surface p-3">
            <legend className="px-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">文件组织</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              <label className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2.5 transition-colors ${exportFormat === 'combined' ? 'border-accent/50 bg-accent/8' : 'border-border-subtle bg-elevated hover:border-border-default'}`}>
                <input type="radio" name="pg-export-format" checked={exportFormat === 'combined'} onChange={() => onExportFormatChange('combined')} className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-accent" />
                <span><span className="block text-[11px] font-medium text-text-primary">合并为一个 JSON</span><span className="mt-0.5 block text-[10px] leading-4 text-text-muted">所有表放在同一个文件的 tables 对象中</span></span>
              </label>
              <label className={`flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2.5 transition-colors ${exportFormat === 'separate' ? 'border-accent/50 bg-accent/8' : 'border-border-subtle bg-elevated hover:border-border-default'}`}>
                <input type="radio" name="pg-export-format" checked={exportFormat === 'separate'} onChange={() => onExportFormatChange('separate')} className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-accent" />
                <span><span className="block text-[11px] font-medium text-text-primary">每个表单独一个 JSON</span><span className="mt-0.5 block text-[10px] leading-4 text-text-muted">统一打包为 ZIP；另附 manifest.json</span></span>
              </label>
            </div>
          </fieldset>

          <div className="mt-4 flex items-center justify-between gap-3 rounded-lg border border-border-subtle bg-surface px-3 py-2.5 transition-colors hover:border-border-default hover:bg-hover/60">
            <label className="flex min-w-0 cursor-pointer items-center gap-2.5">
              <input type="checkbox" checked={includeBooks} onChange={(event) => onIncludeBooksChange(event.target.checked)} className="h-3.5 w-3.5 cursor-pointer accent-accent" />
              <span><span className="block text-xs font-medium text-text-primary">教材汇总</span><span className="mt-0.5 block text-[10px] text-text-muted">教材名称、课时、任务、节点、边和证据统计</span></span>
            </label>
            <InfoTooltip label="教材汇总" text="便于快速了解导出教材的数据规模。这不是 PostgreSQL 原始表；勾选后会在 JSON 顶层增加 books 数组，并自动遵循上方教材范围。" />
          </div>

          <div className="mt-4 space-y-4">
            {GROUP_ORDER.map((group) => {
              const tables = catalog.tables.filter((table) => table.group === group);
              if (!tables.length) return null;
              const checkedCount = tables.filter((table) => selected.has(table.name)).length;
              const allChecked = checkedCount === tables.length;
              return (
                <fieldset key={group}>
                  <legend className="flex w-full items-center justify-between pb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-text-muted">
                    <span>{GROUP_LABELS[group]}</span>
                    <label className="flex cursor-pointer items-center gap-1.5 normal-case tracking-normal">
                      <input type="checkbox" checked={allChecked} ref={(input) => { if (input) input.indeterminate = checkedCount > 0 && !allChecked; }} onChange={(event) => toggleGroup(group, event.target.checked)} className="h-3.5 w-3.5 cursor-pointer accent-accent" />
                      {checkedCount}/{tables.length}
                    </label>
                  </legend>
                  <div className="grid gap-1.5 sm:grid-cols-2">
                    {tables.map((table) => (
                      <div key={table.name} className="flex items-center justify-between gap-2 rounded-md border border-border-subtle bg-surface px-2 py-1.5 transition-colors hover:border-border-default hover:bg-hover/60">
                        <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 px-1 py-0.5">
                          <input type="checkbox" checked={selected.has(table.name)} onChange={(event) => toggleTable(table.name, event.target.checked)} className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-accent" />
                          <span className="truncate font-mono text-[11px] text-text-primary">{table.name}</span>
                        </label>
                        <span className="shrink-0 font-mono text-[10px] text-text-muted">~{table.estimated_rows.toLocaleString()}</span>
                        <InfoTooltip label={table.name} text={TABLE_DESCRIPTIONS[table.name] ?? '当前数据集中的 PostgreSQL 原始表数据。'} />
                      </div>
                    ))}
                  </div>
                </fieldset>
              );
            })}
          </div>
          {error && <div className="mt-4 flex items-start gap-2 rounded-md border border-node-event/35 bg-node-event/10 p-2.5 text-xs text-node-event" role="alert"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</div>}
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-border-subtle bg-surface/50 px-5 py-3">
          <span className="text-[10px] text-text-muted">单次导出上限 {Math.floor(catalog.export_max_bytes / 1024 / 1024)} MiB；指定教材可显著缩小文件。</span>
          <div className="flex shrink-0 gap-2">
            <button type="button" onClick={onClose} disabled={busy} className="h-9 cursor-pointer rounded-md border border-border-subtle bg-elevated px-4 text-xs text-text-secondary transition-colors hover:bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50">取消</button>
            <button type="button" onClick={onExport} disabled={busy || selectionCount === 0 || !hasValidBookScope} className="flex h-9 cursor-pointer items-center gap-1.5 rounded-md bg-accent px-4 text-xs font-medium text-white transition-colors hover:bg-accent/85 disabled:cursor-not-allowed disabled:opacity-40">
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              {busy ? '正在导出' : exportFormat === 'separate' ? '下载 ZIP' : '下载 JSON'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export function PgAdminPage() {
  const { selectedSourceKey } = useAppState();
  const sourceKey = selectedSourceKey || new URLSearchParams(window.location.search).get('source') || 'main';
  const [view, setView] = useState<AdminView>('books');
  const [catalog, setCatalog] = useState<PgAdminCatalogResponse | null>(null);
  const [books, setBooks] = useState<PgAdminBooksResponse | null>(null);
  const [rows, setRows] = useState<PgAdminRowsResponse | null>(null);
  const [activeTableName, setActiveTableName] = useState('world_nodes');
  const [loadingCatalog, setLoadingCatalog] = useState(false);
  const [loadingBooks, setLoadingBooks] = useState(false);
  const [loadingRows, setLoadingRows] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [bookQuery, setBookQuery] = useState('');
  const [tableQuery, setTableQuery] = useState('');
  const [appliedTableQuery, setAppliedTableQuery] = useState('');
  const [offset, setOffset] = useState(0);
  const [selectedRow, setSelectedRow] = useState<Record<string, unknown> | null>(null);
  const [saving, setSaving] = useState(false);
  const [dialogTarget, setDialogTarget] = useState<DialogTarget>(null);
  const [confirmation, setConfirmation] = useState('');
  const [mutationBusy, setMutationBusy] = useState(false);
  const [mutationError, setMutationError] = useState('');
  const [exportOpen, setExportOpen] = useState(false);
  const [exportTables, setExportTables] = useState<string[]>([]);
  const [exportBooks, setExportBooks] = useState(false);
  const [exportFormat, setExportFormat] = useState<PgAdminExportFormat>('combined');
  const [exportBookScope, setExportBookScope] = useState<'all' | 'selected'>('all');
  const [exportBookIds, setExportBookIds] = useState<string[]>([]);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportError, setExportError] = useState('');
  const sourceKeyRef = useRef(sourceKey);
  const catalogRequestRef = useRef(0);
  const booksRequestRef = useRef(0);
  const rowsRequestRef = useRef(0);
  sourceKeyRef.current = sourceKey;

  const activeTable = catalog?.tables.find((table) => table.name === activeTableName) ?? null;

  const refreshCatalog = useCallback(async () => {
    const requestSourceKey = sourceKey;
    const requestId = ++catalogRequestRef.current;
    setLoadingCatalog(true);
    try {
      const next = await loadPgAdminCatalog(sourceKey);
      if (!isCurrentPgAdminRequest(requestSourceKey, requestId, sourceKeyRef.current, catalogRequestRef.current)) return;
      setCatalog(next);
      if (!next.tables.some((table) => table.name === activeTableName)) setActiveTableName(next.tables[0]?.name || 'world_nodes');
    } catch (loadError) {
      if (!isCurrentPgAdminRequest(requestSourceKey, requestId, sourceKeyRef.current, catalogRequestRef.current)) return;
      setError((loadError as Error).message || '读取数据库表目录失败');
    } finally {
      if (isCurrentPgAdminRequest(requestSourceKey, requestId, sourceKeyRef.current, catalogRequestRef.current)) setLoadingCatalog(false);
    }
  }, [sourceKey, activeTableName]);

  const refreshBooks = useCallback(async () => {
    const requestSourceKey = sourceKey;
    const requestId = ++booksRequestRef.current;
    setLoadingBooks(true);
    try {
      const next = await loadPgAdminBooks(sourceKey);
      if (!isCurrentPgAdminRequest(requestSourceKey, requestId, sourceKeyRef.current, booksRequestRef.current)) return;
      setBooks(next);
    } catch (loadError) {
      if (!isCurrentPgAdminRequest(requestSourceKey, requestId, sourceKeyRef.current, booksRequestRef.current)) return;
      setError((loadError as Error).message || '读取教材数据失败');
    } finally {
      if (isCurrentPgAdminRequest(requestSourceKey, requestId, sourceKeyRef.current, booksRequestRef.current)) setLoadingBooks(false);
    }
  }, [sourceKey]);

  const refreshRows = useCallback(async () => {
    if (!activeTableName) return;
    const requestSourceKey = sourceKey;
    const requestId = ++rowsRequestRef.current;
    setLoadingRows(true);
    try {
      const payload = await loadPgAdminRows(sourceKey, activeTableName, { query: appliedTableQuery, limit: PAGE_SIZE, offset });
      if (!isCurrentPgAdminRequest(requestSourceKey, requestId, sourceKeyRef.current, rowsRequestRef.current)) return;
      setRows(payload);
      setSelectedRow((current) => current ? payload.rows.find((row) => rowIdentity(payload.table, row) === rowIdentity(payload.table, current)) ?? null : null);
    } catch (loadError) {
      if (!isCurrentPgAdminRequest(requestSourceKey, requestId, sourceKeyRef.current, rowsRequestRef.current)) return;
      setError((loadError as Error).message || '读取数据库数据失败');
    } finally {
      if (isCurrentPgAdminRequest(requestSourceKey, requestId, sourceKeyRef.current, rowsRequestRef.current)) setLoadingRows(false);
    }
  }, [sourceKey, activeTableName, appliedTableQuery, offset]);

  useEffect(() => {
    catalogRequestRef.current += 1;
    booksRequestRef.current += 1;
    rowsRequestRef.current += 1;
    setCatalog(null);
    setBooks(null);
    setRows(null);
    setSelectedRow(null);
    setDialogTarget(null);
    setExportOpen(false);
    setExportFormat('combined');
    setExportBookScope('all');
    setExportBookIds([]);
    setConfirmation('');
    setMutationError('');
    setError('');
    setNotice('');
    void Promise.all([refreshCatalog(), refreshBooks()]);
  }, [sourceKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (view === 'tables' && catalog) void refreshRows();
  }, [view, catalog, refreshRows]);

  const refreshAll = async () => {
    setError('');
    setNotice('');
    await Promise.all([refreshCatalog(), refreshBooks(), view === 'tables' ? refreshRows() : Promise.resolve()]);
  };

  const saveRow = async (changes: Record<string, unknown>) => {
    if (!activeTable || !selectedRow) return;
    setSaving(true);
    setError('');
    try {
      const result = await updatePgAdminRow(sourceKey, activeTable.name, { primary_key: primaryKeyFor(activeTable, selectedRow), changes });
      if (result.row) setSelectedRow(result.row);
      setNotice(`已更新 ${activeTable.name} 的 1 条记录`);
      await refreshRows();
    } finally {
      setSaving(false);
    }
  };

  const openDialog = (target: Exclude<DialogTarget, null>) => {
    setDialogTarget(target);
    setConfirmation('');
    setMutationError('');
  };

  const closeDialog = () => {
    if (mutationBusy) return;
    setDialogTarget(null);
    setConfirmation('');
    setMutationError('');
  };

  const confirmDelete = async () => {
    if (!dialogTarget) return;
    setMutationBusy(true);
    setMutationError('');
    try {
      if (dialogTarget.kind === 'book') {
        const result = await deletePgAdminBook(sourceKey, dialogTarget.book.book_id, confirmation);
        const total = Object.values(result.deleted).reduce((sum, value) => sum + value, 0);
        setNotice(`已删除 ${result.book_id} 的 PostgreSQL 数据（${total} 条主要记录）`);
        await Promise.all([refreshBooks(), refreshCatalog()]);
      } else if (activeTable) {
        await deletePgAdminRow(sourceKey, activeTable.name, { primary_key: primaryKeyFor(activeTable, dialogTarget.row), confirmation });
        setNotice(`已删除 ${activeTable.name} 的 1 条记录`);
        setSelectedRow(null);
        await Promise.all([refreshRows(), refreshCatalog()]);
      }
      setDialogTarget(null);
      setConfirmation('');
    } catch (deleteError) {
      setMutationError((deleteError as Error).message || '删除失败');
    } finally {
      setMutationBusy(false);
    }
  };

  const selectCurrentExportContent = () => {
    setExportBooks(view === 'books');
    setExportTables(view === 'tables' && activeTable ? [activeTable.name] : []);
  };

  const openExport = () => {
    selectCurrentExportContent();
    setExportFormat('combined');
    setExportBookScope('all');
    setExportBookIds([]);
    setExportError('');
    setExportOpen(true);
  };

  const runExport = async () => {
    if (!catalog || (!exportBooks && exportTables.length === 0) || (exportBookScope === 'selected' && exportBookIds.length === 0)) return;
    setExportBusy(true);
    setExportError('');
    try {
      const { blob, filename } = await exportPgAdminData(sourceKey, {
        tables: exportTables,
        include_books: exportBooks,
        format: exportFormat,
        ...(exportBookScope === 'selected' ? { book_ids: exportBookIds } : {}),
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      setExportOpen(false);
      setNotice(`已导出 ${exportTables.length + (exportBooks ? 1 : 0)} 项内容（${exportBookScope === 'selected' ? `${exportBookIds.length} 本教材` : '全部教材'}，${exportFormat === 'separate' ? '每表一个 JSON' : '合并 JSON'}）：${filename}`);
    } catch (downloadError) {
      setExportError((downloadError as Error).message || '导出失败');
    } finally {
      setExportBusy(false);
    }
  };

  const estimatedRows = catalog?.tables.reduce((sum, table) => sum + table.estimated_rows, 0) ?? 0;

  return (
    <main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-deep/35">
      <div className="border-b border-border-subtle bg-surface/45 px-4 py-3 sm:px-6">
        <div className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-accent/35 bg-accent/10 text-accent"><Database className="h-5 w-5" /></div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2"><h1 className="text-base font-semibold tracking-tight text-text-primary">数据库管理</h1><span className="rounded-full border border-node-process/30 bg-node-process/10 px-2 py-0.5 text-[9px] font-semibold tracking-[0.12em] text-node-process">实时数据</span></div>
              <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-text-muted"><span className="font-mono">{sourceKey}</span><span className="h-1 w-1 rounded-full bg-border-strong" /><span>{catalog?.schema_version ?? 'world-v1.2'}</span><span className="h-1 w-1 rounded-full bg-border-strong" /><span>所有变更直接写入数据库</span></div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <nav className="flex h-9 rounded-lg border border-border-subtle bg-elevated p-0.5" aria-label="数据库管理视图">
              {([{ id: 'books', label: '教材管理', icon: BookOpen }, { id: 'tables', label: '数据表', icon: Table2 }] as const).map((item) => {
                const Icon = item.icon;
                return <button key={item.id} type="button" onClick={() => setView(item.id)} className={`flex min-w-24 cursor-pointer items-center justify-center gap-1.5 rounded-md px-3 text-xs font-medium transition-colors ${view === item.id ? 'bg-accent text-white shadow-glow-soft' : 'text-text-secondary hover:bg-hover hover:text-text-primary'}`}><Icon className="h-3.5 w-3.5" />{item.label}</button>;
              })}
            </nav>
            <button type="button" onClick={openExport} disabled={!catalog} className="flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-accent/35 bg-accent/10 px-3 text-xs font-medium text-accent transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-40"><Download className="h-3.5 w-3.5" />导出</button>
            <button type="button" onClick={() => void refreshAll()} disabled={loadingCatalog || loadingBooks || loadingRows} className="flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-border-subtle bg-elevated px-3 text-xs text-text-secondary transition-colors hover:bg-hover hover:text-text-primary disabled:cursor-wait disabled:opacity-50"><RefreshCw className={`h-3.5 w-3.5 ${loadingCatalog || loadingBooks || loadingRows ? 'animate-spin' : ''}`} />刷新</button>
          </div>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-thin sm:p-6">
        <div className="mx-auto flex h-full max-w-[1800px] flex-col gap-4">
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
            <Metric label="Dataset" value={sourceKey} icon={<Server className="h-3 w-3" />} />
            <Metric label="Tables" value={catalog?.tables.length ?? 0} icon={<Table2 className="h-3 w-3" />} />
            <Metric label="Estimated rows" value={estimatedRows} icon={<Rows3 className="h-3 w-3" />} />
            <Metric label="Books" value={books?.books.length ?? 0} icon={<BookOpen className="h-3 w-3" />} />
          </div>

          {error && <div className="flex items-start justify-between gap-3 rounded-lg border border-node-event/40 bg-node-event/10 p-3 text-xs text-node-event" role="alert"><span className="flex items-start gap-2"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</span><button type="button" onClick={() => setError('')} className="cursor-pointer"><X className="h-3.5 w-3.5" /></button></div>}
          {notice && <div className="flex items-start justify-between gap-3 rounded-lg border border-node-process/35 bg-node-process/10 p-3 text-xs text-node-process" role="status"><span className="flex items-start gap-2"><Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />{notice}</span><button type="button" onClick={() => setNotice('')} className="cursor-pointer"><X className="h-3.5 w-3.5" /></button></div>}

          {view === 'books' ? (
            <BooksView payload={books} loading={loadingBooks} query={bookQuery} setQuery={setBookQuery} onDelete={(book) => openDialog({ kind: 'book', book })} />
          ) : catalog ? (
            <TableView
              catalog={catalog}
              activeTableName={activeTableName}
              setActiveTableName={setActiveTableName}
              rows={rows}
              loading={loadingRows}
              query={tableQuery}
              setQuery={setTableQuery}
              onSearch={() => { setOffset(0); setAppliedTableQuery(tableQuery); }}
              offset={offset}
              setOffset={setOffset}
              selectedRow={selectedRow}
              setSelectedRow={setSelectedRow}
              onSave={saveRow}
              onDelete={() => selectedRow && openDialog({ kind: 'row', row: selectedRow })}
              saving={saving}
            />
          ) : (
            <section className="rounded-lg border border-border-subtle bg-elevated"><EmptyState icon={<Loader2 className="h-5 w-5 animate-spin" />} title="正在读取数据库结构" detail="读取可管理表、列类型和主键。" /></section>
          )}
        </div>
      </div>

      {dialogTarget && <ConfirmDialog target={dialogTarget} table={activeTable} confirmation={confirmation} setConfirmation={setConfirmation} busy={mutationBusy} error={mutationError} onClose={closeDialog} onConfirm={() => void confirmDelete()} />}
      {exportOpen && catalog && <ExportDialog catalog={catalog} books={books} includeBooks={exportBooks} exportFormat={exportFormat} bookScope={exportBookScope} selectedBookIds={exportBookIds} selectedTables={exportTables} busy={exportBusy} error={exportError} onIncludeBooksChange={setExportBooks} onExportFormatChange={setExportFormat} onBookScopeChange={setExportBookScope} onSelectedBookIdsChange={setExportBookIds} onSelectedTablesChange={setExportTables} onSelectCurrent={selectCurrentExportContent} onClose={() => !exportBusy && setExportOpen(false)} onExport={() => void runExport()} />}
    </main>
  );
}
