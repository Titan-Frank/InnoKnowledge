import type { Context, Hono } from 'hono';
import type { InterdisciplinaryAnalyzeRequest, InterdisciplinaryReviewRequest } from '@okm/types';
import type { Sql } from '../db/connection.js';
import {
  analyzeInterdisciplinaryGraph,
  applyInterdisciplinaryCandidates,
  InterdisciplinaryRequestError,
  loadInterdisciplinaryOverview,
  reviewInterdisciplinaryCandidate,
} from '../db/interdisciplinary.js';
import { resolveDatasetRow } from '../db/queries.js';

export function registerInterdisciplinaryRoutes(app: Hono, sql: Sql, dbUrl: string) {
  app.get('/api/source/:key/interdisciplinary', async (c) => {
    const datasetId = await resolveDatasetId(sql, c.req.param('key'));
    if (!datasetId) return c.json({ error: '未找到这个数据集。' }, 404);
    try {
      return c.json(await loadInterdisciplinaryOverview(sql, datasetId));
    } catch (error) {
      return interdisciplinaryError(c, error);
    }
  });

  app.post('/api/source/:key/interdisciplinary/analyze', async (c) => {
    const datasetId = await resolveDatasetId(sql, c.req.param('key'));
    if (!datasetId) return c.json({ error: '未找到这个数据集。' }, 404);
    const body = await c.req.json<InterdisciplinaryAnalyzeRequest>().catch(() => null);
    if (!body) return c.json({ error: '请求正文必须是合法的 JSON。' }, 400);
    try {
      return c.json(await analyzeInterdisciplinaryGraph({ dbUrl, datasetId, request: body }));
    } catch (error) {
      return interdisciplinaryError(c, error);
    }
  });

  app.post('/api/source/:key/interdisciplinary/candidates/:candidate_id/review', async (c) => {
    const datasetId = await resolveDatasetId(sql, c.req.param('key'));
    if (!datasetId) return c.json({ error: '未找到这个数据集。' }, 404);
    const body = await c.req.json<InterdisciplinaryReviewRequest>().catch(() => null);
    if (!body) return c.json({ error: '请求正文必须是合法的 JSON。' }, 400);
    try {
      return c.json(await reviewInterdisciplinaryCandidate(
        sql,
        datasetId,
        c.req.param('candidate_id'),
        body,
      ));
    } catch (error) {
      return interdisciplinaryError(c, error);
    }
  });

  app.post('/api/source/:key/interdisciplinary/apply', async (c) => {
    const datasetId = await resolveDatasetId(sql, c.req.param('key'));
    if (!datasetId) return c.json({ error: '未找到这个数据集。' }, 404);
    const body: { limit?: number } = await c.req.json<{ limit?: number }>().catch(() => ({}));
    const limit = positiveInteger(body.limit, 100);
    try {
      return c.json(await applyInterdisciplinaryCandidates({ dbUrl, datasetId, limit }));
    } catch (error) {
      return interdisciplinaryError(c, error);
    }
  });
}

async function resolveDatasetId(sql: Sql, key: string): Promise<string | null> {
  const row = await resolveDatasetRow(sql, key);
  return row?.dataset_id ?? null;
}

function positiveInteger(value: unknown, fallback: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) return fallback;
  return Math.min(parsed, 1000);
}

function interdisciplinaryError(c: Context, error: unknown) {
  if (error instanceof InterdisciplinaryRequestError) {
    return c.json({ error: error.message }, error.status);
  }
  console.error('跨学科接口执行失败：', error);
  return c.json({ error: '跨学科操作执行失败，请查看服务端日志。' }, 500);
}
