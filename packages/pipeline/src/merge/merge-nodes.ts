import { cosineSimilarity, makeCanonicalNodeId, makeEvidenceId, makeMentionId, mergeJsonObjects, mergeTextBlocks, mergeUniqueStrings } from "../shared/knowledge.js";
import { addNodeSubkindClassification, choosePrimarySubkind, mergeNodeSubkindClassifications, normalizeNodeSubkind } from "../shared/node-subkind.js";
import { makeDomainProfileId, makeEdgeId, normalizeTerm } from "../shared/pathing.js";

export type CanonicalNodeCandidate = {
  payload: Record<string, unknown>;
  terms: Set<string>;
  semantic_key?: string | null;
  embedding: number[];
};

export type NodeMatchScore = {
  score: number;
  lexical: number;
  semantic: number;
  embedding: number;
  rationale: Record<string, unknown>;
};

export type EvidenceLinkStatement = {
  sql: string;
  params: unknown[];
};

export type ReplaceEvidenceLinksPlan = {
  statements: EvidenceLinkStatement[];
  inserted: number;
};

export type DomainProfileMergePlan = {
  payload: Record<string, unknown>;
  evidence_links: ReplaceEvidenceLinksPlan;
};

export type MentionMergePlan = {
  payload: Record<string, unknown>;
  evidence_links: ReplaceEvidenceLinksPlan;
};

export type NodeCardSectionEvidencePlan = {
  section_id: string;
  owner_id: string;
  evidence_links: ReplaceEvidenceLinksPlan;
};

export type NodeCardMergePlan = {
  payload: Record<string, unknown>;
  evidence_links: ReplaceEvidenceLinksPlan;
  section_evidence_links: NodeCardSectionEvidencePlan[];
};

export type EdgeMergePlan = {
  payload: Record<string, unknown>;
  evidence_links: ReplaceEvidenceLinksPlan;
};

export type EvidenceMergePlan = {
  raw_evidence_id: string;
  evidence_id: string;
  payload: Record<string, unknown>;
};

export type StagedNodeResolution = "matched" | "created" | "review";

export type StagedNodeMergePlan = {
  raw_node_id: string;
  canonical_node_id: string;
  resolution: StagedNodeResolution;
  score: NodeMatchScore;
  node_payload: Record<string, unknown>;
  node_map_entry: Record<string, string>;
  canonical_node_map_payload: Record<string, unknown>;
  canonical_candidate_to_append: CanonicalNodeCandidate | null;
  stats_delta: {
    nodes_created: number;
    nodes_matched: number;
    nodes_review: number;
  };
};

export function parseEmbedding(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const result: number[] = [];
  for (const item of value) {
    const parsed = Number(item);
    if (!Number.isFinite(parsed)) return [];
    result.push(parsed);
  }
  return result;
}

export function formatPgvector(value: unknown): string | null {
  const embedding = parseEmbedding(value);
  return embedding.length > 0 ? `[${embedding.map(String).join(",")}]` : null;
}

export function normalizedTerms(payload: Record<string, unknown>): Set<string> {
  const aliases = Array.isArray(payload.aliases_json) ? payload.aliases_json : [];
  const terms = new Set<string>([normalizeTerm(String(payload.name ?? ""))]);
  for (const alias of aliases) {
    if (typeof alias === "string") terms.add(normalizeTerm(alias));
  }
  return new Set([...terms].filter((term) => term.length > 0));
}

export function lexicalSimilarity(leftTerms: Set<string>, rightTerms: Set<string>): number {
  if (leftTerms.size === 0 || rightTerms.size === 0) return 0;
  let best = 0;
  for (const left of leftTerms) {
    for (const right of rightTerms) {
      if (left === right) return 1;
      if (left.includes(right) || right.includes(left)) best = Math.max(best, 0.96);
      best = Math.max(best, sequenceMatcherRatio(left, right));
    }
  }
  return best;
}

