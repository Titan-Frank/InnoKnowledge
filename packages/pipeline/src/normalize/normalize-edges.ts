export type CanonicalEdgeLike = {
  id: string;
  from_id: string;
  to_id: string;
  type: string;
  status?: string | null;
  created_at: string;
};

export type EdgeDeduplicationPlan = {
  keep: string[];
  deprecate: string[];
  groups: Array<{
    key: {
      from_id: string;
      to_id: string;
      type: string;
    };
    keep: string;
    deprecate: string[];
  }>;
};

export function planEdgeDeduplication(edges: CanonicalEdgeLike[]): EdgeDeduplicationPlan {
  const groups = new Map<string, CanonicalEdgeLike[]>();
  for (const edge of edges) {
    if (edge.status === "deprecated") continue;
    const key = edgeGroupKey(edge);
    const group = groups.get(key) ?? [];
    group.push(edge);
    groups.set(key, group);
  }

  const keep: string[] = [];
  const deprecate: string[] = [];
  const duplicateGroups: EdgeDeduplicationPlan["groups"] = [];

  for (const group of groups.values()) {
    if (group.length <= 1) continue;
    const sorted = [...group].sort(compareByCreatedAt);
    const [primary, ...duplicates] = sorted;
    if (!primary) continue;
    const duplicateIds = duplicates.map((edge) => edge.id);
    keep.push(primary.id);
    deprecate.push(...duplicateIds);
    duplicateGroups.push({
      key: {
        from_id: primary.from_id,
        to_id: primary.to_id,
        type: primary.type,
      },
      keep: primary.id,
      deprecate: duplicateIds,
    });
  }

  return { keep, deprecate, groups: duplicateGroups };
}

export function countDeduplicatedEdges(edges: CanonicalEdgeLike[]): number {
  return planEdgeDeduplication(edges).deprecate.length;
}

function edgeGroupKey(edge: CanonicalEdgeLike): string {
  return JSON.stringify([edge.from_id, edge.to_id, edge.type]);
}

function compareByCreatedAt(left: CanonicalEdgeLike, right: CanonicalEdgeLike): number {
  if (left.created_at < right.created_at) return -1;
  if (left.created_at > right.created_at) return 1;
  return 0;
}
