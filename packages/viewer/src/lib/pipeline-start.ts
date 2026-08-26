import type { PipelineJobSummary } from '@okm/types';

interface BatchLaunchCandidate {
  bookId: string;
  pdfPath: string;
  selected: boolean;
  status: string;
}

export function selectBatchLaunchCandidates<T extends BatchLaunchCandidate>(
  queue: T[],
  jobs: PipelineJobSummary[],
): T[] {
  const latestStatusByBook = new Map<string, PipelineJobSummary['status']>();
  jobs.forEach((job) => {
    if (!latestStatusByBook.has(job.book_id)) latestStatusByBook.set(job.book_id, job.status);
  });

  const selectedBookIds = new Set<string>();
  return queue.filter((item) => {
    const bookId = item.bookId.trim();
    if (!bookId || !item.selected || item.status !== 'ready' || !item.pdfPath) return false;
    if (latestStatusByBook.get(bookId) === 'running' || selectedBookIds.has(bookId)) return false;
    selectedBookIds.add(bookId);
    return true;
  });
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
