import { useEffect, useMemo, useState, type FormEvent } from 'react';
import type { PipelineResponse, PipelineReviewItem, PipelineStartResponse, TextbookMetadataResponse } from '@okm/types';
import { inferTextbookMetadata, loadPipeline, startPipeline } from '@/services/backend-client';
import { useAppState } from '@/hooks/useAppState';
import { AlertCircle, BarChart3, Check, Loader2, RotateCcw } from '@/lib/lucide-icons';

function numberValue(value: unknown): number {
  return typeof value === 'number' ? value : Number(value ?? 0) || 0;
}

function timeText(value: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString();
}

function StatusPill({ status }: { status: string }) {
  const style =
    status === 'qa_passed' || status === 'completed' || status === 'success'
      ? 'border-node-process/40 bg-node-process/10 text-node-process'
      : status === 'blocked' || status === 'failed'
        ? 'border-node-event/40 bg-node-event/10 text-node-event'
        : 'border-accent/40 bg-accent/10 text-accent';
  return <span className={`border px-1.5 py-0.5 text-[10px] ${style}`}>{status}</span>;
}

function Metric({ label, value, tone = 'normal' }: { label: string; value: number; tone?: 'normal' | 'warn' | 'ok' }) {
  const color = tone === 'warn' ? 'text-node-event' : tone === 'ok' ? 'text-node-process' : 'text-text-primary';
  return (
    <div className="border border-border-subtle bg-surface px-3 py-2">
      <div className={`text-lg font-semibold ${color}`}>{value}</div>
      <div className="text-xs text-text-muted">{label}</div>
    </div>
  );
}

