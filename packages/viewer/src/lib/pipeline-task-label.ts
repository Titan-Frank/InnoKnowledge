type PipelineTaskReference = {
  batch_anchor?: string | null;
  batch_label?: string | null;
};

const batchKindLabels: Record<string, string> = {
  activity: '活动',
  chunk: '分块',
  lesson: '课时',
  review: '复习',
};

function cleanBookTitle(value: string | null | undefined): string {
  return value?.trim().replace(/_+/g, ' ').replace(/\s+/g, ' ') ?? '';
}

export function pipelineTaskLabel(task: PipelineTaskReference, bookTitle?: string | null): string {
  const title = cleanBookTitle(bookTitle);
  if (title) return title;

  const label = task.batch_label?.trim();
  if (label) return label;

  const anchor = task.batch_anchor?.trim();
  if (!anchor) return '课时未知';
  const match = anchor.match(/(?:^|:)(activity|chunk|lesson|review):([^:]+)$/i);
  if (!match) return '课时任务';
  const kind = batchKindLabels[match[1]!.toLowerCase()] ?? '课时';
  const localId = match[2]!
    .split('-')
    .map((part) => (/^[a-z]$/i.test(part) ? part.toUpperCase() : part))
    .join('-');
  return `${kind} ${localId}`;
}

export function pipelineTaskDetail(task: PipelineTaskReference): string {
  const label = task.batch_label?.trim();
  if (label) return label;
  return pipelineTaskLabel(task);
}
