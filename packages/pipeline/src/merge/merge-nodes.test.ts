import assert from "node:assert/strict";
import test from "node:test";

import {
  formatPgvector,
  filterExistingEvidenceIds,
  lexicalSimilarity,
  makeCanonicalCandidate,
  mergeNodePayload,
  normalizedTerms,
  planDomainProfileMerge,
  planEdgeMerge,
  planEvidenceMerge,
  planMentionMerge,
  planNodeCardMerge,
  planReplaceEvidenceLinks,
  planStagedNodeMerge,
  parseEmbedding,
  remapCardSections,
  remapSourceRefs,
  scoreNodeMatch,
} from "./merge-nodes.js";

test("parses embeddings and formats pgvector text like Python merge_staged_lessons", () => {
  assert.deepEqual(parseEmbedding([1, "2.5", 3]), [1, 2.5, 3]);
  assert.deepEqual(parseEmbedding([1, "bad"]), []);
  assert.deepEqual(parseEmbedding("[]"), []);
  assert.equal(formatPgvector([1, "2.5", 3]), "[1,2.5,3]");
  assert.equal(formatPgvector([]), null);
});

test("normalizes node terms from aliases_json only like Python", () => {
  assert.deepEqual([...normalizedTerms({ name: " Water   Cycle ", aliases_json: ["水循环", "Water cycle"] })], ["water cycle", "水循环"]);
  assert.deepEqual([...normalizedTerms({ name: "Water", aliases: ["Ignored Alias"] })], ["water"]);
});

test("computes lexical similarity with Python SequenceMatcher-compatible behavior", () => {
  assert.equal(lexicalSimilarity(new Set(["water cycle"]), new Set(["water cycle"])), 1);
  assert.equal(lexicalSimilarity(new Set(["water"]), new Set(["water cycle"])), 0.96);
  assert.equal(lexicalSimilarity(new Set(["water cycle"]), new Set(["water-cycle"])), 0.9090909090909091);
  assert.equal(lexicalSimilarity(new Set(["氧气"]), new Set(["氧气的性质"])), 0.96);
  assert.equal(lexicalSimilarity(new Set(), new Set(["water"])), 0);
});

test("scores node matches like Python score_node_match", () => {
  const candidate = makeCanonicalCandidate({
    id: "concept:auto-water",
    name: "Water Cycle",
    kind: "concept",
    subkind: "science",
    aliases_json: ["水循环"],
    properties_json: { semantic_key: "chem:water-cycle" },
    embedding: [1, 0, 0],
  });

  assert.deepEqual(scoreNodeMatch({ kind: "entity", name: "Water Cycle" }, candidate), {
    score: 0,
    lexical: 0,
    semantic: 0,
    embedding: 0,
    rationale: { reason: "kind_mismatch" },
  });
  const subkindMismatch = scoreNodeMatch({ kind: "concept", subkind: "other", name: "Water Cycle" }, candidate);
  assert.equal(subkindMismatch.score, 0.94);
  assert.equal(subkindMismatch.lexical, 1);
  assert.equal(subkindMismatch.rationale.subkind_match, false);

  const exact = scoreNodeMatch(
    {
      kind: "concept",
      subkind: "science",
      name: "Water Cycle",
      aliases: ["ignored by Python"],
      semantic_key: "chem:water-cycle",
      embedding: [1, 0, 0],
    },
    candidate,
  );
  assert.equal(exact.score, 1);
  assert.equal(exact.lexical, 1);
  assert.equal(exact.semantic, 1);
  assert.equal(exact.embedding, 1);
  assert.equal(exact.rationale.candidate_id, "concept:auto-water");
  assert.equal(exact.rationale.subkind_match, true);

  const aliasOnly = scoreNodeMatch({ kind: "concept", subkind: "science", name: "Different", aliases: ["水循环"] }, candidate);
  assert.equal(aliasOnly.lexical < 0.98, true);
});

