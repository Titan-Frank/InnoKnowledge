import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  anchorTokenVariants,
  loadOutlineItems,
  makeDomainProfileId,
  makeEdgeId,
  makeLessonRunId,
  makeNodeCardId,
  makeProfileId,
  makeStableSuffixWithLength,
  normalizeTerm,
  outlinePathForBook,
  readableOutlinePathForBook,
  safePathToken,
  uniqueStable,
} from "./pathing.js";

test("stable identifiers match the Python okm_pathing format", () => {
  assert.equal(makeStableSuffixWithLength(["a", "b"], 12), "a2f1d1995a3a");
  assert.equal(makeEdgeId("node:a", "is_a", "node:b"), "edge:auto-9a00e27364e5");
  assert.equal(makeLessonRunId("chem-grade8", "struct:chem-grade8:lesson:1-1-1"), "lesson-run:515c00b1d466");
  assert.equal(makeProfileId("node:a", "chemistry"), "profile:auto-b7ebb485ebf7");
  assert.equal(makeDomainProfileId("node:a", "chemistry"), "domain-profile:auto-b7ebb485ebf7");
  assert.equal(makeNodeCardId("node:a"), "node-card:auto-16e68543d927");
});

test("text normalization and path tokens preserve readable Unicode safely", () => {
  assert.equal(normalizeTerm("  Water   Cycle\n "), "water cycle");
  assert.equal(safePathToken("  ../第 1 课: water cycle  "), "第-1-课-water-cycle");
  assert.equal(safePathToken("初中_七年级_数学_人教版_上册"), "初中_七年级_数学_人教版_上册");
  assert.equal(safePathToken("..."), "item");
});

test("anchor token variants preserve order and remove duplicates", () => {
  assert.deepEqual(anchorTokenVariants("struct:chem-grade8:lesson:1-1-1", "chem-grade8"), [
    "struct:chem-grade8:lesson:1-1-1",
    "lesson:1-1-1",
    "lesson-1-1-1",
    "1-1-1",
  ]);
  assert.deepEqual(uniqueStable(["a", "b", "a", "c", "b"]), ["a", "b", "c"]);
});

test("outline loading falls back to sample outlines when the canonical file is absent", () => {
  const root = mkdtempSync(join(tmpdir(), "okm-outline-"));
  try {
    const outlinesDir = join(root, "data", "outlines");
    const sampleOutlinesDir = join(root, "examples", "sample-data", "outlines");
    mkdirSync(outlinesDir, { recursive: true });
    mkdirSync(sampleOutlinesDir, { recursive: true });
    const samplePath = join(sampleOutlinesDir, "sample-book.outline.json");
    writeFileSync(
      samplePath,
      `${JSON.stringify(
        {
          items: [
            {
              id: "struct:sample-book:lesson:1",
              kind: "lesson",
              children: [{ id: "struct:sample-book:chunk:1-a", kind: "chunk" }],
            },
          ],
        },
        null,
        2,
      )}\n`,
      "utf8",
    );

    assert.equal(outlinePathForBook("sample-book", { outlinesDir }), join(outlinesDir, "sample-book.outline.json"));
    assert.equal(readableOutlinePathForBook("sample-book", { outlinesDir, sampleOutlinesDir }), samplePath);
    assert.deepEqual(
      loadOutlineItems("sample-book", { outlinesDir, sampleOutlinesDir }).map((item) => item.id),
      ["struct:sample-book:lesson:1", "struct:sample-book:chunk:1-a"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
