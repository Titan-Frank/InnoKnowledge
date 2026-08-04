import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { resolveExistingMineruAssetPath } from './markdown-image-paths.js';

test('resolves a missing MinerU image from the sanitized source directory', () => {
  const mineruRoot = mkdtempSync(path.join(tmpdir(), 'okm-mineru-assets-'));
  try {
    const expected = path.join(mineruRoot, '_-_-_', 'images', 'figure.jpg');
    const actual = path.join(mineruRoot, '-_-', 'images', 'figure.jpg');
    mkdirSync(path.dirname(actual), { recursive: true });
    writeFileSync(actual, 'image', 'utf8');

    assert.equal(resolveExistingMineruAssetPath(expected, mineruRoot), actual);
    assert.equal(resolveExistingMineruAssetPath(actual, mineruRoot), actual);
  } finally {
    rmSync(mineruRoot, { recursive: true, force: true });
  }
});

test('does not borrow an image with the same name from an unrelated book', () => {
  const mineruRoot = mkdtempSync(path.join(tmpdir(), 'okm-mineru-assets-'));
  try {
    const expected = path.join(mineruRoot, '_missing_', 'images', 'figure.jpg');
    const unrelated = path.join(mineruRoot, 'another-book', 'images', 'figure.jpg');
    mkdirSync(path.dirname(unrelated), { recursive: true });
    writeFileSync(unrelated, 'image', 'utf8');

    assert.equal(resolveExistingMineruAssetPath(expected, mineruRoot), path.resolve(expected));
  } finally {
    rmSync(mineruRoot, { recursive: true, force: true });
  }
});

test('does not search sibling directories for paths outside the MinerU root', () => {
  const mineruRoot = mkdtempSync(path.join(tmpdir(), 'okm-mineru-assets-'));
  try {
    const outside = path.join(path.dirname(mineruRoot), 'outside', 'figure.jpg');
    assert.equal(resolveExistingMineruAssetPath(outside, mineruRoot), path.resolve(outside));
  } finally {
    rmSync(mineruRoot, { recursive: true, force: true });
  }
});