test("raises strong embedding matches to the Python threshold floor", () => {
  const candidate = makeCanonicalCandidate({
    id: "concept:auto-water",
    name: "Water Cycle",
    kind: "concept",
    aliases_json: [],
    properties_json: {},
    embedding: [1, 0],
  });

  const score = scoreNodeMatch({ kind: "concept", name: "Water", embedding: [0.99, 0.01] }, candidate, { embeddingThreshold: 0.92 });

  assert.equal(score.lexical, 0.96);
  assert.equal(score.score, 0.9);
});

test("merges node payloads like Python merge_node_payload", () => {
  assert.deepEqual(
    mergeNodePayload(
      {
        id: "concept:auto-water",
        name: "Water",
        kind: "concept",
        subkind: null,
        definition: "Existing definition",
        aliases: ["H2O"],
        domains: ["chemistry"],
        knowledge_form: ["propositional"],
        learning_mode: [],
        scope: "",
        properties: { old: "yes" },
        external_ids: { wikidata: "Q1" },
        tags: ["liquid"],
        embedding: [1, 0],
        created_at: "old-time",
        notes: "old note",
      },
      {
        name: "水",
        subkind: "substance",
        definition: "New definition",
        aliases: ["H2O", "water"],
        domains: ["chemistry", "biology"],
        knowledge_form: ["propositional"],
        learning_mode: ["conceptual"],
        scope: "domain-specific",
        properties: { semantic_key: "chem:water" },
        external_ids: { other: "x" },
        tags: ["liquid", "molecule"],
        embedding: [0, 1],
        created_at: "new-time",
        updated_at: "updated-time",
        notes: "new note",
      },
    ),
    {
      id: "concept:auto-water",
      name: "水",
      kind: "concept",
      subkind: "substance",
      definition: "Existing definition\n\nNew definition",
      aliases: ["H2O", "water", "Water", "水"],
      domains: ["chemistry", "biology"],
      knowledge_form: ["propositional"],
      learning_mode: ["conceptual"],
      scope: "domain-specific",
      properties: { old: "yes", semantic_key: "chem:water", classifications: { subkinds: ["substance"] } },
      external_ids: { wikidata: "Q1", other: "x" },
      tags: ["liquid", "molecule"],
      embedding: [1, 0],
      status: "active",
      created_at: "old-time",
      updated_at: "updated-time",
      notes: "old note\n\nnew note",
    },
  );
});

