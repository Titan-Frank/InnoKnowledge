import type { SqlStatement } from "../staging/staging-sql.js";

export const EMBEDDING_DIMENSION = 1024;

export type ClusterNodeRow = {
  id: string;
  embedding: unknown;
  properties_json?: unknown;
};

export type PreparedClusterNode = {
  id: string;
  embedding: number[];
  properties: Record<string, unknown>;
};

export type ClusterNodeUpdateRow = {
  id: string;
  properties_json: Record<string, unknown>;
};

export type ClusterNodesSqlPlan = {
  updates: SqlStatement[];
  statements: SqlStatement[];
};

export type ClusterInputSummary = {
  total_nodes: number;
  clustered_nodes: number;
  k: number;
};

export type ClusterRunSummary = ClusterInputSummary & {
  cluster_sizes: Record<string, number>;
};

export type ClusterLayoutResult = {
  labels: number[];
  coords: Array<readonly [number, number]>;
};

export type ClusterLayoutOptions = {
  k: number;
  seed?: number;
  nInit?: number;
  maxIterations?: number;
};

export function parseEmbedding(raw: unknown): number[] | null {
  if (raw === null || raw === undefined) return null;
  if (Array.isArray(raw)) return raw.map(Number);
  if (typeof raw === "string") {
    const cleaned = raw.trim().replace(/^\[/, "").replace(/\]$/, "");
    if (!cleaned) return null;
    return cleaned
      .split(",")
      .filter((item) => item.trim())
      .map((item) => Number(item));
  }
  return null;
}

export function prepareClusterNodes(rows: ClusterNodeRow[], embeddingDimension = EMBEDDING_DIMENSION): PreparedClusterNode[] {
  const prepared: PreparedClusterNode[] = [];
  for (const row of rows) {
    const embedding = parseEmbedding(row.embedding);
    if (!embedding || embedding.length !== embeddingDimension || embedding.some((value) => !Number.isFinite(value))) continue;
    prepared.push({
      id: row.id,
      embedding,
      properties: isRecord(row.properties_json) ? { ...row.properties_json } : {},
    });
  }
  return prepared;
}

export function chooseClusterCount(nodeCount: number, fixedK?: number | null): number {
  return fixedK ?? Math.max(2, Math.min(12, Math.trunc(nodeCount / 15) || 2));
}

export function summarizeClusterInput(rows: ClusterNodeRow[], options: { fixedK?: number | null; embeddingDimension?: number } = {}): ClusterInputSummary {
  const prepared = prepareClusterNodes(rows, options.embeddingDimension ?? EMBEDDING_DIMENSION);
  const n = prepared.length;
  if (n < 10) return { total_nodes: rows.length, clustered_nodes: 0, k: 0 };
  return {
    total_nodes: rows.length,
    clustered_nodes: n,
    k: chooseClusterCount(n, options.fixedK),
  };
}

export function planClusterNodeUpdates(
  nodes: PreparedClusterNode[],
  labels: Array<number | string>,
  coords: Array<readonly [number | string, number | string]>,
): ClusterNodeUpdateRow[] {
  const limit = Math.min(nodes.length, labels.length, coords.length);
  const updates: ClusterNodeUpdateRow[] = [];
  for (let index = 0; index < limit; index += 1) {
    const node = nodes[index]!;
    const label = Number(labels[index]);
    const [rawX, rawY] = coords[index]!;
    const x = Number(rawX);
    const y = Number(rawY);
    if (!Number.isFinite(label) || !Number.isFinite(x) || !Number.isFinite(y)) continue;
    updates.push({
      id: node.id,
      properties_json: {
        ...node.properties,
        community_id: Math.trunc(label),
        layout: { x: normalizeZero(x), y: normalizeZero(y) },
      },
    });
  }
  return updates;
}

