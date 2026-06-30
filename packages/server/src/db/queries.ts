import type { Sql } from './connection.js';
import type {
  ApiNode, ApiEdge, ApiProfile, ApiMention, ApiEvidence, ApiNodeCard, ApiUnit, ApiUnitBody, ApiUnitDomainProfile,
  ApiUnitMedia, ApiUnitNode, ApiUnitRelation, ApiUnitSourceFragment,
  OutlineData, OutlineItem, PipelineJobEvent, PipelineJobStage, PipelineJobStatusResponse, PipelineResponse,
  PipelineWorkerState,
} from '@okm/types';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from '../utils/paths.js';
import { resolveEvidenceImagePath } from '../utils/markdown-image-paths.js';
import { buildApiUnitCompleteness } from './unit-completeness.js';

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
    SELECT dataset_id, dataset_name AS version_key, COALESCE(root_path, '') AS root_path, is_active
    FROM world_datasets
    WHERE dataset_id = ${key} OR dataset_name = ${key}
    ORDER BY is_active DESC, dataset_id ASC
    LIMIT 1
  `.catch(() => [] as DatasetRow[]);
  return rows[0];
}

// ── Nodes ─────────────────────────────────────────────────

export async function loadNodes(sql: Sql, datasetId: string): Promise<ApiNode[]> {
  const rows = await sql`
    SELECT * FROM world_nodes WHERE dataset_id = ${datasetId} ORDER BY id
  `;

  return rows.map((row: Record<string, unknown>) => {
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
        learning_modes: Array.isArray(parsed.learning_mode) ? parsed.learning_mode : [],
        scope: parsed.scope || '',
        bridge_tags: parsed.tags || [],
        tags: parsed.tags || [],
      },
      community_id: null,
      pca_x: null,
      pca_y: null,
    } as unknown as ApiNode;
  });
}

// ── Edges ─────────────────────────────────────────────────

export async function loadEdges(sql: Sql, datasetId: string): Promise<ApiEdge[]> {
  const rows = await sql`
    SELECT * FROM world_edges WHERE dataset_id = ${datasetId} ORDER BY id
  `;

  return rows.map((row: Record<string, unknown>) => {
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
  });
}

// ── Profiles ──────────────────────────────────────────────

export async function loadProfiles(sql: Sql, datasetId: string): Promise<ApiProfile[]> {
  const rows = await sql`
    SELECT * FROM world_domain_profiles WHERE dataset_id = ${datasetId} ORDER BY id
  `;

  return rows.map((row: Record<string, unknown>) => {
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
  });
}

// ── Mentions ──────────────────────────────────────────────

export async function loadMentions(sql: Sql, datasetId: string): Promise<ApiMention[]> {
  const rows = await sql`
    SELECT * FROM world_mentions WHERE dataset_id = ${datasetId}
  `;

  return rows.map((row: Record<string, unknown>) => {
    return stripJsonSuffix(row, ['source_refs', 'confidence_map', 'properties']) as unknown as ApiMention;
  });
}

// ── Evidence ──────────────────────────────────────────────

export async function loadEvidence(sql: Sql, datasetId: string): Promise<ApiEvidence[]> {
  const rows = await sql`
    SELECT * FROM world_evidence WHERE dataset_id = ${datasetId}
  `;

  return rows
    .map((row: Record<string, unknown>) => stripJsonSuffix(row, ['normalized_claims', 'properties']) as unknown as ApiEvidence)
    .filter((row) => !isHiddenImageEvidence(row as unknown as Record<string, unknown>));
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
  `;

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

