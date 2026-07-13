import assert from "node:assert/strict";
import test from "node:test";

import {
  buildTemplateInstructionBlock,
  listTextbookExtractionTemplateSummaries,
  resolveExtractionTemplate,
  templatePreferredEdgeTypes,
} from "./extraction-template.js";

test("loads textbook extraction templates from schemas", () => {
  const summaries = listTextbookExtractionTemplateSummaries();
  const ids = summaries.map((item) => item.id);

  assert.ok(ids.includes("textbook/physics"));
  assert.ok(ids.includes("textbook/chemistry"));
  assert.ok(ids.includes("textbook/biology"));
  assert.ok(ids.includes("textbook/general"));
});

test("selects subject-specific extraction templates", () => {
  assert.equal(resolveExtractionTemplate({ subject: "physics" }).id, "textbook/physics");
  assert.equal(resolveExtractionTemplate({ subject: "chemistry" }).id, "textbook/chemistry");
  assert.equal(resolveExtractionTemplate({ subject: "biology" }).id, "textbook/biology");
  assert.equal(resolveExtractionTemplate({ subject: "general" }).id, "textbook/general");
  assert.equal(resolveExtractionTemplate({ bookId: "high-school-phys-volume-1" }).id, "textbook/physics");
});

test("renders template prompt contract and preferred relation set", () => {
  const template = resolveExtractionTemplate({ templateId: "physics" });
  const block = buildTemplateInstructionBlock(template, "node_evidence");

  assert.match(block, /物理教材抽取模板/);
  assert.match(block, /物理量/);
  assert.match(block, /node.id/);
  assert.match(block, /node_labels/);
  assert.deepEqual(templatePreferredEdgeTypes(template), [
    "has_property",
    "uses",
    "produces",
    "depends_on",
    "prerequisite_for",
    "causes",
    "affects",
    "represents",
    "formalizes",
    "applies_to",
    "models",
    "part_of",
    "contains",
    "related_to",
  ]);
});
