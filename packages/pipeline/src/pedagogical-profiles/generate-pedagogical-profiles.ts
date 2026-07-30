import { createHash } from "node:crypto";

import { parseModelJsonObject } from "../shared/model-json.js";
import { VALID_SCHOOL_STAGES } from "../shared/knowledge.js";
import type { SqlStatement } from "../staging/staging-sql.js";

type RawRecord = Record<string, unknown>;

const DIFFICULTY_LEVELS = new Set(["introductory", "basic", "intermediate", "advanced", "expert"]);
const PROMPT_VERSION = "pedagogical-profile-v2";
const MODEL_GENERATED_FROM = "model_generation";

export type PedagogicalDomainProfileRow = {
  id: string;
  node_id: string;
  domain: string;
  school_stages_json?: unknown;
  curriculum_roles_json?: unknown;
  source_refs_json?: unknown;
  properties_json?: unknown;
};

export type PedagogicalNodeRow = {
  id: string;
  name: string;
  kind: string;
  subkind?: string | null;
  definition: string;
  aliases_json?: unknown;
  domains_json?: unknown;
  learning_mode_json?: unknown;
  properties_json?: unknown;
};

export type PedagogicalCardRow = {
  node_id: string;
  title?: string | null;
  summary?: string | null;
  source_refs_json?: unknown;
  sections_json?: unknown;
};

export type PedagogicalMentionRow = {
  target_id: string;
  source_id: string;
  anchor_ref: string;
  source_refs_json?: unknown;
};

export type PedagogicalEvidenceRow = {
  id: string;
  source_id: string;
  anchor_ref: string;
  excerpt: string;
  locator: string;
  modality?: string | null;
  normalized_claims_json?: unknown;
};

export type PedagogicalRelationRow = {
  id: string;
  type: string;
  from_id: string;
  to_id: string;
  source_refs_json?: unknown;
};

export type ModelPedagogicalProfileInput = {
  datasetId: string;
  profile: PedagogicalDomainProfileRow;
  schoolStage: string;
  gradeBand: string;
  node: PedagogicalNodeRow;
  card: PedagogicalCardRow | null;
  relations: PedagogicalRelationRow[];
  relatedNodes: PedagogicalNodeRow[];
  evidence: PedagogicalEvidenceRow[];
};

export type ModelPedagogicalProfileResult = {
  learning_objectives: string[];
  difficulty_level: string;
  diagnostic_questions: string[];
  common_errors: string[];
  assessment_tasks: string[];
  remediation_suggestions: string[];
  extension_suggestions: string[];
  source_refs: string[];
  confidence: number;
};

export type ModelPedagogicalProfilePrompt = {
  instructions: string;
  user_payload: string;
  response_schema: RawRecord;
};

export type ModelPedagogicalProfileGenerator = (
  input: ModelPedagogicalProfileInput,
) => Promise<ModelPedagogicalProfileResult> | ModelPedagogicalProfileResult;

export type GeneratedPedagogicalProfileUpdate = {
  dataset_id: string;
  profile_id: string;
  stage_profiles_json: RawRecord;
  expected_stage_profiles_json: RawRecord;
  source_refs_json: string[];
  updated_at: string;
};

export type PedagogicalProfileFailure = {
  profile_id: string;
  node_id: string;
  school_stage: string;
  message: string;
};

export type GeneratePedagogicalProfilesPlan = {
  rows: GeneratedPedagogicalProfileUpdate[];
  generatedContexts: number;
  skippedExisting: string[];
  skippedProtected: string[];
  skippedMissingStage: string[];
  skippedMissingContext: string[];
  skippedMissingEvidence: string[];
  modelFailures: PedagogicalProfileFailure[];
};

export type GeneratePedagogicalProfilesDatabaseOutput = {
  status: "success";
  mode: "model";
  dataset_id: string;
  selected: number;
  generated: number;
  updated_profiles: number;
  skipped_existing: number;
  skipped_protected: number;
  skipped_missing_stage: number;
  skipped_missing_context: number;
  skipped_missing_evidence: number;
  failed_model_generation: number;
  model_failures: PedagogicalProfileFailure[];
  read_statements: string[];
  statements: string[];
  executedStatements: string[];
};

export type PedagogicalProfilesQueryExecutor = (statement: SqlStatement) => Promise<RawRecord[]> | RawRecord[];
export type PedagogicalProfilesExecutor = (statement: SqlStatement) => Promise<RawRecord[] | void> | RawRecord[] | void;

