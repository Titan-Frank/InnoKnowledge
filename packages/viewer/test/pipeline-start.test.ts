import assert from 'node:assert/strict';
import test from 'node:test';
import type { PipelineJobSummary } from '@okm/types';
import {
  buildPipelineBatchStartRequest,
  buildPipelineBookWorkbenchRows,
  MAX_ACTIVE_PIPELINE_JOBS,
  reconcileTerminalBatchQueue,
  resolvePipelineStartBookId,
  selectBatchLaunchCandidates,
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
    { id: 'chem-a', bookId: 'chemistry', pdfPath: '/tmp/a.pdf', selected: true, status: 'ready' },
    { id: 'chem-b', bookId: 'chemistry', pdfPath: '/tmp/b.pdf', selected: true, status: 'ready' },
    { id: 'physics', bookId: 'physics', pdfPath: '/tmp/physics.pdf', selected: true, status: 'ready' },
    { id: 'biology', bookId: 'biology', pdfPath: '/tmp/biology.pdf', selected: true, status: 'error' },
  ];

  assert.deepEqual(
    selectBatchLaunchCandidates(queue, [job('physics', 'running'), job('physics', 'completed')]).map((item) => item.id),
    ['chem-a'],
  );
});

test('batch launch candidates use only the remaining active job slots', () => {
  const queue = Array.from({ length: 5 }, (_, index) => ({
    id: `queued-${index}`,
    bookId: `queued-${index}`,
    pdfPath: `/tmp/queued-${index}.pdf`,
    selected: true,
    status: 'ready' as const,
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
  });

  assert.deepEqual(request, {
    book_id: 'physics',
    book_title: '高中物理 必修一',
    pdf_path: '/tmp/physics.pdf',
    parallelism: 6,
    openai_model: 'shared-model',
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