export function countClusterSizes(labels: Array<number | string>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const label of labels) {
    const numeric = Number(label);
    if (!Number.isFinite(numeric)) continue;
    const key = String(Math.trunc(numeric));
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export function summarizeClusterRun(totalNodes: number, clusteredNodes: number, k: number, labels: Array<number | string>): ClusterRunSummary {
  return {
    total_nodes: totalNodes,
    clustered_nodes: clusteredNodes,
    k,
    cluster_sizes: countClusterSizes(labels),
  };
}

export function buildSelectClusterNodesStatement(datasetId: string): SqlStatement {
  return {
    name: "select-world-nodes-cluster-source",
    sql: "SELECT id, embedding, properties_json FROM world_nodes WHERE dataset_id = $1 AND embedding IS NOT NULL AND status != 'deprecated' ORDER BY id",
    params: [datasetId],
  };
}

export function buildClusterNodesSqlPlan(datasetId: string, rows: ClusterNodeUpdateRow[]): ClusterNodesSqlPlan {
  const updates = rows.map((row) => ({
    name: "update-world-node-cluster-layout",
    sql: "UPDATE world_nodes SET properties_json = $1::jsonb WHERE dataset_id = $2 AND id = $3",
    params: [row.properties_json, datasetId, row.id],
  }));
  return {
    updates,
    statements: updates,
  };
}

type RawRecord = Record<string, unknown>;

export type ClusterNodesQueryExecutor = (statement: SqlStatement) => Promise<RawRecord[]> | RawRecord[];
export type ClusterNodesExecutor = (statement: SqlStatement) => Promise<void> | void;
export type ClusterLayoutComputer = (nodes: PreparedClusterNode[], options: { k: number; seed: number }) => ClusterLayoutResult;

export type ClusterNodesDatabaseOutput = {
  status: "success";
  dataset_id: string;
  total_nodes: number;
  clustered_nodes: number;
  k: number;
  cluster_sizes?: Record<string, number>;
  read_statements: string[];
  statements: string[];
  executedStatements: string[];
};

export async function runClusterNodesFromDatabase(input: {
  datasetId: string;
  seed?: number;
  fixedK?: number | null;
  query: ClusterNodesQueryExecutor;
  executeStatement: ClusterNodesExecutor;
  computeLayout?: ClusterLayoutComputer;
}): Promise<ClusterNodesDatabaseOutput> {
  const readStatements: string[] = [];
  const statements: string[] = [];
  const executedStatements: string[] = [];
  const query = async (statement: SqlStatement): Promise<RawRecord[]> => {
    readStatements.push(statement.name);
    const rows = await input.query(statement);
    assertClusterRecordRows(statement.name, rows);
    return rows;
  };

  const rows = (await query(buildSelectClusterNodesStatement(input.datasetId))).map(toClusterNodeRow);
  const prepared = prepareClusterNodes(rows);
  if (prepared.length < 10) {
    return {
      status: "success",
      dataset_id: input.datasetId,
      ...summarizeClusterInput(rows, { fixedK: input.fixedK }),
      read_statements: readStatements,
      statements,
      executedStatements,
    };
  }

  const k = chooseClusterCount(prepared.length, input.fixedK);
  if (k > prepared.length) throw new Error(`fixedK (${k}) cannot exceed clustered node count (${prepared.length}).`);
  const layout = (input.computeLayout ?? computeClusterLayout)(prepared, { k, seed: input.seed ?? 42 });
  const updates = planClusterNodeUpdates(prepared, layout.labels, layout.coords);
  const plan = buildClusterNodesSqlPlan(input.datasetId, updates);
  for (const statement of plan.updates) {
    statements.push(statement.name);
    await input.executeStatement(statement);
    executedStatements.push(statement.name);
  }
  return {
    status: "success",
    dataset_id: input.datasetId,
    ...summarizeClusterRun(rows.length, prepared.length, k, layout.labels),
    read_statements: readStatements,
    statements,
    executedStatements,
  };
}

export function computeClusterLayout(nodes: PreparedClusterNode[], options: ClusterLayoutOptions): ClusterLayoutResult {
  if (!Number.isInteger(options.k) || options.k < 1) throw new Error("k must be a positive integer.");
  if (nodes.length === 0) return { labels: [], coords: [] };
  const k = Math.min(options.k, nodes.length);
  const vectors = nodes.map((node) => node.embedding);
  return {
    labels: runKMeans(vectors, {
      k,
      seed: options.seed ?? 42,
      nInit: options.nInit ?? 10,
      maxIterations: options.maxIterations ?? 300,
    }),
    coords: projectPca2D(vectors),
  };
}

function runKMeans(vectors: number[][], options: { k: number; seed: number; nInit: number; maxIterations: number }): number[] {
  let bestLabels = vectors.map(() => 0);
  let bestInertia = Number.POSITIVE_INFINITY;
  for (let init = 0; init < Math.max(1, options.nInit); init += 1) {
    const random = seededRandom(options.seed + init * 9973);
    const centroids = initializeKMeansPlusPlus(vectors, options.k, random);
    const labels = vectors.map(() => 0);
    for (let iteration = 0; iteration < options.maxIterations; iteration += 1) {
      const changed = assignNearestCentroids(vectors, centroids, labels);
      updateCentroids(vectors, centroids, labels);
      if (!changed) break;
    }
    const inertia = computeInertia(vectors, centroids, labels);
    if (inertia < bestInertia) {
      bestInertia = inertia;
      bestLabels = [...labels];
    }
  }
  return bestLabels;
}

function initializeKMeansPlusPlus(vectors: number[][], k: number, random: () => number): number[][] {
  const centroids: number[][] = [];
  const first = Math.min(vectors.length - 1, Math.floor(random() * vectors.length));
  centroids.push([...vectors[first]!]);
  while (centroids.length < k) {
    const distances = vectors.map((vector) => nearestDistanceSquared(vector, centroids));
    const total = distances.reduce((sum, distance) => sum + distance, 0);
    if (total <= 0) {
      centroids.push([...vectors[centroids.length % vectors.length]!]);
      continue;
    }
    let threshold = random() * total;
    let selected = vectors.length - 1;
    for (let index = 0; index < distances.length; index += 1) {
      threshold -= distances[index]!;
      if (threshold <= 0) {
        selected = index;
        break;
      }
    }
    centroids.push([...vectors[selected]!]);
  }
  return centroids;
}

function assignNearestCentroids(vectors: number[][], centroids: number[][], labels: number[]): boolean {
  let changed = false;
  for (let rowIndex = 0; rowIndex < vectors.length; rowIndex += 1) {
    const vector = vectors[rowIndex]!;
    let bestLabel = 0;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (let centroidIndex = 0; centroidIndex < centroids.length; centroidIndex += 1) {
      const distance = squaredDistance(vector, centroids[centroidIndex]!);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestLabel = centroidIndex;
      }
    }
    if (labels[rowIndex] !== bestLabel) {
      labels[rowIndex] = bestLabel;
      changed = true;
    }
  }
  return changed;
}

