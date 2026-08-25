import type { Hono } from 'hono';
import type {
  PgAdminBookDeleteRequest,
  PgAdminBookDeleteResponse,
  PgAdminBooksResponse,
  PgAdminCatalogResponse,
  PgAdminColumn,
  PgAdminDeleteRequest,
  PgAdminExportPayload,
  PgAdminExportRequest,
  PgAdminMutationResponse,
  PgAdminRowsResponse,
  PgAdminTable,
  PgAdminUpdateRequest,
} from '@okm/types';
import type { Sql, TransactionSql } from '../db/connection.js';
import { DATASET_ADVISORY_LOCK_SQL, PIPELINE_MUTATION_ADVISORY_LOCK_SQL } from '../db/dataset-lock.js';
import { resolveDatasetRow } from '../db/queries.js';

type Row = Record<string, unknown>;
type TableGroup = PgAdminTable['group'];
type SqlParameter = NonNullable<Parameters<Sql['unsafe']>[1]>[number];
type JsonValue = Parameters<Sql['json']>[0];

const TABLE_GROUPS: Record<string, TableGroup> = {
  world_datasets: 'catalog',
  world_source_artifacts: 'catalog',
  world_textbook_outlines: 'catalog',
  world_enrich_library: 'catalog',
  world_enrich_books: 'catalog',
  world_mineru_sources: 'catalog',
  world_nodes: 'canonical',
  world_node_terms: 'canonical',
  world_edges: 'canonical',
  world_taxonomy_terms: 'canonical',
  world_taxonomy_edges: 'canonical',
  world_domain_profiles: 'canonical',
  world_mentions: 'evidence',
  world_evidence: 'evidence',
  world_evidence_links: 'evidence',
  world_node_cards: 'evidence',
  world_node_bodies: 'evidence',
  world_unit_embeddings: 'runtime',
  retrieval_candidates: 'runtime',
  world_lesson_runs: 'pipeline',
  world_pipeline_jobs: 'pipeline',
  world_pipeline_job_stages: 'pipeline',
  world_pipeline_job_events: 'pipeline',
  world_pipeline_worker_states: 'pipeline',
  world_staging_nodes: 'staging',
  world_staging_edges: 'staging',
  world_staging_domain_profiles: 'staging',
  world_staging_mentions: 'staging',
  world_staging_evidence: 'staging',
  world_staging_node_cards: 'staging',
  world_merge_runs: 'pipeline',
  world_canonical_node_map: 'pipeline',
};

export const PG_ADMIN_TABLES = Object.freeze(Object.keys(TABLE_GROUPS));
export const PG_ADMIN_DATASET_ADVISORY_LOCK_SQL = DATASET_ADVISORY_LOCK_SQL;
export const PG_ADMIN_PIPELINE_MUTATION_LOCK_SQL = PIPELINE_MUTATION_ADVISORY_LOCK_SQL;
export const PG_ADMIN_EXPORT_MAX_BYTES = 32 * 1024 * 1024;

const PG_ADMIN_PROTECTED_TABLES = new Set([
  'world_datasets',
  'world_unit_embeddings',
]);

const PG_ADMIN_READ_ONLY_GROUPS = new Set<TableGroup>(['canonical', 'evidence', 'pipeline']);

class AdminConflictError extends Error {}
class AdminExportTooLargeError extends Error {}

export function isPgAdminTable(table: string): boolean {
  return Object.hasOwn(TABLE_GROUPS, table);
}

export function isPgAdminTableMutable(table: string): boolean {
  return isPgAdminTable(table)
    && !PG_ADMIN_READ_ONLY_GROUPS.has(TABLE_GROUPS[table]!)
    && !PG_ADMIN_PROTECTED_TABLES.has(table);
}

export function quoteIdentifier(identifier: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(identifier)) throw new Error(`Invalid SQL identifier: ${identifier}`);
  return `"${identifier}"`;
}

export function rowDeleteConfirmation(table: string, primaryKey: Record<string, unknown>, columns: string[]): string {
  return `DELETE ${table} ${columns.map((column) => String(primaryKey[column] ?? '')).join(' / ')}`;
}

function textValue(value: unknown): string {
  return value == null ? '' : String(value);
}

