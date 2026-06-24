import type { Sql } from './connection.js';
import type {
  ApiNode, ApiEdge, ApiProfile, ApiMention, ApiEvidence, ApiNodeCard, ApiUnit, ApiUnitMedia,
  PipelineResponse,
} from '@okm/types';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../utils/paths.js';

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
  const worldTableCheck = await sql<{ regclass: string | null }[]>`
    SELECT to_regclass('world_datasets') AS regclass
  `;
  if (worldTableCheck[0]?.regclass) {
    const worldRows = await sql<DatasetRow[]>`
      SELECT dataset_id, dataset_name AS version_key, COALESCE(root_path, '') AS root_path, is_active
      FROM world_datasets
      WHERE dataset_id = ${key} OR dataset_name = ${key}
      ORDER BY is_active DESC, dataset_id ASC
      LIMIT 1
    `;
    if (worldRows[0]) return worldRows[0];
  }

  const legacyTableCheck = await sql<{ regclass: string | null }[]>`
    SELECT to_regclass('datasets') AS regclass
  `;
  if (!legacyTableCheck[0]?.regclass) return undefined;

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
    SELECT * FROM world_nodes WHERE dataset_id = ${datasetId} ORDER BY id
  `.catch(() => sql`
    SELECT * FROM nodes WHERE dataset_id = ${datasetId} ORDER BY id
  `);

  return rows.map((row: Record<string, unknown>) => {
    if ('name' in row || 'kind' in row) {
      const parsed = worldJsonRow(row, [
        'aliases', 'domains', 'knowledge_form', 'learning_mode',
        'properties', 'external_ids', 'tags',
      ]);
      const properties = asRecord(parsed.properties);
      return {
        ...parsed,
        canonical_name: textValue(parsed.name) || textValue(parsed.id),
        node_kind: textValue(parsed.kind) || 'concept',
        node_subkind: textValue(parsed.subkind) || null,
        node_layer: textValue(properties.node_layer || properties.layer) || undefined,
        learning_modes: Array.isArray(parsed.learning_mode) ? parsed.learning_mode : [],
        bridge_tags: Array.isArray(parsed.tags) ? parsed.tags : [],
        framework_refs: [],
        profile_refs: [],
        same_as_refs: [],
        properties: {
          ...properties,
          domains: parsed.domains || [],
          knowledge_form: parsed.knowledge_form || [],
          scope: parsed.scope || '',
          tags: parsed.tags || [],
        },
        community_id: null,
        pca_x: null,
        pca_y: null,
      } as unknown as ApiNode;
    }

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
    SELECT * FROM world_edges WHERE dataset_id = ${datasetId} ORDER BY id
  `.catch(() => sql`
    SELECT * FROM edges WHERE dataset_id = ${datasetId} ORDER BY id
  `);

  return rows.map((row: Record<string, unknown>) => {
    if ('type' in row && !('edge_type' in row)) {
      const parsed = worldJsonRow(row, ['source_refs', 'properties']);
      const properties = asRecord(parsed.properties);
      return {
        ...parsed,
        edge_type: textValue(parsed.type) || 'related_to',
        edge_layer: textValue(properties.edge_layer || properties.layer) || undefined,
        from: parsed.from_id,
        to: parsed.to_id,
        backbone_expand: typeof properties.backbone_expand === 'boolean'
          ? properties.backbone_expand
          : undefined,
      } as unknown as ApiEdge;
    }

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
    SELECT * FROM world_domain_profiles WHERE dataset_id = ${datasetId} ORDER BY id
  `.catch(() => sql`
    SELECT * FROM profiles WHERE dataset_id = ${datasetId} ORDER BY id
  `);

  return rows.map((row: Record<string, unknown>) => {
    if ('domain' in row || 'school_stages_json' in row || 'curriculum_roles_json' in row) {
      const parsed = worldJsonRow(row, [
        'school_stages', 'curriculum_roles', 'source_refs', 'properties',
      ]);
      const properties = asRecord(parsed.properties);
      const schoolStages = Array.isArray(parsed.school_stages) ? parsed.school_stages.map(String) : [];
      const curriculumRoles = Array.isArray(parsed.curriculum_roles) ? parsed.curriculum_roles.map(String) : [];
      const sourceRefs = Array.isArray(parsed.source_refs) ? parsed.source_refs.map(String) : [];
      return {
        ...parsed,
        subject: textValue(properties.subject) || textValue(parsed.domain),
        school_stage: schoolStages[0] || textValue(properties.school_stage),
        grade_band: textValue(properties.grade_band) || schoolStages[0] || '',
        context_key: textValue(properties.context_key) || `${parsed.domain || 'domain'}:${schoolStages[0] || 'unknown'}`,
        curriculum_role: curriculumRoles[0] || textValue(properties.curriculum_role),
        mastery_level: textValue(properties.mastery_level),
        learning_objectives: Array.isArray(properties.learning_objectives) ? properties.learning_objectives : [],
        framework_refs: Array.isArray(properties.framework_refs) ? properties.framework_refs : [],
        textbook_refs: sourceRefs,
        textbook_ids: Array.isArray(properties.textbook_ids) ? properties.textbook_ids : [],
        assessment_signals: Array.isArray(properties.assessment_signals) ? properties.assessment_signals : [],
        source_refs: sourceRefs,
      } as unknown as ApiProfile;
    }

    return stripJsonSuffix(row, [
      'learning_objectives', 'framework_refs', 'textbook_refs',
      'textbook_ids', 'assessment_signals', 'source_refs', 'properties',
    ]) as unknown as ApiProfile;
  });
}

// ── Mentions ──────────────────────────────────────────────

export async function loadMentions(sql: Sql, datasetId: string): Promise<ApiMention[]> {
  const rows = await sql`
    SELECT * FROM world_mentions WHERE dataset_id = ${datasetId}
  `.catch(() => sql`
    SELECT * FROM mentions WHERE dataset_id = ${datasetId}
  `);

  return rows.map((row: Record<string, unknown>) => {
    return stripJsonSuffix(row, ['source_refs', 'confidence_map', 'properties']) as unknown as ApiMention;
  });
}

// ── Evidence ──────────────────────────────────────────────

export async function loadEvidence(sql: Sql, datasetId: string): Promise<ApiEvidence[]> {
  const rows = await sql`
    SELECT * FROM world_evidence WHERE dataset_id = ${datasetId}
  `.catch(() => sql`
    SELECT * FROM evidence WHERE dataset_id = ${datasetId}
  `);

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
    SELECT * FROM world_node_cards
    WHERE dataset_id = ${datasetId} AND node_id = ${nodeId}
    LIMIT 1
  `.catch(() => sql`
    SELECT * FROM node_cards
    WHERE dataset_id = ${datasetId} AND node_id = ${nodeId}
    LIMIT 1
  `);

  if (!rows.length) return null;

  const parsed = stripJsonSuffix(rows[0] as Record<string, unknown>, [
    'sections', 'pattern_refs', 'framework_refs', 'profile_refs',
    'mention_refs', 'source_refs', 'properties',
  ]);

  return {
    pattern_refs: [],
    framework_refs: [],
    profile_refs: [],
    mention_refs: [],
    source_refs: [],
    sections: [],
    properties: {},
    ...parsed,
  } as unknown as ApiNodeCard;
}

function worldJsonRow(
  row: Record<string, unknown>,
  fields: string[],
): Record<string, unknown> {
  const parsed = stripJsonSuffix(row, fields);
  delete parsed.embedding;
  return parsed;
}

function renderCardBody(card: ApiNodeCard | null): ApiUnit['body'] {
  if (!card || !Array.isArray(card.sections)) return null;
  const lines: string[] = [];
  if (card.summary) {
    lines.push(card.summary);
    lines.push('');
  }
  for (const section of card.sections) {
    if (!section || typeof section !== 'object') continue;
    if (section.title) {
      lines.push(`## ${section.title}`);
      lines.push('');
    }
    const content = Array.isArray(section.content)
      ? section.content.map((item) => String(item)).filter(Boolean)
      : [String(section.content ?? '')].filter(Boolean);
    for (const item of content) {
      lines.push(item);
      lines.push('');
    }
  }
  return {
    format: 'markdown',
    content: lines.join('\n').trim(),
    media_refs: [],
    source_refs: card.source_refs || [],
    generated_from: 'node_card',
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function textValue(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function firstImagePath(row: Record<string, unknown>): string {
  const properties = asRecord(row.properties);
  const candidates = [
    properties.path,
    properties.image_path,
    properties.src,
    row.locator,
    row.excerpt,
  ];
  for (const candidate of candidates) {
    const text = textValue(candidate);
    if (!text) continue;
    const markdown = text.match(/!\[[^\]]*\]\(([^)]+)\)/);
    const value = markdown ? markdown[1] : text;
    if (/\.(png|jpe?g|webp|gif|bmp|svg)(\?.*)?$/i.test(value)) return value;
  }
  return '';
}

function resolveImagePath(row: Record<string, unknown>): string {
  const imagePath = firstImagePath(row);
  if (!imagePath || /^https?:\/\//i.test(imagePath)) return imagePath;
  const candidates: string[] = [];
  if (path.isAbsolute(imagePath)) candidates.push(imagePath);
  candidates.push(path.resolve(REPO_ROOT, imagePath));

  const sourcePath = textValue(row.source_path);
  if (sourcePath) {
    const resolvedSource = path.isAbsolute(sourcePath)
      ? sourcePath
      : path.resolve(REPO_ROOT, sourcePath);
    candidates.push(path.resolve(path.dirname(resolvedSource), imagePath));
  }

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[candidates.length - 1] || imagePath;
}

function mediaFromEvidence(rows: Record<string, unknown>[], sourceKey: string): ApiUnitMedia[] {
  const seen = new Set<string>();
  const media: ApiUnitMedia[] = [];
  for (const row of rows) {
    if (String(row.modality || '').toLowerCase() !== 'image') continue;
    const resolvedPath = resolveImagePath(row);
    if (!resolvedPath) continue;
    const key = `${row.id}:${resolvedPath}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const properties = asRecord(row.properties);
    const caption = textValue(properties.caption) || textValue(row.locator) || textValue(row.excerpt);
    const url = /^https?:\/\//i.test(resolvedPath)
      ? resolvedPath
      : `/api/source/${encodeURIComponent(sourceKey)}/assets/${encodeURIComponent(resolvedPath)}`;
    media.push({
      id: `${row.id}:image:${media.length + 1}`,
      kind: 'image',
      url,
      path: resolvedPath,
      caption,
      evidence_id: textValue(row.id),
      source_id: textValue(row.source_id),
      anchor_ref: textValue(row.anchor_ref),
      page_start: row.page_start == null ? null : Number(row.page_start),
      page_end: row.page_end == null ? null : Number(row.page_end),
    });
  }
  return media;
}

function sourceFragmentsFromEvidence(rows: Record<string, unknown>[]): Array<Record<string, unknown>> {
  const byAnchor = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const key = `${textValue(row.source_id)}:${textValue(row.anchor_ref)}`;
    if (!byAnchor.has(key)) byAnchor.set(key, []);
    byAnchor.get(key)!.push(row);
  }

  return Array.from(byAnchor.values()).map((items) => {
    const first = items[0] || {};
    const sorted = items.slice().sort((a, b) => {
      const aLocator = textValue(a.locator);
      const bLocator = textValue(b.locator);
      return aLocator.localeCompare(bLocator, 'zh-CN', { numeric: true });
    });
    const excerpts = sorted
      .map((item) => ({
        id: textValue(item.id),
        modality: textValue(item.modality) || 'text',
        locator: textValue(item.locator),
        excerpt: textValue(item.excerpt),
        page_start: item.page_start == null ? null : Number(item.page_start),
        page_end: item.page_end == null ? null : Number(item.page_end),
        properties: asRecord(item.properties),
      }))
      .filter((item) => item.excerpt);

    return {
      source_id: textValue(first.source_id),
      anchor_ref: textValue(first.anchor_ref),
      source_path: textValue(first.source_path),
      page_start: first.page_start == null ? null : Number(first.page_start),
      page_end: first.page_end == null ? null : Number(first.page_end),
      excerpts,
      text: excerpts
        .filter((item) => item.modality !== 'image')
        .map((item) => item.excerpt)
        .join('\n\n'),
      modalities: [...new Set(excerpts.map((item) => item.modality))],
    };
  });
}

export async function loadUnit(
  sql: Sql,
  datasetId: string,
  nodeId: string,
  sourceKey = datasetId,
): Promise<ApiUnit | null> {
  const nodeRows = await sql`
    SELECT * FROM world_nodes
    WHERE dataset_id = ${datasetId} AND id = ${nodeId}
    LIMIT 1
  `;
  if (!nodeRows.length) return null;

  const outgoingRows = await sql`
    SELECT * FROM world_edges
    WHERE dataset_id = ${datasetId} AND from_id = ${nodeId} AND status != 'deprecated'
    ORDER BY type, to_id
  `;
  const incomingRows = await sql`
    SELECT * FROM world_edges
    WHERE dataset_id = ${datasetId} AND to_id = ${nodeId} AND status != 'deprecated'
    ORDER BY type, from_id
  `;
  const profileRows = await sql`
    SELECT * FROM world_domain_profiles
    WHERE dataset_id = ${datasetId} AND node_id = ${nodeId} AND status != 'deprecated'
    ORDER BY domain, id
  `;
  const mentionRows = await sql`
    SELECT * FROM world_mentions
    WHERE dataset_id = ${datasetId} AND target_type = 'node' AND target_id = ${nodeId}
    ORDER BY source_id, anchor_ref
  `;
  const evidenceRows = await sql`
    SELECT DISTINCT e.*
    FROM world_evidence e
    JOIN world_mentions m ON m.dataset_id = e.dataset_id
    WHERE m.dataset_id = ${datasetId}
      AND m.target_type = 'node'
      AND m.target_id = ${nodeId}
      AND (
        EXISTS (
          SELECT 1
          FROM jsonb_array_elements_text(m.source_refs_json) AS ref(value)
          WHERE ref.value = e.id
        )
        OR (e.source_id = m.source_id AND e.anchor_ref = m.anchor_ref)
      )
    ORDER BY e.source_id, e.anchor_ref, e.id
  `;

  const card = await loadNodeCard(sql, datasetId, nodeId);
  const evidence = evidenceRows.map((row: Record<string, unknown>) => worldJsonRow(row, ['normalized_claims', 'properties']) as unknown as ApiEvidence);
  const evidenceRecords = evidence as unknown as Record<string, unknown>[];
  return {
    node: worldJsonRow(nodeRows[0] as Record<string, unknown>, [
      'aliases', 'domains', 'knowledge_form', 'learning_mode', 'properties', 'external_ids', 'tags',
    ]),
    relations: {
      outgoing: outgoingRows.map((row: Record<string, unknown>) => worldJsonRow(row, ['source_refs', 'properties'])),
      incoming: incomingRows.map((row: Record<string, unknown>) => worldJsonRow(row, ['source_refs', 'properties'])),
    },
    domain_profiles: profileRows.map((row: Record<string, unknown>) => worldJsonRow(row, [
      'school_stages', 'curriculum_roles', 'source_refs', 'properties',
    ])),
    mentions: mentionRows.map((row: Record<string, unknown>) => worldJsonRow(row, ['source_refs', 'properties']) as unknown as ApiMention),
    evidence,
    media: mediaFromEvidence(evidenceRecords, sourceKey),
    source_fragments: sourceFragmentsFromEvidence(evidenceRecords),
    card,
    body: renderCardBody(card),
  };
}

export async function loadPipelinePayload(
  sql: Sql,
  datasetId: string,
): Promise<PipelineResponse> {
  const lessonRows = await sql`
    SELECT lesson_run_id, book_id, batch_anchor, status, counts_json, properties_json, created_at, updated_at
    FROM world_lesson_runs
    WHERE dataset_id = ${datasetId}
    ORDER BY updated_at DESC, created_at DESC
    LIMIT 200
  `.catch(() => []);

  const mergeRows = await sql`
    SELECT merge_run_id, selection_json, stats_json, status, created_at, updated_at
    FROM world_merge_runs
    WHERE dataset_id = ${datasetId}
    ORDER BY updated_at DESC, created_at DESC
    LIMIT 30
  `.catch(() => []);

  const reviewRows = await sql`
    SELECT merge_run_id, lesson_run_id, raw_node_id, canonical_node_id, similarity, rationale_json, created_at
    FROM world_canonical_node_map
    WHERE dataset_id = ${datasetId} AND resolution = 'review'
    ORDER BY created_at DESC
    LIMIT 100
  `.catch(() => []);

  const lesson_runs = lessonRows.map((row: Record<string, unknown>) => {
    const counts = row.counts_json as Record<string, unknown> | undefined;
    const props = row.properties_json as Record<string, unknown> | undefined;
    return {
      lesson_run_id: String(row.lesson_run_id),
      book_id: String(row.book_id),
      batch_anchor: String(row.batch_anchor),
      status: String(row.status),
      counts: counts || {},
      quality_issues: Array.isArray(props?.quality_issues) ? props.quality_issues.map(String) : [],
      created_at: (row.created_at as string | null) ?? null,
      updated_at: (row.updated_at as string | null) ?? null,
    };
  });

  const summary = {
    lesson_runs: lesson_runs.length,
    staged: lesson_runs.filter((row) => row.status === 'staged').length,
    merging: lesson_runs.filter((row) => row.status === 'merging').length,
    merged: lesson_runs.filter((row) => row.status === 'merged').length,
    qa_passed: lesson_runs.filter((row) => row.status === 'qa_passed').length,
    blocked: lesson_runs.filter((row) => row.status === 'blocked').length,
    review_items: reviewRows.length,
  };

  return {
    dataset_id: datasetId,
    summary,
    lesson_runs,
    merge_runs: mergeRows.map((row: Record<string, unknown>) => ({
      merge_run_id: String(row.merge_run_id),
      status: String(row.status),
      selection: Array.isArray(row.selection_json) ? row.selection_json.map(String) : [],
      stats: (row.stats_json as Record<string, unknown>) || {},
      created_at: (row.created_at as string | null) ?? null,
      updated_at: (row.updated_at as string | null) ?? null,
    })),
    review_items: reviewRows.map((row: Record<string, unknown>) => ({
      merge_run_id: String(row.merge_run_id),
      lesson_run_id: String(row.lesson_run_id),
      raw_node_id: String(row.raw_node_id),
      canonical_node_id: String(row.canonical_node_id),
      similarity: Number(row.similarity ?? 0),
      rationale: (row.rationale_json as Record<string, unknown>) || {},
      created_at: (row.created_at as string | null) ?? null,
    })),
  };
}

// ── Book IDs ──────────────────────────────────────────────

export async function loadBookIds(sql: Sql, datasetId: string): Promise<string[]> {
  const worldTableCheck = await sql<{ regclass: string | null }[]>`
    SELECT to_regclass('world_evidence') AS regclass
  `;
  if (worldTableCheck[0]?.regclass) {
    const rows = await sql<{ source_id: string }[]>`
      SELECT DISTINCT source_id FROM world_evidence
      WHERE dataset_id = ${datasetId} AND source_type = 'textbook'
      UNION
      SELECT DISTINCT source_id FROM world_mentions
      WHERE dataset_id = ${datasetId} AND source_type = 'textbook'
      ORDER BY source_id
    `.catch(() => [] as { source_id: string }[]);
    return rows.map((r) => r.source_id);
  }

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
  const worldTableCheck = await sql<{ regclass: string | null }[]>`
    SELECT to_regclass('world_datasets') AS regclass
  `;

  if (worldTableCheck[0]?.regclass) {
    const datasets = await sql<DatasetRow[]>`
      SELECT dataset_id, dataset_name AS version_key, COALESCE(root_path, '') AS root_path, is_active
      FROM world_datasets
      ORDER BY is_active DESC, dataset_id ASC
    `;

    if (datasets.length > 0) {
      let activeSource: string | null = null;
      const sources = await Promise.all(
        datasets.map(async (row) => {
          const bookIds = await loadBookIds(sql, row.dataset_id);
          const profileRows = await sql<{ count: number }[]>`
            SELECT COUNT(*) AS count FROM world_domain_profiles WHERE dataset_id = ${row.dataset_id}
          `.catch(() => [{ count: 0 }]);
          const profileCount = Number(profileRows[0]?.count ?? 0);

          if (row.is_active) activeSource = row.dataset_id;

          return {
            key: row.dataset_id,
            label: row.version_key.toUpperCase(),
            description: `World knowledge dataset ${row.dataset_id}`,
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

    return {
      active_source: 'main',
      sources: [
        {
          key: 'main',
          label: 'MAIN',
          description: 'Default world knowledge dataset',
          has_profiles: false,
          book_count: 0,
          books: [],
          is_active: false,
          root_path: 'data/main',
        },
      ],
    };
  }

  const tableCheck = await sql<{ regclass: string | null }[]>`
    SELECT to_regclass('datasets') AS regclass
  `;

  if (!tableCheck[0]?.regclass) {
    return {
      active_source: 'main',
      sources: [
        {
          key: 'main',
          label: 'MAIN',
          description: 'Default world knowledge dataset',
          has_profiles: false,
          book_count: 0,
          books: [],
          is_active: false,
          root_path: 'data/main',
        },
      ],
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
        SELECT COUNT(*) AS count FROM world_domain_profiles WHERE dataset_id = ${row.dataset_id}
      `.catch(() => sql<{ count: number }[]>`
        SELECT COUNT(*) AS count FROM profiles WHERE dataset_id = ${row.dataset_id}
      `);
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
    SELECT COUNT(*) AS count FROM world_domain_profiles WHERE dataset_id = ${datasetRow.dataset_id}
  `.catch(() => sql<{ count: number }[]>`
    SELECT COUNT(*) AS count FROM profiles WHERE dataset_id = ${datasetRow.dataset_id}
  `);
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
