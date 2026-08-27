import type { PgAdminBookSummary, PipelineJobSummary, PipelineStartRequest } from '@okm/types';

export type PipelineQueueStatus = 'uploading' | 'ready' | 'starting' | 'started' | 'error';
export type PipelineSourceKind = 'pdf' | 'ocr';

export const MAX_ACTIVE_PIPELINE_JOBS = 4;

export interface PipelineBatchQueueItem {
  id: string;
  bookId: string;
  title: string;
  pdfPath: string;
  ocrFolderPath?: string;
  sourceKind?: PipelineSourceKind;
  enrichContext?: boolean;
  enrichBookPath?: string;
  enrichBookTitle?: string;
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
  ocrFolderPath: string;
  sourceKind: PipelineSourceKind | null;
  enrichContext: boolean | null;
  enrichBookPath: string;
  enrichBookTitle: string;
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
    ocrFolderPath: item.ocrFolderPath ?? '',
    sourceKind: item.sourceKind ?? (item.ocrFolderPath ? 'ocr' : 'pdf'),
    enrichContext: item.enrichContext ?? null,
    enrichBookPath: item.enrichBookPath ?? '',
    enrichBookTitle: item.enrichBookTitle ?? '',
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
      ocrFolderPath: '',
      sourceKind: null,
      enrichContext: null,
      enrichBookPath: '',
      enrichBookTitle: '',
      sizeBytes: 0,
      selected: false,
      queueStatus: null,
      queueError: '',
      progress: 0,
      job: latestJobs.get(book.book_id) ?? null,
      database: book,
    }));

  return [...queueRows, ...databaseRows].sort((left, right) => {
    const leftHasSource = Boolean(left.pdfPath || left.ocrFolderPath);
    const rightHasSource = Boolean(right.pdfPath || right.ocrFolderPath);
    if (leftHasSource && !rightHasSource) return -1;
    if (!leftHasSource && rightHasSource) return 1;
    return left.title.localeCompare(right.title, 'zh-CN');
  });
}

export function selectBatchLaunchCandidates<T extends PipelineBatchQueueItem>(
  queue: T[],
  jobs: PipelineJobSummary[],
): T[] {
  const latestJobs = latestJobsByBook(jobs);
  const availableSlots = Math.max(
    0,
    MAX_ACTIVE_PIPELINE_JOBS - jobs.filter((job) => job.status === 'running').length,
  );

  const selectedBookIds = new Set<string>();
  return queue.filter((item) => {
    const bookId = item.bookId.trim();
    const enrichConfirmed = item.enrichContext === false || (item.enrichContext === true && Boolean(item.enrichBookPath?.trim()));
    if (!bookId || !item.selected || item.status !== 'ready' || !enrichConfirmed || (!item.pdfPath && !item.ocrFolderPath)) return false;
    if (latestJobs.get(bookId)?.status === 'running' || selectedBookIds.has(bookId)) return false;
    selectedBookIds.add(bookId);
    return true;
  }).slice(0, availableSlots);
}

export function reconcileTerminalBatchQueue<T extends PipelineBatchQueueItem>(
  queue: T[],
  jobs: PipelineJobSummary[],
): T[] {
  const latestJobs = latestJobsByBook(jobs);
  let changed = false;
  const reconciled = queue.map((item) => {
    const jobStatus = latestJobs.get(item.bookId.trim())?.status;
    if (item.status !== 'started' || (jobStatus !== 'completed' && jobStatus !== 'blocked')) return item;
    changed = true;
    return { ...item, status: 'ready' as const, selected: false };
  });
  return changed ? reconciled : queue;
}

export function buildPipelineBatchStartRequest(
  base: PipelineStartRequest,
  book: {
    bookId: string;
    title: string;
    pdfPath?: string;
    ocrFolderPath?: string;
    enrichContext: boolean;
    enrichBookPath?: string;
  },
): PipelineStartRequest {
  const request = { ...base };
  const bookSpecificKeys: Array<keyof PipelineStartRequest> = [
    'resume_job_id', 'start_stage', 'book_id', 'book_title', 'pdf_path', 'ocr_folder_path', 'mineru_file_url',
    'mineru_language', 'mineru_page_ranges', 'outline_start_page', 'outline_end_page',
    'extraction_template', 'lesson_subject', 'lesson_school_stage', 'lesson_grade_band',
    'enrich_context', 'enrich_book_path',
  ];
  bookSpecificKeys.forEach((key) => delete request[key]);
  const pdfPath = book.pdfPath?.trim() || undefined;
  const ocrFolderPath = book.ocrFolderPath?.trim() || undefined;
  return {
    ...request,
    book_id: book.bookId,
    book_title: book.title,
    ...(pdfPath ? { pdf_path: pdfPath } : {}),
    ...(ocrFolderPath ? { ocr_folder_path: ocrFolderPath } : {}),
    enrich_context: book.enrichContext,
    ...(book.enrichContext && book.enrichBookPath?.trim() ? { enrich_book_path: book.enrichBookPath.trim() } : {}),
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
