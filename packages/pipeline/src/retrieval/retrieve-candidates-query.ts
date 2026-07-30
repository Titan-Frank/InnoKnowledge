import { normalizeTerm } from "../shared/pathing.js";
import { formatEmbeddingVector } from "../shared/embeddings.js";
import { mergeCandidates, type RetrievalCandidate, type RetrievalMode } from "./retrieve-candidates.js";
import type { SqlStatement } from "../staging/staging-sql.js";

type RawRecord = Record<string, unknown>;

export type LocalCandidateQueryOptions = {
  datasetId: string;
  queryText: string;
  nodeKind?: string | null;
  domain?: string | null;
  schoolStage?: string | null;
  limit?: number;
};

export type VectorCandidateQueryOptions = {
  datasetId: string;
  embedding: number[];
  nodeKind?: string | null;
  limit?: number;
};

export type LocalCandidateRow = {
  id: string;
  name: string;
  kind: string;
  score: number | string;
};

export type VectorCandidateRow = {
  id: string;
  name: string;
  kind: string;
  similarity: number | string;
};

export type RetrievalCandidateQueryExecutor = (statement: SqlStatement) => Promise<RawRecord[]> | RawRecord[];

export type LoadRetrievalCandidatesForQueriesInput = {
  datasetId: string;
  queries: string[];
  executor: RetrievalCandidateQueryExecutor;
  embedQuery?: (queryText: string) => Promise<number[]> | number[];
  mode?: RetrievalMode;
  domain?: string | null;
  schoolStage?: string | null;
  nodeKind?: string | null;
  limit?: number;
  vectorMinSimilarity?: number;
};

export function buildLocalCandidatesQuery(options: LocalCandidateQueryOptions): SqlStatement {
  const term = normalizeTerm(options.queryText);
  const clauses = ["n.dataset_id = $3", "n.status != 'deprecated'"];
  const params: unknown[] = [term, `${term}%`, options.datasetId];

  if (options.nodeKind) {
    params.push(options.nodeKind);
    clauses.push(`n.kind = $${params.length}`);
  }
  if (options.domain) {
    params.push(options.domain);
    clauses.push(
      `EXISTS (SELECT 1 FROM world_domain_profiles p WHERE p.dataset_id = n.dataset_id AND p.node_id = n.id AND p.domain = $${params.length})`,
    );
  }
  if (options.schoolStage) {
    params.push(options.schoolStage);
    clauses.push(
      `EXISTS (SELECT 1 FROM world_domain_profiles p WHERE p.dataset_id = n.dataset_id AND p.node_id = n.id AND $${params.length} = ANY(SELECT jsonb_array_elements_text(p.school_stages_json)))`,
    );
  }

  params.push(term, `${term}%`, `%${options.queryText.trim()}%`, (options.limit ?? 8) * 3);
  const [exactTermIndex, prefixScoreIndex] = [1, 2];
  const termMatchIndex = params.length - 3;
  const prefixMatchIndex = params.length - 2;
  const definitionMatchIndex = params.length - 1;
  const limitIndex = params.length;

  return {
    name: "select-local-retrieval-candidates",
    sql: [
      "SELECT n.id, n.name, n.kind,",
      "       CASE",
      `         WHEN nt.term_norm = $${exactTermIndex} THEN 100`,
      `         WHEN nt.term_norm LIKE $${prefixScoreIndex} THEN 85`,
      "         ELSE 70",
      "       END AS score",
      "FROM world_node_terms nt",
      "JOIN world_nodes n",
      "  ON n.dataset_id = nt.dataset_id AND n.id = nt.node_id",
      `WHERE ${clauses.join(" AND ")}`,
      `  AND (nt.term_norm = $${termMatchIndex} OR nt.term_norm LIKE $${prefixMatchIndex} OR n.definition ILIKE $${definitionMatchIndex})`,
      "ORDER BY score DESC, n.name",
      `LIMIT $${limitIndex}`,
    ].join("\n"),
    params,
  };
}

export function mapLocalCandidateRows(rows: LocalCandidateRow[]): RetrievalCandidate[] {
  const result: RetrievalCandidate[] = [];
  for (const row of rows) {
    const score = Number(row.score);
    if (!Number.isFinite(score)) continue;
    result.push({
      node_id: row.id,
      name: row.name,
      kind: row.kind,
      score,
      method: "local",
    });
  }
  return result;
}

