import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  alignOutlineToMarkdown,
  ensureChunkedOutline,
  ensureOutlineFromEnrich,
  ensureOutlineFromMarkdown,
  prepareSourceMarkdown,
  resetOutlineForSourceReplacement,
} from "./source-preparation.js";

test("imports an existing Markdown file and updates outline source_path", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "okm-source-prep-"));
  try {
    const outlinePath = makeOutline(repoRoot);
    const markdownPath = join(repoRoot, "input.md");
    writeFileSync(markdownPath, "# 第一课\n内容\n", "utf8");

    const result = prepareSourceMarkdown({
      bookId: "book-a",
      outlinePath,
      repoRoot,
      sourceMarkdownPath: markdownPath,
    });

    assert.equal(result.status, "completed");
    assert.equal(result.outline_source_path, "data/mineru/book-a/full.md");
    assert.equal(readFileSync(join(repoRoot, "data", "mineru", "book-a", "full.md"), "utf8"), "# 第一课\n内容\n");
    const outline = JSON.parse(readFileSync(outlinePath, "utf8")) as Record<string, unknown>;
    assert.equal(outline.source_path, "data/mineru/book-a/full.md");
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("imports Markdown even when the outline does not exist yet", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "okm-source-prep-"));
  try {
    const outlinePath = join(repoRoot, "data", "outlines", "book-a.outline.json");
    const markdownPath = join(repoRoot, "input.md");
    writeFileSync(markdownPath, "# 第一课\n内容\n", "utf8");

    const result = prepareSourceMarkdown({
      bookId: "book-a",
      outlinePath,
      repoRoot,
      sourceMarkdownPath: markdownPath,
    });

    assert.equal(result.status, "completed");
    assert.equal(result.outline_source_path, "data/mineru/book-a/full.md");
    assert.equal(existsSync(outlinePath), false);
    assert.equal(readFileSync(join(repoRoot, "data", "mineru", "book-a", "full.md"), "utf8"), "# 第一课\n内容\n");
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("keeps an external OCR Markdown and its sibling assets in place when requested", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "okm-source-prep-repo-"));
  const externalRoot = mkdtempSync(join(tmpdir(), "okm-source-prep-external-"));
  try {
    const markdownPath = join(externalRoot, "book.md");
    mkdirSync(join(externalRoot, "images"), { recursive: true });
    writeFileSync(markdownPath, "# 第一课\n![](images/figure.jpg)\n", "utf8");
    writeFileSync(join(externalRoot, "images", "figure.jpg"), "image", "utf8");
    const result = prepareSourceMarkdown({
      bookId: "book-a",
      outlinePath: join(repoRoot, "data", "outlines", "book-a.outline.json"),
      repoRoot,
      sourceMarkdownPath: markdownPath,
      reuseSourceInPlace: true,
    });
    assert.equal(result.status, "completed");
    assert.equal(result.markdown_path, markdownPath);
    assert.equal(result.outline_source_path, markdownPath);
    assert.equal(result.imported, false);
    assert.equal(existsSync(join(repoRoot, "data", "mineru", "book-a", "full.md")), false);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
    rmSync(externalRoot, { recursive: true, force: true });
  }
});