export function scoreNodeMatch(staged: Record<string, unknown>, candidate: CanonicalNodeCandidate, options: { embeddingThreshold?: number } = {}): NodeMatchScore {
  const embeddingThreshold = options.embeddingThreshold ?? 0.92;
  const payload = candidate.payload;
  if (payload.kind !== staged.kind) {
    return { score: 0, lexical: 0, semantic: 0, embedding: 0, rationale: { reason: "kind_mismatch" } };
  }
  const payloadSubkind = normalizeNodeSubkind(String(payload.kind ?? ""), payload.subkind).primary;
  const stagedSubkind = normalizeNodeSubkind(String(staged.kind ?? ""), staged.subkind).primary;
  const subkindMatch = !payloadSubkind || !stagedSubkind || payloadSubkind === stagedSubkind;

  const lexical = lexicalSimilarity(normalizedTerms(staged), candidate.terms);
  const semantic = staged.semantic_key && staged.semantic_key === candidate.semantic_key ? 1 : 0;
  const stagedEmbedding = parseEmbedding(staged.embedding);
  const embedding = stagedEmbedding.length > 0 && candidate.embedding.length > 0 ? cosineSimilarity(stagedEmbedding, candidate.embedding) : 0;
  let weighted = lexical * 0.45 + semantic * 0.35 + embedding * 0.2;
  if (!subkindMatch && lexical < 0.98 && semantic < 1) weighted *= 0.85;
  if (lexical >= 0.98 || semantic >= 1) weighted = Math.max(weighted, 0.94);
  if (embedding >= embeddingThreshold && lexical >= 0.65) weighted = Math.max(weighted, 0.9);

  return {
    score: Math.min(weighted, 1),
    lexical,
    semantic,
    embedding,
    rationale: {
      lexical,
      semantic_key: semantic,
      embedding,
      embedding_threshold: embeddingThreshold,
      candidate_id: payload.id,
      subkind_match: subkindMatch,
      candidate_subkind: payloadSubkind,
      staged_subkind: stagedSubkind,
    },
  };
}

export function mergeNodePayload(existing: Record<string, unknown>, staged: Record<string, unknown>): Record<string, unknown> {
  let properties = mergeJsonObjects(asRecord(existing.properties), asRecord(staged.properties));
  if (staged.semantic_key) properties.semantic_key = staged.semantic_key;
  properties = mergeNodeSubkindClassifications({
    properties,
    subkinds: [existing.subkind, staged.subkind],
    rawSubkinds: rawSubkindLabels(existing.subkind, staged.subkind),
  });

  return {
    id: existing.id,
    name: String(existing.name ?? "").length <= String(staged.name ?? "").length ? existing.name : staged.name,
    kind: existing.kind,
    subkind: choosePrimarySubkind(existing.subkind, staged.subkind),
    definition: mergeTextBlocks(asString(existing.definition), asString(staged.definition)),
    aliases: mergeUniqueStrings(asArray(existing.aliases), asArray(staged.aliases), [existing.name, staged.name]),
    domains: mergeUniqueStrings(asArray(existing.domains), asArray(staged.domains)),
    knowledge_form: mergeUniqueStrings(asArray(existing.knowledge_form), asArray(staged.knowledge_form)),
    learning_mode: mergeUniqueStrings(asArray(existing.learning_mode), asArray(staged.learning_mode)),
    scope: pythonOr(existing.scope, staged.scope, "domain-specific"),
    properties,
    external_ids: mergeJsonObjects(asRecord(existing.external_ids), asRecord(staged.external_ids)),
    tags: mergeUniqueStrings(asArray(existing.tags), asArray(staged.tags)),
    embedding: pythonOr(existing.embedding, staged.embedding),
    status: "active",
    created_at: pythonOr(existing.created_at, staged.created_at),
    updated_at: staged.updated_at,
    notes: mergeTextBlocks(asString(existing.notes), asString(staged.notes)),
  };
}

export function makeCanonicalCandidate(row: Record<string, unknown>): CanonicalNodeCandidate {
  const normalizedSubkind = normalizeNodeSubkind(String(row.kind ?? ""), row.subkind).primary;
  return {
    payload: { ...row, subkind: normalizedSubkind },
    terms: normalizedTerms(row),
    semantic_key: asRecord(row.properties_json).semantic_key as string | null | undefined,
    embedding: parseEmbedding(row.embedding),
  };
}