export function buildSelectDomainProfilesForPedagogyQuery(input: {
  datasetId: string;
  nodeId?: string | null;
  limit?: number | null;
  bookId?: string | null;
}): SqlStatement {
  return {
    name: "select-domain-profiles-for-pedagogy",
    sql: [
      "SELECT p.id, p.node_id, p.domain, p.school_stages_json, p.curriculum_roles_json, p.source_refs_json, p.properties_json",
      "FROM world_domain_profiles AS p",
      "WHERE p.dataset_id = $1",
      "  AND p.status != 'deprecated'",
      "  AND ($2 = '' OR p.node_id = $2)",
      "  AND (",
      "    $4 = ''",
      "    OR EXISTS (",
      "      SELECT 1",
      "      FROM world_mentions AS mention",
      "      JOIN LATERAL jsonb_array_elements_text(mention.source_refs_json) AS mention_ref(evidence_id) ON true",
      "      JOIN world_evidence AS evidence",
      "        ON evidence.dataset_id = mention.dataset_id",
      "       AND evidence.id = mention_ref.evidence_id",
      "      WHERE mention.dataset_id = p.dataset_id",
      "        AND mention.target_type = 'node'",
      "        AND mention.target_id = p.node_id",
      "        AND evidence.source_id = $4",
      "    )",
      "  )",
      "ORDER BY p.id",
      "LIMIT NULLIF($3, 0)",
    ].join("\n"),
    params: [input.datasetId, input.nodeId ?? "", input.limit ?? 0, input.bookId ?? ""],
  };
}

export function buildSelectNodesForPedagogyQuery(datasetId: string): SqlStatement {
  return {
    name: "select-nodes-for-pedagogy",
    sql: [
      "SELECT id, name, kind, subkind, definition, aliases_json, domains_json, learning_mode_json, properties_json",
      "FROM world_nodes",
      "WHERE dataset_id = $1 AND status != 'deprecated'",
      "ORDER BY id",
    ].join("\n"),
    params: [datasetId],
  };
}

export function buildSelectCardsForPedagogyQuery(datasetId: string): SqlStatement {
  return {
    name: "select-node-cards-for-pedagogy",
    sql: [
      "SELECT node_id, title, summary, source_refs_json, sections_json",
      "FROM world_node_cards",
      "WHERE dataset_id = $1 AND status != 'deprecated'",
      "ORDER BY node_id",
    ].join("\n"),
    params: [datasetId],
  };
}

export function buildSelectMentionsForPedagogyQuery(datasetId: string, bookId = ""): SqlStatement {
  return {
    name: "select-mentions-for-pedagogy",
    sql: [
      "SELECT target_id, source_id, anchor_ref, source_refs_json",
      "FROM world_mentions",
      "WHERE dataset_id = $1",
      "  AND target_type = 'node'",
      "  AND ($2 = '' OR source_id = $2)",
      "ORDER BY target_id, source_id, anchor_ref",
    ].join("\n"),
    params: [datasetId, bookId],
  };
}

export function buildSelectEvidenceForPedagogyQuery(datasetId: string, bookId = ""): SqlStatement {
  return {
    name: "select-evidence-for-pedagogy",
    sql: [
      "SELECT id, source_id, anchor_ref, excerpt, locator, modality, normalized_claims_json",
      "FROM world_evidence",
      "WHERE dataset_id = $1",
      "  AND ($2 = '' OR source_id = $2)",
      "ORDER BY source_id, anchor_ref, id",
    ].join("\n"),
    params: [datasetId, bookId],
  };
}

export function buildSelectRelationsForPedagogyQuery(datasetId: string): SqlStatement {
  return {
    name: "select-relations-for-pedagogy",
    sql: [
      "SELECT id, type, from_id, to_id, source_refs_json",
      "FROM world_edges",
      "WHERE dataset_id = $1 AND status != 'deprecated'",
      "ORDER BY id",
    ].join("\n"),
    params: [datasetId],
  };
}

