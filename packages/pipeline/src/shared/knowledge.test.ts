import assert from "node:assert/strict";
import test from "node:test";

import {
  bookIdFromAnchor,
  cosineSimilarity,
  inferLearningModes,
  makeCanonicalNodeId,
  makeEvidenceId,
  makeMentionId,
  makeMergeRunId,
  makeQueryId,
  mergeJsonObjects,
  mergeTextBlocks,
  mergeUniqueStrings,
  normalizeLearningModes,
  normalizeTextbookSourceId,
  requireValidEdgeType,
  stripTextbookSourcePrefix,
} from "./knowledge.js";

test("knowledge ids match Python knowledge_store_common", () => {
  assert.equal(makeQueryId("struct:chem-grade8:lesson:1-1-1", "water cycle"), "query:94b78fee86e9");
  assert.equal(makeMergeRunId("main", ["lesson-run:b", "lesson-run:a"]), "merge:5d75b0d0d338");
  assert.equal(makeCanonicalNodeId("concept", " Water   Cycle "), "concept:auto-2a88a042df94");
  assert.equal(makeCanonicalNodeId("entity", "H2O", "chemical-substance"), "entity/chemical-substance:auto-2e4bc3aa08d1");
  assert.equal(makeEvidenceId("lesson-run:1", "raw:2", "struct:book:chunk:3", " excerpt "), "evidence:auto-51f6c122baa4");
  assert.equal(makeMentionId("lesson-run:1", "raw:2", "node", "concept:auto-x"), "mention:auto-79570bb3924d");
});

test("learning mode helpers match Python behavior", () => {
  assert.deepEqual(inferLearningModes("method"), ["procedural"]);
  assert.deepEqual(inferLearningModes("representation"), ["factual", "conceptual"]);
  assert.deepEqual(inferLearningModes("property"), ["factual", "conceptual"]);
  assert.deepEqual(inferLearningModes("entity"), ["factual"]);
  assert.deepEqual(inferLearningModes("event"), ["factual"]);
  assert.deepEqual(inferLearningModes("resource"), ["factual"]);
  assert.deepEqual(inferLearningModes("concept"), ["conceptual"]);
  assert.deepEqual(inferLearningModes(null), ["conceptual"]);
  assert.deepEqual(normalizeLearningModes([], "method"), ["procedural"]);
  assert.deepEqual(normalizeLearningModes(["factual", "bad", "factual", "procedural"], "concept"), ["factual", "procedural"]);
});

test("merge helpers match Python behavior", () => {
  assert.deepEqual(mergeUniqueStrings([" a ", "b", "", "a"], null, ["b", " c ", 3]), ["a", "b", "c"]);
  assert.equal(mergeTextBlocks(" alpha ", "", "beta", "alpha"), "alpha\n\nbeta");
  assert.deepEqual(
    mergeJsonObjects(
      { a: "", b: ["x", "y"], c: { d: "" }, e: "first" },
      { a: "new", b: ["y", "z", 2], c: { d: "inner" }, e: "second" },
    ),
    { a: "new", b: ["x", "y", "z"], c: { d: "inner" }, e: "first\n\nsecond" },
  );
});

test("validation, source, and vector helpers match Python behavior", () => {
  assert.equal(requireValidEdgeType("is_a"), "is_a");
  assert.throws(
    () => requireValidEdgeType("bad_edge"),
    /Invalid edge type 'bad_edge'\. Allowed values: about, affects, causes, contains, depends_on, has_property, instance_of, is_a, part_of, prerequisite_for, produces, related_to, represents, same_as, uses/,
  );
  assert.equal(cosineSimilarity([1, 2, 3], [4, 5, 6]), 0.9746318461970762);
  assert.equal(cosineSimilarity([1, 2], [1]), 0);
  assert.equal(cosineSimilarity([0, 0], [1, 2]), 0);
  assert.equal(bookIdFromAnchor("struct:chem-grade8:lesson:1-1-1"), "chem-grade8");
  assert.equal(stripTextbookSourcePrefix("textbook:chem-grade8"), "chem-grade8");
  assert.equal(normalizeTextbookSourceId("textbook", "textbook:wrong", "struct:chem-grade8:lesson:1-1-1"), "chem-grade8");
  assert.equal(normalizeTextbookSourceId("textbook", "textbook:wrong", null, { expectedBookId: "expected" }), "expected");
  assert.equal(normalizeTextbookSourceId("paper", "textbook:chem-grade8", null), "textbook:chem-grade8");
});
