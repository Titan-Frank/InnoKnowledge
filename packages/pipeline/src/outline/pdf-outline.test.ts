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
