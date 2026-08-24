export interface EmbeddingPoint {
  id: string;
  embedding: string | number[];
}

const MIN_COMMUNITIES = 4;
const MAX_COMMUNITIES = 12;
const KMEANS_ITERATIONS = 12;

function parseEmbedding(value: string | number[]): Float32Array | null {
  const values = Array.isArray(value)
    ? value
    : value.trim().replace(/^\[/, '').replace(/\]$/, '').split(',').map(Number);
  if (values.length === 0 || values.some((entry) => !Number.isFinite(entry))) return null;

  let normSquared = 0;
  for (const entry of values) normSquared += entry * entry;
  if (normSquared === 0) return null;

  const norm = Math.sqrt(normSquared);
  return Float32Array.from(values, (entry) => entry / norm);
}

function dot(left: Float32Array, right: Float32Array): number {
  let value = 0;
  for (let index = 0; index < left.length; index += 1) value += left[index] * right[index];
  return value;
}

function chooseCommunityCount(pointCount: number): number {
  if (pointCount < MIN_COMMUNITIES * 2) return Math.max(1, Math.round(Math.sqrt(pointCount)));
  return Math.min(MAX_COMMUNITIES, Math.max(MIN_COMMUNITIES, Math.round(Math.sqrt(pointCount / 8))));
}

function initializeCentroids(vectors: Float32Array[], count: number): Float32Array[] {
  const centroids = [vectors[0].slice()];
  const nearestSimilarities = new Float32Array(vectors.length).fill(-1);

  while (centroids.length < count) {
    const latest = centroids[centroids.length - 1];
    let farthestIndex = 0;
    let farthestSimilarity = Number.POSITIVE_INFINITY;
    for (let index = 0; index < vectors.length; index += 1) {
      nearestSimilarities[index] = Math.max(nearestSimilarities[index], dot(vectors[index], latest));
      if (nearestSimilarities[index] < farthestSimilarity) {
        farthestSimilarity = nearestSimilarities[index];
        farthestIndex = index;
      }
    }
    centroids.push(vectors[farthestIndex].slice());
  }
  return centroids;
}

function assignCommunities(vectors: Float32Array[], centroids: Float32Array[]): number[] {
  const assignments = new Array<number>(vectors.length).fill(0);
  for (let pointIndex = 0; pointIndex < vectors.length; pointIndex += 1) {
    let bestCommunity = 0;
    let bestSimilarity = Number.NEGATIVE_INFINITY;
    for (let community = 0; community < centroids.length; community += 1) {
      const similarity = dot(vectors[pointIndex], centroids[community]);
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity;
        bestCommunity = community;
      }
    }
    assignments[pointIndex] = bestCommunity;
  }
  return assignments;
}

function updateCentroids(
  vectors: Float32Array[],
  assignments: number[],
  previous: Float32Array[],
): Float32Array[] {
  const dimensions = vectors[0].length;
  const sums = previous.map(() => new Float64Array(dimensions));
  const counts = new Uint32Array(previous.length);

  for (let pointIndex = 0; pointIndex < vectors.length; pointIndex += 1) {
    const community = assignments[pointIndex];
    counts[community] += 1;
    const vector = vectors[pointIndex];
    for (let dimension = 0; dimension < dimensions; dimension += 1) {
      sums[community][dimension] += vector[dimension];
    }
  }

  return sums.map((sum, community) => {
    if (counts[community] === 0) return previous[community];
    let normSquared = 0;
    for (let dimension = 0; dimension < dimensions; dimension += 1) {
      sum[dimension] /= counts[community];
      normSquared += sum[dimension] * sum[dimension];
    }
    const norm = Math.sqrt(normSquared) || 1;
    return Float32Array.from(sum, (entry) => entry / norm);
  });
}

/** Deterministic cosine k-means. IDs are sorted before initialization and labels are
 * renumbered by their smallest member ID so reloads keep the same visual partition. */
export function clusterEmbeddingCommunities(points: EmbeddingPoint[]): Map<string, number> {
  const parsed = points
    .map((point) => ({ id: point.id, vector: parseEmbedding(point.embedding) }))
    .filter((point): point is { id: string; vector: Float32Array } => point.vector != null)
    .sort((left, right) => left.id.localeCompare(right.id));
  if (parsed.length === 0) return new Map();

  const dimensions = parsed[0].vector.length;
  const compatible = parsed.filter((point) => point.vector.length === dimensions);
  const vectors = compatible.map((point) => point.vector);
  const communityCount = chooseCommunityCount(vectors.length);
  let centroids = initializeCentroids(vectors, communityCount);
  let assignments = new Array<number>(vectors.length).fill(0);

  for (let iteration = 0; iteration < KMEANS_ITERATIONS; iteration += 1) {
    assignments = assignCommunities(vectors, centroids);
    centroids = updateCentroids(vectors, assignments, centroids);
  }

  const smallestMember = new Map<number, string>();
  for (let index = 0; index < compatible.length; index += 1) {
    const community = assignments[index];
    const current = smallestMember.get(community);
    if (!current || compatible[index].id < current) smallestMember.set(community, compatible[index].id);
  }
  const stableLabels = [...smallestMember.entries()]
    .sort((left, right) => left[1].localeCompare(right[1]))
    .reduce((map, [community], label) => map.set(community, label), new Map<number, number>());

  return new Map(compatible.map((point, index) => [point.id, stableLabels.get(assignments[index]) ?? 0]));
}
