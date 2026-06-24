import {
  VALID_CURRICULUM_ROLES,
  VALID_DOMAINS,
  VALID_KNOWLEDGE_FORMS,
  VALID_NODE_KINDS,
  VALID_SCHOOL_STAGES,
  normalizeLearningModes,
  requireValidEdgeType,
} from "../shared/knowledge.js";
import { normalizeTerm, uniqueStable } from "../shared/pathing.js";

type RawRecord = Record<string, unknown>;

export type NormalizedNode = {
  raw_node_id: string;
  name: string;
  kind: string;
  subkind: string | null;
  definition: string;
  aliases_json: string[];
  domains_json: string[];
  knowledge_form_json: string[];
  learning_mode_json: string[];
  scope: string;
  properties_json: RawRecord;
  external_ids_json: RawRecord;
  tags_json: string[];
  semantic_key: string;
  embedding_json: unknown;
  source_refs_json: string[];
  status: string;
  notes: string;
};

export type NormalizedEdge = {
  raw_edge_id: string;
  type: string;
  from_raw_node_id: string;
  to_raw_node_id: string;
  directionality: string;
  confidence: number;
  source_refs_json: string[];
  properties_json: RawRecord;
  status: string;
  notes: string;
};

export type NormalizedDomainProfile = {
  raw_profile_id: string;
  raw_node_id: string;
  domain: string;
  school_stages_json: string[];
  curriculum_roles_json: string[];
  source_refs_json: string[];
  properties_json: RawRecord;
  status: string;
  notes: string;
};

export type NormalizedMention = {
  raw_mention_id: string;
  source_type: string;
  source_id: string;
  anchor_ref: string;
  target_type: string;
  target_raw_id: string;
  role: string;
  source_refs_json: string[];
  confidence: number;
  properties_json: RawRecord;
};

export type NormalizedEvidence = {
  raw_evidence_id: string;
  source_type: string;
  source_id: string;
  anchor_ref: string;
  source_path: string;
  page_start: unknown;
  page_end: unknown;
  excerpt: string;
  locator: string;
  modality: string;
  extraction_method: string;
  normalized_claims_json: string[];
  properties_json: RawRecord;
};

export type NormalizedNodeCardSection = {
  id: string;
  title: string;
  section_type: string;
  content: string[];
  source_refs: string[];
  properties: RawRecord;
};

export type NormalizedNodeCard = {
  raw_card_id: string;
  raw_node_id: string;
  title: string;
  summary: string;
  source_refs_json: string[];
  sections_json: NormalizedNodeCardSection[];
  properties_json: RawRecord;
  status: string;
};

export type LessonArtifactInput = {
  nodes: RawRecord[];
  edges: RawRecord[];
  domainProfiles: RawRecord[];
  mentions: RawRecord[];
  evidence: RawRecord[];
  nodeCards: RawRecord[];
};

export type NormalizedLessonArtifacts = {
  nodes: NormalizedNode[];
  edges: NormalizedEdge[];
  domain_profiles: NormalizedDomainProfile[];
  mentions: NormalizedMention[];
  evidence: NormalizedEvidence[];
  node_cards: NormalizedNodeCard[];
  counts: {
    nodes: number;
    edges: number;
    domain_profiles: number;
    mentions: number;
    evidence: number;
    node_cards: number;
  };
};

export function normalizeLessonArtifacts(input: LessonArtifactInput, bookId: string, batchAnchor: string): NormalizedLessonArtifacts {
  const nodes = normalizeNodes(input.nodes);
  const edges = normalizeEdges(input.edges);
  const domainProfiles = normalizeDomainProfiles(input.domainProfiles);
  const mentions = normalizeMentions(input.mentions, bookId, batchAnchor);
  const evidence = normalizeEvidence(input.evidence, bookId, batchAnchor);
  const nodeCards = normalizeNodeCards(input.nodeCards);
  return {
    nodes,
    edges,
    domain_profiles: domainProfiles,
    mentions,
    evidence,
    node_cards: nodeCards,
    counts: {
      nodes: nodes.length,
      edges: edges.length,
      domain_profiles: domainProfiles.length,
      mentions: mentions.length,
      evidence: evidence.length,
      node_cards: nodeCards.length,
    },
  };
}

