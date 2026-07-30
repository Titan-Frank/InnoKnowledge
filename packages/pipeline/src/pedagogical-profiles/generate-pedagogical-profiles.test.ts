import assert from "node:assert/strict";
import test from "node:test";

import {
  buildModelPedagogicalProfilePrompt,
  buildSelectDomainProfilesForPedagogyQuery,
  buildUpdatePedagogicalProfileStatement,
  parseModelPedagogicalProfileResultText,
  planModelPedagogicalProfiles,
  runGeneratePedagogicalProfilesFromDatabase,
  type ModelPedagogicalProfileResult,
} from "./generate-pedagogical-profiles.js";

const profile = {
  id: "domain-profile:water-chemistry",
  node_id: "concept:water",
  domain: "chemistry",
  school_stages_json: ["primary", "senior-secondary"],
  curriculum_roles_json: ["core"],
  source_refs_json: ["ev1"],
  properties_json: { subject: "chemistry", grade_band: "grade-11", backfilled: true },
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
    profiles: [profile],
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
    profile,
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
  assert.match(prompt.user_payload, /senior-secondary/);
  assert.match(prompt.user_payload, /concept:solution/);
  assert.match(prompt.user_payload, /ev1/);
  for (const field of [
    "learning_objectives",
    "difficulty_level",
    "diagnostic_questions",
    "common_errors",
    "assessment_tasks",
    "remediation_suggestions",
    "extension_suggestions",
    "source_refs",
    "confidence",
  ]) {
    assert.match(prompt.instructions, new RegExp(field));
  }
  const required = (prompt.response_schema.schema as { required: string[] }).required;
  assert.ok(required.includes("learning_objectives"));
  assert.ok(required.includes("source_refs"));
  assert.ok(required.includes("confidence"));
  const sourceRefs = ((prompt.response_schema.schema as { properties: Record<string, Record<string, unknown>> }).properties.source_refs);
  assert.equal(sourceRefs.uniqueItems, undefined);
});

