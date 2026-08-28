import type { PipelineJobStatusResponse } from '@okm/types';

export type PipelineStepId = 'source' | 'outline' | 'lesson' | 'merge' | 'review';
export type PipelineStepStatus = 'complete' | 'active' | 'blocked' | 'pending';
export type PipelineStepStatuses = Record<PipelineStepId, PipelineStepStatus>;

export const sourceStageIds = [
  'check_postgres',
  'mineru_source_markdown',
  'extract_pdf_outline',
  'prepare_source_markdown',
] as const;
export const outlineStageIds = ['ensure_outline', 'prepare_outline_chunks', 'lesson_plan'] as const;
export const lessonStageIds = ['lesson_staging'] as const;
export const mergeStageIds = [
  'staging_quality',
  'canonical_commit',
  'assessment_staging',
  'assessment_quality',
  'assessment_commit',
  'normalize',
  'node_bodies',
  'pedagogical_profiles',
  'node_embeddings',
  'unit_embeddings',
  'strict_qa',
  'graph_integrity',
  'quality_dashboard',
] as const;

type BuildPipelineStepStatusesInput = {
  jobStatus: PipelineJobStatusResponse | null;
  currentJobId: string | null;
  starting: boolean;
  reviewCount: number;
};

const pendingStatuses = (): PipelineStepStatuses => ({
  source: 'pending',
  outline: 'pending',
  lesson: 'pending',
  merge: 'pending',
  review: 'pending',
});

export function matchesPipelineStageId(stageId: string | undefined, ids: readonly string[]): boolean {
  if (!stageId) return false;
  return ids.includes(stageId)
    || (ids.includes('lesson_staging') && stageId.startsWith('lesson_staging_retry_'))
    || (ids.includes('assessment_staging') && stageId.startsWith('assessment_staging_retry_'));
}

function hasStageStatus(
  jobStatus: PipelineJobStatusResponse,
  ids: readonly string[],
  status: string,
): boolean {
  return jobStatus.stages.some((stage) => matchesPipelineStageId(stage.id, ids) && stage.status === status);
}

function groupStatus(
  jobStatus: PipelineJobStatusResponse,
  ids: readonly string[],
  completedStageId: string,
): PipelineStepStatus {
  const currentStage = jobStatus.current_stage;
  if (
    hasStageStatus(jobStatus, ids, 'blocked')
    || (jobStatus.status === 'blocked' && matchesPipelineStageId(currentStage?.id, ids))
  ) {
    return 'blocked';
  }
  if (hasStageStatus(jobStatus, ids, 'running')) return 'active';
  if (
    jobStatus.status === 'running'
    && matchesPipelineStageId(currentStage?.id, ids)
    && !(currentStage?.id === completedStageId && currentStage.status === 'completed')
  ) {
    return 'active';
  }
  if (
    hasStageStatus(jobStatus, [completedStageId], 'completed')
    || hasStageStatus(jobStatus, [completedStageId], 'skipped')
  ) return 'complete';
  return 'pending';
}

export function buildPipelineStepStatuses(
  input: BuildPipelineStepStatusesInput,
): PipelineStepStatuses {
  const statuses = pendingStatuses();
  const { currentJobId, jobStatus, reviewCount, starting } = input;

  if (starting) {
    statuses.source = 'active';
    return statuses;
  }

  if (!currentJobId) return statuses;

  const currentJobStatus = jobStatus?.job_id === currentJobId && jobStatus.status !== 'unknown'
    ? jobStatus
    : null;
  if (!currentJobStatus) {
    statuses.source = 'active';
    return statuses;
  }

  if (currentJobStatus.status === 'completed') {
    statuses.source = 'complete';
    statuses.outline = 'complete';
    statuses.lesson = 'complete';
    statuses.merge = 'complete';
    statuses.review = reviewCount > 0 ? 'active' : 'complete';
    return statuses;
  }

  statuses.source = groupStatus(currentJobStatus, sourceStageIds, 'prepare_source_markdown');
  statuses.outline = groupStatus(currentJobStatus, outlineStageIds, 'lesson_plan');
  statuses.lesson = groupStatus(currentJobStatus, lessonStageIds, 'lesson_staging');
  statuses.merge = groupStatus(currentJobStatus, mergeStageIds, 'quality_dashboard');
  if (currentJobStatus.status === 'running' && !currentJobStatus.current_stage) {
    statuses.source = 'active';
  }
  return statuses;
}