export function buildModelPedagogicalProfilePrompt(input: ModelPedagogicalProfileInput): ModelPedagogicalProfilePrompt {
  const allowedSourceRefs = input.evidence.map((row) => row.id);
  const relatedNodeById = new Map(input.relatedNodes.map((node) => [node.id, node]));
  const instructions = [
    "你是 Open Knowledge Map 的教学画像生成器。",
    "任务：根据一个已经规范化的知识对象、指定领域和指定学段，生成可用于教学、诊断和评价的结构化画像。",
    "",
    "硬约束：",
    "1. 知识事实只能来自输入的节点、结构化卡片、关系和证据；不得补充无证据支持的学科事实。",
    "2. 学习目标、问题、任务和建议可以进行教学设计，但必须围绕输入知识，不得引入新的知识结论。",
    "3. 每个列表写 1 至 3 条，内容具体、简洁、可执行，避免空泛表述。",
    "4. 学习目标使用可观察的行为描述；评价任务应能检验这些目标。",
    "5. 难度必须相对于当前 school_stage 判断，只能使用 introductory、basic、intermediate、advanced、expert。",
    "6. source_refs 只能填写 allowed_source_refs 中出现的证据编号，不能创造编号。",
    "7. common_errors 只描述与当前知识边界直接相关的典型错误，不要编造教材没有涉及的事实。",
    "8. 输出必须是可由 JSON.parse 直接解析的单个 JSON 对象，并严格符合 JSON schema；只能以一个左花括号开始、一个右花括号结束，不要输出额外解释。",
    "9. 根对象必须且只能包含以下 9 个必填键：learning_objectives、difficulty_level、diagnostic_questions、common_errors、assessment_tasks、remediation_suggestions、extension_suggestions、source_refs、confidence。",
  ].join("\n");
  const userPayload = JSON.stringify({
    dataset_id: input.datasetId,
    teaching_context: {
      profile_id: input.profile.id,
      domain: input.profile.domain,
      school_stage: input.schoolStage,
      grade_band: input.gradeBand || null,
      curriculum_roles: stringArray(input.profile.curriculum_roles_json),
    },
    node: {
      id: input.node.id,
      name: input.node.name,
      kind: input.node.kind,
      subkind: input.node.subkind,
      definition: input.node.definition,
      aliases: stringArray(input.node.aliases_json),
      domains: stringArray(input.node.domains_json),
      learning_mode: stringArray(input.node.learning_mode_json),
      properties: recordValue(input.node.properties_json),
    },
    card: input.card ? {
      title: textValue(input.card.title),
      summary: textValue(input.card.summary),
      sections: recordArray(input.card.sections_json).map((section) => ({
        title: textValue(section.title),
        section_type: textValue(section.section_type),
        content: section.content,
      })),
    } : null,
    relations: input.relations.map((relation) => {
      const otherId = relation.from_id === input.node.id ? relation.to_id : relation.from_id;
      return {
        direction: relation.from_id === input.node.id ? "outgoing" : "incoming",
        type: relation.type,
        other_node_id: otherId,
        other_node_name: relatedNodeById.get(otherId)?.name ?? otherId,
      };
    }),
    evidence: input.evidence.map((row) => ({
      id: row.id,
      source_id: row.source_id,
      anchor_ref: row.anchor_ref,
      locator: row.locator,
      modality: row.modality,
      excerpt: truncateText(row.excerpt, 1400),
      normalized_claims: stringArray(row.normalized_claims_json),
    })),
    allowed_source_refs: allowedSourceRefs,
  }, null, 2);
  return {
    instructions,
    user_payload: userPayload,
    response_schema: buildModelPedagogicalProfileResponseSchema(),
  };
}

export function buildModelPedagogicalProfileResponseSchema(): RawRecord {
  const teachingList = {
    type: "array",
    minItems: 1,
    maxItems: 3,
    items: { type: "string", minLength: 1 },
  };
  return {
    name: "okm_pedagogical_profile",
    strict: true,
    schema: {
      type: "object",
      additionalProperties: false,
      properties: {
        learning_objectives: teachingList,
        difficulty_level: { type: "string", enum: [...DIFFICULTY_LEVELS] },
        diagnostic_questions: teachingList,
        common_errors: teachingList,
        assessment_tasks: teachingList,
        remediation_suggestions: teachingList,
        extension_suggestions: teachingList,
        source_refs: {
          type: "array",
          minItems: 1,
          items: { type: "string", minLength: 1 },
        },
        confidence: { type: "number", minimum: 0, maximum: 1 },
      },
      required: [
        "learning_objectives",
        "difficulty_level",
        "diagnostic_questions",
        "common_errors",
        "assessment_tasks",
        "remediation_suggestions",
        "extension_suggestions",
        "source_refs",
        "confidence",
      ],
    },
  };
}

export function parseModelPedagogicalProfileResultText(text: string): ModelPedagogicalProfileResult {
  return normalizeModelResult(parseModelJsonObject(text));
}

