import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  alignOutlineToMarkdown,
  ensureChunkedOutline,
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
