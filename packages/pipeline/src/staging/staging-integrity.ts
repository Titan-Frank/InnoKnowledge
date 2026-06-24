import type { StagingTableRows } from "./staging-rows.js";

export type IntegrityCheck = {
  name: "references";
  ok: boolean;
};

export type StagingIntegrityResult = {
  valid: boolean;
  checks: IntegrityCheck[];
  issues: string[];
};

export function checkStagingIntegrity(rows: Pick<StagingTableRows, "domain_profiles" | "edges" | "node_cards" | "nodes">): StagingIntegrityResult {
  const issues: string[] = [];
  const nodeIds = new Set(rows.nodes.map((row) => row.raw_node_id));

  for (const profile of rows.domain_profiles) {
    if (!nodeIds.has(profile.raw_node_id)) {
      issues.push(`Domain profile ${profile.raw_profile_id} references missing node ${profile.raw_node_id}.`);
    }
  }

  for (const edge of rows.edges) {
    if (!nodeIds.has(edge.from_raw_node_id) || !nodeIds.has(edge.to_raw_node_id)) {
      issues.push(`Edge ${edge.raw_edge_id} references missing node endpoint.`);
    }
  }

  for (const card of rows.node_cards) {
    if (!nodeIds.has(card.raw_node_id)) {
      issues.push(`Node card ${card.raw_card_id} references missing node ${card.raw_node_id}.`);
    }
  }

  return {
    valid: issues.length === 0,
    checks: [{ name: "references", ok: issues.length === 0 }],
    issues,
  };
}
