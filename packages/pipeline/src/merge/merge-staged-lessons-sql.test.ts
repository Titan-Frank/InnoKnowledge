import assert from "node:assert/strict";
import test from "node:test";

import { planStagedLessonsMerge } from "./merge-staged-lesson.js";
import { buildMergeStagedLessonsSqlPlan } from "./merge-staged-lessons-sql.js";
import { planNodeTerms } from "../shared/node-terms.js";

test("builds merge SQL statements in Python-compatible order without executing them", () => {
  const mergePlan = planStagedLessonsMerge({
    datasetId: "main",
    mergeRunId: "merge:1",
    canonicalNodes: [],
    lessons: [
      {
        lesson_run_id: "lesson-run:1",
        staged: {
          nodes: [
            {
              raw_node_id: "raw-water",
              name: "Water",
              kind: "concept",
              subkind: null,
              definition: "Water is a substance.",
              aliases_json: ["H2O"],
              domains_json: ["chemistry"],
              knowledge_form_json: ["propositional"],
              learning_mode_json: ["conceptual"],
              scope: "domain-specific",
              properties_json: { semantic_key: "chem:water" },
              external_ids_json: {},
              tags_json: ["substance"],
              semantic_key: "chem:water",
              embedding: [1, 0],
              created_at: "node-created",
              notes: "",
            },
          ],
          evidence: [
            {
              raw_evidence_id: "raw-evidence:1",
              source_type: "textbook",
              source_id: "chem",
              anchor_ref: "struct:chem:chunk:1",
              source_path: "data/full.md",
              page_start: 1,
              page_end: 1,
              excerpt: "Water is a substance.",
              locator: "p1",
              modality: "text",
              extraction_method: "llm",
              normalized_claims_json: ["water is substance"],
              properties_json: {},
              created_at: "evidence-created",
            },
          ],
          edges: [
            {
              from_raw_node_id: "raw-water",
              to_raw_node_id: "raw-water",
              type: "related_to",
              directionality: "undirected",
              confidence: 0.8,
              source_refs_json: ["raw-evidence:1"],
              properties_json: {},
              created_at: "edge-created",
              notes: "",
            },
          ],
          domain_profiles: [
            {
              raw_node_id: "raw-water",
              domain: "chemistry",
              schema_id: "domain:chemistry:v1",
              schema_version: "1.0",
              domain_role: "substance",
              source_refs_json: ["raw-evidence:1"],
              properties_json: {},
              created_at: "profile-created",
              notes: "",
            },
          ],
          mentions: [
            {
              raw_mention_id: "raw-mention:1",
              source_type: "textbook",
              source_id: "chem",
              anchor_ref: "struct:chem:chunk:1",
              target_type: "node",
              target_raw_id: "raw-water",
              role: "defines",
              source_refs_json: ["raw-evidence:1"],
              confidence: 0.7,
              properties_json: {},
              created_at: "mention-created",
            },
          ],
          node_cards: [
            {
              raw_node_id: "raw-water",
              raw_card_id: "card:water",
              title: "Water",
              summary: "Water summary",
              source_refs_json: ["raw-evidence:1"],
              sections_json: [{ id: "definition", text: "Water is a substance.", source_refs: ["raw-evidence:1"] }],
              properties_json: {},
              created_at: "card-created",
            },
          ],
        },
      },
    ],
    now: "now",
  });

  const sqlPlan = buildMergeStagedLessonsSqlPlan(mergePlan, { datasetId: "main", now: "now" });

  assert.deepEqual(
    sqlPlan.statements.slice(0, 6).map((statement) => statement.name),
    [
      "upsert-world-merge-run-start",
      "mark-world-lesson-run-merging",
      "upsert-world-node",
      "upsert-world-canonical-node-map",
      "insert-world-evidence",
      "upsert-world-edge",
    ],
  );
  assert.deepEqual(sqlPlan.statements.at(-2)?.name, "mark-world-lesson-run-merged");
  assert.deepEqual(sqlPlan.statements.at(-1)?.name, "complete-world-merge-run");

  const nodeStatement = sqlPlan.statements.find((statement) => statement.name === "upsert-world-node");
  assert.ok(nodeStatement);
  assert.match(nodeStatement.sql, /INSERT INTO world_nodes/);
  assert.match(nodeStatement.sql, /\$7::jsonb/);
  assert.match(nodeStatement.sql, /embedding = COALESCE\(EXCLUDED\.embedding, world_nodes\.embedding\)/);
  assert.equal(nodeStatement.params[0], "main");
  assert.equal(nodeStatement.params[1], mergePlan.lessons[0]?.nodes[0]?.canonical_node_id);
  assert.deepEqual(nodeStatement.params[6], ["H2O"]);
  assert.equal(nodeStatement.params[14], "[1,0]");

  const mapStatement = sqlPlan.statements.find((statement) => statement.name === "upsert-world-canonical-node-map");
  assert.ok(mapStatement);
  assert.match(mapStatement.sql, /\$8::jsonb/);
  assert.equal(mapStatement.params[3], "raw-water");
  assert.equal(mapStatement.params[5], "created");

  const evidenceStatement = sqlPlan.statements.find((statement) => statement.name === "insert-world-evidence");
  assert.ok(evidenceStatement);
  assert.match(evidenceStatement.sql, /ON CONFLICT \(dataset_id, id\) DO NOTHING/);
  assert.match(evidenceStatement.sql, /\$13::jsonb/);
  assert.deepEqual(evidenceStatement.params[12], ["water is substance"]);

  const edgeStatement = sqlPlan.statements.find((statement) => statement.name === "upsert-world-edge");
  assert.ok(edgeStatement);
  assert.match(edgeStatement.sql, /GREATEST\(world_edges\.confidence, EXCLUDED\.confidence\)/);
  assert.deepEqual(edgeStatement.params[7], [mergePlan.lessons[0]?.evidence_id_by_raw["raw-evidence:1"]]);

  const linkDelete = sqlPlan.statements.find((statement) => statement.name.startsWith("delete-evidence-links-edge-"));
  const linkInsert = sqlPlan.statements.find((statement) => statement.name.startsWith("upsert-evidence-link-edge-"));
  assert.ok(linkDelete);
  assert.ok(linkInsert);
  assert.equal(linkDelete.sql, "DELETE FROM world_evidence_links WHERE dataset_id = $1 AND owner_type = $2 AND owner_id = $3");
  assert.match(linkInsert.sql, /VALUES \(\$1, \$2, \$3, \$4, \$5\)/);
  assert.deepEqual(linkInsert.params.slice(0, 3), ["main", "edge", edgeStatement.params[1]]);

  const completeStatement = sqlPlan.statements.at(-1);
  assert.ok(completeStatement);
  assert.deepEqual(completeStatement.params, [mergePlan.stats, "now", "main", "merge:1"]);
});