test("plans staged node merge when an existing canonical node matches", () => {
  const candidate = makeCanonicalCandidate({
    id: "concept:auto-water",
    name: "Water Cycle",
    kind: "concept",
    subkind: "science",
    definition: "Existing definition",
    aliases_json: ["水循环"],
    domains_json: ["chemistry"],
    knowledge_form_json: ["propositional"],
    learning_mode_json: [],
    scope: "domain-specific",
    properties_json: { semantic_key: "chem:water-cycle", old: true },
    external_ids_json: {},
    tags_json: ["existing"],
    embedding: [1, 0],
    created_at: "existing-created",
    notes: "existing note",
  });

  const plan = planStagedNodeMerge({
    datasetId: "main",
    mergeRunId: "merge:1",
    lessonRunId: "lesson-run:1",
    staged: {
      raw_node_id: "raw-water-cycle",
      name: "水循环",
      kind: "concept",
      subkind: "science",
      definition: "New definition",
      aliases_json: ["Water cycle"],
      domains_json: ["chemistry", "geography"],
      knowledge_form_json: ["propositional"],
      learning_mode_json: ["conceptual"],
      scope: "",
      properties_json: { semantic_key: "chem:water-cycle", new: true },
      external_ids_json: { local: "x" },
      tags_json: ["new"],
      semantic_key: "chem:water-cycle",
      embedding: [1, 0],
      created_at: "staged-created",
      notes: "staged note",
    },
    canonicalNodes: [candidate],
    now: "now",
  });

  assert.equal(plan.raw_node_id, "raw-water-cycle");
  assert.equal(plan.canonical_node_id, "concept:auto-water");
  assert.equal(plan.resolution, "matched");
  assert.equal(plan.score.score, 1);
  assert.deepEqual(plan.node_map_entry, { "raw-water-cycle": "concept:auto-water" });
  assert.deepEqual(plan.stats_delta, { nodes_created: 0, nodes_matched: 1, nodes_review: 0 });
  assert.equal(plan.canonical_candidate_to_append, null);
  assert.deepEqual(plan.canonical_node_map_payload, {
    dataset_id: "main",
    merge_run_id: "merge:1",
    lesson_run_id: "lesson-run:1",
    raw_node_id: "raw-water-cycle",
    canonical_node_id: "concept:auto-water",
    resolution: "matched",
    similarity: 1,
      rationale_json: {
        lexical: 1,
        semantic_key: 1,
        embedding: 1,
        embedding_threshold: 0.92,
        candidate_id: "concept:auto-water",
        subkind_match: true,
        candidate_subkind: "science",
        staged_subkind: "science",
      },
    created_at: "now",
  });
  assert.deepEqual(plan.node_payload, {
    id: "concept:auto-water",
    name: "水循环",
    kind: "concept",
    subkind: "science",
    definition: "Existing definition\n\nNew definition",
    aliases: ["水循环", "Water cycle", "Water Cycle"],
    domains: ["chemistry", "geography"],
    knowledge_form: ["propositional"],
    learning_mode: ["conceptual"],
    scope: "domain-specific",
    properties: { semantic_key: "chem:water-cycle", old: true, classifications: { subkinds: ["science"] }, new: true },
    external_ids: { local: "x" },
    tags: ["existing", "new"],
    embedding: [1, 0],
    status: "active",
    created_at: "existing-created",
    updated_at: "now",
    notes: "existing note\n\nstaged note",
  });
});

test("plans staged node creation when no canonical node matches", () => {
  const plan = planStagedNodeMerge({
    datasetId: "main",
    mergeRunId: "merge:1",
    lessonRunId: "lesson-run:1",
    staged: {
      raw_node_id: "raw-water-cycle",
      name: "Water Cycle",
      kind: "concept",
      subkind: null,
      definition: "Water moves through Earth systems.",
      aliases_json: ["水循环"],
      domains_json: ["earth-science"],
      knowledge_form_json: ["propositional"],
      learning_mode_json: ["conceptual"],
      scope: "domain-specific",
      properties_json: {},
      external_ids_json: {},
      tags_json: [],
      semantic_key: null,
      embedding: [0, 1],
      created_at: "created",
      notes: null,
    },
    canonicalNodes: [],
    now: "now",
  });

  assert.equal(plan.canonical_node_id, "concept:auto-2a88a042df94");
  assert.equal(plan.resolution, "created");
  assert.deepEqual(plan.stats_delta, { nodes_created: 1, nodes_matched: 0, nodes_review: 0 });
  assert.deepEqual(plan.node_map_entry, { "raw-water-cycle": "concept:auto-2a88a042df94" });
  assert.deepEqual(plan.node_payload, {
    id: "concept:auto-2a88a042df94",
    name: "Water Cycle",
    kind: "concept",
    subkind: null,
    definition: "Water moves through Earth systems.",
    aliases: ["水循环"],
    domains: ["earth-science"],
    knowledge_form: ["propositional"],
    learning_mode: ["conceptual"],
    scope: "domain-specific",
    properties: {},
    external_ids: {},
    tags: [],
    semantic_key: null,
    embedding: [0, 1],
    status: "active",
    created_at: "created",
    updated_at: "now",
    notes: "",
  });
  assert.deepEqual(plan.canonical_candidate_to_append, {
    payload: {
      id: "concept:auto-2a88a042df94",
      name: "Water Cycle",
      kind: "concept",
      subkind: null,
      definition: "Water moves through Earth systems.",
      aliases_json: ["水循环"],
      domains_json: ["earth-science"],
      knowledge_form_json: ["propositional"],
      learning_mode_json: ["conceptual"],
      scope: "domain-specific",
      properties_json: {},
      external_ids_json: {},
      tags_json: [],
      embedding: [0, 1],
      created_at: "created",
      notes: "",
    },
    terms: new Set(["water cycle", "水循环"]),
    semantic_key: null,
    embedding: [0, 1],
  });
});

