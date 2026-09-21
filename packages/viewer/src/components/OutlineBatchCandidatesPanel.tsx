import type { PipelineJobSummary, PipelineOutlineReviewStatus } from '@okm/types';
import { AlertCircle, BookOpen, Check, Loader2, RotateCcw } from '@/lib/lucide-icons';
import { isOutlineReviewReady } from '@/lib/pipeline-start';

function candidateState(
  job: PipelineJobSummary,
  selected: boolean,
  activeReviewStatus: PipelineOutlineReviewStatus | null,
): { label: string; tone: string } {
  if (selected && activeReviewStatus === 'confirmed') return { label: '已确认', tone: 'border-node-process/40 bg-node-process/10 text-node-process' };
  if (selected && activeReviewStatus === 'rejected') return { label: '已驳回', tone: 'border-node-event/40 bg-node-event/10 text-node-event' };
  if (job.status === 'blocked') return { label: '切分失败', tone: 'border-node-event/40 bg-node-event/10 text-node-event' };
  if (job.status === 'running') return { label: '切分中', tone: 'border-accent/40 bg-accent/10 text-accent' };
  return { label: '待审核', tone: 'border-accent/40 bg-accent/10 text-accent' };
}

export function OutlineBatchCandidatesPanel({
  jobs,
  selectedJobId,
  activeReviewStatus,
  loading,
  onSelect,
  onRefresh,
  onExitFocus,
}: {
  jobs: PipelineJobSummary[];
  selectedJobId: string | null;
  activeReviewStatus: PipelineOutlineReviewStatus | null;
  loading: boolean;
  onSelect: (job: PipelineJobSummary) => void;
  onRefresh: () => void;
  onExitFocus: () => void;
}) {
  const readyCount = jobs.filter((job) => isOutlineReviewReady({ status: job.status, currentStageId: job.current_stage_id })).length;

  return (
    <section className="overflow-hidden rounded-lg border border-accent/30 bg-elevated shadow-panel" aria-labelledby="outline-batch-candidates-title">
      <header className="flex items-start justify-between gap-3 border-b border-border-subtle px-3.5 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <BookOpen className="h-4 w-4 text-accent" />
            <div id="outline-batch-candidates-title" className="text-sm font-semibold text-text-primary">本批教材</div>
          </div>
          <div className="mt-1 text-[11px] text-text-muted">{jobs.length} 本已选择切分 · {readyCount} 本可审核</div>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          disabled={loading}
          aria-label="刷新本批教材状态"
          className="flex h-7 w-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border-subtle text-text-muted transition-colors hover:bg-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
        </button>
      </header>

      <div className="max-h-[58vh] overflow-y-auto p-2 scrollbar-thin" aria-label="本批切分教材">
        {jobs.map((job, index) => {
          const selected = job.job_id === selectedJobId;
          const ready = isOutlineReviewReady({ status: job.status, currentStageId: job.current_stage_id });
          const state = candidateState(job, selected, activeReviewStatus);
          return (
            <button
              key={job.job_id}
              type="button"
              onClick={() => onSelect(job)}
              disabled={!ready}
              aria-current={selected ? 'true' : undefined}
              className={`mb-1 w-full rounded-md border px-2.5 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent ${ready ? 'cursor-pointer' : 'cursor-not-allowed opacity-65'} ${selected ? 'border-accent bg-accent/10' : 'border-transparent hover:border-border-default hover:bg-hover'}`}
            >
              <div className="flex items-start gap-2">
                <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${selected ? 'bg-accent text-white' : 'bg-surface text-text-muted'}`}>
                  {selected ? <Check className="h-3 w-3" /> : index + 1}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-xs font-medium leading-4 text-text-primary">{job.book_title}</span>
                  <span className="mt-1 flex items-center justify-between gap-2">
                    <span className={`inline-flex rounded-full border px-1.5 py-0.5 text-[9px] font-medium ${state.tone}`}>{state.label}</span>
                    <span className="truncate text-[9px] text-text-muted">{job.current_stage_label || '目录切分'}</span>
                  </span>
                </span>
              </div>
            </button>
          );
        })}
        {jobs.length === 0 && (
          <div className="flex items-start gap-2 px-2 py-8 text-xs leading-5 text-text-muted">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />本批任务尚未同步，请刷新状态。
          </div>
        )}
      </div>

      <footer className="border-t border-border-subtle p-3">
        <button
          type="button"
          onClick={onExitFocus}
          className="h-8 w-full cursor-pointer rounded-md border border-border-default bg-surface px-3 text-[11px] font-medium text-text-secondary transition-colors hover:bg-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          返回批量工作台与运行详情
        </button>
      </footer>
    </section>
  );
}
