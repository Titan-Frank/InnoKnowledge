import assert from "node:assert/strict";
import test from "node:test";

import {
  buildModelPedagogicalProfilePrompt,
  buildSelectCurriculumProjectionsForPedagogyQuery,
  buildUpdatePedagogicalProfileStatement,
  parseModelPedagogicalProfileResultText,
  planModelPedagogicalProfiles,
  runGeneratePedagogicalProfilesFromDatabase,
  type ModelPedagogicalProfileResult,
  type PedagogicalCurriculumProjectionRow,
} from "./generate-pedagogical-profiles.js";

const primaryProjection: PedagogicalCurriculumProjectionRow = {
  id: "curriculum-projection:water-chemistry-primary",
  node_id: "concept:water",
  domain: "chemistry",
  curriculum_id: "cn-basic-education",
  school_stage: "primary",
  grade_band: "grade-5",
  curriculum_roles_json: ["core"],
  source_refs_json: ["ev1"],
  properties_json: { subject: "chemistry", backfilled: true },
};

const seniorProjection: PedagogicalCurriculumProjectionRow = {
  ...primaryProjection,
  id: "curriculum-projection:water-chemistry-senior",
  school_stage: "senior-secondary",
  grade_band: "grade-11",
};

const node = {
  id: "concept:water",
  name: "水",
  kind: "concept",
  subkind: null,
  definition: "水是一种常见物质。",
  aliases_json: ["H2O"],
  domains_json: ["chemistry"],
  learning_mode_json: ["conceptual"],
  properties_json: { semantic_core: { core_claims: ["水具有特定组成。"] } },
};

const relatedNode = {
  ...node,
  id: "concept:solution",
  name: "溶液",
  definition: "溶液是均一、稳定的混合物。",
};

const card = {
  node_id: node.id,
  title: "水",
  summary: "水是常见的化学物质。",
  source_refs_json: ["ev1"],
  sections_json: [
    { title: "定义", section_type: "definition", content: ["水是一种常见物质。"], source_refs: ["ev1"] },
  ],
};

const mention = {
  target_id: node.id,
  source_id: "book-a",
  anchor_ref: "lesson:1",
  source_refs_json: ["ev1"],
};

const evidence = {
  id: "ev1",
  source_id: "book-a",
  anchor_ref: "lesson:1",
  excerpt: "水是一种常见物质，可以作为溶剂。",
  locator: "p.1",
  modality: "text",
  normalized_claims_json: ["水是一种常见物质。"],
};

const relation = {
  id: "edge:water-solution",
  type: "related_to",
  from_id: node.id,
  to_id: relatedNode.id,
  source_refs_json: ["ev1"],
};

function generatedResult(stage = ""): ModelPedagogicalProfileResult {
  return {
    learning_objectives: [`能够说明水的基本特征${stage}`],
    difficulty_level: "basic",
    diagnostic_questions: ["水与溶液有什么区别？"],
    common_errors: ["把水和所有透明液体混为一谈。"],
    assessment_tasks: ["根据证据判断给定物质是否为水。"],
    remediation_suggestions: ["回到定义和证据片段逐项核对。"],
    extension_suggestions: ["比较水在不同过程中的作用。"],
    source_refs: ["ev1"],
    confidence: 0.86,
  };
}

function planInput(overrides: Record<string, unknown> = {}) {
  return {
    datasetId: "main",
    projections: [primaryProjection, seniorProjection],
    nodes: [node, relatedNode],
    cards: [card],
    mentions: [mention],
    evidence: [evidence],
    relations: [relation],
    modelName: "test-model",
    now: "2026-07-12T00:00:00+00:00",
    generateProfile: (input: { schoolStage: string }) => generatedResult(input.schoolStage),
    ...overrides,
  };
}

test("builds an evidence-grounded pedagogical profile prompt", () => {
  const prompt = buildModelPedagogicalProfilePrompt({
    datasetId: "main",
    projection: seniorProjection,
    schoolStage: "senior-secondary",
    gradeBand: "grade-11",
    node,
    card,
    relations: [relation],
    relatedNodes: [relatedNode],
    evidence: [evidence],
  });

  assert.match(prompt.instructions, /教学画像生成器/);
  assert.match(prompt.instructions, /不得补充无证据支持的学科事实/);
  assert.match(prompt.user_payload, /curriculum-projection:water-chemistry-senior/);
  assert.match(prompt.user_payload, /senior-secondary/);
  assert.match(prompt.user_payload, /concept:solution/);
  assert.match(prompt.user_payload, /ev1/);
  assert.match(prompt.user_payload, /相关/);
  const required = (prompt.response_schema.schema as { required: string[] }).required;
  assert.ok(required.includes("learning_objectives"));
  assert.ok(required.includes("source_refs"));
  assert.ok(required.includes("confidence"));
  const sourceRefs = (prompt.response_schema.schema as { properties: Record<string, Record<string, unknown>> })
    .properties.source_refs;
  assert.equal(sourceRefs.uniqueItems, undefined);
});

