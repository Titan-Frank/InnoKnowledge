import { makeMergeRunId } from "../shared/knowledge.js";
import { makeDomainProfileId } from "../shared/pathing.js";
import {
  makeCanonicalCandidate,
  planDomainProfileMerge,
  planEdgeMerge,
  planEvidenceMerge,
  planMentionMerge,
  planNodeCardMerge,
  planStagedNodeMerge,
  type CanonicalNodeCandidate,
  type DomainProfileMergePlan,
  type EdgeMergePlan,
  type EvidenceMergePlan,
  type MentionMergePlan,
  type NodeCardMergePlan,
  type StagedNodeMergePlan,
} from "./merge-nodes.js";

export type MergeLessonStats = {
  nodes_created: number;
  nodes_matched: number;
  nodes_review: number;
  edges_upserted: number;
  domain_profiles_upserted: number;
  mentions_upserted: number;
  evidence_upserted: number;
  evidence_links_upserted: number;
  node_cards_upserted: number;
};

export type StagedLessonRows = {
  nodes?: Array<Record<string, unknown>>;
  evidence?: Array<Record<string, unknown>>;
  edges?: Array<Record<string, unknown>>;
  domain_profiles?: Array<Record<string, unknown>>;
  mentions?: Array<Record<string, unknown>>;
  node_cards?: Array<Record<string, unknown>>;
};

export type StagedLessonMergePlan = {
  lesson_run_id: string;
  node_map: Record<string, string>;
  evidence_id_by_raw: Record<string, string>;
  nodes: StagedNodeMergePlan[];
  evidence: EvidenceMergePlan[];
  edges: EdgeMergePlan[];
  domain_profiles: DomainProfileMergePlan[];
  mentions: MentionMergePlan[];
  node_cards: NodeCardMergePlan[];
  stats: MergeLessonStats;
};

export type StagedLessonMergeInput = {
  lesson_run_id: string;
  staged: StagedLessonRows;
};

export type StagedLessonsMergePlan = {
  status: "success";
  merge_run_id: string | null;
  selection_json: string[];
  merged: number;
  lessons: StagedLessonMergePlan[];
  stats: MergeLessonStats;
  issues: unknown[];
};

export function emptyMergeLessonStats(): MergeLessonStats {
  return {
    nodes_created: 0,
    nodes_matched: 0,
    nodes_review: 0,
    edges_upserted: 0,
    domain_profiles_upserted: 0,
    mentions_upserted: 0,
    evidence_upserted: 0,
    evidence_links_upserted: 0,
    node_cards_upserted: 0,
  };
}

export function addMergeLessonStats(left: MergeLessonStats, right: MergeLessonStats): MergeLessonStats {
  return {
    nodes_created: left.nodes_created + right.nodes_created,
    nodes_matched: left.nodes_matched + right.nodes_matched,
    nodes_review: left.nodes_review + right.nodes_review,
    edges_upserted: left.edges_upserted + right.edges_upserted,
    domain_profiles_upserted: left.domain_profiles_upserted + right.domain_profiles_upserted,
    mentions_upserted: left.mentions_upserted + right.mentions_upserted,
    evidence_upserted: left.evidence_upserted + right.evidence_upserted,
    evidence_links_upserted: left.evidence_links_upserted + right.evidence_links_upserted,
    node_cards_upserted: left.node_cards_upserted + right.node_cards_upserted,
  };
}

export function planStagedLessonsMerge(input: {
  datasetId: string;
  lessons: StagedLessonMergeInput[];
  canonicalNodes: CanonicalNodeCandidate[];
  mergeRunId?: string;
  existingDomainProfilesById?: Record<string, Record<string, unknown>>;
  existingEvidenceIds?: Iterable<string>;
  similarityThreshold?: number;
  embeddingThreshold?: number;
  reviewThreshold?: number;
  now: string;
}): StagedLessonsMergePlan {
  const selection = input.lessons.map((lesson) => lesson.lesson_run_id);
  if (selection.length === 0) {
    return {
      status: "success",
      merge_run_id: null,
      selection_json: [],
      merged: 0,
      lessons: [],
      stats: emptyMergeLessonStats(),
      issues: [],
    };
  }

  const mergeRunId = input.mergeRunId ?? makeMergeRunId(input.datasetId, selection);
  const canonicalNodes = cloneCanonicalCandidates(input.canonicalNodes);
  const existingDomainProfilesById: Record<string, Record<string, unknown>> = { ...(input.existingDomainProfilesById ?? {}) };
  const existingEvidenceIds = new Set(input.existingEvidenceIds ?? []);
  let stats = emptyMergeLessonStats();
  const lessons: StagedLessonMergePlan[] = [];

  for (const lesson of input.lessons) {
    const plan = planStagedLessonMerge({
      datasetId: input.datasetId,
      mergeRunId,
      lessonRunId: lesson.lesson_run_id,
      staged: lesson.staged,
      canonicalNodes,
      existingDomainProfilesById,
      existingEvidenceIds,
      similarityThreshold: input.similarityThreshold,
      embeddingThreshold: input.embeddingThreshold,
      reviewThreshold: input.reviewThreshold,
      now: input.now,
    });
    lessons.push(plan);
    stats = addMergeLessonStats(stats, plan.stats);

    for (const nodePlan of plan.nodes) {
      if (nodePlan.canonical_candidate_to_append) canonicalNodes.push(nodePlan.canonical_candidate_to_append);
    }
    for (const evidencePlan of plan.evidence) {
      existingEvidenceIds.add(evidencePlan.evidence_id);
    }
    for (const profilePlan of plan.domain_profiles) {
      const id = stringValue(profilePlan.payload.id);
      if (id) existingDomainProfilesById[id] = profilePlan.payload;
    }
  }

  return {
    status: "success",
    merge_run_id: mergeRunId,
    selection_json: selection,
    merged: lessons.length,
    lessons,
    stats,
    issues: [],
  };
}