test("builds no-op merge SQL plan without merge run statements", () => {
  const mergePlan = planStagedLessonsMerge({
    datasetId: "main",
    canonicalNodes: [],
    lessons: [],
    now: "now",
  });

  assert.deepEqual(buildMergeStagedLessonsSqlPlan(mergePlan, { datasetId: "main", now: "now" }), { statements: [] });
});

test("places node term rebuild before completing merge run like Python", () => {
  const mergePlan = planStagedLessonsMerge({
    datasetId: "main",
    mergeRunId: "merge:1",
    canonicalNodes: [],
    lessons: [
      {
        lesson_run_id: "lesson-run:1",
        staged: {
          nodes: [
            {
              raw_node_id: "raw-water",
              name: "Water",
              kind: "concept",
              aliases_json: [],
              domains_json: [],
              knowledge_form_json: [],
              learning_mode_json: [],
              properties_json: {},
              external_ids_json: {},
              tags_json: [],
              created_at: "node-created",
            },
          ],
        },
      },
    ],
    now: "now",
  });
  const nodeTerms = planNodeTerms("main", [{ id: "concept:auto-water", name: "Water", aliases_json: [], tags_json: [] }]);

  const statementNames = buildMergeStagedLessonsSqlPlan(mergePlan, {
    datasetId: "main",
    now: "now",
    nodeTermRows: nodeTerms.rows,
  }).statements.map((statement) => statement.name);

  assert.equal(statementNames.at(-3), "delete-world-node-terms");
  assert.equal(statementNames.at(-2), "upsert-world-node-terms");
  assert.equal(statementNames.at(-1), "complete-world-merge-run");
});
