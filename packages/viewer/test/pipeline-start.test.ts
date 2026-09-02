import assert from 'node:assert/strict';
import test from 'node:test';
import type { PipelineJobSummary } from '@okm/types';
import {
  buildPipelineBatchStartRequest,
  buildConfirmedExtractionRequest,
  buildPipelineBookWorkbenchRows,
  isOutlineReviewReady,
  MAX_ACTIVE_PIPELINE_JOBS,
  reconcileScannedQueueSnapshot,
  reconcileTerminalBatchQueue,
  resolvePipelineResumeStage,
  resolvePipelineStartBookId,
  resolveOutlineExtractionStatus,
  selectBatchLaunchCandidates,
  selectBatchResumeCandidates,
  selectOutlineBatchJobs,
} from '../src/lib/pipeline-start.ts';

function job(bookId: string, status: PipelineJobSummary['status']): PipelineJobSummary {
  return {
    job_id: `${bookId}.${status}`,
    book_id: bookId,
    book_title: bookId,
    status,
    current_stage_id: null,
    current_stage_label: null,
    progress: {},
    log_path: '',
    created_at: null,
    updated_at: null,
    completed_at: null,
    error: null,
  };
}

test('batch launch candidates are unique by book and exclude the latest running job', () => {
  const queue = [
    { id: 'chem-a', bookId: 'chemistry', pdfPath: '/tmp/a.pdf', selected: true, status: 'ready', enrichContext: false },
    { id: 'chem-b', bookId: 'chemistry', pdfPath: '/tmp/b.pdf', selected: true, status: 'ready', enrichContext: false },
    { id: 'physics', bookId: 'physics', pdfPath: '/tmp/physics.pdf', selected: true, status: 'ready', enrichContext: false },
    { id: 'biology', bookId: 'biology', pdfPath: '/tmp/biology.pdf', selected: true, status: 'error', enrichContext: false },
  ];

  assert.deepEqual(
    selectBatchLaunchCandidates(queue, [job('physics', 'running'), job('physics', 'completed')]).map((item) => item.id),
    ['chem-a'],
  );
});

test('outline review candidates stay scoped to the selected batch and include the active job', () => {
  const first = { ...job('math-a', 'completed'), job_id: 'job-a', current_stage_id: 'prepare_outline_chunks' };
  const second = { ...job('math-b', 'completed'), job_id: 'job-b', current_stage_id: 'prepare_outline_chunks' };
  const unrelated = { ...job('physics', 'completed'), job_id: 'job-c', current_stage_id: 'prepare_outline_chunks' };
  assert.deepEqual(
    selectOutlineBatchJobs([first, second, unrelated], ['job-b', 'job-a', 'missing', 'job-b'], 'job-c').map((item) => item.job_id),
    ['job-c', 'job-b', 'job-a'],
  );
});

test('outline review candidates recover the current preparation batch after a reload', () => {
  const first = {
    ...job('math-a', 'completed'),
    job_id: 'job-a',
    current_stage_id: 'prepare_outline_chunks',
    created_at: '2026-09-01T10:00:00.000Z',
  };
  const second = {
    ...job('math-b', 'completed'),
    job_id: 'job-b',
    current_stage_id: 'prepare_outline_chunks',
    created_at: '2026-09-01T10:02:00.000Z',
  };
  const old = {
    ...job('old-book', 'completed'),
    job_id: 'job-old',
    current_stage_id: 'prepare_outline_chunks',
    created_at: '2026-08-31T10:00:00.000Z',
  };
  assert.deepEqual(
    selectOutlineBatchJobs([old, second, first], [], 'job-b').map((item) => item.job_id),
    ['job-a', 'job-b'],
  );
});

test('outline review appears only for completed preparation jobs', () => {
  assert.equal(isOutlineReviewReady({
    status: 'completed',
    currentStageId: 'prepare_outline_chunks',
  }), true);
  assert.equal(isOutlineReviewReady({
    status: 'completed',
    currentStageId: 'quality_dashboard',
    prepareOnly: true,
  }), true);
  assert.equal(isOutlineReviewReady({
    status: 'running',
    currentStageId: 'prepare_outline_chunks',
  }), false);
  assert.equal(isOutlineReviewReady({
    status: 'completed',
    currentStageId: 'quality_dashboard',
  }), false);
});

