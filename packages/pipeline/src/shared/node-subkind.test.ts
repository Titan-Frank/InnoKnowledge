import assert from "node:assert/strict";
import test from "node:test";

import { addNodeSubkindClassification, choosePrimarySubkind, normalizeNodeSubkind } from "./node-subkind.js";

test("normalizes Chinese subkind labels into stable codes", () => {
  assert.deepEqual(normalizeNodeSubkind("rule", "物理定律"), {
    primary: "physical_law",
    subkinds: ["physical_law"],
    rawSubkinds: ["物理定律"],
  });
  assert.deepEqual(normalizeNodeSubkind("rule", "circuit_law"), {
    primary: "circuit_law",
    subkinds: ["circuit_law"],
    rawSubkinds: [],
  });
  assert.deepEqual(normalizeNodeSubkind("rule", "未知中文分类"), {
    primary: null,
    subkinds: [],
    rawSubkinds: ["未知中文分类"],
  });
});

test("adds subkind classifications without losing existing properties", () => {
  assert.deepEqual(addNodeSubkindClassification({ semantic_core: { conditions: ["A"] } }, normalizeNodeSubkind("rule", "物理规律")), {
    semantic_core: { conditions: ["A"] },
    classifications: {
      subkinds: ["physical_law"],
      raw_subkinds: ["物理规律"],
    },
  });
});

test("chooses a specific stable subkind before generic labels", () => {
  assert.equal(choosePrimarySubkind("definition", "natural_resource"), "natural_resource");
  assert.equal(choosePrimarySubkind("physical_law", "circuit_law"), "physical_law");
  assert.equal(choosePrimarySubkind(null, "物理定律"), "physical_law");
});
