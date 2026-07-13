import { makeCanonicalCandidate, scoreNodeMatch } from "../merge/merge-nodes.js";
import { makeStableSuffix, normalizeTerm, uniqueStable } from "../shared/pathing.js";

export type InterdisciplinaryNodeInput = {
  id: string;
  name: string;
  definition: string;
  kind: string;
  subkind?: string | null;
  aliases: string[];
  domains: string[];
  tags: string[];
  bridgeTags: string[];
  scope?: string | null;
  bridgeRole?: "semantic_bridge" | "method_bridge" | "analogy_bridge" | null;
  semanticKey?: string | null;
  embedding: number[];
  evidenceRefs: string[];
};

export type InterdisciplinaryEdgeInput = {
  id: string;
  fromId: string;
  toId: string;
  type: string;
  status?: string;
};

export type InterdisciplinaryCandidatePlan = {
  candidate_id: string;
  candidate_kind: "node_alignment" | "relation" | "bridge_path";
  from_node_id: string;
  to_node_id: string;
  bridge_node_id: string | null;
  proposed_edge_type: string | null;
  directionality: "directed" | "undirected" | null;
  proposed_path: Array<{
    from_node_id: string;
    to_node_id: string;
    relation_type: string;
    directionality: "directed" | "undirected";
    evidence_refs: string[];
  }>;
  confidence: number;
  source_domains: string[];
  target_domains: string[];
  evidence_refs: string[];
  rationale: Record<string, unknown>;
};

export type InterdisciplinaryGraphSummary = {
  domain_count: number;
  bridge_node_count: number;
  cross_domain_edge_count: number;
  domains: Array<{ domain: string; node_count: number; bridge_node_count: number }>;
  domain_pairs: Array<{
    source_domain: string;
    target_domain: string;
    shared_node_count: number;
    cross_domain_edge_count: number;
  }>;
  bridge_nodes: Array<{
    node_id: string;
    name: string;
    kind: string;
    domains: string[];
    degree: number;
    evidence_count: number;
  }>;
};

export type InterdisciplinaryAnalysisPlan = {
  summary: InterdisciplinaryGraphSummary;
  candidates: InterdisciplinaryCandidatePlan[];
  alignment_candidates: number;
  relation_candidates: number;
  bridge_path_candidates: number;
};

export type InterdisciplinaryAnalysisOptions = {
  domains?: string[];
  minimumAlignmentScore?: number;
  minimumRelationScore?: number;
  maximumCandidates?: number;
  maximumBucketSize?: number;
  excludedCandidateIds?: Iterable<string>;
  blockedRelationNodePairs?: Iterable<readonly [string, string]>;
};