test('outline extraction status remains active while the new job status is loading', () => {
  assert.equal(resolveOutlineExtractionStatus({
    launching: true, extractionJobId: null, selectedJobId: null, jobStatus: null,
  }), 'starting');
  assert.equal(resolveOutlineExtractionStatus({
    launching: false, extractionJobId: 'extract-1', selectedJobId: 'extract-1', jobStatus: null,
  }), 'starting');
  assert.equal(resolveOutlineExtractionStatus({
    launching: false,
    extractionJobId: 'extract-1',
    selectedJobId: 'extract-1',
    jobStatus: { ...job('math', 'running'), job_id: 'extract-1', book_id: 'math', status: 'running', context: {}, progress: {}, stages: [], current_stage: null, worker_states: [], recent_events: [], updated_at: null, completed_at: null },
  }), 'running');
  assert.equal(resolveOutlineExtractionStatus({
    launching: false,
    extractionJobId: 'extract-1',
    selectedJobId: 'extract-1',
    jobStatus: { ...job('math', 'completed'), job_id: 'extract-1', book_id: 'math', status: 'completed', context: {}, progress: {}, stages: [], current_stage: null, worker_states: [], recent_events: [], updated_at: null, completed_at: null },
  }), 'completed');
  assert.equal(resolveOutlineExtractionStatus({
    launching: false,
    extractionJobId: 'extract-1',
    selectedJobId: 'extract-1',
    jobStatus: { ...job('math', 'blocked'), job_id: 'extract-1', book_id: 'math', status: 'blocked', context: {}, progress: {}, stages: [], current_stage: null, worker_states: [], recent_events: [], updated_at: null, completed_at: null },
  }), 'blocked');
});

test('batch launch candidates use only the remaining active job slots', () => {
  const queue = Array.from({ length: 5 }, (_, index) => ({
    id: `queued-${index}`,
    bookId: `queued-${index}`,
    pdfPath: `/tmp/queued-${index}.pdf`,
    selected: true,
    status: 'ready' as const,
    enrichContext: false,
  }));
  const runningJobs = Array.from({ length: MAX_ACTIVE_PIPELINE_JOBS - 1 }, (_, index) => (
    job(`running-${index}`, 'running')
  ));

  assert.deepEqual(
    selectBatchLaunchCandidates(queue, runningJobs).map((item) => item.id),
    ['queued-0'],
  );
  assert.deepEqual(
    selectBatchLaunchCandidates(queue, [...runningJobs, job('running-last', 'running')]),
    [],
  );
});

test('batch launch candidates accept validated OCR folders without a PDF path', () => {
  const queue = [{
    id: 'math-ocr',
    bookId: 'math-grade7',
    title: '七年级数学上册',
    pdfPath: '',
    ocrFolderPath: '/data/math/hybrid_ocr',
    sourceKind: 'ocr' as const,
    sizeBytes: 0,
    selected: true,
    status: 'ready' as const,
    enrichContext: true,
    enrichBookPath: 'data/enrich/数学/七年级数学上册.json',
    progress: 100,
    error: '',
  }];

  assert.deepEqual(selectBatchLaunchCandidates(queue, []).map((item) => item.id), ['math-ocr']);
  const rows = buildPipelineBookWorkbenchRows(queue, [], []);
  assert.deepEqual(rows.map((row) => [row.sourceKind, row.ocrFolderPath, row.pdfPath]), [
    ['ocr', '/data/math/hybrid_ocr', ''],
  ]);
});

test('batch launch waits for an explicit enrich decision', () => {
  const base = {
    id: 'physics',
    bookId: 'physics',
    title: '高中物理',
    pdfPath: '/tmp/physics.pdf',
    sizeBytes: 10,
    selected: true,
    status: 'ready' as const,
    progress: 100,
    error: '',
  };

  assert.deepEqual(selectBatchLaunchCandidates([base], []), []);
  assert.deepEqual(selectBatchLaunchCandidates([{ ...base, enrichContext: false }], []).map((item) => item.id), ['physics']);
  assert.deepEqual(selectBatchLaunchCandidates([{ ...base, enrichContext: true, enrichBookPath: '' }], []), []);
  assert.deepEqual(selectBatchLaunchCandidates([{ ...base, enrichContext: true, enrichBookPath: 'data/enrich/physics.json' }], []).map((item) => item.id), ['physics']);
});

