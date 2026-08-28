import assert from 'node:assert/strict';
import test from 'node:test';
import { largestFittingFontSize } from '../src/lib/ocr-coordinate-text';

test('largestFittingFontSize returns the largest size accepted by the measured box', () => {
  const fontSize = largestFittingFontSize({
    min: 6,
    max: 24,
    fits: (candidate) => candidate <= 13.4,
  });

  assert.equal(fontSize, 13.3);
});

test('largestFittingFontSize keeps the configured maximum when the content fits', () => {
  assert.equal(largestFittingFontSize({ min: 6, max: 18, fits: () => true }), 18);
});

test('largestFittingFontSize falls back to the minimum for content that cannot fully fit', () => {
  assert.equal(largestFittingFontSize({ min: 7, max: 18, fits: () => false }), 7);
});
