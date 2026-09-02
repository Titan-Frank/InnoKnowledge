import type { PgAdminBookSummary, PipelineJobStatusResponse, PipelineJobSummary, PipelineStartRequest, PipelineStartStage } from '@okm/types';

export type PipelineQueueStatus = 'uploading' | 'ready' | 'starting' | 'started' | 'error';
export type PipelineSourceKind = 'pdf' | 'ocr';
export type PipelineQueueOrigin = 'scan' | 'upload' | 'manual_ocr';

export const MAX_ACTIVE_PIPELINE_JOBS = 4;
export type OutlineExtractionStatus = 'idle' | 'starting' | 'running' | 'completed' | 'blocked';
const OUTLINE_PREPARATION_STAGE_IDS = new Set([
  'check_postgres',
  'mineru_source_markdown',
  'extract_pdf_outline',
  'prepare_source_markdown',
  'ensure_outline',
  'prepare_outline_chunks',
]);

export function isOutlineReviewReady(input: {
  status: string;
  currentStageId?: string | null;
  prepareOnly?: unknown;
}): boolean {
  return input.status === 'completed'
    && (input.currentStageId === 'prepare_outline_chunks' || input.prepareOnly === true);
}

export function resolveOutlineExtractionStatus(input: {
  launching: boolean;
  extractionJobId: string | null;
  selectedJobId: string | null;
  jobStatus: PipelineJobStatusResponse | null;
}): OutlineExtractionStatus {
  if (input.launching) return 'starting';
  if (!input.extractionJobId) return 'idle';
  if (input.selectedJobId !== input.extractionJobId || input.jobStatus?.job_id !== input.extractionJobId) return 'starting';
  if (input.jobStatus.status === 'running') return 'running';
  if (input.jobStatus.status === 'completed') return 'completed';
  if (input.jobStatus.status === 'blocked') return 'blocked';
  return 'starting';
}

export function selectOutlineBatchJobs(
  jobs: PipelineJobSummary[],
  batchJobIds: string[],
  activeJobId?: string | null,
): PipelineJobSummary[] {
  const byId = new Map(jobs.map((job) => [job.job_id, job]));
  const candidates = [...new Set(batchJobIds)].flatMap((jobId) => {
    const job = byId.get(jobId);
    return job ? [job] : [];
  });
  const activeJob = activeJobId ? byId.get(activeJobId) : null;
  if (candidates.length === 0 && activeJob) {
    const activeCreatedAt = Date.parse(activeJob.created_at || '');
    if (Number.isFinite(activeCreatedAt)) {
      jobs
        .filter((job) => OUTLINE_PREPARATION_STAGE_IDS.has(job.current_stage_id || ''))
        .filter((job) => {
          const createdAt = Date.parse(job.created_at || '');
          return Number.isFinite(createdAt) && Math.abs(createdAt - activeCreatedAt) <= 15 * 60 * 1000;
        })
        .sort((left, right) => (left.created_at || '').localeCompare(right.created_at || ''))
        .forEach((job) => candidates.push(job));
    }
  }
  if (activeJob && !candidates.some((job) => job.job_id === activeJob.job_id)) candidates.unshift(activeJob);
  return candidates;
}

const RESUMABLE_PIPELINE_STAGE_IDS = new Set<PipelineStartStage>([
  'mineru_source_markdown',
  'extract_pdf_outline',
  'prepare_source_markdown',
  'ensure_outline',
  'prepare_outline_chunks',
  'lesson_plan',
  'lesson_staging',
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
]);

export type PipelineBatchResumeCandidate = {
  job: PipelineJobSummary;
  startStage: PipelineStartStage;
};

export function resolvePipelineResumeStage(stageId?: string | null): PipelineStartStage | null {
  if (!stageId || stageId === 'check_postgres') return 'mineru_source_markdown';
  if (stageId.startsWith('lesson_staging_retry_transport_')) return 'lesson_staging';
  if (stageId.startsWith('assessment_staging_retry_')) return 'assessment_quality';
  if (stageId.startsWith('lesson_staging_retry_')) return 'staging_quality';
  return RESUMABLE_PIPELINE_STAGE_IDS.has(stageId as PipelineStartStage)
    ? stageId as PipelineStartStage
    : null;
}

export function selectBatchResumeCandidates(
  jobs: PipelineJobSummary[],
  maxActiveJobs = MAX_ACTIVE_PIPELINE_JOBS,
): PipelineBatchResumeCandidate[] {
  const availableSlots = Math.max(
    0,
    Math.floor(maxActiveJobs) - jobs.filter((job) => job.status === 'running').length,
  );
  if (availableSlots === 0) return [];

  return jobs.flatMap<PipelineBatchResumeCandidate>((job) => {
    if (job.status !== 'blocked') return [];
    const startStage = resolvePipelineResumeStage(job.current_stage_id);
    return startStage ? [{ job, startStage }] : [];
  }).slice(0, availableSlots);
}

export interface PipelineBatchQueueItem {
  id: string;
  bookId: string;
  title: string;
  queueOrigin?: PipelineQueueOrigin;
  sourceFingerprint?: string;
  pdfPath: string;
  ocrFolderPath?: string;
  ocrImportMode?: 'in_place' | 'copy';
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

export function reconcileScannedQueueSnapshot<T extends PipelineBatchQueueItem>(
  current: T[],
  scanned: T[],
): T[] {
  const currentScannedById = new Map(
    current.filter((item) => item.queueOrigin === 'scan').map((item) => [item.id, item]),
  );
  const explicitSources = current.filter((item) => item.queueOrigin !== 'scan');
  const refreshedScanned = scanned.map((item) => {
    const previous = currentScannedById.get(item.id);
    if (!previous) return item;
    return {
      ...previous,
      ...item,
      selected: previous.selected,
      status: previous.status,
      progress: previous.progress,
      error: previous.error,
    };
  });
  return [...explicitSources, ...refreshedScanned];
}

export interface PipelineBookWorkbenchRow {
  key: string;
  bookId: string;
  title: string;
  pdfPath: string;
  ocrFolderPath: string;
  ocrImportMode: 'in_place' | 'copy';
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
    ocrImportMode: item.ocrImportMode ?? 'in_place',
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
      ocrImportMode: 'copy',
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
    ocrImportMode?: 'in_place' | 'copy';
    enrichContext: boolean;
    enrichBookPath?: string;
  },
): PipelineStartRequest {
  const request = { ...base };
  const bookSpecificKeys: Array<keyof PipelineStartRequest> = [
    'resume_job_id', 'start_stage', 'prepare_only', 'outline_confirmation', 'book_id', 'book_title', 'pdf_path', 'ocr_folder_path', 'ocr_import_mode', 'mineru_file_url',
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
    ...(ocrFolderPath ? { ocr_import_mode: book.ocrImportMode ?? 'in_place' } : {}),
    prepare_only: true,
    enrich_context: book.enrichContext,
    ...(book.enrichContext && book.enrichBookPath?.trim() ? { enrich_book_path: book.enrichBookPath.trim() } : {}),
  };
}

export function buildConfirmedExtractionRequest(
  base: PipelineStartRequest,
  input: { bookId: string; fingerprint: string },
): PipelineStartRequest {
  return {
    ...base,
    resume_job_id: undefined,
    book_id: input.bookId,
    pdf_path: undefined,
    ocr_folder_path: undefined,
    mineru_file_url: undefined,
    mineru_force: false,
    prepare_only: false,
    outline_confirmation: input.fingerprint,
    start_stage: 'lesson_plan',
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