export function planStagedLessonMerge(input: {
  datasetId: string;
  mergeRunId: string;
  lessonRunId: string;
  staged: StagedLessonRows;
  canonicalNodes: CanonicalNodeCandidate[];
  existingDomainProfilesById?: Record<string, Record<string, unknown>>;
  existingEvidenceIds?: Iterable<string>;
  similarityThreshold?: number;
  embeddingThreshold?: number;
  reviewThreshold?: number;
  now: string;
}): StagedLessonMergePlan {
  const stats = emptyMergeLessonStats();
  const canonicalNodes = input.canonicalNodes.map((candidate) => ({
    ...candidate,
    payload: { ...candidate.payload },
    terms: new Set(candidate.terms),
    embedding: [...candidate.embedding],
  }));
  const nodeMap: Record<string, string> = {};
  const evidenceIdByRaw: Record<string, string> = {};
  const knownEvidenceIds = new Set(input.existingEvidenceIds ?? []);

  const nodes: StagedNodeMergePlan[] = [];
  for (const row of input.staged.nodes ?? []) {
    const plan = planStagedNodeMerge({
      datasetId: input.datasetId,
      mergeRunId: input.mergeRunId,
      lessonRunId: input.lessonRunId,
      staged: row,
      canonicalNodes,
      similarityThreshold: input.similarityThreshold,
      embeddingThreshold: input.embeddingThreshold,
      reviewThreshold: input.reviewThreshold,
      now: input.now,
    });
    nodes.push(plan);
    Object.assign(nodeMap, plan.node_map_entry);
    stats.nodes_created += plan.stats_delta.nodes_created;
    stats.nodes_matched += plan.stats_delta.nodes_matched;
    stats.nodes_review += plan.stats_delta.nodes_review;
    if (plan.canonical_candidate_to_append) canonicalNodes.push(plan.canonical_candidate_to_append);
  }

  const evidence: EvidenceMergePlan[] = [];
  for (const row of input.staged.evidence ?? []) {
    const plan = planEvidenceMerge({
      datasetId: input.datasetId,
      lessonRunId: input.lessonRunId,
      staged: row,
      now: input.now,
    });
    evidence.push(plan);
    evidenceIdByRaw[plan.raw_evidence_id] = plan.evidence_id;
    knownEvidenceIds.add(plan.evidence_id);
    stats.evidence_upserted += 1;
  }

  const edges: EdgeMergePlan[] = [];
  for (const row of input.staged.edges ?? []) {
    const plan = planEdgeMerge({
      datasetId: input.datasetId,
      staged: row,
      nodeMap,
      evidenceIdByRaw,
      now: input.now,
    });
    if (!plan) continue;
    edges.push(plan);
    stats.edges_upserted += 1;
    stats.evidence_links_upserted += plan.evidence_links.inserted;
  }

  const domainProfiles: DomainProfileMergePlan[] = [];
  for (const row of input.staged.domain_profiles ?? []) {
    const rawNodeId = stringValue(row.raw_node_id);
    const nodeId = rawNodeId ? nodeMap[rawNodeId] : undefined;
    const domain = stringValue(row.domain);
    if (!nodeId || !domain) continue;
    const profileId = makeDomainProfileId(nodeId, domain);
    const plan = planDomainProfileMerge({
      datasetId: input.datasetId,
      nodeId,
      staged: row,
      existing: input.existingDomainProfilesById?.[profileId] ?? null,
      evidenceIdByRaw,
      existingEvidenceIds: knownEvidenceIds,
      now: input.now,
    });
    domainProfiles.push(plan);
    stats.domain_profiles_upserted += 1;
    stats.evidence_links_upserted += plan.evidence_links.inserted;
  }

  const mentions: MentionMergePlan[] = [];
  for (const row of input.staged.mentions ?? []) {
    const plan = planMentionMerge({
      datasetId: input.datasetId,
      lessonRunId: input.lessonRunId,
      staged: row,
      nodeMap,
      evidenceIdByRaw,
      now: input.now,
    });
    mentions.push(plan);
    stats.mentions_upserted += 1;
    stats.evidence_links_upserted += plan.evidence_links.inserted;
  }

  const nodeCards: NodeCardMergePlan[] = [];
  for (const row of input.staged.node_cards ?? []) {
    const plan = planNodeCardMerge({
      datasetId: input.datasetId,
      staged: row,
      nodeMap,
      evidenceIdByRaw,
      now: input.now,
    });
    if (!plan) continue;
    nodeCards.push(plan);
    stats.node_cards_upserted += 1;
    stats.evidence_links_upserted += plan.evidence_links.inserted;
    for (const section of plan.section_evidence_links) {
      stats.evidence_links_upserted += section.evidence_links.inserted;
    }
  }

  return {
    lesson_run_id: input.lessonRunId,
    node_map: nodeMap,
    evidence_id_by_raw: evidenceIdByRaw,
    nodes,
    evidence,
    edges,
    domain_profiles: domainProfiles,
    mentions,
    node_cards: nodeCards,
    stats,
  };
}

export function canonicalCandidatesFromRows(rows: Array<Record<string, unknown>>): CanonicalNodeCandidate[] {
  return rows.map(makeCanonicalCandidate);
}

function cloneCanonicalCandidates(candidates: CanonicalNodeCandidate[]): CanonicalNodeCandidate[] {
  return candidates.map((candidate) => ({
    ...candidate,
    payload: { ...candidate.payload },
    terms: new Set(candidate.terms),
    embedding: [...candidate.embedding],
  }));
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}