export function normalizeNodes(nodes: RawRecord[]): NormalizedNode[] {
  return nodes.map((node) => {
    const rawNodeId = stringValue(pickPythonOr(node.id, node.raw_node_id)).trim();
    const name = stringValue(pickPythonOr(node.name, node.canonical_name)).trim();
    const kind = stringValue(pickPythonOr(node.kind, node.node_kind)).trim();
    const definition = stringValue(node.definition).trim();
    if (!rawNodeId || !name || !definition) {
      throw new Error(`Invalid node payload: missing id/name/definition for ${JSON.stringify(node)}`);
    }
    if (!VALID_NODE_KINDS.has(kind)) {
      throw new Error(`Invalid node kind '${kind}' for node '${rawNodeId}'.`);
    }

    let domains = uniqueEnum(node.domains, VALID_DOMAINS);
    if (domains.length === 0) domains = ["general"];

    return {
      raw_node_id: rawNodeId,
      name,
      kind,
      subkind: stringValue(pickPythonOr(node.subkind, node.node_subkind)).trim() || null,
      definition,
      aliases_json: uniqueStrings(node.aliases),
      domains_json: domains,
      knowledge_form_json: uniqueEnum(node.knowledge_form, VALID_KNOWLEDGE_FORMS),
      learning_mode_json: normalizeLearningModes(toStringList(node.learning_mode), kind),
      scope: stringValue(node.scope).trim() || "domain-specific",
      properties_json: recordValue(node.properties),
      external_ids_json: recordValue(node.external_ids),
      tags_json: uniqueStrings(node.tags),
      semantic_key: stringValue(pickPythonOr(node.semantic_key, normalizeTerm(name))),
      embedding_json: node.embedding_json ?? null,
      source_refs_json: uniqueStrings(node.source_refs),
      status: stringValue(pickPythonOr(node.status, "draft")),
      notes: stringValue(node.notes).trim(),
    };
  });
}

export function normalizeEdges(edges: RawRecord[]): NormalizedEdge[] {
  return edges.map((edge) => {
    const rawEdgeId = stringValue(pickPythonOr(edge.id, edge.raw_edge_id)).trim();
    if (!rawEdgeId) throw new Error("Edge missing id.");
    return {
      raw_edge_id: rawEdgeId,
      type: requireValidEdgeType(stringValue(pickPythonOr(edge.type, edge.edge_type)).trim()),
      from_raw_node_id: stringValue(pickPythonOr(edge.from, edge.from_raw_node_id)).trim(),
      to_raw_node_id: stringValue(pickPythonOr(edge.to, edge.to_raw_node_id)).trim(),
      directionality: stringValue(pickPythonOr(edge.directionality, "directed")),
      confidence: numberValue(pickPythonOr(edge.confidence, 0.8)),
      source_refs_json: uniqueStrings(edge.source_refs),
      properties_json: recordValue(edge.properties),
      status: stringValue(pickPythonOr(edge.status, "draft")),
      notes: stringValue(edge.notes).trim(),
    };
  });
}

export function normalizeDomainProfiles(domainProfiles: RawRecord[]): NormalizedDomainProfile[] {
  return domainProfiles.map((profile) => {
    const rawProfileId = stringValue(pickPythonOr(profile.id, profile.raw_profile_id)).trim();
    const rawNodeId = stringValue(pickPythonOr(profile.node_id, profile.raw_node_id)).trim();
    const domain = stringValue(profile.domain).trim();
    if (!rawProfileId || !rawNodeId || !VALID_DOMAINS.has(domain)) {
      throw new Error(`Invalid domain profile payload: ${JSON.stringify(profile)}`);
    }
    return {
      raw_profile_id: rawProfileId,
      raw_node_id: rawNodeId,
      domain,
      school_stages_json: uniqueEnum(profile.school_stages, VALID_SCHOOL_STAGES),
      curriculum_roles_json: uniqueEnum(profile.curriculum_roles, VALID_CURRICULUM_ROLES),
      source_refs_json: uniqueStrings(profile.source_refs),
      properties_json: recordValue(profile.properties),
      status: stringValue(pickPythonOr(profile.status, "draft")),
      notes: stringValue(profile.notes).trim(),
    };
  });
}

export function normalizeMentions(mentions: RawRecord[], bookId: string, anchor: string): NormalizedMention[] {
  return mentions.map((mention) => {
    const rawMentionId = stringValue(pickPythonOr(mention.id, mention.raw_mention_id)).trim();
    if (!rawMentionId) throw new Error("Mention missing id.");
    return {
      raw_mention_id: rawMentionId,
      source_type: stringValue(pickPythonOr(mention.source_type, "textbook")),
      source_id: stringValue(pickPythonOr(mention.source_id, bookId)),
      anchor_ref: stringValue(pickPythonOr(mention.anchor_ref, anchor)),
      target_type: stringValue(pickPythonOr(mention.target_type, "node")),
      target_raw_id: stringValue(pickPythonOr(mention.target_id, mention.target_raw_id)).trim(),
      role: stringValue(pickPythonOr(mention.role, "mentions")),
      source_refs_json: uniqueStrings(mention.source_refs),
      confidence: numberValue(pickPythonOr(mention.confidence, 0.8)),
      properties_json: recordValue(mention.properties),
    };
  });
}

