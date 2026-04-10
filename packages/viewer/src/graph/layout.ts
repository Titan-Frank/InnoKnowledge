import type {
  ApiNode, ApiEdge, ApiProfile, ApiMention, ApiEvidence,
  Framework, PatternLibrary,
} from '@okm/types';
import type { GraphNode, GraphEdge, GraphData } from '../state.js';
import { TYPE_META } from '../types/constants.js';

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

export function renderValue(value: unknown): string {
  if (Array.isArray(value)) {
    return `<ul class="property-list">${value.map((item) => `<li>${escapeHtml(String(item))}</li>`).join('')}</ul>`;
  }
  if (value && typeof value === 'object') {
    return Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => `
        <div class="property-group">
          <div class="property-label">${humanizeKey(key)}</div>
          <div class="property-value">${renderValue(item)}</div>
        </div>
      `)
      .join('');
  }
  return escapeHtml(String(value));
}

export function isBackboneNode(node: GraphNode | null | undefined): boolean {
  return node?.node_layer === 'backbone';
}

export function isSupportNode(node: GraphNode | null | undefined): boolean {
  return node?.node_layer === 'support';
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
    node.node_kind === 'principle' ||
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
    concept: 'concept',
    entity: 'entity',
    method: 'method',
    activity: 'activity',
    process: 'process',
    principle: 'principle',
    skill: 'skill',
    representation: 'representation',
    event: 'event',
    issue: 'issue',
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
    experiment: 'activity',
    symbol: 'representation',
  };
  return kindMap[type] || type || 'other';
}

function normalizeNode(node: ApiNode, profilesForNode: ApiProfile[]): ApiNode {
  const profileFrameworkRefs = profilesForNode.flatMap((profile) => profile.framework_refs || []);
  const frameworkRefs = [...new Set([...(node.framework_refs || []), ...profileFrameworkRefs])];

  const normalizedNode: ApiNode = {
    ...node,
    id: node.id,
    name: node.name || node.canonical_name || node.title || node.id,
    description: node.description || node.definition || node.summary || '',
    node_type: deriveDisplayType(node),
    node_kind: node.node_kind || deriveLegacyNodeKind(node.node_type as string),
    node_subkind: node.node_subkind || null,
    aliases: Array.isArray(node.aliases) ? node.aliases : [],
    framework_refs: frameworkRefs,
    properties: (node.properties as Record<string, unknown>) || {},
  };

  return {
    ...normalizedNode,
    node_layer: resolveNodeLayer(normalizedNode),
  };
}

function resolveEdgeLayer(
  edge: ApiEdge,
  sourceNode: GraphNode,
  targetNode: GraphNode,
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
  sourceNode: GraphNode,
  targetNode: GraphNode,
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

function normalizeEdge(edge: ApiEdge, nodeById: Map<string, GraphNode>): GraphEdge | null {
  const source = nodeById.get(edge.from);
  const target = nodeById.get(edge.to);
  if (!source || !target) return null;

  return {
    ...edge,
    source,
    target,
    edge_layer: resolveEdgeLayer(edge, source, target),
    backbone_expand: resolveBackboneExpand(edge, source, target),
  } as GraphEdge;
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
}): GraphData {
  const { nodes, edges, profiles, framework, patterns, books, source, manifest, loadWarnings } = bundle;

  const nodeById = new Map<string, GraphNode>();
  const edgeById = new Map<string, GraphEdge>();
  const profilesByNodeId = new Map<string, ApiProfile[]>();
  const frameworkTopics = new Map<string, Record<string, unknown> & { title: string }>();
  const frameworkDomains = new Map<string, Record<string, unknown>>();
  const mentionsByTarget = new Map<string, ApiMention[]>();
  const evidenceById = new Map<string, ApiEvidence>();
  const booksById = new Map<string, typeof books[number]>();
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
      ...book,
      evidence: normalizedEvidence,
      mentions: normalizedMentions,
    });
  });

  const degreeById = new Map<string, number>();
  edges.forEach((edge) => {
    degreeById.set(edge.from, (degreeById.get(edge.from) || 0) + 1);
    degreeById.set(edge.to, (degreeById.get(edge.to) || 0) + 1);
  });

  nodes.forEach((node, index) => {
    const profilesForNode = profilesByNodeId.get(node.id) || [];
    const normalizedNode = normalizeNode(node, profilesForNode);
    const angle = (index / Math.max(nodes.length, 1)) * Math.PI * 2;
    const radius = 160 + ((index % 7) * 22);
    const nodeLayer = normalizedNode.node_layer as string;

    const graphNode: GraphNode = {
      ...(normalizedNode as unknown as ApiNode),
      name: normalizedNode.name as string,
      description: normalizedNode.description as string,
      node_type: normalizedNode.node_type as string,
      x: Math.cos(angle) * radius,
      y: Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
      fx: null,
      fy: null,
      radius:
        (12 + Math.min(12, degreeById.get(node.id) || 0)) *
        (nodeLayer === 'support' ? 0.84 : 1),
      color: getTypeColor(normalizedNode.node_type as string),
      degree: degreeById.get(node.id) || 0,
      mentions: mentionsByTarget.get(node.id) || [],
      profiles: profilesForNode,
      mentionBookIds: new Set<string>(),
      scopeBookIds: new Set<string>(),
      properties: normalizedNode.properties || {},
    };

    graphNode.mentionBookIds = new Set(
      graphNode.mentions.map((mention) => mention.book_id as string).filter(Boolean),
    );
    graphNode.scopeBookIds = new Set(graphNode.mentionBookIds);
    availableTypes.add(graphNode.node_type);
    nodeById.set(graphNode.id, graphNode);
  });

  const graphEdges = edges
    .map((edge) => normalizeEdge(edge, nodeById))
    .filter((e): e is GraphEdge => e !== null);

  graphEdges.forEach((edge) => {
    edgeById.set(edge.id, edge);
    if (isBackboneNode(edge.source) && isSupportNode(edge.target)) {
      edge.source.mentionBookIds.forEach((bookId) => edge.target.scopeBookIds.add(bookId));
    }
    if (isSupportNode(edge.source) && isBackboneNode(edge.target)) {
      edge.target.mentionBookIds.forEach((bookId) => edge.source.scopeBookIds.add(bookId));
    }
  });

  return {
    nodes: Array.from(nodeById.values()),
    edges: graphEdges,
    nodeById,
    edgeById,
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
    source: source as GraphData['source'],
    manifest,
  };
}
