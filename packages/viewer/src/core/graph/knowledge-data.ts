import type {
  ApiNode, ApiEdge, ApiProfile, ApiMention, ApiEvidence,
  Framework, PatternLibrary,
} from '@okm/types';
import type { OKMNode, OKMEdge, OKMBook, KnowledgeGraph } from './types';
import { createKnowledgeGraph } from './graph';
import { TYPE_META } from '@/lib/constants';

export function getTypeColor(type: string): string {
  return TYPE_META[type]?.color ?? TYPE_META.other.color;
}

export function getTypeLabel(type: string): string {
  return TYPE_META[type]?.label ?? humanizeKey(type);
}

export function humanizeKey(key: string): string {
  return key
    .replaceAll('_', ' ')
    .replaceAll('-', ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function isBackboneNode(node: OKMNode | null | undefined): boolean {
  return node?.nodeLayer === 'backbone';
}

export function isSupportNode(node: OKMNode | null | undefined): boolean {
  return node?.nodeLayer === 'support';
}

function resolveNodeLayer(node: ApiNode): 'backbone' | 'support' {
  const props = node.properties as Record<string, unknown> | undefined;
  const explicitLayer =
    node.node_layer ||
    node.layer ||
    props?.node_layer ||
    props?.layer ||
    (props?.backbone === true ? 'backbone' : null) ||
    (props?.support === true ? 'support' : null);

  if (explicitLayer === 'backbone' || explicitLayer === 'support') {
    return explicitLayer as 'backbone' | 'support';
  }

  if (
    node.node_kind === 'concept' ||
    node.node_kind === 'rule' ||
    (node as Record<string, unknown>).node_kind === 'process' ||
    (node.node_kind === 'entity' && (node.node_subkind === 'substance' || node.node_subkind === 'particle'))
  ) {
    return 'backbone';
  }

  return 'support';
}

function deriveDisplayType(node: ApiNode): string {
  if (node.node_type) return node.node_type as string;

  const SUBKIND_TO_TYPE: Record<string, string> = {
    substance: 'substance',
    experiment: 'experiment',
    symbol: 'symbol',
    formula: 'symbol',
    equation: 'symbol',
    model: 'representation',
    diagram: 'representation',
    table: 'representation',
    equipment: 'entity',
    apparatus: 'entity',
    molecule: 'entity',
    particle: 'entity',
    procedure: 'method',
  };

  const KIND_TO_TYPE: Record<string, string> = {
    property: 'property',
    concept: 'concept',
    entity: 'entity',
    method: 'method',
    process: 'process',
    rule: 'rule',
    representation: 'representation',
    event: 'event',
    resource: 'resource',
  };

  if (node.node_subkind && SUBKIND_TO_TYPE[node.node_subkind]) {
    return SUBKIND_TO_TYPE[node.node_subkind];
  }

  if (node.node_kind && KIND_TO_TYPE[node.node_kind]) {
    return KIND_TO_TYPE[node.node_kind];
  }

  return node.node_subkind || node.node_kind || 'other';
}

function deriveLegacyNodeKind(type: string): string {
  const kindMap: Record<string, string> = {
    substance: 'entity',
    experiment: 'event',
    symbol: 'representation',
  };
  return kindMap[type] || type || 'other';
}

function normalizeNode(node: ApiNode, profilesForNode: ApiProfile[]): OKMNode {
  const profileFrameworkRefs = profilesForNode.flatMap((profile) => profile.framework_refs || []);
  const frameworkRefs = [...new Set([...(node.framework_refs || []), ...profileFrameworkRefs])];

  const normalized = {
    ...node,
    name: node.name || node.canonical_name || node.title || node.id,
    description: node.description || node.definition || node.summary || '',
  };

  const nodeType = deriveDisplayType(normalized);
  const nodeKind = normalized.node_kind || deriveLegacyNodeKind(nodeType);
  const nodeLayer = resolveNodeLayer({ ...normalized, node_type: nodeType, node_kind: nodeKind });

  return {
    id: normalized.id,
    name: normalized.name as string,
    description: normalized.description as string,
    nodeType,
    nodeKind,
    nodeSubkind: normalized.node_subkind || null,
    nodeLayer,
    aliases: Array.isArray(normalized.aliases) ? normalized.aliases : [],
    frameworkRefs,
    properties: (normalized.properties as Record<string, unknown>) || {},
    degree: 0, // filled later
    mentions: [], // filled later
    profiles: profilesForNode,
    mentionBookIds: new Set<string>(),
    scopeBookIds: new Set<string>(),
    communityId: (normalized as Record<string, unknown>).community_id as number | null ?? null,
  };
}

function resolveEdgeLayer(
  edge: ApiEdge,
  sourceNode: OKMNode,
  targetNode: OKMNode,
): 'backbone' | 'support' {
  const props = edge.properties as Record<string, unknown> | undefined;
  const explicitLayer =
    edge.edge_layer ||
    edge.layer ||
    props?.edge_layer ||
    props?.layer ||
    null;

  if (explicitLayer === 'backbone' || explicitLayer === 'support') {
    return explicitLayer as 'backbone' | 'support';
  }

  if (isBackboneNode(sourceNode) && isBackboneNode(targetNode)) {
    return 'backbone';
  }

  return 'support';
}

function resolveBackboneExpand(
  edge: ApiEdge,
  sourceNode: OKMNode,
  targetNode: OKMNode,
): boolean {
  if (typeof edge.backbone_expand === 'boolean') {
    return edge.backbone_expand;
  }

  const props = edge.properties as Record<string, unknown> | undefined;
  if (props && typeof props.backbone_expand === 'boolean') {
    return props.backbone_expand;
  }

  return (
    (isBackboneNode(sourceNode) && isSupportNode(targetNode)) ||
    (isSupportNode(sourceNode) && isBackboneNode(targetNode))
  );
}

function normalizeEdge(edge: ApiEdge, nodeById: Map<string, OKMNode>): OKMEdge | null {
  const source = nodeById.get(edge.from);
  const target = nodeById.get(edge.to);
  if (!source || !target) return null;

  return {
    id: edge.id,
    from: edge.from,
    to: edge.to,
    edgeType: edge.edge_type,
    edgeLayer: resolveEdgeLayer(edge, source, target),
    backboneExpand: resolveBackboneExpand(edge, source, target),
    properties: (edge.properties as Record<string, unknown>) || {},
  };
}

function normalizeEvidence(item: ApiEvidence, fallbackBookId: string): ApiEvidence {
  return {
    ...item,
    book_id: (item.book_id as string) || item.source_id || fallbackBookId,
    source_id: item.source_id || (item.book_id as string) || fallbackBookId,
    snippet: (item.snippet as string) || item.excerpt || '',
  };
}

function normalizeMention(
  item: ApiMention,
  fallbackBookId: string,
  evidenceById: Map<string, ApiEvidence>,
): ApiMention {
  const bookId = item.book_id || item.source_id || fallbackBookId;
  const firstEvidence = (item.source_refs || [])
    .map((ref) => evidenceById.get(ref))
    .find(Boolean);

  return {
    ...item,
    book_id: bookId,
    properties: {
      ...(item.properties || {}),
      page: (item.properties as Record<string, unknown>)?.page ?? firstEvidence?.page_start ?? null,
    },
  };
}

function getPatternKeys(pattern: Record<string, unknown>): string[] {
  const keys = new Set<string>();
  if (pattern.node_type) keys.add(pattern.node_type as string);
  if (pattern.node_kind) keys.add(pattern.node_kind as string);
  if (pattern.node_subkind) keys.add(pattern.node_subkind as string);
  if (pattern.node_kind && pattern.node_subkind) {
    keys.add(`${pattern.node_kind}/${pattern.node_subkind}`);
  }
  return Array.from(keys);
}

export function prepareGraphData(bundle: {
  nodes: ApiNode[];
  edges: ApiEdge[];
  profiles: ApiProfile[];
  framework: Framework;
  patterns: PatternLibrary;
  books: Array<{
    bookId: string;
    outline: Record<string, unknown> | null;
    mentions: ApiMention[];
    evidence: ApiEvidence[];
  }>;
  source: Record<string, unknown> & { nodeCardPath?: string };
  manifest: Record<string, unknown> | null;
  loadWarnings: string[];
}): KnowledgeGraph {
  const { nodes, edges, profiles, framework, patterns, books, source, manifest, loadWarnings } = bundle;

  const profilesByNodeId = new Map<string, ApiProfile[]>();
  const frameworkTopics = new Map<string, Record<string, unknown> & { title: string }>();
  const frameworkDomains = new Map<string, Record<string, unknown>>();
  const mentionsByTarget = new Map<string, ApiMention[]>();
  const evidenceById = new Map<string, ApiEvidence>();
  const booksById = new Map<string, OKMBook>();
  const patternsById = new Map<string, Record<string, unknown>>();
  const patternsByType = new Map<string, Record<string, unknown>[]>();
  const availableTypes = new Set<string>();

  (profiles || []).forEach((profile) => {
    if (!profilesByNodeId.has(profile.node_id)) {
      profilesByNodeId.set(profile.node_id, []);
    }
    profilesByNodeId.get(profile.node_id)!.push(profile);
  });

  (framework?.domains || []).forEach((domain) => {
    frameworkDomains.set(domain.id, domain as Record<string, unknown>);
    (domain.topics || []).forEach((topic) => {
      frameworkTopics.set(topic.id, { ...topic, domain } as Record<string, unknown> & { title: string });
    });
  });

  (patterns?.patterns || []).forEach((pattern) => {
    patternsById.set(pattern.id, pattern as Record<string, unknown>);
    getPatternKeys(pattern as Record<string, unknown>).forEach((key) => {
      if (!patternsByType.has(key)) patternsByType.set(key, []);
      patternsByType.get(key)!.push(pattern as Record<string, unknown>);
    });
  });

  books.forEach((book) => {
    const normalizedEvidence = (book.evidence || []).map((item) =>
      normalizeEvidence(item, book.bookId),
    );
    const localEvidenceById = new Map(normalizedEvidence.map((item) => [item.id, item]));
    const normalizedMentions = (book.mentions || []).map((item) =>
      normalizeMention(item, book.bookId, localEvidenceById),
    );

    normalizedEvidence.forEach((item) => evidenceById.set(item.id, item));
    normalizedMentions.forEach((item) => {
      if (!mentionsByTarget.has(item.target_id)) {
        mentionsByTarget.set(item.target_id, []);
      }
      mentionsByTarget.get(item.target_id)!.push(item);
    });

    booksById.set(book.bookId, {
      bookId: book.bookId,
      outline: book.outline,
      mentions: normalizedMentions,
      evidence: normalizedEvidence,
    });
  });

  const degreeById = new Map<string, number>();
  edges.forEach((edge) => {
    degreeById.set(edge.from, (degreeById.get(edge.from) || 0) + 1);
    degreeById.set(edge.to, (degreeById.get(edge.to) || 0) + 1);
  });

  const okmNodes: OKMNode[] = [];
  const nodeById = new Map<string, OKMNode>();

  nodes.forEach((node) => {
    const profilesForNode = profilesByNodeId.get(node.id) || [];
    const okmNode = normalizeNode(node, profilesForNode);
    okmNode.degree = degreeById.get(node.id) || 0;
    okmNode.mentions = mentionsByTarget.get(node.id) || [];
    okmNode.mentionBookIds = new Set(
      okmNode.mentions.map((m) => m.book_id as string).filter(Boolean),
    );
    okmNode.scopeBookIds = new Set(okmNode.mentionBookIds);
    availableTypes.add(okmNode.nodeType);
    okmNodes.push(okmNode);
    nodeById.set(okmNode.id, okmNode);
  });

  const okmEdges: OKMEdge[] = edges
    .map((edge) => normalizeEdge(edge, nodeById))
    .filter((e): e is OKMEdge => e !== null);

  okmEdges.forEach((edge) => {
    const source = nodeById.get(edge.from);
    const target = nodeById.get(edge.to);
    if (source && target) {
      if (isBackboneNode(source) && isSupportNode(target)) {
        source.mentionBookIds.forEach((bookId) => target.scopeBookIds.add(bookId));
      }
      if (isSupportNode(source) && isBackboneNode(target)) {
        target.mentionBookIds.forEach((bookId) => source.scopeBookIds.add(bookId));
      }
    }
  });

  return createKnowledgeGraph({
    nodes: okmNodes,
    edges: okmEdges,
    booksById,
    frameworkTopics,
    frameworkDomains,
    patternsById,
    patternsByType,
    evidenceById,
    availableTypes: Array.from(availableTypes).sort((a, b) =>
      getTypeLabel(a).localeCompare(getTypeLabel(b), 'zh-CN'),
    ),
    loadWarnings: loadWarnings || [],
    source: source as KnowledgeGraph['source'],
    manifest,
  });
}
