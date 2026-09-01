import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { listTextbookReaderBooks, loadTextbookReaderPage, resolveTextbookReaderPdf } from './textbook-reader.js';

test('loads semantic OCR pages and resolves image evidence to a stable block', async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'okm-reader-'));
  const bookDir = path.join(repoRoot, 'data', 'mineru', 'math-book', 'hybrid_ocr');
  try {
    await mkdir(path.join(bookDir, 'images'), { recursive: true });
    await writeFile(path.join(bookDir, 'math_content_list_v2.json'), JSON.stringify([
      [
        { type: 'title', bbox: [100, 80, 900, 150], content: { level: 1, title_content: [{ type: 'text', content: '第一章' }] } },
        { type: 'paragraph', bbox: [100, 180, 900, 260], content: { paragraph_content: [{ type: 'text', content: '正数' }, { type: 'equation_inline', content: '> 0' }, { type: 'text', content: '。' }] } },
      ],
      [
        { type: 'image', bbox: [200, 300, 800, 700], content: { image_source: { path: 'images/number-line.jpg' }, image_caption: [{ type: 'text', content: '数轴' }] } },
      ],
    ]));
    await writeFile(path.join(repoRoot, 'data', 'mineru', 'math-book', 'math-book.pdf'), '%PDF-1.4 test');

    const page = await loadTextbookReaderPage({
      repoRoot,
      datasetId: 'main',
      bookId: 'math-book',
      evidence: {
        id: 'ev:image',
        excerpt: '![](images/number-line.jpg)',
        locator: 'line:20',
        page_start: null,
        page_end: null,
        properties: {},
      },
    });

    assert.equal(page.page_count, 2);
    assert.equal(page.pdf_available, true);
    assert.equal(page.page_index, 1);
    assert.equal(page.blocks[0]?.id, 'ocr:1:0');
    assert.equal(page.blocks[0]?.image_path, 'data/mineru/math-book/hybrid_ocr/images/number-line.jpg');
    assert.equal(page.evidence_match?.kind, 'asset');
    assert.deepEqual(page.evidence_match?.block_ids, ['ocr:1:0']);

    const catalog = await listTextbookReaderBooks(path.join(repoRoot, 'data'));
    assert.deepEqual(catalog, [{
      book_id: 'math-book',
      title: 'math-book',
      page_count: 2,
      source_format: 'content_list_v2',
      pdf_available: true,
    }]);

    const firstPage = await loadTextbookReaderPage({ repoRoot, datasetId: 'main', bookId: 'math-book', requestedPage: 0 });
    assert.deepEqual(firstPage.blocks[1]?.segments, [
      { kind: 'text', value: '正数' },
      { kind: 'math', value: '> 0' },
      { kind: 'text', value: '。' },
    ]);

  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test('matches text evidence and honors an explicit page request', async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'okm-reader-'));
  const bookDir = path.join(repoRoot, 'data', 'mineru', 'physics-book');
  try {
    await mkdir(bookDir, { recursive: true });
    await writeFile(path.join(bookDir, 'physics_content_list.json'), JSON.stringify([
      { type: 'text', page_idx: 0, bbox: [100, 100, 900, 200], text: '速度表示运动的快慢。' },
      { type: 'text', page_idx: 1, bbox: [100, 100, 900, 200], text: '第二页正文。' },
    ]));

    const matched = await loadTextbookReaderPage({
      repoRoot,
      datasetId: 'main',
      bookId: 'physics-book',
      evidence: {
        id: 'ev:text',
        excerpt: '速度表示运动的快慢',
        locator: '',
        page_start: 1,
        page_end: 1,
        properties: {},
      },
    });
    assert.equal(matched.evidence_match?.kind, 'text');
    assert.equal(matched.page_index, 0);
    assert.deepEqual(matched.evidence_match?.block_ids, ['ocr:0:0']);

    const explicit = await loadTextbookReaderPage({
      repoRoot,
      datasetId: 'main',
      bookId: 'physics-book',
      requestedPage: 1,
    });
    assert.equal(explicit.page_index, 1);
    assert.equal(explicit.pdf_available, false);
    assert.equal(explicit.blocks[0]?.text, '第二页正文。');
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test('resolves the original PDF through an in-place OCR source path when book_id differs from the folder name', async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'okm-reader-source-path-'));
  const bookRoot = path.join(repoRoot, 'data', 'mineru', '初中_七年级_数学_人教版_上册');
  const bundle = path.join(bookRoot, '初中_七年级_数学_人教版_上册', 'hybrid_ocr');
  const pdf = path.join(bookRoot, '初中_七年级_数学_人教版_上册.pdf');
  try {
    await mkdir(bundle, { recursive: true });
    await writeFile(path.join(bundle, 'full.md'), '# 第一章');
    await writeFile(pdf, '%PDF-1.4 original');
    assert.equal(await resolveTextbookReaderPdf({
      repoRoot,
      datasetId: 'main',
      bookId: '初中-七年级-数学-人教版-上册-hash',
      sourcePaths: [path.join(bundle, 'full.md')],
    }), pdf);
    await writeFile(path.join(bundle, 'math_content_list_v2.json'), JSON.stringify([[{
      type: 'paragraph',
      bbox: [100, 100, 900, 200],
      content: { paragraph_content: [{ type: 'text', content: '第一课' }] },
    }]]));
    const catalog = await listTextbookReaderBooks(path.join(repoRoot, 'data'), [{
      book_id: 'math-book-canonical',
      source_markdown_path: path.join(repoRoot, 'data', 'mineru', 'legacy-copy', 'full.md'),
      raw_markdown_path: path.join(bundle, 'full.md'),
      extract_dir: bundle,
    }]);
    assert.deepEqual(catalog, [{
      book_id: 'math-book-canonical',
      title: '初中_七年级_数学_人教版_上册',
      page_count: 1,
      source_format: 'content_list_v2',
      pdf_available: true,
    }]);
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
  }
});