async function loadNodeBody(
  sql: Sql,
  datasetId: string,
  nodeId: string,
): Promise<ApiUnitBody | null> {
  const rows = await sql`
    SELECT *
    FROM world_node_bodies
    WHERE dataset_id = ${datasetId}
      AND node_id = ${nodeId}
      AND status != 'deprecated'
    LIMIT 1
  `.catch(() => []);
  if (!rows.length) return null;

  const parsed = worldJsonRow(rows[0] as Record<string, unknown>, [
    'media_refs', 'source_refs', 'properties',
  ]);
  const content = textValue(parsed.content);
  if (!content) return null;
  const generatedFrom = textValue(parsed.generated_from);
  if (generatedFrom === 'node_card_fallback') return null;
  return {
    node_id: textValue(parsed.node_id),
    format: 'markdown',
    content,
    media_refs: Array.isArray(parsed.media_refs) ? parsed.media_refs as Array<Record<string, unknown>> : [],
    source_refs: Array.isArray(parsed.source_refs) ? parsed.source_refs.map(String).filter(Boolean) : [],
    generated_from: (
      generatedFrom === 'manual' ||
      generatedFrom === 'card_expansion' ||
      generatedFrom === 'imported_unit' ||
      generatedFrom === 'model_generation'
    ) ? generatedFrom : 'manual',
    properties: asRecord(parsed.properties),
    status: textValue(parsed.status) || 'active',
    created_at: textValue(parsed.created_at) || null,
    updated_at: textValue(parsed.updated_at) || null,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function textValue(value: unknown): string {
  return value == null ? '' : String(value).trim();
}

function numberValue(value: unknown, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveImagePath(row: Record<string, unknown>): string {
  return resolveEvidenceImagePath(row, markdownCache);
}

function mediaFromEvidence(rows: Record<string, unknown>[], sourceKey: string): ApiUnitMedia[] {
  const seen = new Set<string>();
  const media: ApiUnitMedia[] = [];
  for (const row of rows) {
    if (String(row.modality || '').toLowerCase() !== 'image') continue;
    if (isHiddenImageEvidence(row)) continue;
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

function isHiddenImageEvidence(row: Record<string, unknown>): boolean {
  if (String(row.modality || '').toLowerCase() !== 'image') return false;
  const properties = Object.keys(asRecord(row.properties)).length > 0 ? asRecord(row.properties) : asRecord(row.properties_json);
  const relevance = asRecord(properties.image_relevance);
  const status = textValue(relevance.review_status);
  const label = textValue(relevance.relevance);
  if (relevance.keep === false || status === 'rejected') return true;
  if (status === 'pending') return true;
  if (!status && label === 'uncertain') return true;
  return false;
}

const markdownCache = new Map<string, string[] | null>();

function loadMarkdownLines(markdownPath: string): string[] | null {
  if (!markdownPath) return null;
  const cached = markdownCache.get(markdownPath);
  if (cached !== undefined) return cached;

  if (!existsSync(markdownPath)) {
    markdownCache.set(markdownPath, null);
    return null;
  }

  try {
    const lines = readFileSync(markdownPath, 'utf-8').split(/\r?\n/);
    markdownCache.set(markdownPath, lines);
    return lines;
  } catch {
    markdownCache.set(markdownPath, null);
    return null;
  }
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function dashedSourceId(value: string): string {
  return value.replace(/_/g, '-');
}

function sourceIdFromAnchor(anchorRef: string): string {
  const match = anchorRef.match(/^struct:([^:]+):/);
  return match?.[1] || '';
}

function sourceIdFromPath(sourcePath: string): string {
  if (!sourcePath) return '';
  const normalized = sourcePath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  const fullIndex = parts.lastIndexOf('full.md');
  if (fullIndex > 0) return parts[fullIndex - 1] || '';
  return path.basename(path.dirname(normalized));
}

function outlineCandidatesForRow(row: Record<string, unknown>): string[] {
  const sourceId = textValue(row.source_id);
  const anchorSourceId = sourceIdFromAnchor(textValue(row.anchor_ref));
  const pathSourceId = sourceIdFromPath(textValue(row.source_path));
  return uniqueStrings([
    sourceId,
    dashedSourceId(sourceId),
    anchorSourceId,
    dashedSourceId(anchorSourceId),
    pathSourceId,
    dashedSourceId(pathSourceId),
  ]);
}

function resolveRepoPath(value: string): string {
  return path.isAbsolute(value) ? path.resolve(value) : path.resolve(REPO_ROOT, value);
}

function markdownPathCandidates(
  row: Record<string, unknown>,
  outline: OutlineData,
  bookId: string,
): string[] {
  return uniqueStrings([
    textValue(row.source_path),
    textValue(outline.source_path),
    `data/mineru/${bookId}/full.md`,
  ]).map(resolveRepoPath);
}

function findOutlineMatch(
  row: Record<string, unknown>,
  outlines: Map<string, OutlineData>,
): { bookId: string; outline: OutlineData; item: OutlineItem } | null {
  const anchorRef = textValue(row.anchor_ref);
  if (!anchorRef) return null;

  for (const bookId of outlineCandidatesForRow(row)) {
    const outline = outlines.get(bookId) ?? null;
    const item = outline?.items?.find((candidate) => candidate.id === anchorRef);
    if (outline && item) return { bookId, outline, item };
  }

  return null;
}

function assetUrlForPath(sourceKey: string, resolvedPath: string): string {
  return `/api/source/${encodeURIComponent(sourceKey)}/assets/${encodeURIComponent(resolvedPath)}`;
}

function assetPathKey(resolvedPath: string): string {
  return path.resolve(resolvedPath).replace(/\\/g, '/');
}

function resolveMarkdownAssetPath(markdownPath: string, assetRef: string): string | null {
  const cleanRef = assetRef.trim();
  if (!cleanRef || /^(https?:|data:|blob:|\/api\/)/i.test(cleanRef) || cleanRef.startsWith('#')) {
    return null;
  }

  const withoutQuery = cleanRef.split(/[?#]/, 1)[0] || cleanRef;
  const candidates = path.isAbsolute(withoutQuery)
    ? [path.resolve(withoutQuery)]
    : [
      path.resolve(path.dirname(markdownPath), withoutQuery),
      path.resolve(REPO_ROOT, withoutQuery),
    ];

  return candidates.find((candidate) => existsSync(candidate)) || null;
}

function visibleImageAssetPaths(rows: Record<string, unknown>[]): Set<string> {
  const paths = new Set<string>();
  for (const row of rows) {
    if (String(row.modality || '').toLowerCase() !== 'image') continue;
    if (isHiddenImageEvidence(row)) continue;
    const resolvedPath = resolveImagePath(row);
    if (!resolvedPath || /^https?:\/\//i.test(resolvedPath)) continue;
    paths.add(assetPathKey(resolvedPath));
  }
  return paths;
}

function rewriteMarkdownImageUrls(
  markdown: string,
  markdownPath: string,
  sourceKey: string,
  allowedAssetPaths?: Set<string>,
): string {
  return markdown.replace(/!\[([^\]]*)\]\(([^)\n]+)\)/g, (match, alt: string, src: string) => {
    const resolvedPath = resolveMarkdownAssetPath(markdownPath, src);
    if (!resolvedPath) return match;
    if (allowedAssetPaths && !allowedAssetPaths.has(assetPathKey(resolvedPath))) return '';
    return `![${alt}](${assetUrlForPath(sourceKey, resolvedPath)})`;
  });
}

function normalizeDetailsSummaries(markdown: string): string {
  const labels: Record<string, string> = {
    chemical: '化学图示',
    equation: '公式说明',
    flowchart: '流程图',
    image: '图片说明',
    natural_image: '实物图片',
    table: '表格说明',
    text: '文字说明',
    text_image: '图片文字',
  };

  return markdown.replace(
    /<summary>([^<]+)<\/summary>/g,
    (_match, label: string) => `<summary>${labels[label.trim()] || label}</summary>`,
  );
}

function modalitiesFromMarkdown(markdown: string, fallback: string[]): string[] {
  const modalities = new Set(fallback.map((value) => value.trim()).filter(Boolean));
  if (markdown.includes('![](') || /!\[[^\]]*\]\(/.test(markdown)) modalities.add('image');
  if (/<table\b/i.test(markdown) || /\|.+\|/.test(markdown)) modalities.add('table');
  if (/\$[^$\n]+\$/.test(markdown) || /\$\$[\s\S]+?\$\$/.test(markdown)) modalities.add('equation');
  modalities.add('text');
  return [...modalities];
}

function markdownFragmentFromOutline(
  items: Record<string, unknown>[],
  sourceKey: string,
  outlines: Map<string, OutlineData>,
): Record<string, unknown> | null {
  const first = items[0] || {};
  const match = findOutlineMatch(first, outlines);
  if (!match) return null;

  const { bookId, outline, item } = match;
  const mdStart = Number(item.md_start);
  const mdEnd = Number(item.md_end);
  if (!Number.isFinite(mdStart) || !Number.isFinite(mdEnd) || mdStart <= 0 || mdEnd < mdStart) {
    return null;
  }

  for (const markdownPath of markdownPathCandidates(first, outline, bookId)) {
    const lines = loadMarkdownLines(markdownPath);
    if (!lines) continue;

    const markdown = lines.slice(mdStart - 1, Math.min(mdEnd, lines.length)).join('\n').trim();
    if (!markdown) continue;

    const normalizedMarkdown = normalizeDetailsSummaries(
      rewriteMarkdownImageUrls(markdown, markdownPath, sourceKey, visibleImageAssetPaths(items)),
    );
    const fallbackModalities = uniqueStrings(items.map((row) => textValue(row.modality) || 'text'));
    const pageStart = item.page_start ?? first.page_start;
    const pageEnd = item.page_end ?? first.page_end ?? pageStart;

    return {
      source_id: textValue(first.source_id),
      anchor_ref: textValue(first.anchor_ref),
      source_path: markdownPath,
      page_start: pageStart == null ? null : Number(pageStart),
      page_end: pageEnd == null ? null : Number(pageEnd),
      title: item.title || item.label || textValue(first.anchor_ref),
      source_kind: 'outline_markdown',
      is_full_source: true,
      md_start: mdStart,
      md_end: mdEnd,
      excerpts: [{
        id: `${textValue(first.source_id)}:${textValue(first.anchor_ref)}:source-markdown`,
        modality: 'text',
        locator: item.title || item.label || textValue(first.locator),
        excerpt: normalizedMarkdown,
        page_start: pageStart == null ? null : Number(pageStart),
        page_end: pageEnd == null ? null : Number(pageEnd),
        properties: {
          source: 'outline_markdown',
          outline_id: item.id,
          outline_title: item.title,
          md_start: mdStart,
          md_end: mdEnd,
        },
      }],
      text: normalizedMarkdown,
      modalities: modalitiesFromMarkdown(normalizedMarkdown, fallbackModalities),
    };
  }

  return null;
}

function evidenceFragment(items: Record<string, unknown>[]): Record<string, unknown> {
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
    source_kind: 'evidence_excerpt',
    is_full_source: false,
    excerpts,
    text: excerpts
      .filter((item) => item.modality !== 'image')
      .map((item) => item.excerpt)
      .join('\n\n'),
    modalities: [...new Set(excerpts.map((item) => item.modality))],
  };
}

function sourceFragmentsFromEvidence(
  rows: Record<string, unknown>[],
  sourceKey: string,
  outlines: Map<string, OutlineData>,
): ApiUnitSourceFragment[] {
  const byAnchor = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const key = `${textValue(row.source_id)}:${textValue(row.anchor_ref)}`;
    if (!byAnchor.has(key)) byAnchor.set(key, []);
    byAnchor.get(key)!.push(row);
  }

  return Array.from(byAnchor.values()).map((items) => (
    markdownFragmentFromOutline(items, sourceKey, outlines) || evidenceFragment(items)
  ) as unknown as ApiUnitSourceFragment);
}

export async function loadTextbookOutlinePayload(
  sql: Sql,
  datasetId: string,
  bookId: string,
): Promise<Record<string, unknown> | null> {
  const rows = await sql<{ outline_json: unknown }[]>`
    SELECT outline_json
    FROM world_textbook_outlines
    WHERE dataset_id = ${datasetId}
      AND book_id = ${bookId}
    LIMIT 1
  `.catch(() => []);
  const outline = rows[0]?.outline_json;
  return isRecord(outline) ? outline : null;
}

async function loadTextbookOutlines(
  sql: Sql,
  datasetId: string,
  bookIds: string[],
): Promise<Map<string, OutlineData>> {
  const cleanBookIds = uniqueStrings(bookIds);
  if (cleanBookIds.length === 0) return new Map();
  const rows = await sql<{ book_id: string; outline_json: unknown }[]>`
    SELECT book_id, outline_json
    FROM world_textbook_outlines
    WHERE dataset_id = ${datasetId}
      AND book_id = ANY(${cleanBookIds})
  `.catch(() => []);
  const result = new Map<string, OutlineData>();
  for (const row of rows) {
    if (isRecord(row.outline_json)) {
      result.set(row.book_id, normalizeOutlineRecord(row.outline_json));
    }
  }
  return result;
}

function normalizeOutlineRecord(outline: Record<string, unknown>): OutlineData {
  const rawItems = Array.isArray(outline.items)
    ? outline.items
    : Array.isArray(outline.structure)
      ? outline.structure
      : [];
  return {
    ...outline,
    items: rawItems as OutlineItem[],
  } as OutlineData;
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
  const body = await loadNodeBody(sql, datasetId, nodeId);
  const evidence = evidenceRows
    .map((row: Record<string, unknown>) => worldJsonRow(row, ['normalized_claims', 'properties']) as unknown as ApiEvidence)
    .filter((row) => !isHiddenImageEvidence(row as unknown as Record<string, unknown>));
  const evidenceRecords = evidence as unknown as Record<string, unknown>[];
  const outlines = await loadTextbookOutlines(
    sql,
    datasetId,
    evidenceRecords.flatMap((row) => outlineCandidatesForRow(row)),
  );
  const unitWithoutCompleteness = {
    node: worldJsonRow(nodeRows[0] as Record<string, unknown>, [
      'aliases', 'domains', 'knowledge_form', 'learning_mode', 'properties', 'external_ids', 'tags',
    ]) as unknown as ApiUnitNode,
    relations: {
      outgoing: outgoingRows.map((row: Record<string, unknown>) => (
        worldJsonRow(row, ['source_refs', 'properties']) as unknown as ApiUnitRelation
      )),
      incoming: incomingRows.map((row: Record<string, unknown>) => (
        worldJsonRow(row, ['source_refs', 'properties']) as unknown as ApiUnitRelation
      )),
    },
    domain_profiles: profileRows.map((row: Record<string, unknown>) => worldJsonRow(row, [
      'school_stages', 'curriculum_roles', 'source_refs', 'properties',
    ]) as unknown as ApiUnitDomainProfile),
    mentions: mentionRows.map((row: Record<string, unknown>) => worldJsonRow(row, ['source_refs', 'properties']) as unknown as ApiMention),
    evidence,
    media: mediaFromEvidence(evidenceRecords, sourceKey),
    source_fragments: sourceFragmentsFromEvidence(evidenceRecords, sourceKey, outlines),
    card,
    body,
  };
  return {
    ...unitWithoutCompleteness,
    completeness: buildApiUnitCompleteness(unitWithoutCompleteness),
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

interface PipelineJobRow {
  job_id: string;
  book_id: string;
  status: string;
  current_stage_id: string | null;
  progress_json: unknown;
  log_path: string | null;
  updated_at: string | null;
  completed_at: string | null;
  error: string | null;
}

interface PipelineStageRow {
  stage_id: string;
  status: string;
  label: string;
  progress_json: unknown;
  error: string | null;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string | null;
}

interface PipelineWorkerRow {
  worker_slot: number;
  stage_id: string;
  status: string;
  lesson_run_id: string | null;
  batch_anchor: string | null;
  error: string | null;
  data_json: unknown;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string | null;
}

interface PipelineEventRow {
  event_id: string;
  stage_id: string;
  event_type: string;
  status: string | null;
  worker_slot: number | null;
  lesson_run_id: string | null;
  batch_anchor: string | null;
  detail: string | null;
  data_json: unknown;
  created_at: string | null;
}

export async function loadPipelineJobStatusPayload(
  sql: Sql,
  datasetId: string,
  jobId: string,
): Promise<PipelineJobStatusResponse> {
  const jobRows = await sql<PipelineJobRow[]>`
    SELECT job_id, book_id, status, current_stage_id, progress_json, log_path, updated_at, completed_at, error
    FROM world_pipeline_jobs
    WHERE dataset_id = ${datasetId} AND job_id = ${jobId}
    LIMIT 1
  `;

  if (!jobRows.length) {
    return {
      job_id: jobId,
      book_id: '',
      status: 'unknown',
      log_path: '',
      progress: {},
      stages: [],
      current_stage: null,
      worker_states: [],
      recent_events: [],
      updated_at: null,
      completed_at: null,
      error: null,
    };
  }

  const [stageRows, workerRows, eventRows] = await Promise.all([
    sql<PipelineStageRow[]>`
      SELECT stage_id, status, label, progress_json, error, started_at, completed_at, updated_at
      FROM world_pipeline_job_stages
      WHERE dataset_id = ${datasetId} AND job_id = ${jobId}
      ORDER BY sort_order ASC, updated_at ASC
    `,
    sql<PipelineWorkerRow[]>`
      SELECT worker_slot, stage_id, status, lesson_run_id, batch_anchor, error, data_json, started_at, completed_at, updated_at
      FROM world_pipeline_worker_states
      WHERE dataset_id = ${datasetId} AND job_id = ${jobId}
      ORDER BY worker_slot ASC
    `,
    sql<PipelineEventRow[]>`
      SELECT event_id, stage_id, event_type, status, worker_slot, lesson_run_id, batch_anchor, detail, data_json, created_at
      FROM world_pipeline_job_events
      WHERE dataset_id = ${datasetId} AND job_id = ${jobId}
      ORDER BY created_at DESC
      LIMIT 80
    `,
  ]);

  const job = jobRows[0]!;
  const stages: PipelineJobStage[] = stageRows.map((row) => ({
    id: row.stage_id,
    status: row.status,
    label: row.label,
    progress: asRecord(row.progress_json),
    error: row.error ?? undefined,
    started_at: row.started_at ?? null,
    completed_at: row.completed_at ?? null,
    updated_at: row.updated_at ?? null,
  }));
  const currentStage = stages.find((stage) => stage.id === job.current_stage_id)
    ?? stages.find((stage) => stage.status === 'running')
    ?? stages.find((stage) => stage.status === 'blocked')
    ?? stages.at(-1)
    ?? null;
  const status: PipelineJobStatusResponse['status'] =
    job.status === 'completed' || job.status === 'blocked' || job.status === 'running'
      ? job.status
      : 'unknown';

  return {
    job_id: job.job_id,
    book_id: job.book_id,
    status,
    log_path: job.log_path ?? '',
    progress: asRecord(job.progress_json),
    stages,
    current_stage: currentStage,
    worker_states: workerRows.map((row): PipelineWorkerState => ({
      worker_slot: Number(row.worker_slot),
      stage_id: row.stage_id,
      status: row.status,
      lesson_run_id: row.lesson_run_id ?? null,
      batch_anchor: row.batch_anchor ?? null,
      error: row.error ?? null,
      data: asRecord(row.data_json),
      started_at: row.started_at ?? null,
      completed_at: row.completed_at ?? null,
      updated_at: row.updated_at ?? null,
    })),
    recent_events: eventRows.map((row): PipelineJobEvent => ({
      event_id: row.event_id,
      stage_id: row.stage_id,
      event_type: row.event_type,
      status: row.status ?? null,
      worker_slot: row.worker_slot == null ? null : Number(row.worker_slot),
      lesson_run_id: row.lesson_run_id ?? null,
      batch_anchor: row.batch_anchor ?? null,
      detail: row.detail ?? null,
      data: asRecord(row.data_json),
      created_at: row.created_at ?? null,
    })),
    updated_at: job.updated_at ?? null,
    completed_at: job.completed_at ?? null,
    error: job.error ?? null,
  };
}

type EnrichBookSummaryRow = {
  path: string;
  filename: string;
  title: string | null;
  subject: string | null;
  stage: string | null;
  grade: string | null;
  course: string | null;
  publisher: string | null;
  volume: string | null;
  root_count: number;
  node_count: number;
  max_depth: number;
};

export async function loadEnrichIndexPayload(
  sql: Sql,
  datasetId: string,
): Promise<Record<string, unknown> | null> {
  const libraryRows = await sql<{
    generated_at: string | null;
    book_count: number;
    subject_count: number;
    node_count: number;
  }[]>`
    SELECT generated_at, book_count, subject_count, node_count
    FROM world_enrich_library
    WHERE dataset_id = ${datasetId}
    LIMIT 1
  `.catch(() => []);
  const bookRows = await sql<EnrichBookSummaryRow[]>`
    SELECT path, filename, title, subject, stage, grade, course, publisher, volume,
           root_count, node_count, max_depth
    FROM world_enrich_books
    WHERE dataset_id = ${datasetId}
    ORDER BY subject NULLS LAST, stage NULLS LAST, grade NULLS LAST, title ASC, path ASC
  `.catch(() => []);
  if (!libraryRows[0] && bookRows.length === 0) return null;

  const books = bookRows.map((row) => enrichBookSummary(row));
  const library = libraryRows[0];
  return {
    generated_at: library?.generated_at ?? undefined,
    book_count: numberValue(library?.book_count, books.length),
    subject_count: numberValue(
      library?.subject_count,
      new Set(books.map((book) => textValue(book.subject)).filter(Boolean)).size,
    ),
    node_count: numberValue(
      library?.node_count,
      books.reduce((sum, book) => sum + numberValue(book.node_count, 0), 0),
    ),
    books,
  };
}

export async function loadEnrichBookPayload(
  sql: Sql,
  datasetId: string,
  bookPath: string,
): Promise<Record<string, unknown> | null> {
  const rows = await sql<(EnrichBookSummaryRow & { metadata_json: unknown; tree_json: unknown })[]>`
    SELECT path, filename, title, subject, stage, grade, course, publisher, volume,
           root_count, node_count, max_depth, metadata_json, tree_json
    FROM world_enrich_books
    WHERE dataset_id = ${datasetId}
      AND path = ${bookPath}
    LIMIT 1
  `.catch(() => []);
  const row = rows[0];
  if (!row) return null;
  return {
    book: enrichBookSummary(row),
    tree: Array.isArray(row.tree_json) ? row.tree_json : [],
  };
}

function enrichBookSummary(row: EnrichBookSummaryRow): Record<string, unknown> {
  const title = textValue(row.title) || [
    row.stage,
    row.grade,
    row.course,
    row.publisher,
    row.volume,
  ].map(textValue).filter(Boolean).join(' · ') || row.filename;
  return {
    path: row.path,
    filename: row.filename,
    title,
    subject: row.subject ?? undefined,
    stage: row.stage ?? undefined,
    grade: row.grade ?? undefined,
    course: row.course ?? undefined,
    publisher: row.publisher ?? undefined,
    volume: row.volume ?? undefined,
    root_count: numberValue(row.root_count, 0),
    node_count: numberValue(row.node_count, 0),
    max_depth: numberValue(row.max_depth, 0),
  };
}

// ── Book IDs ──────────────────────────────────────────────

export async function loadBookIds(sql: Sql, datasetId: string): Promise<string[]> {
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
): Promise<BundlePayload> {
  const datasetRow = await resolveDatasetRow(sql, datasetId);
  if (!datasetRow) throw new Error(`Unknown dataset: ${datasetId}`);

  const profileRows = await sql<{ count: number }[]>`
    SELECT COUNT(*) AS count FROM world_domain_profiles WHERE dataset_id = ${datasetRow.dataset_id}
  `.catch(() => [{ count: 0 }]);
  const profileCount = Number(profileRows[0]?.count ?? 0);

  const allMentions = await loadMentions(sql, datasetRow.dataset_id);
  const allEvidence = await loadEvidence(sql, datasetRow.dataset_id);

  const textbookMentions = allMentions.filter((m) => m.source_type === 'textbook');
  const textbookEvidence = allEvidence.filter((e) => e.source_type === 'textbook');

  const mentionsByBook = groupBy(textbookMentions, 'source_id');
  const evidenceByBook = groupBy(textbookEvidence, 'source_id');

  const bookIds = sortedUnion(Object.keys(mentionsByBook), Object.keys(evidenceByBook));
  const outlines = await loadTextbookOutlines(sql, datasetRow.dataset_id, bookIds);

  const books = bookIds.map((bookId) => ({
    bookId,
    outline: outlines.get(bookId) ?? null,
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
