import type { Sql } from './connection.js';
import type {
  ApiNode, ApiEdge, ApiProfile, ApiMention, ApiEvidence, ApiNodeCard,
} from '@okm/types';

// ── Helpers ───────────────────────────────────────────────

/**
 * For JSONB columns named `key_json`, expose as `key` (without _json suffix).
 * postgres.js returns JSONB columns as native JS objects already,
 * so no JSON.parse() needed — just rename.
 */
function stripJsonSuffix(
  row: Record<string, unknown>,
  fields: string[],
): Record<string, unknown> {
  const result = { ...row };
  for (const key of fields) {
    const jsonKey = `${key}_json`;
    if (jsonKey in result) {
      result[key] = result[jsonKey];
      delete result[jsonKey];
    }
  }
  return result;
}

// ── Dataset ───────────────────────────────────────────────

interface DatasetRow {
  dataset_id: string;
  version_key: string;
  root_path: string;
  is_active: number;
}

export async function resolveDatasetRow(
  sql: Sql,
  key: string,
): Promise<DatasetRow | undefined> {
  const rows = await sql<DatasetRow[]>`
    SELECT dataset_id, version_key, root_path, is_active
    FROM datasets
    WHERE dataset_id = ${key} OR version_key = ${key}
    ORDER BY is_active DESC, dataset_id ASC
    LIMIT 1
  `;
  return rows[0];
}

// ── Nodes ─────────────────────────────────────────────────

export async function loadNodes(sql: Sql, datasetId: string): Promise<ApiNode[]> {
  const rows = await sql`
    SELECT * FROM nodes WHERE dataset_id = ${datasetId} ORDER BY id
  `;

  return rows.map((row: Record<string, unknown>) => {
    const parsed = stripJsonSuffix(row, [
      'aliases', 'learning_modes', 'bridge_tags', 'framework_refs',
      'profile_refs', 'same_as_refs', 'properties',
    ]);
    delete parsed.embedding;
    return parsed as unknown as ApiNode;
  });
}

// ── Edges ─────────────────────────────────────────────────

export async function loadEdges(sql: Sql, datasetId: string): Promise<ApiEdge[]> {
  const rows = await sql`
    SELECT * FROM edges WHERE dataset_id = ${datasetId} ORDER BY id
  `;

  return rows.map((row: Record<string, unknown>) => {
    const parsed = stripJsonSuffix(row, [
      'framework_refs', 'profile_refs', 'source_refs', 'properties',
    ]);
    // Map DB column names to API field names
    if ('from_id' in parsed) {
      parsed.from = parsed.from_id;
    }
    if ('to_id' in parsed) {
      parsed.to = parsed.to_id;
    }
    return parsed as unknown as ApiEdge;
  });
}

// ── Profiles ──────────────────────────────────────────────

export async function loadProfiles(sql: Sql, datasetId: string): Promise<ApiProfile[]> {
  const rows = await sql`
    SELECT * FROM profiles WHERE dataset_id = ${datasetId} ORDER BY id
  `;

  return rows.map((row: Record<string, unknown>) => {
    return stripJsonSuffix(row, [
      'learning_objectives', 'framework_refs', 'textbook_refs',
      'textbook_ids', 'assessment_signals', 'source_refs', 'properties',
    ]) as unknown as ApiProfile;
  });
}

// ── Mentions ──────────────────────────────────────────────

export async function loadMentions(sql: Sql, datasetId: string): Promise<ApiMention[]> {
  const rows = await sql`
    SELECT * FROM mentions WHERE dataset_id = ${datasetId}
  `;

  return rows.map((row: Record<string, unknown>) => {
    return stripJsonSuffix(row, ['source_refs', 'confidence_map', 'properties']) as unknown as ApiMention;
  });
}

// ── Evidence ──────────────────────────────────────────────

export async function loadEvidence(sql: Sql, datasetId: string): Promise<ApiEvidence[]> {
  const rows = await sql`
    SELECT * FROM evidence WHERE dataset_id = ${datasetId}
  `;

  return rows.map((row: Record<string, unknown>) => {
    return stripJsonSuffix(row, ['normalized_claims', 'properties']) as unknown as ApiEvidence;
  });
}

// ── Node Card ─────────────────────────────────────────────

export async function loadNodeCard(
  sql: Sql,
  datasetId: string,
  nodeId: string,
): Promise<ApiNodeCard | null> {
  const rows = await sql`
    SELECT * FROM node_cards
    WHERE dataset_id = ${datasetId} AND node_id = ${nodeId}
    LIMIT 1
  `;

  if (!rows.length) return null;

  return stripJsonSuffix(rows[0] as Record<string, unknown>, [
    'sections', 'pattern_refs', 'framework_refs', 'profile_refs',
    'mention_refs', 'source_refs', 'properties',
  ]) as unknown as ApiNodeCard;
}

// ── Book IDs ──────────────────────────────────────────────

export async function loadBookIds(sql: Sql, datasetId: string): Promise<string[]> {
  const rows = await sql<{ source_id: string }[]>`
    SELECT DISTINCT source_id FROM evidence
    WHERE dataset_id = ${datasetId} AND source_type = 'textbook'
    UNION
    SELECT DISTINCT source_id FROM mentions
    WHERE dataset_id = ${datasetId} AND source_type = 'textbook'
    ORDER BY source_id
  `;

  return rows.map((r) => r.source_id);
}

