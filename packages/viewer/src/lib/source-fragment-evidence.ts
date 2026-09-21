type EvidenceRow = Record<string, unknown>;

function text(value: unknown): string {
  return value == null ? '' : String(value);
}

function rows(value: unknown): EvidenceRow[] {
  return Array.isArray(value) ? value as EvidenceRow[] : [];
}

function uniqueValues(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

export function evidenceIdsForSourceFragment(
  fragment: EvidenceRow,
  evidenceRows: EvidenceRow[],
): string[] {
  const knownEvidenceIds = new Set(
    evidenceRows.map((row) => text(row.id)).filter(Boolean),
  );
  const excerptEvidenceIds = rows(fragment.excerpts)
    .map((row) => text(row.id))
    .filter((id) => knownEvidenceIds.has(id));
  const sourceId = text(fragment.source_id);
  const anchorRef = text(fragment.anchor_ref);
  if (!sourceId || !anchorRef) return uniqueValues(excerptEvidenceIds);

  const matchingEvidenceIds = evidenceRows
    .filter((row) => text(row.source_id) === sourceId && text(row.anchor_ref) === anchorRef)
    .map((row) => text(row.id))
    .filter(Boolean);
  return uniqueValues([...excerptEvidenceIds, ...matchingEvidenceIds]);
}
