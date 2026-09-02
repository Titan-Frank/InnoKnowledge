import { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ImageReviewAction,
  ImageReviewItem,
  ImageReviewResponse,
  PipelineJobListResponse,
  PipelineJobSummary,
  PipelineJobStatusResponse,
  PipelineOutlineChunkContentResponse,
  PipelineOutlinePreviewResponse,
  PipelineQualityDashboardResponse,
  PipelineQualityLessonRow,
  PipelineQualityReviewAction,
  PipelineResponse,
  PipelineReviewItem,
  PipelineStartRequest,
  PipelineStartResponse,
  PipelineStartStage,
} from '@okm/types';
import {
  confirmPipelineOutline,
  loadPipelineJobs,
  loadPipelineOutlineChunkContent,
  loadPipelineOutlinePreview,
  loadPipelineJobStatus,
  loadImageReviews,
  loadPipeline,
  loadPipelineQuality,
  rejectPipelineOutline,
  updatePipelineQualityReview,
  startPipeline,
  stopPipeline,
  updateImageReview,
} from '@/services/backend-client';
import { useAppState } from '@/hooks/useAppState';
import { invalidateUnitCache } from '@/hooks/useUnitLoader';
import {
  forgetPipelineJob,
  rememberPipelineJob,
  restorePipelineJob,
} from '@/lib/pipeline-job-session';
import {
  buildPipelineStepStatuses,
  lessonStageIds,
  matchesPipelineStageId,
  mergeStageIds,
  outlineStageIds,
  sourceStageIds,
  type PipelineStepStatus,
} from '@/lib/pipeline-steps';
import {
  AlertCircle,
  BarChart3,
  Check,
  ChevronLeft,
  ChevronRight,
  ClipboardList,
  GitBranch,
  Info,
  Eye,
  FileText,
  Loader2,
  Network,
  Play,
  RotateCcw,
  Square,
  X,
  BookOpen,
} from '@/lib/lucide-icons';
import { PipelineBookWorkbench } from './PipelineBookWorkbench';
import { OutlineBatchCandidatesPanel } from './OutlineBatchCandidatesPanel';
import { MarkdownView } from './MarkdownView';
import {
  buildConfirmedExtractionRequest,
  buildPipelineBatchStartRequest,
  isOutlineReviewReady,
  resolveOutlineExtractionStatus,
  resolvePipelineResumeStage,
  selectBatchResumeCandidates,
  selectOutlineBatchJobs,
  type OutlineExtractionStatus,
} from '@/lib/pipeline-start';
import { pipelineTaskDetail, pipelineTaskLabel } from '@/lib/pipeline-task-label';

type PipelineStep = {
  id: string;
  label: string;
  detail: string;
  status: PipelineStepStatus;
};

const baseStartRequest = (datasetId: string): PipelineStartRequest => ({
  mineru_base_url: 'https://mineru.net',
  mineru_model_version: 'vlm',
  mineru_force: false,
  dataset_id: datasetId,
  output_root: 'data/main',
  parallelism: 8,
  extraction_template: 'auto',
  quality_retry_count: 1,
  model_retry_count: 2,
  lesson_backend_kind: 'openai_chat_completions',
});

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
    skipped: '已复用',
    ready: '就绪',
    unknown: '未知',
  };
  return labels[status] || status || '未知';
}

