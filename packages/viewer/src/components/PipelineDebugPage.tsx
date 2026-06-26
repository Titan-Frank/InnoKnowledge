import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type {
  ImageReviewAction,
  ImageReviewItem,
  ImageReviewResponse,
  PipelineLessonBackendKind,
  PipelineResponse,
  PipelineReviewItem,
  PipelineStartResponse,
  TextbookMetadataResponse,
} from '@okm/types';
import {
  inferTextbookMetadata,
  loadImageReviews,
  loadPipeline,
  startPipeline,
  updateImageReview,
} from '@/services/backend-client';
import { useAppState } from '@/hooks/useAppState';
import {
  AlertCircle,
  BarChart3,
  Check,
  ChevronRight,
  GitBranch,
  Info,
  Loader2,
  Play,
  RotateCcw,
  Search,
} from '@/lib/lucide-icons';

type IntakeMode = 'pdf' | 'markdown' | 'mineru';

type PipelineForm = {
  book_id: string;
  book_title: string;
  pdf_path: string;
  source_markdown_path: string;
  mineru_file_url: string;
  mineru_base_url: string;
  mineru_model_version: string;
  mineru_language: string;
  mineru_page_ranges: string;
  mineru_force: boolean;
  outline_start_page: string;
  outline_end_page: string;
  output_root: string;
  parallelism: string;
  lesson_subject: string;
  lesson_school_stage: string;
  lesson_grade_band: string;
  lesson_backend_kind: PipelineLessonBackendKind;
  openai_base_url: string;
  openai_model: string;
  vlm_api_url: string;
  vlm_api_key: string;
  vlm_model: string;
};

const initialForm: PipelineForm = {
  book_id: '',
  book_title: '',
  pdf_path: '',
  source_markdown_path: '',
  mineru_file_url: '',
  mineru_base_url: 'https://mineru.net',
  mineru_model_version: 'vlm',
  mineru_language: 'ch',
  mineru_page_ranges: '',
  mineru_force: false,
  outline_start_page: '1',
  outline_end_page: '20',
  output_root: 'data/main',
  parallelism: '4',
  lesson_subject: '',
  lesson_school_stage: '',
  lesson_grade_band: '',
  lesson_backend_kind: 'openai_responses',
  openai_base_url: '',
  openai_model: '',
  vlm_api_url: '',
  vlm_api_key: '',
  vlm_model: '',
};

function numberValue(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0) || 0;
}

function timeText(value: string | null): string {
  if (!value) return '未记录';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function percentValue(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    qa_passed: '已通过',
    completed: '已完成',
    success: '成功',
    blocked: '阻断',
    failed: '失败',
    merging: '合并中',
    merged: '已合并',
    staged: '已暂存',
    running: '运行中',
    started: '已启动',
  };
  return labels[status] || status || '未知';
}

function statusTone(status: string): 'ok' | 'warn' | 'active' | 'neutral' {
  if (status === 'qa_passed' || status === 'completed' || status === 'success' || status === 'merged') return 'ok';
  if (status === 'blocked' || status === 'failed') return 'warn';
  if (status === 'running' || status === 'started' || status === 'merging' || status === 'staged') return 'active';
  return 'neutral';
}