export async function planModelPedagogicalProfiles(input: {
  datasetId: string;
  profiles: PedagogicalDomainProfileRow[];
  nodes: PedagogicalNodeRow[];
  cards: PedagogicalCardRow[];
  mentions: PedagogicalMentionRow[];
  evidence: PedagogicalEvidenceRow[];
  relations: PedagogicalRelationRow[];
  modelName: string;
  now: string;
  schoolStage?: string | null;
  gradeBand?: string | null;
  maxEvidencePerContext?: number;
  concurrency?: number;
  overwriteGenerated?: boolean;
  generateProfile: ModelPedagogicalProfileGenerator;
}): Promise<GeneratePedagogicalProfilesPlan> {
  const nodeById = new Map(input.nodes.map((node) => [node.id, node]));
  const cardByNodeId = new Map(input.cards.map((card) => [card.node_id, card]));
  const evidenceById = new Map(input.evidence.map((row) => [row.id, row]));
  const evidenceByAnchor = new Map<string, PedagogicalEvidenceRow[]>();
  for (const row of input.evidence) {
    const key = `${row.source_id}:${row.anchor_ref}`;
    const rows = evidenceByAnchor.get(key) ?? [];
    rows.push(row);
    evidenceByAnchor.set(key, rows);
  }
  const mentionsByNodeId = groupBy(input.mentions, (row) => row.target_id);
  const relationsByNodeId = new Map<string, PedagogicalRelationRow[]>();
  for (const relation of input.relations) {
    for (const nodeId of new Set([relation.from_id, relation.to_id])) {
      const rows = relationsByNodeId.get(nodeId) ?? [];
      rows.push(relation);
      relationsByNodeId.set(nodeId, rows);
    }
  }

  const skippedExisting: string[] = [];
  const skippedProtected: string[] = [];
  const skippedMissingStage: string[] = [];
  const skippedMissingContext: string[] = [];
  const skippedMissingEvidence: string[] = [];
  const tasks: PedagogicalGenerationTask[] = [];
  const maxEvidence = Math.max(1, input.maxEvidencePerContext ?? 8);
  const requestedSchoolStage = textValue(input.schoolStage);
  if (requestedSchoolStage && !VALID_SCHOOL_STAGES.has(requestedSchoolStage)) {
    throw new Error(`Invalid school stage '${requestedSchoolStage}'.`);
  }

  for (const profile of input.profiles) {
    const declaredStages = uniqueStrings(stringArray(profile.school_stages_json)).filter((stage) => VALID_SCHOOL_STAGES.has(stage));
    const stages = requestedSchoolStage
      ? declaredStages.filter((stage) => stage === requestedSchoolStage)
      : declaredStages;
    if (stages.length === 0) {
      skippedMissingStage.push(requestedSchoolStage ? contextKey(profile.id, requestedSchoolStage) : profile.id);
      continue;
    }
    const node = nodeById.get(profile.node_id);
    if (!node) {
      skippedMissingContext.push(profile.id);
      continue;
    }
    const properties = recordValue(profile.properties_json);
    if (hasLegacyPedagogicalContent(properties.pedagogical_profile)) {
      for (const stage of stages) skippedProtected.push(contextKey(profile.id, stage));
      continue;
    }
    const existingByStage = recordValue(properties.pedagogical_profiles_by_stage);
    const relations = relationsByNodeId.get(node.id) ?? [];
    const relatedNodeIds = uniqueStrings(relations.flatMap((relation) => [relation.from_id, relation.to_id])).filter((id) => id !== node.id);
    const relatedNodes = relatedNodeIds.map((id) => nodeById.get(id)).filter((item): item is PedagogicalNodeRow => Boolean(item));
    const card = cardByNodeId.get(node.id) ?? null;
    const evidenceRows = collectEvidenceForPedagogicalProfile({
      profile,
      card,
      mentions: mentionsByNodeId.get(node.id) ?? [],
      relations,
      evidenceById,
      evidenceByAnchor,
      maxEvidence,
    });
    if (evidenceRows.length === 0) {
      for (const stage of stages) skippedMissingEvidence.push(contextKey(profile.id, stage));
      continue;
    }
    const gradeBand = textValue(input.gradeBand) || textValue(properties.grade_band);

    for (const schoolStage of stages) {
      const key = contextKey(profile.id, schoolStage);
      const modelInput: ModelPedagogicalProfileInput = {
        datasetId: input.datasetId,
        profile,
        schoolStage,
        gradeBand,
        node,
        card,
        relations,
        relatedNodes,
        evidence: evidenceRows,
      };
      const fingerprint = pedagogicalInputFingerprint(modelInput, input.modelName);
      const existing = recordValue(existingByStage[schoolStage]);
      if (Object.keys(existing).length > 0) {
        if (isProtectedPedagogicalProfile(existing)) {
          skippedProtected.push(key);
          continue;
        }
        const generation = recordValue(existing.generation);
        if (!input.overwriteGenerated && textValue(generation.input_fingerprint) === fingerprint) {
          skippedExisting.push(key);
          continue;
        }
      }
      tasks.push({
        key,
        profile,
        schoolStage,
        gradeBand,
        modelInput,
        fingerprint,
        expectedStageProfile: Object.keys(existing).length > 0 ? existing : null,
        allowedEvidenceIds: new Set(evidenceRows.map((row) => row.id)),
      });
    }
  }

  const taskResults = await mapWithConcurrency(tasks, input.concurrency ?? 8, async (task) => {
    try {
      const generated = normalizeModelResult(await input.generateProfile(task.modelInput));
      const sourceRefs = generated.source_refs.filter((id) => task.allowedEvidenceIds.has(id));
      if (sourceRefs.length === 0) {
        throw new Error("Model output did not cite any provided evidence id.");
      }
      return {
        kind: "success" as const,
        task,
        stageProfile: {
          school_stage: task.schoolStage,
          ...(task.gradeBand ? { grade_band: task.gradeBand } : {}),
          learning_objectives: generated.learning_objectives,
          difficulty_level: generated.difficulty_level,
          diagnostic_questions: generated.diagnostic_questions,
          common_errors: generated.common_errors,
          assessment_tasks: generated.assessment_tasks,
          remediation_suggestions: generated.remediation_suggestions,
          extension_suggestions: generated.extension_suggestions,
          generation: {
            generated_from: MODEL_GENERATED_FROM,
            model: input.modelName,
            prompt_version: PROMPT_VERSION,
            generated_at: input.now,
            input_fingerprint: task.fingerprint,
            review_status: "pending",
            confidence: generated.confidence,
            source_refs: sourceRefs,
          },
        } satisfies RawRecord,
        sourceRefs,
      };
    } catch (error) {
      return {
        kind: "failure" as const,
        failure: {
          profile_id: task.profile.id,
          node_id: task.profile.node_id,
          school_stage: task.schoolStage,
          message: (error as Error).message,
        },
      };
    }
  });

  const successesByProfile = new Map<string, Array<Extract<(typeof taskResults)[number], { kind: "success" }>>>();
  const modelFailures: PedagogicalProfileFailure[] = [];
  for (const result of taskResults) {
    if (result.kind === "failure") {
      modelFailures.push(result.failure);
      continue;
    }
    const rows = successesByProfile.get(result.task.profile.id) ?? [];
    rows.push(result);
    successesByProfile.set(result.task.profile.id, rows);
  }

  const rows: GeneratedPedagogicalProfileUpdate[] = [];
  for (const profile of input.profiles) {
    const successes = successesByProfile.get(profile.id) ?? [];
    if (successes.length === 0) continue;
    const stageProfiles: RawRecord = {};
    const expectedStageProfiles: RawRecord = {};
    const generatedSourceRefs: string[] = [];
    for (const success of successes) {
      stageProfiles[success.task.schoolStage] = success.stageProfile;
      expectedStageProfiles[success.task.schoolStage] = success.task.expectedStageProfile;
      generatedSourceRefs.push(...success.sourceRefs);
    }
    rows.push({
      dataset_id: input.datasetId,
      profile_id: profile.id,
      stage_profiles_json: stageProfiles,
      expected_stage_profiles_json: expectedStageProfiles,
      source_refs_json: uniqueStrings(generatedSourceRefs),
      updated_at: input.now,
    });
  }

  return {
    rows,
    generatedContexts: taskResults.length - modelFailures.length,
    skippedExisting,
    skippedProtected,
    skippedMissingStage,
    skippedMissingContext,
    skippedMissingEvidence,
    modelFailures,
  };
}