export function buildVectorCandidatesQuery(options: VectorCandidateQueryOptions): SqlStatement {
  const embeddingText = formatEmbeddingVector(options.embedding);
  if (embeddingText === null) {
    throw new Error("Vector candidate query requires a non-empty finite embedding");
  }
  const clauses = ["dataset_id = $2", "status != 'deprecated'", "embedding IS NOT NULL"];
  // postgres.js serializes JavaScript arrays as PostgreSQL arrays. pgvector's
  // `vector` input parser instead expects text in the form "[0.1,0.2,...]".
  const params: unknown[] = [embeddingText, options.datasetId];
  if (options.nodeKind) {
    params.push(options.nodeKind);
    clauses.push(`kind = $${params.length}`);
  }
  params.push(embeddingText, (options.limit ?? 8) * 2);
  const orderEmbeddingIndex = params.length - 1;
  const limitIndex = params.length;

  return {
    name: "select-vector-retrieval-candidates",
    sql: [
      "SELECT id, name, kind, 1 - (embedding <=> $1::vector) AS similarity",
      "FROM world_nodes",
      `WHERE ${clauses.join(" AND ")}`,
      `ORDER BY embedding <=> $${orderEmbeddingIndex}::vector`,
      `LIMIT $${limitIndex}`,
    ].join("\n"),
    params,
  };
}

export function mapVectorCandidateRows(rows: VectorCandidateRow[], vectorMinSimilarity = 0.5): RetrievalCandidate[] {
  const result: RetrievalCandidate[] = [];
  for (const row of rows) {
    const similarity = Number(row.similarity);
    if (!Number.isFinite(similarity) || similarity < vectorMinSimilarity) continue;
    result.push({
      node_id: row.id,
      name: row.name,
      kind: row.kind,
      score: 40 + similarity * 50,
      method: "vector",
    });
  }
  return result;
}

export async function loadRetrievalCandidatesForQueries(input: LoadRetrievalCandidatesForQueriesInput): Promise<RetrievalCandidate[]> {
  const mode = input.mode ?? "hybrid";
  const limit = input.limit ?? 8;
  const bestByNodeId = new Map<string, RetrievalCandidate>();

  for (const queryText of uniqueNonEmpty(input.queries)) {
    const local =
      mode === "vector"
        ? []
        : mapLocalCandidateRows(
            (await input.executor(
              buildLocalCandidatesQuery({
                datasetId: input.datasetId,
                queryText,
                domain: input.domain,
                schoolStage: input.schoolStage,
                nodeKind: input.nodeKind,
                limit,
              }),
            )) as LocalCandidateRow[],
          );
    const vector = mode === "local" || input.embedQuery === undefined ? [] : await loadVectorCandidates(input, queryText, limit);
    const candidates = mode === "hybrid" ? mergeCandidates([local, vector], limit) : mode === "vector" ? vector.slice(0, limit) : local.slice(0, limit);
    for (const candidate of candidates) {
      const existing = bestByNodeId.get(candidate.node_id);
      if (existing === undefined || candidate.score > existing.score) {
        bestByNodeId.set(candidate.node_id, { ...candidate });
      }
    }
  }

  return [...bestByNodeId.values()].sort((left, right) => right.score - left.score).slice(0, limit);
}

async function loadVectorCandidates(input: LoadRetrievalCandidatesForQueriesInput, queryText: string, limit: number): Promise<RetrievalCandidate[]> {
  const embedding = input.embedQuery ? await input.embedQuery(queryText) : [];
  if (!Array.isArray(embedding) || embedding.length === 0) return [];
  const rows = (await input.executor(
    buildVectorCandidatesQuery({
      datasetId: input.datasetId,
      embedding,
      nodeKind: input.nodeKind,
      limit,
    }),
  )) as VectorCandidateRow[];
  return mapVectorCandidateRows(rows, input.vectorMinSimilarity);
}

function uniqueNonEmpty(values: Iterable<string>): string[] {
  const result: string[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    const text = value.trim();
    if (!text || seen.has(text)) continue;
    seen.add(text);
    result.push(text);
  }
  return result;
}