test("parses and validates model pedagogical profile JSON", () => {
  assert.deepEqual(
    parseModelPedagogicalProfileResultText(`\`\`\`json\n${JSON.stringify(generatedResult())}\n\`\`\``),
    generatedResult(),
  );
  assert.deepEqual(
    parseModelPedagogicalProfileResultText(`{${JSON.stringify(generatedResult())}`),
    generatedResult(),
  );
  assert.deepEqual(
    parseModelPedagogicalProfileResultText(`{${JSON.stringify(generatedResult())}}`),
    generatedResult(),
  );
  assert.deepEqual(
    parseModelPedagogicalProfileResultText(`{\r\n  ${JSON.stringify(generatedResult())}\r\n}`),
    generatedResult(),
  );
  assert.deepEqual(
    parseModelPedagogicalProfileResultText(JSON.stringify(JSON.stringify(generatedResult()))),
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
  assert.equal(
    parseModelPedagogicalProfileResultText(JSON.stringify({ ...generatedResult(), confidence: 86 })).confidence,
    0.86,
  );
  assert.equal(
    parseModelPedagogicalProfileResultText(JSON.stringify({ ...generatedResult(), confidence: 101 })).confidence,
    0,
  );
});

test("generates independent teaching profiles for every school stage", async () => {
  const plan = await planModelPedagogicalProfiles(planInput());

  assert.equal(plan.generatedContexts, 2);
  assert.equal(plan.rows.length, 1);
  assert.deepEqual(plan.modelFailures, []);
  const byStage = plan.rows[0]!.stage_profiles_json as Record<string, Record<string, unknown>>;
  assert.deepEqual(Object.keys(byStage), ["primary", "senior-secondary"]);
  assert.match(String((byStage.primary!.learning_objectives as string[])[0]), /primary/);
  assert.match(String((byStage["senior-secondary"]!.learning_objectives as string[])[0]), /senior-secondary/);
  assert.deepEqual((byStage.primary!.generation as Record<string, unknown>).source_refs, ["ev1"]);
  assert.equal((byStage.primary!.generation as Record<string, unknown>).review_status, "pending");
  assert.equal((byStage.primary!.generation as Record<string, unknown>).generated_from, "model_generation");
  assert.equal(typeof (byStage.primary!.generation as Record<string, unknown>).input_fingerprint, "string");
  assert.deepEqual(plan.rows[0]!.expected_stage_profiles_json, { primary: null, "senior-secondary": null });
});

test("book-scoped generation updates only the requested school stage and grade band", async () => {
  const existingPrimary = {
    school_stage: "primary",
    grade_band: "grade-5",
    ...generatedResult("primary-existing"),
    generation: { generated_from: "manual" },
  };
  const plan = await planModelPedagogicalProfiles(planInput({
    schoolStage: "senior-secondary",
    gradeBand: "grade-11",
    profiles: [{
      ...profile,
      properties_json: {
        ...profile.properties_json,
        grade_band: "grade-5",
        pedagogical_profiles_by_stage: { primary: existingPrimary },
      },
    }],
  }));

  assert.equal(plan.generatedContexts, 1);
  assert.deepEqual(Object.keys(plan.rows[0]!.stage_profiles_json), ["senior-secondary"]);
  assert.equal((plan.rows[0]!.stage_profiles_json["senior-secondary"] as Record<string, unknown>).grade_band, "grade-11");
  assert.deepEqual(plan.rows[0]!.expected_stage_profiles_json, { "senior-secondary": null });
});

test("does not overwrite legacy or approved pedagogical content", async () => {
  let calls = 0;
  const legacyPlan = await planModelPedagogicalProfiles(planInput({
    profiles: [{
      ...profile,
      properties_json: {
        ...profile.properties_json,
        pedagogical_profile: { learning_objectives: ["人工目标"] },
      },
    }],
    generateProfile: () => {
      calls += 1;
      return generatedResult();
    },
  }));
  assert.equal(calls, 0);
  assert.equal(legacyPlan.skippedProtected.length, 2);

  const approvedPlan = await planModelPedagogicalProfiles(planInput({
    profiles: [{
      ...profile,
      school_stages_json: ["primary"],
      properties_json: {
        ...profile.properties_json,
        pedagogical_profiles_by_stage: {
          primary: {
            ...generatedResult(),
            generation: { generated_from: "model_generation", review_status: "approved" },
          },
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
  assert.deepEqual(approvedPlan.skippedProtected, [`${profile.id}:primary`]);
});

test("skips unchanged generated contexts by input fingerprint", async () => {
  const first = await planModelPedagogicalProfiles(planInput());
  let calls = 0;
  const second = await planModelPedagogicalProfiles(planInput({
    profiles: [{
      ...profile,
      source_refs_json: [...profile.source_refs_json, ...first.rows[0]!.source_refs_json],
      properties_json: {
        ...profile.properties_json,
        pedagogical_profiles_by_stage: first.rows[0]!.stage_profiles_json,
      },
    }],
    generateProfile: () => {
      calls += 1;
      return generatedResult();
    },
  }));

  assert.equal(calls, 0);
  assert.equal(second.generatedContexts, 0);
  assert.equal(second.skippedExisting.length, 2);
});

test("keeps the fingerprint stable when generated source refs reorder selected evidence", async () => {
  const evidenceZero = {
    ...evidence,
    id: "ev0",
    excerpt: "零号证据只用于验证证据选择优先级。",
    locator: "p.0",
  };
  const evidenceTwo = {
    ...evidence,
    id: "ev2",
    excerpt: "二号证据由领域画像优先引用。",
    locator: "p.2",
  };
  const sourceProfile = {
    ...profile,
    school_stages_json: ["primary"],
    source_refs_json: ["ev2"],
  };
  const sourceCard = {
    ...card,
    source_refs_json: ["ev1", "ev0"],
    sections_json: [{
      title: "定义",
      section_type: "definition",
      content: ["水是一种常见物质。"],
      source_refs: ["ev1", "ev0"],
    }],
  };
  let firstEvidenceIds: string[] = [];
  const first = await planModelPedagogicalProfiles(planInput({
    profiles: [sourceProfile],
    cards: [sourceCard],
    evidence: [evidenceZero, evidence, evidenceTwo],
    maxEvidencePerContext: 2,
    generateProfile: (input: { evidence: Array<{ id: string }> }) => {
      firstEvidenceIds = input.evidence.map((row) => row.id);
      return generatedResult();
    },
  }));

  assert.deepEqual(firstEvidenceIds, ["ev1", "ev2"]);
  assert.deepEqual(first.rows[0]!.source_refs_json, ["ev1"]);

  let retryCalls = 0;
  const persistedSourceRefs = [...new Set([
    ...sourceProfile.source_refs_json,
    ...first.rows[0]!.source_refs_json,
  ])].sort();
  const second = await planModelPedagogicalProfiles(planInput({
    profiles: [{
      ...sourceProfile,
      source_refs_json: persistedSourceRefs,
      properties_json: {
        ...sourceProfile.properties_json,
        pedagogical_profiles_by_stage: first.rows[0]!.stage_profiles_json,
      },
    }],
    cards: [sourceCard],
    evidence: [evidenceZero, evidence, evidenceTwo],
    maxEvidencePerContext: 2,
    generateProfile: () => {
      retryCalls += 1;
      return generatedResult();
    },
  }));

  assert.deepEqual(persistedSourceRefs, ["ev1", "ev2"]);
  assert.equal(retryCalls, 0);
  assert.equal(second.generatedContexts, 0);
  assert.deepEqual(second.skippedExisting, [`${profile.id}:primary`]);
});

test("regenerates pending profiles when the model changes", async () => {
  const first = await planModelPedagogicalProfiles(planInput({
    profiles: [{ ...profile, school_stages_json: ["primary"] }],
  }));
  let calls = 0;
  const second = await planModelPedagogicalProfiles(planInput({
    modelName: "new-model",
    profiles: [{
      ...profile,
      school_stages_json: ["primary"],
      properties_json: {
        ...profile.properties_json,
        pedagogical_profiles_by_stage: first.rows[0]!.stage_profiles_json,
      },
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
    profiles: [{ ...profile, school_stages_json: ["primary"] }],
    generateProfile: () => ({ ...generatedResult(), source_refs: ["invented-evidence"] }),
  }));

  assert.equal(plan.generatedContexts, 0);
  assert.equal(plan.rows.length, 0);
  assert.equal(plan.modelFailures.length, 1);
  assert.match(plan.modelFailures[0]!.message, /did not cite any provided evidence/);
});

test("builds source-scoped selection and a restricted canonical update", () => {
  const select = buildSelectDomainProfilesForPedagogyQuery({ datasetId: "main", nodeId: "n1", limit: 5, bookId: "book-a" });
  assert.deepEqual(select.params, ["main", "n1", 5, "book-a"]);
  assert.match(select.sql, /world_mentions AS mention/);
  assert.match(select.sql, /evidence\.source_id = \$4/);

  const update = buildUpdatePedagogicalProfileStatement({
    dataset_id: "main",
    profile_id: "p1",
    stage_profiles_json: { primary: { school_stage: "primary" } },
    expected_stage_profiles_json: { primary: null },
    source_refs_json: ["ev1"],
    updated_at: "now",
  });
  assert.equal(update.name, "update-world-domain-profile-pedagogy");
  assert.match(update.sql, /^UPDATE world_domain_profiles AS profile/);
  assert.match(update.sql, /jsonb_each\(\$5::jsonb\)/);
  assert.match(update.sql, /IS DISTINCT FROM expected\.expected_value/);
  assert.match(update.sql, /RETURNING profile\.id/);
  assert.doesNotMatch(update.sql, /world_staging_/);
  assert.deepEqual(update.params.slice(0, 2), ["main", "p1"]);
});

test("runs pedagogical profile generation through database statements", async () => {
  const executed: string[] = [];
  const output = await runGeneratePedagogicalProfilesFromDatabase({
    datasetId: "main",
    bookId: "book-a",
    modelName: "test-model",
    now: "now",
    query: (statement) => {
      if (statement.name === "select-domain-profiles-for-pedagogy") return [{ ...profile, school_stages_json: ["primary"] }];
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
      return [{ id: profile.id }];
    },
  });

  assert.equal(output.selected, 1);
  assert.equal(output.generated, 1);
  assert.equal(output.updated_profiles, 1);
  assert.equal(output.failed_model_generation, 0);
  assert.deepEqual(output.read_statements, [
    "select-domain-profiles-for-pedagogy",
    "select-nodes-for-pedagogy",
    "select-node-cards-for-pedagogy",
    "select-mentions-for-pedagogy",
    "select-evidence-for-pedagogy",
    "select-relations-for-pedagogy",
  ]);
  assert.deepEqual(output.statements, ["update-world-domain-profile-pedagogy"]);
  assert.deepEqual(output.executedStatements, executed);
});

test("refuses to overwrite a profile changed while model generation was running", async () => {
  await assert.rejects(
    runGeneratePedagogicalProfilesFromDatabase({
      datasetId: "main",
      schoolStage: "primary",
      modelName: "test-model",
      now: "now",
      query: (statement) => {
        if (statement.name === "select-domain-profiles-for-pedagogy") return [{ ...profile, school_stages_json: ["primary"] }];
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