test("parses and validates model pedagogical profile JSON", () => {
  assert.deepEqual(
    parseModelPedagogicalProfileResultText(`\`\`\`json\n${JSON.stringify(generatedResult())}\n\`\`\``),
    generatedResult(),
  );
  assert.throws(
    () => parseModelPedagogicalProfileResultText(JSON.stringify({ ...generatedResult(), difficulty_level: "impossible" })),
    /invalid difficulty_level/,
  );
  assert.throws(
    () => parseModelPedagogicalProfileResultText(JSON.stringify({ ...generatedResult(), assessment_tasks: [] })),
    /assessment_tasks.*at least one/,
  );
  assert.equal(
    parseModelPedagogicalProfileResultText(JSON.stringify({ ...generatedResult(), difficulty_level: "" })).difficulty_level,
    "intermediate",
  );
  assert.equal(parseModelPedagogicalProfileResultText(JSON.stringify({ ...generatedResult(), confidence: 86 })).confidence, 0.86);
  assert.equal(parseModelPedagogicalProfileResultText(JSON.stringify({ ...generatedResult(), confidence: 101 })).confidence, 0);
});

test("generates one teaching profile per curriculum projection", async () => {
  const plan = await planModelPedagogicalProfiles(planInput());

  assert.equal(plan.generatedContexts, 2);
  assert.equal(plan.rows.length, 2);
  assert.deepEqual(plan.modelFailures, []);
  const primary = plan.rows.find((row) => row.projection_id === primaryProjection.id)!;
  const senior = plan.rows.find((row) => row.projection_id === seniorProjection.id)!;
  assert.match(String(primary.pedagogical_profile_json.learning_objectives), /primary/);
  assert.match(String(senior.pedagogical_profile_json.learning_objectives), /senior-secondary/);
  assert.equal(primary.pedagogical_profile_json.school_stage, "primary");
  assert.equal(senior.pedagogical_profile_json.grade_band, "grade-11");
  assert.deepEqual((primary.pedagogical_profile_json.generation as Record<string, unknown>).source_refs, ["ev1"]);
  assert.equal((primary.pedagogical_profile_json.generation as Record<string, unknown>).review_status, "pending");
  assert.equal(primary.expected_pedagogical_profile_json, null);
});

test("school-stage generation selects only the matching projection and grade band", async () => {
  const plan = await planModelPedagogicalProfiles(planInput({
    schoolStage: "senior-secondary",
    gradeBand: "grade-12",
  }));

  assert.equal(plan.generatedContexts, 1);
  assert.equal(plan.rows[0]!.projection_id, seniorProjection.id);
  assert.equal(plan.rows[0]!.pedagogical_profile_json.grade_band, "grade-12");
  assert.deepEqual(plan.skippedMissingStage, [`${primaryProjection.id}:senior-secondary`]);
});

test("does not overwrite manual or approved teaching profiles", async () => {
  let calls = 0;
  const manualPlan = await planModelPedagogicalProfiles(planInput({
    projections: [{
      ...primaryProjection,
      properties_json: { pedagogical_profile: { learning_objectives: ["人工目标"] } },
    }],
    generateProfile: () => {
      calls += 1;
      return generatedResult();
    },
  }));
  assert.equal(calls, 0);
  assert.deepEqual(manualPlan.skippedProtected, [`${primaryProjection.id}:primary`]);

  const approvedPlan = await planModelPedagogicalProfiles(planInput({
    projections: [{
      ...primaryProjection,
      properties_json: {
        pedagogical_profile: {
          ...generatedResult(),
          generation: { generated_from: "model_generation", review_status: "approved" },
        },
      },
    }],
    overwriteGenerated: true,
    generateProfile: () => {
      calls += 1;
      return generatedResult();
    },
  }));
  assert.equal(calls, 0);
  assert.deepEqual(approvedPlan.skippedProtected, [`${primaryProjection.id}:primary`]);
});

test("skips an unchanged generated projection by its input fingerprint", async () => {
  const first = await planModelPedagogicalProfiles(planInput({ projections: [primaryProjection] }));
  let calls = 0;
  const second = await planModelPedagogicalProfiles(planInput({
    projections: [{
      ...primaryProjection,
      source_refs_json: [...(primaryProjection.source_refs_json as string[]), ...first.rows[0]!.source_refs_json],
      properties_json: { pedagogical_profile: first.rows[0]!.pedagogical_profile_json },
    }],
    generateProfile: () => {
      calls += 1;
      return generatedResult();
    },
  }));

  assert.equal(calls, 0);
  assert.equal(second.generatedContexts, 0);
  assert.deepEqual(second.skippedExisting, [`${primaryProjection.id}:primary`]);
});

