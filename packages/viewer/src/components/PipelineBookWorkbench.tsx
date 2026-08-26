import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react';
import type {
  PgAdminBookSummary,
  PipelineBookNodesResponse,
  PipelineJobSummary,
  PipelinePdfUploadResponse,
  PipelineStartResponse,
} from '@okm/types';
import {
  inferTextbookMetadata,
  loadPgAdminBooks,
  loadPipelineBookNodes,
  scanPipelineFolder,
  uploadPipelinePdf,
} from '@/services/backend-client';
import {
  AlertCircle,
  Check,
  ExternalLink,
  FolderOpen,
  ListChecks,
  Loader2,
  Network,
  Play,
  Search,
  Upload,
  X,
} from '@/lib/lucide-icons';

type QueueStatus = 'uploading' | 'ready' | 'starting' | 'started' | 'error';

type QueueBook = {
  id: string;
  pdfPath: string;
  fileName: string;
  sizeBytes: number;
  bookId: string;
  title: string;
  selected: boolean;
  status: QueueStatus;
  progress: number;
  error: string;
  jobId?: string;
};

type WorkbenchRow = {
  key: string;
  bookId: string;
  title: string;
  pdfPath: string;
  sizeBytes: number;
  selected: boolean;
  queueStatus: QueueStatus | null;
  queueError: string;
  progress: number;
  job: PipelineJobSummary | null;
  database: PgAdminBookSummary | null;
};

function queueStorageKey(sourceKey: string): string {
  return `okm.pipeline.batch-books.v2:${sourceKey}`;
}