export function planInterdisciplinaryAnalysis(
  nodesInput: InterdisciplinaryNodeInput[],
  edgesInput: InterdisciplinaryEdgeInput[],
  options: InterdisciplinaryAnalysisOptions = {},
): InterdisciplinaryAnalysisPlan {
  const domainFilter = new Set(cleanStrings(options.domains ?? []));
  const nodes = nodesInput
    .map(normalizeNode)
    .filter((node) => node.domains.length > 0)
    .filter((node) => domainFilter.size === 0 || node.domains.some((domain) => domainFilter.has(domain)));
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const edges = edgesInput.filter((edge) => edge.status !== "deprecated" && nodeById.has(edge.fromId) && nodeById.has(edge.toId));
  const excludedCandidateIds = new Set(options.excludedCandidateIds ?? []);
  const blockedRelationPairs = new Set(
    [...(options.blockedRelationNodePairs ?? [])].map(([left, right]) => unorderedPairKey(left, right)),
  );
  const maximumCandidates = positiveInteger(options.maximumCandidates, 500);
  const maximumBucketSize = positiveInteger(options.maximumBucketSize, 40);
  const minimumAlignmentScore = clampScore(options.minimumAlignmentScore, 0.74);
  const minimumRelationScore = clampScore(options.minimumRelationScore, 0.58);
  const existingPairs = new Set(edges.map((edge) => unorderedPairKey(edge.fromId, edge.toId)));
  const candidates = new Map<string, InterdisciplinaryCandidatePlan>();
  const alignmentPairKeys = new Set<string>();
  const bridgePathPairKeys = new Set<string>();

  const alignmentBuckets = [
    ...bucketNodes(nodes, (node) => node.terms, "term", maximumBucketSize),
    ...bucketNodes(nodes, (node) => node.semanticKey ? [node.semanticKey] : [], "semantic", maximumBucketSize),
  ];

  for (const bucket of alignmentBuckets) {
    for (const [left, right] of pairs(bucket.nodes)) {
      if (!isCrossDomainPair(left, right) || left.kind !== right.kind) continue;
      const pairKey = unorderedPairKey(left.id, right.id);
      if (alignmentPairKeys.has(pairKey)) continue;
      const score = scoreNodeMatch(
        {
          kind: left.kind,
          subkind: left.subkind,
          name: left.name,
          aliases_json: left.aliases,
          semantic_key: left.semanticKey,
          embedding: left.embedding,
        },
        makeCanonicalCandidate({
          id: right.id,
          name: right.name,
          kind: right.kind,
          subkind: right.subkind,
          aliases_json: right.aliases,
          properties_json: right.semanticKey ? { semantic_key: right.semanticKey } : {},
          embedding: right.embedding,
        }),
      );
      if (score.score < minimumAlignmentScore) continue;
      const candidate = makeCandidate("node_alignment", left, right, {
        proposedEdgeType: null,
        directionality: null,
        confidence: score.score,
        rationale: {
          method: "cross_domain_identity_alignment",
          blocking_key: bucket.key,
          blocking_kind: bucket.kind,
          ...score.rationale,
          requires_review: true,
        },
      });
      if (excludedCandidateIds.has(candidate.candidate_id)) continue;
      candidates.set(candidate.candidate_id, candidate);
      alignmentPairKeys.add(pairKey);
    }
  }

  for (const bridge of nodes.filter(isBridgeNode)) {
    const bridgeSignals = cleanStrings([...bridge.bridgeTags, ...bridge.terms]);
    if (bridgeSignals.length === 0) continue;
    const endpoints = nodes.filter((node) => {
      if (node.id === bridge.id || isBridgeNode(node)) return false;
      return intersection(cleanStrings([...node.bridgeTags, ...node.tags]), bridgeSignals).length > 0;
    });
    for (const [left, right] of pairs(endpoints)) {
      if (!isCrossDomainPair(left, right)) continue;
      const pairKey = unorderedPairKey(left.id, right.id);
      if (alignmentPairKeys.has(pairKey) || blockedRelationPairs.has(pairKey)) continue;
      const leftSignals = intersection(cleanStrings([...left.bridgeTags, ...left.tags]), bridgeSignals);
      const rightSignals = intersection(cleanStrings([...right.bridgeTags, ...right.tags]), bridgeSignals);
      const evidenceCount = Math.min(left.evidenceRefs.length + bridge.evidenceRefs.length + right.evidenceRefs.length, 12);
      const confidence = Math.min(
        0.9,
        0.56 + Math.min(leftSignals.length + rightSignals.length, 4) * 0.06 + evidenceCount * 0.008,
      );
      if (confidence < minimumRelationScore) continue;
      const candidate = makeBridgePathCandidate(left, bridge, right, confidence, {
        method: "explicit_bridge_object",
        bridge_role: bridge.bridgeRole ?? (bridge.scope === "universal" ? "universal_object" : "multi_domain_object"),
        source_bridge_signals: leftSignals,
        target_bridge_signals: rightSignals,
        requires_review: true,
      });
      if (excludedCandidateIds.has(candidate.candidate_id)) continue;
      const previous = candidates.get(candidate.candidate_id);
      if (!previous || candidate.confidence > previous.confidence) candidates.set(candidate.candidate_id, candidate);
      bridgePathPairKeys.add(pairKey);
    }
  }

  const bridgeBuckets = bucketNodes(nodes, (node) => node.bridgeTags, "bridge_tag", maximumBucketSize);
  for (const bucket of bridgeBuckets) {
    for (const [left, right] of pairs(bucket.nodes)) {
      if (!isCrossDomainPair(left, right)) continue;
      const pairKey = unorderedPairKey(left.id, right.id);
      if (existingPairs.has(pairKey) || alignmentPairKeys.has(pairKey) || bridgePathPairKeys.has(pairKey) || blockedRelationPairs.has(pairKey)) continue;
      const sharedTags = intersection(left.bridgeTags, right.bridgeTags);
      const evidenceCount = Math.min(left.evidenceRefs.length + right.evidenceRefs.length, 8);
      const confidence = Math.min(0.82, 0.5 + Math.min(sharedTags.length, 3) * 0.08 + evidenceCount * 0.01);
      if (confidence < minimumRelationScore) continue;
      const candidate = makeCandidate("relation", left, right, {
        proposedEdgeType: "related_to",
        directionality: "undirected",
        confidence,
        rationale: {
          method: "shared_bridge_tags",
          blocking_key: bucket.key,
          shared_bridge_tags: sharedTags,
          direct_relation_evidence_verified: false,
          requires_review: true,
        },
      });
      if (excludedCandidateIds.has(candidate.candidate_id)) continue;
      const previous = candidates.get(candidate.candidate_id);
      if (!previous || candidate.confidence > previous.confidence) candidates.set(candidate.candidate_id, candidate);
    }
  }

  const ordered = [...candidates.values()]
    .sort((left, right) => right.confidence - left.confidence || left.candidate_id.localeCompare(right.candidate_id))
    .slice(0, maximumCandidates);

  return {
    summary: summarizeInterdisciplinaryGraph(nodes, edges),
    candidates: ordered,
    alignment_candidates: ordered.filter((candidate) => candidate.candidate_kind === "node_alignment").length,
    relation_candidates: ordered.filter((candidate) => candidate.candidate_kind === "relation").length,
    bridge_path_candidates: ordered.filter((candidate) => candidate.candidate_kind === "bridge_path").length,
  };
}