test("plans staged node review when best score is below merge threshold", () => {
  const candidate = makeCanonicalCandidate({
    id: "concept:auto-water-cycle",
    name: "Water Cycle",
    kind: "concept",
    aliases_json: [],
    properties_json: {},
    embedding: [],
  });

  const plan = planStagedNodeMerge({
    datasetId: "main",
    mergeRunId: "merge:1",
    lessonRunId: "lesson-run:1",
    staged: {
      raw_node_id: "raw-water",
      name: "Water",
      kind: "concept",
      aliases_json: [],
      domains_json: [],
      knowledge_form_json: [],
      learning_mode_json: [],
      properties_json: {},
      external_ids_json: {},
      tags_json: [],
      created_at: "created",
    },
    canonicalNodes: [candidate],
    similarityThreshold: 0.88,
    reviewThreshold: 0.4,
    now: "now",
  });

  assert.equal(plan.resolution, "review");
  assert.equal(plan.score.lexical, 0.96);
  assert.equal(plan.score.score, 0.432);
  assert.deepEqual(plan.stats_delta, { nodes_created: 1, nodes_matched: 0, nodes_review: 1 });
  assert.equal(plan.canonical_node_map_payload.resolution, "review");
  assert.equal(plan.canonical_node_map_payload.similarity, 0.432);
});

test("plans staged node creation when kind mismatches block matching", () => {
  const entityCandidate = makeCanonicalCandidate({
    id: "entity:auto-water-cycle",
    name: "Water Cycle",
    kind: "entity",
    aliases_json: [],
    properties_json: {},
    embedding: [],
  });

  const plan = planStagedNodeMerge({
    datasetId: "main",
    mergeRunId: "merge:1",
    lessonRunId: "lesson-run:1",
    staged: {
      raw_node_id: "raw-water-cycle",
      name: "Water Cycle",
      kind: "concept",
      subkind: "science",
      aliases_json: [],
      domains_json: [],
      knowledge_form_json: [],
      learning_mode_json: [],
      properties_json: {},
      external_ids_json: {},
      tags_json: [],
      created_at: "created",
    },
    canonicalNodes: [entityCandidate],
    reviewThreshold: 0,
    now: "now",
  });

  assert.equal(plan.resolution, "created");
  assert.equal(plan.score.score, 0);
  assert.deepEqual(plan.score.rationale, {});
});

