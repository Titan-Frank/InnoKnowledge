import assert from 'node:assert/strict';
import test from 'node:test';
import { evidenceIdsForSourceFragment } from '../src/lib/source-fragment-evidence.ts';

test('replaces a source-markdown display id with canonical evidence ids', () => {
  const sourceId = '高中-数学-人教a版-必修第一册-89a186d146c8';
  const anchorRef = `struct:${sourceId}:chunk:3-1-2-a`;
  const displayId = `${sourceId}:${anchorRef}:source-markdown`;
  const evidenceRows = [
    { id: 'evidence:auto-123', source_id: sourceId, anchor_ref: anchorRef },
    { id: 'evidence:auto-456', source_id: sourceId, anchor_ref: anchorRef },
  ];

  assert.deepEqual(
    evidenceIdsForSourceFragment({
      source_id: sourceId,
      anchor_ref: anchorRef,
      excerpts: [{ id: displayId }],
    }, evidenceRows),
    ['evidence:auto-123', 'evidence:auto-456'],
  );
});

test('preserves canonical excerpt order and excludes unknown display ids', () => {
  const evidenceRows = [
    { id: 'evidence:one', source_id: 'book', anchor_ref: 'anchor' },
    { id: 'evidence:two', source_id: 'book', anchor_ref: 'anchor' },
  ];

  assert.deepEqual(
    evidenceIdsForSourceFragment({
      source_id: 'book',
      anchor_ref: 'anchor',
      excerpts: [{ id: 'evidence:two' }, { id: 'display-only' }],
    }, evidenceRows),
    ['evidence:two', 'evidence:one'],
  );
});