export function summarizeInterdisciplinaryGraph(
  nodesInput: InterdisciplinaryNodeInput[],
  edgesInput: InterdisciplinaryEdgeInput[],
): InterdisciplinaryGraphSummary {
  const nodes = nodesInput.map(normalizeNode).filter((node) => node.domains.length > 0);
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const degree = new Map(nodes.map((node) => [node.id, 0]));
  const domainCounts = new Map<string, number>();
  const bridgeCounts = new Map<string, number>();
  const pairCounts = new Map<string, { shared: number; edges: number }>();

  for (const node of nodes) {
    for (const domain of node.domains) domainCounts.set(domain, (domainCounts.get(domain) ?? 0) + 1);
    if (!isBridgeNode(node)) continue;
    for (const domain of node.domains) bridgeCounts.set(domain, (bridgeCounts.get(domain) ?? 0) + 1);
    for (const [left, right] of pairs(node.domains)) {
      const key = domainPairKey(left, right);
      const current = pairCounts.get(key) ?? { shared: 0, edges: 0 };
      current.shared += 1;
      pairCounts.set(key, current);
    }
  }

  let crossDomainEdgeCount = 0;
  for (const edge of edgesInput) {
    if (edge.status === "deprecated") continue;
    const from = nodeById.get(edge.fromId);
    const to = nodeById.get(edge.toId);
    if (!from || !to) continue;
    degree.set(from.id, (degree.get(from.id) ?? 0) + 1);
    degree.set(to.id, (degree.get(to.id) ?? 0) + 1);
    if (!isCrossDomainPair(from, to)) continue;
    crossDomainEdgeCount += 1;
    const seenPairs = new Set<string>();
    for (const sourceDomain of from.domains) {
      for (const targetDomain of to.domains) {
        if (sourceDomain === targetDomain) continue;
        const key = domainPairKey(sourceDomain, targetDomain);
        if (seenPairs.has(key)) continue;
        seenPairs.add(key);
        const current = pairCounts.get(key) ?? { shared: 0, edges: 0 };
        current.edges += 1;
        pairCounts.set(key, current);
      }
    }
  }

  const bridgeNodes = nodes
    .filter(isBridgeNode)
    .map((node) => ({
      node_id: node.id,
      name: node.name,
      kind: node.kind,
      domains: node.domains,
      degree: degree.get(node.id) ?? 0,
      evidence_count: node.evidenceRefs.length,
    }))
    .sort((left, right) => right.domains.length - left.domains.length || right.degree - left.degree || left.name.localeCompare(right.name));

  return {
    domain_count: domainCounts.size,
    bridge_node_count: bridgeNodes.length,
    cross_domain_edge_count: crossDomainEdgeCount,
    domains: [...domainCounts.entries()]
      .map(([domain, node_count]) => ({ domain, node_count, bridge_node_count: bridgeCounts.get(domain) ?? 0 }))
      .sort((left, right) => right.node_count - left.node_count || left.domain.localeCompare(right.domain)),
    domain_pairs: [...pairCounts.entries()]
      .map(([key, counts]) => {
        const [source_domain, target_domain] = key.split("\n");
        return { source_domain: source_domain!, target_domain: target_domain!, shared_node_count: counts.shared, cross_domain_edge_count: counts.edges };
      })
      .sort((left, right) =>
        right.shared_node_count - left.shared_node_count ||
        right.cross_domain_edge_count - left.cross_domain_edge_count ||
        left.source_domain.localeCompare(right.source_domain) ||
        left.target_domain.localeCompare(right.target_domain),
      ),
    bridge_nodes: bridgeNodes,
  };
}