function statusTone(status: string): 'ok' | 'warn' | 'active' | 'neutral' {
  if (status === 'qa_passed' || status === 'completed' || status === 'success' || status === 'merged' || status === 'skipped') return 'ok';
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
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${style}`}>{statusLabel(status)}</span>;
}

function MetricCard({
  label,
  value,
  detail,
  tone = 'neutral',
  onClick,
  ariaLabel,
}: {
  label: string;
  value: number | string;
  detail?: string;
  tone?: 'neutral' | 'ok' | 'warn' | 'active';
  onClick?: () => void;
  ariaLabel?: string;
}) {
  const color = tone === 'ok' ? 'text-node-process' : tone === 'warn' ? 'text-node-event' : tone === 'active' ? 'text-accent' : 'text-text-primary';
  const content = (
    <>
      <div className={`text-xl font-semibold tabular-nums ${color}`}>{value}</div>
      <div className="mt-1 text-xs font-medium text-text-secondary">{label}</div>
      {detail && <div className="mt-1 truncate text-xs text-text-muted">{detail}</div>}
    </>
  );
  if (onClick) {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-label={ariaLabel || label}
        className="cursor-pointer rounded-lg border border-border-subtle bg-elevated p-3 text-left transition-colors hover:border-accent/50 hover:bg-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        {content}
      </button>
    );
  }
  return (
    <div className="rounded-lg border border-border-subtle bg-elevated p-3">
      {content}
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
  mineru_source_markdown: '准备教材解析文本',
  extract_pdf_outline: '读取教材目录',
  prepare_source_markdown: '整理教材文本',
  ensure_outline: '生成教材章节',
  prepare_outline_chunks: '划分课时内容',
  lesson_plan: '安排处理任务',
  lesson_staging: '提取课时知识',
  staging_quality: '检查课时结果',
  canonical_commit: '合并正式知识',
  assessment_staging: '匹配题目与能力点',
  assessment_quality: '检查题目关联质量',
  assessment_commit: '保存题目与能力点关联',
  normalize: '整理知识数据',
  node_bodies: '编写知识正文',
  pedagogical_profiles: '生成分学段教学说明',
  node_embeddings: '建立知识点语义索引',
  unit_embeddings: '建立知识单元语义索引',
  strict_qa: '最终质量检查',
  graph_integrity: '检查知识关系',
  quality_dashboard: '汇总质量结果',
};

function stageLabel(stageId: string | undefined): string {
  if (!stageId) return '';
  if (stageId.startsWith('lesson_staging_retry_transport_')) return '重试传输失败课时';
  if (stageId.startsWith('assessment_staging_retry_')) return '重试题目能力点关联';
  if (stageId.startsWith('lesson_staging_retry_')) {
    return `重抽未通过课时 ${stageId.replace('lesson_staging_retry_', '')}`;
  }
  return stageLabels[stageId] || stageId;
}

function resumeStageFor(stageId?: string | null): PipelineStartStage | null {
  return resolvePipelineResumeStage(stageId);
}

function stageIn(stage: PipelineJobStatusResponse['current_stage'], ids: readonly string[]): boolean {
  return matchesPipelineStageId(stage?.id, ids);
}

function buildPipelineSteps(input: {
  payload: PipelineResponse | null;
  imageReviews: ImageReviewResponse | null;
  jobStatus: PipelineJobStatusResponse | null;
  starting: boolean;
  startResult: PipelineStartResponse | null;
}): PipelineStep[] {
  const { payload, imageReviews, jobStatus, starting, startResult } = input;
  const reviews = reviewCount(payload, imageReviews);
  const currentJobStatus = startResult && jobStatus?.job_id === startResult.job_id ? jobStatus : null;
  const currentStage = currentJobStatus?.current_stage ?? null;
  const currentStageText = currentStage ? `正在${stageLabel(currentStage.id)}` : '';
  const ensureOutlineStage = findJobStage(currentJobStatus, ['ensure_outline']);
  const outlineCompletedDetail = ensureOutlineStage?.progress.source_kind === 'enrich'
    ? `已用参考教材目录生成 ${Number(ensureOutlineStage.progress.lesson_count) || 0} 个课时`
    : ensureOutlineStage?.progress.enrich_fallback
      ? '参考教材目录未完全对齐，已改用当前教材正文目录'
      : '课时任务已经生成';
  const lessonStage = findJobStage(currentJobStatus, lessonStageIds);
  const lessonRuntimeDetail = lessonStage ? lessonProgressText(lessonStage, currentJobStatus) : '';
  const statuses = buildPipelineStepStatuses({
    jobStatus,
    currentJobId: startResult?.job_id ?? null,
    starting,
    reviewCount: reviews,
  });

  return [
    {
      id: 'source',
      label: '读取教材文件',
      detail: statuses.source === 'active'
        ? stageIn(currentStage, sourceStageIds) ? currentStageText : '正在启动本轮任务'
        : statuses.source === 'complete'
          ? '源文件已经准备完成'
          : statuses.source === 'blocked'
            ? '当前任务的源文件准备被阻断'
            : '等待启动本轮任务',
      status: statuses.source,
    },
    {
      id: 'outline',
      label: '划分章节课时',
      detail: statuses.outline === 'active' && stageIn(currentStage, outlineStageIds)
        ? currentStageText
        : statuses.outline === 'complete'
          ? outlineCompletedDetail
          : statuses.outline === 'blocked'
            ? '当前任务的目录或切分被阻断'
            : '等待当前任务进入目录与切分',
      status: statuses.outline,
    },
    {
      id: 'lesson',
      label: '提取知识',
      detail: statuses.lesson === 'active' && lessonRuntimeDetail
        ? lessonRuntimeDetail
        : statuses.lesson === 'complete'
          ? '当前任务的课时抽取已经完成'
          : statuses.lesson === 'blocked'
            ? '当前任务的课时抽取被阻断'
            : '等待当前任务进入课时抽取',
      status: statuses.lesson,
    },
    {
      id: 'merge',
      label: '整理与检查',
      detail: statuses.merge === 'active' && stageIn(currentStage, mergeStageIds)
        ? currentStageText
        : statuses.merge === 'complete'
          ? '当前任务的知识整理与检查已经完成'
          : statuses.merge === 'blocked'
            ? '当前任务的知识整理或检查被阻断'
            : '等待当前任务进入知识整理与检查',
      status: statuses.merge,
    },
    {
      id: 'review',
      label: '人工确认',
      detail: statuses.review === 'active'
        ? `${reviews} 项需要确认`
        : statuses.review === 'complete'
          ? '暂无待确认项'
          : '本轮抽取完成后显示待确认项',
      status: statuses.review,
    },
  ];
}

function findJobStage(jobStatus: PipelineJobStatusResponse | null, ids: readonly string[]): PipelineJobStatusResponse['stages'][number] | null {
  if (!jobStatus) return null;
  if (stageIn(jobStatus.current_stage, ids)) return jobStatus.current_stage;
  return jobStatus.stages.find((stage) => matchesPipelineStageId(stage.id, ids) && stage.status === 'running')
    ?? jobStatus.stages.find((stage) => matchesPipelineStageId(stage.id, ids))
    ?? null;
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
  return (jobStatus?.worker_states ?? []).filter(
    (worker) => matchesPipelineStageId(worker.stage_id, lessonStageIds) && worker.status === 'running',
  );
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
  const current = running.length > 0
    ? `${pipelineTaskLabel(running[0]!, jobStatus?.book_title)}（${running.length} 个并行任务）`
    : '';
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

function jobProgressText(job: PipelineJobSummary): string {
  const explicit = Number(job.progress.percent);
  const total = Number(job.progress.total_units);
  const completed = Number(job.progress.completed);
  const failed = Number(job.progress.failed);
  if (Number.isFinite(total) && total > 0) {
    const done = (Number.isFinite(completed) ? completed : 0) + (Number.isFinite(failed) ? failed : 0);
    const percent = Number.isFinite(explicit) ? explicit : done / total;
    return `${done}/${total} · ${Math.round(Math.max(0, Math.min(1, percent)) * 100)}%`;
  }
  if (job.status === 'completed') return '100%';
  return '—';
}

function PipelineJobListPanel({
  jobs,
  selectedJobId,
  activeJobStatus,
  loading,
  starting,
  stopping,
  batchResuming,
  batchResumeCount,
  resumeStage,
  error,
  onSelect,
  onRefresh,
  onStop,
  onResume,
  onResumeBlocked,
}: {
  jobs: PipelineJobSummary[];
  selectedJobId: string | null;
  activeJobStatus: PipelineJobStatusResponse | null;
  loading: boolean;
  starting: boolean;
  stopping: boolean;
  batchResuming: boolean;
  batchResumeCount: number;
  resumeStage: PipelineStartStage | null;
  error: string;
  onSelect: (job: PipelineJobSummary) => void;
  onRefresh: () => void;
  onStop: () => void;
  onResume: (stage: PipelineStartStage) => void;
  onResumeBlocked: () => void;
}) {
  const failedResumeCount = progressNumber(activeJobStatus?.current_stage, 'failed');
  const resumeLabel = failedResumeCount > 0 && resumeStage === 'lesson_staging'
    ? `重试 ${failedResumeCount} 个失败课时`
    : failedResumeCount > 0 && resumeStage === 'assessment_staging'
      ? `重试 ${failedResumeCount} 个失败题目关联`
      : resumeStage
        ? `从“${stageLabel(resumeStage)}”继续`
        : '';
  return (
    <section className="overflow-hidden rounded-lg border border-border-subtle bg-elevated">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
        <div className="flex items-center gap-2">
          <ClipboardList className="h-4 w-4 text-accent" />
          <div className="text-base font-semibold text-text-primary">教材处理任务</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-muted">{jobs.length} 个作业</span>
          {batchResumeCount > 1 && (
            <button
              type="button"
              onClick={onResumeBlocked}
              disabled={batchResuming || starting || stopping}
              className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-2.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {batchResuming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              并行继续 {batchResumeCount} 个阻断作业
            </button>
          )}
          {activeJobStatus?.status === 'running' && (
            <button
              type="button"
              onClick={onStop}
              disabled={stopping || starting}
              className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-node-event/40 bg-node-event/10 px-2.5 text-xs font-medium text-node-event transition-colors hover:bg-node-event/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {stopping ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
              停止
            </button>
          )}
          {activeJobStatus?.status === 'blocked' && resumeStage && (
            <button
              type="button"
              onClick={() => onResume(resumeStage)}
              disabled={starting}
              className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-accent/40 bg-accent/10 px-2.5 text-xs font-medium text-accent transition-colors hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
              {resumeLabel}
            </button>
          )}
          <button
            type="button"
            onClick={onRefresh}
            disabled={loading}
            className="flex h-7 items-center gap-1.5 rounded-md border border-border-subtle bg-surface px-2 text-[11px] text-text-secondary transition-colors hover:bg-hover hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RotateCcw className="h-3 w-3" />}
            刷新
          </button>
        </div>
      </div>
      {error && (
        <div className="m-3 flex items-start gap-2 rounded-md border border-node-event/40 bg-node-event/10 p-2.5 text-xs text-node-event">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      <div className="max-h-[360px] overflow-auto scrollbar-thin">
        <table className="w-full min-w-[860px] text-left text-sm">
          <thead className="sticky top-0 z-10 bg-elevated text-text-muted">
            <tr>
              <th className="px-3 py-2 font-medium">状态</th>
              <th className="px-3 py-2 font-medium">教材</th>
              <th className="px-3 py-2 font-medium">当前阶段</th>
              <th className="px-3 py-2 font-medium">进度</th>
              <th className="px-3 py-2 font-medium">更新时间</th>
              <th className="px-3 py-2 font-medium">作业编号</th>
            </tr>
          </thead>
          <tbody>
            {jobs.map((job) => {
              const selected = job.job_id === selectedJobId;
              return (
                <tr
                  key={job.job_id}
                  onClick={() => onSelect(job)}
                  className={`cursor-pointer border-t border-border-subtle transition-colors ${
                    selected ? 'bg-accent/15' : 'hover:bg-hover'
                  }`}
                >
                  <td className="px-3 py-2"><StatusPill status={job.status} /></td>
                  <td className="max-w-[220px] px-3 py-2">
                    <div className="truncate font-medium text-text-primary" title={job.book_title}>{job.book_title}</div>
                    {job.error && (
                      <div className="mt-1 truncate text-xs text-node-event" title={job.error}>{job.error}</div>
                    )}
                  </td>
                  <td className="max-w-[220px] px-3 py-2">
                    <div className="truncate text-text-secondary">
                      {job.current_stage_label || stageLabel(job.current_stage_id || undefined) || '等待启动'}
                    </div>
                  </td>
                  <td className="px-3 py-2 tabular-nums text-text-secondary">{jobProgressText(job)}</td>
                  <td className="px-3 py-2 text-text-muted">{timeText(job.updated_at)}</td>
                  <td className="max-w-[240px] px-3 py-2">
                    <div className="truncate font-mono text-xs text-text-muted" title={job.job_id}>{job.job_id}</div>
                  </td>
                </tr>
              );
            })}
            {!loading && jobs.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-10 text-center text-text-muted">暂无教材处理任务。</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
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
    .filter((event) => matchesPipelineStageId(event.stage_id, lessonStageIds))
    .slice(0, 5);

  return (
    <section className="rounded-lg border border-border-subtle bg-elevated p-4" aria-live="polite">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-base font-semibold text-text-primary">抽取步骤</div>
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
                      <span className="shrink-0 tabular-nums text-accent">Worker {worker.worker_slot + 1}</span>
                      <span className="min-w-0 truncate text-text-primary" title={pipelineTaskDetail(worker)}>{pipelineTaskLabel(worker, jobStatus?.book_title)}</span>
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
                      <span className="min-w-0 truncate text-text-primary" title={pipelineTaskDetail(event)}>{pipelineTaskLabel(event, jobStatus?.book_title)}</span>
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
          <div className="text-base font-semibold text-text-primary">人工确认</div>
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
  reviewUpdatingId,
  onRefresh,
  onReviewAction,
}: {
  quality: PipelineQualityDashboardResponse | null;
  loading: boolean;
  error: string;
  reviewUpdatingId: string;
  onRefresh: () => void;
  onReviewAction: (lessonRunId: string, action: PipelineQualityReviewAction, note: string) => void;
}) {
  const summary = quality?.summary;
  const lessons = quality?.lessons ?? [];
  const pendingQualityLessons = lessons.filter((row) => row.quality_review_required);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [activeReviewId, setActiveReviewId] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const activeReview = pendingQualityLessons.find((row) => row.lesson_run_id === activeReviewId) ?? pendingQualityLessons[0] ?? null;
  const lowCoverageCount = lessons.filter((row) => row.evidence_coverage < 0.8 && row.node_count + row.relation_count > 0).length;
  const highIsolationCount = lessons.filter((row) => row.isolated_node_ratio > 0.4 && row.node_count > 0).length;

  useEffect(() => {
    if (!reviewOpen) return;
    if (pendingQualityLessons.length === 0) {
      setReviewOpen(false);
      setActiveReviewId('');
      setReviewNote('');
      return;
    }
    if (!pendingQualityLessons.some((row) => row.lesson_run_id === activeReviewId)) {
      setActiveReviewId(pendingQualityLessons[0]!.lesson_run_id);
      setReviewNote('');
    }
  }, [activeReviewId, pendingQualityLessons, reviewOpen]);

  const openReview = (row?: PipelineQualityLessonRow) => {
    const target = row ?? pendingQualityLessons[0];
    if (!target) return;
    setActiveReviewId(target.lesson_run_id);
    setReviewNote('');
    setReviewOpen(true);
  };

  return (
    <section className="overflow-hidden rounded-lg border border-border-subtle bg-elevated">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-4 py-3">
        <div className="flex items-center gap-2">
          <Network className="h-4 w-4 text-accent" />
          <div>
            <div className="text-base font-semibold text-text-primary">质量仪表盘</div>
            <div className="text-xs text-text-muted">
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
            detail={summary ? `图片 ${summary.image_review_count}，合并 ${summary.merge_review_count}，质量 ${summary.quality_review_count}${summary.quality_review_count > 0 ? ' · 点击处理' : ''}` : '等待统计'}
            onClick={pendingQualityLessons.length > 0 ? () => openReview() : undefined}
            ariaLabel={pendingQualityLessons.length > 0 ? `处理 ${summary?.quality_review_count ?? 0} 个质量复核项` : undefined}
          />
        </div>

        <div className="overflow-hidden rounded-lg border border-border-subtle bg-surface">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-3 py-2">
            <div className="text-sm font-semibold text-text-primary">课时质量表</div>
            <div className="text-xs text-text-muted">
              {summary ? `${summary.lesson_count} 个课时，${summary.node_count} 个正式节点，${summary.relation_count} 条正式关系` : '暂无统计'}
            </div>
          </div>
          <div className="max-h-[420px] overflow-auto scrollbar-thin">
            <table className="w-full min-w-[900px] text-left text-sm">
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
                        {(row.quality_issues.length > 0 || row.quality_warnings.length > 0) && (
                          <div className="mt-1 truncate text-[10px] text-node-event">{row.quality_issues[0] ?? row.quality_warnings[0]}</div>
                        )}
                      </td>
                      <td className="px-3 py-2 tabular-nums text-text-secondary">{row.node_count}</td>
                      <td className="px-3 py-2 tabular-nums text-text-secondary">{row.relation_count}</td>
                      <td className={`px-3 py-2 tabular-nums ${coverageWarn ? 'text-node-event' : 'text-text-secondary'}`}>{percentValue(row.evidence_coverage)}</td>
                      <td className={`px-3 py-2 tabular-nums ${isolationWarn ? 'text-node-event' : 'text-text-secondary'}`}>{percentValue(row.isolated_node_ratio)}</td>
                      <td className="px-3 py-2 tabular-nums text-text-secondary">{row.disconnected_components}</td>
                      <td className={`px-3 py-2 tabular-nums ${row.image_review_count > 0 ? 'text-accent' : 'text-text-secondary'}`}>{row.image_review_count}</td>
                      <td className={`px-3 py-2 tabular-nums ${row.manual_pending_items > 0 ? 'text-node-event' : 'text-text-secondary'}`}>
                        {row.quality_review_required ? (
                          <button
                            type="button"
                            onClick={() => openReview(row)}
                            className="inline-flex cursor-pointer items-center gap-1 rounded px-1.5 py-0.5 font-semibold transition-colors hover:bg-node-event/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                            aria-label={`处理课时 ${row.batch_anchor} 的质量复核`}
                          >
                            {row.manual_pending_items}
                            <ChevronRight className="h-3 w-3" />
                          </button>
                        ) : row.manual_pending_items}
                      </td>
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

        {reviewOpen && activeReview && (
          <section id="quality-review-panel" className="overflow-hidden rounded-lg border border-accent/40 bg-surface" aria-label="质量复核处理区">
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-subtle px-3 py-2.5">
              <div>
                <div className="text-xs font-semibold text-text-primary">质量复核处理</div>
                <div className="mt-0.5 text-[10px] text-text-muted">共 {pendingQualityLessons.length} 个课时待处理；操作会保留原始告警记录。</div>
              </div>
              <button
                type="button"
                onClick={() => setReviewOpen(false)}
                className="cursor-pointer text-[11px] text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                收起
              </button>
            </div>

            <div className="grid min-h-[300px] lg:grid-cols-[minmax(220px,0.8fr)_minmax(0,1.4fr)]">
              <div className="max-h-[420px] space-y-1 overflow-auto border-b border-border-subtle p-2 lg:border-b-0 lg:border-r">
                {pendingQualityLessons.map((row) => (
                  <button
                    key={row.lesson_run_id}
                    type="button"
                    onClick={() => {
                      setActiveReviewId(row.lesson_run_id);
                      setReviewNote('');
                    }}
                    className={`w-full cursor-pointer rounded-md border px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${row.lesson_run_id === activeReview.lesson_run_id ? 'border-accent/50 bg-accent/10' : 'border-transparent hover:border-border-subtle hover:bg-hover'}`}
                    aria-pressed={row.lesson_run_id === activeReview.lesson_run_id}
                  >
                    <div className="truncate text-[11px] font-medium text-text-primary" title={row.batch_anchor}>{row.batch_anchor}</div>
                    <div className="mt-1 text-[10px] text-text-muted">{row.quality_review_count} 个节点 · {row.quality_warnings.length || row.quality_issues.length} 条告警</div>
                  </button>
                ))}
              </div>

              <div className="space-y-4 p-3">
                <div>
                  <div className="text-xs font-semibold text-text-primary">{activeReview.batch_anchor}</div>
                  <div className="mt-1 text-[10px] text-text-muted">课时运行：{activeReview.lesson_run_id}</div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-md border border-border-subtle bg-elevated p-2.5">
                    <div className="text-[10px] font-semibold text-text-secondary">待复核节点</div>
                    <div className="mt-2 max-h-28 space-y-1 overflow-auto">
                      {activeReview.review_node_ids.map((nodeId) => (
                        <div key={nodeId} className="break-all rounded bg-surface px-2 py-1 font-mono text-[10px] text-text-primary">{nodeId}</div>
                      ))}
                      {activeReview.review_node_ids.length === 0 && <div className="text-[10px] text-text-muted">未记录具体节点 ID。</div>}
                    </div>
                  </div>
                  <div className="rounded-md border border-border-subtle bg-elevated p-2.5">
                    <div className="text-[10px] font-semibold text-text-secondary">质量告警</div>
                    <div className="mt-2 max-h-28 space-y-1 overflow-auto">
                      {[...activeReview.quality_issues, ...activeReview.quality_warnings].map((warning) => (
                        <div key={warning} className="text-[10px] leading-4 text-node-event">{warning}</div>
                      ))}
                      {activeReview.quality_issues.length + activeReview.quality_warnings.length === 0 && <div className="text-[10px] text-text-muted">未记录告警文本。</div>}
                    </div>
                  </div>
                </div>

                <div className="rounded-md border border-border-subtle bg-elevated p-2.5 text-[10px] leading-4 text-text-muted">
                  如需修改节点名称或补充关系，请先在顶部“PG”工作区完成。下面的操作只关闭本课时的人工复核标记，不会自动修改图谱。
                </div>

                <div>
                  <label htmlFor="quality-review-note" className="text-[10px] font-medium text-text-secondary">处理说明（可选）</label>
                  <textarea
                    id="quality-review-note"
                    value={reviewNote}
                    onChange={(event) => setReviewNote(event.target.value)}
                    maxLength={1000}
                    rows={2}
                    placeholder="例如：该节点为章节入口，允许暂时保持孤立。"
                    className="mt-1 w-full resize-y rounded-md border border-border-subtle bg-elevated px-2.5 py-2 text-xs text-text-primary outline-none transition-colors placeholder:text-text-muted focus:border-accent"
                  />
                </div>

                <div className="flex flex-wrap justify-end gap-2">
                  <button
                    type="button"
                    disabled={Boolean(reviewUpdatingId)}
                    onClick={() => onReviewAction(activeReview.lesson_run_id, 'accept', reviewNote)}
                    className="cursor-pointer rounded-md border border-border-subtle bg-elevated px-3 py-2 text-[11px] font-medium text-text-secondary transition-colors hover:bg-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    接受当前质量状态
                  </button>
                  <button
                    type="button"
                    disabled={Boolean(reviewUpdatingId)}
                    onClick={() => onReviewAction(activeReview.lesson_run_id, 'resolved', reviewNote)}
                    className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-[11px] font-semibold text-white transition-colors hover:bg-accent-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {reviewUpdatingId === activeReview.lesson_run_id ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
                    已修复并完成复核
                  </button>
                </div>
              </div>
            </div>
          </section>
        )}
      </div>
    </section>
  );
}

function outlineItemKindLabel(kind: string): string {
  if (kind === 'theme') return '章';
  if (kind === 'topic') return '节组';
  if (kind === 'lesson') return '课节';
  if (kind === 'activity') return '活动';
  if (kind === 'chunk') return '切分块';
  return kind || '条目';
}

function outlineChunkRole(item: PipelineOutlinePreviewResponse['items'][number]): {
  label: string;
  className: string;
  dotClassName: string;
} | null {
  if (item.kind !== 'chunk') return null;
  if (item.content_role === 'summary') {
    return {
      label: '总结抽取块',
      className: 'border-node-process/40 bg-node-process/10 text-node-process',
      dotClassName: 'bg-node-process',
    };
  }
  if (item.content_role === 'assessment') {
    return {
      label: '题目分析块 · 只关联已有节点',
      className: 'border-node-event/40 bg-node-event/10 text-node-event',
      dotClassName: 'bg-node-event',
    };
  }
  return {
    label: '知识抽取块',
    className: 'border-accent/40 bg-accent/10 text-accent',
    dotClassName: 'bg-accent',
  };
}

function outlineRange(start: number | null, end: number | null, prefix: string): string | null {
  if (start == null || end == null) return null;
  return `${prefix} ${start}${end === start ? '' : `–${end}`}`;
}

function chunkAssetUrl(sourceKey: string, assetBasePath: string | null, source: string): string | undefined {
  const value = source.trim().replace(/^<|>$/g, '');
  if (!value) return undefined;
  if (/^(?:https?:|data:|blob:)/i.test(value) || value.startsWith('/api/')) return value;

  const sourcePath = value.split(/[?#]/, 1)[0].replace(/\\/g, '/').replace(/^\/+/, '');
  const candidate = /^(?:data|ocr)\//.test(sourcePath)
    ? sourcePath
    : `${assetBasePath || ''}/${sourcePath}`;
  const absoluteCandidate = candidate.startsWith('/');
  const segments: string[] = [];
  for (const segment of candidate.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (segments.length === 0) return undefined;
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  const assetPath = `${absoluteCandidate ? '/' : ''}${segments.join('/')}`;
  return assetPath
    ? `/api/source/${encodeURIComponent(sourceKey)}/assets/${encodeURIComponent(assetPath)}`
    : undefined;
}

function textbookReadingMarkdown(content: string): string {
  return content
    .replace(/<details\b[^>]*>\s*<summary\b[^>]*>\s*(?:natural_image|text_image)\s*<\/summary>[\s\S]*?<\/details>/gi, '')
    .trim();
}

function OutlineReviewPanel({
  sourceKey,
  preview,
  loading,
  error,
  confirming,
  rejecting,
  extractionStatus,
  onRefresh,
  onConfirm,
  onReject,
  onStart,
}: {
  sourceKey: string;
  preview: PipelineOutlinePreviewResponse | null;
  loading: boolean;
  error: string;
  confirming: boolean;
  rejecting: boolean;
  extractionStatus: OutlineExtractionStatus;
  onRefresh: () => void;
  onConfirm: () => void;
  onReject: () => void;
  onStart: () => void;
}) {
  const confirmed = preview?.review_status === 'confirmed';
  const rejected = preview?.review_status === 'rejected';
  const unmatchedCount = preview?.alignment_report?.unmatched_item_ids.length ?? 0;
  const warningCount = preview?.alignment_report?.warning_item_ids.length ?? 0;
  const extractionActive = extractionStatus === 'starting' || extractionStatus === 'running';
  const extractionStatusLabel = extractionStatus === 'starting'
    ? '正在启动抽取'
    : extractionStatus === 'running'
      ? '模型抽取中'
      : extractionStatus === 'completed'
        ? '抽取已完成'
        : extractionStatus === 'blocked'
          ? '抽取已阻断'
          : '';
  const usesDirectorySkeleton = preview?.source_kind === 'enrich' || preview?.source_kind === 'auto_toc';
  const outlineSourceLabel = preview?.source_kind === 'enrich'
    ? '参考教材目录 + 当前正文对齐'
    : preview?.source_kind === 'auto_toc'
      ? '自动发现当前教材目录 + 正文对齐'
      : '当前教材标题解析结果';
  const [selectedChunkId, setSelectedChunkId] = useState<string | null>(null);
  const [selectedChunk, setSelectedChunk] = useState<PipelineOutlineChunkContentResponse | null>(null);
  const [chunkLoading, setChunkLoading] = useState(false);
  const [chunkError, setChunkError] = useState('');
  const [chunkViewMode, setChunkViewMode] = useState<'reading' | 'source'>('reading');
  const chunks = useMemo(() => preview?.items.filter((item) => item.kind === 'chunk') ?? [], [preview]);
  const selectedChunkIndex = chunks.findIndex((item) => item.id === selectedChunkId);

  useEffect(() => {
    setSelectedChunkId(null);
    setSelectedChunk(null);
    setChunkError('');
    setChunkViewMode('reading');
  }, [preview?.fingerprint]);

  useEffect(() => {
    if (!preview || !selectedChunkId) return;
    let cancelled = false;
    setChunkLoading(true);
    setChunkError('');
    setSelectedChunk(null);
    void loadPipelineOutlineChunkContent(sourceKey, preview.book_id, selectedChunkId)
      .then((content) => {
        if (!cancelled) setSelectedChunk(content);
      })
      .catch((err) => {
        if (!cancelled) setChunkError((err as Error).message || '读取切分块内容失败');
      })
      .finally(() => {
        if (!cancelled) setChunkLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [preview, selectedChunkId, sourceKey]);

  const selectRelativeChunk = (offset: number) => {
    if (selectedChunkIndex < 0) return;
    const next = chunks[selectedChunkIndex + offset];
    if (next) setSelectedChunkId(next.id);
  };

  return (
    <section className={`overflow-hidden rounded-lg border bg-elevated ${confirmed ? 'border-node-process/40' : rejected ? 'border-node-event/40' : 'border-accent/35'}`} aria-labelledby="outline-review-title">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-border-subtle px-4 py-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent"><BookOpen className="h-4 w-4" /></span>
          <div id="outline-review-title" className="min-w-0 text-base font-semibold text-text-primary">目录切分审核</div>
        </div>
        <button type="button" onClick={onRefresh} disabled={loading || !preview} className="flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border-subtle bg-surface px-2.5 text-[11px] text-text-secondary transition-colors hover:bg-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50">
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}刷新预览
        </button>
      </header>

      {error ? (
        <div className="m-4 flex items-start gap-2 rounded-md border border-node-event/40 bg-node-event/10 p-3 text-xs text-node-event" role="alert"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{error}</div>
      ) : loading && !preview ? (
        <div className="flex min-h-40 items-center justify-center gap-2 text-xs text-text-muted"><Loader2 className="h-4 w-4 animate-spin text-accent" />正在读取切分结果…</div>
      ) : !preview ? (
        <div className="px-4 py-10 text-center">
          <ClipboardList className="mx-auto h-7 w-7 text-text-muted" />
          <div className="mt-3 text-xs font-medium text-text-secondary">尚无可审核的切分结果</div>
          <div className="mt-1 text-[11px] text-text-muted">从左侧导入教材并点击“生成目录切分预览”。</div>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-px border-b border-border-subtle bg-border-subtle sm:grid-cols-5">
            {[
              ['章', preview.summary.themes],
              ['节组', preview.summary.topics],
              ['课节', preview.summary.lessons],
              ['切分块', preview.summary.chunks],
              ['正文页', preview.summary.pages],
            ].map(([label, value]) => (
              <div key={String(label)} className="bg-surface px-3 py-2.5 text-center">
                <div className="text-sm font-semibold tabular-nums text-text-primary">{value}</div>
                <div className="mt-0.5 text-[10px] text-text-muted">{label}</div>
              </div>
            ))}
          </div>

          <div className="flex flex-wrap items-center gap-1.5 border-b border-border-subtle px-4 py-2 text-[10px] text-text-muted">
            <span className="rounded-full border border-border-subtle bg-surface px-2 py-0.5">目录来源 {outlineSourceLabel}</span>
            {preview.toc_pages && <span className="rounded-full border border-border-subtle bg-surface px-2 py-0.5">TOC 第 {preview.toc_pages.start}–{preview.toc_pages.end} 页</span>}
            <span className={`rounded-full border px-2 py-0.5 ${confirmed ? 'border-node-process/40 bg-node-process/10 text-node-process' : 'border-node-event/40 bg-node-event/10 text-node-event'}`}>
              {confirmed ? '已人工确认' : rejected ? '已驳回' : '等待人工确认'}
            </span>
            {extractionStatus !== 'idle' && (
              <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 ${extractionStatus === 'blocked' ? 'border-node-event/40 bg-node-event/10 text-node-event' : extractionStatus === 'completed' ? 'border-node-process/40 bg-node-process/10 text-node-process' : 'border-accent/40 bg-accent/10 text-accent'}`}>
                {extractionActive && <Loader2 className="h-2.5 w-2.5 animate-spin" />}{extractionStatusLabel}
              </span>
            )}
            <span className="rounded-full border border-accent/30 bg-accent/10 px-2 py-0.5 text-accent">知识 {preview.summary.knowledge_chunks}</span>
            <span className="rounded-full border border-node-process/30 bg-node-process/10 px-2 py-0.5 text-node-process">总结 {preview.summary.summary_chunks}</span>
            <span className="rounded-full border border-node-event/30 bg-node-event/10 px-2 py-0.5 text-node-event">题目 {preview.summary.assessment_chunks}</span>
            {(unmatchedCount > 0 || warningCount > 0) && (
              <span className="rounded-full border border-node-event/30 bg-node-event/10 px-2 py-0.5 text-node-event">待校准 {unmatchedCount + warningCount}</span>
            )}
            <span className="ml-auto truncate font-mono" title={preview.fingerprint}>版本 {preview.fingerprint.slice(0, 10)}</span>
          </div>

          {!usesDirectorySkeleton && (
            <div className="mx-4 mt-3 flex items-start gap-2 rounded-md border border-node-event/40 bg-node-event/10 p-2.5 text-[11px] text-node-event">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />当前没有使用参考教材目录，请重点检查章节层级和课节边界。
            </div>
          )}
          {preview.source_kind === 'auto_toc' && unmatchedCount === 0 && warningCount === 0 && (
            <div className="mx-4 mt-3 flex items-start gap-2 rounded-md border border-node-process/30 bg-node-process/10 p-2.5 text-[11px] text-node-process">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />已自动发现当前教材目录，并将目录课节按顺序对齐到 OCR 正文。
            </div>
          )}
          {usesDirectorySkeleton && unmatchedCount > 0 && (
            <div className="mx-4 mt-3 flex items-start gap-2 rounded-md border border-node-event/40 bg-node-event/10 p-2.5 text-[11px] text-node-event">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{preview.source_kind === 'enrich' ? '参考教材' : '自动发现的当前教材'}目录骨架已保留，但仍有 {unmatchedCount} 个课节没有可靠的正文起止位置；可以继续确认，未定位课节不会进入本轮抽取。
            </div>
          )}
          {usesDirectorySkeleton && unmatchedCount === 0 && warningCount > 0 && (
            <div className="mx-4 mt-3 flex items-start gap-2 rounded-md border border-accent/35 bg-accent/10 p-2.5 text-[11px] text-accent">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />有 {warningCount} 个课节通过 OCR 模糊匹配定位，请重点核对其 start/end 边界。
            </div>
          )}

          <div className={selectedChunkId ? 'grid border-b border-border-subtle lg:grid-cols-[minmax(0,1.3fr)_minmax(320px,0.7fr)]' : 'border-b border-border-subtle'}>
            <div className="max-h-[520px] overflow-auto scrollbar-thin" role="tree" aria-label="教材目录与切分块">
              {preview.items.map((item) => {
                const pageRange = outlineRange(item.page_start, item.page_end, '页');
                const mdRange = outlineRange(item.md_start, item.md_end, '行');
                const isChunk = item.kind === 'chunk';
                const isSelected = item.id === selectedChunkId;
                const chunkRole = outlineChunkRole(item);
                const row = (
                  <div className="flex min-w-0 items-start gap-2" style={{ paddingLeft: `${Math.min(item.depth, 5) * 16}px` }}>
                    <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${chunkRole?.dotClassName ?? (item.kind === 'lesson' || item.kind === 'activity' ? 'bg-node-process' : 'bg-border-strong')}`} />
                    <div className="min-w-0 flex-1 text-left">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className={`text-xs ${isChunk ? 'font-medium text-text-secondary' : 'font-semibold text-text-primary'}`}>{item.title}</span>
                        <span className={`rounded border px-1.5 py-0.5 text-[9px] ${chunkRole?.className ?? 'border-border-subtle bg-surface text-text-muted'}`}>
                          {chunkRole?.label ?? outlineItemKindLabel(item.kind)}
                        </span>
                        {item.alignment_status === 'unmatched' && <span className="rounded border border-node-event/40 bg-node-event/10 px-1.5 py-0.5 text-[9px] text-node-event">未对齐</span>}
                        {item.alignment_status === 'warning' && <span className="rounded border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[9px] text-accent">低置信度 {item.alignment_confidence == null ? '' : Math.round(item.alignment_confidence * 100) + '%'}</span>}
                        {item.alignment_status === 'inferred_from_children' && <span className="rounded border border-border-subtle bg-surface px-1.5 py-0.5 text-[9px] text-text-muted">由子节推断</span>}
                      </div>
                      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[10px] text-text-muted">
                        {pageRange && <span>{pageRange}</span>}
                        {mdRange && <span>{mdRange}</span>}
                        {item.line_count != null && isChunk && <span>{item.line_count} 行正文</span>}
                        {item.source_ids.length > 0 && <span>来源课节 {item.source_ids.length}</span>}
                      </div>
                    </div>
                    {isChunk && <Eye className={`mt-0.5 h-3.5 w-3.5 shrink-0 transition-colors ${isSelected ? 'text-accent' : 'text-text-muted group-hover:text-accent'}`} />}
                  </div>
                );
                return (
                  <div key={item.id} role="treeitem" aria-level={item.depth + 1} className="relative border-b border-border-subtle last:border-b-0">
                    {isChunk ? (
                      <button
                        type="button"
                        aria-label={`查看切分块：${item.title}`}
                        aria-pressed={isSelected}
                        onClick={() => {
                          setSelectedChunkId(item.id);
                          setChunkViewMode('reading');
                        }}
                        title={item.preview_text || `查看 ${item.title} 的具体切分内容`}
                        className={`group relative block w-full cursor-pointer px-3 py-2 text-left transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/60 ${isSelected ? 'bg-accent/10' : 'bg-accent/[0.035] hover:bg-hover'}`}
                      >
                        {row}
                        {item.preview_text && !isSelected && (
                          <span className="pointer-events-none absolute right-8 top-1/2 z-30 hidden w-[min(420px,48%)] -translate-y-1/2 rounded-md border border-border-strong bg-elevated px-3 py-2 text-left text-[10px] leading-4 text-text-secondary shadow-lg motion-safe:transition-opacity md:group-hover:block md:group-focus-visible:block">
                            <span className="mb-1 block font-semibold text-text-primary">内容速览</span>
                            <span className="line-clamp-4">{item.preview_text}</span>
                            <span className="mt-1 block text-accent">点击固定查看完整块</span>
                          </span>
                        )}
                      </button>
                    ) : (
                      <div className="px-3 py-2 transition-colors hover:bg-hover/60">{row}</div>
                    )}
                  </div>
                );
              })}
            </div>

            {selectedChunkId && (
              <aside className="order-first flex min-h-64 max-h-[520px] flex-col border-b border-border-subtle bg-surface lg:order-none lg:border-b-0 lg:border-l" aria-label="切分块详情" aria-live="polite">
                <div className="flex items-start gap-2 border-b border-border-subtle bg-elevated px-3 py-2.5">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-accent/10 text-accent"><FileText className="h-3.5 w-3.5" /></span>
                  <div className="min-w-0 flex-1">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.12em] text-accent">切分块详情</div>
                    <div className="mt-0.5 truncate text-xs font-semibold text-text-primary">{selectedChunk?.title || chunks[selectedChunkIndex]?.title || '正在读取…'}</div>
                  </div>
                  <button type="button" onClick={() => setSelectedChunkId(null)} aria-label="关闭切分块详情" className="flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-text-muted transition-colors hover:bg-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"><X className="h-3.5 w-3.5" /></button>
                </div>

                <div className="min-h-0 flex-1 overflow-auto p-3 scrollbar-thin">
                  {chunkLoading ? (
                    <div className="flex min-h-40 items-center justify-center gap-2 text-xs text-text-muted"><Loader2 className="h-4 w-4 animate-spin text-accent" />正在读取完整切分内容…</div>
                  ) : chunkError ? (
                    <div className="flex items-start gap-2 rounded-md border border-node-event/40 bg-node-event/10 p-3 text-[11px] leading-5 text-node-event"><AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{chunkError}</div>
                  ) : selectedChunk ? (
                    <>
                      <div className="mb-3 flex flex-wrap items-center gap-1.5 text-[9px] text-text-muted">
                        {outlineRange(selectedChunk.page_start, selectedChunk.page_end, '页') && <span className="rounded-full border border-border-subtle bg-elevated px-2 py-0.5">{outlineRange(selectedChunk.page_start, selectedChunk.page_end, '页')}</span>}
                        <span className="rounded-full border border-border-subtle bg-elevated px-2 py-0.5">行 {selectedChunk.md_start}–{selectedChunk.md_end}</span>
                        <span className="rounded-full border border-border-subtle bg-elevated px-2 py-0.5">{selectedChunk.line_count} 行</span>
                        <span className="rounded-full border border-border-subtle bg-elevated px-2 py-0.5">{selectedChunk.character_count.toLocaleString('zh-CN')} 字符</span>
                        <div className="ml-auto flex rounded-md border border-border-subtle bg-elevated p-0.5" aria-label="切分块显示方式">
                          <button type="button" onClick={() => setChunkViewMode('reading')} aria-pressed={chunkViewMode === 'reading'} className={`flex h-6 cursor-pointer items-center gap-1 rounded px-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${chunkViewMode === 'reading' ? 'bg-accent text-white shadow-sm' : 'text-text-muted hover:bg-hover hover:text-text-primary'}`}><BookOpen className="h-3 w-3" />阅读</button>
                          <button type="button" onClick={() => setChunkViewMode('source')} aria-pressed={chunkViewMode === 'source'} className={`flex h-6 cursor-pointer items-center gap-1 rounded px-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 ${chunkViewMode === 'source' ? 'bg-accent text-white shadow-sm' : 'text-text-muted hover:bg-hover hover:text-text-primary'}`}><FileText className="h-3 w-3" />源码</button>
                        </div>
                      </div>
                      {chunkViewMode === 'reading' ? (
                        <section aria-label="电子教材阅读预览" className="rounded-lg bg-[#f8f6f0] p-3 text-slate-900 dark:bg-surface dark:text-text-primary">
                          <article className="mx-auto rounded-xl border border-black/10 bg-white px-5 py-6 shadow-panel dark:border-border-subtle dark:bg-elevated">
                            <div className="mb-5 flex items-center justify-between border-b border-slate-200 pb-3 text-[10px] text-slate-500 dark:border-border-subtle dark:text-text-muted">
                              <span>{selectedChunk.page_start == null || selectedChunk.page_end == null ? '页码未标注' : `第 ${selectedChunk.page_start}${selectedChunk.page_end === selectedChunk.page_start ? '' : `–${selectedChunk.page_end}`} 页`}</span>
                              <span>{selectedChunk.line_count} 行切分内容</span>
                            </div>
                            <MarkdownView
                              content={textbookReadingMarkdown(selectedChunk.content) || '这个切分块没有可显示的正文。'}
                              className="text-sm leading-7 text-slate-800 dark:text-text-secondary"
                              imageLayout="reader"
                              hideDecorativeImages={false}
                              resolveImageUrl={(imageSource) => chunkAssetUrl(sourceKey, selectedChunk.asset_base_path, imageSource)}
                            />
                          </article>
                        </section>
                      ) : (
                        <pre className="whitespace-pre-wrap break-words rounded-md border border-border-subtle bg-elevated p-3 font-mono text-[11px] leading-5 text-text-secondary">{selectedChunk.content || '这个切分块没有可显示的正文。'}</pre>
                      )}
                    </>
                  ) : null}
                </div>

                <div className="flex items-center justify-between border-t border-border-subtle bg-elevated px-3 py-2 text-[10px] text-text-muted">
                  <span>第 {selectedChunkIndex + 1} / {chunks.length} 块</span>
                  <div className="flex gap-1">
                    <button type="button" onClick={() => selectRelativeChunk(-1)} disabled={selectedChunkIndex <= 0} className="flex h-7 cursor-pointer items-center gap-1 rounded-md border border-border-subtle px-2 transition-colors hover:bg-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-40"><ChevronLeft className="h-3 w-3" />上一块</button>
                    <button type="button" onClick={() => selectRelativeChunk(1)} disabled={selectedChunkIndex < 0 || selectedChunkIndex >= chunks.length - 1} className="flex h-7 cursor-pointer items-center gap-1 rounded-md border border-border-subtle px-2 transition-colors hover:bg-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:cursor-not-allowed disabled:opacity-40">下一块<ChevronRight className="h-3 w-3" /></button>
                  </div>
                </div>
              </aside>
            )}
          </div>

          <footer className="grid gap-3 border-t border-border-subtle bg-surface/50 p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto_auto] sm:items-center">
            <div className="text-[11px] leading-5 text-text-muted">
              {extractionActive
                ? '模型抽取已在后台运行；可以留在当前页面继续查看切分结果，状态会自动刷新。'
                : extractionStatus === 'completed'
                  ? '本书模型抽取已完成；可以返回运行详情查看质量结果。'
                  : extractionStatus === 'blocked'
                    ? '模型抽取已阻断；切分审核页保持不变，可返回运行详情处理失败原因。'
                    : confirmed
                ? unmatchedCount > 0
                  ? `已于 ${timeText(preview.confirmed_at)} 带 ${unmatchedCount} 个未对齐课节确认；这些课节未纳入本轮抽取。`
                  : `已于 ${timeText(preview.confirmed_at)} 确认；若重新生成切分，确认会自动失效。`
                : rejected
                  ? `已于 ${timeText(preview.rejected_at)} 驳回；请修正目录来源后重新生成切分预览。`
                  : unmatchedCount > 0
                    ? `还有 ${unmatchedCount} 个课节未对齐；可以强制确认并跳过这些课节，也可以先修正目录。`
                    : '请检查章节归属、页码范围以及是否存在跨课节 chunk，确认后才可开始抽取。'}
            </div>
            <button type="button" onClick={onReject} disabled={rejecting || rejected || extractionStatus !== 'idle'} className="flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-node-event/50 bg-node-event/10 px-3 text-xs font-semibold text-node-event transition-colors hover:bg-node-event/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-node-event/40 disabled:cursor-not-allowed disabled:border-border-subtle disabled:bg-surface disabled:text-text-muted">
              {rejecting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}{confirmed ? '撤销确认并驳回' : rejected ? '切分已驳回' : '驳回切分结果'}
            </button>
            <button type="button" onClick={onConfirm} disabled={confirming || confirmed || rejected} className="flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md border border-accent/50 bg-accent/10 px-3 text-xs font-semibold text-accent transition-colors hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:border-border-subtle disabled:bg-surface disabled:text-text-muted">
              {confirming ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}{confirmed ? '切分已确认' : unmatchedCount > 0 ? '跳过未对齐并确认' : '确认切分结果'}
            </button>
            <button type="button" onClick={onStart} disabled={!confirmed || extractionStatus !== 'idle'} className="flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-md bg-accent px-4 text-xs font-semibold text-white transition-colors hover:bg-accent-dim focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-surface disabled:text-text-muted">
              {extractionActive ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : extractionStatus === 'completed' ? <Check className="h-3.5 w-3.5" /> : extractionStatus === 'blocked' ? <AlertCircle className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              {extractionStatusLabel || '开始模型抽取'}
            </button>
          </footer>
        </>
      )}
    </section>
  );
}

export function PipelineDebugPage() {
  const { selectedSourceKey, switchSource } = useAppState();
  const activeSourceKey =
    selectedSourceKey ||
    new URLSearchParams(window.location.search).get('source') ||
    'main';

  const [payload, setPayload] = useState<PipelineResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [batchResuming, setBatchResuming] = useState(false);
  const [startError, setStartError] = useState('');
  const [startResult, setStartResult] = useState<PipelineStartResponse | null>(null);
  const [jobStatus, setJobStatus] = useState<PipelineJobStatusResponse | null>(null);
  const [jobList, setJobList] = useState<PipelineJobListResponse | null>(null);
  const [jobListLoading, setJobListLoading] = useState(false);
  const [jobListError, setJobListError] = useState('');
  const [imageReviews, setImageReviews] = useState<ImageReviewResponse | null>(null);
  const [imageReviewLoading, setImageReviewLoading] = useState(false);
  const [imageReviewError, setImageReviewError] = useState('');
  const [imageReviewUpdating, setImageReviewUpdating] = useState('');
  const [quality, setQuality] = useState<PipelineQualityDashboardResponse | null>(null);
  const [qualityLoading, setQualityLoading] = useState(false);
  const [qualityError, setQualityError] = useState('');
  const [qualityReviewUpdating, setQualityReviewUpdating] = useState('');
  const [outlinePreview, setOutlinePreview] = useState<PipelineOutlinePreviewResponse | null>(null);
  const [outlinePreviewLoading, setOutlinePreviewLoading] = useState(false);
  const [outlinePreviewError, setOutlinePreviewError] = useState('');
  const [outlineConfirming, setOutlineConfirming] = useState(false);
  const [outlineRejecting, setOutlineRejecting] = useState(false);
  const [outlineBatchJobIds, setOutlineBatchJobIds] = useState<string[]>([]);
  const [outlineReviewFocus, setOutlineReviewFocus] = useState(true);
  const [outlineReviewJobId, setOutlineReviewJobId] = useState<string | null>(null);
  const [outlineExtractionJobId, setOutlineExtractionJobId] = useState<string | null>(null);
  const [outlineExtractionStarting, setOutlineExtractionStarting] = useState(false);
  const outlineReviewRef = useRef<HTMLDivElement | null>(null);
  const pendingOutlineReviewJobRef = useRef<string | null>(null);

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

  const refreshJobs = async (options: { silent?: boolean } = {}) => {
    if (!options.silent) setJobListLoading(true);
    setJobListError('');
    try {
      setJobList(await loadPipelineJobs(activeSourceKey));
    } catch (err) {
      setJobListError((err as Error).message || '读取教材处理任务列表失败');
    } finally {
      if (!options.silent) setJobListLoading(false);
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

  const submitQualityReview = async (lessonRunId: string, action: PipelineQualityReviewAction, note: string) => {
    if (qualityReviewUpdating) return;
    setQualityReviewUpdating(lessonRunId);
    setQualityError('');
    try {
      await updatePipelineQualityReview(activeSourceKey, lessonRunId, { action, note: note.trim() || undefined });
      await refreshQuality({ silent: true });
    } catch (err) {
      setQualityError((err as Error).message || '更新质量复核失败');
    } finally {
      setQualityReviewUpdating('');
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

  const refreshOutlinePreview = async (bookId?: string, options: { silent?: boolean } = {}) => {
    const resolvedBookId = bookId?.trim() || outlinePreview?.book_id || jobStatus?.book_id;
    if (!resolvedBookId) return;
    if (!options.silent) setOutlinePreviewLoading(true);
    setOutlinePreviewError('');
    try {
      setOutlinePreview(await loadPipelineOutlinePreview(activeSourceKey, resolvedBookId));
    } catch (err) {
      setOutlinePreviewError((err as Error).message || '读取目录切分预览失败');
    } finally {
      if (!options.silent) setOutlinePreviewLoading(false);
    }
  };

  const launchPipeline = async (request: PipelineStartRequest, options: { preserveActiveJob?: boolean } = {}) => {
    setStarting(true);
    setStartError('');
    if (!options.preserveActiveJob) {
      setStartResult(null);
      setJobStatus(null);
    }
    try {
      if (request.prepare_only) {
        setOutlinePreview(null);
        setOutlinePreviewError('');
      }
      const result = await startPipeline(activeSourceKey, request);
      rememberPipelineJob(window.localStorage, activeSourceKey, result);
      setStartResult(result);
      window.setTimeout(() => {
        void refreshJobStatus(result.job_id);
        void refreshJobs({ silent: true });
        void refresh({ silent: true });
        void refreshImageReviews({ silent: true });
        void refreshQuality({ silent: true });
      }, 1200);
      return result;
    } catch (err) {
      setStartError((err as Error).message || '启动失败');
      return null;
    } finally {
      setStarting(false);
    }
  };

  const stopActivePipeline = async () => {
    if (!activeJobStatus || activeJobStatus.status !== 'running' || stopping) return;
    const confirmed = window.confirm('确定停止当前作业吗？已写入的结果会保留。');
    if (!confirmed) return;
    setStopping(true);
    setStartError('');
    try {
      await stopPipeline(activeSourceKey, activeJobStatus.job_id);
      await Promise.all([
        refreshJobStatus(activeJobStatus.job_id),
        refreshJobs({ silent: true }),
        refresh({ silent: true }),
      ]);
    } catch (err) {
      setStartError((err as Error).message || '停止作业失败');
    } finally {
      setStopping(false);
    }
  };

  const launchBatchBook = async (book: {
    bookId: string;
    title: string;
    pdfPath?: string;
    ocrFolderPath?: string;
    ocrImportMode?: 'in_place' | 'copy';
    enrichContext: boolean;
    enrichBookPath?: string;
  }): Promise<PipelineStartResponse> => {
    const result = await startPipeline(activeSourceKey, buildPipelineBatchStartRequest(baseStartRequest(activeSourceKey), book));
    rememberPipelineJob(window.localStorage, activeSourceKey, result);
    setStartResult(result);
    setJobStatus(null);
    return result;
  };

  useEffect(() => {
    let cancelled = false;
    setOutlineReviewJobId(null);
    setOutlineExtractionJobId(null);
    setOutlineExtractionStarting(false);
    const restoredJob = restorePipelineJob(window.localStorage, activeSourceKey);
    setStartResult(restoredJob);
    setJobStatus(null);
    void refresh();
    void refreshJobs();
    void refreshImageReviews();
    void refreshQuality();
    if (restoredJob) {
      void loadPipelineJobStatus(activeSourceKey, restoredJob.job_id)
        .then((status) => {
          if (cancelled) return;
          if (status.status === 'unknown') {
            forgetPipelineJob(window.localStorage, activeSourceKey);
            setStartResult(null);
            setJobStatus(null);
            return;
          }
          setJobStatus(status);
        })
        .catch(() => {
          if (!cancelled) setJobStatus(null);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [activeSourceKey]);

  const selectJob = async (job: PipelineJobSummary) => {
    setOutlineExtractionJobId(null);
    setOutlineExtractionStarting(false);
    setOutlineReviewJobId(job.job_id);
    pendingOutlineReviewJobRef.current = isOutlineReviewReady({
      status: job.status,
      currentStageId: job.current_stage_id,
    })
      ? job.job_id
      : null;
    const selected: PipelineStartResponse = {
      job_id: job.job_id,
      status: 'started',
      command: [],
      log_path: job.log_path,
    };
    rememberPipelineJob(window.localStorage, activeSourceKey, selected);
    setStartResult(selected);
    setJobStatus(null);
    setStartError('');
    setOutlinePreview(null);
    setOutlinePreviewError('');
    try {
      setJobStatus(await loadPipelineJobStatus(activeSourceKey, job.job_id));
    } catch (err) {
      setStartError((err as Error).message || '读取作业详情失败');
    }
  };

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
  const activeJobStatus = startResult
    && jobStatus?.job_id === startResult.job_id
    && jobStatus.status !== 'unknown'
    ? jobStatus
    : null;
  const showOutlineReview = activeJobStatus ? isOutlineReviewReady({
    status: activeJobStatus.status,
    currentStageId: activeJobStatus.current_stage?.id,
    prepareOnly: activeJobStatus.context.prepare_only,
  }) : false;
  const steps = useMemo(
    () => buildPipelineSteps({ payload, imageReviews, jobStatus: activeJobStatus, starting, startResult }),
    [payload, imageReviews, activeJobStatus, starting, startResult],
  );
  const pipelineDone = pipelineComplete(payload);
  const jobDone = activeJobStatus?.status === 'completed' || activeJobStatus?.status === 'blocked';
  const resumeStage = activeJobStatus?.status === 'blocked'
    ? resumeStageFor(activeJobStatus.current_stage?.id)
    : null;
  const batchResumeCandidates = useMemo(
    () => selectBatchResumeCandidates(jobList?.jobs ?? []),
    [jobList?.jobs],
  );
  const outlineExtractionStatus = resolveOutlineExtractionStatus({
    launching: outlineExtractionStarting,
    extractionJobId: outlineExtractionJobId,
    selectedJobId: startResult?.job_id ?? null,
    jobStatus: activeJobStatus,
  });
  const outlineSessionActive = showOutlineReview || outlineExtractionStatus !== 'idle';
  const outlineCandidateActiveJobId = outlineExtractionStatus !== 'idle'
    ? outlineReviewJobId
    : activeJobStatus?.job_id;
  const outlineBatchCandidates = useMemo(() => {
    return selectOutlineBatchJobs(jobList?.jobs ?? [], outlineBatchJobIds, outlineCandidateActiveJobId);
  }, [jobList?.jobs, outlineBatchJobIds, outlineCandidateActiveJobId]);
  const autoRefreshing = starting || Boolean(startResult && !jobDone);
  const lastUpdatedAt = activeJobStatus?.updated_at ?? null;
  const reviewMode = outlineSessionActive && outlineReviewFocus;

  const rememberOutlineBatch = (jobIds: string[]) => {
    const uniqueJobIds = [...new Set(jobIds.filter(Boolean))];
    setOutlineBatchJobIds(uniqueJobIds);
    window.localStorage.setItem(`okm.pipeline.outline-review-batch.v1:${activeSourceKey}`, JSON.stringify(uniqueJobIds));
  };

  const resumeActivePipeline = async (stage: PipelineStartStage) => {
    if (!activeJobStatus?.book_id || starting) return;
    await launchPipeline({
      ...baseStartRequest(activeSourceKey),
      resume_job_id: activeJobStatus.job_id,
      book_id: activeJobStatus.book_id,
      mineru_force: false,
      start_stage: stage,
    });
  };

  const resumeBlockedPipelines = async () => {
    if (batchResuming || batchResumeCandidates.length === 0) return;
    setBatchResuming(true);
    setStartError('');
    try {
      const results = await Promise.allSettled(batchResumeCandidates.map(({ job, startStage }) => startPipeline(
        activeSourceKey,
        {
          ...baseStartRequest(activeSourceKey),
          resume_job_id: job.job_id,
          book_id: job.book_id,
          mineru_force: false,
          start_stage: startStage,
        },
      )));
      const started = results.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []);
      const failures = results.flatMap((result) => result.status === 'rejected'
        ? [(result.reason as Error)?.message || '启动失败']
        : []);
      const last = started.at(-1);
      if (last) {
        rememberPipelineJob(window.localStorage, activeSourceKey, last);
        setStartResult(last);
        setJobStatus(null);
      }
      if (failures.length > 0) {
        setStartError(`已并行启动 ${started.length}/${results.length} 个作业；${failures.join('；')}`);
      }
      await refreshJobs({ silent: true });
      void refresh({ silent: true });
    } finally {
      setBatchResuming(false);
    }
  };

  const confirmOutline = async () => {
    if (!outlinePreview || outlineConfirming || outlinePreview.review_status === 'confirmed') return;
    const unmatchedCount = outlinePreview.alignment_report?.unmatched_item_ids.length ?? 0;
    if (unmatchedCount > 0) {
      const confirmed = window.confirm(
        `仍有 ${unmatchedCount} 个课节未对齐正文。继续后，这些课节不会进入本轮模型抽取，但会保留在目录中供后续修复。确定继续吗？`,
      );
      if (!confirmed) return;
    }
    setOutlineConfirming(true);
    setOutlinePreviewError('');
    try {
      const result = await confirmPipelineOutline(activeSourceKey, outlinePreview.book_id, {
        fingerprint: outlinePreview.fingerprint,
        allow_unmatched: unmatchedCount > 0,
      });
      setOutlinePreview((current) => current && current.fingerprint === result.fingerprint
        ? { ...current, review_status: 'confirmed', confirmed_at: result.confirmed_at, rejected_at: null }
        : current);
    } catch (err) {
      setOutlinePreviewError((err as Error).message || '确认切分结果失败');
      await refreshOutlinePreview(outlinePreview.book_id, { silent: true });
    } finally {
      setOutlineConfirming(false);
    }
  };

  const rejectOutline = async () => {
    if (!outlinePreview || outlineRejecting || outlinePreview.review_status === 'rejected') return;
    const message = outlinePreview.review_status === 'confirmed'
      ? '确定撤销确认并驳回这份切分结果吗？已经生成的抽取数据不会被删除，但该版本不能再启动新的模型抽取。'
      : '确定驳回这份切分结果吗？驳回后需要重新生成并确认新版预览，才能开始模型抽取。';
    if (!window.confirm(message)) return;
    setOutlineRejecting(true);
    setOutlinePreviewError('');
    try {
      const result = await rejectPipelineOutline(activeSourceKey, outlinePreview.book_id, {
        fingerprint: outlinePreview.fingerprint,
      });
      setOutlinePreview((current) => current && current.fingerprint === result.fingerprint
        ? { ...current, review_status: 'rejected', confirmed_at: null, rejected_at: result.rejected_at }
        : current);
    } catch (err) {
      setOutlinePreviewError((err as Error).message || '驳回切分结果失败');
      await refreshOutlinePreview(outlinePreview.book_id, { silent: true });
    } finally {
      setOutlineRejecting(false);
    }
  };

  const launchConfirmedExtraction = async () => {
    if (!outlinePreview || outlinePreview.review_status !== 'confirmed' || starting || outlineExtractionStatus !== 'idle') return;
    setOutlineReviewFocus(true);
    setOutlineReviewJobId((current) => current || activeJobStatus?.job_id || null);
    setOutlineExtractionStarting(true);
    try {
      const result = await launchPipeline(buildConfirmedExtractionRequest(baseStartRequest(activeSourceKey), {
        bookId: outlinePreview.book_id,
        fingerprint: outlinePreview.fingerprint,
      }), { preserveActiveJob: true });
      setOutlineExtractionJobId(result?.job_id ?? null);
    } finally {
      setOutlineExtractionStarting(false);
    }
  };

  useEffect(() => {
    if (!startResult || activeJobStatus?.status !== 'completed') return;
    invalidateUnitCache(activeSourceKey);
    void switchSource(activeSourceKey);
  }, [activeSourceKey, activeJobStatus?.status, startResult?.job_id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    try {
      const stored = JSON.parse(window.localStorage.getItem(`okm.pipeline.outline-review-batch.v1:${activeSourceKey}`) || '[]');
      setOutlineBatchJobIds(Array.isArray(stored) ? stored.filter((value): value is string => typeof value === 'string') : []);
    } catch {
      setOutlineBatchJobIds([]);
    }
  }, [activeSourceKey]);

  useEffect(() => {
    if (showOutlineReview && activeJobStatus?.job_id) {
      setOutlineReviewJobId(activeJobStatus.job_id);
      setOutlineReviewFocus(true);
    }
  }, [activeJobStatus?.job_id, showOutlineReview]);

  useEffect(() => {
    if (!activeJobStatus?.book_id) return;
    if (!showOutlineReview) return;
    void refreshOutlinePreview(activeJobStatus.book_id);
  }, [activeSourceKey, activeJobStatus?.book_id, activeJobStatus?.job_id, showOutlineReview]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!showOutlineReview || pendingOutlineReviewJobRef.current !== activeJobStatus?.job_id) return undefined;
    pendingOutlineReviewJobRef.current = null;
    const frame = window.requestAnimationFrame(() => {
      const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      outlineReviewRef.current?.scrollIntoView({
        behavior: reducedMotion ? 'auto' : 'smooth',
        block: 'start',
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [activeJobStatus?.job_id, showOutlineReview]);

  useEffect(() => {
    if (!autoRefreshing) return undefined;
    const timer = window.setInterval(() => {
      void refreshJobStatus();
      void refreshJobs({ silent: true });
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
            <h1 className="text-2xl font-semibold tracking-tight text-text-primary">教材知识处理中心</h1>
          </div>
          <button
            type="button"
            onClick={() => {
              void refreshJobStatus();
              void refreshJobs();
              void refresh();
              void refreshImageReviews();
              void refreshQuality();
            }}
            className="flex h-10 cursor-pointer items-center gap-2 rounded-md border border-border-subtle bg-elevated px-3.5 text-sm font-medium text-text-secondary transition-colors hover:bg-hover hover:text-text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
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

        {!reviewMode && (
          <PipelineBookWorkbench
            key={activeSourceKey}
            sourceKey={activeSourceKey}
            jobs={jobList?.jobs ?? []}
            onStartBook={launchBatchBook}
            onBatchStarted={rememberOutlineBatch}
            onRefreshJobs={() => {
              void refreshJobs();
              void refresh({ silent: true });
            }}
          />
        )}

        {startError && (
          <div className="mb-5 flex items-start gap-2 rounded-lg border border-node-event/40 bg-node-event/10 p-3 text-sm text-node-event" role="alert">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{startError}</span>
          </div>
        )}

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
          <section className="min-w-0 space-y-5">
            {!reviewMode && (
              <PipelineJobListPanel
                jobs={jobList?.jobs ?? []}
                selectedJobId={startResult?.job_id ?? null}
                activeJobStatus={activeJobStatus}
                loading={jobListLoading}
                starting={starting}
                stopping={stopping}
                batchResuming={batchResuming}
                batchResumeCount={batchResumeCandidates.length}
                resumeStage={resumeStage}
                error={jobListError}
                onSelect={(job) => {
                  void selectJob(job);
                }}
                onRefresh={() => {
                  void refreshJobs();
                }}
                onStop={() => {
                  void stopActivePipeline();
                }}
                onResume={(stage) => {
                  void resumeActivePipeline(stage);
                }}
                onResumeBlocked={() => {
                  void resumeBlockedPipelines();
                }}
              />
            )}

            {outlineSessionActive && (
              <div ref={outlineReviewRef} className="scroll-mt-4">
                <OutlineReviewPanel
                  sourceKey={activeSourceKey}
                  preview={outlinePreview}
                  loading={outlinePreviewLoading}
                  error={outlinePreviewError}
                  confirming={outlineConfirming}
                  rejecting={outlineRejecting}
                  extractionStatus={outlineExtractionStatus}
                  onRefresh={() => void refreshOutlinePreview()}
                  onConfirm={() => void confirmOutline()}
                  onReject={() => void rejectOutline()}
                  onStart={() => void launchConfirmedExtraction()}
                />
              </div>
            )}

            {!reviewMode && (
              <>
                <PipelineProgressPanel steps={steps} jobStatus={activeJobStatus} autoRefreshing={autoRefreshing} lastUpdatedAt={lastUpdatedAt} />

                <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                  <MetricCard label="课时运行" value={payload?.summary.lesson_runs ?? 0} detail={latestLesson ? `最近：${timeText(latestLesson.updated_at)}` : '暂无运行'} />
                  <MetricCard label="待整理结果" value={payload?.summary.staged ?? 0} tone="active" detail="等待合并或检查" />
                  <MetricCard label="已通过质量检查" value={payload?.summary.qa_passed ?? 0} tone="ok" detail={`通过率 ${percentValue(successRate)}`} />
                  <MetricCard label="阻断项" value={payload?.summary.blocked ?? 0} tone={(payload?.summary.blocked ?? 0) > 0 ? 'warn' : 'neutral'} detail="需要人工处理" />
                </div>

                <ManualReviewSummary payload={payload} imageReviews={imageReviews} pipelineDone={pipelineDone} />

                <QualityDashboardPanel
                  quality={quality}
                  loading={qualityLoading}
                  error={qualityError}
                  reviewUpdatingId={qualityReviewUpdating}
                  onRefresh={() => void refreshQuality()}
                  onReviewAction={(lessonRunId, action, note) => void submitQualityReview(lessonRunId, action, note)}
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
                        <td colSpan={6} className="px-3 py-12 text-center text-text-muted">暂无课时处理记录。可以从左侧启动第一次处理。</td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
                </div>
              </>
            )}
          </section>

          <aside className={`min-w-0 space-y-5 ${reviewMode ? 'order-first xl:order-last' : ''}`}>
            {reviewMode ? (
              <div className="sticky top-4 z-20">
                <OutlineBatchCandidatesPanel
                  jobs={outlineBatchCandidates}
                  selectedJobId={outlineCandidateActiveJobId ?? null}
                  activeReviewStatus={outlinePreview?.review_status ?? null}
                  loading={jobListLoading}
                  onSelect={(job) => void selectJob(job)}
                  onRefresh={() => void refreshJobs()}
                  onExitFocus={() => setOutlineReviewFocus(false)}
                />
              </div>
            ) : (
              <>

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
                  <span className={activeJobStatus ? 'text-text-primary' : 'text-text-secondary'}>
                    {activeJobStatus ? statusLabel(activeJobStatus.status) : '暂无'}
                  </span>
                </div>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-text-muted">当前阶段</span>
                  <span className="truncate text-text-primary">{stageLabel(activeJobStatus?.current_stage?.id) || '暂无'}</span>
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
              </>
            )}
          </aside>
        </div>
      </div>
    </main>
  );
}