test("keeps MinerU Markdown beside its images when the book id needs path sanitizing", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "okm-source-prep-"));
  try {
    const sourceDir = join(repoRoot, "data", "mineru", "-_-");
    const markdownPath = join(sourceDir, "full.md");
    const imagePath = join(sourceDir, "images", "figure.jpg");
    mkdirSync(join(sourceDir, "images"), { recursive: true });
    writeFileSync(markdownPath, "# 数学\n![](images/figure.jpg)\n", "utf8");
    writeFileSync(imagePath, "image", "utf8");

    const result = prepareSourceMarkdown({
      bookId: "_-_-_",
      outlinePath: join(repoRoot, "data", "outlines", "_-_-_.outline.json"),
      repoRoot,
      sourceMarkdownPath: markdownPath,
    });

    assert.equal(result.status, "completed");
    assert.equal(result.imported, false);
    assert.equal(result.markdown_path, markdownPath);
    assert.equal(result.outline_source_path, "data/mineru/-_-/full.md");
    assert.equal(existsSync(imagePath), true);
    assert.equal(existsSync(join(repoRoot, "data", "mineru", "_-_-_", "full.md")), false);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("derives a basic outline from Markdown headings when outline is missing", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "okm-source-prep-"));
  try {
    const outlinePath = join(repoRoot, "data", "outlines", "book-a.outline.json");
    const markdownPath = join(repoRoot, "data", "mineru", "book-a", "full.md");
    mkdirSync(join(repoRoot, "data", "mineru", "book-a"), { recursive: true });
    writeFileSync(markdownPath, ["# 第1章 原子结构", "内容一", "## 1.1 氢原子", "内容二", "# 第2章 分子结构", "内容三"].join("\n"), "utf8");

    const result = ensureOutlineFromMarkdown({
      bookId: "book-a",
      outlinePath,
      repoRoot,
      markdownPath,
      title: "测试教材",
      tocStart: 1,
      tocEnd: 8,
      generatedAt: "2026-06-23T00:00:00Z",
    });

    assert.equal(result.status, "completed");
    assert.equal(result.created, true);
    assert.equal(result.item_count, 2);
    const outline = JSON.parse(readFileSync(outlinePath, "utf8")) as { title: string; source_path: string; items: Array<Record<string, unknown>> };
    assert.equal(outline.title, "测试教材");
    assert.equal(outline.source_path, "data/mineru/book-a/full.md");
    assert.deepEqual(
      outline.items.map((item) => [item.id, item.kind, item.label, item.title, item.md_start, item.md_end]),
      [
        ["struct:book-a:lesson:1", "lesson", "第1章", "原子结构", 1, 4],
        ["struct:book-a:lesson:2", "lesson", "第2章", "分子结构", 5, 6],
      ],
    );
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("uses a confirmed Enrich tree as the outline skeleton and aligns it to Markdown", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "okm-source-prep-enrich-"));
  try {
    const outlinePath = join(repoRoot, "data", "outlines", "book-a.outline.json");
    const markdownPath = join(repoRoot, "data", "mineru", "book-a", "full.md");
    mkdirSync(join(repoRoot, "data", "mineru", "book-a"), { recursive: true });
    writeFileSync(markdownPath, [
      "# 第一章 原子结构",
      "章导语",
      "## 1.1 原子模型",
      "课时一正文",
      "## 1.2 核外电子",
      "课时二正文",
    ].join("\n"), "utf8");
    writeFileSync(join(repoRoot, "data", "mineru", "book-a", "book_content_list_v2.json"), JSON.stringify([
      [mineruTitle("第一章 原子结构", 1), mineruParagraph("章导语")],
      [mineruTitle("1.1 原子模型"), mineruParagraph("课时一正文")],
      [mineruTitle("1.2 核外电子"), mineruParagraph("课时二正文")],
    ]), "utf8");

    const result = ensureOutlineFromEnrich({
      bookId: "book-a",
      bookTitle: "测试教材",
      enrichBookTitle: "Enrich 测试教材",
      enrichBookPath: "data/enrich/chemistry/book-a.json",
      enrichTree: [{
        title: "第一章 原子结构",
        child_nodes: [
          { title: "1.1 原子模型", enrichment: { definition: "不进入教材大纲" } },
          { title: "1.2 核外电子", enrichment: { definition: "不进入教材大纲" } },
        ],
      }],
      outlinePath,
      repoRoot,
      markdownPath,
      generatedAt: "2026-08-27T00:00:00Z",
    });

    assert.equal(result.status, "completed");
    assert.equal(result.status === "completed" ? result.lesson_count : 0, 2);
    const outline = JSON.parse(readFileSync(outlinePath, "utf8")) as {
      source_kind: string;
      source_ref: string;
      items: Array<Record<string, unknown>>;
    };
    assert.equal(outline.source_kind, "enrich");
    assert.equal(outline.source_ref, "data/enrich/chemistry/book-a.json");
    assert.deepEqual(
      outline.items.map((item) => [item.id, item.kind, item.parent_id ?? null, item.md_start, item.md_end, item.page_start, item.page_end]),
      [
        ["struct:book-a:theme:1", "theme", null, 1, 2, 1, 1],
        ["struct:book-a:lesson:1-1", "lesson", "struct:book-a:theme:1", 3, 4, 2, 2],
        ["struct:book-a:lesson:1-2", "lesson", "struct:book-a:theme:1", 5, 6, 3, 3],
      ],
    );
    assert.equal(JSON.stringify(outline).includes("不进入教材大纲"), false);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("uses Enrich hierarchy and document order to disambiguate repeated lesson headings", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "okm-source-prep-enrich-repeated-"));
  try {
    const outlinePath = join(repoRoot, "data", "outlines", "book-a.outline.json");
    const sourceDir = join(repoRoot, "data", "mineru", "book-a");
    const markdownPath = join(sourceDir, "full.md");
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(markdownPath, [
      "# 第一章 有理数",
      "## 1.1 正数和负数",
      "第一章正文",
      "## 小结",
      "第一章小结",
      "# 第二章 整式",
      "## 2.1 单项式",
      "第二章正文",
      "## 小结",
      "第二章小结",
    ].join("\n"), "utf8");
    writeFileSync(join(sourceDir, "book_content_list_v2.json"), JSON.stringify([[
      mineruTitle("第一章 有理数", 1),
      mineruTitle("1.1 正数和负数"),
      mineruTitle("小结"),
      mineruTitle("第二章 整式", 1),
      mineruTitle("2.1 单项式"),
      mineruTitle("小结"),
    ]]), "utf8");

    const result = ensureOutlineFromEnrich({
      bookId: "book-a",
      enrichBookPath: "data/enrich/mathematics/book-a.json",
      enrichTree: [
        {
          title: "第一章 有理数",
          child_nodes: [{ title: "1.1 正数和负数" }, { title: "小结" }],
        },
        {
          title: "第二章 整式",
          child_nodes: [{ title: "2.1 单项式" }, { title: "小结" }],
        },
      ],
      outlinePath,
      repoRoot,
      markdownPath,
    });

    assert.equal(result.status, "completed");
    const outline = JSON.parse(readFileSync(outlinePath, "utf8")) as { items: Array<Record<string, unknown>> };
    assert.deepEqual(outline.items.map((item) => [item.title, item.md_start, item.md_end]), [
      ["第一章 有理数", 1, 1],
      ["1.1 正数和负数", 2, 3],
      ["小结", 4, 5],
      ["第二章 整式", 6, 6],
      ["2.1 单项式", 7, 8],
      ["小结", 9, 10],
    ]);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("lets one Enrich lesson cover consecutive OCR sections with distinct section numbers", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "okm-source-prep-enrich-composite-"));
  try {
    const outlinePath = join(repoRoot, "data", "outlines", "book-a.outline.json");
    const sourceDir = join(repoRoot, "data", "mineru", "book-a");
    const markdownPath = join(sourceDir, "full.md");
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(markdownPath, [
      "# 第二章 有理数的运算",
      "## 2.3.2 科学记数法",
      "科学记数法正文",
      "## 2.3.3 近似数",
      "近似数正文",
      "## 小结",
      "本章小结",
    ].join("\n"), "utf8");
    writeFileSync(join(sourceDir, "book_content_list_v2.json"), JSON.stringify([[
      mineruTitle("第二章 有理数的运算", 1),
      mineruTitle("2.3.2 科学记数法"),
      mineruTitle("2.3.3 近似数"),
      mineruTitle("小结"),
    ]]), "utf8");

    const result = ensureOutlineFromEnrich({
      bookId: "book-a",
      enrichBookPath: "data/enrich/mathematics/book-a.json",
      enrichTree: [{
        title: "第二章 有理数的运算",
        child_nodes: [
          { title: "2.3.2 科学记数法 2.3.3 近似数" },
          { title: "小结" },
        ],
      }],
      outlinePath,
      repoRoot,
      markdownPath,
    });

    assert.equal(result.status, "completed");
    const outline = JSON.parse(readFileSync(outlinePath, "utf8")) as { items: Array<Record<string, unknown>> };
    assert.deepEqual(outline.items.map((item) => [item.title, item.md_start, item.md_end]), [
      ["第二章 有理数的运算", 1, 1],
      ["2.3.2 科学记数法 2.3.3 近似数", 2, 5],
      ["小结", 6, 7],
    ]);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("rejects an Enrich lesson that can only match its ancestor chapter heading", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "okm-source-prep-enrich-ancestor-"));
  try {
    const outlinePath = join(repoRoot, "data", "outlines", "book-a.outline.json");
    const markdownPath = join(repoRoot, "data", "mineru", "book-a", "full.md");
    mkdirSync(join(repoRoot, "data", "mineru", "book-a"), { recursive: true });
    writeFileSync(markdownPath, "# 第一章 原子结构\n章正文\n", "utf8");
    writeFileSync(join(repoRoot, "data", "mineru", "book-a", "book_content_list_v2.json"), JSON.stringify([
      [mineruTitle("第一章 原子结构", 1), mineruParagraph("章正文")],
    ]), "utf8");

    const result = ensureOutlineFromEnrich({
      bookId: "book-a",
      enrichBookPath: "data/enrich/chemistry/book-a.json",
      enrichTree: [{
        title: "第一章 原子结构",
        child_nodes: [{ title: "原子结构" }],
      }],
      outlinePath,
      repoRoot,
      markdownPath,
    });

    assert.equal(result.status, "skipped");
    assert.deepEqual(result.status === "skipped" ? result.unmatched_item_ids : [], ["struct:book-a:lesson:1-1"]);
    assert.equal(existsSync(outlinePath), false);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("rejects Enrich alignment when the OCR source has no content_list_v2 JSON", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "okm-source-prep-enrich-no-v2-"));
  try {
    const outlinePath = join(repoRoot, "data", "outlines", "book-a.outline.json");
    const markdownPath = join(repoRoot, "data", "mineru", "book-a", "full.md");
    mkdirSync(join(repoRoot, "data", "mineru", "book-a"), { recursive: true });
    writeFileSync(markdownPath, "# 第一课\n正文\n", "utf8");

    const result = ensureOutlineFromEnrich({
      bookId: "book-a",
      enrichBookPath: "data/enrich/book-a.json",
      enrichTree: [{ title: "第一课" }],
      outlinePath,
      repoRoot,
      markdownPath,
    });

    assert.equal(result.status, "skipped");
    assert.match(result.status === "skipped" ? result.reason : "", /requires MinerU content_list_v2\.json/);
    assert.equal(existsSync(outlinePath), false);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("uses MinerU v2 pages to reject a lesson sequence fabricated across TOC and body", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "okm-source-prep-enrich-v2-cross-region-"));
  try {
    const outlinePath = join(repoRoot, "data", "outlines", "book-a.outline.json");
    const sourceDir = join(repoRoot, "data", "mineru", "book-a");
    const markdownPath = join(sourceDir, "full.md");
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(markdownPath, [
      "# 目录",
      "## 第一课",
      ...Array.from({ length: 24 }, (_, index) => `目录说明 ${index + 1}`),
      "# 正文",
      "## 第二课",
      "第二课正文",
    ].join("\n"), "utf8");
    writeFileSync(join(sourceDir, "book_content_list_v2.json"), JSON.stringify([
      [mineruTitle("目录", 1), mineruTitle("第一课")],
      [mineruTitle("正文", 1), mineruTitle("第二课"), mineruParagraph("第二课正文")],
    ]), "utf8");

    const result = ensureOutlineFromEnrich({
      bookId: "book-a",
      enrichBookPath: "data/enrich/cross-region.json",
      enrichTree: [{ title: "第一课" }, { title: "第二课" }],
      outlinePath,
      repoRoot,
      markdownPath,
    });

    assert.equal(result.status, "skipped");
    assert.match(result.status === "skipped" ? result.reason : "", /did not align completely to Markdown/);
    assert.equal(existsSync(outlinePath), false);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("uses MinerU v2 pages to prefer a lower-scoring body title over an exact TOC title", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "okm-source-prep-enrich-v2-score-"));
  try {
    const outlinePath = join(repoRoot, "data", "outlines", "book-a.outline.json");
    const sourceDir = join(repoRoot, "data", "mineru", "book-a");
    const markdownPath = join(sourceDir, "full.md");
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(markdownPath, [
      "# 目录",
      "## 第一课原子模型",
      ...Array.from({ length: 24 }, (_, index) => `目录说明 ${index + 1}`),
      "# 正文",
      "## 一课原子模型",
      "第一课正文",
      "## 第二课电子结构",
      "第二课正文",
    ].join("\n"), "utf8");
    writeFileSync(join(sourceDir, "book_content_list_v2.json"), JSON.stringify([
      [mineruTitle("目录", 1), mineruTitle("第一课原子模型")],
      [mineruTitle("正文", 1), mineruTitle("一课原子模型"), mineruParagraph("第一课正文"), mineruTitle("第二课电子结构"), mineruParagraph("第二课正文")],
    ]), "utf8");

    const result = ensureOutlineFromEnrich({
      bookId: "book-a",
      enrichBookPath: "data/enrich/lower-score-body.json",
      enrichTree: [{
        title: "第一单元",
        child_nodes: [{ title: "第一课原子模型" }, { title: "第二课电子结构" }],
      }],
      outlinePath,
      repoRoot,
      markdownPath,
    });

    assert.equal(result.status, "completed");
    const outline = JSON.parse(readFileSync(outlinePath, "utf8")) as { items: Array<Record<string, unknown>> };
    assert.deepEqual(outline.items.map((item) => [item.id, item.md_start, item.md_end, item.page_start, item.page_end]), [
      ["struct:book-a:theme:1", undefined, undefined, 2, 2],
      ["struct:book-a:lesson:1-1", 28, 29, 2, 2],
      ["struct:book-a:lesson:1-2", 30, 31, 2, 2],
    ]);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("uses MinerU v2 pages to align Enrich lessons only to the textbook body", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "okm-source-prep-enrich-v2-body-"));
  try {
    const outlinePath = join(repoRoot, "data", "outlines", "book-a.outline.json");
    const sourceDir = join(repoRoot, "data", "mineru", "book-a");
    const markdownPath = join(sourceDir, "full.md");
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(markdownPath, [
      "# 目录",
      "## 第一课 10",
      "## 第二课 20",
      "# 第一章 正文",
      "## 第一课",
      "第一课正文",
      "## 第二课",
      "第二课正文",
    ].join("\n"), "utf8");
    writeFileSync(join(sourceDir, "book_content_list_v2.json"), JSON.stringify([
      [mineruTitle("目录", 1)],
      [mineruTitle("第一课 10"), mineruTitle("第二课 20")],
      [mineruTitle("第一章 正文", 1), mineruTitle("第一课"), mineruParagraph("第一课正文"), mineruTitle("第二课"), mineruParagraph("第二课正文")],
    ]), "utf8");

    const result = ensureOutlineFromEnrich({
      bookId: "book-a",
      enrichBookPath: "data/enrich/body.json",
      enrichTree: [{
        title: "第一章 正文",
        child_nodes: [{ title: "第一课" }, { title: "第二课" }],
      }],
      outlinePath,
      repoRoot,
      markdownPath,
    });

    assert.equal(result.status, "completed");
    const outline = JSON.parse(readFileSync(outlinePath, "utf8")) as {
      toc_pages: { start: number; end: number };
      items: Array<Record<string, unknown>>;
    };
    assert.deepEqual(outline.toc_pages, { start: 1, end: 2 });
    assert.deepEqual(outline.items.map((item) => [item.id, item.md_start, item.md_end]), [
      ["struct:book-a:theme:1", 4, 4],
      ["struct:book-a:lesson:1-1", 5, 6],
      ["struct:book-a:lesson:1-2", 7, 8],
    ]);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("uses a structured appendix boundary to keep the final Enrich lesson out of an answer key", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "okm-source-prep-enrich-v2-appendix-"));
  try {
    const outlinePath = join(repoRoot, "data", "outlines", "book-a.outline.json");
    const sourceDir = join(repoRoot, "data", "mineru", "book-a");
    const markdownPath = join(sourceDir, "full.md");
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(markdownPath, [
      "# 第一章 正文",
      "## 第一课",
      "第一课正文",
      "## 第二课",
      "第二课正文",
      "# 参考答案",
      "## 第一课",
      "第一课答案",
      "## 第二课",
      "第二课答案",
    ].join("\n"), "utf8");
    writeFileSync(join(sourceDir, "book_content_list_v2.json"), JSON.stringify([
      [mineruTitle("第一章 正文", 1), mineruTitle("第一课"), mineruParagraph("第一课正文"), mineruTitle("第二课"), mineruParagraph("第二课正文")],
      [mineruTitle("参考答案", 1), mineruTitle("第一课"), mineruParagraph("第一课答案"), mineruTitle("第二课"), mineruParagraph("第二课答案")],
    ]), "utf8");

    const result = ensureOutlineFromEnrich({
      bookId: "book-a",
      enrichBookPath: "data/enrich/answer-key.json",
      enrichTree: [{
        title: "第一章 正文",
        child_nodes: [{ title: "第一课" }, { title: "第二课" }],
      }],
      outlinePath,
      repoRoot,
      markdownPath,
    });

    assert.equal(result.status, "completed");
    const outline = JSON.parse(readFileSync(outlinePath, "utf8")) as { items: Array<Record<string, unknown>> };
    assert.deepEqual(outline.items.map((item) => [item.id, item.md_start, item.md_end]), [
      ["struct:book-a:theme:1", 1, 1],
      ["struct:book-a:lesson:1-1", 2, 3],
      ["struct:book-a:lesson:1-2", 4, 5],
    ]);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("treats extended Chinese and English answer headings as structured appendix boundaries", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "okm-source-prep-enrich-v2-extended-answers-"));
  try {
    for (const [index, appendixTitle] of ["习题参考答案", "Answers to Exercises"].entries()) {
      const bookId = `book-${index + 1}`;
      const outlinePath = join(repoRoot, "data", "outlines", `${bookId}.outline.json`);
      const sourceDir = join(repoRoot, "data", "mineru", bookId);
      const markdownPath = join(sourceDir, "full.md");
      mkdirSync(sourceDir, { recursive: true });
      writeFileSync(markdownPath, [
        "# 第一章 正文",
        "## 一课原子模型",
        "第一课正文",
        "## 二课电子结构",
        "第二课正文",
        `# ${appendixTitle}`,
        "## 第一课原子模型",
        "第一课答案",
        "## 第二课电子结构",
        "第二课答案",
      ].join("\n"), "utf8");
      writeFileSync(join(sourceDir, "book_content_list_v2.json"), JSON.stringify([
        [
          mineruTitle("第一章 正文", 1),
          mineruTitle("一课原子模型"),
          mineruParagraph("第一课正文"),
          mineruTitle("二课电子结构"),
          mineruParagraph("第二课正文"),
        ],
        [
          mineruTitle(appendixTitle, 1),
          mineruTitle("第一课原子模型"),
          mineruParagraph("第一课答案"),
          mineruTitle("第二课电子结构"),
          mineruParagraph("第二课答案"),
        ],
      ]), "utf8");

      const result = ensureOutlineFromEnrich({
        bookId,
        enrichBookPath: `data/enrich/${bookId}.json`,
        enrichTree: [{
          title: "第一章 正文",
          child_nodes: [{ title: "第一课原子模型" }, { title: "第二课电子结构" }],
        }],
        outlinePath,
        repoRoot,
        markdownPath,
      });

      assert.equal(result.status, "completed", appendixTitle);
      const outline = JSON.parse(readFileSync(outlinePath, "utf8")) as { items: Array<Record<string, unknown>> };
      const lessons = outline.items.filter((item) => item.kind === "lesson");
      assert.deepEqual(lessons.map((item) => [item.md_start, item.md_end, item.page_start, item.page_end]), [
        [2, 3, 1, 1],
        [4, 5, 1, 1],
      ], appendixTitle);
    }
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("rejects structured alignment when an appendix page does not map uniquely to Markdown", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "okm-source-prep-enrich-v2-appendix-ambiguous-"));
  try {
    const outlinePath = join(repoRoot, "data", "outlines", "book-a.outline.json");
    const sourceDir = join(repoRoot, "data", "mineru", "book-a");
    const markdownPath = join(sourceDir, "full.md");
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(markdownPath, [
      "# 第一章 正文",
      "## 第一课",
      "第一课正文",
      "# 参考答案",
      "# 参考答案",
      "答案正文",
    ].join("\n"), "utf8");
    writeFileSync(join(sourceDir, "book_content_list_v2.json"), JSON.stringify([
      [mineruTitle("第一章 正文", 1), mineruTitle("第一课"), mineruParagraph("第一课正文")],
      [mineruTitle("参考答案", 1), mineruParagraph("答案正文")],
    ]), "utf8");

    const result = ensureOutlineFromEnrich({
      bookId: "book-a",
      enrichBookPath: "data/enrich/answer-key.json",
      enrichTree: [{ title: "第一章 正文", child_nodes: [{ title: "第一课" }] }],
      outlinePath,
      repoRoot,
      markdownPath,
    });

    assert.equal(result.status, "skipped");
    assert.match(result.status === "skipped" ? result.reason : "", /appendix page, but its boundary did not map uniquely/);
    assert.equal(existsSync(outlinePath), false);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("aligns an existing outline to Markdown headings", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "okm-source-prep-"));
  try {
    const outlinePath = join(repoRoot, "data", "outlines", "book-a.outline.json");
    const markdownPath = join(repoRoot, "data", "mineru", "book-a", "full.md");
    mkdirSync(join(repoRoot, "data", "outlines"), { recursive: true });
    mkdirSync(join(repoRoot, "data", "mineru", "book-a"), { recursive: true });
    writeFileSync(
      outlinePath,
      JSON.stringify(
        {
          book_id: "book-a",
          title: "测试教材",
          source_path: "book.pdf",
          generated_at: "2026-06-23T00:00:00Z",
          toc_pages: { start: 1, end: 3 },
          items: [
            { id: "struct:book-a:theme:1", kind: "theme", label: "第 1 章", title: "原子结构", page_start: 1, level: 1, order_path: "1", raw_line: "第 1 章 原子结构" },
            {
              id: "struct:book-a:lesson:1-1",
              kind: "lesson",
              label: "1.1",
              title: "氢原子结构模型",
              page_start: 3,
              level: 3,
              order_path: "1.1",
              parent_id: "struct:book-a:theme:1",
              raw_line: "1.1 氢原子结构模型",
            },
          ],
        },
        null,
        2,
      ),
      "utf8",
    );
    writeFileSync(markdownPath, ["# 第 1 章 原子结构", "章导语", "## 1.1 氢原子结构模型", "内容", "## 活动"].join("\n"), "utf8");

    const result = alignOutlineToMarkdown({ outlinePath, markdownPath, repoRoot });

    assert.equal(result.matched_items, 2);
    const outline = JSON.parse(readFileSync(outlinePath, "utf8")) as { source_path: string; items: Array<Record<string, unknown>> };
    assert.equal(outline.source_path, "data/mineru/book-a/full.md");
    assert.deepEqual(
      outline.items.map((item) => [item.id, item.md_start, item.md_end]),
      [
        ["struct:book-a:theme:1", 1, 2],
        ["struct:book-a:lesson:1-1", 3, 5],
      ],
    );
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("resets stale spans and chunks before aligning replacement OCR", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "okm-source-prep-"));
  try {
    const outlinePath = makeOutline(repoRoot);
    const outline = JSON.parse(readFileSync(outlinePath, "utf8")) as { items: Array<Record<string, unknown>> };
    outline.items.push({
      id: "struct:book-a:chunk:1-1-a",
      kind: "chunk",
      parent_id: "struct:book-a:lesson:1-1",
      md_start: 1,
      md_end: 4,
      order_path: "1.1-a",
    });
    writeFileSync(outlinePath, `${JSON.stringify(outline, null, 2)}\n`, "utf8");

    const reset = resetOutlineForSourceReplacement({ outlinePath });

    assert.equal(reset.reset_items, 1);
    assert.equal(reset.removed_chunks, 1);
    const resetOutline = JSON.parse(readFileSync(outlinePath, "utf8")) as { items: Array<Record<string, unknown>> };
    assert.equal(resetOutline.items.some((item) => item.kind === "chunk"), false);
    const lesson = resetOutline.items.find((item) => item.kind === "lesson");
    assert.equal("md_start" in (lesson ?? {}), false);
    assert.equal("md_end" in (lesson ?? {}), false);
    assert.equal("raw_line" in (lesson ?? {}), false);
    assert.equal(lesson?.page_start, 1);
    assert.equal(lesson?.page_end, 1);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("realigns nested lesson spans without flattening the outline hierarchy", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "okm-source-prep-nested-"));
  try {
    const outlinePath = join(repoRoot, "data", "outlines", "book-a.outline.json");
    const markdownPath = join(repoRoot, "data", "mineru", "book-a", "full.md");
    mkdirSync(join(repoRoot, "data", "outlines"), { recursive: true });
    mkdirSync(join(repoRoot, "data", "mineru", "book-a"), { recursive: true });
    writeFileSync(outlinePath, `${JSON.stringify({
      book_id: "book-a",
      items: [{
        id: "struct:book-a:theme:1",
        kind: "theme",
        title: "第一章",
        order_path: "1",
        md_start: 1,
        md_end: 4,
        children: [{
          id: "struct:book-a:lesson:1-1",
          kind: "lesson",
          title: "第一课",
          order_path: "1.1",
          md_start: 1,
          md_end: 2,
          children: [{
            id: "struct:book-a:chunk:1-1-a",
            kind: "chunk",
            order_path: "1.1-a",
            md_start: 1,
            md_end: 2,
          }],
        }, {
          id: "struct:book-a:lesson:1-2",
          kind: "lesson",
          title: "第二课",
          order_path: "1.2",
          md_start: 3,
          md_end: 4,
        }],
      }],
    }, null, 2)}\n`, "utf8");
    writeFileSync(markdownPath, [
      "preface",
      "# 第一章",
      "chapter intro",
      "## 第一课",
      "lesson one",
      "## 第二课",
      "lesson two",
    ].join("\n"), "utf8");

    const reset = resetOutlineForSourceReplacement({ outlinePath });
    const alignment = alignOutlineToMarkdown({ outlinePath, markdownPath, repoRoot });

    assert.equal(reset.removed_chunks, 1);
    assert.equal(alignment.matched_items, 3);
    assert.equal(alignment.total_items, 3);
    const outline = JSON.parse(readFileSync(outlinePath, "utf8")) as {
      items: Array<{ children?: Array<Record<string, unknown>> }>;
    };
    assert.equal(outline.items.length, 1);
    const children = outline.items[0]?.children ?? [];
    assert.equal(children.length, 2);
    assert.equal(children[0]?.md_start, 4);
    assert.equal(children[0]?.md_end, 5);
    assert.equal(children[1]?.md_start, 6);
    assert.equal(children[1]?.md_end, 7);
    assert.equal(Array.isArray(children[0]?.children) ? children[0].children.length : 0, 0);

    const chunkResult = ensureChunkedOutline({
      outlinePath,
      repoRoot,
      minLines: 1,
      maxLines: 2,
      targetLines: 1,
    });
    assert.equal(chunkResult.status, "completed");
    const chunkedOutline = JSON.parse(readFileSync(outlinePath, "utf8")) as {
      items: Array<Record<string, unknown>>;
    };
    const chunks = chunkedOutline.items.filter((item) => item.kind === "chunk");
    assert.equal(chunks.length, 2);
    assert.deepEqual(chunks.map((item) => [item.md_start, item.md_end]), [[4, 5], [6, 7]]);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("chunks nested outline leaves in Markdown document order", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "okm-source-prep-nested-order-"));
  try {
    const outlinePath = join(repoRoot, "data", "outlines", "book-a.outline.json");
    mkdirSync(join(repoRoot, "data", "outlines"), { recursive: true });
    writeFileSync(outlinePath, `${JSON.stringify({
      book_id: "book-a",
      items: [{
        id: "struct:book-a:theme:1",
        kind: "theme",
        title: "第一章",
        order_path: "1",
        md_start: 1,
        md_end: 6,
        children: [{
          id: "struct:book-a:lesson:1",
          kind: "lesson",
          title: "第一课",
          order_path: "1.1",
          parent_id: "struct:book-a:theme:1",
          md_start: 1,
          md_end: 2,
          children: [{
            id: "struct:book-a:activity:1-1-1",
            kind: "activity",
            title: "活动",
            order_path: "1.1.1",
            parent_id: "struct:book-a:lesson:1",
            md_start: 3,
            md_end: 4,
          }],
        }, {
          id: "struct:book-a:lesson:2",
          kind: "lesson",
          title: "第二课",
          order_path: "1.2",
          parent_id: "struct:book-a:theme:1",
          md_start: 5,
          md_end: 6,
        }],
      }],
    }, null, 2)}\n`, "utf8");

    const result = ensureChunkedOutline({
      outlinePath,
      repoRoot,
      minLines: 10,
      maxLines: 20,
      targetLines: 10,
    });

    assert.equal(result.status, "completed");
    const outline = JSON.parse(readFileSync(outlinePath, "utf8")) as {
      items: Array<Record<string, unknown>>;
    };
    const chunk = outline.items.find((item) => item.kind === "chunk");
    assert.ok(chunk);
    assert.equal(chunk.md_start, 1);
    assert.equal(chunk.md_end, 6);
    assert.deepEqual(chunk.source_ids, [
      "struct:book-a:lesson:1",
      "struct:book-a:activity:1-1-1",
      "struct:book-a:lesson:2",
    ]);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("blocks source preparation when a reset lesson cannot be realigned", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "okm-source-prep-unmatched-"));
  try {
    const outlinePath = join(repoRoot, "data", "outlines", "book-a.outline.json");
    const markdownPath = join(repoRoot, "data", "mineru", "book-a", "full.md");
    mkdirSync(join(repoRoot, "data", "outlines"), { recursive: true });
    mkdirSync(join(repoRoot, "data", "mineru", "book-a"), { recursive: true });
    writeFileSync(outlinePath, `${JSON.stringify({
      book_id: "book-a",
      items: [{
        id: "struct:book-a:lesson:missing",
        kind: "lesson",
        title: "Missing lesson",
        order_path: "1",
        md_start: 1,
        md_end: 2,
      }],
    }, null, 2)}\n`, "utf8");
    writeFileSync(markdownPath, "# Different lesson\nbody\n", "utf8");

    resetOutlineForSourceReplacement({ outlinePath });
    const result = ensureOutlineFromMarkdown({
      bookId: "book-a",
      outlinePath,
      repoRoot,
      markdownPath,
    });

    assert.equal(result.status, "blocked");
    assert.match(result.status === "blocked" ? result.error : "", /struct:book-a:lesson:missing/);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("generates chunk items for an existing outline once", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "okm-source-prep-"));
  try {
    const outlinePath = makeOutline(repoRoot);
    mkdirSync(join(repoRoot, "data", "mineru", "book-a"), { recursive: true });
    writeFileSync(join(repoRoot, "data", "mineru", "book-a", "full.md"), ["# 第一课", "a".repeat(20), "# 第二节", "b".repeat(20)].join("\n"), "utf8");

    const result = ensureChunkedOutline({ outlinePath, repoRoot, maxLines: 2, targetLines: 1, minLines: 1 });
    assert.equal(result.status, "completed");
    assert.equal(result.generated_chunks > 0, true);
    const outline = JSON.parse(readFileSync(outlinePath, "utf8")) as { items: Array<Record<string, unknown>> };
    assert.equal(outline.items.some((item) => item.kind === "chunk"), true);

    const second = ensureChunkedOutline({ outlinePath, repoRoot, maxLines: 2, targetLines: 1, minLines: 1 });
    assert.equal(second.status, "skipped");
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("keeps each Enrich lesson as a hard chunk boundary", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "okm-source-prep-enrich-chunks-"));
  try {
    const outlinePath = join(repoRoot, "data", "outlines", "book-a.outline.json");
    const sourceDir = join(repoRoot, "data", "mineru", "book-a");
    mkdirSync(join(repoRoot, "data", "outlines"), { recursive: true });
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, "full.md"), ["# 第一课", "正文一", "# 第二课", "正文二"].join("\n"), "utf8");
    writeFileSync(outlinePath, JSON.stringify({
      book_id: "book-a",
      source_kind: "enrich",
      source_path: "data/mineru/book-a/full.md",
      items: [
        { id: "struct:book-a:topic:1", kind: "topic", title: "第一单元", order_path: "1" },
        {
          id: "struct:book-a:lesson:1-1",
          kind: "lesson",
          parent_id: "struct:book-a:topic:1",
          title: "第一课",
          label: "第一课",
          order_path: "1.1",
          md_start: 1,
          md_end: 2,
        },
        {
          id: "struct:book-a:lesson:1-2",
          kind: "lesson",
          parent_id: "struct:book-a:topic:1",
          title: "第二课",
          label: "第二课",
          order_path: "1.2",
          md_start: 3,
          md_end: 4,
        },
      ],
    }), "utf8");

    const result = ensureChunkedOutline({ outlinePath, repoRoot, minLines: 10, maxLines: 100 });

    assert.equal(result.status, "completed");
    const outline = JSON.parse(readFileSync(outlinePath, "utf8")) as { items: Array<Record<string, unknown>> };
    const chunks = outline.items.filter((item) => item.kind === "chunk");
    assert.deepEqual(chunks.map((item) => [item.md_start, item.md_end, item.source_ids]), [
      [1, 2, ["struct:book-a:lesson:1-1"]],
      [3, 4, ["struct:book-a:lesson:1-2"]],
    ]);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("migrates legacy chunks and restores summary and assessment coverage", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "okm-source-prep-role-migration-"));
  try {
    const outlinePath = join(repoRoot, "data", "outlines", "book-a.outline.json");
    const sourceDir = join(repoRoot, "data", "mineru", "book-a");
    mkdirSync(join(repoRoot, "data", "outlines"), { recursive: true });
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, "full.md"), ["# 核心知识", "正文", "# 本章小结", "总结", "# 课后练习", "题目"].join("\n"), "utf8");
    writeFileSync(outlinePath, JSON.stringify({
      book_id: "book-a",
      source_path: "data/mineru/book-a/full.md",
      items: [
        { id: "topic", kind: "topic", title: "第一单元", order_path: "1" },
        { id: "struct:book-a:lesson:1", kind: "lesson", parent_id: "topic", title: "核心知识", order_path: "1.1", md_start: 1, md_end: 2 },
        { id: "struct:book-a:lesson:2", kind: "lesson", parent_id: "topic", title: "本章小结", order_path: "1.2", md_start: 3, md_end: 4 },
        { id: "struct:book-a:lesson:3", kind: "lesson", parent_id: "topic", title: "课后练习", order_path: "1.3", md_start: 5, md_end: 6 },
        {
          id: "struct:book-a:chunk:1-a",
          kind: "chunk",
          parent_id: "struct:book-a:lesson:1",
          source_ids: ["struct:book-a:lesson:1"],
          title: "核心知识",
          order_path: "1.1-a",
          md_start: 1,
          md_end: 2,
        },
      ],
    }), "utf8");

    const result = ensureChunkedOutline({ outlinePath, repoRoot, minLines: 10, maxLines: 100 });
    assert.equal(result.status, "completed");
    const outline = JSON.parse(readFileSync(outlinePath, "utf8")) as { items: Array<Record<string, unknown>> };
    assert.deepEqual(
      outline.items.filter((item) => item.kind === "chunk").map((item) => [item.parent_id, item.content_role]),
      [
        ["struct:book-a:lesson:1", "knowledge"],
        ["struct:book-a:lesson:2", "summary"],
        ["struct:book-a:lesson:3", "assessment"],
      ],
    );
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("reclassifies a legacy exercise chunk that was previously marked as knowledge", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "okm-source-prep-role-correction-"));
  try {
    const outlinePath = join(repoRoot, "data", "outlines", "book-a.outline.json");
    const sourceDir = join(repoRoot, "data", "mineru", "book-a");
    mkdirSync(join(repoRoot, "data", "outlines"), { recursive: true });
    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(join(sourceDir, "full.md"), ["# 课后练习", "比较两个有理数的大小。"].join("\n"), "utf8");
    writeFileSync(outlinePath, JSON.stringify({
      book_id: "book-a",
      source_path: "data/mineru/book-a/full.md",
      items: [
        { id: "topic", kind: "topic", title: "第一单元", order_path: "1" },
        { id: "struct:book-a:lesson:1", kind: "lesson", parent_id: "topic", title: "课后练习", order_path: "1.1", md_start: 1, md_end: 2 },
        {
          id: "struct:book-a:chunk:1-a",
          kind: "chunk",
          parent_id: "struct:book-a:lesson:1",
          source_ids: ["struct:book-a:lesson:1"],
          title: "课后练习",
          content_role: "knowledge",
          order_path: "1.1-a",
          md_start: 1,
          md_end: 2,
        },
      ],
    }), "utf8");

    const result = ensureChunkedOutline({ outlinePath, repoRoot, minLines: 10, maxLines: 100 });
    assert.equal(result.status, "completed");
    const outline = JSON.parse(readFileSync(outlinePath, "utf8")) as { items: Array<Record<string, unknown>> };
    assert.deepEqual(
      outline.items.filter((item) => item.kind === "chunk").map((item) => item.content_role),
      ["assessment"],
    );
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

function mineruTitle(title: string, level = 2): Record<string, unknown> {
  return {
    type: "title",
    content: { title_content: [{ type: "text", content: title }], level },
    bbox: [0, 0, 100, 20],
  };
}

function mineruParagraph(text: string): Record<string, unknown> {
  return {
    type: "paragraph",
    content: { paragraph_content: [{ type: "text", content: text }] },
    bbox: [0, 30, 100, 80],
  };
}

function makeOutline(repoRoot: string): string {
  const outlineDir = join(repoRoot, "data", "outlines");
  mkdirSync(outlineDir, { recursive: true });
  const outlinePath = join(outlineDir, "book-a.outline.json");
  writeFileSync(
    outlinePath,
    JSON.stringify(
      {
        book_id: "book-a",
        source_path: "data/mineru/book-a/full.md",
        items: [
          { id: "topic-1", kind: "topic", title: "主题" },
          { id: "struct:book-a:lesson:1-1", kind: "lesson", parent_id: "topic-1", title: "第一课", md_start: 1, md_end: 4, page_start: 1, page_end: 1 },
        ],
      },
      null,
      2,
    ),
    "utf8",
  );
  return outlinePath;
}