test("plans staged node merge when exact names have different subkinds", () => {
  const candidate = makeCanonicalCandidate({
    id: "rule/circuit_law:auto-existing",
    name: "闭合电路欧姆定律",
    kind: "rule",
    subkind: "circuit_law",
    definition: "描述闭合电路中电源电动势、外电压、电流和内阻之间的关系。",
    aliases_json: ["全电路欧姆定律"],
    domains_json: ["physics"],
    knowledge_form_json: ["propositional"],
    learning_mode_json: ["conceptual"],
    scope: "domain-specific",
    properties_json: { semantic_key: "闭合电路欧姆定律" },
    external_ids_json: {},
    tags_json: [],
    embedding: [],
    created_at: "old",
    notes: "",
  });

  const plan = planStagedNodeMerge({
    datasetId: "main",
    mergeRunId: "merge:1",
    lessonRunId: "lesson-run:1",
    staged: {
      raw_node_id: "rule:physical_law:closed-circuit-ohm-law",
      name: "闭合电路欧姆定律",
      kind: "rule",
      subkind: "物理定律",
      definition: "在闭合电路中，电流与电源电动势成正比。",
      aliases_json: ["全电路欧姆定律"],
      domains_json: ["physics"],
      knowledge_form_json: ["propositional"],
      learning_mode_json: ["conceptual"],
      scope: "domain-specific",
      properties_json: {},
      external_ids_json: {},
      tags_json: [],
      semantic_key: "闭合电路欧姆定律",
      embedding: [],
      created_at: "new",
    },
    canonicalNodes: [candidate],
    now: "now",
  });

  assert.equal(plan.resolution, "matched");
  assert.equal(plan.canonical_node_id, "rule/circuit_law:auto-existing");
  assert.equal(plan.score.rationale.subkind_match, false);
  assert.equal(plan.node_payload.subkind, "circuit_law");
  assert.deepEqual(plan.node_payload.properties, {
    semantic_key: "闭合电路欧姆定律",
    classifications: {
      subkinds: ["circuit_law", "physical_law"],
      raw_subkinds: ["物理定律"],
    },
  });
});

test("remaps source refs like Python remap_source_refs", () => {
  assert.deepEqual(remapSourceRefs("raw-1", { "raw-1": "evidence:1" }), []);
  assert.deepEqual(remapSourceRefs([" raw-1 ", null, "", "raw-2", "raw-1", "evidence:3", 4], { "raw-1": "evidence:1", "raw-2": "evidence:2", "4": "evidence:4" }), [
    "evidence:1",
    "evidence:2",
    "evidence:3",
    "evidence:4",
  ]);
});

test("remaps node card sections like Python remap_card_sections", () => {
  assert.deepEqual(remapCardSections({}, { raw: "evidence:1" }), []);
  assert.deepEqual(
    remapCardSections(
      [
        { kind: "definition", text: "A", source_refs: ["raw", "kept"] },
        "skip",
        { kind: "example", source_refs: null },
      ],
      { raw: "evidence:1" },
    ),
    [
      { kind: "definition", text: "A", source_refs: ["evidence:1", "kept"] },
      { kind: "example", source_refs: [] },
    ],
  );
});

test("filters existing evidence ids while preserving input order", () => {
  assert.deepEqual(filterExistingEvidenceIds([], ["a"]), []);
  assert.deepEqual(filterExistingEvidenceIds(["b", "a", "b", "c"], ["a", "b"]), ["b", "a", "b"]);
});

test("plans evidence link replacement without executing SQL", () => {
  assert.deepEqual(
    planReplaceEvidenceLinks({
      datasetId: "main",
      ownerType: "edge",
      ownerId: "edge:1",
      evidenceIds: ["evidence:1", "evidence:2"],
    }),
    {
      inserted: 2,
      statements: [
        {
          sql: "DELETE FROM world_evidence_links WHERE dataset_id = %s AND owner_type = %s AND owner_id = %s",
          params: ["main", "edge", "edge:1"],
        },
        {
          sql:
            "INSERT INTO world_evidence_links (dataset_id, owner_type, owner_id, evidence_id, ordinal) VALUES (%s, %s, %s, %s, %s) " +
            "ON CONFLICT (dataset_id, owner_type, owner_id, evidence_id) DO UPDATE SET ordinal = EXCLUDED.ordinal",
          params: ["main", "edge", "edge:1", "evidence:1", 1],
        },
        {
          sql:
            "INSERT INTO world_evidence_links (dataset_id, owner_type, owner_id, evidence_id, ordinal) VALUES (%s, %s, %s, %s, %s) " +
            "ON CONFLICT (dataset_id, owner_type, owner_id, evidence_id) DO UPDATE SET ordinal = EXCLUDED.ordinal",
          params: ["main", "edge", "edge:1", "evidence:2", 2],
        },
      ],
    },
  );
});