export function planStagedNodeMerge(input: {
  datasetId: string;
  mergeRunId: string;
  lessonRunId: string;
  staged: Record<string, unknown>;
  canonicalNodes: CanonicalNodeCandidate[];
  similarityThreshold?: number;
  embeddingThreshold?: number;
  reviewThreshold?: number;
  now: string;
}): StagedNodeMergePlan {
  const similarityThreshold = input.similarityThreshold ?? 0.88;
  const embeddingThreshold = input.embeddingThreshold ?? 0.92;
  const reviewThreshold = input.reviewThreshold ?? 0.74;
  const stagedPayload = makeStagedNodePayload(input.staged, input.now);

  let bestMatch: CanonicalNodeCandidate | null = null;
  let bestScore: NodeMatchScore = { score: 0, lexical: 0, semantic: 0, embedding: 0, rationale: {} };
  for (const candidate of input.canonicalNodes) {
    const score = scoreNodeMatch(
      {
        kind: stagedPayload.kind,
        subkind: stagedPayload.subkind,
        name: stagedPayload.name,
        aliases: stagedPayload.aliases,
        semantic_key: stagedPayload.semantic_key,
        embedding: stagedPayload.embedding,
      },
      candidate,
      { embeddingThreshold },
    );
    if (score.score > bestScore.score) {
      bestScore = score;
      bestMatch = candidate;
    }
  }

  const rawNodeId = requiredString(input.staged.raw_node_id, "raw_node_id");
  let canonicalNodeId: string;
  let resolution: StagedNodeResolution;
  let nodePayload: Record<string, unknown>;
  let canonicalCandidateToAppend: CanonicalNodeCandidate | null = null;
  const statsDelta = {
    nodes_created: 0,
    nodes_matched: 0,
    nodes_review: 0,
  };

  if (bestMatch && bestScore.score >= similarityThreshold) {
    canonicalNodeId = requiredString(bestMatch.payload.id, "candidate.payload.id");
    nodePayload = mergeNodePayload(makeExistingNodePayload(bestMatch.payload, input.now), stagedPayload);
    statsDelta.nodes_matched = 1;
    resolution = "matched";
  } else {
    canonicalNodeId = makeCanonicalNodeId(requiredString(stagedPayload.kind, "kind"), requiredString(stagedPayload.name, "name"), asOptionalString(stagedPayload.subkind));
    nodePayload = { ...stagedPayload, id: canonicalNodeId };
    canonicalCandidateToAppend = {
      payload: {
        id: canonicalNodeId,
        name: stagedPayload.name,
        kind: stagedPayload.kind,
        subkind: stagedPayload.subkind,
        definition: stagedPayload.definition,
        aliases_json: stagedPayload.aliases,
        domains_json: stagedPayload.domains,
        knowledge_form_json: stagedPayload.knowledge_form,
        learning_mode_json: stagedPayload.learning_mode,
        scope: stagedPayload.scope,
        properties_json: stagedPayload.properties,
        external_ids_json: stagedPayload.external_ids,
        tags_json: stagedPayload.tags,
        embedding: stagedPayload.embedding,
        created_at: stagedPayload.created_at,
        notes: stagedPayload.notes,
      },
      terms: normalizedTerms({ name: stagedPayload.name, aliases_json: stagedPayload.aliases }),
      semantic_key: asOptionalString(stagedPayload.semantic_key),
      embedding: parseEmbedding(stagedPayload.embedding),
    };
    statsDelta.nodes_created = 1;
    resolution = bestMatch && bestScore.score >= reviewThreshold ? "review" : "created";
    if (resolution === "review") statsDelta.nodes_review = 1;
  }

  return {
    raw_node_id: rawNodeId,
    canonical_node_id: canonicalNodeId,
    resolution,
    score: bestScore,
    node_payload: nodePayload,
    node_map_entry: {
      [rawNodeId]: canonicalNodeId,
    },
    canonical_node_map_payload: {
      dataset_id: input.datasetId,
      merge_run_id: input.mergeRunId,
      lesson_run_id: input.lessonRunId,
      raw_node_id: rawNodeId,
      canonical_node_id: canonicalNodeId,
      resolution,
      similarity: bestScore.score,
      rationale_json: bestScore.rationale,
      created_at: input.now,
    },
    canonical_candidate_to_append: canonicalCandidateToAppend,
    stats_delta: statsDelta,
  };
}