type NormalizedNode = InterdisciplinaryNodeInput & {
  domains: string[];
  terms: string[];
  bridgeTags: string[];
};

function normalizeNode(node: InterdisciplinaryNodeInput): NormalizedNode {
  const aliases = cleanStrings(node.aliases);
  return {
    ...node,
    aliases,
    domains: cleanStrings(node.domains),
    tags: cleanStrings(node.tags),
    bridgeTags: cleanStrings(node.bridgeTags),
    evidenceRefs: cleanIdentifiers(node.evidenceRefs),
    definition: String(node.definition ?? "").trim(),
    scope: String(node.scope ?? "").trim() || null,
    bridgeRole: node.bridgeRole ?? null,
    terms: cleanStrings([node.name, ...aliases].map(normalizeTerm)),
  };
}

function makeCandidate(
  kind: "node_alignment" | "relation",
  leftInput: NormalizedNode,
  rightInput: NormalizedNode,
  input: {
    proposedEdgeType: string | null;
    directionality: "directed" | "undirected" | null;
    confidence: number;
    rationale: Record<string, unknown>;
  },
): InterdisciplinaryCandidatePlan {
  const [left, right] = leftInput.id.localeCompare(rightInput.id) <= 0 ? [leftInput, rightInput] : [rightInput, leftInput];
  return {
    candidate_id: `interdisciplinary:${kind}:${makeStableSuffix([kind, left.id, right.id], 12)}`,
    candidate_kind: kind,
    from_node_id: left.id,
    to_node_id: right.id,
    bridge_node_id: null,
    proposed_edge_type: input.proposedEdgeType,
    directionality: input.directionality,
    proposed_path: [],
    confidence: input.confidence,
    source_domains: left.domains,
    target_domains: right.domains,
    evidence_refs: uniqueStable([...left.evidenceRefs, ...right.evidenceRefs]).slice(0, 12),
    rationale: input.rationale,
  };
}

