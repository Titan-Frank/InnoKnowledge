#!/usr/bin/env node
import type { ApiUnit } from '@okm/types';
import { closePool, createPool } from '../db/connection.js';
import { withPipelineMutationSessionLock } from '../db/dataset-lock.js';
import { loadUnit, resolveDatasetRow } from '../db/queries.js';
import { embedTextBatch } from '../services/embedding.js';
import { composeApiUnitEmbeddingText, hashApiUnitEmbeddingText } from '../runtime/unit-embedding-text.js';
import { DEFAULT_DATABASE_URL } from '../utils/paths.js';

interface Flags {
  db: string;
  source: string;
  batchSize: number;
  force: boolean;
  limit: number | null;
}

interface NodeRow {
  id: string;
}

interface ExistingRow {
  node_id: string;
  content_hash: string;
  embedding_model: string;
}

interface UnitEmbeddingJob {
  nodeId: string;
  unit: ApiUnit;
  text: string;
  hash: string;
}

async function main(argv: string[]): Promise<number> {
  const flags = parseFlags(argv);
  const sql = createPool(flags.db);
  try {
    return await withPipelineMutationSessionLock(sql, async () => {
      const dataset = await resolveDatasetRow(sql, flags.source);
      if (!dataset) throw new Error(`Source "${flags.source}" not found.`);

    const nodes = await sql<NodeRow[]>`
      SELECT id
      FROM world_nodes
      WHERE dataset_id = ${dataset.dataset_id}
        AND status != 'deprecated'
      ORDER BY id
      ${flags.limit ? sql`LIMIT ${flags.limit}` : sql``}
    `;
    const embeddingModel = process.env.EMBEDDING_MODEL ?? 'unknown';
    const existingRows = await sql<ExistingRow[]>`
      SELECT node_id, content_hash, embedding_model
      FROM world_unit_embeddings
      WHERE dataset_id = ${dataset.dataset_id}
    `.catch(() => [] as ExistingRow[]);
    const existing = new Map(existingRows.map((row) => [row.node_id, row]));

    const jobs: UnitEmbeddingJob[] = [];
    for (const node of nodes) {
      const unit = await loadUnit(sql, dataset.dataset_id, node.id, flags.source);
      if (!unit) continue;
      const text = composeApiUnitEmbeddingText(unit);
      if (!text) continue;
      const hash = hashApiUnitEmbeddingText(text);
      const existingEmbedding = existing.get(node.id);
      if (
        !flags.force &&
        existingEmbedding?.content_hash === hash &&
        existingEmbedding.embedding_model === embeddingModel
      ) {
        continue;
      }
      jobs.push({ nodeId: node.id, unit, text, hash });
    }

    let updated = 0;
    for (let index = 0; index < jobs.length; index += flags.batchSize) {
      const batch = jobs.slice(index, index + flags.batchSize);
      const vectors = await embedTextBatch(batch.map((job) => job.text));
      for (let offset = 0; offset < batch.length; offset++) {
        const job = batch[offset]!;
        const vector = vectors[offset] ?? [];
        if (!vector.length) continue;
        await sql`
          INSERT INTO world_unit_embeddings (
            dataset_id,
            node_id,
            embedding,
            content_hash,
            retrieval_text,
            embedding_model,
            generated_at
          )
          VALUES (
            ${dataset.dataset_id},
            ${job.nodeId},
            ${formatVector(vector)}::vector,
            ${job.hash},
            ${job.text},
            ${embeddingModel},
            ${new Date().toISOString()}
          )
          ON CONFLICT (dataset_id, node_id) DO UPDATE SET
            embedding = EXCLUDED.embedding,
            content_hash = EXCLUDED.content_hash,
            retrieval_text = EXCLUDED.retrieval_text,
            embedding_model = EXCLUDED.embedding_model,
            generated_at = EXCLUDED.generated_at
        `;
        updated += 1;
      }
    }

      console.log(JSON.stringify({
        status: 'success',
        source: dataset.dataset_id,
        selected: nodes.length,
        pending: jobs.length,
        updated,
        skipped: nodes.length - jobs.length,
        batch_size: flags.batchSize,
      }, null, 2));
      return 0;
    });
  } finally {
    await closePool(sql);
  }
}

function parseFlags(argv: string[]): Flags {
  const flags: Flags = {
    db: DEFAULT_DATABASE_URL,
    source: 'main',
    batchSize: 8,
    force: false,
    limit: null,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    switch (arg) {
      case '--db':
        flags.db = requireValue(argv, ++index, arg);
        break;
      case '--source':
        flags.source = requireValue(argv, ++index, arg);
        break;
      case '--batch-size':
        flags.batchSize = parsePositiveInteger(requireValue(argv, ++index, arg), arg);
        break;
      case '--limit':
        flags.limit = parsePositiveInteger(requireValue(argv, ++index, arg), arg);
        break;
      case '--force':
        flags.force = true;
        break;
      case '--help':
        printHelp();
        process.exit(0);
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }
  return flags;
}

function requireValue(argv: string[], index: number, option: string): string {
  const value = argv[index];
  if (!value || value.startsWith('--')) throw new Error(`${option} requires a value.`);
  return value;
}

function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer.`);
  return parsed;
}

function formatVector(vector: number[]): string {
  return `[${vector.map(String).join(',')}]`;
}

function printHelp(): void {
  console.log([
    'Usage: npm run backfill-unit-embeddings -w packages/server -- [options]',
    '',
    'Options:',
    '  --source <key>       Dataset key or id. Default: main',
    '  --db <url>           PostgreSQL URL. Default: DATABASE_URL or local okm database',
    '  --batch-size <n>     Embedding request batch size. Default: 8',
    '  --limit <n>          Limit nodes for a smoke run',
    '  --force              Rebuild embeddings even when content hash matches',
  ].join('\n'));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
