export function continuousReaderPageWindow(pageIndex: number, pageCount: number, radius = 2): number[] {
  if (!Number.isInteger(pageCount) || pageCount <= 0) return [];
  const activeIndex = Math.min(pageCount - 1, Math.max(0, Math.trunc(pageIndex)));
  const windowRadius = Math.max(0, Math.trunc(radius));
  const first = Math.max(0, activeIndex - windowRadius);
  const last = Math.min(pageCount - 1, activeIndex + windowRadius);
  return Array.from({ length: last - first + 1 }, (_, offset) => first + offset);
}

export function nearestReaderPage(
  pages: Iterable<{ pageIndex: number; top: number; bottom: number }>,
  viewportCenter: number,
): number | null {
  let nearestPage: number | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;
  for (const page of pages) {
    const pageCenter = page.top + (page.bottom - page.top) / 2;
    const distance = Math.abs(pageCenter - viewportCenter);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestPage = page.pageIndex;
    }
  }
  return nearestPage;
}