export function normalizeEvidence(evidence: RawRecord[], bookId: string, anchor: string): NormalizedEvidence[] {
  return evidence.map((item) => {
    const rawEvidenceId = stringValue(pickPythonOr(item.id, item.raw_evidence_id)).trim();
    if (!rawEvidenceId) throw new Error("Evidence missing id.");
    return {
      raw_evidence_id: rawEvidenceId,
      source_type: stringValue(pickPythonOr(item.source_type, "textbook")),
      source_id: stringValue(pickPythonOr(item.source_id, bookId)),
      anchor_ref: stringValue(pickPythonOr(item.anchor_ref, anchor)),
      source_path: stringValue(pickPythonOr(item.source_path, "")),
      page_start: item.page_start ?? null,
      page_end: item.page_end ?? null,
      excerpt: stringValue(item.excerpt).trim(),
      locator: stringValue(item.locator).trim(),
      modality: stringValue(pickPythonOr(item.modality, "text")),
      extraction_method: stringValue(pickPythonOr(item.extraction_method, "ocr")),
      normalized_claims_json: trimmedStrings(item.normalized_claims),
      properties_json: recordValue(item.properties),
    };
  });
}

export function normalizeNodeCards(nodeCards: RawRecord[]): NormalizedNodeCard[] {
  return nodeCards.map((card) => {
    const rawCardId = stringValue(pickPythonOr(card.id, card.raw_card_id)).trim();
    const rawNodeId = stringValue(pickPythonOr(card.node_id, card.raw_node_id)).trim();
    if (!rawCardId || !rawNodeId) {
      throw new Error(`Invalid node card payload: ${JSON.stringify(card)}`);
    }
    const sections = asList(card.sections)
      .filter(isRecord)
      .map((section) => ({
        id: stringValue(pickPythonOr(section.id, "section")).trim(),
        title: stringValue(section.title).trim(),
        section_type: stringValue(pickPythonOr(section.section_type, "other")).trim(),
        content: trimmedStrings(section.content),
        source_refs: uniqueStrings(section.source_refs),
        properties: recordValue(section.properties),
      }));

    return {
      raw_card_id: rawCardId,
      raw_node_id: rawNodeId,
      title: stringValue(card.title).trim(),
      summary: stringValue(card.summary).trim(),
      source_refs_json: uniqueStrings(card.source_refs),
      sections_json: sections,
      properties_json: recordValue(card.properties),
      status: stringValue(pickPythonOr(card.status, "draft")),
    };
  });
}

export function buildEmbeddingText(node: Pick<NormalizedNode, "aliases_json" | "definition" | "domains_json" | "name">): string {
  const aliases = node.aliases_json.join(", ");
  const domains = node.domains_json.join(", ");
  return [node.name, node.definition, aliases, domains].filter((part) => part.length > 0).join("\n");
}

function asList(value: unknown): unknown[] {
  if (value === null || value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function recordValue(value: unknown): RawRecord {
  return isRecord(value) ? value : {};
}

function uniqueEnum(value: unknown, allowed: Set<string>): string[] {
  return uniqueStable(trimmedStrings(value).filter((item) => allowed.has(item)));
}

function uniqueStrings(value: unknown): string[] {
  return uniqueStable(trimmedStrings(value));
}

function trimmedStrings(value: unknown): string[] {
  return asList(value)
    .map((item) => stringValue(item).trim())
    .filter((item) => item.length > 0);
}

function toStringList(value: unknown): string[] {
  return asList(value).map((item) => stringValue(item));
}

function pickPythonOr(...values: unknown[]): unknown {
  for (const value of values) {
    if (isPythonTruthy(value)) return value;
  }
  return values.length > 0 ? values[values.length - 1] : undefined;
}

function isPythonTruthy(value: unknown): boolean {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === "number") return value !== 0 && !Number.isNaN(value);
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  return true;
}

function stringValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value);
}

function numberValue(value: unknown): number {
  return Number(value);
}

function isRecord(value: unknown): value is RawRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
