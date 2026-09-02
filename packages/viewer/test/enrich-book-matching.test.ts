import assert from 'node:assert/strict';
import test from 'node:test';
import type { EnrichBookSummary } from '../src/services/backend-client.ts';
import { scoreEnrichBook, topEnrichBook } from '../src/lib/enrich-book-matching.ts';

const books: EnrichBookSummary[] = [
  {
    path: 'data/enrich/math-pep-compulsory-1.json',
    filename: 'math-pep-compulsory-1.json',
    title: '普通高中教科书 数学 人教A版 必修第一册',
    subject: '数学',
    stage: '高中',
    publisher: '人民教育出版社',
    volume: '必修第一册',
  },
  {
    path: 'data/enrich/physics-hukj-xb2.json',
    filename: 'physics-hukj-xb2.json',
    title: '高中物理 沪科技版 选择性必修第二册',
    subject: '物理',
    stage: '高中',
    publisher: '沪科技',
    volume: '选择性必修第二册',
  },
];

test('scores filename aliases and Chinese textbook metadata consistently', () => {
  assert.ok(scoreEnrichBook(books[1]!, 'senior_physics_hukj_xb2') > scoreEnrichBook(books[0]!, 'senior_physics_hukj_xb2'));
  assert.equal(topEnrichBook(books, 'senior_physics_hukj_xb2')?.path, books[1]!.path);
});

test('selects the matching publisher and volume for OCR textbook titles', () => {
  assert.equal(topEnrichBook(books, '高中 数学 人教 必修第一册')?.path, books[0]!.path);
});
