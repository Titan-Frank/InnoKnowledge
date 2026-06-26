import type { Hono } from 'hono';
import path from 'node:path';
import type {
  ImageReviewAction,
  ImageReviewDecision,
  ImageReviewItem,
  ImageReviewResponse,
  ImageReviewUpdateRequest,
  ImageReviewUpdateResponse,
} from '@okm/types';
import type { Sql } from '../db/connection.js';
import { resolveDatasetRow } from '../db/queries.js';
import { REPO_ROOT } from '../utils/paths.js';

type Row = Record<string, unknown>;

const VALID_ACTIONS = new Set<ImageReviewAction>(['keep', 'drop', 'core_content', 'supporting', 'uncertain']);

export function registerImageReviewRoutes(app: Hono, sql: Sql) {
  app.get('/api/source/:key/image-reviews', async (c) => {
    const key = c.req.param('key');
    const datasetRow = await resolveDatasetRow(sql, key);
    if (!datasetRow) return c.json({ error: `Unknown source '${key}'` }, 404);

    const limit = parseLimit(c.req.query('limit'));
    const countRows = await sql`
      SELECT count(*) AS count
      FROM world_evidence
      WHERE dataset_id = ${datasetRow.dataset_id}
        AND lower(COALESCE(modality, '')) = 'image'
        AND (
          COALESCE(properties_json->'image_relevance'->>'review_status', '') = 'pending'
          OR (
            COALESCE(properties_json->'image_relevance'->>'review_status', '') = ''
            AND COALESCE(properties_json->'image_relevance'->>'relevance', '') = 'uncertain'
          )
        )
    `;
    const rows = await sql`
      SELECT *
      FROM world_evidence
      WHERE dataset_id = ${datasetRow.dataset_id}
        AND lower(COALESCE(modality, '')) = 'image'
        AND (
          COALESCE(properties_json->'image_relevance'->>'review_status', '') = 'pending'
          OR (
            COALESCE(properties_json->'image_relevance'->>'review_status', '') = ''
            AND COALESCE(properties_json->'image_relevance'->>'relevance', '') = 'uncertain'
          )
        )
      ORDER BY updated_at DESC, id
      LIMIT ${limit}
    `;

    const items = rows.map((row: Row) => imageReviewItemFromRow(row, key));
    const payload: ImageReviewResponse = {
      dataset_id: datasetRow.dataset_id,
      pending: Number((countRows[0] as Row | undefined)?.count ?? items.length),
      items,
    };
    return c.json(payload);
  });

  app.post('/api/source/:key/image-reviews/:evidence_id', async (c) => {
    const key = c.req.param('key');
    const evidenceId = decodeURIComponent(c.req.param('evidence_id'));
    const datasetRow = await resolveDatasetRow(sql, key);
    if (!datasetRow) return c.json({ error: `Unknown source '${key}'` }, 404);

    const body = await c.req.json<ImageReviewUpdateRequest>().catch(() => null);
    if (!body || !VALID_ACTIONS.has(body.action)) return c.json({ error: 'Invalid image review action.' }, 400);

    const rows = await sql`
      SELECT *
      FROM world_evidence
      WHERE dataset_id = ${datasetRow.dataset_id}
        AND id = ${evidenceId}
        AND lower(COALESCE(modality, '')) = 'image'
      LIMIT 1
    `;
    if (!rows.length) return c.json({ error: `Image evidence not found: ${evidenceId}` }, 404);

    const row = rows[0] as Row;
    const properties = asRecord(row.properties_json);
    const previous = imageDecisionFromProperties(properties);
    const nextDecision = applyReviewAction(previous, body.action, textValue(body.reason));
    const nextProperties = { ...properties, image_relevance: nextDecision };
    const now = new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00');

    await sql`
      UPDATE world_evidence
      SET properties_json = ${JSON.stringify(nextProperties)}::jsonb,
          updated_at = ${now}
      WHERE dataset_id = ${datasetRow.dataset_id}
        AND id = ${evidenceId}
    `;

    const response: ImageReviewUpdateResponse = {
      status: 'success',
      item: imageReviewItemFromRow({ ...row, properties_json: nextProperties, updated_at: now }, key),
    };
    return c.json(response);
  });
}

function imageReviewItemFromRow(row: Row, sourceKey: string): ImageReviewItem {
  const imagePath = resolveImagePath(row);
  return {
    evidence_id: textValue(row.id),
    source_id: textValue(row.source_id),
    anchor_ref: textValue(row.anchor_ref),
    source_path: textValue(row.source_path),
    locator: textValue(row.locator),
    excerpt: textValue(row.excerpt),
    page_start: row.page_start == null ? null : Number(row.page_start),
    page_end: row.page_end == null ? null : Number(row.page_end),
    image_path: imagePath,
    image_url: /^https?:\/\//i.test(imagePath) ? imagePath : `/api/source/${encodeURIComponent(sourceKey)}/assets/${encodeURIComponent(imagePath)}`,
    decision: imageDecisionFromProperties(asRecord(row.properties_json)),
    updated_at: textValue(row.updated_at) || null,
  };
}