test('terminal batch jobs become unselected ready entries that can be run again', () => {
  const queue = [
    { id: 'completed', bookId: 'chemistry', pdfPath: '/tmp/chem.pdf', selected: true, status: 'started' as const },
    { id: 'blocked', bookId: 'physics', pdfPath: '/tmp/physics.pdf', selected: true, status: 'started' as const },
    { id: 'running', bookId: 'biology', pdfPath: '/tmp/biology.pdf', selected: true, status: 'started' as const },
  ];

  const reconciled = reconcileTerminalBatchQueue(queue, [
    job('chemistry', 'completed'),
    job('physics', 'blocked'),
    job('biology', 'running'),
  ]);

  assert.deepEqual(reconciled.map((item) => [item.id, item.status, item.selected]), [
    ['completed', 'ready', false],
    ['blocked', 'ready', false],
    ['running', 'started', true],
  ]);
});

test('fresh and resumed starts preserve the selected textbook identifier', () => {
  assert.equal(resolvePipelineStartBookId('chem-grade8', null, false), 'chem-grade8');
  assert.equal(resolvePipelineStartBookId('stale-form-id', 'active-job-id', true), 'active-job-id');
  assert.equal(resolvePipelineStartBookId('', null, false), undefined);
});

test('batch resume fills free slots with resumable blocked jobs', () => {
  const jobs = [
    { ...job('running-book', 'running'), current_stage_id: 'lesson_staging' },
    { ...job('math-7-up', 'blocked'), current_stage_id: 'pedagogical_profiles' },
    { ...job('math-9-up', 'blocked'), current_stage_id: 'strict_qa' },
    { ...job('math-9-down', 'blocked'), current_stage_id: 'lesson_staging_retry_2' },
    { ...job('unknown-stage', 'blocked'), current_stage_id: 'custom_stage' },
    { ...job('extra', 'blocked'), current_stage_id: 'node_embeddings' },
  ];

  assert.deepEqual(
    selectBatchResumeCandidates(jobs).map(({ job: candidate, startStage }) => [candidate.book_id, startStage]),
    [
      ['math-7-up', 'pedagogical_profiles'],
      ['math-9-up', 'strict_qa'],
      ['math-9-down', 'staging_quality'],
    ],
  );
  assert.equal(resolvePipelineResumeStage('assessment_staging_retry_1'), 'assessment_quality');
});

test('batch requests keep shared runtime settings but infer metadata for each book', () => {
  const request = buildPipelineBatchStartRequest({
    book_id: 'chemistry',
    book_title: '八年级化学',
    pdf_path: '/tmp/chemistry.pdf',
    mineru_language: 'ch',
    mineru_page_ranges: '1-80',
    outline_start_page: 2,
    outline_end_page: 12,
    extraction_template: 'textbook/chemistry',
    lesson_subject: 'chemistry',
    lesson_school_stage: 'junior-secondary',
    lesson_grade_band: 'grade8',
    parallelism: 6,
    openai_model: 'shared-model',
  }, {
    bookId: 'physics',
    title: '高中物理 必修一',
    pdfPath: '/tmp/physics.pdf',
    enrichContext: true,
    enrichBookPath: 'data/enrich/物理/高中物理必修一.json',
  });

  assert.deepEqual(request, {
    book_id: 'physics',
    book_title: '高中物理 必修一',
    pdf_path: '/tmp/physics.pdf',
    enrich_context: true,
    enrich_book_path: 'data/enrich/物理/高中物理必修一.json',
    prepare_only: true,
    parallelism: 6,
    openai_model: 'shared-model',
  });
});

test('batch OCR requests clear stale PDF fields and forward the OCR folder', () => {
  const request = buildPipelineBatchStartRequest({
    pdf_path: '/tmp/stale.pdf',
    mineru_file_url: 'https://example.test/stale.pdf',
    parallelism: 4,
    openai_model: 'shared-model',
  }, {
    bookId: 'math-grade7',
    title: '七年级数学上册',
    ocrFolderPath: '/data/math/hybrid_ocr',
    enrichContext: false,
  });

  assert.deepEqual(request, {
    book_id: 'math-grade7',
    book_title: '七年级数学上册',
    ocr_folder_path: '/data/math/hybrid_ocr',
    ocr_import_mode: 'in_place',
    enrich_context: false,
    prepare_only: true,
    parallelism: 4,
    openai_model: 'shared-model',
  });
});

