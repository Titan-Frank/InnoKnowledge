import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type {
  ImageReviewAction,
  ImageReviewItem,
  ImageReviewResponse,
  PipelineJobStatusResponse,
  PipelineExtractionTemplateId,
  PipelineLessonBackendKind,
  PipelineQualityDashboardResponse,
  PipelineResponse,
  PipelineReviewItem,
  PipelineStartResponse,
  TextbookMetadataResponse,
} from '@okm/types';
import {
  inferTextbookMetadata,
  loadPipelineJobStatus,
  loadImageReviews,
  loadPipeline,
  loadPipelineQuality,
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
  Network,
  Play,
  RotateCcw,
  Search,
} from '@/lib/lucide-icons';

type PipelineForm = {
  book_id: string;
  book_title: string;
  pdf_path: string;
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
  extraction_template: PipelineExtractionTemplateId;
  quality_retry_count: string;
  model_retry_count: string;
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

type PipelineStepStatus = 'complete' | 'active' | 'blocked' | 'pending';

type PipelineStep = {
  id: string;
  label: string;
  detail: string;
  status: PipelineStepStatus;
};

const initialForm: PipelineForm = {
  book_id: '',
  book_title: '',
  pdf_path: '',
  mineru_file_url: '',
  mineru_base_url: 'https://mineru.net',
  mineru_model_version: 'vlm',
  mineru_language: 'auto',
  mineru_page_ranges: '',
  mineru_force: false,
  outline_start_page: '',
  outline_end_page: '',
  output_root: 'data/main',
  parallelism: '8',
  extraction_template: 'auto',
  quality_retry_count: '1',
  model_retry_count: '2',
  lesson_subject: '',
  lesson_school_stage: '',
  lesson_grade_band: '',
  lesson_backend_kind: 'openai_chat_completions',
  openai_base_url: '',
  openai_model: '',
  vlm_api_url: '',
  vlm_api_key: '',
  vlm_model: '',
};

const EXTRACTION_TEMPLATE_OPTIONS = [
  { value: 'auto', label: '自动选择' },
  { value: 'textbook/physics', label: '物理教材' },
  { value: 'textbook/chemistry', label: '化学教材' },
  { value: 'textbook/biology', label: '生物教材' },
  { value: 'textbook/general', label: '通用教材' },
];

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

function optionalNumber(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;
  return Math.floor(parsed);
}

function optionalAutoString(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed && trimmed !== 'auto' ? trimmed : undefined;
}

function shouldUseInferredValue(currentValue: string, previousValue: string | undefined): boolean {
  return !currentValue.trim() || Boolean(previousValue && currentValue === previousValue);
}

function templateLabel(value: string | undefined): string {
  if (!value || value === 'auto') return '自动选择';
  return EXTRACTION_TEMPLATE_OPTIONS.find((option) => option.value === value)?.label ?? value;
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
    ready: '就绪',
    unknown: '未知',
  };
  return labels[status] || status || '未知';
}

function statusTone(status: string): 'ok' | 'warn' | 'active' | 'neutral' {
  if (status === 'qa_passed' || status === 'completed' || status === 'success' || status === 'merged') return 'ok';
  if (status === 'blocked' || status === 'failed') return 'warn';
  if (status === 'running' || status === 'started' || status === 'merging' || status === 'staged') return 'active';
  return 'neutral';
}

function stepTone(status: PipelineStepStatus): string {
  if (status === 'complete') return 'border-node-process/40 bg-node-process/10 text-node-process';
  if (status === 'blocked') return 'border-node-event/40 bg-node-event/10 text-node-event';
  if (status === 'active') return 'border-accent/50 bg-accent/10 text-accent';
  return 'border-border-subtle bg-surface text-text-muted';
}