export function remapSourceRefs(sourceRefs: unknown, evidenceIdByRaw: Record<string, string>): string[] {
  if (!Array.isArray(sourceRefs)) return [];
  const result: string[] = [];
  const seen = new Set<string>();
  for (const rawRef of sourceRefs) {
    if (rawRef === null || rawRef === undefined) continue;
    const ref = String(rawRef).trim();
    if (!ref) continue;
    const mapped = evidenceIdByRaw[ref] ?? ref;
    if (seen.has(mapped)) continue;
    seen.add(mapped);
    result.push(mapped);
  }
  return result;
}

export function remapCardSections(sections: unknown, evidenceIdByRaw: Record<string, string>): Array<Record<string, unknown>> {
  if (!Array.isArray(sections)) return [];
  const remapped: Array<Record<string, unknown>> = [];
  for (const section of sections) {
    if (!isPlainObject(section)) continue;
    remapped.push({
      ...section,
      source_refs: remapSourceRefs(section.source_refs, evidenceIdByRaw),
    });
  }
  return remapped;
}

export function filterExistingEvidenceIds(evidenceIds: string[], existingIds: Iterable<string>): string[] {
  if (evidenceIds.length === 0) return [];
  const existing = new Set(existingIds);
  return evidenceIds.filter((evidenceId) => existing.has(evidenceId));
}

export function planReplaceEvidenceLinks(input: {
  datasetId: string;
  ownerType: string;
  ownerId: string;
  evidenceIds: string[];
}): ReplaceEvidenceLinksPlan {
  const statements: EvidenceLinkStatement[] = [
    {
      sql: "DELETE FROM world_evidence_links WHERE dataset_id = %s AND owner_type = %s AND owner_id = %s",
      params: [input.datasetId, input.ownerType, input.ownerId],
    },
  ];
  input.evidenceIds.forEach((evidenceId, index) => {
    statements.push({
      sql:
        "INSERT INTO world_evidence_links (dataset_id, owner_type, owner_id, evidence_id, ordinal) VALUES (%s, %s, %s, %s, %s) " +
        "ON CONFLICT (dataset_id, owner_type, owner_id, evidence_id) DO UPDATE SET ordinal = EXCLUDED.ordinal",
      params: [input.datasetId, input.ownerType, input.ownerId, evidenceId, index + 1],
    });
  });
  return {
    statements,
    inserted: input.evidenceIds.length,
  };
}

export function planDomainProfileMerge(input: {
  datasetId: string;
  nodeId: string;
  staged: Record<string, unknown>;
  existing?: Record<string, unknown> | null;
  evidenceIdByRaw: Record<string, string>;
  existingEvidenceIds?: Iterable<string>;
  now: string;
}): DomainProfileMergePlan {
  const existing = input.existing ?? null;
  const profileId = makeDomainProfileId(input.nodeId, requiredString(input.staged.domain, "domain"));
  const remappedRefs = remapSourceRefs(input.staged.source_refs_json, input.evidenceIdByRaw);
  const mergedSourceRefs = mergeUniqueStrings(existing ? asArray(existing.source_refs_json) : [], remappedRefs);
  const sourceRefs = filterExistingEvidenceIds(mergedSourceRefs, input.existingEvidenceIds ?? mergedSourceRefs);
  const payload = {
    dataset_id: input.datasetId,
    id: profileId,
    node_id: input.nodeId,
    domain: input.staged.domain,
    school_stages_json: mergeUniqueStrings(existing ? asArray(existing.school_stages_json) : [], asArray(pythonOr(input.staged.school_stages_json, []))),
    curriculum_roles_json: mergeUniqueStrings(existing ? asArray(existing.curriculum_roles_json) : [], asArray(pythonOr(input.staged.curriculum_roles_json, []))),
    source_refs_json: sourceRefs,
    properties_json: mergeJsonObjects(existing ? asRecord(existing.properties_json) : {}, asRecord(pythonOr(input.staged.properties_json, {}))),
    status: "active",
    created_at: existing ? pythonGet(existing, "created_at", input.staged.created_at) : input.staged.created_at,
    updated_at: input.now,
    notes: mergeTextBlocks(existing ? asString(existing.notes) : "", asString(pythonOr(input.staged.notes, ""))),
  };

  return {
    payload,
    evidence_links: planReplaceEvidenceLinks({
      datasetId: input.datasetId,
      ownerType: "domain_profile",
      ownerId: profileId,
      evidenceIds: sourceRefs,
    }),
  };
}

