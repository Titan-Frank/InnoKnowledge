import type { Sql } from './connection.js';
import type {
  ApiNode, ApiEdge, ApiProfile, ApiMention, ApiEvidence, ApiNodeCard, ApiUnit, ApiUnitBody, ApiUnitMedia,
  OutlineData, OutlineItem, PipelineResponse,
} from '@okm/types';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { OUTLINES_DIR, REPO_ROOT } from '../utils/paths.js';

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

function uniqueTextValues(values: unknown[]): string[] {
  return [...new Set(values.map((value) => textValue(value)).filter(Boolean))];
}

function collectCardSourceRefs(card: ApiNodeCard): string[] {
  const refs: unknown[] = Array.isArray(card.source_refs) ? [...card.source_refs] : [];
  for (const section of card.sections || []) {
    if (!section || typeof section !== 'object') continue;
    if (Array.isArray(section.source_refs)) refs.push(...section.source_refs);
  }
  return uniqueTextValues(refs);
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
  return {
    node_id: textValue(parsed.node_id),
    format: 'markdown',
    content,
    media_refs: Array.isArray(parsed.media_refs) ? parsed.media_refs as Array<Record<string, unknown>> : [],
    source_refs: Array.isArray(parsed.source_refs) ? parsed.source_refs.map(String).filter(Boolean) : [],
    generated_from: (
      parsed.generated_from === 'manual' ||
      parsed.generated_from === 'card_expansion' ||
      parsed.generated_from === 'imported_unit' ||
      parsed.generated_from === 'node_card_fallback'
    ) ? parsed.generated_from : 'manual',
    properties: asRecord(parsed.properties),
    status: textValue(parsed.status) || 'active',
    created_at: textValue(parsed.created_at) || null,
    updated_at: textValue(parsed.updated_at) || null,
  };
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
    source_refs: collectCardSourceRefs(card),
    generated_from: 'node_card_fallback',
    properties: {},
    status: 'active',
    updated_at: card.updated_at ?? null,
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
  return relevance.keep === false || status === 'rejected' || status === 'pending' || (!status && label === 'uncertain');
}

const outlineCache = new Map<string, OutlineData | null>();
const markdownCache = new Map<string, string[] | null>();

function loadOutlineByBookId(bookId: string): OutlineData | null {
  if (!bookId) return null;
  const cached = outlineCache.get(bookId);
  if (cached !== undefined) return cached;

  const outlinePath = path.resolve(OUTLINES_DIR, `${bookId}.outline.json`);
  if (!existsSync(outlinePath)) {
    outlineCache.set(bookId, null);
    return null;
  }

  try {
    const data = JSON.parse(readFileSync(outlinePath, 'utf-8')) as OutlineData;
    outlineCache.set(bookId, data);
    return data;
  } catch {
    outlineCache.set(bookId, null);
    return null;
  }
}

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

function findOutlineMatch(row: Record<string, unknown>): { bookId: string; outline: OutlineData; item: OutlineItem } | null {
  const anchorRef = textValue(row.anchor_ref);
  if (!anchorRef) return null;

  for (const bookId of outlineCandidatesForRow(row)) {
    const outline = loadOutlineByBookId(bookId);
    const item = outline?.items?.find((candidate) => candidate.id === anchorRef);
    if (outline && item) return { bookId, outline, item };
  }

  return null;
}

function assetUrlForPath(sourceKey: string, resolvedPath: string): string {
  return `/api/source/${encodeURIComponent(sourceKey)}/assets/${encodeURIComponent(resolvedPath)}`;
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

function rewriteMarkdownImageUrls(markdown: string, markdownPath: string, sourceKey: string): string {
  return markdown.replace(/!\[([^\]]*)\]\(([^)\n]+)\)/g, (match, alt: string, src: string) => {
    const resolvedPath = resolveMarkdownAssetPath(markdownPath, src);
    if (!resolvedPath) return match;
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
): Record<string, unknown> | null {
  const first = items[0] || {};
  const match = findOutlineMatch(first);
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
      rewriteMarkdownImageUrls(markdown, markdownPath, sourceKey),
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

function sourceFragmentsFromEvidence(rows: Record<string, unknown>[], sourceKey: string): Array<Record<string, unknown>> {
  const byAnchor = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const key = `${textValue(row.source_id)}:${textValue(row.anchor_ref)}`;
    if (!byAnchor.has(key)) byAnchor.set(key, []);
    byAnchor.get(key)!.push(row);
  }

  return Array.from(byAnchor.values()).map((items) => {
    return markdownFragmentFromOutline(items, sourceKey) || evidenceFragment(items);
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
  const body = await loadNodeBody(sql, datasetId, nodeId);
  const evidence = evidenceRows
    .map((row: Record<string, unknown>) => worldJsonRow(row, ['normalized_claims', 'properties']) as unknown as ApiEvidence)
    .filter((row) => !isHiddenImageEvidence(row as unknown as Record<string, unknown>));
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
    source_fragments: sourceFragmentsFromEvidence(evidenceRecords, sourceKey),
    card,
    body: body || renderCardBody(card),
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
