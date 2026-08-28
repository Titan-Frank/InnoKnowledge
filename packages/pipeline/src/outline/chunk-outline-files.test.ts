import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadOutlineFile, resolveInputPath, resolveOutlinePath, runChunkOutlineFile } from "./chunk-outline-files.js";

test("resolves outline paths like Python chunk_outline load_outline", () => {
  assert.equal(resolveOutlinePath({ bookId: "chem", outlinesDir: "/repo/data/outlines" }, "/repo"), "/repo/data/outlines/chem.outline.json");
  assert.equal(resolveOutlinePath({ outlinePath: "data/outlines/chem.outline.json" }, "/repo"), "/repo/data/outlines/chem.outline.json");
  assert.equal(resolveInputPath("/abs/book.md", "/repo"), "/abs/book.md");
  assert.equal(resolveInputPath("data/book.md", "/repo"), "/repo/data/book.md");
});

test("loads outline files and validates the Python-compatible items field", () => {
  const dir = mkdtempSync(join(tmpdir(), "okm-chunk-outline-"));
  try {
    const outlinePath = join(dir, "book.outline.json");
    writeFileSync(outlinePath, JSON.stringify({ book_id: "book", items: [{ id: "topic-1", kind: "topic" }] }), "utf8");

    assert.deepEqual(loadOutlineFile(outlinePath), { book_id: "book", items: [{ id: "topic-1", kind: "topic" }] });
    assert.throws(() => loadOutlineFile(join(dir, "missing.outline.json")), /Outline not found/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("plans chunk outline from book id, outline file, and markdown source_path", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "okm-chunk-outline-"));
  try {
    const outlinesDir = join(repoRoot, "data", "outlines");
    const markdownDir = join(repoRoot, "data", "mineru", "chem");
    const outlinePath = join(outlinesDir, "chem.outline.json");
    const markdownPath = join(markdownDir, "full.md");
    mkdirSync(outlinesDir, { recursive: true });
    mkdirSync(markdownDir, { recursive: true });
    writeFileSync(markdownPath, "# 引入\ntext\n# 性质\ntext\n", "utf8");
    writeFileSync(
      outlinePath,
      JSON.stringify({
        book_id: "chem",
        source_path: "data/mineru/chem/full.md",
        items: [
          { id: "topic-1", kind: "topic" },
          {
            id: "struct:chem:lesson:1-1",
            kind: "lesson",
            parent_id: "topic-1",
            label: "第1节",
            title: "水",
            md_start: 1,
            md_end: 4,
            order_path: "1.1",
          },
        ],
      }),
      "utf8",
    );

    const output = runChunkOutlineFile({
      bookId: "chem",
      repoRoot,
      outlinesDir,
      maxLines: 300,
      includeOutline: true,
    });

    assert.equal(output.outline_path, outlinePath);
    assert.equal(output.markdown_path, markdownPath);
    assert.deepEqual(output.warnings, []);
    assert.deepEqual(output.stats, { split: 0, merged: 0, normal: 1, excluded: 0 });
    assert.equal(output.chunks[0]?.title, "水");
    assert.deepEqual(output.outline?.items.map((item) => item.id), ["topic-1", "struct:chem:lesson:1-1", "struct:chem:chunk:1-1-a"]);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("skips heading analysis when markdown is missing", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "okm-chunk-outline-"));
  try {
    const outlinesDir = join(repoRoot, "data", "outlines");
    const outlinePath = join(outlinesDir, "chem.outline.json");
    mkdirSync(outlinesDir, { recursive: true });
    writeFileSync(
      outlinePath,
      JSON.stringify({
        source_path: "data/missing.md",
        items: [
          { id: "topic-1", kind: "topic" },
          { id: "struct:chem:lesson:1-1", kind: "lesson", parent_id: "topic-1", label: "第1节", title: "水", md_start: 1, md_end: 400, order_path: "1.1" },
        ],
      }),
      "utf8",
    );

    const output = runChunkOutlineFile({ bookId: "chem", repoRoot, outlinesDir, maxLines: 300 });

    assert.deepEqual(output.warnings, ["Markdown not found at data/missing.md; skipping heading analysis."]);
    assert.equal(output.chunks.length, 1);
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