test("plans new domain profile merge payload like Python", () => {
  const plan = planDomainProfileMerge({
    datasetId: "main",
    nodeId: "node:water",
    staged: {
      domain: "chemistry",
      school_stages_json: ["junior-secondary"],
      curriculum_roles_json: ["core"],
      source_refs_json: ["raw-1", "raw-missing"],
      properties_json: { grade: 8 },
      created_at: "created",
      notes: "",
    },
    evidenceIdByRaw: { "raw-1": "evidence:1", "raw-missing": "evidence:missing" },
    existingEvidenceIds: ["evidence:1"],
    now: "now",
  });

  assert.deepEqual(plan.payload, {
    dataset_id: "main",
    id: "domain-profile:auto-71459b98c396",
    node_id: "node:water",
    domain: "chemistry",
    school_stages_json: ["junior-secondary"],
    curriculum_roles_json: ["core"],
    source_refs_json: ["evidence:1"],
    properties_json: { grade: 8 },
    status: "active",
    created_at: "created",
    updated_at: "now",
    notes: "",
  });
  assert.equal(plan.evidence_links.inserted, 1);
  assert.deepEqual(plan.evidence_links.statements[1]?.params, ["main", "domain_profile", "domain-profile:auto-71459b98c396", "evidence:1", 1]);
});

test("plans existing domain profile merge like Python", () => {
  const plan = planDomainProfileMerge({
    datasetId: "main",
    nodeId: "node:water",
    staged: {
      domain: "chemistry",
      school_stages_json: ["junior-secondary", "senior-secondary"],
      curriculum_roles_json: ["practice"],
      source_refs_json: ["raw-2", "raw-1"],
      properties_json: { updated: true },
      created_at: "staged-created",
      notes: "new note",
    },
    existing: {
      school_stages_json: ["primary", "junior-secondary"],
      curriculum_roles_json: ["core"],
      source_refs_json: ["evidence:old", "evidence:1"],
      properties_json: { existing: true },
      created_at: "existing-created",
      notes: "old note",
    },
    evidenceIdByRaw: { "raw-1": "evidence:1", "raw-2": "evidence:2" },
    existingEvidenceIds: ["evidence:1", "evidence:2"],
    now: "now",
  });

  assert.deepEqual(plan.payload, {
    dataset_id: "main",
    id: "domain-profile:auto-71459b98c396",
    node_id: "node:water",
    domain: "chemistry",
    school_stages_json: ["primary", "junior-secondary", "senior-secondary"],
    curriculum_roles_json: ["core", "practice"],
    source_refs_json: ["evidence:1", "evidence:2"],
    properties_json: { existing: true, updated: true },
    status: "active",
    created_at: "existing-created",
    updated_at: "now",
    notes: "old note\n\nnew note",
  });
});

test("plans mention merge payload like Python", () => {
  const plan = planMentionMerge({
    datasetId: "main",
    lessonRunId: "lesson-run:1",
    staged: {
      raw_mention_id: "raw-mention:1",
      source_type: "textbook",
      source_id: "chem",
      anchor_ref: "struct:chem:chunk:1",
      target_type: "node",
      target_raw_id: "raw-node-water",
      role: "defines",
      source_refs_json: ["raw-1", "raw-2", "raw-1"],
      confidence: 0.8,
      properties_json: { sentence: 3 },
      created_at: "created",
    },
    nodeMap: { "raw-node-water": "concept:auto-water" },
    evidenceIdByRaw: { "raw-1": "evidence:1", "raw-2": "evidence:2" },
    now: "now",
  });

  assert.deepEqual(plan.payload, {
    dataset_id: "main",
    id: "mention:auto-b5dd8c361feb",
    source_type: "textbook",
    source_id: "chem",
    anchor_ref: "struct:chem:chunk:1",
    target_type: "node",
    target_id: "concept:auto-water",
    role: "defines",
    source_refs_json: ["evidence:1", "evidence:2"],
    confidence: 0.8,
    properties_json: { sentence: 3 },
    created_at: "created",
    updated_at: "now",
  });
  assert.equal(plan.evidence_links.inserted, 2);
  assert.deepEqual(plan.evidence_links.statements[1]?.params, ["main", "mention", "mention:auto-b5dd8c361feb", "evidence:1", 1]);
});

