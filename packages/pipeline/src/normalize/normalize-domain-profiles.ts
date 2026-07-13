import { mergeJsonObjects, mergeTextBlocks, mergeUniqueStrings } from "../shared/knowledge.js";
import { makeDomainProfileId } from "../shared/pathing.js";

export type CanonicalDomainProfileLike = {
  id: string;
  node_id: string;
  domain: string;
  schema_id: string;
  schema_version: string;
  domain_role: string;
  source_refs_json?: unknown;
  properties_json?: unknown;
  notes?: string | null;
  status?: string | null;
  created_at: string;
};

export type DomainProfileDeduplicationGroup = {
  key: {
    node_id: string;
    domain: string;
  };
  canonical_profile_id: string;
  primary_id: string;
  duplicate_ids: string[];
  merged: {
    schema_id: string;
    schema_version: string;
    domain_role: string;
    source_refs_json: string[];
    properties_json: Record<string, unknown>;
    notes: string;
    created_at: string;
    status: "active";
  };
};

export type DomainProfileDeduplicationPlan = {
  merged_count: number;
  groups: DomainProfileDeduplicationGroup[];
};

export function planDomainProfileDeduplication(
  profiles: CanonicalDomainProfileLike[],
  options: { existingEvidenceIds?: ReadonlySet<string> } = {},
): DomainProfileDeduplicationPlan {
  const grouped = new Map<string, CanonicalDomainProfileLike[]>();
  for (const profile of profiles.filter((profile) => profile.status !== "deprecated").sort(compareByCreatedAtThenId)) {
    const key = groupKey(profile.node_id, profile.domain);
    const group = grouped.get(key) ?? [];
    group.push(profile);
    grouped.set(key, group);
  }

  const groups: DomainProfileDeduplicationGroup[] = [];
  for (const profilesForKey of grouped.values()) {
    const first = profilesForKey[0];
    if (!first) continue;
    const canonicalProfileId = makeDomainProfileId(first.node_id, first.domain);
    const needsMerge = profilesForKey.length > 1 || profilesForKey.some((profile) => profile.id !== canonicalProfileId);
    if (!needsMerge) continue;

    const primary = profilesForKey.find((profile) => profile.id === canonicalProfileId) ?? first;
    let sourceRefs: string[] = [];
    let properties: Record<string, unknown> = {};
    let notes = "";
    let createdAt = primary.created_at;

    for (const profile of profilesForKey) {
      sourceRefs = mergeUniqueStrings(sourceRefs, listValue(profile.source_refs_json));
      properties = mergeJsonObjects(properties, recordValue(profile.properties_json));
      notes = mergeTextBlocks(notes, profile.notes ?? "");
      if (String(profile.created_at) < String(createdAt)) {
        createdAt = profile.created_at;
      }
    }

    if (options.existingEvidenceIds) {
      sourceRefs = sourceRefs.filter((evidenceId) => options.existingEvidenceIds!.has(evidenceId));
    }

    groups.push({
      key: {
        node_id: first.node_id,
        domain: first.domain,
      },
      canonical_profile_id: canonicalProfileId,
      primary_id: primary.id,
      duplicate_ids: profilesForKey.filter((profile) => profile.id !== canonicalProfileId).map((profile) => profile.id),
      merged: {
        schema_id: primary.schema_id,
        schema_version: primary.schema_version,
        domain_role: primary.domain_role,
        source_refs_json: sourceRefs,
        properties_json: properties,
        notes,
        created_at: createdAt,
        status: "active",
      },
    });
  }

  return {
    merged_count: groups.reduce((sum, group) => sum + Math.max(1, group.duplicate_ids.length), 0),
    groups,
  };
}

function compareByCreatedAtThenId(left: CanonicalDomainProfileLike, right: CanonicalDomainProfileLike): number {
  if (left.created_at < right.created_at) return -1;
  if (left.created_at > right.created_at) return 1;
  if (left.id < right.id) return -1;
  if (left.id > right.id) return 1;
  return 0;
}

function groupKey(nodeId: string, domain: string): string {
  return JSON.stringify([nodeId, domain]);
}

function listValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}
