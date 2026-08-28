import assert from "node:assert/strict";
import test from "node:test";

import { classifyOutlineContent, extractionPolicyForContentRole } from "./content-role.js";

test("classifies summaries, assessments, knowledge, and excluded matter", () => {
  assert.equal(classifyOutlineContent({ kind: "lesson", title: "本章小结" }), "summary");
  assert.equal(classifyOutlineContent({ kind: "lesson", title: "归纳总结" }), "summary");
  assert.equal(classifyOutlineContent({ kind: "lesson", title: "复习要点" }), "summary");
  assert.equal(classifyOutlineContent({ kind: "lesson", title: "复习题" }), "assessment");
  assert.equal(classifyOutlineContent({ kind: "lesson", title: "课后练习与作业" }), "assessment");
  assert.equal(classifyOutlineContent({ kind: "lesson", title: "Wireshark 实验" }), "knowledge");
  assert.equal(classifyOutlineContent({ kind: "lesson", title: "参考文献" }), "excluded");
});

test("keeps assessment content on an existing-node-only policy", () => {
  assert.equal(extractionPolicyForContentRole("summary"), "canonical_knowledge");
  assert.equal(extractionPolicyForContentRole("assessment"), "existing_nodes_only");
});