function makeBridgePathCandidate(
  leftInput: NormalizedNode,
  bridge: NormalizedNode,
  rightInput: NormalizedNode,
  confidence: number,
  rationale: Record<string, unknown>,
): InterdisciplinaryCandidatePlan {
  const [left, right] = leftInput.id.localeCompare(rightInput.id) <= 0 ? [leftInput, rightInput] : [rightInput, leftInput];
  const sourceEvidence = uniqueStable([...left.evidenceRefs, ...bridge.evidenceRefs]).slice(0, 8);
  const targetEvidence = uniqueStable([...bridge.evidenceRefs, ...right.evidenceRefs]).slice(0, 8);
  return {
    candidate_id: `interdisciplinary:bridge_path:${makeStableSuffix([left.id, bridge.id, right.id], 12)}`,
    candidate_kind: "bridge_path",
    from_node_id: left.id,
    to_node_id: right.id,
    bridge_node_id: bridge.id,
    proposed_edge_type: null,
    directionality: null,
    proposed_path: [
      {
        from_node_id: left.id,
        to_node_id: bridge.id,
        relation_type: "related_to",
        directionality: "undirected",
        evidence_refs: sourceEvidence,
      },
      {
        from_node_id: bridge.id,
        to_node_id: right.id,
        relation_type: "related_to",
        directionality: "undirected",
        evidence_refs: targetEvidence,
      },
    ],
    confidence,
    source_domains: left.domains,
    target_domains: right.domains,
    evidence_refs: uniqueStable([...sourceEvidence, ...targetEvidence]).slice(0, 12),
    rationale: {
      ...rationale,
      bridge_node_id: bridge.id,
      bridge_node_name: bridge.name,
      bridge_node_definition: bridge.definition,
    },
  };
}

function isBridgeNode(node: Pick<NormalizedNode, "bridgeRole" | "domains" | "scope">): boolean {
  return Boolean(node.bridgeRole) || node.scope === "universal" || node.domains.length > 1;
}

function bucketNodes(
  nodes: NormalizedNode[],
  values: (node: NormalizedNode) => string[],
  kind: string,
  maximumBucketSize: number,
): Array<{ key: string; kind: string; nodes: NormalizedNode[] }> {
  const buckets = new Map<string, NormalizedNode[]>();
  for (const node of nodes) {
    for (const value of cleanStrings(values(node))) {
      const bucket = buckets.get(value) ?? [];
      bucket.push(node);
      buckets.set(value, bucket);
    }
  }
  return [...buckets.entries()]
    .filter(([, bucket]) => bucket.length >= 2 && bucket.length <= maximumBucketSize)
    .map(([key, bucket]) => ({ key, kind, nodes: uniqueNodes(bucket) }));
}

function uniqueNodes(nodes: NormalizedNode[]): NormalizedNode[] {
  return [...new Map(nodes.map((node) => [node.id, node])).values()].sort((left, right) => left.id.localeCompare(right.id));
}

function pairs<T>(items: T[]): Array<[T, T]> {
  const result: Array<[T, T]> = [];
  for (let left = 0; left < items.length; left += 1) {
    for (let right = left + 1; right < items.length; right += 1) result.push([items[left]!, items[right]!]);
  }
  return result;
}

function isCrossDomainPair(left: { domains: string[] }, right: { domains: string[] }): boolean {
  return left.domains.length > 0 && right.domains.length > 0 && !left.domains.some((domain) => right.domains.includes(domain));
}

function intersection(left: string[], right: string[]): string[] {
  const rightSet = new Set(right);
  return left.filter((value) => rightSet.has(value));
}

function cleanStrings(values: Iterable<unknown>): string[] {
  return uniqueStable([...values].map((value) => String(value ?? "").trim().toLowerCase()).filter(Boolean)).sort();
}

function cleanIdentifiers(values: Iterable<unknown>): string[] {
  return uniqueStable([...values].map((value) => String(value ?? "").trim()).filter(Boolean)).sort();
}

function unorderedPairKey(left: string, right: string): string {
  return left.localeCompare(right) <= 0 ? `${left}\n${right}` : `${right}\n${left}`;
}

function domainPairKey(left: string, right: string): string {
  return unorderedPairKey(left, right);
}

function positiveInteger(value: number | undefined, fallback: number): number {
  return Number.isInteger(value) && Number(value) > 0 ? Number(value) : fallback;
}

function clampScore(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0, Math.min(1, Number(value)));
}