function applyReviewAction(previous: ImageReviewDecision, action: ImageReviewAction, reason: string): ImageReviewDecision {
  const reviewedAt = new Date().toISOString().replace(/\.\d{3}Z$/, '+00:00');
  const base = {
    ...previous,
    source: 'manual' as const,
    reviewed_at: reviewedAt,
    reviewed_by: 'manual',
    manual_action: action,
  };

  if (action === 'drop') {
    return {
      ...base,
      keep: false,
      relevance: previous.relevance === 'uncertain' ? 'decorative' : previous.relevance,
      reason: reason || '人工复核决定删除这张图片。',
      review_status: 'rejected',
    };
  }
  if (action === 'core_content') {
    return {
      ...base,
      keep: true,
      relevance: 'core_content',
      reason: reason || '人工复核确认为核心知识图。',
      review_status: 'confirmed',
    };
  }
  if (action === 'supporting') {
    return {
      ...base,
      keep: true,
      relevance: 'supporting',
      reason: reason || '人工复核确认为辅助知识图。',
      review_status: 'confirmed',
    };
  }
  if (action === 'uncertain') {
    return {
      ...base,
      keep: true,
      relevance: 'uncertain',
      reason: reason || '人工复核后仍暂时无法确认，保留待后续复核。',
      review_status: 'pending',
    };
  }
  return {
    ...base,
    keep: true,
    reason: reason || '人工复核决定保留这张图片。',
    review_status: 'confirmed',
  };
}

function imageDecisionFromProperties(properties: Row): ImageReviewDecision {
  const raw = asRecord(properties.image_relevance);
  const relevance = parseRelevance(raw.relevance);
  return {
    keep: typeof raw.keep === 'boolean' ? raw.keep : relevance !== 'decorative' && relevance !== 'mismatch',
    relevance,
    reason: textValue(raw.reason) || '缺少图片复核说明。',
    source: parseSource(raw.source),
    confidence: numberOrUndefined(raw.confidence),
    path: textValue(raw.path) || undefined,
    width: numberOrUndefined(raw.width),
    height: numberOrUndefined(raw.height),
    review_status: parseReviewStatus(raw.review_status, relevance),
    reviewed_at: textValue(raw.reviewed_at) || undefined,
    reviewed_by: textValue(raw.reviewed_by) || undefined,
    manual_action: parseManualAction(raw.manual_action),
  };
}

function parseRelevance(value: unknown): ImageReviewDecision['relevance'] {
  if (value === 'core_content' || value === 'supporting' || value === 'decorative' || value === 'mismatch' || value === 'uncertain') return value;
  return 'uncertain';
}

function parseReviewStatus(value: unknown, relevance: ImageReviewDecision['relevance']): ImageReviewDecision['review_status'] {
  if (value === 'auto' || value === 'pending' || value === 'confirmed' || value === 'rejected') return value;
  return relevance === 'uncertain' ? 'pending' : 'auto';
}

function parseSource(value: unknown): ImageReviewDecision['source'] {
  return value === 'manual' || value === 'vlm' || value === 'fallback' ? value : 'fallback';
}

function parseManualAction(value: unknown): ImageReviewAction | undefined {
  return VALID_ACTIONS.has(value as ImageReviewAction) ? value as ImageReviewAction : undefined;
}

function resolveImagePath(row: Row): string {
  const properties = asRecord(row.properties_json);
  const rawPath = textValue(properties.path || properties.image_path || imagePathFromMarkdown(textValue(row.excerpt)));
  if (!rawPath || /^https?:\/\//i.test(rawPath) || path.isAbsolute(rawPath)) return rawPath;

  const sourcePath = textValue(row.source_path || properties.source_path);
  if (sourcePath) {
    const resolvedSource = path.isAbsolute(sourcePath) ? sourcePath : path.resolve(REPO_ROOT, sourcePath);
    return path.resolve(path.dirname(resolvedSource), rawPath);
  }
  return path.resolve(REPO_ROOT, rawPath);
}

function imagePathFromMarkdown(value: string): string {
  return /!\[[^\]]*\]\(([^)]+)\)/.exec(value)?.[1]?.trim() ?? '';
}

function parseLimit(value: string | undefined): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 50;
  return Math.max(1, Math.min(200, Math.floor(parsed)));
}

function asRecord(value: unknown): Row {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Row : {};
}

function textValue(value: unknown): string {
  return value === null || value === undefined ? '' : String(value);
}

function numberOrUndefined(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