export function buildUpdatePedagogicalProfileStatement(row: GeneratedPedagogicalProfileUpdate): SqlStatement {
  return {
    name: "update-world-domain-profile-pedagogy",
    sql: [
      "UPDATE world_domain_profiles AS profile",
      "SET properties_json = COALESCE(profile.properties_json, '{}'::jsonb) || jsonb_build_object(",
      "      'pedagogical_profiles_by_stage',",
      "      (CASE",
      "        WHEN jsonb_typeof(profile.properties_json -> 'pedagogical_profiles_by_stage') = 'object'",
      "          THEN profile.properties_json -> 'pedagogical_profiles_by_stage'",
      "        ELSE '{}'::jsonb",
      "      END) || $3::jsonb",
      "    ),",
      "    source_refs_json = COALESCE((",
      "      SELECT jsonb_agg(ref ORDER BY ref)",
      "      FROM (",
      "        SELECT value AS ref",
      "        FROM jsonb_array_elements_text(COALESCE(profile.source_refs_json, '[]'::jsonb)) AS current_ref(value)",
      "        UNION",
      "        SELECT value AS ref",
      "        FROM jsonb_array_elements_text($4::jsonb) AS generated_ref(value)",
      "      ) AS combined_refs",
      "    ), '[]'::jsonb),",
      "    updated_at = $6",
      "WHERE profile.dataset_id = $1",
      "  AND profile.id = $2",
      "  AND profile.status != 'deprecated'",
      "  AND NOT (",
      "    COALESCE(jsonb_typeof(profile.properties_json -> 'pedagogical_profile'), '') = 'object'",
      "    AND COALESCE(profile.properties_json -> 'pedagogical_profile', '{}'::jsonb) != '{}'::jsonb",
      "  )",
      "  AND NOT EXISTS (",
      "    SELECT 1",
      "    FROM jsonb_each($5::jsonb) AS expected(stage, expected_value)",
      "    WHERE (",
      "      expected.expected_value = 'null'::jsonb",
      "      AND (CASE",
      "        WHEN jsonb_typeof(profile.properties_json -> 'pedagogical_profiles_by_stage') = 'object'",
      "          THEN profile.properties_json -> 'pedagogical_profiles_by_stage'",
      "        ELSE '{}'::jsonb",
      "      END) ? expected.stage",
      "    ) OR (",
      "      expected.expected_value != 'null'::jsonb",
      "      AND (CASE",
      "        WHEN jsonb_typeof(profile.properties_json -> 'pedagogical_profiles_by_stage') = 'object'",
      "          THEN profile.properties_json -> 'pedagogical_profiles_by_stage'",
      "        ELSE '{}'::jsonb",
      "      END) -> expected.stage IS DISTINCT FROM expected.expected_value",
      "    )",
      "  )",
      "RETURNING profile.id",
    ].join("\n"),
    params: [
      row.dataset_id,
      row.profile_id,
      row.stage_profiles_json,
      row.source_refs_json,
      row.expected_stage_profiles_json,
      row.updated_at,
    ],
  };
}

