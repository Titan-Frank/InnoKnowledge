import assert from "node:assert/strict";
import test from "node:test";

import { countModifiedCards, normalizeNodeCardRows, normalizeNodeCardSections } from "./normalize-cards.js";

test("normalizes node card sections like Python normalize_cards", () => {
  const result = normalizeNodeCardSections({
    node_id: "n1",
    sections_json: [
      { content: [" a ", "", 3] },
      { id: "known", title: "", section_type: "", content: ["ok"] },
      "not-a-section",
    ],
  });

  assert.deepEqual(result, {
    node_id: "n1",
    modified: true,
    sections_json: [
      { id: "section-0", title: "section-0", section_type: "other", content: ["a", "3"] },
      { id: "known", title: "known", section_type: "other", content: ["ok"] },
      "not-a-section",
    ],
  });
});

test("leaves already-normalized sections unchanged", () => {
  const input = {
    node_id: "n1",
    sections_json: [{ id: "definition", title: "Definition", section_type: "definition", content: ["clean"] }],
  };
  assert.deepEqual(normalizeNodeCardSections(input), {
    node_id: "n1",
    modified: false,
    sections_json: [{ id: "definition", title: "Definition", section_type: "definition", content: ["clean"] }],
  });
});

test("counts modified cards and treats non-list sections as empty without marking modified", () => {
  const cards = [
    { node_id: "n1", sections_json: [{ content: [" x "] }] },
    { node_id: "n2", sections_json: [] },
    { node_id: "n3", sections_json: null },
  ];

  assert.equal(countModifiedCards(cards), 1);
  assert.deepEqual(normalizeNodeCardRows(cards)[2], {
    node_id: "n3",
    sections_json: [],
    modified: false,
  });
});