// ── Composite payloads ────────────────────────────────────

export interface SourcesPayload {
  active_source: string | null;
  sources: Array<{
    key: string;
    label: string;
    description: string;
    has_profiles: boolean;
    book_count: number;
    books: Array<{ book_id: string }>;
    is_active: boolean;
    root_path: string;
  }>;
}

export async function buildSourcesPayload(sql: Sql): Promise<SourcesPayload> {
  const tableCheck = await sql<{ regclass: string | null }[]>`
    SELECT to_regclass('datasets') AS regclass
  `;

  if (!tableCheck[0]?.regclass) {
    return {
      active_source: null,
      sources: [],
    };
  }

  const datasets = await sql<DatasetRow[]>`
    SELECT dataset_id, version_key, root_path, is_active
    FROM datasets
    ORDER BY is_active DESC, dataset_id ASC
  `;

  let activeSource: string | null = null;
  const sources = await Promise.all(
    datasets.map(async (row) => {
      const bookIds = await loadBookIds(sql, row.dataset_id);
      const profileRows = await sql<{ count: number }[]>`
        SELECT COUNT(*) AS count FROM profiles WHERE dataset_id = ${row.dataset_id}
      `;
      const profileCount = profileRows[0].count;

      if (row.is_active) activeSource = row.dataset_id;

      return {
        key: row.dataset_id,
        label: row.version_key.toUpperCase(),
        description: `PostgreSQL dataset ${row.dataset_id}`,
        has_profiles: profileCount > 0,
        book_count: bookIds.length,
        books: bookIds.map((bookId) => ({ book_id: bookId })),
        is_active: Boolean(row.is_active),
        root_path: row.root_path,
      };
    }),
  );

  return {
    active_source: activeSource || (sources[0]?.key ?? null),
    sources,
  };
}

export interface BundlePayload {
  source: {
    key: string;
    label: string;
    description: string;
    hasProfiles: boolean;
    isActive: boolean;
    rootPath: string;
    nodeCardPath: string;
  };
  nodes: ApiNode[];
  edges: ApiEdge[];
  profiles: ApiProfile[];
  framework: Record<string, unknown>;
  patterns: Record<string, unknown>;
  books: Array<{
    bookId: string;
    outline: Record<string, unknown> | null;
    mentions: ApiMention[];
    evidence: ApiEvidence[];
  }>;
  loadWarnings: string[];
}

export async function buildBundlePayload(
  sql: Sql,
  datasetId: string,
  framework: Record<string, unknown> | null,
  patterns: Record<string, unknown> | null,
  outlineLoader: (bookId: string) => Record<string, unknown> | null,
): Promise<BundlePayload> {
  const datasetRow = await resolveDatasetRow(sql, datasetId);
  if (!datasetRow) throw new Error(`Unknown dataset: ${datasetId}`);

  const profileRows = await sql<{ count: number }[]>`
    SELECT COUNT(*) AS count FROM profiles WHERE dataset_id = ${datasetRow.dataset_id}
  `;
  const profileCount = profileRows[0].count;

  const allMentions = await loadMentions(sql, datasetRow.dataset_id);
  const allEvidence = await loadEvidence(sql, datasetRow.dataset_id);

  const textbookMentions = allMentions.filter((m) => m.source_type === 'textbook');
  const textbookEvidence = allEvidence.filter((e) => e.source_type === 'textbook');

  const mentionsByBook = groupBy(textbookMentions, 'source_id');
  const evidenceByBook = groupBy(textbookEvidence, 'source_id');

  const bookIds = sortedUnion(Object.keys(mentionsByBook), Object.keys(evidenceByBook));

  const books = bookIds.map((bookId) => ({
    bookId,
    outline: outlineLoader(bookId),
    mentions: mentionsByBook[bookId] ?? [],
    evidence: evidenceByBook[bookId] ?? [],
  }));

  return {
    source: {
      key: datasetRow.dataset_id,
      label: datasetRow.version_key.toUpperCase(),
      description: `PostgreSQL dataset ${datasetRow.dataset_id}`,
      hasProfiles: profileCount > 0,
      isActive: Boolean(datasetRow.is_active),
      rootPath: datasetRow.root_path,
      nodeCardPath: `/api/source/${datasetRow.dataset_id}/node-card`,
    },
    nodes: await loadNodes(sql, datasetRow.dataset_id),
    edges: await loadEdges(sql, datasetRow.dataset_id),
    profiles: await loadProfiles(sql, datasetRow.dataset_id),
    framework: framework ?? { domains: [] },
    patterns: patterns ?? { patterns: [] },
    books,
    loadWarnings: [],
  };
}

// ── Utility ───────────────────────────────────────────────

function groupBy<T>(items: T[], key: keyof T): Record<string, T[]> {
  const result: Record<string, T[]> = {};
  for (const item of items) {
    const groupKey = String(item[key]);
    (result[groupKey] ??= []).push(item);
  }
  return result;
}

function sortedUnion(a: string[], b: string[]): string[] {
  return [...new Set([...a, ...b])].sort();
}
