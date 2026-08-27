import assert from "node:assert/strict";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import test from "node:test";

import {
  assertSafeZipMember,
  bearerToken,
  buildMineruTaskPayload,
  copyMarkdownForPipeline,
  extractMineruResults,
  importOcrBundle,
  inspectOcrBundle,
  parseMineruBatchId,
  parseMineruUploadUrl,
  runMineruSourceMarkdown,
  selectMineruResult,
} from "./mineru-source.js";

test("inspects and imports a nested MinerU OCR bundle without a PDF or API call", () => {
  const root = mkdtempSync(join(tmpdir(), "okm-ocr-import-"));
  const bundle = join(root, "book", "hybrid_ocr");
  const output = join(root, "imported");
  try {
    mkdirSync(join(bundle, "images"), { recursive: true });
    writeFileSync(join(bundle, "book.md"), "# 第一章 有理数\n正文\n![](images/a.jpg)\n", "utf8");
    writeFileSync(join(bundle, "book_content_list.json"), JSON.stringify([{ type: "text", page_idx: 0, text: "正文" }]), "utf8");
    writeFileSync(join(bundle, "book_content_list_v2.json"), JSON.stringify([
      [{ type: "title", content: { level: 1, title_content: [{ type: "text", content: "第一章 有理数" }] } }],
      [{ type: "paragraph", content: { paragraph_content: [{ type: "text", content: "正文" }] } }],
    ]), "utf8");
    writeFileSync(join(bundle, "images", "a.jpg"), "image", "utf8");

    const inspection = inspectOcrBundle(root);
    assert.equal(inspection.folder_path, bundle);
    assert.equal(inspection.quality, "complete");
    assert.equal(inspection.preferred_input, "markdown_with_v2");
    assert.equal(inspection.page_count, 2);
    assert.equal(inspection.block_count, 2);
    assert.equal(inspection.image_count, 1);

    const result = importOcrBundle({ bookId: "math-grade7", folderPath: root, outputDir: output });
    assert.equal(result.source_kind, "ocr_import");
    assert.equal(result.created, false);
    assert.equal(readFileSync(join(output, "full.md"), "utf8"), "# 第一章 有理数\n正文\n![](images/a.jpg)\n");
    assert.equal(existsSync(join(output, "book_content_list_v2.json")), true);
    assert.equal(existsSync(join(output, "images", "a.jpg")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("renders compatible Markdown when an OCR bundle only contains content_list_v2 JSON", () => {
  const root = mkdtempSync(join(tmpdir(), "okm-ocr-json-"));
  const output = join(root, "imported");
  try {
    writeFileSync(join(root, "book_content_list_v2.json"), JSON.stringify([[
      { type: "title", content: { level: 2, title_content: [{ type: "text", content: "1.1 正数和负数" }] } },
      { type: "paragraph", content: { paragraph_content: [
        { type: "text", content: "增长" },
        { type: "equation_inline", content: "7.8\\%" },
      ] } },
      { type: "equation_interline", content: { math_content: "a+b=c", math_type: "latex" } },
      { type: "table", content: {
        table_caption: [],
        table_footnote: [],
        html: "<table><tr><td>北京</td><td>-4.6°C</td></tr></table>",
      } },
      { type: "table", content: {
        table_caption: [{ type: "text", content: "表 1 季度利润" }],
        table_footnote: [{ type: "text", content: "注：单位为万元" }],
        html: "<table><tr><td>第一季度</td><td>-6.8</td></tr></table>",
      } },
    ]]), "utf8");

    const result = importOcrBundle({ bookId: "math-grade7", folderPath: root, outputDir: output });
    const markdown = readFileSync(result.source_markdown_path, "utf8");
    assert.match(markdown, /<!-- page:1 -->/);
    assert.match(markdown, /## 1\.1 正数和负数/);
    assert.match(markdown, /增长\$7\.8\\%\$/);
    assert.match(markdown, /\$\$\na\+b=c\n\$\$/);
    assert.match(markdown, /<table><tr><td>北京<\/td><td>-4\.6°C<\/td><\/tr><\/table>/);
    assert.match(markdown, /表 1 季度利润\n\n<table><tr><td>第一季度<\/td><td>-6\.8<\/td><\/tr><\/table>\n\n注：单位为万元/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("replaces stale OCR assets instead of merging a corrected bundle", () => {
  const root = mkdtempSync(join(tmpdir(), "okm-ocr-replace-"));
  const bundle = join(root, "replacement", "hybrid_ocr");
  const output = join(root, "imported");
  try {
    mkdirSync(bundle, { recursive: true });
    mkdirSync(join(output, "images"), { recursive: true });
    writeFileSync(join(bundle, "book.md"), "# Corrected source\n![](images/old.jpg)\n", "utf8");
    writeFileSync(join(output, "images", "old.jpg"), "stale image", "utf8");
    writeFileSync(join(output, "old_content_list.json"), "[]", "utf8");

    const result = importOcrBundle({ bookId: "math-grade7", folderPath: bundle, outputDir: output });

    assert.equal(readFileSync(result.source_markdown_path, "utf8"), "# Corrected source\n![](images/old.jpg)\n");
    assert.equal(existsSync(join(output, "images", "old.jpg")), false);
    assert.equal(existsSync(join(output, "old_content_list.json")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects unsafe ZIP member paths on every platform", () => {
  const target = join(tmpdir(), "okm-safe-zip");
  assert.equal(assertSafeZipMember("nested/full.md", target), join(target, "nested", "full.md"));
  assert.throws(() => assertSafeZipMember("../outside.txt", target), /unsafe zip member/);
  assert.throws(() => assertSafeZipMember("nested\\..\\..\\outside.txt", target), /unsafe zip member/);
  assert.throws(() => assertSafeZipMember("C:\\outside.txt", target), /unsafe zip member/);
  assert.throws(() => assertSafeZipMember("/outside.txt", target), /unsafe zip member/);
});

test("builds MinerU request payloads like the Python script", () => {
  assert.equal(bearerToken("abc"), "Bearer abc");
  assert.equal(bearerToken("Bearer abc"), "Bearer abc");
  assert.deepEqual(
    buildMineruTaskPayload(
      {
        bookId: "chem",
        modelVersion: "vlm",
        language: "ch",
        dataId: "",
        isOcr: true,
        enableFormula: true,
        enableTable: true,
        pageRanges: "1-5",
      },
      { name: "book.pdf" },
    ),
    {
      enable_formula: true,
      enable_table: true,
      language: "ch",
      model_version: "vlm",
      files: [{ name: "book.pdf", is_ocr: true, data_id: "chem" }],
      page_ranges: "1-5",
    },
  );
});

test("parses MinerU batch and result responses defensively", () => {
  assert.equal(parseMineruBatchId({ code: 0, data: { batch_id: "batch-a" } }, "submit"), "batch-a");
  assert.equal(parseMineruUploadUrl({ data: { file_urls: [{ upload_url: "https://upload" }] } }), "https://upload");
  assert.equal(parseMineruUploadUrl({ data: { file_urls: ["https://upload-string"] } }), "https://upload-string");
  assert.throws(() => parseMineruBatchId({ code: 1, msg: "bad" }, "submit"), /submit failed/);

  const body = {
    data: {
      extract_result: [
        { data_id: "a", file_name: "a.pdf", state: "done" },
        { data_id: "b", file_name: "b.pdf", state: "running" },
      ],
    },
  };
  const results = extractMineruResults(body);
  assert.equal(results.length, 2);
  assert.equal(selectMineruResult(results, { dataId: "b", fileName: "" }).file_name, "b.pdf");
  assert.equal(selectMineruResult(results, { dataId: "", fileName: "a.pdf" }).data_id, "a");
});

test("returns cached full.md without calling MinerU", async () => {
  const dir = mkdtempSync(join(tmpdir(), "okm-mineru-"));
  try {
    writeFileSync(join(dir, "full.md"), "# 已有结果\n", "utf8");
    const result = await runMineruSourceMarkdown({
      bookId: "chem",
      outputDir: dir,
      apiKey: "",
      pdfPath: "/missing.pdf",
    });

    assert.equal(result.status, "success");
    assert.equal(result.created, false);
    assert.equal(result.source_markdown_path, join(dir, "full.md"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runs a remote MinerU URL flow through injectable dependencies", async () => {
  const dir = mkdtempSync(join(tmpdir(), "okm-mineru-"));
  const calls: string[] = [];
  let pollCount = 0;
  let now = 0;
  try {
    const result = await runMineruSourceMarkdown(
      {
        bookId: "chem",
        outputDir: dir,
        apiKey: "secret",
        fileUrl: "https://example.test/book.pdf",
        baseUrl: "https://mineru.test",
        pollIntervalMs: 1000,
        timeoutMs: 5000,
      },
      {
        requestJson: async (method, url, payload) => {
          calls.push(`${method} ${url} ${payload ? JSON.stringify(payload) : ""}`);
          if (url.endsWith("/api/v4/extract/task/batch")) return { code: 0, data: { batch_id: "batch-a" } };
          pollCount += 1;
          return pollCount === 1
            ? { code: 0, data: { extract_result: [{ data_id: "chem", file_name: "book.pdf", state: "running" }] } }
            : { code: 0, data: { extract_result: [{ data_id: "chem", file_name: "book.pdf", state: "done", full_zip_url: "https://zip.test/result.zip" }] } };
        },
        downloadFile: async (_url, outPath) => {
          writeFileSync(outPath, "zip-bytes", "utf8");
        },
        extractZip: async (_zipPath, targetDir) => {
          mkdirSync(join(targetDir, "nested", "images"), { recursive: true });
          writeFileSync(join(targetDir, "nested", "full.md"), "# MinerU\n", "utf8");
          writeFileSync(join(targetDir, "nested", "images", "a.txt"), "asset", "utf8");
        },
        putFile: async () => {
          throw new Error("putFile should not be called for fileUrl flow.");
        },
        sleep: async (ms) => {
          now += ms;
        },
        now: () => now,
      },
    );

    assert.equal(result.status, "success");
    assert.equal(result.created, true);
    assert.equal(result.batch_id, "batch-a");
    assert.equal(result.zip_url, "https://zip.test/result.zip");
    assert.equal(readFileSync(join(dir, "full.md"), "utf8"), "# MinerU\n");
    assert.equal(existsSync(join(dir, "images", "a.txt")), true);
    assert.equal(existsSync(join(dir, "mineru-result.json")), false);
    assert.equal(calls[0]?.startsWith("POST https://mineru.test/api/v4/extract/task/batch"), true);
    assert.equal(calls.at(-1), "GET https://mineru.test/api/v4/extract-results/batch/batch-a ");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("uploads local PDFs through the upload-url MinerU path", async () => {
  const dir = mkdtempSync(join(tmpdir(), "okm-mineru-"));
  const pdfPath = join(dir, "book.pdf");
  const uploaded: string[] = [];
  try {
    writeFileSync(pdfPath, "pdf", "utf8");
    const result = await runMineruSourceMarkdown(
      {
        bookId: "chem",
        outputDir: join(dir, "out"),
        apiKey: "secret",
        pdfPath,
        baseUrl: "https://mineru.test",
        pollIntervalMs: 1000,
        timeoutMs: 5000,
      },
      {
        requestJson: async (_method, url) => {
          if (url.endsWith("/api/v4/file-urls/batch")) return { code: 0, data: { batch_id: "batch-local", file_urls: [{ upload_url: "https://upload.test/file" }] } };
          return { code: 0, data: { extract_result: { data_id: "chem", file_name: basename(pdfPath), state: "done", full_zip_url: "https://zip.test/local.zip" } } };
        },
        putFile: async (uploadUrl, path) => {
          uploaded.push(`${uploadUrl} ${path}`);
        },
        downloadFile: async (_url, outPath) => {
          writeFileSync(outPath, "zip-bytes", "utf8");
        },
        extractZip: async (_zipPath, targetDir) => {
          mkdirSync(targetDir, { recursive: true });
          writeFileSync(join(targetDir, "full.md"), "# Local\n", "utf8");
        },
        sleep: async () => {},
        now: () => 0,
      },
    );

    assert.equal(result.status, "success");
    assert.deepEqual(uploaded, [`https://upload.test/file ${pdfPath}`]);
    assert.equal(readFileSync(join(dir, "out", "full.md"), "utf8"), "# Local\n");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("copies the chosen Markdown and sibling asset directories", () => {
  const dir = mkdtempSync(join(tmpdir(), "okm-mineru-copy-"));
  try {
    mkdirSync(join(dir, "raw", "assets"), { recursive: true });
    writeFileSync(join(dir, "raw", "lesson.md"), "# Lesson\n", "utf8");
    writeFileSync(join(dir, "raw", "assets", "image.txt"), "asset", "utf8");

    const target = copyMarkdownForPipeline(join(dir, "raw", "lesson.md"), join(dir, "out"));

    assert.equal(target, join(dir, "out", "full.md"));
    assert.equal(readFileSync(target, "utf8"), "# Lesson\n");
    assert.equal(readFileSync(join(dir, "out", "assets", "image.txt"), "utf8"), "asset");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
