import type { Hono } from 'hono';
import type {
  GroundedGenerationRequest,
  GroundedGenerationStreamEvent,
  UnitRetrievalMode,
} from '@okm/types';
import type { Sql } from '../db/connection.js';
import { streamSSE } from 'hono/streaming';
import { resolveDatasetRow } from '../db/queries.js';
import {
  generateGroundedAnswer,
  generateGroundedAnswerStream,
  MissingModelConfigurationError,
} from '../runtime/grounded-generation.js';
import { retrieveApiUnits } from '../runtime/unit-retrieval.js';

const DEFAULT_RETRIEVAL_LIMIT = 8;
const MAX_RETRIEVAL_LIMIT = 30;

export function registerRuntimeRoutes(app: Hono, sql: Sql): void {
  app.get('/api/source/:key/units/search', async (c) => {
    const key = c.req.param('key');
    const q = (c.req.query('q') ?? '').trim();
    const limit = parseLimit(c.req.query('limit'));
    const mode = parseRetrievalMode(c.req.query('mode'));

    if (!q) {
      return c.json({ error: 'Missing query parameter "q"' }, 400);
    }

    const dataset = await resolveDatasetRow(sql, key);
    if (!dataset) {
      return c.json({ error: `Source "${key}" not found` }, 404);
    }

    const response = await retrieveApiUnits(sql, {
      datasetId: dataset.dataset_id,
      sourceKey: key,
      query: q,
      limit,
      mode,
    });
    return c.json(response);
  });

  app.post('/api/source/:key/grounded-generate', async (c) => {
    const key = c.req.param('key');
    const body = await c.req.json().catch(() => ({})) as Partial<GroundedGenerationRequest>;
    const question = typeof body.question === 'string' ? body.question.trim() : '';
    const limit = parseLimit(body.limit);
    const retrievalMode = parseRetrievalMode(body.retrieval_mode);

    if (!question) {
      return c.json({ error: 'Missing request field "question"' }, 400);
    }

    const dataset = await resolveDatasetRow(sql, key);
    if (!dataset) {
      return c.json({ error: `Source "${key}" not found` }, 404);
    }

    try {
      const response = await generateGroundedAnswer(sql, {
        datasetId: dataset.dataset_id,
        sourceKey: key,
        question,
        limit,
        retrievalMode,
      });
      return c.json(response);
    } catch (error) {
      if (error instanceof MissingModelConfigurationError) {
        return c.json({ error: 'OPENAI_API_KEY is not configured for grounded generation.' }, 503);
      }
      const message = error instanceof Error ? error.message : String(error);
      return c.json({ error: `Grounded generation failed: ${message}` }, 502);
    }
  });

  app.post('/api/source/:key/grounded-generate/stream', async (c) => {
    const key = c.req.param('key');
    const body = await c.req.json().catch(() => ({})) as Partial<GroundedGenerationRequest>;
    const question = typeof body.question === 'string' ? body.question.trim() : '';
    const limit = parseLimit(body.limit);
    const retrievalMode = parseRetrievalMode(body.retrieval_mode);

    if (!question) {
      return c.json({ error: 'Missing request field "question"' }, 400);
    }

    const dataset = await resolveDatasetRow(sql, key);
    if (!dataset) {
      return c.json({ error: `Source "${key}" not found` }, 404);
    }

    return streamSSE(c, async (stream) => {
      const controller = new AbortController();
      stream.onAbort(() => controller.abort());

      const writeEvent = async (event: GroundedGenerationStreamEvent) => {
        if (stream.aborted || stream.closed) return;
        await stream.writeSSE({ event: event.type, data: JSON.stringify(event) });
      };

      try {
        const response = await generateGroundedAnswerStream(sql, {
          datasetId: dataset.dataset_id,
          sourceKey: key,
          question,
          limit,
          retrievalMode,
        }, {
          signal: controller.signal,
          onRetrieval: (retrieval) => writeEvent({ type: 'retrieval', retrieval }),
          onAnswerDelta: (delta) => writeEvent({ type: 'answer_delta', delta }),
        });
        await writeEvent({ type: 'complete', response });
      } catch (error) {
        if (controller.signal.aborted || stream.aborted) return;
        await writeEvent({ type: 'error', error: generationErrorMessage(error) });
      }
    });
  });
}

function generationErrorMessage(error: unknown): string {
  if (error instanceof MissingModelConfigurationError) {
    return 'OPENAI_API_KEY is not configured for grounded generation.';
  }
  const message = error instanceof Error ? error.message : String(error);
  return `Grounded generation failed: ${message}`;
}

function parseLimit(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_RETRIEVAL_LIMIT;
  return Math.min(Math.max(Math.trunc(parsed), 1), MAX_RETRIEVAL_LIMIT);
}

function parseRetrievalMode(value: unknown): UnitRetrievalMode {
  return value === 'text' || value === 'vector' || value === 'hybrid' ? value : 'hybrid';
}
