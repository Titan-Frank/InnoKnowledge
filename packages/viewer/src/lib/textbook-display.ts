export function textbookDisplayTitle(outline: Record<string, unknown> | null | undefined): string {
  const title = typeof outline?.title === 'string'
    ? outline.title.replaceAll('_', ' ').replace(/\s+/g, ' ').trim()
    : '';
  return title && !/^[-\s]+$/.test(title) ? title : '未命名教材';
}