test("plans mention merge with raw target id when node map has no match", () => {
  const plan = planMentionMerge({
    datasetId: "main",
    lessonRunId: "lesson-run:1",
    staged: {
      raw_mention_id: "raw-mention:2",
      source_type: "textbook",
      source_id: "chem",
      anchor_ref: "struct:chem:chunk:1",
      target_type: "node",
      target_raw_id: "raw-node-missing",
      role: "mentions",
      source_refs_json: [],
      confidence: 0.6,
      properties_json: null,
      created_at: "created",
    },
    nodeMap: {},
    evidenceIdByRaw: {},
    now: "now",
  });

  assert.equal(plan.payload.id, "mention:auto-026fff4ae3cf");
  assert.equal(plan.payload.target_id, "raw-node-missing");
  assert.deepEqual(plan.payload.properties_json, {});
  assert.equal(plan.evidence_links.inserted, 0);
});

test("plans node card merge payload and section evidence links like Python", () => {
  const plan = planNodeCardMerge({
    datasetId: "main",
    staged: {
      raw_node_id: "raw-node-water",
      raw_card_id: "card:raw-water",
      title: "Water",
      summary: "Water summary",
      source_refs_json: ["raw-1", "raw-2"],
      sections_json: [
        { id: "definition", text: "Water is a substance.", source_refs: ["raw-1"] },
        { text: "No explicit id.", source_refs: ["raw-2", "raw-2"] },
        "skip",
      ],
      properties_json: { level: "basic" },
      created_at: "created",
    },
    nodeMap: { "raw-node-water": "concept:auto-water" },
    evidenceIdByRaw: { "raw-1": "evidence:1", "raw-2": "evidence:2" },
    now: "now",
  });

  assert.ok(plan);
  assert.deepEqual(plan.payload, {
    dataset_id: "main",
    node_id: "concept:auto-water",
    id: "card:raw-water",
    title: "Water",
    summary: "Water summary",
    source_refs_json: ["evidence:1", "evidence:2"],
    sections_json: [
      { id: "definition", text: "Water is a substance.", source_refs: ["evidence:1"] },
      { text: "No explicit id.", source_refs: ["evidence:2"] },
    ],
    properties_json: { level: "basic" },
    status: "active",
    created_at: "created",
    updated_at: "now",
  });
  assert.deepEqual(plan.evidence_links.statements[1]?.params, ["main", "node_card", "card:raw-water", "evidence:1", 1]);
  assert.deepEqual(
    plan.section_evidence_links.map((section) => ({
      section_id: section.section_id,
      owner_id: section.owner_id,
      inserted: section.evidence_links.inserted,
      first_insert: section.evidence_links.statements[1]?.params,
    })),
    [
      {
        section_id: "definition",
        owner_id: "card:raw-water:definition",
        inserted: 1,
        first_insert: ["main", "node_card_section", "card:raw-water:definition", "evidence:1", 1],
      },
      {
        section_id: "section-1",
        owner_id: "card:raw-water:section-1",
        inserted: 1,
        first_insert: ["main", "node_card_section", "card:raw-water:section-1", "evidence:2", 1],
      },
    ],
  );
});

test("plans node card merge skip when raw node has no canonical mapping", () => {
  assert.equal(
    planNodeCardMerge({
      datasetId: "main",
      staged: { raw_node_id: "raw-missing", raw_card_id: "card:missing" },
      nodeMap: {},
      evidenceIdByRaw: {},
      now: "now",
    }),
    null,
  );
});

