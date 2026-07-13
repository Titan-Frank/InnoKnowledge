import type {
  ApiEdge,
  ApiNode,
  ApiProfile,
  ApiUnitCurriculumProjection,
  ApiUnit,
  BundleResponse,
  MetaResponse,
  SearchResponse,
} from '@okm/types';

type Row = Record<string, unknown>;

export interface PublicArtifactManifest extends Row {
  artifact_version?: string;
  counts?: Record<string, number>;
  source_database?: {
    dataset_id?: string;
    dataset_name?: string;
    root_path?: string;
    sources?: Row[];
  };
}

export interface PublicArtifactGraph extends Row {
  dataset?: Row;
  source?: Row;
  nodes: ApiNode[];
  edges: ApiEdge[];
  profiles: ApiProfile[];
  curriculum_projections?: ApiUnitCurriculumProjection[];
}

export interface PublicArtifactUnitIndex extends Row {
  dataset_id?: string;
  units: Array<{
    node_id: string;
    name: string;
    kind: string;
    file: string;
  }>;
}

export function createPublicArtifactMeta(
  manifest: PublicArtifactManifest,
  graph: PublicArtifactGraph,
): MetaResponse & { manifest: PublicArtifactManifest } {
  const source = asRow(graph.source);
  const dataset = asRow(graph.dataset);
  const sourceRows = Array.isArray(manifest.source_database?.sources)
    ? manifest.source_database.sources
    : [];
  const books = uniqueStrings(sourceRows.map((row) => row.book_id));
  const key = firstString(
    source.key,
    dataset.dataset_id,
    manifest.source_database?.dataset_id,
    'main',
  );

  return {
    active_source: key,
    sources: [{
      key,
      label: firstString(source.label, manifest.source_database?.dataset_name, key.toUpperCase()),
      description: firstString(source.description, `公开成果快照 ${key}`),
      has_profiles: graph.profiles.length > 0,
      book_count: books.length,
      books: books.map((book_id) => ({ book_id })),
      is_active: true,
      root_path: firstString(source.rootPath, manifest.source_database?.root_path),
    }],
    manifest,
  };
}

export function createPublicArtifactBundle(
  graph: PublicArtifactGraph,
  nodeCardPath: string,
): BundleResponse {
  const rawSource = asRow(graph.source);
  const dataset = asRow(graph.dataset);
  const key = firstString(rawSource.key, dataset.dataset_id, 'main');

  return {
    source: {
      key,
      label: firstString(rawSource.label, key.toUpperCase()),
      description: firstString(rawSource.description, `公开成果快照 ${key}`),
      hasProfiles: graph.profiles.length > 0,
      isActive: true,
      rootPath: firstString(rawSource.rootPath, dataset.root_path),
      nodeCardPath,
    },
    nodes: graph.nodes,
    edges: graph.edges,
    profiles: graph.profiles,
    curriculum_projections: graph.curriculum_projections ?? [],
    framework: { domains: [] },
    patterns: { patterns: [] },
    books: [],
    loadWarnings: [],
  };
}

export function findPublicArtifactUnitFile(
  index: PublicArtifactUnitIndex,
  nodeId: string,
): string | null {
  return index.units.find((item) => item.node_id === nodeId)?.file ?? null;
}

export function searchPublicArtifactNodes(
  graph: PublicArtifactGraph,
  query: string,
  source: string,
  limit = 60,
): SearchResponse {
  const normalizedQuery = normalizeSearchText(query);
  const hits = normalizedQuery
    ? graph.nodes
        .map((node) => scoreNode(node, normalizedQuery))
        .filter((item): item is NonNullable<typeof item> => Boolean(item))
        .sort((left, right) => right.score - left.score || left.canonical_name.localeCompare(right.canonical_name, 'zh-CN'))
        .slice(0, Math.max(1, limit))
    : [];

  return {
    query,
    source,
    hits,
    mode: 'text_only',
  };
}

export function isPublicArtifactUnit(value: unknown): value is ApiUnit {
  const row = asRow(value);
  return Boolean(asRow(row.node).id);
}

function scoreNode(node: ApiNode, query: string): SearchResponse['hits'][number] | null {
  const name = firstString(node.canonical_name, node.name, node.title, node.id);
  const normalizedName = normalizeSearchText(name);
  const aliases = Array.isArray(node.aliases) ? node.aliases.map(String) : [];
  const searchable = normalizeSearchText([
    name,
    node.definition,
    node.description,
    ...aliases,
    ...(Array.isArray(node.tags) ? node.tags.map(String) : []),
  ].filter(Boolean).join(' '));
  if (!searchable.includes(query)) return null;

  const score = normalizedName === query
    ? 1
    : normalizedName.startsWith(query)
      ? 0.95
      : normalizedName.includes(query)
        ? 0.9
        : aliases.some((alias) => normalizeSearchText(alias).includes(query))
          ? 0.82
          : 0.7;

  return {
    id: node.id,
    canonical_name: name,
    node_kind: firstString(node.node_kind, node.kind, 'concept'),
    node_layer: resolveNodeLayer(node),
    score,
    text_match: true,
    vector_match: false,
    similarity: null,
  };
}

function resolveNodeLayer(node: ApiNode): string {
  const properties = asRow(node.properties);
  const explicit = firstString(node.node_layer, node.layer, properties.node_layer, properties.layer);
  if (explicit) return explicit;
  if (node.node_kind === 'concept' || node.node_kind === 'rule') return 'backbone';
  if (node.node_kind === 'entity' && ['substance', 'particle'].includes(String(node.node_subkind))) return 'backbone';
  return 'support';
}

function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').trim().toLocaleLowerCase('zh-CN');
}

function uniqueStrings(values: unknown[]): string[] {
  return [...new Set(values.map((value) => String(value ?? '').trim()).filter(Boolean))];
}

function asRow(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}