export function planMentionMerge(input: {
  datasetId: string;
  lessonRunId: string;
  staged: Record<string, unknown>;
  nodeMap: Record<string, string>;
  evidenceIdByRaw: Record<string, string>;
  now: string;
}): MentionMergePlan {
  const targetRawId = requiredString(input.staged.target_raw_id, "target_raw_id");
  const targetId = input.nodeMap[targetRawId] ?? targetRawId;
  const mentionId = makeMentionId(input.lessonRunId, requiredString(input.staged.raw_mention_id, "raw_mention_id"), requiredString(input.staged.target_type, "target_type"), targetId);
  const sourceRefs = remapSourceRefs(input.staged.source_refs_json, input.evidenceIdByRaw);
  const payload = {
    dataset_id: input.datasetId,
    id: mentionId,
    source_type: input.staged.source_type,
    source_id: input.staged.source_id,
    anchor_ref: input.staged.anchor_ref,
    target_type: input.staged.target_type,
    target_id: targetId,
    role: input.staged.role,
    source_refs_json: sourceRefs,
    confidence: input.staged.confidence,
    properties_json: asRecord(pythonOr(input.staged.properties_json, {})),
    created_at: input.staged.created_at,
    updated_at: input.now,
  };

  return {
    payload,
    evidence_links: planReplaceEvidenceLinks({
      datasetId: input.datasetId,
      ownerType: "mention",
      ownerId: mentionId,
      evidenceIds: sourceRefs,
    }),
  };
}

export function planNodeCardMerge(input: {
  datasetId: string;
  staged: Record<string, unknown>;
  nodeMap: Record<string, string>;
  evidenceIdByRaw: Record<string, string>;
  now: string;
}): NodeCardMergePlan | null {
  const rawNodeId = requiredString(input.staged.raw_node_id, "raw_node_id");
  const nodeId = input.nodeMap[rawNodeId];
  if (!nodeId) return null;

  const rawCardId = requiredString(input.staged.raw_card_id, "raw_card_id");
  const sourceRefs = remapSourceRefs(input.staged.source_refs_json, input.evidenceIdByRaw);
  const sections = remapCardSections(input.staged.sections_json, input.evidenceIdByRaw);
  const payload = {
    dataset_id: input.datasetId,
    node_id: nodeId,
    id: rawCardId,
    title: input.staged.title,
    summary: input.staged.summary,
    source_refs_json: sourceRefs,
    sections_json: sections,
    properties_json: asRecord(pythonOr(input.staged.properties_json, {})),
    status: "active",
    created_at: input.staged.created_at,
    updated_at: input.now,
  };

  return {
    payload,
    evidence_links: planReplaceEvidenceLinks({
      datasetId: input.datasetId,
      ownerType: "node_card",
      ownerId: rawCardId,
      evidenceIds: sourceRefs,
    }),
    section_evidence_links: sections.map((section, sectionIndex) => {
      const sectionId = String(pythonOr(section.id, `section-${sectionIndex}`)).trim();
      const ownerId = `${rawCardId}:${sectionId}`;
      return {
        section_id: sectionId,
        owner_id: ownerId,
        evidence_links: planReplaceEvidenceLinks({
          datasetId: input.datasetId,
          ownerType: "node_card_section",
          ownerId,
          evidenceIds: remapSourceRefs(section.source_refs, input.evidenceIdByRaw),
        }),
      };
    }),
  };
}