function StatusPill({ status }: { status: string }) {
  const tone = statusTone(status);
  const style =
    tone === 'ok'
      ? 'border-node-process/40 bg-node-process/10 text-node-process'
      : tone === 'warn'
        ? 'border-node-event/40 bg-node-event/10 text-node-event'
        : tone === 'active'
          ? 'border-accent/40 bg-accent/10 text-accent'
          : 'border-border-default bg-surface text-text-secondary';
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${style}`}>{statusLabel(status)}</span>;
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  type = 'text',
  inputMode,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  type?: string;
  inputMode?: 'numeric' | 'text';
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-medium text-text-muted">{label}</span>
      <input
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        inputMode={inputMode}
        placeholder={placeholder}
        className="h-9 w-full rounded-md border border-border-subtle bg-surface px-3 text-xs text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent"
      />
    </label>
  );
}

function SelectField<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (value: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-medium text-text-muted">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="h-9 w-full rounded-md border border-border-subtle bg-surface px-3 text-xs text-text-primary outline-none transition-colors focus:border-accent"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>{option.label}</option>
        ))}
      </select>
    </label>
  );
}

function MetricCard({
  label,
  value,
  detail,
  tone = 'neutral',
}: {
  label: string;
  value: number | string;
  detail?: string;
  tone?: 'neutral' | 'ok' | 'warn' | 'active';
}) {
  const color = tone === 'ok' ? 'text-node-process' : tone === 'warn' ? 'text-node-event' : tone === 'active' ? 'text-accent' : 'text-text-primary';
  return (
    <div className="rounded-lg border border-border-subtle bg-elevated p-3">
      <div className={`text-xl font-semibold tabular-nums ${color}`}>{value}</div>
      <div className="mt-1 text-[11px] font-medium text-text-secondary">{label}</div>
      {detail && <div className="mt-1 truncate text-[10px] text-text-muted">{detail}</div>}
    </div>
  );
}

function ReviewList({ items }: { items: PipelineReviewItem[] }) {
  if (items.length === 0) {
    return (
      <div className="flex items-start gap-2 rounded-lg border border-border-subtle bg-surface p-3 text-xs text-text-secondary">
        <Check className="mt-0.5 h-4 w-4 shrink-0 text-node-process" />
        <span>当前没有待复核合并项。</span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.slice(0, 8).map((item) => (
        <div key={`${item.merge_run_id}:${item.lesson_run_id}:${item.raw_node_id}`} className="rounded-lg border border-border-subtle bg-surface p-3">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-text-primary">{item.raw_node_id}</div>
              <div className="mt-1 truncate text-[11px] text-text-muted">候选节点：{item.canonical_node_id}</div>
            </div>
            <div className="text-sm font-semibold tabular-nums text-accent">{item.similarity.toFixed(2)}</div>
          </div>
          <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] text-text-muted">
            <span>词面 {numberValue(item.rationale.lexical).toFixed(2)}</span>
            <span>语义键 {numberValue(item.rationale.semantic_key).toFixed(2)}</span>
            <span>向量 {numberValue(item.rationale.embedding).toFixed(2)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

function imageReviewRelevanceLabel(value: string): string {
  const labels: Record<string, string> = {
    core_content: '核心内容',
    supporting: '辅助内容',
    decorative: '装饰图片',
    mismatch: '内容不匹配',
    uncertain: '无法判断',
  };
  return labels[value] || value || '未知';
}

function imageReviewConfidenceText(value: number | undefined): string {
  if (value === undefined || Number.isNaN(value)) return '置信度未知';
  const normalized = value <= 1 ? value * 100 : value;
  return `置信度 ${Math.round(normalized)}%`;
}

function imageReviewLocation(item: ImageReviewItem): string {
  const page = item.page_start ? `第 ${item.page_start} 页` : '';
  const locator = item.locator || item.anchor_ref || item.source_id;
  return [page, locator].filter(Boolean).join(' · ') || '位置未知';
}

function imageReviewSizeText(item: ImageReviewItem): string {
  const { width, height } = item.decision;
  if (!width || !height) return '';
  return `${Math.round(width)} x ${Math.round(height)}`;
}

function compactPath(value: string): string {
  const normalized = value.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts.length > 3 ? `.../${parts.slice(-3).join('/')}` : normalized;
}

function ImageReviewPanel({
  reviews,
  loading,
  error,
  updatingId,
  onRefresh,
  onAction,
}: {
  reviews: ImageReviewResponse | null;
  loading: boolean;
  error: string;
  updatingId: string;
  onRefresh: () => void;
  onAction: (item: ImageReviewItem, action: ImageReviewAction) => void;
}) {
  const items = reviews?.items ?? [];
  const disabled = Boolean(updatingId);
  const [activeIndex, setActiveIndex] = useState(0);
  const activeIndexSafe = items.length === 0 ? 0 : Math.min(activeIndex, items.length - 1);
  const activeItem = items[activeIndexSafe] ?? null;
  const activeSizeText = activeItem ? imageReviewSizeText(activeItem) : '';
  const activeHeading = activeItem?.context?.heading_path.join(' / ') || activeItem?.anchor_ref || '';
  const activeSourcePath = activeItem?.context?.source_path || activeItem?.source_path || '';
  const activeContextLines = activeItem ? [
    ...(activeItem.context?.before ?? []).map((line) => ({ label: '前文', line, active: false })),
    { label: '图片', line: activeItem.context?.image_line || activeItem.excerpt || '图片所在行', active: true },
    ...(activeItem.context?.after ?? []).map((line) => ({ label: '后文', line, active: false })),
  ].filter((entry) => entry.line.trim().length > 0) : [];
  const pendingCount = reviews?.pending ?? items.length;
  const canSwitch = items.length > 1;

  useEffect(() => {
    setActiveIndex((index) => {
      if (items.length === 0) return 0;
      return Math.min(index, items.length - 1);
    });
  }, [items.length]);

  const showPrevious = () => {
    if (!canSwitch) return;
    setActiveIndex((index) => (index + items.length - 1) % items.length);
  };

  const showNext = () => {
    if (!canSwitch) return;
    setActiveIndex((index) => (index + 1) % items.length);
  };

  return (
    <section className="rounded-lg border border-border-subtle bg-elevated p-4" aria-busy={loading}>
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-text-primary">待确认图片</div>
          <div className="mt-0.5 text-[11px] text-text-muted">
            {reviews ? `${pendingCount} 张待确认，已载入 ${items.length} 张` : '等待读取'}
          </div>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          className="flex h-7 cursor-pointer items-center gap-1.5 rounded-md border border-border-subtle bg-surface px-2 text-[11px] text-text-secondary transition-colors hover:bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
          刷新
        </button>
      </div>

      {error && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-node-event/40 bg-node-event/10 p-3 text-xs text-node-event" role="alert">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!loading && items.length === 0 && !error && (
        <div className="flex items-start gap-2 rounded-lg border border-border-subtle bg-surface p-3 text-xs text-text-secondary">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-node-process" />
          <span>当前没有待确认图片。</span>
        </div>
      )}

      {activeItem && (
        <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-3 py-2">
            <div className="min-w-0">
              <div className="truncate text-xs font-semibold text-text-primary" title={activeItem.evidence_id}>{activeItem.evidence_id}</div>
              <div className="mt-0.5 truncate text-[11px] text-text-muted" title={imageReviewLocation(activeItem)}>{imageReviewLocation(activeItem)}</div>
            </div>
            <div className="flex items-center gap-2">
              <span className="min-w-[76px] text-center text-[11px] text-text-muted" aria-live="polite">
                {activeIndexSafe + 1} / {items.length}
              </span>
              <button
                type="button"
                onClick={showPrevious}
                disabled={!canSwitch}
                aria-label="上一张待确认图片"
                className="flex h-8 cursor-pointer items-center gap-1 rounded-md border border-border-subtle bg-elevated px-2 text-[11px] text-text-secondary transition-colors hover:bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                <ChevronRight className="h-3.5 w-3.5 rotate-180" />
                上一张
              </button>
              <button
                type="button"
                onClick={showNext}
                disabled={!canSwitch}
                aria-label="下一张待确认图片"
                className="flex h-8 cursor-pointer items-center gap-1 rounded-md border border-border-subtle bg-elevated px-2 text-[11px] text-text-secondary transition-colors hover:bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                下一张
                <ChevronRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>

          <div className="grid gap-3 p-3 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="relative flex h-56 items-center justify-center bg-void p-2 sm:h-64 xl:h-72">
              <button
                type="button"
                onClick={showPrevious}
                disabled={!canSwitch}
                aria-label="上一张待确认图片"
                className="absolute left-2 top-1/2 flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-border-subtle bg-elevated/90 text-text-secondary shadow-sm transition-colors hover:bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4 rotate-180" />
              </button>
              {activeItem.image_url ? (
                <img
                  src={activeItem.image_url}
                  alt="待确认教材图片"
                  className="max-h-full max-w-full rounded-sm object-contain"
                  loading="lazy"
                />
              ) : (
                <span className="text-xs text-text-muted">图片路径缺失</span>
              )}
              <button
                type="button"
                onClick={showNext}
                disabled={!canSwitch}
                aria-label="下一张待确认图片"
                className="absolute right-2 top-1/2 flex h-8 w-8 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-border-subtle bg-elevated/90 text-text-secondary shadow-sm transition-colors hover:bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap gap-1.5 text-[10px] text-text-muted">
                <span className="rounded-full border border-border-subtle bg-elevated px-1.5 py-0.5">{imageReviewRelevanceLabel(activeItem.decision.relevance)}</span>
                <span className="rounded-full border border-border-subtle bg-elevated px-1.5 py-0.5">{imageReviewConfidenceText(activeItem.decision.confidence)}</span>
                {activeSizeText && (
                  <span className="rounded-full border border-border-subtle bg-elevated px-1.5 py-0.5">{activeSizeText}</span>
                )}
              </div>
              <div className="rounded-md border border-border-subtle bg-elevated p-2">
                <div className="mb-1 text-[10px] font-medium text-text-muted">出现位置</div>
                <div className="space-y-1 text-[11px] leading-5 text-text-secondary">
                  {activeHeading && (
                    <div className="truncate" title={activeHeading}>
                      <span className="text-text-muted">标题：</span>{activeHeading}
                    </div>
                  )}
                  <div className="truncate" title={imageReviewLocation(activeItem)}>
                    <span className="text-text-muted">页码：</span>{imageReviewLocation(activeItem)}
                    {activeItem.context?.source_line ? ` · 第 ${activeItem.context.source_line} 行` : ''}
                  </div>
                  {activeSourcePath && (
                    <div className="truncate" title={activeSourcePath}>
                      <span className="text-text-muted">源文件：</span>{compactPath(activeSourcePath)}
                    </div>
                  )}
                </div>
              </div>
              {activeContextLines.length > 0 && (
                <div className="rounded-md border border-border-subtle bg-elevated p-2">
                  <div className="mb-1 text-[10px] font-medium text-text-muted">上下文</div>
                  <div className="max-h-32 space-y-1 overflow-auto text-[11px] leading-5 scrollbar-thin">
                    {activeContextLines.map((entry, index) => (
                      <div key={`${entry.label}:${index}`} className={entry.active ? 'text-accent' : 'text-text-secondary'}>
                        <span className="mr-1 text-text-muted">{entry.label}</span>
                        <span>{entry.line}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="rounded-md border border-border-subtle bg-elevated p-2">
                <div className="mb-1 text-[10px] font-medium text-text-muted">判断说明</div>
                <div className="max-h-20 overflow-auto text-[11px] leading-5 text-text-secondary scrollbar-thin">
                  {activeItem.decision.reason || '缺少判断说明。'}
                </div>
              </div>
              {activeItem.excerpt && (
                <div className="rounded-md border border-border-subtle bg-elevated p-2">
                  <div className="mb-1 text-[10px] font-medium text-text-muted">证据摘录</div>
                  <div className="max-h-20 overflow-auto text-[11px] leading-5 text-text-secondary scrollbar-thin">
                    {activeItem.excerpt}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => onAction(activeItem, 'core_content')}
                  disabled={disabled}
                  className="flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-node-process/40 bg-node-process/10 px-2 text-[11px] font-medium text-node-process transition-colors hover:bg-node-process/15 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {updatingId === activeItem.evidence_id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                  核心图
                </button>
                <button
                  type="button"
                  onClick={() => onAction(activeItem, 'supporting')}
                  disabled={disabled}
                  className="flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-2 text-[11px] font-medium text-accent transition-colors hover:bg-accent/15 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {updatingId === activeItem.evidence_id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                  辅助图
                </button>
                <button
                  type="button"
                  onClick={() => onAction(activeItem, 'keep')}
                  disabled={disabled}
                  className="flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-border-subtle bg-elevated px-2 text-[11px] font-medium text-text-secondary transition-colors hover:bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {updatingId === activeItem.evidence_id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                  保留
                </button>
                <button
                  type="button"
                  onClick={() => onAction(activeItem, 'drop')}
                  disabled={disabled}
                  className="flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-node-event/40 bg-node-event/10 px-2 text-[11px] font-medium text-node-event transition-colors hover:bg-node-event/15 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {updatingId === activeItem.evidence_id ? <Loader2 className="h-3 w-3 animate-spin" /> : <AlertCircle className="h-3 w-3" />}
                  删除
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function sourceReadyLabel(mode: IntakeMode, form: PipelineForm): string {
  if (mode === 'pdf') return form.pdf_path.trim() ? 'PDF 路径已填写' : '需要本机 PDF 绝对路径';
  if (mode === 'markdown') return form.source_markdown_path.trim() ? 'Markdown 路径已填写' : '需要 full.md 或等价源文件';
  return form.mineru_file_url.trim() || form.pdf_path.trim() ? 'MinerU 输入已填写' : '需要 PDF 路径或文件 URL';
}

function sourceReady(mode: IntakeMode, form: PipelineForm): boolean {
  if (mode === 'pdf') return Boolean(form.pdf_path.trim());
  if (mode === 'markdown') return Boolean(form.source_markdown_path.trim());
  return Boolean(form.mineru_file_url.trim() || form.pdf_path.trim());
}

export function PipelineDebugPage() {
  const { selectedSourceKey } = useAppState();
  const activeSourceKey =
    selectedSourceKey ||
    new URLSearchParams(window.location.search).get('source') ||
    'main';

  const [payload, setPayload] = useState<PipelineResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const [startResult, setStartResult] = useState<PipelineStartResponse | null>(null);
  const [metadata, setMetadata] = useState<TextbookMetadataResponse | null>(null);
  const [inferring, setInferring] = useState(false);
  const [intakeMode, setIntakeMode] = useState<IntakeMode>('pdf');
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [form, setForm] = useState<PipelineForm>(initialForm);
  const [imageReviews, setImageReviews] = useState<ImageReviewResponse | null>(null);
  const [imageReviewLoading, setImageReviewLoading] = useState(false);
  const [imageReviewError, setImageReviewError] = useState('');
  const [imageReviewUpdating, setImageReviewUpdating] = useState('');

  const refresh = async () => {
    setLoading(true);
    setError('');
    try {
      setPayload(await loadPipeline(activeSourceKey));
    } catch (err) {
      setError((err as Error).message || '读取管线状态失败');
    } finally {
      setLoading(false);
    }
  };

  const refreshImageReviews = async () => {
    setImageReviewLoading(true);
    setImageReviewError('');
    try {
      setImageReviews(await loadImageReviews(activeSourceKey));
    } catch (err) {
      setImageReviewError((err as Error).message || '读取待确认图片失败');
    } finally {
      setImageReviewLoading(false);
    }
  };

  const updateForm = <K extends keyof PipelineForm>(key: K, value: PipelineForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const canStart = form.book_id.trim().length > 0 && sourceReady(intakeMode, form) && !starting;

  const submitStart = async (event: FormEvent) => {
    event.preventDefault();
    if (!canStart) return;
    setStarting(true);
    setStartError('');
    setStartResult(null);
    try {
      const result = await startPipeline(activeSourceKey, {
        book_id: form.book_id.trim(),
        book_title: form.book_title.trim() || undefined,
        pdf_path: form.pdf_path.trim() || undefined,
        source_markdown_path: intakeMode === 'markdown' ? form.source_markdown_path.trim() || undefined : undefined,
        mineru_file_url: intakeMode === 'mineru' ? form.mineru_file_url.trim() || undefined : undefined,
        mineru_base_url: intakeMode === 'mineru' ? form.mineru_base_url.trim() || undefined : undefined,
        mineru_model_version: intakeMode === 'mineru' ? form.mineru_model_version.trim() || undefined : undefined,
        mineru_language: intakeMode === 'mineru' ? form.mineru_language.trim() || undefined : undefined,
        mineru_page_ranges: intakeMode === 'mineru' ? form.mineru_page_ranges.trim() || undefined : undefined,
        mineru_force: intakeMode === 'mineru' ? form.mineru_force : undefined,
        outline_start_page: Number(form.outline_start_page) || undefined,
        outline_end_page: Number(form.outline_end_page) || undefined,
        dataset_id: activeSourceKey,
        output_root: form.output_root.trim() || 'data/main',
        parallelism: Number(form.parallelism) || 4,
        lesson_backend_kind: form.lesson_backend_kind,
        lesson_subject: form.lesson_subject.trim() || undefined,
        lesson_school_stage: form.lesson_school_stage.trim() || undefined,
        lesson_grade_band: form.lesson_grade_band.trim() || undefined,
        openai_base_url: form.openai_base_url.trim() || undefined,
        openai_model: form.openai_model.trim() || undefined,
        vlm_api_url: form.vlm_api_url.trim() || undefined,
        vlm_api_key: form.vlm_api_key.trim() || undefined,
        vlm_model: form.vlm_model.trim() || undefined,
      });
      setStartResult(result);
      window.setTimeout(() => {
        void refresh();
        void refreshImageReviews();
      }, 1200);
    } catch (err) {
      setStartError((err as Error).message || '启动失败');
    } finally {
      setStarting(false);
    }
  };

  const submitInfer = async () => {
    if (!form.book_id.trim()) return;
    setInferring(true);
    setStartError('');
    try {
      const result = await inferTextbookMetadata(activeSourceKey, {
        book_id: form.book_id.trim(),
        pdf_path: form.pdf_path.trim() || undefined,
      });
      setMetadata(result);
      setForm((current) => ({
        ...current,
        book_title: current.book_title || result.title,
        lesson_subject: result.lesson_subject,
        lesson_school_stage: result.lesson_school_stage,
        lesson_grade_band: result.lesson_grade_band,
      }));
    } catch (err) {
      setStartError((err as Error).message || '识别教材信息失败');
    } finally {
      setInferring(false);
    }
  };

  useEffect(() => {
    void refresh();
    void refreshImageReviews();
  }, [activeSourceKey]);

  const submitImageReview = async (item: ImageReviewItem, action: ImageReviewAction) => {
    setImageReviewUpdating(item.evidence_id);
    setImageReviewError('');
    try {
      await updateImageReview(activeSourceKey, item.evidence_id, { action });
      await refreshImageReviews();
      void refresh();
    } catch (err) {
      setImageReviewError((err as Error).message || '提交图片确认失败');
    } finally {
      setImageReviewUpdating('');
    }
  };

  const recentLessons = useMemo(
    () => [...(payload?.lesson_runs ?? [])].sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '')),
    [payload],
  );

  const latestLesson = recentLessons[0] ?? null;
  const latestMerge = payload?.merge_runs[0] ?? null;
  const successRate = payload?.summary.lesson_runs
    ? payload.summary.qa_passed / Math.max(payload.summary.lesson_runs, 1)
    : 0;

  return (
    <main className="flex min-h-0 flex-1 flex-col bg-void">
      <div className="border-b border-border-subtle bg-surface px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-accent">抽取控制台</span>
              <span className="text-xs text-text-muted">数据源：{activeSourceKey}</span>
            </div>
            <h1 className="text-xl font-semibold tracking-tight text-text-primary">教材知识抽取与合并运行台</h1>
            <p className="mt-1 text-sm text-text-secondary">从 PDF、源 Markdown 或 MinerU 任务入口启动抽取，并跟踪课时运行、合并复核和质量状态。</p>
          </div>
          <button
            type="button"
            onClick={() => {
              void refresh();
              void refreshImageReviews();
            }}
            className="flex h-9 items-center gap-2 rounded-md border border-border-subtle bg-elevated px-3 text-xs font-medium text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            刷新状态
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-4 scrollbar-thin sm:p-6">
        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-node-event/40 bg-node-event/10 p-3 text-sm text-node-event">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)_340px]">
          <section className="min-w-0 overflow-hidden rounded-lg border border-border-subtle bg-elevated">
            <div className="border-b border-border-subtle p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-text-primary">启动抽取</div>
                  <div className="mt-1 text-xs text-text-muted">后端会创建后台任务并返回日志路径。</div>
                </div>
                <StatusPill status={starting ? 'running' : startResult?.status || 'ready'} />
              </div>
            </div>

            <form onSubmit={submitStart} className="space-y-4 p-4">
              <div className="grid grid-cols-3 overflow-hidden rounded-md border border-border-subtle bg-surface text-xs">
                {([
                  ['pdf', 'PDF'],
                  ['markdown', 'Markdown'],
                  ['mineru', 'MinerU'],
                ] as Array<[IntakeMode, string]>).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setIntakeMode(mode)}
                    aria-pressed={intakeMode === mode}
                    className={`px-3 py-2 font-medium transition-colors ${
                      intakeMode === mode ? 'bg-accent text-white' : 'text-text-secondary hover:bg-hover hover:text-text-primary'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              <div className="grid gap-3">
                <Field label="教材编号" value={form.book_id} onChange={(value) => updateForm('book_id', value)} placeholder="chem-hukj-xb2-structure" />
                <Field label="教材标题" value={form.book_title} onChange={(value) => updateForm('book_title', value)} placeholder="自动识别或手动填写" />

                {intakeMode === 'pdf' && (
                  <Field label="PDF 绝对路径" value={form.pdf_path} onChange={(value) => updateForm('pdf_path', value)} placeholder="/Users/.../book.pdf" />
                )}

                {intakeMode === 'markdown' && (
                  <Field label="源 Markdown 路径" value={form.source_markdown_path} onChange={(value) => updateForm('source_markdown_path', value)} placeholder="/Users/.../full.md" />
                )}

                {intakeMode === 'mineru' && (
                  <>
                    <Field label="PDF 绝对路径" value={form.pdf_path} onChange={(value) => updateForm('pdf_path', value)} placeholder="本地上传 MinerU 时使用" />
                    <Field label="MinerU 文件 URL" value={form.mineru_file_url} onChange={(value) => updateForm('mineru_file_url', value)} placeholder="已有公网文件地址时填写" />
                    <div className="grid grid-cols-2 gap-3">
                      <Field label="页码范围" value={form.mineru_page_ranges} onChange={(value) => updateForm('mineru_page_ranges', value)} placeholder="1-80" />
                      <SelectField
                        label="语言"
                        value={form.mineru_language}
                        onChange={(value) => updateForm('mineru_language', value)}
                        options={[
                          { value: 'ch', label: '中文' },
                          { value: 'en', label: '英文' },
                        ]}
                      />
                    </div>
                  </>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <Field label="目录起始页" value={form.outline_start_page} onChange={(value) => updateForm('outline_start_page', value)} inputMode="numeric" />
                  <Field label="目录结束页" value={form.outline_end_page} onChange={(value) => updateForm('outline_end_page', value)} inputMode="numeric" />
                </div>
              </div>

              <div className="rounded-lg border border-border-subtle bg-surface p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-xs font-medium text-text-primary">教材信息</div>
                  <button
                    type="button"
                    onClick={() => void submitInfer()}
                    disabled={inferring || !form.book_id.trim()}
                    className="flex h-7 items-center gap-1.5 rounded-md border border-border-subtle bg-elevated px-2 text-[11px] text-text-secondary transition-colors hover:bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {inferring ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
                    自动识别
                  </button>
                </div>
                <div className="grid grid-cols-3 gap-2">
                  <Field label="学科" value={form.lesson_subject} onChange={(value) => updateForm('lesson_subject', value)} placeholder="chemistry" />
                  <SelectField
                    label="学段"
                    value={form.lesson_school_stage}
                    onChange={(value) => updateForm('lesson_school_stage', value)}
                    options={[
                      { value: '', label: '自动' },
                      { value: 'primary', label: '小学' },
                      { value: 'junior-secondary', label: '初中' },
                      { value: 'senior-secondary', label: '高中' },
                      { value: 'higher', label: '高等教育' },
                    ]}
                  />
                  <Field label="年级" value={form.lesson_grade_band} onChange={(value) => updateForm('lesson_grade_band', value)} placeholder="grade11" />
                </div>
                {metadata && (
                  <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] text-text-muted">
                    <span className="rounded-full border border-border-subtle bg-elevated px-1.5 py-0.5">置信度 {percentValue(metadata.confidence)}</span>
                    {metadata.signals.slice(0, 5).map((signal) => (
                      <span key={signal} className="rounded-full border border-border-subtle bg-elevated px-1.5 py-0.5">{signal}</span>
                    ))}
                  </div>
                )}
              </div>

              <button
                type="button"
                onClick={() => setShowAdvanced((value) => !value)}
                className="flex w-full items-center justify-between rounded-md border border-border-subtle bg-surface px-3 py-2 text-left text-xs font-medium text-text-secondary transition-colors hover:bg-hover hover:text-text-primary"
                aria-expanded={showAdvanced}
              >
                高级参数
                <ChevronRight className={`h-3.5 w-3.5 transition-transform ${showAdvanced ? 'rotate-90' : ''}`} />
              </button>

              {showAdvanced && (
                <div className="grid gap-3 rounded-lg border border-border-subtle bg-surface p-3">
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="输出目录" value={form.output_root} onChange={(value) => updateForm('output_root', value)} />
                    <Field label="并行数" value={form.parallelism} onChange={(value) => updateForm('parallelism', value)} inputMode="numeric" />
                  </div>
                  <SelectField<PipelineLessonBackendKind>
                    label="模型接口"
                    value={form.lesson_backend_kind}
                    onChange={(value) => updateForm('lesson_backend_kind', value)}
                    options={[
                      { value: 'openai_responses', label: 'OpenAI Responses' },
                      { value: 'openai_chat_completions', label: 'Chat Completions' },
                    ]}
                  />
                  <Field label="OpenAI Base URL" value={form.openai_base_url} onChange={(value) => updateForm('openai_base_url', value)} placeholder="默认使用环境配置" />
                  <Field label="模型名称" value={form.openai_model} onChange={(value) => updateForm('openai_model', value)} placeholder="默认由后端决定" />
                  <Field label="VLM API URL" value={form.vlm_api_url} onChange={(value) => updateForm('vlm_api_url', value)} placeholder="例如 http://localhost:8000/v1/chat/completions" />
                  <Field label="VLM API Key" value={form.vlm_api_key} onChange={(value) => updateForm('vlm_api_key', value)} placeholder="留空则使用后端环境变量" type="password" />
                  <Field label="VLM 模型名称" value={form.vlm_model} onChange={(value) => updateForm('vlm_model', value)} placeholder="例如 gpt-4.1-mini 或 qwen-vl-max" />
                  {intakeMode === 'mineru' && (
                    <>
                      <Field label="MinerU Base URL" value={form.mineru_base_url} onChange={(value) => updateForm('mineru_base_url', value)} />
                      <Field label="MinerU 模型版本" value={form.mineru_model_version} onChange={(value) => updateForm('mineru_model_version', value)} />
                      <label className="flex items-center gap-2 text-xs text-text-secondary">
                        <input
                          type="checkbox"
                          checked={form.mineru_force}
                          onChange={(event) => updateForm('mineru_force', event.target.checked)}
                          className="h-4 w-4 accent-[var(--color-accent)]"
                        />
                        强制重新生成 MinerU 源 Markdown
                      </label>
                    </>
                  )}
                </div>
              )}

              <div className="grid gap-3 rounded-lg border border-border-subtle bg-surface p-3 text-xs text-text-secondary">
                <div className="flex items-center justify-between gap-3">
                  <span>入口状态</span>
                  <span className={sourceReady(intakeMode, form) ? 'text-node-process' : 'text-node-event'}>{sourceReadyLabel(intakeMode, form)}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span>目标数据集</span>
                  <span className="truncate text-text-primary">{activeSourceKey}</span>
                </div>
              </div>

              {startError && (
                <div className="flex items-start gap-2 rounded-lg border border-node-event/40 bg-node-event/10 p-3 text-xs text-node-event">
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{startError}</span>
                </div>
              )}

              {startResult && (
                <div className="rounded-lg border border-node-process/40 bg-node-process/10 p-3 text-xs text-text-secondary">
                  <div className="font-medium text-node-process">任务已启动：{startResult.job_id}</div>
                  <div className="mt-1 truncate">日志：{startResult.log_path}</div>
                </div>
              )}

              <button
                type="submit"
                disabled={!canStart}
                className="flex h-10 w-full items-center justify-center gap-2 rounded-md bg-accent px-4 text-sm font-semibold text-white transition-colors hover:bg-accent-dim disabled:cursor-not-allowed disabled:bg-surface disabled:text-text-muted"
              >
                {starting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
                启动抽取任务
              </button>
            </form>
          </section>

          <section className="min-w-0 space-y-5">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MetricCard label="课时运行" value={payload?.summary.lesson_runs ?? 0} detail={latestLesson ? `最近：${timeText(latestLesson.updated_at)}` : '暂无运行'} />
              <MetricCard label="已暂存" value={payload?.summary.staged ?? 0} tone="active" detail="等待合并或质检" />
              <MetricCard label="已通过 QA" value={payload?.summary.qa_passed ?? 0} tone="ok" detail={`通过率 ${percentValue(successRate)}`} />
              <MetricCard label="阻断项" value={payload?.summary.blocked ?? 0} tone={(payload?.summary.blocked ?? 0) > 0 ? 'warn' : 'neutral'} detail="需要人工处理" />
            </div>

            <ImageReviewPanel
              reviews={imageReviews}
              loading={imageReviewLoading}
              error={imageReviewError}
              updatingId={imageReviewUpdating}
              onRefresh={() => void refreshImageReviews()}
              onAction={(item, action) => void submitImageReview(item, action)}
            />

            <div className="overflow-hidden rounded-lg border border-border-subtle bg-elevated">
              <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
                <div className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4 text-accent" />
                  <div>
                    <div className="text-sm font-semibold text-text-primary">课时运行记录</div>
                    <div className="text-[11px] text-text-muted">按更新时间倒序展示最近任务。</div>
                  </div>
                </div>
                {loading && <Loader2 className="h-4 w-4 animate-spin text-accent" />}
              </div>
              <div className="max-h-[560px] overflow-auto scrollbar-thin">
                <table className="w-full min-w-[760px] text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-elevated text-text-muted">
                    <tr>
                      <th className="px-3 py-2 font-medium">状态</th>
                      <th className="px-3 py-2 font-medium">课时锚点</th>
                      <th className="px-3 py-2 font-medium">节点</th>
                      <th className="px-3 py-2 font-medium">边</th>
                      <th className="px-3 py-2 font-medium">证据</th>
                      <th className="px-3 py-2 font-medium">更新时间</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentLessons.map((row) => (
                      <tr key={row.lesson_run_id} className="border-t border-border-subtle transition-colors hover:bg-hover">
                        <td className="px-3 py-2"><StatusPill status={row.status} /></td>
                        <td className="max-w-[320px] px-3 py-2">
                          <div className="truncate font-medium text-text-primary" title={row.batch_anchor}>{row.batch_anchor}</div>
                          {row.quality_issues.length > 0 && (
                            <div className="mt-1 truncate text-[10px] text-node-event">{row.quality_issues[0]}</div>
                          )}
                        </td>
                        <td className="px-3 py-2 tabular-nums text-text-secondary">{numberValue(row.counts.nodes)}</td>
                        <td className="px-3 py-2 tabular-nums text-text-secondary">{numberValue(row.counts.edges)}</td>
                        <td className="px-3 py-2 tabular-nums text-text-secondary">{numberValue(row.counts.evidence)}</td>
                        <td className="px-3 py-2 text-text-muted">{timeText(row.updated_at)}</td>
                      </tr>
                    ))}
                    {!loading && recentLessons.length === 0 && (
                      <tr>
                        <td colSpan={6} className="px-3 py-12 text-center text-text-muted">暂无课时运行记录。可以从左侧启动第一轮抽取。</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>

          <aside className="min-w-0 space-y-5">
            <section className="rounded-lg border border-border-subtle bg-elevated p-4">
              <div className="mb-3 flex items-center gap-2">
                <Info className="h-4 w-4 text-accent" />
                <div className="text-sm font-semibold text-text-primary">连接状态</div>
              </div>
              <div className="space-y-3 text-xs">
                <div className="flex items-center justify-between gap-3">
                  <span className="text-text-muted">状态接口</span>
                  <span className={payload ? 'text-node-process' : error ? 'text-node-event' : 'text-text-secondary'}>
                    {payload ? '已连接' : error ? '异常' : '等待中'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-text-muted">启动接口</span>
                  <span className="text-node-process">已接入</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-text-muted">合并运行</span>
                  <span className="text-text-primary">{payload?.merge_runs.length ?? 0}</span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-text-muted">最近更新时间</span>
                  <span className="truncate text-text-primary">{latestLesson ? timeText(latestLesson.updated_at) : '暂无'}</span>
                </div>
              </div>
            </section>

            <section className="rounded-lg border border-border-subtle bg-elevated p-4">
              <div className="mb-3 flex items-center gap-2">
                <GitBranch className="h-4 w-4 text-accent" />
                <div className="text-sm font-semibold text-text-primary">最近合并</div>
              </div>
              {latestMerge ? (
                <div className="rounded-lg border border-border-subtle bg-surface p-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate text-xs font-medium text-text-primary">{latestMerge.merge_run_id}</div>
                    <StatusPill status={latestMerge.status} />
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-[10px] text-text-muted">
                    <span>新建 {numberValue(latestMerge.stats.nodes_created)}</span>
                    <span>匹配 {numberValue(latestMerge.stats.nodes_matched)}</span>
                    <span>复核 {numberValue(latestMerge.stats.nodes_review)}</span>
                  </div>
                  <div className="mt-2 text-[10px] text-text-muted">{timeText(latestMerge.updated_at)}</div>
                </div>
              ) : (
                <div className="rounded-lg border border-border-subtle bg-surface p-3 text-xs text-text-muted">暂无合并运行记录。</div>
              )}
            </section>

            <section className="rounded-lg border border-border-subtle bg-elevated p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="text-sm font-semibold text-text-primary">待复核合并</div>
                <span className="text-xs text-text-muted">{payload?.review_items.length ?? 0}</span>
              </div>
              <ReviewList items={payload?.review_items ?? []} />
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