test("regenerates a pending profile when the model changes", async () => {
  const first = await planModelPedagogicalProfiles(planInput({ projections: [primaryProjection] }));
  let calls = 0;
  const second = await planModelPedagogicalProfiles(planInput({
    modelName: "new-model",
    projections: [{
      ...primaryProjection,
      properties_json: { pedagogical_profile: first.rows[0]!.pedagogical_profile_json },
    }],
    generateProfile: () => {
      calls += 1;
      return generatedResult();
    },
  }));

  assert.equal(calls, 1);
  assert.equal(second.generatedContexts, 1);
});

test("rejects model citations outside the supplied evidence", async () => {
  const plan = await planModelPedagogicalProfiles(planInput({
    projections: [primaryProjection],
    generateProfile: () => ({ ...generatedResult(), source_refs: ["invented-evidence"] }),
  }));

  assert.equal(plan.generatedContexts, 0);
  assert.equal(plan.rows.length, 0);
  assert.equal(plan.modelFailures.length, 1);
  assert.match(plan.modelFailures[0]!.message, /did not cite any provided evidence/);
});

test("builds source-scoped selection and a restricted canonical update", () => {
  const select = buildSelectCurriculumProjectionsForPedagogyQuery({
    datasetId: "main",
    nodeId: "n1",
    limit: 5,
    bookId: "book-a",
  });
  assert.deepEqual(select.params, ["main", "n1", 5, "book-a"]);
  assert.match(select.sql, /world_curriculum_projections AS p/);
  assert.match(select.sql, /world_mentions AS mention/);
  assert.match(select.sql, /evidence\.source_id = \$4/);

  const update = buildUpdatePedagogicalProfileStatement({
    dataset_id: "main",
    projection_id: "p1",
    pedagogical_profile_json: { school_stage: "primary" },
    expected_pedagogical_profile_json: null,
    source_refs_json: ["ev1"],
    updated_at: "now",
  });
  assert.equal(update.name, "update-world-curriculum-projection-pedagogy");
  assert.match(update.sql, /^UPDATE world_curriculum_projections AS projection/);
  assert.match(update.sql, /pedagogical_profile/);
  assert.match(update.sql, /IS NOT DISTINCT FROM \$5::jsonb/);
  assert.match(update.sql, /RETURNING projection\.id/);
  assert.doesNotMatch(update.sql, /world_staging_/);
  assert.deepEqual(update.params.slice(0, 2), ["main", "p1"]);
});

test("runs teaching profile generation through database statements", async () => {
  const executed: string[] = [];
  const output = await runGeneratePedagogicalProfilesFromDatabase({
    datasetId: "main",
    bookId: "book-a",
    modelName: "test-model",
    now: "now",
    query: (statement) => {
      if (statement.name === "select-curriculum-projections-for-pedagogy") return [primaryProjection];
      if (statement.name === "select-nodes-for-pedagogy") return [node, relatedNode];
      if (statement.name === "select-node-cards-for-pedagogy") return [card];
      if (statement.name === "select-mentions-for-pedagogy") return [mention];
      if (statement.name === "select-evidence-for-pedagogy") return [evidence];
      if (statement.name === "select-relations-for-pedagogy") return [relation];
      return [];
    },
    generateProfile: () => generatedResult(),
    executeStatement: (statement) => {
      executed.push(statement.name);
      return [{ id: primaryProjection.id }];
    },
  });

  assert.equal(output.selected, 1);
  assert.equal(output.generated, 1);
  assert.equal(output.updated_projections, 1);
  assert.equal(output.failed_model_generation, 0);
  assert.deepEqual(output.read_statements, [
    "select-curriculum-projections-for-pedagogy",
    "select-nodes-for-pedagogy",
    "select-node-cards-for-pedagogy",
    "select-mentions-for-pedagogy",
    "select-evidence-for-pedagogy",
    "select-relations-for-pedagogy",
  ]);
  assert.deepEqual(output.statements, ["update-world-curriculum-projection-pedagogy"]);
  assert.deepEqual(output.executedStatements, executed);
});

test("refuses to overwrite a projection changed while model generation was running", async () => {
  await assert.rejects(
    runGeneratePedagogicalProfilesFromDatabase({
      datasetId: "main",
      schoolStage: "primary",
      modelName: "test-model",
      now: "now",
      query: (statement) => {
        if (statement.name === "select-curriculum-projections-for-pedagogy") return [primaryProjection];
        if (statement.name === "select-nodes-for-pedagogy") return [node, relatedNode];
        if (statement.name === "select-node-cards-for-pedagogy") return [card];
        if (statement.name === "select-mentions-for-pedagogy") return [mention];
        if (statement.name === "select-evidence-for-pedagogy") return [evidence];
        if (statement.name === "select-relations-for-pedagogy") return [relation];
        return [];
      },
      generateProfile: () => generatedResult(),
      executeStatement: () => [],
    }),
    /changed while model generation was running/,
  );
});