export function planEdgeMerge(input: {
  datasetId: string;
  staged: Record<string, unknown>;
  nodeMap: Record<string, string>;
  evidenceIdByRaw: Record<string, string>;
  now: string;
}): EdgeMergePlan | null {
  const fromId = input.nodeMap[requiredString(input.staged.from_raw_node_id, "from_raw_node_id")];
  const toId = input.nodeMap[requiredString(input.staged.to_raw_node_id, "to_raw_node_id")];
  if (!fromId || !toId) return null;

  const edgeType = requiredString(input.staged.type, "type");
  const edgeId = makeEdgeId(fromId, edgeType, toId);
  const sourceRefs = remapSourceRefs(input.staged.source_refs_json, input.evidenceIdByRaw);
  const payload = {
    dataset_id: input.datasetId,
    id: edgeId,
    type: edgeType,
    from_id: fromId,
    to_id: toId,
    directionality: input.staged.directionality,
    confidence: input.staged.confidence,
    source_refs_json: sourceRefs,
    properties_json: asRecord(pythonOr(input.staged.properties_json, {})),
    status: "active",
    created_at: input.staged.created_at,
    updated_at: input.now,
    notes: asString(pythonOr(input.staged.notes, "")),
  };

  return {
    payload,
    evidence_links: planReplaceEvidenceLinks({
      datasetId: input.datasetId,
      ownerType: "edge",
      ownerId: edgeId,
      evidenceIds: sourceRefs,
    }),
  };
}

export function planEvidenceMerge(input: {
  datasetId: string;
  lessonRunId: string;
  staged: Record<string, unknown>;
  now: string;
}): EvidenceMergePlan {
  const rawEvidenceId = requiredString(input.staged.raw_evidence_id, "raw_evidence_id");
  const anchorRef = requiredString(input.staged.anchor_ref, "anchor_ref");
  const excerpt = requiredString(input.staged.excerpt, "excerpt");
  const evidenceId = makeEvidenceId(input.lessonRunId, rawEvidenceId, anchorRef, excerpt);
  return {
    raw_evidence_id: rawEvidenceId,
    evidence_id: evidenceId,
    payload: {
      dataset_id: input.datasetId,
      id: evidenceId,
      source_type: input.staged.source_type,
      source_id: input.staged.source_id,
      anchor_ref: anchorRef,
      source_path: input.staged.source_path,
      page_start: input.staged.page_start,
      page_end: input.staged.page_end,
      excerpt,
      locator: input.staged.locator,
      modality: input.staged.modality,
      extraction_method: input.staged.extraction_method,
      normalized_claims_json: asArray(pythonOr(input.staged.normalized_claims_json, [])),
      properties_json: asRecord(pythonOr(input.staged.properties_json, {})),
      created_at: input.staged.created_at,
      updated_at: input.now,
    },
  };
}

function sequenceMatcherRatio(left: string, right: string): number {
  if (left.length === 0 && right.length === 0) return 1;
  const matches = countMatchingBlockCharacters(left, 0, left.length, right, 0, right.length);
  return (2 * matches) / (left.length + right.length);
}

function countMatchingBlockCharacters(left: string, leftStart: number, leftEnd: number, right: string, rightStart: number, rightEnd: number): number {
  const match = findLongestMatch(left, leftStart, leftEnd, right, rightStart, rightEnd);
  if (match.size === 0) return 0;
  return (
    countMatchingBlockCharacters(left, leftStart, match.left, right, rightStart, match.right) +
    match.size +
    countMatchingBlockCharacters(left, match.left + match.size, leftEnd, right, match.right + match.size, rightEnd)
  );
}

