import type { PgAdminBookSummary, PipelineJobSummary, PipelineStartRequest } from '@okm/types';

export type PipelineQueueStatus = 'uploading' | 'ready' | 'starting' | 'started' | 'error';

export interface PipelineBatchQueueItem {
  id: string;
  bookId: string;
  title: string;
  pdfPath: string;
  sizeBytes: number;
  selected: boolean;
  status: PipelineQueueStatus;
  progress: number;
  error: string;
}

export interface PipelineBookWorkbenchRow {
  key: string;
  bookId: string;
  title: string;
  pdfPath: string;
  sizeBytes: number;
  selected: boolean;
  queueStatus: PipelineQueueStatus | null;
  queueError: string;
  progress: number;
  job: PipelineJobSummary | null;
  database: PgAdminBookSummary | null;
}

function latestJobsByBook(jobs: PipelineJobSummary[]): Map<string, PipelineJobSummary> {
  const latest = new Map<string, PipelineJobSummary>();
  jobs.forEach((job) => {
    if (!latest.has(job.book_id)) latest.set(job.book_id, job);
  });
  return latest;
}

export function buildPipelineBookWorkbenchRows(
  queue: PipelineBatchQueueItem[],
  databaseBooks: PgAdminBookSummary[],
  jobs: PipelineJobSummary[],
): PipelineBookWorkbenchRow[] {
  const latestJobs = latestJobsByBook(jobs);
  const queuedBookIds = new Set(queue.map((item) => item.bookId).filter(Boolean));
  const queueRows = queue.map<PipelineBookWorkbenchRow>((item) => ({
    key: item.id,
    bookId: item.bookId,
    title: item.title,
    pdfPath: item.pdfPath,
    sizeBytes: item.sizeBytes,
    selected: item.selected,
    queueStatus: item.status,
    queueError: item.error,
    progress: item.progress,
    job: latestJobs.get(item.bookId) ?? null,
    database: databaseBooks.find((book) => book.book_id === item.bookId) ?? null,
  }));
  const databaseRows = databaseBooks
    .filter((book) => !queuedBookIds.has(book.book_id))
    .map<PipelineBookWorkbenchRow>((book) => ({
      key: `db:${book.book_id}`,
      bookId: book.book_id,
      title: book.title,
      pdfPath: '',
      sizeBytes: 0,
      selected: false,
      queueStatus: null,
      queueError: '',
      progress: 0,
      job: latestJobs.get(book.book_id) ?? null,
      database: book,
    }));

  return [...queueRows, ...databaseRows].sort((left, right) => {
    if (left.pdfPath && !right.pdfPath) return -1;
    if (!left.pdfPath && right.pdfPath) return 1;
    return left.title.localeCompare(right.title, 'zh-CN');
  });
}

export function selectBatchLaunchCandidates<T extends PipelineBatchQueueItem>(
  queue: T[],
  jobs: PipelineJobSummary[],
): T[] {
  const latestJobs = latestJobsByBook(jobs);

  const selectedBookIds = new Set<string>();
  return queue.filter((item) => {
    const bookId = item.bookId.trim();
    if (!bookId || !item.selected || item.status !== 'ready' || !item.pdfPath) return false;
    if (latestJobs.get(bookId)?.status === 'running' || selectedBookIds.has(bookId)) return false;
    selectedBookIds.add(bookId);
    return true;
  });
}

export function buildPipelineBatchStartRequest(
  base: PipelineStartRequest,
  book: { bookId: string; title: string; pdfPath: string },
): PipelineStartRequest {
  const request = { ...base };
  const bookSpecificKeys: Array<keyof PipelineStartRequest> = [
    'resume_job_id', 'start_stage', 'book_id', 'book_title', 'pdf_path', 'mineru_file_url',
    'mineru_language', 'mineru_page_ranges', 'outline_start_page', 'outline_end_page',
    'extraction_template', 'lesson_subject', 'lesson_school_stage', 'lesson_grade_band',
  ];
  bookSpecificKeys.forEach((key) => delete request[key]);
  return {
    ...request,
    book_id: book.bookId,
    book_title: book.title,
    pdf_path: book.pdfPath,
  };
}

export function resolvePipelineStartBookId(
  selectedBookId: string,
  activeBookId: string | null | undefined,
  resuming: boolean,
): string | undefined {
  const selected = selectedBookId.trim();
  if (!resuming) return selected || undefined;
  return activeBookId?.trim() || selected || undefined;
}