function updateCentroids(vectors: number[][], centroids: number[][], labels: number[]): void {
  const sums = centroids.map((centroid) => centroid.map(() => 0));
  const counts = centroids.map(() => 0);
  for (let rowIndex = 0; rowIndex < vectors.length; rowIndex += 1) {
    const label = labels[rowIndex]!;
    counts[label] += 1;
    const vector = vectors[rowIndex]!;
    for (let dim = 0; dim < vector.length; dim += 1) sums[label]![dim] += vector[dim]!;
  }
  for (let centroidIndex = 0; centroidIndex < centroids.length; centroidIndex += 1) {
    const count = counts[centroidIndex]!;
    if (count === 0) {
      centroids[centroidIndex] = [...vectors[centroidIndex % vectors.length]!];
      continue;
    }
    for (let dim = 0; dim < centroids[centroidIndex]!.length; dim += 1) {
      centroids[centroidIndex]![dim] = sums[centroidIndex]![dim]! / count;
    }
  }
}

function computeInertia(vectors: number[][], centroids: number[][], labels: number[]): number {
  return vectors.reduce((sum, vector, index) => sum + squaredDistance(vector, centroids[labels[index]!]!), 0);
}

function nearestDistanceSquared(vector: number[], centroids: number[][]): number {
  return centroids.reduce((best, centroid) => Math.min(best, squaredDistance(vector, centroid)), Number.POSITIVE_INFINITY);
}

