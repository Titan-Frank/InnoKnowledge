import assert from "node:assert/strict";
import test from "node:test";

import { repairNodeBodyMediaFromDatabase } from "./repair-node-body-media.js";

test("repairs evidence-backed node body media refs and leaves unresolved images for strict QA", async () => {
  const writes: unknown[][] = [];
  const output = await repairNodeBodyMediaFromDatabase({
    datasetId: "main",
    now: "now",
    query: (statement) => {
      if (statement.name === "select-node-bodies-for-media-repair") return [
        {
          node_id: "node:repairable",
          content: "![triangle](images/triangle.jpg)",
          media_refs_json: [],
          source_refs_json: ["evidence:image"],
        },
        {
          node_id: "node:unresolved",
          content: "![invented](images/invented.jpg)",
          media_refs_json: [],
          source_refs_json: ["evidence:text"],
        },
      ];
      if (statement.name === "select-evidence-for-body-media-repair") return [
        {
          id: "evidence:image",
          excerpt: "![](images/triangle.jpg)",
          modality: "image",
          properties_json: { path: "images/triangle.jpg" },
        },
        { id: "evidence:text", excerpt: "text", modality: "text", properties_json: {} },
      ];
      return [];
    },
    executeStatement: (statement) => {
      writes.push(statement.params);
      return [{ node_id: statement.params[1] }];
    },
  });

  assert.equal(output.repaired, 1);
  assert.deepEqual(output.unresolved, [{ node_id: "node:unresolved", refs: ["images/invented.jpg"] }]);
  assert.deepEqual(writes[0]?.[3], [{ evidence_id: "evidence:image", path: "images/triangle.jpg" }]);
});