test('loads an external in-place OCR bundle and its separately paired PDF', async () => {
  const repoRoot = await mkdtemp(path.join(tmpdir(), 'okm-reader-external-repo-'));
  const libraryRoot = await mkdtemp(path.join(tmpdir(), 'okm-reader-external-library-'));
  const bookName = '高中_物理_人教版_必修第一册';
  const bundle = path.join(libraryRoot, '物理_mineru_hybrid_high_ocr', '高中', bookName, bookName, 'hybrid_ocr');
  const pdf = path.join(libraryRoot, '物理', '高中', `${bookName}.pdf`);
  try {
    await mkdir(path.join(bundle, 'images'), { recursive: true });
    await mkdir(path.dirname(pdf), { recursive: true });
    await writeFile(path.join(bundle, `${bookName}.md`), '# 第一章');
    await writeFile(path.join(bundle, `${bookName}_content_list_v2.json`), JSON.stringify([[
      { type: 'image', content: { image_source: { path: 'images/figure.jpg' } } },
    ]]));
    await writeFile(path.join(bundle, 'images', 'figure.jpg'), 'image');
    await writeFile(pdf, '%PDF-1.4 original');

    const mapping = {
      book_id: 'physics-book',
      source_markdown_path: path.join(bundle, `${bookName}.md`),
      raw_markdown_path: path.join(bundle, `${bookName}.md`),
      extract_dir: bundle,
      source_pdf_path: pdf,
    };
    const catalog = await listTextbookReaderBooks(path.join(repoRoot, 'data'), [mapping]);
    assert.equal(catalog[0]?.book_id, 'physics-book');
    assert.equal(catalog[0]?.pdf_available, true);
    const page = await loadTextbookReaderPage({
      repoRoot,
      dataRoot: path.join(repoRoot, 'data'),
      datasetId: 'main',
      bookId: 'physics-book',
      sourcePaths: [mapping.source_markdown_path, mapping.extract_dir],
      pdfPath: pdf,
    });
    assert.equal(page.pdf_available, true);
    assert.equal(page.blocks[0]?.image_path, path.join(bundle, 'images', 'figure.jpg'));
  } finally {
    await rm(repoRoot, { recursive: true, force: true });
    await rm(libraryRoot, { recursive: true, force: true });
  }
});
