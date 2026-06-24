import assert from "node:assert/strict";
import test from "node:test";

import { planDomainProfileDeduplication } from "./normalize-domain-profiles.js";
import { makeDomainProfileId } from "../shared/pathing.js";

test("plans canonical domain profile merge like Python normalize.deduplicate_domain_profiles", () => {
  const canonicalId = makeDomainProfileId("node:water", "chemistry");
  const plan = planDomainProfileDeduplication(
    [
      {
        id: "profile-old",
        node_id: "node:water",
        domain: "chemistry",
        school_stages_json: [" primary ", "junior-secondary"],
        curriculum_roles_json: ["core"],
        source_refs_json: ["ev1", "ev-missing"],
        properties_json: { a: "", b: ["x"] },
        notes: "old note",
        created_at: "2026-01-01T00:00:00Z",
      },
      {
        id: canonicalId,
        node_id: "node:water",
        domain: "chemistry",
        school_stages_json: ["primary", "senior-secondary"],
        curriculum_roles_json: ["support", "core"],
        source_refs_json: ["ev2", "ev1"],
        properties_json: { a: "filled", b: ["x", "y"], c: { d: "" } },
        notes: "new note",
        created_at: "2026-01-02T00:00:00Z",
      },
    ],
    { existingEvidenceIds: new Set(["ev1", "ev2"]) },
  );

  assert.deepEqual(plan, {
    merged_count: 1,
    groups: [
      {
        key: { node_id: "node:water", domain: "chemistry" },
        canonical_profile_id: canonicalId,
        primary_id: canonicalId,
        duplicate_ids: ["profile-old"],
        merged: {
          school_stages_json: ["primary", "junior-secondary", "senior-secondary"],
          curriculum_roles_json: ["core", "support"],
          source_refs_json: ["ev1", "ev2"],
          properties_json: { a: "filled", b: ["x", "y"], c: { d: "" } },
          notes: "old note\n\nnew note",
          created_at: "2026-01-01T00:00:00Z",
          status: "active",
        },
      },
    ],
  });
});

test("plans a canonical rename when only one non-canonical profile exists", () => {
  const plan = planDomainProfileDeduplication([
    {
      id: "manual-profile",
      node_id: "node:water",
      domain: "chemistry",
      created_at: "2026-01-01T00:00:00Z",
    },
  ]);

  assert.equal(plan.merged_count, 1);
  assert.equal(plan.groups[0]?.primary_id, "manual-profile");
  assert.equal(plan.groups[0]?.canonical_profile_id, makeDomainProfileId("node:water", "chemistry"));
  assert.deepEqual(plan.groups[0]?.duplicate_ids, ["manual-profile"]);
});

test("skips already canonical singletons and deprecated profiles", () => {
  const canonicalId = makeDomainProfileId("node:water", "chemistry");
  const plan = planDomainProfileDeduplication([
    {
      id: canonicalId,
      node_id: "node:water",
      domain: "chemistry",
      status: "active",
      created_at: "2026-01-01T00:00:00Z",
    },
    {
      id: "deprecated-profile",
      node_id: "node:water",
      domain: "chemistry",
      status: "deprecated",
      created_at: "2026-01-02T00:00:00Z",
    },
  ]);

  assert.deepEqual(plan, { merged_count: 0, groups: [] });
});