function ReviewList({ items }: { items: PipelineReviewItem[] }) {
  if (items.length === 0) {
    return (
      <div className="flex items-center gap-2 border border-border-subtle bg-surface p-3 text-sm text-text-secondary">
        <Check className="h-4 w-4 text-node-process" />
        暂无待复核合并项
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {items.slice(0, 12).map((item) => (
        <div key={`${item.merge_run_id}:${item.lesson_run_id}:${item.raw_node_id}`} className="border border-border-subtle bg-surface p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate text-sm font-medium text-text-primary">{item.raw_node_id}</div>
              <div className="truncate text-xs text-text-muted">候选：{item.canonical_node_id}</div>
            </div>
            <div className="text-sm font-semibold text-accent">{item.similarity.toFixed(2)}</div>
          </div>
          <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-text-muted">
            <span>词面 {numberValue(item.rationale.lexical).toFixed(2)}</span>
            <span>语义键 {numberValue(item.rationale.semantic_key).toFixed(2)}</span>
            <span>向量 {numberValue(item.rationale.embedding).toFixed(2)}</span>
          </div>
        </div>
      ))}
    </div>
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
  const [error, setError] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState('');
  const [startResult, setStartResult] = useState<PipelineStartResponse | null>(null);
  const [metadata, setMetadata] = useState<TextbookMetadataResponse | null>(null);
  const [inferring, setInferring] = useState(false);
  const [form, setForm] = useState({
    book_id: '',
    pdf_path: '',
    output_root: 'data/main',
    parallelism: '4',
    lesson_subject: '',
    lesson_school_stage: '',
    lesson_grade_band: '',
    lesson_backend_kind: 'openai_responses',
    openai_base_url: '',
    openai_model: '',
  });

  const refresh = async () => {
    setLoading(true);
    setError(false);
    try {
      setPayload(await loadPipeline(activeSourceKey));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  const updateForm = (key: keyof typeof form, value: string) => {
    setForm((current) => ({ ...current, [key]: value }));
  };

  const submitStart = async (event: FormEvent) => {
    event.preventDefault();
    if (!form.book_id.trim()) return;
    setStarting(true);
    setStartError('');
    setStartResult(null);
    try {
      const result = await startPipeline(activeSourceKey, {
        book_id: form.book_id.trim(),
        pdf_path: form.pdf_path.trim() || undefined,
        dataset_id: activeSourceKey,
        output_root: form.output_root.trim() || 'data/main',
        parallelism: Number(form.parallelism) || 4,
        lesson_backend_kind: form.lesson_backend_kind,
        lesson_subject: form.lesson_subject.trim() || undefined,
        lesson_school_stage: form.lesson_school_stage.trim() || undefined,
        lesson_grade_band: form.lesson_grade_band.trim() || undefined,
        openai_base_url: form.openai_base_url.trim() || undefined,
        openai_model: form.openai_model.trim() || undefined,
      });
      setStartResult(result);
      window.setTimeout(() => void refresh(), 1200);
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
        lesson_subject: result.lesson_subject,
        lesson_school_stage: result.lesson_school_stage,
        lesson_grade_band: result.lesson_grade_band,
      }));
    } catch (err) {
      setStartError((err as Error).message || '识别失败');
    } finally {
      setInferring(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, [activeSourceKey]);

  const recentLessons = useMemo(
    () => [...(payload?.lesson_runs ?? [])].sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || '')),
    [payload],
  );

  return (
    <main className="flex min-h-0 flex-1 flex-col bg-void">
      <div className="border-b border-border-subtle bg-surface px-5 py-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-text-primary">抽取调试</div>
            <div className="text-xs text-text-muted">数据源 {activeSourceKey}</div>
          </div>
          <button
            onClick={() => void refresh()}
            className="flex items-center gap-2 border border-border-subtle bg-elevated px-3 py-1.5 text-xs text-text-secondary hover:bg-hover"
          >
            {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
            刷新
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-5 scrollbar-thin">
        {error && (
          <div className="mb-4 flex items-center gap-2 border border-node-event/40 bg-node-event/10 p-3 text-sm text-node-event">
            <AlertCircle className="h-4 w-4" />
            读取管线状态失败
          </div>
        )}

        {!payload && loading && (
          <div className="flex items-center gap-2 text-sm text-text-muted">
            <Loader2 className="h-4 w-4 animate-spin" />
            加载管线状态…
          </div>
        )}

        <div className="space-y-5">
            <section className="border border-border-subtle bg-elevated p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-text-primary">启动抽取</div>
                  <div className="text-xs text-text-muted">提交后在后端后台运行现有 harness</div>
                </div>
                {startResult && (
                  <div className="truncate text-xs text-node-process">已启动 {startResult.job_id}</div>
                )}
              </div>
              <form onSubmit={submitStart} className="grid gap-3 lg:grid-cols-[1fr_1.5fr_120px_120px_120px_120px_auto]">
                <label className="block">
                  <span className="mb-1 block text-[10px] text-text-muted">book_id</span>
                  <input
                    value={form.book_id}
                    onChange={(e) => updateForm('book_id', e.target.value)}
                    className="w-full border border-border-subtle bg-surface px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
                    placeholder="chem-grade8"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] text-text-muted">PDF 路径</span>
                  <input
                    value={form.pdf_path}
                    onChange={(e) => updateForm('pdf_path', e.target.value)}
                    className="w-full border border-border-subtle bg-surface px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
                    placeholder="/abs/path/to/book.pdf"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] text-text-muted">学科</span>
                  <input
                    value={form.lesson_subject}
                    onChange={(e) => updateForm('lesson_subject', e.target.value)}
                    className="w-full border border-border-subtle bg-surface px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
                    placeholder="自动识别"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] text-text-muted">学段</span>
                  <select
                    value={form.lesson_school_stage}
                    onChange={(e) => updateForm('lesson_school_stage', e.target.value)}
                    className="w-full border border-border-subtle bg-surface px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
                  >
                    <option value="">自动识别</option>
                    <option value="primary">primary</option>
                    <option value="junior-secondary">junior-secondary</option>
                    <option value="senior-secondary">senior-secondary</option>
                    <option value="higher">higher</option>
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] text-text-muted">年级</span>
                  <input
                    value={form.lesson_grade_band}
                    onChange={(e) => updateForm('lesson_grade_band', e.target.value)}
                    className="w-full border border-border-subtle bg-surface px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
                    placeholder="自动识别"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] text-text-muted">并行</span>
                  <input
                    value={form.parallelism}
                    onChange={(e) => updateForm('parallelism', e.target.value)}
                    className="w-full border border-border-subtle bg-surface px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
                    inputMode="numeric"
                  />
                </label>
                <div className="flex items-end">
                  <button
                    type="submit"
                    disabled={starting || !form.book_id.trim()}
                    className="flex h-[31px] items-center gap-2 border border-accent bg-accent px-3 text-xs text-white disabled:cursor-not-allowed disabled:border-border-subtle disabled:bg-surface disabled:text-text-muted"
                  >
                    {starting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    启动
                  </button>
                </div>
              </form>
              <div className="mt-3 grid gap-3 lg:grid-cols-[1fr_1fr_180px_180px_auto]">
                <label className="block">
                  <span className="mb-1 block text-[10px] text-text-muted">输出目录</span>
                  <input
                    value={form.output_root}
                    onChange={(e) => updateForm('output_root', e.target.value)}
                    className="w-full border border-border-subtle bg-surface px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] text-text-muted">OpenAI Base URL</span>
                  <input
                    value={form.openai_base_url}
                    onChange={(e) => updateForm('openai_base_url', e.target.value)}
                    className="w-full border border-border-subtle bg-surface px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
                    placeholder="默认 https://api.openai.com/v1"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] text-text-muted">模型</span>
                  <input
                    value={form.openai_model}
                    onChange={(e) => updateForm('openai_model', e.target.value)}
                    className="w-full border border-border-subtle bg-surface px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
                    placeholder="默认 gpt-4.1"
                  />
                </label>
                <label className="block">
                  <span className="mb-1 block text-[10px] text-text-muted">后端</span>
                  <select
                    value={form.lesson_backend_kind}
                    onChange={(e) => updateForm('lesson_backend_kind', e.target.value)}
                    className="w-full border border-border-subtle bg-surface px-2 py-1.5 text-xs text-text-primary outline-none focus:border-accent"
                  >
                    <option value="openai_responses">openai_responses</option>
                    <option value="openai_chat_completions">openai_chat_completions</option>
                    <option value="local_rule_based">local_rule_based</option>
                  </select>
                </label>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={() => void submitInfer()}
                    disabled={inferring || !form.book_id.trim()}
                    className="flex h-[31px] items-center gap-2 border border-border-subtle bg-surface px-3 text-xs text-text-secondary hover:bg-hover disabled:cursor-not-allowed disabled:text-text-muted"
                  >
                    {inferring && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    识别教材信息
                  </button>
                </div>
              </div>
              {metadata && (
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-text-muted">
                  <span>识别：{metadata.lesson_subject}</span>
                  <span>{metadata.lesson_school_stage}</span>
                  <span>{metadata.lesson_grade_band}</span>
                  <span>置信度 {Math.round(metadata.confidence * 100)}%</span>
                  {metadata.signals.slice(0, 5).map((signal) => (
                    <span key={signal} className="bg-surface px-1.5 py-0.5">{signal}</span>
                  ))}
                </div>
              )}
              {startError && (
                <div className="mt-3 text-xs text-node-event">{startError}</div>
              )}
              {startResult && (
                <div className="mt-3 truncate text-xs text-text-muted">
                  日志：{startResult.log_path}
                </div>
              )}
            </section>

          {payload ? (
            <>
            <section className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-7">
              <Metric label="课时运行" value={payload.summary.lesson_runs} />
              <Metric label="已暂存" value={payload.summary.staged} />
              <Metric label="已合并" value={payload.summary.merged} />
              <Metric label="已通过 QA" value={payload.summary.qa_passed} tone="ok" />
              <Metric label="阻断" value={payload.summary.blocked} tone={payload.summary.blocked ? 'warn' : 'normal'} />
              <Metric label="待复核" value={payload.summary.review_items} tone={payload.summary.review_items ? 'warn' : 'normal'} />
              <Metric label="合并运行" value={payload.merge_runs.length} />
            </section>

            <section className="grid gap-5 lg:grid-cols-[1fr_360px]">
              <div className="border border-border-subtle bg-elevated">
                <div className="flex items-center gap-2 border-b border-border-subtle px-4 py-3">
                  <BarChart3 className="h-4 w-4 text-accent" />
                  <div className="text-sm font-medium text-text-primary">课时运行</div>
                </div>
                <div className="max-h-[520px] overflow-y-auto scrollbar-thin">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-elevated text-text-muted">
                      <tr>
                        <th className="px-3 py-2 font-medium">状态</th>
                        <th className="px-3 py-2 font-medium">课时</th>
                        <th className="px-3 py-2 font-medium">节点</th>
                        <th className="px-3 py-2 font-medium">边</th>
                        <th className="px-3 py-2 font-medium">证据</th>
                        <th className="px-3 py-2 font-medium">更新时间</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recentLessons.map((row) => (
                        <tr key={row.lesson_run_id} className="border-t border-border-subtle">
                          <td className="px-3 py-2"><StatusPill status={row.status} /></td>
                          <td className="max-w-[260px] truncate px-3 py-2 text-text-secondary" title={row.batch_anchor}>
                            {row.batch_anchor}
                            {row.quality_issues.length > 0 && (
                              <div className="mt-1 truncate text-[10px] text-node-event">{row.quality_issues[0]}</div>
                            )}
                          </td>
                          <td className="px-3 py-2 text-text-secondary">{numberValue(row.counts.nodes)}</td>
                          <td className="px-3 py-2 text-text-secondary">{numberValue(row.counts.edges)}</td>
                          <td className="px-3 py-2 text-text-secondary">{numberValue(row.counts.evidence)}</td>
                          <td className="px-3 py-2 text-text-muted">{timeText(row.updated_at)}</td>
                        </tr>
                      ))}
                      {recentLessons.length === 0 && (
                        <tr>
                          <td colSpan={6} className="px-3 py-8 text-center text-text-muted">还没有课时运行记录</td>
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="space-y-5">
                <section>
                  <div className="mb-2 text-sm font-medium text-text-primary">待复核合并</div>
                  <ReviewList items={payload.review_items} />
                </section>

                <section>
                  <div className="mb-2 text-sm font-medium text-text-primary">最近合并</div>
                  <div className="space-y-2">
                    {payload.merge_runs.slice(0, 5).map((run) => (
                      <div key={run.merge_run_id} className="border border-border-subtle bg-surface p-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="truncate text-xs font-medium text-text-primary">{run.merge_run_id}</div>
                          <StatusPill status={run.status} />
                        </div>
                        <div className="mt-2 grid grid-cols-3 gap-2 text-[10px] text-text-muted">
                          <span>新建 {numberValue(run.stats.nodes_created)}</span>
                          <span>匹配 {numberValue(run.stats.nodes_matched)}</span>
                          <span>复核 {numberValue(run.stats.nodes_review)}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </section>
              </div>
            </section>
            </>
          ) : (
            !loading && (
              <div className="border border-border-subtle bg-elevated p-6 text-sm text-text-muted">
                还没有读取到管线状态。可以先启动抽取，或确认后端 API 正在运行。
              </div>
            )
          )}
        </div>
      </div>
    </main>
  );
}