function squaredDistance(left: number[], right: number[]): number {
  let total = 0;
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    const delta = left[index]! - right[index]!;
    total += delta * delta;
  }
  return total;
}

function projectPca2D(vectors: number[][]): Array<readonly [number, number]> {
  if (vectors.length === 0) return [];
  const centered = centerVectors(vectors);
  const dimensions = centered[0]?.length ?? 0;
  if (dimensions === 0) return centered.map(() => [0, 0] as const);
  const first = powerIteration(centered, null);
  const second = dimensions > 1 ? powerIteration(centered, first) : null;
  return centered.map((vector) => [dot(vector, first), second ? dot(vector, second) : 0] as const);
}

function centerVectors(vectors: number[][]): number[][] {
  const dimensions = vectors[0]?.length ?? 0;
  const means = Array.from({ length: dimensions }, () => 0);
  for (const vector of vectors) {
    for (let dim = 0; dim < dimensions; dim += 1) means[dim]! += vector[dim] ?? 0;
  }
  for (let dim = 0; dim < dimensions; dim += 1) means[dim] /= vectors.length;
  return vectors.map((vector) => means.map((mean, dim) => (vector[dim] ?? 0) - mean));
}

function powerIteration(centered: number[][], orthogonalTo: number[] | null): number[] {
  const dimensions = centered[0]?.length ?? 0;
  let vector = Array.from({ length: dimensions }, (_, index) => (orthogonalTo ? ((index % 2 === 0 ? 1 : -1) / Math.sqrt(dimensions)) : 1 / Math.sqrt(dimensions)));
  if (orthogonalTo) vector = orthogonalize(vector, orthogonalTo);
  for (let iteration = 0; iteration < 50; iteration += 1) {
    let next = covarianceMultiply(centered, vector);
    if (orthogonalTo) next = orthogonalize(next, orthogonalTo);
    vector = normalize(next);
  }
  return vector;
}

function covarianceMultiply(centered: number[][], vector: number[]): number[] {
  const result = vector.map(() => 0);
  for (const row of centered) {
    const projection = dot(row, vector);
    for (let dim = 0; dim < result.length; dim += 1) result[dim]! += (row[dim] ?? 0) * projection;
  }
  const divisor = Math.max(1, centered.length - 1);
  return result.map((value) => value / divisor);
}

function orthogonalize(vector: number[], basis: number[]): number[] {
  const projection = dot(vector, basis);
  return vector.map((value, index) => value - projection * (basis[index] ?? 0));
}

function normalize(vector: number[]): number[] {
  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0 || !Number.isFinite(norm)) return vector.map(() => 0);
  return vector.map((value) => value / norm);
}

function dot(left: number[], right: number[]): number {
  let total = 0;
  const length = Math.min(left.length, right.length);
  for (let index = 0; index < length; index += 1) total += left[index]! * right[index]!;
  return total;
}

function normalizeZero(value: number): number {
  return Object.is(value, -0) ? 0 : value;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function toClusterNodeRow(row: RawRecord): ClusterNodeRow {
  return {
    id: requiredString(row.id, "id"),
    embedding: row.embedding,
    properties_json: row.properties_json,
  };
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Missing required field '${name}'.`);
  return value;
}

function assertClusterRecordRows(name: string, rows: unknown): asserts rows is RawRecord[] {
  if (!Array.isArray(rows) || !rows.every(isRecord)) throw new Error(`${name} returned invalid rows.`);
}