export async function runGeneratePedagogicalProfilesFromDatabase(input: {
  datasetId: string;
  now?: string;
  nodeId?: string | null;
  bookId?: string | null;
  schoolStage?: string | null;
  gradeBand?: string | null;
  limit?: number | null;
  maxEvidencePerContext?: number | null;
  modelName?: string;
  concurrency?: number | null;
  overwriteGenerated?: boolean;
  generateProfile?: ModelPedagogicalProfileGenerator;
  query: PedagogicalProfilesQueryExecutor;
  executeStatement: PedagogicalProfilesExecutor;
}): Promise<GeneratePedagogicalProfilesDatabaseOutput> {
  const now = input.now || new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");
  const readStatements: string[] = [];
  const statements: string[] = [];
  const executedStatements: string[] = [];
  const query = async (statement: SqlStatement): Promise<RawRecord[]> => {
    readStatements.push(statement.name);
    const rows = await input.query(statement);
    assertRecordRows(statement.name, rows);
    return rows;
  };

  const plan = await planModelPedagogicalProfiles({
    datasetId: input.datasetId,
    profiles: (await query(buildSelectDomainProfilesForPedagogyQuery({
      datasetId: input.datasetId,
      nodeId: input.nodeId,
      limit: input.limit,
      bookId: input.bookId,
    }))).map(toDomainProfileRow),
    nodes: (await query(buildSelectNodesForPedagogyQuery(input.datasetId))).map(toNodeRow),
    cards: (await query(buildSelectCardsForPedagogyQuery(input.datasetId))).map(toCardRow),
    mentions: (await query(buildSelectMentionsForPedagogyQuery(input.datasetId, input.bookId ?? ""))).map(toMentionRow),
    evidence: (await query(buildSelectEvidenceForPedagogyQuery(input.datasetId, input.bookId ?? ""))).map(toEvidenceRow),
    relations: (await query(buildSelectRelationsForPedagogyQuery(input.datasetId))).map(toRelationRow),
    modelName: input.modelName ?? "",
    now,
    schoolStage: input.schoolStage,
    gradeBand: input.gradeBand,
    maxEvidencePerContext: input.maxEvidencePerContext ?? undefined,
    concurrency: input.concurrency ?? 8,
    overwriteGenerated: input.overwriteGenerated,
    generateProfile: input.generateProfile ?? missingModelGenerator,
  });

  for (const row of plan.rows) {
    const statement = buildUpdatePedagogicalProfileStatement(row);
    statements.push(statement.name);
    const writtenRows = await input.executeStatement(statement);
    if (writtenRows !== undefined) {
      assertRecordRows(statement.name, writtenRows);
      if (writtenRows.length !== 1) {
        throw new Error(
          `Pedagogical profile '${row.profile_id}' changed while model generation was running; protected the newer database value.`,
        );
      }
    }
    executedStatements.push(statement.name);
  }

  const selected = plan.generatedContexts
    + plan.modelFailures.length
    + plan.skippedExisting.length
    + plan.skippedProtected.length
    + plan.skippedMissingStage.length
    + plan.skippedMissingContext.length
    + plan.skippedMissingEvidence.length;
  return {
    status: "success",
    mode: "model",
    dataset_id: input.datasetId,
    selected,
    generated: plan.generatedContexts,
    updated_profiles: plan.rows.length,
    skipped_existing: plan.skippedExisting.length,
    skipped_protected: plan.skippedProtected.length,
    skipped_missing_stage: plan.skippedMissingStage.length,
    skipped_missing_context: plan.skippedMissingContext.length,
    skipped_missing_evidence: plan.skippedMissingEvidence.length,
    failed_model_generation: plan.modelFailures.length,
    model_failures: plan.modelFailures,
    read_statements: readStatements,
    statements,
    executedStatements,
  };
}

