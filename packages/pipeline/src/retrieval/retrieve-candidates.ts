import { makeQueryId } from "../shared/knowledge.js";

export type RetrievalMode = "local" | "hybrid" | "vector";

export type RetrievalCandidate = {
  node_id: string;
  name: string;
  kind: string;
  score: number;
  method: string;
};

export type RetrievalQuery = {
  query_text: string;
  query_id?: string;
};

export type RetrievalPayload = {
  dataset_id: string;
  batch_anchor: string | null;
  query_id: string;
  query_text: string;
  candidates: RetrievalCandidate[];
};

export type RetrievalFilters = {
  mode: RetrievalMode;
  domain: string | null;
  school_stage: string | null;
  node_kind: string | null;
};

export type RetrievalCandidateInsertRow = {
  dataset_id: string;
  batch_anchor: string | null;
  query_id: string;
  query_text: string;
  candidate_node_id: string;
  rank: number;
  score: number;
  retrieval_method: string;
  filters_json: RetrievalFilters;
  created_at: string;
};

export type BuildRetrievalPayloadsInput = {
  datasetId: string;
  batchAnchor?: string | null;
  queries: RetrievalQuery[];
  localCandidatesByQueryId?: Record<string, RetrievalCandidate[]>;
  vectorCandidatesByQueryId?: Record<string, RetrievalCandidate[]>;
  mode?: RetrievalMode;
  limit?: number;
};

export type LoadRetrievalQueriesInput = {
  queries?: string[];
  queriesFileText?: string | null;
  queriesFileKind?: "jsonl" | "text" | null;
};

export function buildRetrievalFilters(input: {
  mode?: RetrievalMode;
  domain?: string | null;
  schoolStage?: string | null;
  nodeKind?: string | null;
}): RetrievalFilters {
  return {
    mode: input.mode ?? "hybrid",
    domain: input.domain ?? null,
    school_stage: input.schoolStage ?? null,
    node_kind: input.nodeKind ?? null,
  };
}

export function loadRetrievalQueries(input: LoadRetrievalQueriesInput): RetrievalQuery[] {
  const queries: RetrievalQuery[] = [];
  for (const item of input.queries ?? []) {
    if (item.trim()) queries.push({ query_text: item });
  }

  if (input.queriesFileText !== undefined && input.queriesFileText !== null) {
    if (input.queriesFileKind === "jsonl") {
      queries.push(...parseJsonlQueries(input.queriesFileText));
    } else {
      queries.push(...parseTextQueries(input.queriesFileText));
    }
  }

  if (queries.length === 0) {
    throw new Error("Provide at least one query or --queries-file.");
  }
  return queries;
}

export function mergeCandidates(groups: RetrievalCandidate[][], limit: number): RetrievalCandidate[] {
  const merged = new Map<string, RetrievalCandidate>();
  for (const group of groups) {
    for (const candidate of group) {
      const existing = merged.get(candidate.node_id);
      if (!existing || candidate.score > existing.score) {
        merged.set(candidate.node_id, { ...candidate });
      } else {
        existing.score += candidate.score * 0.1;
        existing.method = `${existing.method}+${candidate.method}`;
      }
    }
  }
  return [...merged.values()].sort(compareCandidates).slice(0, limit);
}

export function buildRetrievalPayloads(input: BuildRetrievalPayloadsInput): RetrievalPayload[] {
  const mode = input.mode ?? "hybrid";
  const limit = input.limit ?? 8;
  const batchAnchor = input.batchAnchor ?? null;
  const queryIdAnchor = batchAnchor ?? "adhoc";

  return input.queries.map((query) => {
    const queryText = query.query_text;
    const queryId = query.query_id?.trim() || makeQueryId(queryIdAnchor, queryText);
    const local = input.localCandidatesByQueryId?.[queryId] ?? [];
    const vector = input.vectorCandidatesByQueryId?.[queryId] ?? [];
    const candidates = selectCandidatesForMode({ local, vector, mode, limit });
    return {
      dataset_id: input.datasetId,
      batch_anchor: batchAnchor,
      query_id: queryId,
      query_text: queryText,
      candidates,
    };
  });
}

export function planRetrievalCandidateInsertRows(payload: RetrievalPayload, filters: RetrievalFilters, createdAt: string): RetrievalCandidateInsertRow[] {
  return payload.candidates.map((candidate, index) => ({
    dataset_id: payload.dataset_id,
    batch_anchor: payload.batch_anchor,
    query_id: payload.query_id,
    query_text: payload.query_text,
    candidate_node_id: candidate.node_id,
    rank: index + 1,
    score: candidate.score,
    retrieval_method: candidate.method,
    filters_json: filters,
    created_at: createdAt,
  }));
}

function selectCandidatesForMode(options: {
  local: RetrievalCandidate[];
  vector: RetrievalCandidate[];
  mode: RetrievalMode;
  limit: number;
}): RetrievalCandidate[] {
  if (options.mode === "hybrid") return mergeCandidates([options.local, options.vector], options.limit);
  if (options.mode === "vector") return options.vector.slice(0, options.limit).map((candidate) => ({ ...candidate }));
  return options.local.slice(0, options.limit).map((candidate) => ({ ...candidate }));
}

function compareCandidates(left: RetrievalCandidate, right: RetrievalCandidate): number {
  if (right.score !== left.score) return right.score - left.score;
  const byName = left.name.localeCompare(right.name);
  if (byName !== 0) return byName;
  return left.node_id.localeCompare(right.node_id);
}

function parseTextQueries(text: string): RetrievalQuery[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line) => ({ query_text: line.trim() }));
}

function parseJsonlQueries(text: string): RetrievalQuery[] {
  const queries: RetrievalQuery[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const record = JSON.parse(line) as unknown;
    if (!isRecord(record)) throw new Error("Invalid queries-file JSONL: each line must be an object.");
    queries.push({
      query_text: requiredJsonlString(record, "query_text").trim(),
      query_id: String(record.query_id ?? "").trim(),
    });
  }
  return queries;
}

function requiredJsonlString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (value === undefined || value === null) throw new Error(`Invalid queries-file JSONL: missing '${key}'.`);
  return String(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