function findLongestMatch(
  left: string,
  leftStart: number,
  leftEnd: number,
  right: string,
  rightStart: number,
  rightEnd: number,
): { left: number; right: number; size: number } {
  let bestLeft = leftStart;
  let bestRight = rightStart;
  let bestSize = 0;
  let previous = new Map<number, number>();
  for (let i = leftStart; i < leftEnd; i += 1) {
    const current = new Map<number, number>();
    for (let j = rightStart; j < rightEnd; j += 1) {
      if (left[i] !== right[j]) continue;
      const size = (previous.get(j - 1) ?? 0) + 1;
      current.set(j, size);
      const startLeft = i - size + 1;
      const startRight = j - size + 1;
      if (size > bestSize || (size === bestSize && (startLeft < bestLeft || (startLeft === bestLeft && startRight < bestRight)))) {
        bestLeft = startLeft;
        bestRight = startRight;
        bestSize = size;
      }
    }
    previous = current;
  }
  return { left: bestLeft, right: bestRight, size: bestSize };
}

function asRecord(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? value : {};
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asOptionalString(value: unknown): string | null | undefined {
  return typeof value === "string" ? value : null;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Missing required field '${name}'.`);
  return value;
}

function makeStagedNodePayload(row: Record<string, unknown>, now: string): Record<string, unknown> {
  const normalizedSubkind = normalizeNodeSubkind(String(row.kind ?? ""), row.subkind);
  let properties = addNodeSubkindClassification(asRecord(pythonOr(row.properties_json, {})), normalizedSubkind);
  const semanticKey = asOptionalString(row.semantic_key);
  if (semanticKey) properties.semantic_key = semanticKey;
  return {
    id: row.raw_node_id,
    name: row.name,
    kind: row.kind,
    subkind: normalizedSubkind.primary,
    definition: row.definition,
    aliases: asArray(pythonOr(row.aliases_json, [])),
    domains: asArray(pythonOr(row.domains_json, [])),
    knowledge_form: asArray(pythonOr(row.knowledge_form_json, [])),
    learning_mode: asArray(pythonOr(row.learning_mode_json, [])),
    scope: row.scope,
    properties,
    external_ids: asRecord(pythonOr(row.external_ids_json, {})),
    tags: asArray(pythonOr(row.tags_json, [])),
    semantic_key: semanticKey,
    embedding: parseEmbedding(row.embedding),
    status: "active",
    created_at: row.created_at,
    updated_at: now,
    notes: asString(pythonOr(row.notes, "")),
  };
}

function makeExistingNodePayload(row: Record<string, unknown>, now: string): Record<string, unknown> {
  const normalizedSubkind = normalizeNodeSubkind(String(row.kind ?? ""), row.subkind);
  const properties = addNodeSubkindClassification(asRecord(row.properties_json), normalizedSubkind);
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    subkind: normalizedSubkind.primary,
    definition: row.definition,
    aliases: asArray(row.aliases_json),
    domains: asArray(row.domains_json),
    knowledge_form: asArray(row.knowledge_form_json),
    learning_mode: asArray(row.learning_mode_json),
    scope: row.scope,
    properties,
    external_ids: asRecord(row.external_ids_json),
    tags: asArray(row.tags_json),
    embedding: parseEmbedding(row.embedding),
    created_at: pythonGet(row, "created_at", now),
    notes: pythonGet(row, "notes", ""),
  };
}

function rawSubkindLabels(...values: unknown[]): string[] {
  const result: string[] = [];
  for (const value of values) {
    const raw = asString(value).trim();
    if (!raw) continue;
    const normalized = normalizeNodeSubkind(null, raw).primary;
    if (normalized !== raw) result.push(raw);
  }
  return result;
}

function pythonGet(record: Record<string, unknown>, key: string, defaultValue: unknown): unknown {
  return Object.prototype.hasOwnProperty.call(record, key) ? record[key] : defaultValue;
}

function pythonOr(...values: unknown[]): unknown {
  return values.find(pythonTruthy);
}

function pythonTruthy(value: unknown): boolean {
  if (value === null || value === undefined || value === false || value === "") return false;
  if (typeof value === "number") return value !== 0 && !Number.isNaN(value);
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === "object") return Object.keys(value).length > 0;
  return true;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