test('confirmed extraction starts from the stored lesson plan and carries the reviewed fingerprint', () => {
  assert.deepEqual(buildConfirmedExtractionRequest({
    book_id: 'stale',
    pdf_path: '/tmp/stale.pdf',
    ocr_folder_path: '/tmp/stale-ocr',
    mineru_force: true,
    parallelism: 6,
    openai_model: 'shared-model',
    prepare_only: true,
  }, {
    bookId: 'math-grade7',
    fingerprint: 'fingerprint-1',
  }), {
    book_id: 'math-grade7',
    pdf_path: undefined,
    ocr_folder_path: undefined,
    mineru_force: false,
    parallelism: 6,
    openai_model: 'shared-model',
    prepare_only: false,
    resume_job_id: undefined,
    mineru_file_url: undefined,
    outline_confirmation: 'fingerprint-1',
    start_stage: 'lesson_plan',
  });
});

test('workbench rows preserve every duplicate-ID queue entry', () => {
  const queue = [
    { id: 'first', bookId: 'physics', title: '物理 A', pdfPath: '/tmp/a.pdf', sizeBytes: 10, selected: true, status: 'ready' as const, progress: 100, error: '' },
    { id: 'second', bookId: 'physics', title: '物理 B', pdfPath: '/tmp/b.pdf', sizeBytes: 20, selected: false, status: 'ready' as const, progress: 100, error: '' },
  ];
  const rows = buildPipelineBookWorkbenchRows(queue, [], []);

  assert.deepEqual(rows.map((row) => [row.key, row.pdfPath, row.selected]), [
    ['first', '/tmp/a.pdf', true],
    ['second', '/tmp/b.pdf', false],
  ]);
});

test('folder rescans replace the previous scan snapshot and preserve explicit sources', () => {
  const current = [
    { id: '/disk02/math.pdf', queueOrigin: 'scan' as const, bookId: 'math', title: '数学', pdfPath: '/disk02/math.pdf', sizeBytes: 10, selected: false, status: 'ready' as const, progress: 100, error: '' },
    { id: '/disk02/removed.pdf', queueOrigin: 'scan' as const, bookId: 'removed', title: '已删除', pdfPath: '/disk02/removed.pdf', sizeBytes: 10, selected: false, status: 'ready' as const, progress: 100, error: '' },
    { id: 'upload:physics', queueOrigin: 'upload' as const, bookId: 'physics', title: '物理', pdfPath: '/uploads/physics.pdf', sizeBytes: 20, selected: true, status: 'ready' as const, progress: 100, error: '' },
  ];
  const scanned = [
    { id: '/disk06/math.pdf', queueOrigin: 'scan' as const, bookId: 'math', title: '数学', pdfPath: '/disk06/math.pdf', sizeBytes: 10, selected: false, status: 'ready' as const, progress: 100, error: '' },
    { id: '/disk06/chemistry.pdf', queueOrigin: 'scan' as const, bookId: 'chemistry', title: '化学', pdfPath: '/disk06/chemistry.pdf', sizeBytes: 30, selected: false, status: 'ready' as const, progress: 100, error: '' },
  ];

  assert.deepEqual(
    reconcileScannedQueueSnapshot(current, scanned).map((item) => item.id),
    ['upload:physics', '/disk06/math.pdf', '/disk06/chemistry.pdf'],
  );
});

test('folder rescans keep review state for unchanged paths', () => {
  const current = [{
    id: '/disk06/math.pdf',
    queueOrigin: 'scan' as const,
    bookId: 'math',
    title: '旧标题',
    pdfPath: '/disk06/math.pdf',
    sizeBytes: 10,
    selected: true,
    status: 'ready' as const,
    progress: 100,
    error: '',
    enrichContext: true,
    enrichBookPath: '/enrich/math.json',
  }];
  const scanned = [{
    id: '/disk06/math.pdf',
    queueOrigin: 'scan' as const,
    bookId: 'math',
    title: '当前硬盘标题',
    pdfPath: '/disk06/math.pdf',
    sizeBytes: 12,
    selected: false,
    status: 'ready' as const,
    progress: 100,
    error: '',
  }];

  assert.deepEqual(reconcileScannedQueueSnapshot(current, scanned)[0], {
    ...current[0],
    title: '当前硬盘标题',
    sizeBytes: 12,
  });
});
