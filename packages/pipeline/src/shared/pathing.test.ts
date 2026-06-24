import assert from "node:assert/strict";
import test from "node:test";

import {
  anchorTokenVariants,
  makeDomainProfileId,
  makeEdgeId,
  makeLessonRunId,
  makeNodeCardId,
  makeProfileId,
  makeStableSuffixWithLength,
  normalizeTerm,
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

test("text normalization and path token handling mirror Python helpers", () => {
  assert.equal(normalizeTerm("  Water   Cycle\n "), "water cycle");
  assert.equal(safePathToken("  ../第 1 课: water cycle  "), "1__water__cycle");
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
