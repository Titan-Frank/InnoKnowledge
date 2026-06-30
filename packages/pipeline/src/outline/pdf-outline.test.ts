import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { extractPdfOutline, parsePdfTocText, parseTocEntries } from "./pdf-outline.js";

const tocText = `
目 录

第 1 章 原子结构与性质 ………………………………………………… 1
      1.1 氢原子结构模型 …………………………………………………… 3
      1.2 多电子原子核外电子的排布 ……………………………………… 12
      1.3 元素周期律 ………………………………………………………… 17
      本章复习 ………………………………………………………………… 26

第 2 章 分子结构与性质 ………………………………………………… 29
      2.1 共价分子的空间结构 ……………………………………………… 31

附   录   … …………………………………………………………………………… 98
`;

const chineseSectionTocText = `
目
录

第九章·静电场 / 1

第一节   静电现象       电荷 / 2
第二节   电荷的相互作用         库仑定律 / 7

第十章·电路及其应用 / 48

第一节   简单串联、并联组合电路 / 49
`;

test("parses PDF TOC text into Python-compatible outline items", () => {
  const outline = parsePdfTocText({
    bookId: "chem-book",
    title: "化学",
    sourcePath: "data/mineru/chem-book/full.md",
    tocText,
    tocStart: 1,
    tocEnd: 8,
    generatedAt: "2026-06-23T00:00:00.000Z",
  });

  assert.equal(outline.items.length, 6);
  assert.deepEqual(outline.items[0], {
    id: "struct:chem-book:theme:1",
    kind: "theme",
    label: "第 1 章",
    title: "原子结构与性质",
    page_start: 1,
    page_end: 28,
    level: 1,
    order_path: "1",
    raw_line: "第 1 章 原子结构与性质",
  });
  assert.deepEqual(outline.items[3], {
    id: "struct:chem-book:lesson:1-3",
    kind: "lesson",
    label: "1.3",
    title: "元素周期律",
    page_start: 17,
    page_end: 25,
    level: 3,
    order_path: "1.3",
    parent_id: "struct:chem-book:theme:1",
    raw_line: "1.3 元素周期律",
  });
  assert.equal(outline.items.at(-1)?.page_end, 97);
});

test("parses Chinese chapter and section TOC lines with slash page markers", () => {
  const outline = parsePdfTocText({
    bookId: "physics-book",
    title: "物理",
    sourcePath: "data/mineru/physics-book/full.md",
    tocText: chineseSectionTocText,
    tocStart: 1,
    tocEnd: 4,
    generatedAt: "2026-06-26T00:00:00.000Z",
  });

  assert.deepEqual(outline.items[0], {
    id: "struct:physics-book:theme:9",
    kind: "theme",
    label: "第 9 章",
    title: "静电场",
    page_start: 1,
    page_end: 47,
    level: 1,
    order_path: "9",
    raw_line: "第 9 章 静电场",
  });
  assert.deepEqual(outline.items[1], {
    id: "struct:physics-book:lesson:9-1",
    kind: "lesson",
    label: "第1节",
    title: "静电现象 电荷",
    page_start: 2,
    page_end: 6,
    level: 3,
    order_path: "9.1",
    parent_id: "struct:physics-book:theme:9",
    raw_line: "第1节 静电现象 电荷",
  });
  assert.equal(outline.items.at(-1)?.order_path, "10.1");
});

test("keeps TOC boundary rows for page_end calculation without including them", () => {
  const entries = parseTocEntries(tocText);
  assert.equal(entries.some((entry) => entry.rawLine.includes("本章复习") && !entry.include), true);
  assert.equal(entries.some((entry) => entry.rawLine.includes("附") && !entry.include), true);
});

test("extracts a PDF outline through an injected text extractor", async () => {
    const repoRoot = mkdtempSync(join(tmpdir(), "okm-pdf-outline-"));
  try {
    const pdfPath = join(repoRoot, "book.pdf");
    const outlinePath = join(repoRoot, "data", "outlines", "chem-book.outline.json");
    writeFileSync(pdfPath, "pdf", "utf8");

    const result = await extractPdfOutline({
      bookId: "chem-book",
      pdfPath,
      outlinePath,
      repoRoot,
      title: "化学",
      sourcePath: "data/mineru/chem-book/full.md",
      tocStart: 1,
      tocEnd: 8,
      generatedAt: "2026-06-23T00:00:00.000Z",
      extractText: async () => tocText,
    });

    assert.equal(result.status, "completed");
    assert.equal(existsSync(outlinePath), true);
    const outline = JSON.parse(readFileSync(outlinePath, "utf8")) as { source_path: string; items: unknown[] };
    assert.equal(outline.source_path, "data/mineru/chem-book/full.md");
    assert.equal(outline.items.length, 6);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
