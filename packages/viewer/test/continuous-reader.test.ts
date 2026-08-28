import assert from 'node:assert/strict';
import test from 'node:test';
import { continuousReaderPageWindow, nearestReaderPage } from '../src/lib/continuous-reader';

test('continuousReaderPageWindow keeps lazy rendering inside document bounds', () => {
  assert.deepEqual(continuousReaderPageWindow(0, 202), [0, 1, 2]);
  assert.deepEqual(continuousReaderPageWindow(100, 202), [98, 99, 100, 101, 102]);
  assert.deepEqual(continuousReaderPageWindow(201, 202), [199, 200, 201]);
  assert.deepEqual(continuousReaderPageWindow(0, 0), []);
});

test('nearestReaderPage selects the page closest to the viewport center', () => {
  assert.equal(nearestReaderPage([
    { pageIndex: 0, top: -700, bottom: 200 },
    { pageIndex: 1, top: 224, bottom: 1124 },
    { pageIndex: 2, top: 1148, bottom: 2048 },
  ], 500), 1);
  assert.equal(nearestReaderPage([], 500), null);
});