function numberValue(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseLimit(value: string | undefined): number {
  return Math.max(1, Math.min(200, Math.floor(Number(value) || 50)));
}

function parseOffset(value: string | undefined): number {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function exportFilename(datasetId: string, exportedAt: string): string {
  const safeDatasetId = datasetId.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'dataset';
  return `okm-pg-${safeDatasetId}-${exportedAt.slice(0, 10)}.json`;
}

function exportSizeError(bytes: number): AdminExportTooLargeError {
  const requestedMiB = Math.max(1, Math.ceil(bytes / 1024 / 1024));
  const limitMiB = PG_ADMIN_EXPORT_MAX_BYTES / 1024 / 1024;
  return new AdminExportTooLargeError(`Export is approximately ${requestedMiB} MiB; the limit is ${limitMiB} MiB. Select fewer tables.`);
}

function isEditableColumn(
  table: string,
  column: { data_type: string; udt_name: string; primary_key: boolean; name: string },
): boolean {
  return isPgAdminTableMutable(table)
    && !column.primary_key
    && column.name !== 'dataset_id'
    && column.udt_name !== 'vector'
    && column.data_type !== 'USER-DEFINED';
}

async function loadTableMetadata(sql: Sql | TransactionSql, onlyTable?: string): Promise<PgAdminTable[]> {
  const rows = await sql`
    SELECT
      c.table_name,
      c.column_name,
      c.data_type,
      c.udt_name,
      c.is_nullable,
      c.ordinal_position,
      COALESCE(s.n_live_tup, 0) AS estimated_rows,
      EXISTS (
        SELECT 1
        FROM pg_index i
        JOIN pg_attribute a
          ON a.attrelid = i.indrelid
         AND a.attnum = ANY(i.indkey)
        WHERE i.indrelid = (quote_ident(c.table_schema) || '.' || quote_ident(c.table_name))::regclass
          AND i.indisprimary
          AND a.attname = c.column_name
      ) AS primary_key
    FROM information_schema.columns c
    LEFT JOIN pg_stat_user_tables s
      ON s.schemaname = c.table_schema
     AND s.relname = c.table_name
    WHERE c.table_schema = 'public'
      AND c.table_name = ANY(${PG_ADMIN_TABLES}::text[])
      AND (${onlyTable ?? null}::text IS NULL OR c.table_name = ${onlyTable ?? null})
    ORDER BY c.table_name, c.ordinal_position
  ` as unknown as Row[];

  const byTable = new Map<string, PgAdminTable>();
  for (const row of rows) {
    const name = textValue(row.table_name);
    if (!isPgAdminTable(name)) continue;
    const primaryKey = Boolean(row.primary_key);
    const column: PgAdminColumn = {
      name: textValue(row.column_name),
      data_type: textValue(row.data_type),
      udt_name: textValue(row.udt_name),
      nullable: row.is_nullable === 'YES',
      primary_key: primaryKey,
      editable: isEditableColumn(name, {
        name: textValue(row.column_name),
        data_type: textValue(row.data_type),
        udt_name: textValue(row.udt_name),
        primary_key: primaryKey,
      }),
    };
    const table = byTable.get(name) ?? {
      name,
      group: TABLE_GROUPS[name]!,
      mutable: isPgAdminTableMutable(name),
      estimated_rows: numberValue(row.estimated_rows),
      primary_key: [],
      columns: [],
    };
    table.columns.push(column);
    if (column.primary_key) table.primary_key.push(column.name);
    byTable.set(name, table);
  }
  return PG_ADMIN_TABLES.flatMap((name) => byTable.get(name) ?? []);
}

function requireAdminTable(tableName: string, tables: PgAdminTable[]): PgAdminTable {
  if (!isPgAdminTable(tableName)) throw new Error(`Unsupported PostgreSQL table: ${tableName}`);
  const table = tables.find((item) => item.name === tableName);
  if (!table) throw new Error(`PostgreSQL table is unavailable: ${tableName}`);
  if (!table.columns.some((column) => column.name === 'dataset_id')) throw new Error(`Table is not dataset scoped: ${tableName}`);
  return table;
}

function requirePrimaryKey(table: PgAdminTable, primaryKey: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!primaryKey || table.primary_key.length === 0) throw new Error('A complete primary key is required.');
  for (const column of table.primary_key) {
    if (!(column in primaryKey) || primaryKey[column] === null || primaryKey[column] === undefined || primaryKey[column] === '') {
      throw new Error(`Missing primary key column: ${column}`);
    }
  }
  return primaryKey;
}

function sqlParameter(value: unknown): SqlParameter {
  if (value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' || value instanceof Date) return value;
  return JSON.stringify(value);
}

function mutationValue(sql: Sql, column: PgAdminColumn, value: unknown): { value: SqlParameter; cast: string } {
  if (value === null) {
    if (!column.nullable) throw new Error(`${column.name} cannot be null.`);
    return { value: null, cast: '' };
  }
  if (column.data_type === 'json' || column.data_type === 'jsonb') {
    let parsed = value;
    if (typeof value === 'string') {
      try {
        parsed = JSON.parse(value);
      } catch {
        throw new Error(`${column.name} must be valid JSON.`);
      }
    }
    return { value: sql.json(parsed as JsonValue), cast: '' };
  }
  if (['smallint', 'integer', 'bigint'].includes(column.data_type)) {
    if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`${column.name} must be an integer.`);
    const normalized = String(value).trim();
    if (!normalized) throw new Error(`${column.name} cannot be blank.`);
    if (!/^[+-]?\d+$/.test(normalized)) throw new Error(`${column.name} must be an integer.`);
    if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error(`${column.name} must be provided as an exact integer string.`);
    if (column.data_type === 'bigint') return { value: normalized, cast: '::bigint' };
    const parsed = Number(normalized);
    if (!Number.isSafeInteger(parsed)) throw new Error(`${column.name} must be a safe integer.`);
    return { value: parsed, cast: `::${column.data_type}` };
  }
  if (['real', 'double precision', 'numeric', 'decimal'].includes(column.data_type)) {
    if (typeof value !== 'string' && typeof value !== 'number') throw new Error(`${column.name} must be a number.`);
    const normalized = String(value).trim();
    if (!normalized) throw new Error(`${column.name} cannot be blank.`);
    if (!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(normalized)) throw new Error(`${column.name} must be a number.`);
    if (column.data_type === 'numeric' || column.data_type === 'decimal') return { value: normalized, cast: `::${column.data_type}` };
    const parsed = Number(normalized);
    if (!Number.isFinite(parsed)) throw new Error(`${column.name} must be a number.`);
    return { value: parsed, cast: `::${column.data_type}` };
  }
  if (column.data_type === 'boolean') {
    if (typeof value !== 'boolean') throw new Error(`${column.name} must be true or false.`);
    return { value, cast: '::boolean' };
  }
  if (typeof value !== 'string') throw new Error(`${column.name} must be a string.`);
  return { value, cast: '' };
}

function wherePrimaryKey(table: PgAdminTable, primaryKey: Record<string, unknown>, startIndex: number): { sql: string; values: SqlParameter[] } {
  return {
    sql: table.primary_key.map((column, index) => `${quoteIdentifier(column)} = $${startIndex + index}`).join(' AND '),
    values: table.primary_key.map((column) => sqlParameter(primaryKey[column])),
  };
}

async function loadBooks(sql: Sql | TransactionSql, datasetId: string): Promise<PgAdminBooksResponse> {
  const rows = await sql`
    WITH book_keys AS (
      SELECT book_id FROM world_textbook_outlines WHERE dataset_id = ${datasetId}
      UNION SELECT book_id FROM world_mineru_sources WHERE dataset_id = ${datasetId}
      UNION SELECT book_id FROM world_lesson_runs WHERE dataset_id = ${datasetId}
      UNION SELECT book_id FROM world_pipeline_jobs WHERE dataset_id = ${datasetId}
      UNION SELECT book_id FROM world_source_artifacts WHERE dataset_id = ${datasetId} AND book_id IS NOT NULL
    ), book_node_mappings AS (
      SELECT
        lr.book_id,
        cm.canonical_node_id,
        bool_or(cm.resolution IN ('created', 'review')) AS owned
      FROM world_lesson_runs lr
      JOIN world_canonical_node_map cm
        ON cm.dataset_id = lr.dataset_id AND cm.lesson_run_id = lr.lesson_run_id
      WHERE lr.dataset_id = ${datasetId}
      GROUP BY lr.book_id, cm.canonical_node_id
    ), target_nodes AS (
      SELECT book_id, canonical_node_id FROM book_node_mappings WHERE owned
    ), matched_only_nodes AS (
      SELECT book_id, canonical_node_id FROM book_node_mappings WHERE NOT owned
    )
    SELECT
      bk.book_id,
      COALESCE(MAX(o.title), MAX(a.title), bk.book_id) AS title,
      (SELECT count(*) FROM world_lesson_runs lr WHERE lr.dataset_id = ${datasetId} AND lr.book_id = bk.book_id) AS lesson_runs,
      (SELECT count(*) FROM world_pipeline_jobs j WHERE j.dataset_id = ${datasetId} AND j.book_id = bk.book_id) AS pipeline_jobs,
      (SELECT count(*) FROM world_pipeline_jobs j WHERE j.dataset_id = ${datasetId} AND j.status = 'running') AS running_jobs,
      (SELECT count(*) FROM target_nodes tn WHERE tn.book_id = bk.book_id) AS canonical_nodes,
      (SELECT count(*) FROM matched_only_nodes mn WHERE mn.book_id = bk.book_id) AS matched_only_nodes,
      (
        SELECT count(*) FROM target_nodes tn
        WHERE tn.book_id = bk.book_id
          AND EXISTS (
            SELECT 1
            FROM world_canonical_node_map other_map
            JOIN world_lesson_runs other_lesson
              ON other_lesson.dataset_id = other_map.dataset_id
             AND other_lesson.lesson_run_id = other_map.lesson_run_id
            WHERE other_map.dataset_id = ${datasetId}
              AND other_map.canonical_node_id = tn.canonical_node_id
              AND other_lesson.book_id <> bk.book_id
          )
      ) AS shared_nodes,
      (
        SELECT count(*) FROM world_edges e
        WHERE e.dataset_id = ${datasetId}
          AND (e.from_id IN (SELECT canonical_node_id FROM target_nodes WHERE book_id = bk.book_id)
            OR e.to_id IN (SELECT canonical_node_id FROM target_nodes WHERE book_id = bk.book_id))
      ) AS edges,
      (SELECT count(*) FROM world_evidence ev WHERE ev.dataset_id = ${datasetId} AND ev.source_id = bk.book_id) AS evidence,
      (SELECT count(*) FROM world_mentions m WHERE m.dataset_id = ${datasetId} AND m.source_id = bk.book_id) AS mentions,
      GREATEST(
        MAX(o.updated_at),
        (SELECT MAX(lr.updated_at) FROM world_lesson_runs lr WHERE lr.dataset_id = ${datasetId} AND lr.book_id = bk.book_id),
        (SELECT MAX(j.updated_at) FROM world_pipeline_jobs j WHERE j.dataset_id = ${datasetId} AND j.book_id = bk.book_id)
      ) AS updated_at
    FROM book_keys bk
    LEFT JOIN world_textbook_outlines o ON o.dataset_id = ${datasetId} AND o.book_id = bk.book_id
    LEFT JOIN world_source_artifacts a ON a.dataset_id = ${datasetId} AND a.book_id = bk.book_id
    WHERE bk.book_id IS NOT NULL AND bk.book_id <> ''
    GROUP BY bk.book_id
    ORDER BY updated_at DESC NULLS LAST, bk.book_id
  ` as unknown as Row[];

  return {
    dataset_id: datasetId,
    books: rows.map((row) => {
      const matchedOnlyNodes = numberValue(row.matched_only_nodes);
      const sharedNodes = numberValue(row.shared_nodes);
      const runningJobs = numberValue(row.running_jobs);
      return {
        book_id: textValue(row.book_id),
        title: textValue(row.title) || textValue(row.book_id),
        lesson_runs: numberValue(row.lesson_runs),
        pipeline_jobs: numberValue(row.pipeline_jobs),
        running_jobs: runningJobs,
        canonical_nodes: numberValue(row.canonical_nodes),
        shared_nodes: sharedNodes + matchedOnlyNodes,
        edges: numberValue(row.edges),
        evidence: numberValue(row.evidence),
        mentions: numberValue(row.mentions),
        updated_at: row.updated_at == null ? null : textValue(row.updated_at),
        deletable: matchedOnlyNodes === 0 && sharedNodes === 0 && runningJobs === 0,
        blocker: runningJobs > 0
          ? '当前数据集仍有运行中的流水线任务'
          : matchedOnlyNodes > 0
            ? `${matchedOnlyNodes} 个 canonical 节点仅为 matched 映射，无法证明其输出归属`
          : sharedNodes > 0
            ? `${sharedNodes} 个 canonical 节点已被其他教材复用`
            : undefined,
      };
    }),
  };
}

async function deleteBook(sql: Sql, datasetId: string, bookId: string): Promise<PgAdminBookDeleteResponse> {
  return sql.begin(async (tx) => {
    await tx.unsafe(PG_ADMIN_DATASET_ADVISORY_LOCK_SQL, [datasetId]);
    await tx.unsafe(PG_ADMIN_PIPELINE_MUTATION_LOCK_SQL);
    const running = await tx`SELECT count(*) AS count FROM world_pipeline_jobs WHERE dataset_id = ${datasetId} AND status = 'running'` as unknown as Row[];
    if (numberValue(running[0]?.count) > 0) throw new AdminConflictError('当前数据集仍有运行中的流水线任务。');
    await tx`CREATE TEMP TABLE _pg_admin_target_lessons ON COMMIT DROP AS SELECT lesson_run_id FROM world_lesson_runs WHERE dataset_id = ${datasetId} AND book_id = ${bookId}`;
    await tx`CREATE TEMP TABLE _pg_admin_target_nodes ON COMMIT DROP AS SELECT DISTINCT cm.canonical_node_id AS node_id FROM world_canonical_node_map cm JOIN _pg_admin_target_lessons tl ON tl.lesson_run_id = cm.lesson_run_id WHERE cm.dataset_id = ${datasetId} AND cm.resolution IN ('created', 'review')`;
    await tx`CREATE TEMP TABLE _pg_admin_target_matched_only_nodes ON COMMIT DROP AS SELECT DISTINCT cm.canonical_node_id AS node_id FROM world_canonical_node_map cm JOIN _pg_admin_target_lessons tl ON tl.lesson_run_id = cm.lesson_run_id WHERE cm.dataset_id = ${datasetId} AND cm.canonical_node_id NOT IN (SELECT node_id FROM _pg_admin_target_nodes)`;

    const matchedOnly = await tx`SELECT count(*) AS count FROM _pg_admin_target_matched_only_nodes` as unknown as Row[];
    if (numberValue(matchedOnly[0]?.count) > 0) throw new AdminConflictError('存在仅通过 matched 映射关联的 canonical 节点；当前 schema 无法安全判定其 reducer 输出归属。');
    await tx`CREATE TEMP TABLE _pg_admin_target_edges ON COMMIT DROP AS SELECT id FROM world_edges WHERE dataset_id = ${datasetId} AND (from_id IN (SELECT node_id FROM _pg_admin_target_nodes) OR to_id IN (SELECT node_id FROM _pg_admin_target_nodes))`;
    await tx`CREATE TEMP TABLE _pg_admin_target_profiles ON COMMIT DROP AS SELECT id FROM world_domain_profiles WHERE dataset_id = ${datasetId} AND node_id IN (SELECT node_id FROM _pg_admin_target_nodes)`;
    await tx`CREATE TEMP TABLE _pg_admin_target_mentions ON COMMIT DROP AS SELECT id FROM world_mentions WHERE dataset_id = ${datasetId} AND (source_id = ${bookId} OR (target_type = 'node' AND target_id IN (SELECT node_id FROM _pg_admin_target_nodes)) OR (target_type = 'edge' AND target_id IN (SELECT id FROM _pg_admin_target_edges)) OR (target_type = 'domain_profile' AND target_id IN (SELECT id FROM _pg_admin_target_profiles)))`;
    await tx`CREATE TEMP TABLE _pg_admin_target_evidence ON COMMIT DROP AS SELECT id FROM world_evidence WHERE dataset_id = ${datasetId} AND source_id = ${bookId}`;
    await tx`CREATE TEMP TABLE _pg_admin_target_cards ON COMMIT DROP AS SELECT id FROM world_node_cards WHERE dataset_id = ${datasetId} AND node_id IN (SELECT node_id FROM _pg_admin_target_nodes)`;
    await tx`CREATE TEMP TABLE _pg_admin_target_section_owners ON COMMIT DROP AS SELECT DISTINCT links.owner_id FROM world_evidence_links links WHERE links.dataset_id = ${datasetId} AND links.owner_type = 'node_card_section' AND (links.evidence_id IN (SELECT id FROM _pg_admin_target_evidence) OR EXISTS (SELECT 1 FROM _pg_admin_target_cards cards WHERE links.owner_id LIKE cards.id || ':%'))`;
    await tx`CREATE TEMP TABLE _pg_admin_target_merges ON COMMIT DROP AS SELECT DISTINCT merge_run_id FROM world_canonical_node_map WHERE dataset_id = ${datasetId} AND lesson_run_id IN (SELECT lesson_run_id FROM _pg_admin_target_lessons) UNION SELECT DISTINCT mr.merge_run_id FROM world_merge_runs mr CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(mr.selection_json) = 'array' THEN mr.selection_json ELSE '[]'::jsonb END) selected(lesson_run_id) JOIN _pg_admin_target_lessons tl ON tl.lesson_run_id = selected.lesson_run_id WHERE mr.dataset_id = ${datasetId}`;

    const shared = await tx`SELECT count(*) AS count FROM world_canonical_node_map cm WHERE cm.dataset_id = ${datasetId} AND cm.canonical_node_id IN (SELECT node_id FROM _pg_admin_target_nodes) AND cm.lesson_run_id NOT IN (SELECT lesson_run_id FROM _pg_admin_target_lessons)` as unknown as Row[];
    if (numberValue(shared[0]?.count) > 0) throw new AdminConflictError('存在被其他教材复用的 canonical 节点；当前模型无法无损回滚已合并的定义。');
    const mixedMerges = await tx`SELECT count(*) AS count FROM (SELECT cm.lesson_run_id FROM world_canonical_node_map cm WHERE cm.dataset_id = ${datasetId} AND cm.merge_run_id IN (SELECT merge_run_id FROM _pg_admin_target_merges) AND cm.lesson_run_id NOT IN (SELECT lesson_run_id FROM _pg_admin_target_lessons) UNION ALL SELECT selected.lesson_run_id FROM world_merge_runs mr CROSS JOIN LATERAL jsonb_array_elements_text(CASE WHEN jsonb_typeof(mr.selection_json) = 'array' THEN mr.selection_json ELSE '[]'::jsonb END) selected(lesson_run_id) WHERE mr.dataset_id = ${datasetId} AND mr.merge_run_id IN (SELECT merge_run_id FROM _pg_admin_target_merges) AND selected.lesson_run_id NOT IN (SELECT lesson_run_id FROM _pg_admin_target_lessons)) conflicts` as unknown as Row[];
    if (numberValue(mixedMerges[0]?.count) > 0) throw new AdminConflictError('目标 merge run 同时包含其他教材数据。');
    const externalMentions = await tx`SELECT count(*) AS count FROM world_mentions WHERE dataset_id = ${datasetId} AND source_id <> ${bookId} AND ((target_type = 'node' AND target_id IN (SELECT node_id FROM _pg_admin_target_nodes)) OR (target_type = 'edge' AND target_id IN (SELECT id FROM _pg_admin_target_edges)) OR (target_type = 'domain_profile' AND target_id IN (SELECT id FROM _pg_admin_target_profiles)))` as unknown as Row[];
    if (numberValue(externalMentions[0]?.count) > 0) throw new AdminConflictError('其他教材的 mentions 仍引用目标知识对象。');
    const externalLinks = await tx`SELECT count(*) AS count FROM world_evidence_links links JOIN world_evidence ev ON ev.dataset_id = links.dataset_id AND ev.id = links.evidence_id WHERE links.dataset_id = ${datasetId} AND ev.source_id <> ${bookId} AND ((links.owner_type = 'edge' AND links.owner_id IN (SELECT id FROM _pg_admin_target_edges)) OR (links.owner_type = 'domain_profile' AND links.owner_id IN (SELECT id FROM _pg_admin_target_profiles)) OR (links.owner_type = 'mention' AND links.owner_id IN (SELECT id FROM _pg_admin_target_mentions)) OR (links.owner_type = 'node_card' AND links.owner_id IN (SELECT id FROM _pg_admin_target_cards)) OR (links.owner_type = 'node_card_section' AND links.owner_id IN (SELECT owner_id FROM _pg_admin_target_section_owners)))` as unknown as Row[];
    if (numberValue(externalLinks[0]?.count) > 0) throw new AdminConflictError('其他教材的证据仍引用目标知识对象。');

    const counts = (await tx`SELECT (SELECT count(*) FROM _pg_admin_target_lessons) AS lesson_runs, (SELECT count(*) FROM _pg_admin_target_nodes) AS nodes, (SELECT count(*) FROM _pg_admin_target_edges) AS edges, (SELECT count(*) FROM _pg_admin_target_profiles) AS domain_profiles, (SELECT count(*) FROM _pg_admin_target_mentions) AS mentions, (SELECT count(*) FROM _pg_admin_target_evidence) AS evidence, (SELECT count(*) FROM _pg_admin_target_cards) AS node_cards, (SELECT count(*) FROM world_pipeline_jobs WHERE dataset_id = ${datasetId} AND book_id = ${bookId}) AS pipeline_jobs, (SELECT count(*) FROM _pg_admin_target_merges) AS merge_runs` as unknown as Row[])[0] ?? {};

    await tx`DELETE FROM world_evidence_links WHERE dataset_id = ${datasetId} AND (evidence_id IN (SELECT id FROM _pg_admin_target_evidence) OR (owner_type = 'edge' AND owner_id IN (SELECT id FROM _pg_admin_target_edges)) OR (owner_type = 'domain_profile' AND owner_id IN (SELECT id FROM _pg_admin_target_profiles)) OR (owner_type = 'mention' AND owner_id IN (SELECT id FROM _pg_admin_target_mentions)) OR (owner_type = 'node_card' AND owner_id IN (SELECT id FROM _pg_admin_target_cards)) OR (owner_type = 'node_card_section' AND owner_id IN (SELECT owner_id FROM _pg_admin_target_section_owners)))`;
    await tx`DELETE FROM world_mentions WHERE dataset_id = ${datasetId} AND id IN (SELECT id FROM _pg_admin_target_mentions)`;
    await tx`DELETE FROM world_evidence WHERE dataset_id = ${datasetId} AND id IN (SELECT id FROM _pg_admin_target_evidence)`;
    await tx`DELETE FROM world_merge_runs WHERE dataset_id = ${datasetId} AND merge_run_id IN (SELECT merge_run_id FROM _pg_admin_target_merges)`;
    await tx`DELETE FROM world_nodes WHERE dataset_id = ${datasetId} AND id IN (SELECT node_id FROM _pg_admin_target_nodes)`;
    await tx`DELETE FROM world_lesson_runs WHERE dataset_id = ${datasetId} AND lesson_run_id IN (SELECT lesson_run_id FROM _pg_admin_target_lessons)`;
    await tx`DELETE FROM world_pipeline_jobs WHERE dataset_id = ${datasetId} AND book_id = ${bookId}`;
    await tx`DELETE FROM world_textbook_outlines WHERE dataset_id = ${datasetId} AND book_id = ${bookId}`;
    await tx`DELETE FROM world_mineru_sources WHERE dataset_id = ${datasetId} AND book_id = ${bookId}`;
    await tx`DELETE FROM world_source_artifacts WHERE dataset_id = ${datasetId} AND (book_id = ${bookId} OR source_id = ${bookId})`;

    return {
      status: 'success',
      dataset_id: datasetId,
      book_id: bookId,
      deleted: Object.fromEntries(Object.entries(counts).map(([key, value]) => [key, numberValue(value)])),
    };
  }) as Promise<PgAdminBookDeleteResponse>;
}

export function registerPgAdminRoutes(app: Hono, sql: Sql): void {
  app.get('/api/source/:key/pg/tables', async (c) => {
    try {
      const dataset = await resolveDatasetRow(sql, c.req.param('key'));
      if (!dataset) return c.json({ error: 'Unknown source' }, 404);
      const payload: PgAdminCatalogResponse = {
        dataset_id: textValue(dataset.dataset_id),
        schema_version: textValue(dataset.schema_version) || 'world-v1.2',
        export_max_bytes: PG_ADMIN_EXPORT_MAX_BYTES,
        tables: await loadTableMetadata(sql),
      };
      return c.json(payload);
    } catch (error) {
      return c.json({ error: (error as Error).message || 'Failed to load PostgreSQL catalog.' }, 500);
    }
  });

  app.get('/api/source/:key/pg/tables/:table/rows', async (c) => {
    try {
      const dataset = await resolveDatasetRow(sql, c.req.param('key'));
      if (!dataset) return c.json({ error: 'Unknown source' }, 404);
      const tableName = c.req.param('table');
      const table = requireAdminTable(tableName, await loadTableMetadata(sql, tableName));
      const limit = parseLimit(c.req.query('limit'));
      const offset = parseOffset(c.req.query('offset'));
      const query = (c.req.query('q') || '').trim();
      const requestedSort = c.req.query('sort') || table.primary_key[0] || table.columns[0]?.name;
      const sort = table.columns.some((column) => column.name === requestedSort) ? requestedSort : table.primary_key[0];
      const direction = c.req.query('direction') === 'desc' ? 'DESC' : 'ASC';
      const values: SqlParameter[] = [dataset.dataset_id];
      const searchSql = query ? ' AND to_jsonb(t)::text ILIKE $2' : '';
      if (query) values.push(`%${query}%`);
      const countRows = await sql.unsafe(`SELECT count(*) AS count FROM ${quoteIdentifier(tableName)} t WHERE t.dataset_id = $1${searchSql}`, values) as unknown as Row[];
      const rows = await sql.unsafe(
        `SELECT * FROM ${quoteIdentifier(tableName)} t WHERE t.dataset_id = $1${searchSql} ORDER BY ${quoteIdentifier(sort || 'dataset_id')} ${direction} NULLS LAST LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
        [...values, limit, offset],
      ) as unknown as Row[];
      const payload: PgAdminRowsResponse = { dataset_id: textValue(dataset.dataset_id), table, rows, total: numberValue(countRows[0]?.count), limit, offset };
      return c.json(payload);
    } catch (error) {
      const message = (error as Error).message || 'Failed to load PostgreSQL rows.';
      return c.json({ error: message }, message.startsWith('Unsupported') ? 404 : 400);
    }
  });

  app.post('/api/source/:key/pg/export', async (c) => {
    try {
      const dataset = await resolveDatasetRow(sql, c.req.param('key'));
      if (!dataset) return c.json({ error: 'Unknown source' }, 404);
      const body = await c.req.json<PgAdminExportRequest>().catch(() => null);
      if (!body || !Array.isArray(body.tables) || typeof body.include_books !== 'boolean') {
        return c.json({ error: 'Invalid export payload.' }, 400);
      }
      if (!body.include_books && body.tables.length === 0) {
        return c.json({ error: 'Select at least one export item.' }, 400);
      }
      if (body.tables.some((table) => typeof table !== 'string' || !isPgAdminTable(table))) {
        return c.json({ error: 'Export contains an unsupported PostgreSQL table.' }, 400);
      }

      const datasetId = textValue(dataset.dataset_id);
      const tableNames = [...new Set(body.tables)];
      const result = await sql.begin('ISOLATION LEVEL REPEATABLE READ READ ONLY', async (tx) => {
        const availableTables = await loadTableMetadata(tx);
        const selectedTables = tableNames.map((tableName) => requireAdminTable(tableName, availableTables));
        let projectedBytes = 1024 + Buffer.byteLength(JSON.stringify(
          selectedTables.map((table) => ({ name: table.name, columns: table.columns })),
        ));
        for (const table of selectedTables) {
          const sizeRows = await tx.unsafe(
            `SELECT count(*) AS row_count, COALESCE(sum(octet_length(to_jsonb(t)::text)), 0) AS json_bytes FROM ${quoteIdentifier(table.name)} t WHERE t.dataset_id = $1`,
            [dataset.dataset_id],
          ) as unknown as Row[];
          const rowCount = numberValue(sizeRows[0]?.row_count);
          projectedBytes += numberValue(sizeRows[0]?.json_bytes) + rowCount * 256;
          if (projectedBytes > PG_ADMIN_EXPORT_MAX_BYTES) throw exportSizeError(projectedBytes);
        }

        const exportedTables: PgAdminExportPayload['tables'] = {};
        for (const table of selectedTables) {
          const orderBy = table.primary_key.length
            ? ` ORDER BY ${table.primary_key.map(quoteIdentifier).join(', ')}`
            : '';
          const rows = await tx.unsafe(
            `SELECT * FROM ${quoteIdentifier(table.name)} WHERE dataset_id = $1${orderBy}`,
            [dataset.dataset_id],
          ) as unknown as Row[];
          exportedTables[table.name] = { columns: table.columns, rows };
        }

        const exportedAt = new Date().toISOString();
        const payload: PgAdminExportPayload = {
          export_version: 'pg-admin-v1',
          exported_at: exportedAt,
          dataset_id: datasetId,
          schema_version: textValue(dataset.schema_version) || 'world-v1.2',
          ...(body.include_books ? { books: (await loadBooks(tx, datasetId)).books } : {}),
          tables: exportedTables,
        };
        const json = JSON.stringify(payload);
        const actualBytes = Buffer.byteLength(json);
        if (actualBytes > PG_ADMIN_EXPORT_MAX_BYTES) throw exportSizeError(actualBytes);
        return { json, filename: exportFilename(datasetId, exportedAt) };
      });
      return new Response(result.json, {
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Content-Disposition': `attachment; filename="${result.filename}"`,
          'Cache-Control': 'no-store',
        },
      });
    } catch (error) {
      if (error instanceof AdminExportTooLargeError) return c.json({ error: error.message }, 413);
      return c.json({ error: (error as Error).message || 'Failed to export PostgreSQL data.' }, 400);
    }
  });

  app.patch('/api/source/:key/pg/tables/:table/rows', async (c) => {
    try {
      const dataset = await resolveDatasetRow(sql, c.req.param('key'));
      if (!dataset) return c.json({ error: 'Unknown source' }, 404);
      const tableName = c.req.param('table');
      const table = requireAdminTable(tableName, await loadTableMetadata(sql, tableName));
      if (!table.mutable) return c.json({ error: `${tableName} is read-only; protected graph and lineage mutations require a dedicated workflow.` }, 403);
      const body = await c.req.json<PgAdminUpdateRequest>().catch(() => null);
      if (!body) return c.json({ error: 'Invalid update payload.' }, 400);
      const primaryKey = requirePrimaryKey(table, body.primary_key);
      const changes = Object.entries(body.changes || {}).flatMap(([name, value]) => {
        const column = table.columns.find((item) => item.name === name);
        return column?.editable ? [{ column, ...mutationValue(sql, column, value) }] : [];
      });
      if (!changes.length) return c.json({ error: 'No editable changes were provided.' }, 400);
      const values = changes.map((change) => change.value);
      const setSql = changes.map((change, index) => `${quoteIdentifier(change.column.name)} = $${index + 1}${change.cast}`).join(', ');
      const keyWhere = wherePrimaryKey(table, primaryKey, values.length + 2);
      const rows = await sql.begin(async (tx) => {
        await tx.unsafe(PG_ADMIN_DATASET_ADVISORY_LOCK_SQL, [textValue(dataset.dataset_id)]);
        await tx.unsafe(PG_ADMIN_PIPELINE_MUTATION_LOCK_SQL);
        const running = await tx`
          SELECT count(*) AS count
          FROM world_pipeline_jobs
          WHERE dataset_id = ${dataset.dataset_id}
            AND status = 'running'
        ` as unknown as Row[];
        if (numberValue(running[0]?.count) > 0) {
          throw new AdminConflictError('Rows cannot be changed while a pipeline job is running.');
        }
        return tx.unsafe(`UPDATE ${quoteIdentifier(tableName)} SET ${setSql} WHERE dataset_id = $${values.length + 1} AND ${keyWhere.sql} RETURNING *`, [...values, dataset.dataset_id, ...keyWhere.values]);
      }) as unknown as Row[];
      if (!rows.length) return c.json({ error: 'Row not found.' }, 404);
      const payload: PgAdminMutationResponse = { status: 'success', table: tableName, affected: 1, row: rows[0] };
      return c.json(payload);
    } catch (error) {
      if (error instanceof AdminConflictError) return c.json({ error: error.message }, 409);
      return c.json({ error: (error as Error).message || 'Failed to update PostgreSQL row.' }, 400);
    }
  });

  app.delete('/api/source/:key/pg/tables/:table/rows', async (c) => {
    try {
      const dataset = await resolveDatasetRow(sql, c.req.param('key'));
      if (!dataset) return c.json({ error: 'Unknown source' }, 404);
      const tableName = c.req.param('table');
      const table = requireAdminTable(tableName, await loadTableMetadata(sql, tableName));
      if (!table.mutable) return c.json({ error: `${tableName} is read-only; protected graph and lineage mutations require a dedicated workflow.` }, 403);
      const body = await c.req.json<PgAdminDeleteRequest>().catch(() => null);
      if (!body) return c.json({ error: 'Invalid delete payload.' }, 400);
      const primaryKey = requirePrimaryKey(table, body.primary_key);
      const expected = rowDeleteConfirmation(tableName, primaryKey, table.primary_key);
      if (body.confirmation !== expected) return c.json({ error: `Confirmation must exactly match: ${expected}` }, 400);
      const keyWhere = wherePrimaryKey(table, primaryKey, 2);
      const rows = await sql.begin(async (tx) => {
        await tx.unsafe(PG_ADMIN_DATASET_ADVISORY_LOCK_SQL, [textValue(dataset.dataset_id)]);
        await tx.unsafe(PG_ADMIN_PIPELINE_MUTATION_LOCK_SQL);
        const running = await tx`
          SELECT count(*) AS count
          FROM world_pipeline_jobs
          WHERE dataset_id = ${dataset.dataset_id}
            AND status = 'running'
        ` as unknown as Row[];
        if (numberValue(running[0]?.count) > 0) {
          throw new AdminConflictError('Rows cannot be changed while a pipeline job is running.');
        }
        return tx.unsafe(`DELETE FROM ${quoteIdentifier(tableName)} WHERE dataset_id = $1 AND ${keyWhere.sql} RETURNING 1`, [dataset.dataset_id, ...keyWhere.values]);
      }) as unknown as Row[];
      if (!rows.length) return c.json({ error: 'Row not found.' }, 404);
      const payload: PgAdminMutationResponse = { status: 'success', table: tableName, affected: rows.length };
      return c.json(payload);
    } catch (error) {
      if (error instanceof AdminConflictError) return c.json({ error: error.message }, 409);
      return c.json({ error: (error as Error).message || 'Failed to delete PostgreSQL row.' }, 400);
    }
  });

  app.get('/api/source/:key/pg/books', async (c) => {
    try {
      const dataset = await resolveDatasetRow(sql, c.req.param('key'));
      if (!dataset) return c.json({ error: 'Unknown source' }, 404);
      return c.json(await loadBooks(sql, textValue(dataset.dataset_id)));
    } catch (error) {
      return c.json({ error: (error as Error).message || 'Failed to load PostgreSQL books.' }, 500);
    }
  });

  app.delete('/api/source/:key/pg/books/:bookId', async (c) => {
    try {
      const dataset = await resolveDatasetRow(sql, c.req.param('key'));
      if (!dataset) return c.json({ error: 'Unknown source' }, 404);
      const bookId = c.req.param('bookId');
      const body = await c.req.json<PgAdminBookDeleteRequest>().catch(() => null);
      const expected = `DELETE BOOK ${bookId}`;
      if (!body || body.confirmation !== expected) return c.json({ error: `Confirmation must exactly match: ${expected}` }, 400);
      return c.json(await deleteBook(sql, textValue(dataset.dataset_id), bookId));
    } catch (error) {
      if (error instanceof AdminConflictError) return c.json({ error: error.message }, 409);
      return c.json({ error: (error as Error).message || 'Failed to delete PostgreSQL book.' }, 400);
    }
  });
}