type PedagogicalGenerationTask = {
  key: string;
  profile: PedagogicalDomainProfileRow;
  schoolStage: string;
  gradeBand: string;
  modelInput: ModelPedagogicalProfileInput;
  fingerprint: string;
  expectedStageProfile: RawRecord | null;
  allowedEvidenceIds: Set<string>;
};

function collectEvidenceForPedagogicalProfile(input: {
  profile: PedagogicalDomainProfileRow;
  card: PedagogicalCardRow | null;
  mentions: PedagogicalMentionRow[];
  relations: PedagogicalRelationRow[];
  evidenceById: Map<string, PedagogicalEvidenceRow>;
  evidenceByAnchor: Map<string, PedagogicalEvidenceRow[]>;
  maxEvidence: number;
}): PedagogicalEvidenceRow[] {
  const ids = new Set(stringArray(input.profile.source_refs_json));
  if (input.card) {
    for (const id of stringArray(input.card.source_refs_json)) ids.add(id);
    for (const section of recordArray(input.card.sections_json)) {
      for (const id of stringArray(section.source_refs)) ids.add(id);
    }
  }
  for (const mention of input.mentions) {
    for (const id of stringArray(mention.source_refs_json)) ids.add(id);
    for (const row of input.evidenceByAnchor.get(`${mention.source_id}:${mention.anchor_ref}`) ?? []) ids.add(row.id);
  }
  for (const relation of input.relations) {
    for (const id of stringArray(relation.source_refs_json)) ids.add(id);
  }
  return [...ids]
    .map((id) => input.evidenceById.get(id))
    .filter((row): row is PedagogicalEvidenceRow => Boolean(row))
    .slice(0, input.maxEvidence)
    .sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
}

function pedagogicalInputFingerprint(input: ModelPedagogicalProfileInput, modelName: string): string {
  const prompt = buildModelPedagogicalProfilePrompt(input);
  const value = JSON.stringify({
    prompt_version: PROMPT_VERSION,
    model: modelName,
    instructions: prompt.instructions,
    user_payload: prompt.user_payload,
    response_schema: prompt.response_schema,
  });
  return createHash("sha256").update(value).digest("hex");
}

function isProtectedPedagogicalProfile(value: RawRecord): boolean {
  const generation = recordValue(value.generation);
  if (textValue(generation.generated_from) !== MODEL_GENERATED_FROM) return true;
  return textValue(generation.review_status) === "approved";
}

function hasLegacyPedagogicalContent(value: unknown): boolean {
  const profile = recordValue(value);
  return [
    profile.learning_objectives,
    profile.diagnostic_questions,
    profile.common_errors,
    profile.assessment_tasks,
    profile.remediation_suggestions,
    profile.extension_suggestions,
  ].some((item) => stringArray(item).length > 0) || DIFFICULTY_LEVELS.has(textValue(profile.difficulty_level));
}

function normalizeModelResult(value: unknown): ModelPedagogicalProfileResult {
  const row = recordValue(value);
  const rawDifficulty = textValue(row.difficulty_level);
  const difficulty = rawDifficulty || "intermediate";
  if (!DIFFICULTY_LEVELS.has(difficulty)) {
    throw new Error(`Model output has invalid difficulty_level '${difficulty}'.`);
  }
  const rawConfidence = Number(row.confidence);
  const confidence = !Number.isFinite(rawConfidence) || rawConfidence < 0 || rawConfidence > 100
    ? 0
    : rawConfidence > 1
      ? rawConfidence / 100
      : rawConfidence;
  return {
    learning_objectives: requiredTeachingList(row.learning_objectives, "learning_objectives"),
    difficulty_level: difficulty,
    diagnostic_questions: requiredTeachingList(row.diagnostic_questions, "diagnostic_questions"),
    common_errors: requiredTeachingList(row.common_errors, "common_errors"),
    assessment_tasks: requiredTeachingList(row.assessment_tasks, "assessment_tasks"),
    remediation_suggestions: requiredTeachingList(row.remediation_suggestions, "remediation_suggestions"),
    extension_suggestions: requiredTeachingList(row.extension_suggestions, "extension_suggestions"),
    source_refs: requiredTeachingList(row.source_refs, "source_refs"),
    confidence,
  };
}

