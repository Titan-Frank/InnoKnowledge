import assert from 'node:assert/strict';
import test from 'node:test';
import { pipelineTaskLabel } from '../src/lib/pipeline-task-label.ts';

test('uses the outline title when the status API provides one', () => {
  assert.equal(pipelineTaskLabel({
    batch_anchor: 'struct:math:chunk:3-f',
    batch_label: '1.2 有理数及其大小比较 — 归纳',
  }), '1.2 有理数及其大小比较 — 归纳');
});

test('uses the readable textbook title as the task name', () => {
  assert.equal(pipelineTaskLabel({
    batch_anchor: 'struct:math:chunk:3-f',
    batch_label: '1.2 有理数及其大小比较 — 归纳',
  }, '初中_七年级_数学_人教版_上册'), '初中 七年级 数学 人教版 上册');
});

test('turns an internal chunk anchor into a readable fallback', () => {
  assert.equal(
    pipelineTaskLabel({ batch_anchor: 'struct:math:chunk:3-f' }),
    '分块 3-F',
  );
});

test('does not leak an unrecognized internal identifier', () => {
  assert.equal(pipelineTaskLabel({ batch_anchor: 'lesson-run:auto-123' }), '课时任务');
  assert.equal(pipelineTaskLabel({}), '课时未知');
});
