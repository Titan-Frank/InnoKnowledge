import assert from 'node:assert/strict';
import test from 'node:test';
import type { PipelineJobSummary } from '@okm/types';
import {
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

test('fresh and resumed starts preserve the selected textbook identifier', () => {
  assert.equal(resolvePipelineStartBookId('chem-grade8', null, false), 'chem-grade8');
  assert.equal(resolvePipelineStartBookId('stale-form-id', 'active-job-id', true), 'active-job-id');
  assert.equal(resolvePipelineStartBookId('', null, false), undefined);
});