function requiredTeachingList(value: unknown, field: string): string[] {
  const items = uniqueStrings(stringArray(value));
  if (items.length === 0) throw new Error(`Model output field '${field}' must contain at least one non-empty string.`);
  return items.slice(0, 3);
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return [];
  const results = new Array<R>(items.length);
  const workerCount = Math.max(1, Math.min(Math.floor(concurrency), items.length));
  let nextIndex = 0;
  await Promise.all(Array.from({ length: workerCount }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]!);
    }
  }));
  return results;
}

function groupBy<T>(items: T[], key: (item: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const groupKey = key(item);
    const group = groups.get(groupKey) ?? [];
    group.push(item);
    groups.set(groupKey, group);
  }
  return groups;
}

function contextKey(profileId: string, schoolStage: string): string {
  return `${profileId}:${schoolStage}`;
}

function recordArray(value: unknown): RawRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function recordValue(value: unknown): RawRecord {
  return isRecord(value) ? value : {};
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(textValue).filter(Boolean) : [];
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function truncateText(value: string, maxLength: number): string {
  const text = value.trim();
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

function textValue(value: unknown): string {
  return value == null ? "" : String(value).trim();
}

function requiredString(value: unknown, field: string): string {
  const text = textValue(value);
  if (!text) throw new Error(`Missing required field '${field}'.`);
  return text;
}

function optionalString(value: unknown): string | null {
  const text = textValue(value);
  return text || null;
}

function toDomainProfileRow(row: RawRecord): PedagogicalDomainProfileRow {
  return {
    id: requiredString(row.id, "id"),
    node_id: requiredString(row.node_id, "node_id"),
    domain: requiredString(row.domain, "domain"),
    school_stages_json: row.school_stages_json,
    curriculum_roles_json: row.curriculum_roles_json,
    source_refs_json: row.source_refs_json,
    properties_json: row.properties_json,
  };
}

function toNodeRow(row: RawRecord): PedagogicalNodeRow {
  return {
    id: requiredString(row.id, "id"),
    name: requiredString(row.name, "name"),
    kind: requiredString(row.kind, "kind"),
    subkind: optionalString(row.subkind),
    definition: requiredString(row.definition, "definition"),
    aliases_json: row.aliases_json,
    domains_json: row.domains_json,
    learning_mode_json: row.learning_mode_json,
    properties_json: row.properties_json,
  };
}

function toCardRow(row: RawRecord): PedagogicalCardRow {
  return {
    node_id: requiredString(row.node_id, "node_id"),
    title: optionalString(row.title),
    summary: optionalString(row.summary),
    source_refs_json: row.source_refs_json,
    sections_json: row.sections_json,
  };
}

function toMentionRow(row: RawRecord): PedagogicalMentionRow {
  return {
    target_id: requiredString(row.target_id, "target_id"),
    source_id: requiredString(row.source_id, "source_id"),
    anchor_ref: requiredString(row.anchor_ref, "anchor_ref"),
    source_refs_json: row.source_refs_json,
  };
}

function toEvidenceRow(row: RawRecord): PedagogicalEvidenceRow {
  return {
    id: requiredString(row.id, "id"),
    source_id: requiredString(row.source_id, "source_id"),
    anchor_ref: requiredString(row.anchor_ref, "anchor_ref"),
    excerpt: requiredString(row.excerpt, "excerpt"),
    locator: requiredString(row.locator, "locator"),
    modality: optionalString(row.modality),
    normalized_claims_json: row.normalized_claims_json,
  };
}

function toRelationRow(row: RawRecord): PedagogicalRelationRow {
  return {
    id: requiredString(row.id, "id"),
    type: requiredString(row.type, "type"),
    from_id: requiredString(row.from_id, "from_id"),
    to_id: requiredString(row.to_id, "to_id"),
    source_refs_json: row.source_refs_json,
  };
}

function assertRecordRows(name: string, rows: unknown): asserts rows is RawRecord[] {
  if (!Array.isArray(rows) || rows.some((row) => !isRecord(row))) {
    throw new Error(`Query '${name}' must return object rows.`);
  }
}

function isRecord(value: unknown): value is RawRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function missingModelGenerator(): never {
  throw new Error("A model pedagogical profile generator is required.");
}