test("plans edge merge payload like Python", () => {
  const plan = planEdgeMerge({
    datasetId: "main",
    staged: {
      from_raw_node_id: "raw-water",
      to_raw_node_id: "raw-state",
      type: "has_property",
      directionality: "directed",
      confidence: 0.85,
      source_refs_json: ["raw-1", "raw-2", "raw-1"],
      properties_json: { qualifier: "room temperature" },
      created_at: "created",
      notes: null,
    },
    nodeMap: {
      "raw-water": "concept:auto-water",
      "raw-state": "property:auto-state",
    },
    evidenceIdByRaw: { "raw-1": "evidence:1", "raw-2": "evidence:2" },
    now: "now",
  });

  assert.ok(plan);
  assert.deepEqual(plan.payload, {
    dataset_id: "main",
    id: "edge:auto-0add4376f2bc",
    type: "has_property",
    from_id: "concept:auto-water",
    to_id: "property:auto-state",
    directionality: "directed",
    confidence: 0.85,
    source_refs_json: ["evidence:1", "evidence:2"],
    properties_json: { qualifier: "room temperature" },
    status: "active",
    created_at: "created",
    updated_at: "now",
    notes: "",
  });
  assert.deepEqual(plan.evidence_links.statements[1]?.params, ["main", "edge", "edge:auto-0add4376f2bc", "evidence:1", 1]);
});

test("plans edge merge skip when either endpoint has no canonical mapping", () => {
  assert.equal(
    planEdgeMerge({
      datasetId: "main",
      staged: { from_raw_node_id: "raw-water", to_raw_node_id: "raw-missing", type: "has_property" },
      nodeMap: { "raw-water": "concept:auto-water" },
      evidenceIdByRaw: {},
      now: "now",
    }),
    null,
  );
});

test("plans evidence merge payload like Python", () => {
  const plan = planEvidenceMerge({
    datasetId: "main",
    lessonRunId: "lesson-run:1",
    staged: {
      raw_evidence_id: "raw-evidence:1",
      source_type: "textbook",
      source_id: "chem",
      anchor_ref: "struct:chem:chunk:1",
      source_path: "data/full.md",
      page_start: 1,
      page_end: 2,
      excerpt: "Water is a substance.",
      locator: "p1",
      modality: "text",
      extraction_method: "llm",
      normalized_claims_json: ["water is substance"],
      properties_json: { confidence_note: "explicit" },
      created_at: "created",
    },
    now: "now",
  });

  assert.deepEqual(plan, {
    raw_evidence_id: "raw-evidence:1",
    evidence_id: "evidence:auto-727dbee07898",
    payload: {
      dataset_id: "main",
      id: "evidence:auto-727dbee07898",
      source_type: "textbook",
      source_id: "chem",
      anchor_ref: "struct:chem:chunk:1",
      source_path: "data/full.md",
      page_start: 1,
      page_end: 2,
      excerpt: "Water is a substance.",
      locator: "p1",
      modality: "text",
      extraction_method: "llm",
      normalized_claims_json: ["water is substance"],
      properties_json: { confidence_note: "explicit" },
      created_at: "created",
      updated_at: "now",
    },
  });
});

test("plans evidence merge defaults for empty JSON fields like Python", () => {
  const plan = planEvidenceMerge({
    datasetId: "main",
    lessonRunId: "lesson-run:1",
    staged: {
      raw_evidence_id: "raw-evidence:1",
      anchor_ref: "struct:chem:chunk:1",
      excerpt: "Water is a substance.",
      normalized_claims_json: null,
      properties_json: null,
    },
    now: "now",
  });

  assert.deepEqual(plan.payload.normalized_claims_json, []);
  assert.deepEqual(plan.payload.properties_json, {});
});