function stepDotTone(status: PipelineStepStatus): string {
  if (status === 'complete') return 'border-node-process bg-node-process text-white';
  if (status === 'blocked') return 'border-node-event bg-node-event text-white';
  if (status === 'active') return 'border-accent bg-accent text-white';
  return 'border-border-subtle bg-elevated text-text-muted';
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

          <div className="grid overflow-hidden lg:h-[520px] lg:grid-cols-[minmax(0,1fr)_390px] xl:grid-cols-[minmax(0,1fr)_420px]">
            <div className="relative flex min-h-[320px] items-center justify-center bg-void p-3 sm:min-h-[380px] lg:min-h-0">
              <button
                type="button"
                onClick={showPrevious}
                disabled={!canSwitch}
                aria-label="上一张待确认图片"
                className="absolute left-3 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-border-subtle bg-elevated/90 text-text-secondary shadow-sm transition-colors hover:bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4 rotate-180" />
              </button>
              {activeItem.image_url ? (
                <img
                  src={activeItem.image_url}
                  alt={activeHeading ? `待确认教材图片：${activeHeading}` : '待确认教材图片'}
                  className="h-full w-full rounded-sm object-contain"
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
                className="absolute right-3 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 cursor-pointer items-center justify-center rounded-full border border-border-subtle bg-elevated/90 text-text-secondary shadow-sm transition-colors hover:bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <aside className="flex min-h-0 flex-col border-t border-border-subtle bg-elevated/40 lg:border-l lg:border-t-0">
              <div className="flex flex-wrap gap-1.5 border-b border-border-subtle p-3 text-[10px] text-text-muted">
                <span className="rounded-full border border-border-subtle bg-surface px-2 py-0.5">{imageReviewRelevanceLabel(activeItem.decision.relevance)}</span>
                <span className="rounded-full border border-border-subtle bg-surface px-2 py-0.5">{imageReviewConfidenceText(activeItem.decision.confidence)}</span>
                {activeSizeText && (
                  <span className="rounded-full border border-border-subtle bg-surface px-2 py-0.5">{activeSizeText}</span>
                )}
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-3 scrollbar-thin">
                <div className="space-y-4">
                  <section className="border-b border-border-subtle pb-3">
                    <div className="mb-2 text-[10px] font-medium text-text-muted">出现位置</div>
                    <dl className="space-y-1.5 text-[11px] leading-5 text-text-secondary">
                      {activeHeading && (
                        <div className="grid grid-cols-[42px_minmax(0,1fr)] gap-2">
                          <dt className="text-text-muted">标题</dt>
                          <dd className="min-w-0 break-words" title={activeHeading}>{activeHeading}</dd>
                        </div>
                      )}
                      <div className="grid grid-cols-[42px_minmax(0,1fr)] gap-2">
                        <dt className="text-text-muted">位置</dt>
                        <dd className="min-w-0 break-words" title={imageReviewLocation(activeItem)}>
                          {imageReviewLocation(activeItem)}
                          {activeItem.context?.source_line ? ` · 第 ${activeItem.context.source_line} 行` : ''}
                        </dd>
                      </div>
                      {activeSourcePath && (
                        <div className="grid grid-cols-[42px_minmax(0,1fr)] gap-2">
                          <dt className="text-text-muted">源文件</dt>
                          <dd className="min-w-0 break-all" title={activeSourcePath}>{compactPath(activeSourcePath)}</dd>
                        </div>
                      )}
                    </dl>
                  </section>

                  {activeContextLines.length > 0 && (
                    <section className="border-b border-border-subtle pb-3">
                      <div className="mb-2 text-[10px] font-medium text-text-muted">上下文</div>
                      <div className="space-y-1.5 text-[11px] leading-5">
                        {activeContextLines.map((entry, index) => (
                          <div
                            key={`${entry.label}:${index}`}
                            className={`grid grid-cols-[34px_minmax(0,1fr)] gap-2 rounded-md px-2 py-1 ${
                              entry.active
                                ? 'border border-accent/40 bg-accent/10 text-text-primary'
                                : 'text-text-secondary'
                            }`}
                          >
                            <span className={entry.active ? 'font-medium text-accent' : 'text-text-muted'}>{entry.label}</span>
                            <span className="min-w-0 break-words">{entry.line}</span>
                          </div>
                        ))}
                      </div>
                    </section>
                  )}

                  <section className="border-b border-border-subtle pb-3">
                    <div className="mb-2 text-[10px] font-medium text-text-muted">模型识别内容</div>
                    <div className="whitespace-pre-wrap break-words text-[11px] leading-5 text-text-secondary">
                      {activeItem.decision.visual_summary || '当前记录没有保存模型识别内容。重新进行图片判断后会显示。'}
                    </div>
                  </section>

                  <section className="border-b border-border-subtle pb-3">
                    <div className="mb-2 text-[10px] font-medium text-text-muted">判断说明</div>
                    <div className="whitespace-pre-wrap break-words text-[11px] leading-5 text-text-secondary">
                      {activeItem.decision.reason || '缺少判断说明。'}
                    </div>
                  </section>

                  {activeItem.excerpt && (
                    <section>
                      <div className="mb-2 text-[10px] font-medium text-text-muted">证据摘录</div>
                      <div className="whitespace-pre-wrap break-words text-[11px] leading-5 text-text-secondary">
                        {activeItem.excerpt}
                      </div>
                    </section>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2 border-t border-border-subtle p-3">
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
            </aside>
          </div>
        </div>
      )}
    </section>
  );
}

function sourceReadyLabel(form: PipelineForm): string {
  if (form.pdf_path.trim()) return 'PDF 已填写，其他参数自动处理';
  if (form.mineru_file_url.trim()) return 'MinerU 文件 URL 已填写，其他参数自动处理';
  return '需要 PDF 绝对路径或 MinerU 文件 URL';
}

function sourceReady(form: PipelineForm): boolean {
  return Boolean(form.pdf_path.trim() || form.mineru_file_url.trim());
}

function latestUpdatedAt(payload: PipelineResponse | null): string | null {
  const times = [
    ...(payload?.lesson_runs ?? []).map((row) => row.updated_at),
    ...(payload?.merge_runs ?? []).map((row) => row.updated_at),
  ].filter(Boolean) as string[];
  return times.sort().at(-1) ?? null;
}

function hasRunningPipeline(payload: PipelineResponse | null): boolean {
  if (!payload) return false;
  return (
    payload.summary.staged > 0 ||
    payload.summary.merging > 0 ||
    payload.merge_runs.some((row) => row.status === 'in_progress')
  );
}

function pipelineBlocked(payload: PipelineResponse | null): boolean {
  if (!payload) return false;
  const latestMerge = payload.merge_runs[0] ?? null;
  return payload.summary.blocked > 0 || latestMerge?.status === 'blocked';
}

function pipelineComplete(payload: PipelineResponse | null): boolean {
  if (!payload || payload.summary.lesson_runs === 0) return false;
  const latestMerge = payload.merge_runs[0] ?? null;
  return payload.summary.blocked === 0 && (payload.summary.qa_passed > 0 || latestMerge?.status === 'completed');
}

function reviewCount(payload: PipelineResponse | null, imageReviews: ImageReviewResponse | null): number {
  return (payload?.review_items.length ?? 0) + (imageReviews?.pending ?? 0);
}

const stageLabels: Record<string, string> = {
  check_postgres: '检查数据库',
  mineru_source_markdown: 'MinerU 解析 PDF',
  extract_pdf_outline: '读取 PDF 目录',
  prepare_source_markdown: '准备解析文本',
  ensure_outline: '生成教材目录',
  prepare_outline_chunks: '切分课时',
  lesson_plan: '生成抽取任务',
  lesson_staging: '模型抽取课时',
  staging_quality: '检查暂存质量',
  canonical_commit: '合并入正式图谱',
  normalize: '归一化知识对象',
  node_bodies: '生成知识正文',
  strict_qa: '严格质检',
  graph_integrity: '图谱完整性检查',
  quality_dashboard: '生成质量仪表盘',
};

const sourceStageIds = ['check_postgres', 'mineru_source_markdown', 'prepare_source_markdown'];
const outlineStageIds = ['extract_pdf_outline', 'ensure_outline', 'prepare_outline_chunks', 'lesson_plan'];
const lessonStageIds = ['lesson_staging'];
const mergeStageIds = ['staging_quality', 'canonical_commit', 'normalize', 'node_bodies', 'strict_qa', 'graph_integrity', 'quality_dashboard'];

function stageLabel(stageId: string | undefined): string {
  if (!stageId) return '';
  return stageLabels[stageId] || stageId;
}

function stageIn(stage: PipelineJobStatusResponse['current_stage'], ids: string[]): boolean {
  return Boolean(stage?.id && ids.includes(stage.id));
}

function hasStageStatus(jobStatus: PipelineJobStatusResponse | null, ids: string[], status: string): boolean {
  return Boolean(jobStatus?.stages.some((stage) => ids.includes(stage.id) && stage.status === status));
}

function buildPipelineSteps(input: {
  payload: PipelineResponse | null;
  imageReviews: ImageReviewResponse | null;
  jobStatus: PipelineJobStatusResponse | null;
  starting: boolean;
  startResult: PipelineStartResponse | null;
}): PipelineStep[] {
  const { payload, imageReviews, jobStatus, starting, startResult } = input;
  const launched = starting || Boolean(startResult);
  const lessonCount = payload?.summary.lesson_runs ?? 0;
  const qaPassed = payload?.summary.qa_passed ?? 0;
  const latestMerge = payload?.merge_runs[0] ?? null;
  const blocked = pipelineBlocked(payload);
  const complete = pipelineComplete(payload);
  const reviews = reviewCount(payload, imageReviews);
  const currentStage = jobStatus?.current_stage ?? null;
  const currentStageText = currentStage ? `正在${stageLabel(currentStage.id)}` : '';
  const jobBlocked = jobStatus?.status === 'blocked';
  const sourceBlocked = hasStageStatus(jobStatus, sourceStageIds, 'blocked');
  const outlineBlocked = hasStageStatus(jobStatus, outlineStageIds, 'blocked');
  const lessonBlocked = hasStageStatus(jobStatus, lessonStageIds, 'blocked');
  const mergeBlocked = hasStageStatus(jobStatus, mergeStageIds, 'blocked');
  const lessonStage = findJobStage(jobStatus, lessonStageIds);
  const lessonRuntimeDetail = lessonStage ? lessonProgressText(lessonStage, jobStatus) : '';
  const sourceComplete = hasStageStatus(jobStatus, sourceStageIds, 'completed') || lessonCount > 0;
  const outlineComplete = hasStageStatus(jobStatus, ['lesson_plan'], 'completed') || lessonCount > 0;
  const lessonComplete = hasStageStatus(jobStatus, lessonStageIds, 'completed') || qaPassed > 0;
  const mergeComplete = hasStageStatus(jobStatus, ['graph_integrity'], 'completed') || complete;

  return [
    {
      id: 'source',
      label: 'PDF 与 MinerU',
      detail: stageIn(currentStage, sourceStageIds) ? currentStageText : sourceComplete ? '源文件已经准备完成' : '等待填写 PDF 或 MinerU 文件 URL',
      status: sourceBlocked || (jobBlocked && stageIn(currentStage, sourceStageIds))
        ? 'blocked'
        : stageIn(currentStage, sourceStageIds)
          ? 'active'
          : sourceComplete
            ? 'complete'
            : launched
              ? 'active'
              : 'pending',
    },
    {
      id: 'outline',
      label: '目录与切分',
      detail: stageIn(currentStage, outlineStageIds) ? currentStageText : outlineComplete ? '课时任务已经生成' : '等待目录和切分',
      status: outlineBlocked || (jobBlocked && stageIn(currentStage, outlineStageIds))
        ? 'blocked'
        : stageIn(currentStage, outlineStageIds)
          ? 'active'
          : outlineComplete
            ? 'complete'
            : 'pending',
    },
    {
      id: 'lesson',
      label: '模型抽取',
      detail: stageIn(currentStage, lessonStageIds) && lessonRuntimeDetail
        ? lessonRuntimeDetail
        : lessonCount > 0
          ? `${lessonCount} 个课时任务，${qaPassed} 个已通过 QA`
          : '等待课时抽取写入结果',
      status: lessonBlocked || (blocked && lessonCount > 0)
        ? 'blocked'
        : stageIn(currentStage, lessonStageIds) || (lessonCount > 0 && qaPassed < lessonCount)
          ? 'active'
          : lessonComplete
            ? 'complete'
            : 'pending',
    },
    {
      id: 'merge',
      label: '合并与质检',
      detail: stageIn(currentStage, mergeStageIds) ? currentStageText : latestMerge ? `最近合并：${statusLabel(latestMerge.status)}` : '等待暂存结果合并',
      status: mergeBlocked || (blocked && !lessonBlocked)
        ? 'blocked'
        : stageIn(currentStage, mergeStageIds) || hasRunningPipeline(payload)
          ? 'active'
          : mergeComplete
            ? 'complete'
            : 'pending',
    },
    {
      id: 'review',
      label: '人工确认',
      detail: reviews > 0 ? `${reviews} 项需要确认` : complete ? '暂无待确认项' : '抽取完成后显示待确认项',
      status: reviews > 0 ? 'active' : complete ? 'complete' : 'pending',
    },
  ];
}

function findJobStage(jobStatus: PipelineJobStatusResponse | null, ids: string[]): PipelineJobStatusResponse['stages'][number] | null {
  return jobStatus?.stages.find((stage) => ids.includes(stage.id)) ?? null;
}

function progressNumber(stage: PipelineJobStatusResponse['stages'][number] | null | undefined, key: string): number {
  const value = stage?.progress?.[key];
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function progressPercent(stage: PipelineJobStatusResponse['stages'][number] | null | undefined): number {
  const explicit = Number(stage?.progress?.percent);
  if (Number.isFinite(explicit)) return Math.max(0, Math.min(1, explicit));
  const total = progressNumber(stage, 'total_units');
  if (total <= 0) return 0;
  return Math.max(0, Math.min(1, (progressNumber(stage, 'completed') + progressNumber(stage, 'failed')) / total));
}

function runningLessonWorkers(jobStatus: PipelineJobStatusResponse | null): PipelineJobStatusResponse['worker_states'] {
  return (jobStatus?.worker_states ?? []).filter((worker) => worker.stage_id === 'lesson_staging' && worker.status === 'running');
}

function lessonProgressText(
  stage: PipelineJobStatusResponse['stages'][number],
  jobStatus: PipelineJobStatusResponse | null,
): string {
  const total = progressNumber(stage, 'total_units');
  const completed = progressNumber(stage, 'completed');
  const failed = progressNumber(stage, 'failed');
  const percent = Math.round(progressPercent(stage) * 100);
  const running = runningLessonWorkers(jobStatus);
  const current = running.map((worker) => worker.batch_anchor).filter(Boolean).slice(0, 2).join('、');
  const base = total > 0 ? `${completed + failed}/${total}，${percent}%` : stageLabel(stage.id);
  if (current) return `${base}，正在处理：${current}`;
  if (failed > 0) return `${base}，${failed} 个失败`;
  return base;
}

function lessonEventLabel(eventType: string): string {
  const labels: Record<string, string> = {
    lesson_started: '开始处理',
    lesson_completed: '处理完成',
    lesson_failed: '处理失败',
  };
  return labels[eventType] || eventType;
}

function currentStepText(steps: PipelineStep[]): string {
  const blocked = steps.find((step) => step.status === 'blocked');
  if (blocked) return `当前阻断在：${blocked.label}`;
  const active = steps.find((step) => step.status === 'active');
  if (active) return `当前步骤：${active.label}`;
  if (steps.every((step) => step.status === 'complete')) return '当前步骤：已完成';
  return '当前步骤：等待启动';
}

function PipelineStepIcon({ status }: { status: PipelineStepStatus }) {
  if (status === 'complete') return <Check className="h-3.5 w-3.5" />;
  if (status === 'blocked') return <AlertCircle className="h-3.5 w-3.5" />;
  if (status === 'active') return <Loader2 className="h-3.5 w-3.5 animate-spin" />;
  return <span className="h-1.5 w-1.5 rounded-full bg-current" />;
}

function PipelineProgressPanel({
  steps,
  jobStatus,
  autoRefreshing,
  lastUpdatedAt,
}: {
  steps: PipelineStep[];
  jobStatus: PipelineJobStatusResponse | null;
  autoRefreshing: boolean;
  lastUpdatedAt: string | null;
}) {
  const lessonStage = findJobStage(jobStatus, lessonStageIds);
  const lessonPercent = progressPercent(lessonStage);
  const lessonTotal = progressNumber(lessonStage, 'total_units');
  const lessonCompleted = progressNumber(lessonStage, 'completed');
  const lessonFailed = progressNumber(lessonStage, 'failed');
  const runningWorkers = runningLessonWorkers(jobStatus);
  const recentLessonEvents = (jobStatus?.recent_events ?? [])
    .filter((event) => event.stage_id === 'lesson_staging')
    .slice(0, 5);

  return (
    <section className="rounded-lg border border-border-subtle bg-elevated p-4" aria-live="polite">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-text-primary">抽取步骤</div>
          <div className="mt-1 text-xs text-text-muted">{currentStepText(steps)}</div>
        </div>
        <div className="flex items-center gap-2 rounded-full border border-border-subtle bg-surface px-2.5 py-1 text-[11px] text-text-muted">
          {autoRefreshing ? <Loader2 className="h-3 w-3 animate-spin text-accent" /> : <Check className="h-3 w-3 text-node-process" />}
          {autoRefreshing ? '实时刷新中' : lastUpdatedAt ? `最近更新 ${timeText(lastUpdatedAt)}` : '等待数据'}
        </div>
      </div>
      <div className="grid gap-2 md:grid-cols-5">
        {steps.map((step, index) => (
          <div key={step.id} className={`min-h-[116px] rounded-lg border p-3 transition-colors ${stepTone(step.status)}`}>
            <div className="mb-3 flex items-center justify-between gap-2">
              <div className={`flex h-7 w-7 items-center justify-center rounded-full border ${stepDotTone(step.status)}`}>
                <PipelineStepIcon status={step.status} />
              </div>
              <span className="text-[10px] font-medium text-text-muted">{String(index + 1).padStart(2, '0')}</span>
            </div>
            <div className="text-xs font-semibold text-text-primary">{step.label}</div>
            <div className="mt-1.5 text-[11px] leading-5 text-text-secondary">{step.detail}</div>
          </div>
        ))}
      </div>
      {lessonStage && (
        <div className="mt-4 rounded-lg border border-border-subtle bg-surface p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="text-xs font-semibold text-text-primary">课时抽取细节</div>
              <div className="mt-1 text-[11px] text-text-muted">{lessonProgressText(lessonStage, jobStatus)}</div>
            </div>
            <StatusPill status={lessonStage.status} />
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-elevated">
            <div
              className={`h-full rounded-full bg-accent transition-all duration-500 ${lessonStage.status === 'running' ? 'animate-pulse' : ''}`}
              style={{ width: `${Math.round(lessonPercent * 100)}%` }}
            />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] sm:grid-cols-4">
            <div className="rounded-md border border-border-subtle bg-elevated px-2 py-1.5">
              <div className="text-text-muted">总课时</div>
              <div className="mt-0.5 font-semibold tabular-nums text-text-primary">{lessonTotal}</div>
            </div>
            <div className="rounded-md border border-border-subtle bg-elevated px-2 py-1.5">
              <div className="text-text-muted">已完成</div>
              <div className="mt-0.5 font-semibold tabular-nums text-node-process">{lessonCompleted}</div>
            </div>
            <div className="rounded-md border border-border-subtle bg-elevated px-2 py-1.5">
              <div className="text-text-muted">失败</div>
              <div className="mt-0.5 font-semibold tabular-nums text-node-event">{lessonFailed}</div>
            </div>
            <div className="rounded-md border border-border-subtle bg-elevated px-2 py-1.5">
              <div className="text-text-muted">进度</div>
              <div className="mt-0.5 font-semibold tabular-nums text-accent">{Math.round(lessonPercent * 100)}%</div>
            </div>
          </div>
          {(runningWorkers.length > 0 || recentLessonEvents.length > 0) && (
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <div>
                <div className="mb-1.5 text-[10px] font-medium text-text-muted">正在处理</div>
                <div className="space-y-1.5">
                  {runningWorkers.length > 0 ? runningWorkers.slice(0, 6).map((worker) => (
                    <div key={worker.worker_slot} className="flex min-w-0 items-center gap-2 rounded-md border border-accent/30 bg-accent/10 px-2 py-1.5 text-[11px] text-text-secondary">
                      <Loader2 className="h-3 w-3 shrink-0 animate-spin text-accent" />
                      <span className="shrink-0 tabular-nums text-accent">任务 {worker.worker_slot}</span>
                      <span className="min-w-0 truncate text-text-primary" title={worker.batch_anchor ?? ''}>{worker.batch_anchor || '课时未知'}</span>
                    </div>
                  )) : (
                    <div className="rounded-md border border-border-subtle bg-elevated px-2 py-1.5 text-[11px] text-text-muted">暂无正在处理的课时。</div>
                  )}
                </div>
              </div>
              <div>
                <div className="mb-1.5 text-[10px] font-medium text-text-muted">最近事件</div>
                <div className="space-y-1.5">
                  {recentLessonEvents.length > 0 ? recentLessonEvents.map((event) => (
                    <div key={event.event_id} className="grid grid-cols-[56px_minmax(0,1fr)] gap-2 rounded-md border border-border-subtle bg-elevated px-2 py-1.5 text-[11px]">
                      <span className="text-text-muted">{lessonEventLabel(event.event_type)}</span>
                      <span className="min-w-0 truncate text-text-primary" title={event.batch_anchor ?? ''}>{event.batch_anchor || event.lesson_run_id || '课时未知'}</span>
                    </div>
                  )) : (
                    <div className="rounded-md border border-border-subtle bg-elevated px-2 py-1.5 text-[11px] text-text-muted">暂无课时事件。</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

function ManualReviewSummary({
  payload,
  imageReviews,
  pipelineDone,
}: {
  payload: PipelineResponse | null;
  imageReviews: ImageReviewResponse | null;
  pipelineDone: boolean;
}) {
  const imagePending = imageReviews?.pending ?? 0;
  const mergePending = payload?.review_items.length ?? 0;
  const total = imagePending + mergePending;
  return (
    <section className="rounded-lg border border-border-subtle bg-elevated p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-text-primary">人工确认</div>
          <div className="mt-1 text-xs text-text-muted">
            {total > 0 ? '抽取后需要人工处理的内容如下。' : pipelineDone ? '抽取结果暂时不需要人工确认。' : '抽取完成后这里会汇总待确认内容。'}
          </div>
        </div>
        <StatusPill status={total > 0 ? 'running' : pipelineDone ? 'completed' : 'ready'} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <MetricCard
          label="待确认图片"
          value={imagePending}
          tone={imagePending > 0 ? 'active' : 'neutral'}
          detail={imagePending > 0 ? '下方逐张确认' : '暂无图片待确认'}
        />
        <MetricCard
          label="待复核合并"
          value={mergePending}
          tone={mergePending > 0 ? 'warn' : 'neutral'}
          detail={mergePending > 0 ? '右侧查看候选节点' : '暂无合并待复核'}
        />
      </div>
    </section>
  );
}

function QualityDashboardPanel({
  quality,
  loading,
  error,
  onRefresh,
}: {
  quality: PipelineQualityDashboardResponse | null;
  loading: boolean;
  error: string;
  onRefresh: () => void;
}) {
  const summary = quality?.summary;
  const lessons = quality?.lessons ?? [];
  const lowCoverageCount = lessons.filter((row) => row.evidence_coverage < 0.8 && row.node_count + row.relation_count > 0).length;
  const highIsolationCount = lessons.filter((row) => row.isolated_node_ratio > 0.4 && row.node_count > 0).length;
  return (
    <section className="overflow-hidden rounded-lg border border-border-subtle bg-elevated">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
        <div className="flex items-center gap-2">
          <Network className="h-4 w-4 text-accent" />
          <div>
            <div className="text-sm font-semibold text-text-primary">质量仪表盘</div>
            <div className="text-[11px] text-text-muted">
              {quality ? `生成时间：${timeText(quality.generated_at)}` : '读取课时质量、证据覆盖和图连通性。'}
            </div>
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

      <div className="space-y-4 p-4">
        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-node-event/40 bg-node-event/10 p-3 text-xs text-node-event" role="alert">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MetricCard
            label="证据覆盖率"
            value={summary ? percentValue(summary.evidence_coverage) : '暂无'}
            tone={summary && summary.evidence_coverage < 0.8 ? 'warn' : 'ok'}
            detail={lowCoverageCount > 0 ? `${lowCoverageCount} 个课时低于 80%` : '节点和关系证据引用'}
          />
          <MetricCard
            label="孤立节点比例"
            value={summary ? percentValue(summary.isolated_node_ratio) : '暂无'}
            tone={summary && summary.isolated_node_ratio > 0.4 ? 'warn' : 'neutral'}
            detail={summary ? `${summary.isolated_node_count} 个孤立节点` : '等待统计'}
          />
          <MetricCard
            label="连通分量"
            value={summary?.disconnected_components ?? '暂无'}
            tone={summary && summary.disconnected_components > 1 ? 'active' : 'neutral'}
            detail={highIsolationCount > 0 ? `${highIsolationCount} 个课时孤立偏高` : '按正式图计算'}
          />
          <MetricCard
            label="人工待处理"
            value={summary?.manual_pending_items ?? '暂无'}
            tone={summary && summary.manual_pending_items > 0 ? 'warn' : 'ok'}
            detail={summary ? `图片 ${summary.image_review_count}，合并 ${summary.merge_review_count}` : '等待统计'}
          />
        </div>

        <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-3 py-2">
            <div className="text-xs font-semibold text-text-primary">课时质量表</div>
            <div className="text-[11px] text-text-muted">
              {summary ? `${summary.lesson_count} 个课时，${summary.node_count} 个正式节点，${summary.relation_count} 条正式关系` : '暂无统计'}
            </div>
          </div>
          <div className="max-h-[420px] overflow-auto scrollbar-thin">
            <table className="w-full min-w-[900px] text-left text-xs">
              <thead className="sticky top-0 z-10 bg-surface text-text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">状态</th>
                  <th className="px-3 py-2 font-medium">课时</th>
                  <th className="px-3 py-2 font-medium">节点</th>
                  <th className="px-3 py-2 font-medium">关系</th>
                  <th className="px-3 py-2 font-medium">证据覆盖</th>
                  <th className="px-3 py-2 font-medium">孤立比例</th>
                  <th className="px-3 py-2 font-medium">连通分量</th>
                  <th className="px-3 py-2 font-medium">待复核图片</th>
                  <th className="px-3 py-2 font-medium">人工待处理</th>
                </tr>
              </thead>
              <tbody>
                {lessons.map((row) => {
                  const coverageWarn = row.evidence_coverage < 0.8 && row.node_count + row.relation_count > 0;
                  const isolationWarn = row.isolated_node_ratio > 0.4 && row.node_count > 0;
                  return (
                    <tr key={row.lesson_run_id} className="border-t border-border-subtle transition-colors hover:bg-hover">
                      <td className="px-3 py-2"><StatusPill status={row.status} /></td>
                      <td className="max-w-[300px] px-3 py-2">
                        <div className="truncate font-medium text-text-primary" title={row.batch_anchor}>{row.batch_anchor}</div>
                        {row.quality_issues.length > 0 && (
                          <div className="mt-1 truncate text-[10px] text-node-event">{row.quality_issues[0]}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-text-secondary">{row.node_count}</td>
                      <td className="px-3 py-2 tabular-nums text-text-secondary">{row.relation_count}</td>
                      <td className={`px-3 py-2 tabular-nums ${coverageWarn ? 'text-node-event' : 'text-text-secondary'}`}>{percentValue(row.evidence_coverage)}</td>
                      <td className={`px-3 py-2 tabular-nums ${isolationWarn ? 'text-node-event' : 'text-text-secondary'}`}>{percentValue(row.isolated_node_ratio)}</td>
                      <td className="px-3 py-2 tabular-nums text-text-secondary">{row.disconnected_components}</td>
                      <td className={`px-3 py-2 tabular-nums ${row.image_review_count > 0 ? 'text-accent' : 'text-text-secondary'}`}>{row.image_review_count}</td>
                      <td className={`px-3 py-2 tabular-nums ${row.manual_pending_items > 0 ? 'text-node-event' : 'text-text-secondary'}`}>{row.manual_pending_items}</td>
                    </tr>
                  );
                })}
                {!loading && lessons.length === 0 && (
                  <tr>
                    <td colSpan={9} className="px-3 py-10 text-center text-text-muted">暂无质量统计。抽取或合并后会显示每课时质量表。</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>
  );
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
  const [jobStatus, setJobStatus] = useState<PipelineJobStatusResponse | null>(null);
  const [metadata, setMetadata] = useState<TextbookMetadataResponse | null>(null);
  const [inferring, setInferring] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [form, setForm] = useState<PipelineForm>(initialForm);
  const [imageReviews, setImageReviews] = useState<ImageReviewResponse | null>(null);
  const [imageReviewLoading, setImageReviewLoading] = useState(false);
  const [imageReviewError, setImageReviewError] = useState('');
  const [imageReviewUpdating, setImageReviewUpdating] = useState('');
  const [quality, setQuality] = useState<PipelineQualityDashboardResponse | null>(null);
  const [qualityLoading, setQualityLoading] = useState(false);
  const [qualityError, setQualityError] = useState('');

  const refresh = async (options: { silent?: boolean } = {}) => {
    if (!options.silent) setLoading(true);
    setError('');
    try {
      setPayload(await loadPipeline(activeSourceKey));
    } catch (err) {
      setError((err as Error).message || '读取管线状态失败');
    } finally {
      if (!options.silent) setLoading(false);
    }
  };

  const refreshImageReviews = async (options: { silent?: boolean } = {}) => {
    if (!options.silent) setImageReviewLoading(true);
    setImageReviewError('');
    try {
      setImageReviews(await loadImageReviews(activeSourceKey));
    } catch (err) {
      setImageReviewError((err as Error).message || '读取待确认图片失败');
    } finally {
      if (!options.silent) setImageReviewLoading(false);
    }
  };

  const refreshQuality = async (options: { silent?: boolean } = {}) => {
    if (!options.silent) setQualityLoading(true);
    setQualityError('');
    try {
      setQuality(await loadPipelineQuality(activeSourceKey));
    } catch (err) {
      setQualityError((err as Error).message || '读取质量仪表盘失败');
    } finally {
      if (!options.silent) setQualityLoading(false);
    }
  };

  const refreshJobStatus = async (jobId = startResult?.job_id) => {
    if (!jobId) return;
    try {
      setJobStatus(await loadPipelineJobStatus(activeSourceKey, jobId));
    } catch {
      setJobStatus(null);
    }
  };

  const updateForm = <K extends keyof PipelineForm>(key: K, value: PipelineForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const canInfer = Boolean(form.book_id.trim() || form.pdf_path.trim() || form.mineru_file_url.trim());
  const canStart = sourceReady(form) && !starting;

  const applyInferredMetadata = (result: TextbookMetadataResponse) => {
    const previous = metadata;
    setMetadata(result);
    setForm((current) => ({
      ...current,
      book_id: shouldUseInferredValue(current.book_id, previous?.book_id) ? result.book_id : current.book_id,
      book_title: shouldUseInferredValue(current.book_title, previous?.title) ? result.title : current.book_title,
      lesson_subject: shouldUseInferredValue(current.lesson_subject, previous?.lesson_subject) ? result.lesson_subject : current.lesson_subject,
      lesson_school_stage: shouldUseInferredValue(current.lesson_school_stage, previous?.lesson_school_stage)
        ? result.lesson_school_stage
        : current.lesson_school_stage,
      lesson_grade_band: shouldUseInferredValue(current.lesson_grade_band, previous?.lesson_grade_band) ? result.lesson_grade_band : current.lesson_grade_band,
    }));
  };

  const submitStart = async (event: FormEvent) => {
    event.preventDefault();
    if (!canStart) return;
    setStarting(true);
    setStartError('');
    setStartResult(null);
    setJobStatus(null);
    try {
      const result = await startPipeline(activeSourceKey, {
        book_id: form.book_id.trim() || undefined,
        book_title: form.book_title.trim() || undefined,
        pdf_path: form.pdf_path.trim() || undefined,
        mineru_file_url: form.mineru_file_url.trim() || undefined,
        mineru_base_url: form.mineru_base_url.trim() || undefined,
        mineru_model_version: form.mineru_model_version.trim() || undefined,
        mineru_language: optionalAutoString(form.mineru_language),
        mineru_page_ranges: form.mineru_page_ranges.trim() || undefined,
        mineru_force: form.mineru_force,
        outline_start_page: optionalNumber(form.outline_start_page),
        outline_end_page: optionalNumber(form.outline_end_page),
        dataset_id: activeSourceKey,
        output_root: form.output_root.trim() || 'data/main',
        parallelism: Number(form.parallelism) || 8,
        extraction_template: form.extraction_template,
        quality_retry_count: Number(form.quality_retry_count) || 1,
        model_retry_count: Number(form.model_retry_count) || 2,
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
        void refreshJobStatus(result.job_id);
        void refresh({ silent: true });
        void refreshImageReviews({ silent: true });
        void refreshQuality({ silent: true });
      }, 1200);
    } catch (err) {
      setStartError((err as Error).message || '启动失败');
    } finally {
      setStarting(false);
    }
  };

  const submitInfer = async (options: { silent?: boolean } = {}) => {
    if (!canInfer) return;
    if (!options.silent) {
      setInferring(true);
      setStartError('');
    }
    try {
      const result = await inferTextbookMetadata(activeSourceKey, {
        book_id: form.book_id.trim() || undefined,
        pdf_path: form.pdf_path.trim() || undefined,
        mineru_file_url: form.mineru_file_url.trim() || undefined,
      });
      applyInferredMetadata(result);
    } catch (err) {
      if (!options.silent) setStartError((err as Error).message || '识别教材信息失败');
    } finally {
      if (!options.silent) setInferring(false);
    }
  };

  useEffect(() => {
    if (!canInfer) return undefined;
    const timer = window.setTimeout(() => {
      void submitInfer({ silent: true });
    }, 700);
    return () => window.clearTimeout(timer);
  }, [activeSourceKey, form.book_id, form.pdf_path, form.mineru_file_url]);

  useEffect(() => {
    setStartResult(null);
    setJobStatus(null);
    void refresh();
    void refreshImageReviews();
    void refreshQuality();
  }, [activeSourceKey]);

  const submitImageReview = async (item: ImageReviewItem, action: ImageReviewAction) => {
    setImageReviewUpdating(item.evidence_id);
    setImageReviewError('');
    try {
      await updateImageReview(activeSourceKey, item.evidence_id, { action });
      await refreshImageReviews();
      void refresh();
      void refreshQuality({ silent: true });
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
  const steps = useMemo(
    () => buildPipelineSteps({ payload, imageReviews, jobStatus, starting, startResult }),
    [payload, imageReviews, jobStatus, starting, startResult],
  );
  const pipelineDone = pipelineComplete(payload);
  const jobDone = jobStatus?.status === 'completed' || jobStatus?.status === 'blocked';
  const autoRefreshing = starting || Boolean(startResult && !jobDone && !pipelineBlocked(payload));
  const lastUpdatedAt = jobStatus?.updated_at ?? latestUpdatedAt(payload);

  useEffect(() => {
    if (!autoRefreshing) return undefined;
    const timer = window.setInterval(() => {
      void refreshJobStatus();
      void refresh({ silent: true });
      void refreshImageReviews({ silent: true });
      void refreshQuality({ silent: true });
    }, 3000);
    return () => window.clearInterval(timer);
  }, [autoRefreshing, activeSourceKey]);

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
            <p className="mt-1 text-sm text-text-secondary">从 PDF 入口启动 MinerU 解析和课时抽取，并实时跟踪合并、质检和人工确认状态。</p>
          </div>
          <button
            type="button"
            onClick={() => {
              void refreshJobStatus();
              void refresh();
              void refreshImageReviews();
              void refreshQuality();
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
              <div className="grid gap-3">
                <div className="rounded-lg border border-accent/30 bg-accent/10 p-3">
                  <div className="mb-3 flex items-start gap-2">
                    <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-accent" />
                    <div>
                      <div className="text-xs font-semibold text-text-primary">统一抽取入口</div>
                      <div className="mt-1 text-[11px] leading-5 text-text-secondary">PDF 与 MinerU 统一处理，教材信息、语言和目录页默认自动设置。</div>
                    </div>
                  </div>
                  <div className="grid gap-3">
                    <Field label="PDF 绝对路径" value={form.pdf_path} onChange={(value) => updateForm('pdf_path', value)} placeholder="/Users/.../book.pdf" />
                    <Field label="MinerU 文件 URL" value={form.mineru_file_url} onChange={(value) => updateForm('mineru_file_url', value)} placeholder="已有公网文件地址时填写，可不填" />
                  </div>
                </div>
              </div>

              <div className="rounded-lg border border-border-subtle bg-surface p-3">
                <div className="mb-3 flex items-center justify-between gap-3">
                  <div className="text-xs font-medium text-text-primary">教材信息</div>
                  <button
                    type="button"
                    onClick={() => void submitInfer()}
                    disabled={inferring || !canInfer}
                    className="flex h-7 items-center gap-1.5 rounded-md border border-border-subtle bg-elevated px-2 text-[11px] text-text-secondary transition-colors hover:bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {inferring ? <Loader2 className="h-3 w-3 animate-spin" /> : <Search className="h-3 w-3" />}
                    重新识别
                  </button>
                </div>
                <div className="mb-3 grid grid-cols-2 gap-2">
                  <Field label="教材编号" value={form.book_id} onChange={(value) => updateForm('book_id', value)} placeholder="留空自动生成" />
                  <Field label="教材标题" value={form.book_title} onChange={(value) => updateForm('book_title', value)} placeholder="留空自动识别" />
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
                <div className="mt-3">
                  <SelectField<PipelineExtractionTemplateId>
                    label="抽取模板"
                    value={form.extraction_template}
                    onChange={(value) => updateForm('extraction_template', value)}
                    options={EXTRACTION_TEMPLATE_OPTIONS}
                  />
                </div>
                {metadata && (
                  <div className="mt-3 flex flex-wrap gap-1.5 text-[10px] text-text-muted">
                    <span className="rounded-full border border-border-subtle bg-elevated px-1.5 py-0.5">置信度 {percentValue(metadata.confidence)}</span>
                    <span className="rounded-full border border-border-subtle bg-elevated px-1.5 py-0.5">语言 {metadata.mineru_language === 'en' ? '英文' : '中文'}</span>
                    <span className="rounded-full border border-border-subtle bg-elevated px-1.5 py-0.5">页码 {metadata.mineru_page_ranges || '整本'}</span>
                    <span className="rounded-full border border-border-subtle bg-elevated px-1.5 py-0.5">目录 {metadata.outline_start_page}-{metadata.outline_end_page}</span>
                    <span className="rounded-full border border-border-subtle bg-elevated px-1.5 py-0.5">{templateLabel(metadata.extraction_template)}</span>
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
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="质量重抽次数" value={form.quality_retry_count} onChange={(value) => updateForm('quality_retry_count', value)} inputMode="numeric" />
                    <Field label="模型重试次数" value={form.model_retry_count} onChange={(value) => updateForm('model_retry_count', value)} inputMode="numeric" />
                  </div>
                  <SelectField<PipelineLessonBackendKind>
                    label="文本模型接口"
                    value={form.lesson_backend_kind}
                    onChange={(value) => updateForm('lesson_backend_kind', value)}
                    options={[
                      { value: 'openai_chat_completions', label: '聊天补全接口' },
                      { value: 'openai_responses', label: 'Responses 接口' },
                    ]}
                  />
                  <Field label="文本模型接口地址" value={form.openai_base_url} onChange={(value) => updateForm('openai_base_url', value)} placeholder="默认使用环境配置" />
                  <Field label="文本模型名称" value={form.openai_model} onChange={(value) => updateForm('openai_model', value)} placeholder="默认由后端决定" />
                  <Field label="视觉模型接口地址" value={form.vlm_api_url} onChange={(value) => updateForm('vlm_api_url', value)} placeholder="例如 http://localhost:8000/v1/chat/completions" />
                  <Field label="视觉模型密钥" value={form.vlm_api_key} onChange={(value) => updateForm('vlm_api_key', value)} placeholder="留空则使用后端环境变量" type="password" />
                  <Field label="视觉模型名称" value={form.vlm_model} onChange={(value) => updateForm('vlm_model', value)} placeholder="例如 gpt-4.1-mini 或 qwen-vl-max" />
                  <Field label="MinerU 接口地址" value={form.mineru_base_url} onChange={(value) => updateForm('mineru_base_url', value)} />
                  <Field label="MinerU 模型版本" value={form.mineru_model_version} onChange={(value) => updateForm('mineru_model_version', value)} />
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="解析页码范围" value={form.mineru_page_ranges} onChange={(value) => updateForm('mineru_page_ranges', value)} placeholder="留空解析整本" />
                    <SelectField
                      label="解析语言"
                      value={form.mineru_language}
                      onChange={(value) => updateForm('mineru_language', value)}
                      options={[
                        { value: 'auto', label: '自动' },
                        { value: 'ch', label: '中文' },
                        { value: 'en', label: '英文' },
                      ]}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="目录起始页" value={form.outline_start_page} onChange={(value) => updateForm('outline_start_page', value)} placeholder="自动" inputMode="numeric" />
                    <Field label="目录结束页" value={form.outline_end_page} onChange={(value) => updateForm('outline_end_page', value)} placeholder="自动" inputMode="numeric" />
                  </div>
                  <label className="flex items-center gap-2 text-xs text-text-secondary">
                    <input
                      type="checkbox"
                      checked={form.mineru_force}
                      onChange={(event) => updateForm('mineru_force', event.target.checked)}
                      className="h-4 w-4 accent-[var(--color-accent)]"
                    />
                    强制重新解析 PDF
                  </label>
                </div>
              )}

              <div className="grid gap-3 rounded-lg border border-border-subtle bg-surface p-3 text-xs text-text-secondary">
                <div className="flex items-center justify-between gap-3">
                  <span>入口状态</span>
                  <span className={sourceReady(form) ? 'text-node-process' : 'text-node-event'}>{sourceReadyLabel(form)}</span>
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
                一键生成最终结果
              </button>
            </form>
          </section>

          <section className="min-w-0 space-y-5">
            <PipelineProgressPanel steps={steps} jobStatus={jobStatus} autoRefreshing={autoRefreshing} lastUpdatedAt={lastUpdatedAt} />

            <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <MetricCard label="课时运行" value={payload?.summary.lesson_runs ?? 0} detail={latestLesson ? `最近：${timeText(latestLesson.updated_at)}` : '暂无运行'} />
              <MetricCard label="已暂存" value={payload?.summary.staged ?? 0} tone="active" detail="等待合并或质检" />
              <MetricCard label="已通过 QA" value={payload?.summary.qa_passed ?? 0} tone="ok" detail={`通过率 ${percentValue(successRate)}`} />
              <MetricCard label="阻断项" value={payload?.summary.blocked ?? 0} tone={(payload?.summary.blocked ?? 0) > 0 ? 'warn' : 'neutral'} detail="需要人工处理" />
            </div>

            <ManualReviewSummary payload={payload} imageReviews={imageReviews} pipelineDone={pipelineDone} />

            <QualityDashboardPanel
              quality={quality}
              loading={qualityLoading}
              error={qualityError}
              onRefresh={() => void refreshQuality()}
            />

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
                  <span className="text-text-muted">当前任务</span>
                  <span className={jobStatus ? 'text-text-primary' : 'text-text-secondary'}>
                    {jobStatus ? statusLabel(jobStatus.status) : '暂无'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-text-muted">当前阶段</span>
                  <span className="truncate text-text-primary">{stageLabel(jobStatus?.current_stage?.id) || '暂无'}</span>
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
