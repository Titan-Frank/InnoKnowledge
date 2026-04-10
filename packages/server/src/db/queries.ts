import type Database from 'better-sqlite3';
import type {
  ApiNode, ApiEdge, ApiProfile, ApiMention, ApiEvidence, ApiNodeCard,
} from '@okm/types';

// ── Helpers ───────────────────────────────────────────────

function parseJsonFields(
  row: Record<string, unknown>,
  fields: string[],
): Record<string, unknown> {
  const result = { ...row };
  for (const key of fields) {
    const jsonKey = `${key}_json`;
    if (jsonKey in result && result[jsonKey] != null) {
      const raw = result[jsonKey];
      result[key] = typeof raw === 'string' ? JSON.parse(raw) : raw;
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

export function resolveDatasetRow(
  db: Database.Database,
  key: string,
): DatasetRow | undefined {
  return db.prepare(`
    SELECT dataset_id, version_key, root_path, is_active
    FROM datasets
    WHERE dataset_id = ? OR version_key = ?
    ORDER BY is_active DESC, dataset_id ASC
    LIMIT 1
  `).get(key, key) as DatasetRow | undefined;
}

// ── Nodes ─────────────────────────────────────────────────

export function loadNodes(db: Database.Database, datasetId: string): ApiNode[] {
  const rows = db.prepare(`
    SELECT * FROM nodes WHERE dataset_id = ? ORDER BY id
  `).all(datasetId) as Record<string, unknown>[];

  return rows.map((row) => {
    const parsed = parseJsonFields(row, [
      'aliases', 'learning_modes', 'bridge_tags', 'framework_refs',
    ]);
    delete parsed.embedding_json;
    return parsed as unknown as ApiNode;
  });
}

// ── Edges ─────────────────────────────────────────────────

export function loadEdges(db: Database.Database, datasetId: string): ApiEdge[] {
  const rows = db.prepare(`
    SELECT * FROM edges WHERE dataset_id = ? ORDER BY id
  `).all(datasetId) as Record<string, unknown>[];

  return rows.map((row) => {
    const parsed = parseJsonFields(row, ['source_refs', 'properties']);
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

export function loadProfiles(db: Database.Database, datasetId: string): ApiProfile[] {
  const rows = db.prepare(`
    SELECT * FROM profiles WHERE dataset_id = ? ORDER BY id
  `).all(datasetId) as Record<string, unknown>[];

  return rows.map((row) => {
    const parsed = parseJsonFields(row, [
      'learning_objectives', 'framework_refs', 'textbook_refs',
      'textbook_ids', 'assessment_signals', 'source_refs', 'properties',
    ]);
    return parsed as unknown as ApiProfile;
  });
}

// ── Mentions ──────────────────────────────────────────────

export function loadMentions(db: Database.Database, datasetId: string): ApiMention[] {
  const rows = db.prepare(`
    SELECT * FROM mentions WHERE dataset_id = ?
  `).all(datasetId) as Record<string, unknown>[];

  return rows.map((row) => {
    const parsed = parseJsonFields(row, ['source_refs', 'confidence_map', 'properties']);
    return parsed as unknown as ApiMention;
  });
}

// ── Evidence ──────────────────────────────────────────────

export function loadEvidence(db: Database.Database, datasetId: string): ApiEvidence[] {
  const rows = db.prepare(`
    SELECT * FROM evidence WHERE dataset_id = ?
  `).all(datasetId) as Record<string, unknown>[];

  return rows.map((row) => {
    const parsed = parseJsonFields(row, ['normalized_claims', 'properties']);
    return parsed as unknown as ApiEvidence;
  });
}

// ── Node Card ─────────────────────────────────────────────

export function loadNodeCard(
  db: Database.Database,
  datasetId: string,
  nodeId: string,
): ApiNodeCard | null {
  const row = db.prepare(`
    SELECT * FROM node_cards
    WHERE dataset_id = ? AND node_id = ?
    LIMIT 1
  `).get(datasetId, nodeId) as Record<string, unknown> | undefined;

  if (!row) return null;

  const parsed = parseJsonFields(row, [
    'sections', 'pattern_refs', 'framework_refs', 'profile_refs',
    'mention_refs', 'source_refs', 'properties',
  ]);

  return parsed as unknown as ApiNodeCard;
}

// ── Book IDs ──────────────────────────────────────────────

export function loadBookIds(db: Database.Database, datasetId: string): string[] {
  const rows = db.prepare(`
    SELECT DISTINCT source_id FROM evidence
    WHERE dataset_id = ? AND source_type = 'textbook'
    UNION
    SELECT DISTINCT source_id FROM mentions
    WHERE dataset_id = ? AND source_type = 'textbook'
    ORDER BY source_id
  `).all(datasetId, datasetId) as { source_id: string }[];

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

export function buildSourcesPayload(db: Database.Database): SourcesPayload {
  const datasets = db.prepare(`
    SELECT dataset_id, version_key, root_path, is_active
    FROM datasets
    ORDER BY is_active DESC, dataset_id ASC
  `).all() as DatasetRow[];

  let activeSource: string | null = null;
  const sources = datasets.map((row) => {
    const bookIds = loadBookIds(db, row.dataset_id);
    const profileCount = (
      db.prepare('SELECT COUNT(*) AS count FROM profiles WHERE dataset_id = ?')
        .get(row.dataset_id) as { count: number }
    ).count;

    if (row.is_active) activeSource = row.dataset_id;

    return {
      key: row.dataset_id,
      label: row.version_key.toUpperCase(),
      description: `SQLite dataset ${row.dataset_id}`,
      has_profiles: profileCount > 0,
      book_count: bookIds.length,
      books: bookIds.map((bookId) => ({ book_id: bookId })),
      is_active: Boolean(row.is_active),
      root_path: row.root_path,
    };
  });

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

export function buildBundlePayload(
  db: Database.Database,
  datasetId: string,
  framework: Record<string, unknown> | null,
  patterns: Record<string, unknown> | null,
  outlineLoader: (bookId: string) => Record<string, unknown> | null,
): BundlePayload {
  const datasetRow = resolveDatasetRow(db, datasetId);
  if (!datasetRow) throw new Error(`Unknown dataset: ${datasetId}`);

  const profileCount = (
    db.prepare('SELECT COUNT(*) AS count FROM profiles WHERE dataset_id = ?')
      .get(datasetRow.dataset_id) as { count: number }
  ).count;

  const allMentions = loadMentions(db, datasetRow.dataset_id);
  const allEvidence = loadEvidence(db, datasetRow.dataset_id);

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
      description: `SQLite dataset ${datasetRow.dataset_id}`,
      hasProfiles: profileCount > 0,
      isActive: Boolean(datasetRow.is_active),
      rootPath: datasetRow.root_path,
      nodeCardPath: `/api/source/${datasetRow.dataset_id}/node-card`,
    },
    nodes: loadNodes(db, datasetRow.dataset_id),
    edges: loadEdges(db, datasetRow.dataset_id),
    profiles: loadProfiles(db, datasetRow.dataset_id),
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
