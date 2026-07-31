import assert from 'node:assert/strict';
import test from 'node:test';
import type { PipelineJobStage, PipelineJobStatusResponse } from '@okm/types';
import { buildPipelineStepStatuses } from '../src/lib/pipeline-steps.ts';

function stage(id: string, status: string): PipelineJobStage {
  return {
    id,
    status,
    label: id,
    progress: {},
    started_at: null,
    completed_at: status === 'completed' ? '2026-07-29T00:00:00.000Z' : null,
    updated_at: '2026-07-29T00:00:00.000Z',
  };
}

function jobStatus(input: {
  jobId?: string;
  status?: PipelineJobStatusResponse['status'];
  stages?: PipelineJobStage[];
  currentStageId?: string;
} = {}): PipelineJobStatusResponse {
  const stages = input.stages ?? [];
  return {
    job_id: input.jobId ?? 'job-current',
    book_id: 'book-current',
    status: input.status ?? 'running',
    log_path: '',
    progress: {},
    stages,
    current_stage: stages.find((item) => item.id === input.currentStageId) ?? null,
    worker_states: [],
    recent_events: [],
    updated_at: null,
    completed_at: null,
    error: null,
  };
}

test('keeps every extraction step pending before the current run starts', () => {
  const staleCompletedJob = jobStatus({
    jobId: 'job-old',
    status: 'completed',
    stages: [stage('quality_dashboard', 'completed')],
    currentStageId: 'quality_dashboard',
  });

  assert.deepEqual(buildPipelineStepStatuses({
    jobStatus: staleCompletedJob,
    currentJobId: null,
    starting: false,
    reviewCount: 4,
  }), {
    source: 'pending',
    outline: 'pending',
    lesson: 'pending',
    merge: 'pending',
    review: 'pending',
  });
});

test('shows only source preparation as active while waiting for the new job status', () => {
  const staleCompletedJob = jobStatus({
    jobId: 'job-old',
    status: 'completed',
    stages: [stage('quality_dashboard', 'completed')],
    currentStageId: 'quality_dashboard',
  });

  assert.deepEqual(buildPipelineStepStatuses({
    jobStatus: staleCompletedJob,
    currentJobId: 'job-current',
    starting: false,
    reviewCount: 0,
  }), {
    source: 'active',
    outline: 'pending',
    lesson: 'pending',
    merge: 'pending',
    review: 'pending',
  });
});

test('does not complete source preparation after only the database check succeeds', () => {
  const currentJob = jobStatus({
    stages: [
      stage('check_postgres', 'completed'),
      stage('mineru_source_markdown', 'running'),
    ],
    currentStageId: 'mineru_source_markdown',
  });

  assert.equal(buildPipelineStepStatuses({
    jobStatus: currentJob,
    currentJobId: currentJob.job_id,
    starting: false,
    reviewCount: 0,
  }).source, 'active');
});

test('keeps outline pending while the source group reads a PDF outline', () => {
  const currentJob = jobStatus({
    stages: [
      stage('check_postgres', 'completed'),
      stage('extract_pdf_outline', 'running'),
    ],
    currentStageId: 'extract_pdf_outline',
  });

  const statuses = buildPipelineStepStatuses({
    jobStatus: currentJob,
    currentJobId: currentJob.job_id,
    starting: false,
    reviewCount: 0,
  });

  assert.equal(statuses.source, 'active');
  assert.equal(statuses.outline, 'pending');
});

test('uses terminal stages from the current job to advance the stepper', () => {
  const currentJob = jobStatus({
    stages: [
      stage('check_postgres', 'completed'),
      stage('prepare_source_markdown', 'completed'),
      stage('lesson_plan', 'completed'),
      stage('lesson_staging', 'running'),
    ],
    currentStageId: 'lesson_staging',
  });

  assert.deepEqual(buildPipelineStepStatuses({
    jobStatus: currentJob,
    currentJobId: currentJob.job_id,
    starting: false,
    reviewCount: 0,
  }), {
    source: 'complete',
    outline: 'complete',
    lesson: 'active',
    merge: 'pending',
    review: 'pending',
  });
});

test('shows reused stages as complete when a job resumes from a later checkpoint', () => {
  const resumedJob = jobStatus({
    stages: [
      stage('prepare_source_markdown', 'skipped'),
      stage('lesson_plan', 'skipped'),
      stage('lesson_staging', 'skipped'),
      stage('staging_quality', 'running'),
    ],
    currentStageId: 'staging_quality',
  });

  assert.deepEqual(buildPipelineStepStatuses({
    jobStatus: resumedJob,
    currentJobId: resumedJob.job_id,
    starting: false,
    reviewCount: 0,
  }), {
    source: 'complete',
    outline: 'complete',
    lesson: 'complete',
    merge: 'active',
    review: 'pending',
  });
});

test('keeps model extraction active while failed lessons are being retried', () => {
  const currentJob = jobStatus({
    stages: [
      stage('prepare_source_markdown', 'completed'),
      stage('lesson_plan', 'completed'),
      stage('lesson_staging', 'completed'),
      stage('lesson_staging_retry_1', 'running'),
    ],
    currentStageId: 'lesson_staging_retry_1',
  });

  assert.equal(buildPipelineStepStatuses({
    jobStatus: currentJob,
    currentJobId: currentJob.job_id,
    starting: false,
    reviewCount: 0,
  }).lesson, 'active');
});

test('finishes the current run before exposing its review state', () => {
  const currentJob = jobStatus({
    status: 'completed',
    stages: [stage('quality_dashboard', 'completed')],
    currentStageId: 'quality_dashboard',
  });

  assert.deepEqual(buildPipelineStepStatuses({
    jobStatus: currentJob,
    currentJobId: currentJob.job_id,
    starting: false,
    reviewCount: 2,
  }), {
    source: 'complete',
    outline: 'complete',
    lesson: 'complete',
    merge: 'complete',
    review: 'active',
  });
});
