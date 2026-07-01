import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { resolveImportAssetDirs } from "./import-file-assets.js";

test("falls back to sample file assets when generated data is absent", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "okm-import-assets-"));
  try {
    mkdirSync(join(repoRoot, "data", "outlines"), { recursive: true });
    writeFileSync(join(repoRoot, "data", "outlines", ".gitkeep"), "", "utf8");
    writeFileSync(join(repoRoot, "data", "frameworks.json"), "{}", "utf8");

    mkdirSync(join(repoRoot, "examples", "sample-data", "outlines"), { recursive: true });
    mkdirSync(join(repoRoot, "examples", "sample-data", "enrich"), { recursive: true });
    mkdirSync(join(repoRoot, "examples", "sample-data", "mineru", "sample-book"), { recursive: true });
    writeFileSync(join(repoRoot, "examples", "sample-data", "outlines", "sample-book.outline.json"), "{}", "utf8");
    writeFileSync(join(repoRoot, "examples", "sample-data", "enrich", "enrich_books_index.json"), "{\"books\":[]}", "utf8");
    writeFileSync(join(repoRoot, "examples", "sample-data", "mineru", "sample-book", "full.md"), "# 示例\n", "utf8");

    const dirs = resolveImportAssetDirs(repoRoot);

    assert.equal(dirs.outlineDir, join(repoRoot, "examples", "sample-data", "outlines"));
    assert.equal(dirs.enrichDir, join(repoRoot, "examples", "sample-data", "enrich"));
    assert.equal(dirs.mineruDir, join(repoRoot, "examples", "sample-data", "mineru"));
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});

test("prefers generated data over bundled sample file assets", () => {
  const repoRoot = mkdtempSync(join(tmpdir(), "okm-import-assets-"));
  try {
    mkdirSync(join(repoRoot, "data", "outlines"), { recursive: true });
    mkdirSync(join(repoRoot, "data", "enrich"), { recursive: true });
    mkdirSync(join(repoRoot, "data", "mineru", "generated-book"), { recursive: true });
    writeFileSync(join(repoRoot, "data", "outlines", "generated-book.outline.json"), "{}", "utf8");
    writeFileSync(join(repoRoot, "data", "enrich", "enrich_books_index.json"), "{\"books\":[]}", "utf8");
    writeFileSync(join(repoRoot, "data", "mineru", "generated-book", "mineru-result.json"), "{}", "utf8");

    mkdirSync(join(repoRoot, "examples", "sample-data", "outlines"), { recursive: true });
    mkdirSync(join(repoRoot, "examples", "sample-data", "enrich"), { recursive: true });
    mkdirSync(join(repoRoot, "examples", "sample-data", "mineru", "sample-book"), { recursive: true });
    writeFileSync(join(repoRoot, "examples", "sample-data", "outlines", "sample-book.outline.json"), "{}", "utf8");
    writeFileSync(join(repoRoot, "examples", "sample-data", "enrich", "enrich_books_index.json"), "{\"books\":[]}", "utf8");
    writeFileSync(join(repoRoot, "examples", "sample-data", "mineru", "sample-book", "full.md"), "# 示例\n", "utf8");

    const dirs = resolveImportAssetDirs(repoRoot);

    assert.equal(dirs.outlineDir, join(repoRoot, "data", "outlines"));
    assert.equal(dirs.enrichDir, join(repoRoot, "data", "enrich"));
    assert.equal(dirs.mineruDir, join(repoRoot, "data", "mineru"));
  } finally {
    rmSync(repoRoot, { recursive: true, force: true });
  }
});