function restoreQueue(sourceKey: string): QueueBook[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(queueStorageKey(sourceKey)) || '[]') as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value) => {
      if (!value || typeof value !== 'object') return [];
      const item = value as Partial<QueueBook>;
      if (!item.pdfPath || !item.fileName || !item.bookId) return [];
      return [{
        id: String(item.id || item.pdfPath),
        pdfPath: String(item.pdfPath),
        fileName: String(item.fileName),
        sizeBytes: Number(item.sizeBytes || 0),
        bookId: String(item.bookId),
        title: String(item.title || item.bookId),
        selected: item.selected !== false,
        status: 'ready' as const,
        progress: 100,
        error: '',
        jobId: item.jobId ? String(item.jobId) : undefined,
      }];
    });
  } catch {
    return [];
  }
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
  if (row.job?.status === 'running' || row.queueStatus === 'started') {
    return { label: '抽取中', tone: 'active', detail: row.job?.current_stage_label || '后台任务已启动' };
  }
  if (row.job?.status === 'completed') return { label: '已完成抽取', tone: 'ok', detail: row.job.completed_at || row.job.updated_at || '' };
  if (row.job?.status === 'blocked') return { label: '抽取阻断', tone: 'warn', detail: row.job.error || row.job.current_stage_label || '需要检查任务详情' };
  if ((row.database?.canonical_nodes ?? 0) > 0) return { label: '已有抽取结果', tone: 'ok', detail: '数据库中已有教材节点' };
  if (row.pdfPath) return { label: '等待抽取', tone: 'neutral', detail: row.selected ? '已加入本次批量任务' : '本次不抽取' };
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
      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${className}`}>{status.label}</span>
      <div className="mt-1 max-w-[210px] truncate text-[10px] text-text-muted" title={status.detail}>{status.detail || '—'}</div>
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

export function PipelineBookWorkbench({
  sourceKey,
  jobs,
  onStartBook,
  onRefreshJobs,
}: {
  sourceKey: string;
  jobs: PipelineJobSummary[];
  onStartBook: (book: { bookId: string; title: string; pdfPath: string }) => Promise<PipelineStartResponse>;
  onRefreshJobs: () => void;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [queue, setQueue] = useState<QueueBook[]>(() => restoreQueue(sourceKey));
  const [databaseBooks, setDatabaseBooks] = useState<PgAdminBookSummary[]>([]);
  const [folderPath, setFolderPath] = useState('');
  const [scanning, setScanning] = useState(false);
  const [batchStarting, setBatchStarting] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [nodePayload, setNodePayload] = useState<PipelineBookNodesResponse | null>(null);
  const [nodeLoading, setNodeLoading] = useState(false);
  const [nodeError, setNodeError] = useState('');
  const [nodeDialogOpen, setNodeDialogOpen] = useState(false);
  const [nodeBookTitle, setNodeBookTitle] = useState('');

  const refreshBooks = async () => {
    try {
      setDatabaseBooks((await loadPgAdminBooks(sourceKey)).books);
    } catch {
      setDatabaseBooks([]);
    }
  };

  useEffect(() => {
    void refreshBooks();
  }, [sourceKey, jobs.map((job) => `${job.job_id}:${job.status}:${job.updated_at}`).join('|')]);

  useEffect(() => {
    const persistent = queue.filter((item) => item.pdfPath);
    window.localStorage.setItem(queueStorageKey(sourceKey), JSON.stringify(persistent));
  }, [queue, sourceKey]);

  const updateQueue = (id: string, changes: Partial<QueueBook>) => {
    setQueue((current) => current.map((item) => item.id === id ? { ...item, ...changes } : item));
  };

  const inferQueueBook = async (item: QueueBook) => {
    try {
      const metadata = await inferTextbookMetadata(sourceKey, { pdf_path: item.pdfPath });
      updateQueue(item.id, { bookId: metadata.book_id, title: metadata.title });
    } catch {
      // Filename-derived identifiers remain usable when metadata inference is unavailable.
    }
  };

  const addServerFiles = async (files: PipelinePdfUploadResponse[]) => {
    const existingPaths = new Set(queue.map((item) => item.pdfPath));
    const next = files.filter((file) => !existingPaths.has(file.pdf_path)).map<QueueBook>((file) => ({
      id: file.pdf_path,
      pdfPath: file.pdf_path,
      fileName: file.file_name,
      sizeBytes: file.size_bytes,
      bookId: file.file_name.replace(/\.pdf$/i, ''),
      title: file.file_name.replace(/\.pdf$/i, ''),
      selected: true,
      status: 'ready',
      progress: 100,
      error: '',
    }));
    if (next.length === 0) return;
    setQueue((current) => [...current, ...next]);
    await Promise.all(next.map(inferQueueBook));
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
      pdfPath: '',
      fileName: file.name,
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
        const ready = { status: 'ready' as const, progress: 100, pdfPath: uploaded.pdf_path };
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
      const result = await scanPipelineFolder(sourceKey, { folder_path: folderPath.trim(), recursive: true });
      await addServerFiles(result.files.map((file) => ({ pdf_path: file.pdf_path, file_name: file.file_name, size_bytes: file.size_bytes })));
      setFolderPath(result.folder_path);
      setNotice(`目录中找到 ${result.files.length} 个 PDF，已加入批量列表。`);
    } catch (scanError) {
      setError((scanError as Error).message || '读取目录失败');
    } finally {
      setScanning(false);
    }
  };

  const latestJobByBook = useMemo(() => {
    const result = new Map<string, PipelineJobSummary>();
    jobs.forEach((job) => {
      if (!result.has(job.book_id)) result.set(job.book_id, job);
    });
    return result;
  }, [jobs]);

  const rows = useMemo<WorkbenchRow[]>(() => {
    const byBook = new Map<string, WorkbenchRow>();
    databaseBooks.forEach((book) => {
      byBook.set(book.book_id, {
        key: `db:${book.book_id}`,
        bookId: book.book_id,
        title: book.title,
        pdfPath: '',
        sizeBytes: 0,
        selected: false,
        queueStatus: null,
        queueError: '',
        progress: 0,
        job: latestJobByBook.get(book.book_id) ?? null,
        database: book,
      });
    });
    queue.forEach((item) => {
      const database = databaseBooks.find((book) => book.book_id === item.bookId) ?? null;
      byBook.set(item.bookId || item.id, {
        key: item.id,
        bookId: item.bookId,
        title: item.title,
        pdfPath: item.pdfPath,
        sizeBytes: item.sizeBytes,
        selected: item.selected,
        queueStatus: item.status,
        queueError: item.error,
        progress: item.progress,
        job: latestJobByBook.get(item.bookId) ?? null,
        database,
      });
    });
    return [...byBook.values()].sort((left, right) => {
      if (left.pdfPath && !right.pdfPath) return -1;
      if (!left.pdfPath && right.pdfPath) return 1;
      return left.title.localeCompare(right.title, 'zh-CN');
    });
  }, [databaseBooks, latestJobByBook, queue]);

  const selectedReady = queue.filter((item) => item.selected && item.status === 'ready' && item.pdfPath);

  const startSelected = async () => {
    if (selectedReady.length === 0) return;
    setBatchStarting(true);
    setError('');
    setNotice(`正在启动 ${selectedReady.length} 本教材…`);
    let started = 0;
    for (const item of selectedReady) {
      updateQueue(item.id, { status: 'starting', error: '' });
      try {
        const result = await onStartBook({ bookId: item.bookId, title: item.title, pdfPath: item.pdfPath });
        updateQueue(item.id, { status: 'started', jobId: result.job_id });
        started += 1;
      } catch (startError) {
        updateQueue(item.id, { status: 'error', error: (startError as Error).message || '启动失败' });
      }
    }
    setBatchStarting(false);
    setNotice(`已启动 ${started}/${selectedReady.length} 本教材。`);
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
  };

  return (
    <section className="mb-5 overflow-hidden rounded-xl border border-border-default bg-elevated shadow-panel">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border-subtle px-4 py-4 sm:px-5">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-text-primary"><ListChecks className="h-4 w-4 text-accent" />教材批量工作台</div>
          <div className="mt-1 text-xs text-text-muted">批量导入、逐本选择是否抽取，并查看完成状态和教材对应节点。</div>
        </div>
        <button type="button" onClick={() => void startSelected()} disabled={batchStarting || selectedReady.length === 0} className="flex h-9 cursor-pointer items-center gap-2 rounded-md bg-accent px-3 text-xs font-semibold text-white transition-colors hover:bg-accent-dim focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-not-allowed disabled:bg-surface disabled:text-text-muted">
          {batchStarting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          抽取已选 {selectedReady.length} 本
        </button>
      </div>

      <div className="grid gap-3 border-b border-border-subtle bg-surface/45 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.35fr)] sm:p-5">
        <div className="grid grid-cols-2 gap-2">
          <input ref={fileInputRef} type="file" accept=".pdf,application/pdf" multiple onChange={handleFiles} className="sr-only" aria-label="批量选择 PDF 文件" />
          <input ref={folderInputRef} type="file" accept=".pdf,application/pdf" multiple onChange={handleFiles} className="sr-only" aria-label="选择本地 PDF 文件夹" />
          <button type="button" onClick={() => fileInputRef.current?.click()} className="flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border border-dashed border-accent/50 bg-accent/5 px-3 text-left transition-colors hover:border-accent hover:bg-accent/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            <Upload className="h-4 w-4 shrink-0 text-accent" />
            <span><span className="block text-xs font-medium text-text-primary">批量选择 PDF</span><span className="mt-0.5 block text-[10px] text-text-muted">一次选择多本教材</span></span>
          </button>
          <button type="button" onClick={() => { folderInputRef.current?.setAttribute('webkitdirectory', ''); folderInputRef.current?.click(); }} className="flex min-h-14 cursor-pointer items-center gap-3 rounded-lg border border-dashed border-border-default bg-elevated px-3 text-left transition-colors hover:border-accent hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
            <FolderOpen className="h-4 w-4 shrink-0 text-accent" />
            <span><span className="block text-xs font-medium text-text-primary">选择本地文件夹</span><span className="mt-0.5 block text-[10px] text-text-muted">上传文件夹内全部 PDF</span></span>
          </button>
        </div>
        <div>
          <label htmlFor="pipeline-folder-path" className="mb-1.5 block text-[11px] font-medium text-text-muted">服务端本地文件夹绝对路径</label>
          <div className="flex gap-2">
            <input id="pipeline-folder-path" value={folderPath} onChange={(event) => setFolderPath(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void scanFolder(); }} placeholder="/Users/.../textbooks" className="h-9 min-w-0 flex-1 rounded-md border border-border-default bg-surface px-3 font-mono text-xs text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent" />
            <button type="button" onClick={() => void scanFolder()} disabled={scanning || !folderPath.trim()} className="flex h-9 cursor-pointer items-center gap-1.5 rounded-md border border-border-default bg-elevated px-3 text-xs font-medium text-text-secondary transition-colors hover:bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50">
              {scanning ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}扫描目录
            </button>
          </div>
          <div className="mt-1.5 text-[10px] text-text-muted">读取运行服务所在电脑的目录，递归查找 PDF；不会复制或修改原文件。</div>
        </div>
      </div>

      {(notice || error) && (
        <div className={`mx-4 mt-3 flex items-start gap-2 rounded-md border px-3 py-2 text-xs sm:mx-5 ${error ? 'border-node-event/40 bg-node-event/10 text-node-event' : 'border-accent/30 bg-accent/10 text-text-secondary'}`}>
          {error ? <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-node-process" />}{error || notice}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-5">
        <div className="text-xs text-text-muted">共 {rows.length} 本 · {queue.filter((item) => item.selected).length} 本已勾选</div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => setQueue((current) => current.map((item) => ({ ...item, selected: true })))} className="cursor-pointer text-[11px] font-medium text-accent hover:text-accent-dim">全选待处理</button>
          <span className="text-border-strong">/</span>
          <button type="button" onClick={() => setQueue((current) => current.map((item) => ({ ...item, selected: false })))} className="cursor-pointer text-[11px] font-medium text-text-muted hover:text-text-primary">全部取消</button>
        </div>
      </div>

      <div className="max-h-[480px] overflow-auto border-t border-border-subtle scrollbar-thin">
        <table className="w-full min-w-[1040px] text-left text-xs">
          <thead className="sticky top-0 z-10 bg-elevated text-text-muted">
            <tr>
              <th className="w-20 px-4 py-2 font-medium">是否抽取</th>
              <th className="px-3 py-2 font-medium">教材</th>
              <th className="px-3 py-2 font-medium">源文件</th>
              <th className="px-3 py-2 font-medium">抽取状态</th>
              <th className="px-3 py-2 font-medium">节点结果</th>
              <th className="px-3 py-2 font-medium">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const canSelect = Boolean(row.pdfPath && row.queueStatus !== 'uploading' && row.queueStatus !== 'starting' && row.job?.status !== 'running');
              return (
                <tr key={row.key} className="border-t border-border-subtle transition-colors hover:bg-hover/60">
                  <td className="px-4 py-3">
                    <label className={`inline-flex items-center gap-2 ${canSelect ? 'cursor-pointer' : 'cursor-not-allowed opacity-55'}`}>
                      <input type="checkbox" checked={row.selected} disabled={!canSelect} onChange={(event) => updateSelected(row, event.target.checked)} className="h-4 w-4 accent-[var(--color-accent)]" aria-label={`${row.title} 是否参与抽取`} />
                      <span className="text-[10px] text-text-muted">{row.selected ? '是' : '否'}</span>
                    </label>
                  </td>
                  <td className="max-w-[260px] px-3 py-3">
                    <div className="truncate font-medium text-text-primary" title={row.title}>{row.title}</div>
                  </td>
                  <td className="max-w-[320px] px-3 py-3">
                    <div className="truncate text-text-secondary" title={row.pdfPath}>{row.pdfPath || '数据库已有记录'}</div>
                    <div className="mt-1 text-[10px] text-text-muted">{fileSizeText(row.sizeBytes)}</div>
                  </td>
                  <td className="px-3 py-3"><StatusBadge row={row} /></td>
                  <td className="px-3 py-3">
                    <div className="font-semibold tabular-nums text-text-primary">{row.database?.canonical_nodes ?? 0} 个</div>
                    <div className="mt-1 text-[10px] text-text-muted">{row.database?.shared_nodes ? `${row.database.shared_nodes} 个复用/匹配` : 'canonical 节点'}</div>
                  </td>
                  <td className="px-3 py-3">
                    <button type="button" onClick={() => void showNodes(row.bookId, row.title)} disabled={!row.bookId} className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border-default bg-surface px-2.5 text-[11px] font-medium text-text-secondary transition-colors hover:border-accent hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-50">
                      <ExternalLink className="h-3.5 w-3.5" />查看节点
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-14 text-center text-text-muted">批量选择 PDF 或扫描教材目录后，这里会出现逐本任务。</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {nodeDialogOpen && <BookNodesDialog bookTitle={nodeBookTitle} payload={nodePayload} loading={nodeLoading} error={nodeError} onClose={() => setNodeDialogOpen(false)} />}
    </section>
  );
}
