#!/usr/bin/env node

import { mergeJsonObjects, mergeTextBlocks, mergeUniqueStrings, utcNow } from "../shared/knowledge.js";
import { addNodeSubkindClassification, choosePrimarySubkind, isGenericSubkind, normalizeNodeSubkind } from "../shared/node-subkind.js";
import { makeNodeCardId } from "../shared/pathing.js";

type RawRecord = Record<string, unknown>;

type SqlClient = {
  unsafe: (sql: string, params?: any[]) => Promise<unknown> | unknown;
};

type NodeRow = {
  dataset_id: string;
  id: string;
  name: string;
  kind: string;
  subkind: string | null;
  definition: string;
  aliases_json: string[];
  domains_json: string[];
  knowledge_form_json: string[];
  learning_mode_json: string[];
  scope: string | null;
  properties_json: RawRecord;
  external_ids_json: RawRecord;
  tags_json: string[];
  embedding: unknown;
  status: string;
  created_at: string;
  updated_at: string;
  notes: string | null;
};

type NodeGroup = {
  normalized_name: string;
  kind: string;
  ids: string[];
};

type RepairResult = {
  dataset_id: string;
  dry_run: boolean;
  subkinds_normalized: number;
  duplicate_groups: number;
  nodes_deprecated: number;
  groups: Array<{
    name: string;
    kind: string;
    canonical_node_id: string;
    duplicate_node_ids: string[];
  }>;
};

async function main(argv: string[]): Promise<number> {
  try {
    const flags = parseFlags(argv);
    const output = await runDatabaseMode({
      dbUrl: required(flags, "db"),
      datasetId: required(flags, "dataset-id"),
      apply: flags.has("apply"),
      now: flags.get("now") ?? utcNow(),
    });
    process.stdout.write(`${JSON.stringify(output, null, flags.has("pretty") ? 2 : undefined)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`${(error as Error).message}\n`);
    return 1;
  }
}

async function runDatabaseMode(input: { dbUrl: string; datasetId: string; apply: boolean; now: string }): Promise<RepairResult> {
  const postgres = (await import("postgres")).default;
  const sql = postgres(input.dbUrl, { max: 1 });
  try {
    if (!input.apply) {
      const normalized = await planSubkindNormalization(sql, input.datasetId);
      const groups = await selectDuplicateGroups(sql, input.datasetId);
      const plannedGroups = [];
      for (const group of groups) {
        const nodes = await selectNodes(sql, input.datasetId, group.ids);
        const canonical = chooseCanonicalNode(nodes);
        plannedGroups.push({
          name: canonical.name,
          kind: canonical.kind,
          canonical_node_id: canonical.id,
          duplicate_node_ids: nodes.filter((node) => node.id !== canonical.id).map((node) => node.id),
        });
      }
      return {
        dataset_id: input.datasetId,
        dry_run: true,
        subkinds_normalized: normalized.length,
        duplicate_groups: groups.length,
        nodes_deprecated: plannedGroups.reduce((sum, group) => sum + group.duplicate_node_ids.length, 0),
        groups: plannedGroups,
      };
    }

    const result: RepairResult = {
      dataset_id: input.datasetId,
      dry_run: false,
      subkinds_normalized: 0,
      duplicate_groups: 0,
      nodes_deprecated: 0,
      groups: [],
    };

    await sql.begin(async (tx) => {
      result.subkinds_normalized = await normalizeStoredSubkinds(tx, input.datasetId, input.now);
      const groups = await selectDuplicateGroups(tx, input.datasetId);
      result.duplicate_groups = groups.length;
      for (const group of groups) {
        const nodes = await selectNodes(tx, input.datasetId, group.ids);
        const repaired = await repairDuplicateGroup(tx, input.datasetId, nodes, input.now);
        result.nodes_deprecated += repaired.duplicate_node_ids.length;
        result.groups.push(repaired);
      }
    });
    return result;
  } finally {
    await sql.end();
  }
}

async function normalizeStoredSubkinds(sql: SqlClient, datasetId: string, now: string): Promise<number> {
  const updates = await planSubkindNormalization(sql, datasetId);
  for (const update of updates) {
    await sql.unsafe(
      ["UPDATE world_nodes", "SET subkind = $1, properties_json = $2::jsonb, updated_at = $3", "WHERE dataset_id = $4 AND id = $5"].join("\n"),
      [update.subkind, update.properties_json, now, datasetId, update.id],
    );
  }
  return updates.length;
}

async function planSubkindNormalization(sql: SqlClient, datasetId: string): Promise<Array<{ id: string; subkind: string | null; properties_json: RawRecord }>> {
  const rows = await queryRows(
    sql,
    "SELECT id, kind, subkind, properties_json FROM world_nodes WHERE dataset_id = $1 AND status != 'deprecated' ORDER BY id",
    [datasetId],
  );
  const updates = [];
  for (const row of rows) {
    const normalized = normalizeNodeSubkind(stringValue(row.kind), row.subkind);
    const properties = addNodeSubkindClassification(recordValue(row.properties_json), normalized);
    if (row.subkind !== normalized.primary || JSON.stringify(row.properties_json ?? {}) !== JSON.stringify(properties)) {
      updates.push({ id: requiredString(row.id, "id"), subkind: normalized.primary, properties_json: properties });
    }
  }
  return updates;
}

async function selectDuplicateGroups(sql: SqlClient, datasetId: string): Promise<NodeGroup[]> {
  const rows = await queryRows(
    sql,
    [
      "SELECT lower(name) AS normalized_name, kind, array_agg(id ORDER BY created_at, id) AS ids",
      "FROM world_nodes",
      "WHERE dataset_id = $1 AND status = 'active'",
      "GROUP BY lower(name), kind",
      "HAVING count(*) > 1",
      "ORDER BY lower(name), kind",
    ].join("\n"),
    [datasetId],
  );
  return rows.map((row) => ({
    normalized_name: requiredString(row.normalized_name, "normalized_name"),
    kind: requiredString(row.kind, "kind"),
    ids: stringArray(row.ids),
  }));
}

async function selectNodes(sql: SqlClient, datasetId: string, ids: string[]): Promise<NodeRow[]> {
  const rows = await queryRows(sql, "SELECT * FROM world_nodes WHERE dataset_id = $1 AND id = ANY($2::text[]) ORDER BY created_at, id", [datasetId, ids]);
  return rows.map(toNodeRow);
}

async function repairDuplicateGroup(
  sql: SqlClient,
  datasetId: string,
  nodes: NodeRow[],
  now: string,
): Promise<{ name: string; kind: string; canonical_node_id: string; duplicate_node_ids: string[] }> {
  if (nodes.length < 2) throw new Error("repairDuplicateGroup requires at least two nodes.");
  const canonical = chooseCanonicalNode(nodes);
  const duplicateIds = nodes.filter((node) => node.id !== canonical.id).map((node) => node.id);
  const allIds = nodes.map((node) => node.id);
  const merged = mergeNodes(canonical, nodes, now);

  await upsertMergedNode(sql, datasetId, merged);
  await mergeNodeCards(sql, datasetId, canonical.id, allIds, now);
  await mergeNodeBodies(sql, datasetId, canonical.id, allIds, now);
  await sql.unsafe("DELETE FROM world_unit_embeddings WHERE dataset_id = $1 AND node_id = ANY($2::text[])", [datasetId, allIds]);
  await sql.unsafe("DELETE FROM retrieval_candidates WHERE dataset_id = $1 AND candidate_node_id = ANY($2::text[])", [datasetId, duplicateIds]);
  await sql.unsafe("DELETE FROM world_node_terms WHERE dataset_id = $1 AND node_id = ANY($2::text[])", [datasetId, allIds]);
  await sql.unsafe("UPDATE world_edges SET from_id = $1, updated_at = $2 WHERE dataset_id = $3 AND from_id = ANY($4::text[])", [canonical.id, now, datasetId, duplicateIds]);
  await sql.unsafe("UPDATE world_edges SET to_id = $1, updated_at = $2 WHERE dataset_id = $3 AND to_id = ANY($4::text[])", [canonical.id, now, datasetId, duplicateIds]);
  await sql.unsafe("UPDATE world_domain_profiles SET node_id = $1, updated_at = $2 WHERE dataset_id = $3 AND node_id = ANY($4::text[])", [canonical.id, now, datasetId, duplicateIds]);
  await sql.unsafe("UPDATE world_mentions SET target_id = $1, updated_at = $2 WHERE dataset_id = $3 AND target_type = 'node' AND target_id = ANY($4::text[])", [
    canonical.id,
    now,
    datasetId,
    duplicateIds,
  ]);
  await sql.unsafe("UPDATE world_canonical_node_map SET canonical_node_id = $1 WHERE dataset_id = $2 AND canonical_node_id = ANY($3::text[])", [canonical.id, datasetId, duplicateIds]);
  await sql.unsafe("UPDATE world_nodes SET status = 'deprecated', deprecated_by = $1, updated_at = $2 WHERE dataset_id = $3 AND id = ANY($4::text[])", [
    canonical.id,
    now,
    datasetId,
    duplicateIds,
  ]);

  return {
    name: canonical.name,
    kind: canonical.kind,
    canonical_node_id: canonical.id,
    duplicate_node_ids: duplicateIds,
  };
}

function mergeNodes(canonical: NodeRow, nodes: NodeRow[], now: string): NodeRow {
  let properties = {};
  let externalIds = {};
  for (const node of nodes) {
    const normalized = normalizeNodeSubkind(node.kind, node.subkind);
    properties = mergeJsonObjects(properties, addNodeSubkindClassification(node.properties_json, normalized));
    externalIds = mergeJsonObjects(externalIds, node.external_ids_json);
  }
  properties = {
    ...properties,
    merged_from: mergeUniqueStrings(arrayValue((properties as RawRecord).merged_from), nodes.filter((node) => node.id !== canonical.id).map((node) => node.id)),
  };

  return {
    ...canonical,
    subkind: chooseBestSubkind(nodes),
    definition: mergeTextBlocks(...nodes.map((node) => node.definition)),
    aliases_json: mergeUniqueStrings(...nodes.map((node) => node.aliases_json), nodes.map((node) => node.name).filter((name) => name !== canonical.name)),
    domains_json: mergeUniqueStrings(...nodes.map((node) => node.domains_json)),
    knowledge_form_json: mergeUniqueStrings(...nodes.map((node) => node.knowledge_form_json)),
    learning_mode_json: mergeUniqueStrings(...nodes.map((node) => node.learning_mode_json)),
    properties_json: properties,
    external_ids_json: externalIds,
    tags_json: mergeUniqueStrings(...nodes.map((node) => node.tags_json)),
    updated_at: now,
    notes: mergeTextBlocks(...nodes.map((node) => node.notes ?? "")),
  };
}

async function upsertMergedNode(sql: SqlClient, datasetId: string, node: NodeRow): Promise<void> {
  await sql.unsafe(
    [
      "UPDATE world_nodes",
      "SET name = $1, subkind = $2, definition = $3, aliases_json = $4::jsonb, domains_json = $5::jsonb,",
      "knowledge_form_json = $6::jsonb, learning_mode_json = $7::jsonb, scope = $8, properties_json = $9::jsonb,",
      "external_ids_json = $10::jsonb, tags_json = $11::jsonb, status = 'active', deprecated_by = NULL, updated_at = $12, notes = $13",
      "WHERE dataset_id = $14 AND id = $15",
    ].join("\n"),
    [
      node.name,
      node.subkind,
      node.definition,
      node.aliases_json,
      node.domains_json,
      node.knowledge_form_json,
      node.learning_mode_json,
      node.scope,
      node.properties_json,
      node.external_ids_json,
      node.tags_json,
      node.updated_at,
      node.notes,
      datasetId,
      node.id,
    ],
  );
}

async function mergeNodeCards(sql: SqlClient, datasetId: string, canonicalNodeId: string, nodeIds: string[], now: string): Promise<void> {
  const rows = await queryRows(sql, "SELECT * FROM world_node_cards WHERE dataset_id = $1 AND node_id = ANY($2::text[]) ORDER BY created_at, node_id", [datasetId, nodeIds]);
  if (rows.length === 0) return;
  const cards = rows.map(toCardRow);
  const canonicalCard = cards.find((card) => card.node_id === canonicalNodeId) ?? cards[0]!;
  const canonicalCardId = canonicalCard.id || makeNodeCardId(canonicalNodeId);
  const oldCardIds = cards.map((card) => card.id).filter((id) => id !== canonicalCardId);
  const sections = mergeCardSections(cards.flatMap((card) => card.sections_json));
  await sql.unsafe(
    [
      "INSERT INTO world_node_cards (dataset_id, node_id, id, title, summary, source_refs_json, sections_json, properties_json, status, created_at, updated_at)",
      "VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb, $8::jsonb, 'active', $9, $10)",
      "ON CONFLICT (dataset_id, node_id) DO UPDATE SET",
      "id = EXCLUDED.id, title = EXCLUDED.title, summary = EXCLUDED.summary, source_refs_json = EXCLUDED.source_refs_json,",
      "sections_json = EXCLUDED.sections_json, properties_json = EXCLUDED.properties_json, status = 'active', updated_at = EXCLUDED.updated_at",
    ].join("\n"),
    [
      datasetId,
      canonicalNodeId,
      canonicalCardId,
      canonicalCard.title,
      mergeTextBlocks(...cards.map((card) => card.summary)),
      mergeUniqueStrings(...cards.map((card) => card.source_refs_json)),
      sections,
      cards.reduce((merged, card) => mergeJsonObjects(merged, card.properties_json), {}),
      canonicalCard.created_at,
      now,
    ],
  );

  await remapNodeCardEvidenceLinks(sql, datasetId, canonicalCardId, cards, sections);
  if (oldCardIds.length > 0) {
    await sql.unsafe("DELETE FROM world_node_cards WHERE dataset_id = $1 AND node_id <> $2 AND id = ANY($3::text[])", [datasetId, canonicalNodeId, oldCardIds]);
  }
}

async function remapNodeCardEvidenceLinks(sql: SqlClient, datasetId: string, canonicalCardId: string, cards: CardRow[], sections: RawRecord[]): Promise<void> {
  const oldCardIds = cards.map((card) => card.id);
  const cardLinkRows = await queryRows(sql, "SELECT evidence_id FROM world_evidence_links WHERE dataset_id = $1 AND owner_type = 'node_card' AND owner_id = ANY($2::text[]) ORDER BY ordinal", [
    datasetId,
    oldCardIds,
  ]);
  const cardEvidenceIds = mergeUniqueStrings(cardLinkRows.map((row) => row.evidence_id), ...cards.map((card) => card.source_refs_json));
  await sql.unsafe("DELETE FROM world_evidence_links WHERE dataset_id = $1 AND owner_type = 'node_card' AND owner_id = ANY($2::text[])", [datasetId, oldCardIds]);
  for (const [index, evidenceId] of cardEvidenceIds.entries()) {
    await sql.unsafe(
      [
        "INSERT INTO world_evidence_links (dataset_id, owner_type, owner_id, evidence_id, ordinal)",
        "VALUES ($1, 'node_card', $2, $3, $4)",
        "ON CONFLICT (dataset_id, owner_type, owner_id, evidence_id) DO UPDATE SET ordinal = EXCLUDED.ordinal",
      ].join("\n"),
      [datasetId, canonicalCardId, evidenceId, index + 1],
    );
  }

  const oldSectionOwnerIds = oldCardIds.flatMap((cardId) => sections.map((section) => `${cardId}:${stringValue(section.id)}`));
  await sql.unsafe("DELETE FROM world_evidence_links WHERE dataset_id = $1 AND owner_type = 'node_card_section' AND owner_id = ANY($2::text[])", [datasetId, oldSectionOwnerIds]);
  for (const section of sections) {
    const sectionId = stringValue(section.id);
    const evidenceIds = stringArray(section.source_refs);
    const ownerId = `${canonicalCardId}:${sectionId}`;
    for (const [index, evidenceId] of evidenceIds.entries()) {
      await sql.unsafe(
        [
          "INSERT INTO world_evidence_links (dataset_id, owner_type, owner_id, evidence_id, ordinal)",
          "VALUES ($1, 'node_card_section', $2, $3, $4)",
          "ON CONFLICT (dataset_id, owner_type, owner_id, evidence_id) DO UPDATE SET ordinal = EXCLUDED.ordinal",
        ].join("\n"),
        [datasetId, ownerId, evidenceId, index + 1],
      );
    }
  }
}

async function mergeNodeBodies(sql: SqlClient, datasetId: string, canonicalNodeId: string, nodeIds: string[], now: string): Promise<void> {
  const rows = await queryRows(sql, "SELECT * FROM world_node_bodies WHERE dataset_id = $1 AND node_id = ANY($2::text[]) ORDER BY created_at, node_id", [datasetId, nodeIds]);
  if (rows.length === 0) return;
  const bodies = rows.map(toBodyRow);
  const canonicalBody = bodies.find((body) => body.node_id === canonicalNodeId) ?? bodies[0]!;
  await sql.unsafe(
    [
      "INSERT INTO world_node_bodies (dataset_id, node_id, format, content, media_refs_json, source_refs_json, generated_from, properties_json, status, created_at, updated_at)",
      "VALUES ($1, $2, 'markdown', $3, $4::jsonb, $5::jsonb, $6, $7::jsonb, 'active', $8, $9)",
      "ON CONFLICT (dataset_id, node_id) DO UPDATE SET",
      "content = EXCLUDED.content, media_refs_json = EXCLUDED.media_refs_json, source_refs_json = EXCLUDED.source_refs_json,",
      "generated_from = EXCLUDED.generated_from, properties_json = EXCLUDED.properties_json, status = 'active', updated_at = EXCLUDED.updated_at",
    ].join("\n"),
    [
      datasetId,
      canonicalNodeId,
      mergeTextBlocks(...bodies.map((body) => body.content)),
      mergeUniqueStrings(...bodies.map((body) => body.media_refs_json)),
      mergeUniqueStrings(...bodies.map((body) => body.source_refs_json)),
      chooseGeneratedFrom(bodies.map((body) => body.generated_from)),
      bodies.reduce((merged, body) => mergeJsonObjects(merged, body.properties_json), {}),
      canonicalBody.created_at,
      now,
    ],
  );
  await sql.unsafe("DELETE FROM world_node_bodies WHERE dataset_id = $1 AND node_id <> $2 AND node_id = ANY($3::text[])", [datasetId, canonicalNodeId, nodeIds]);
}

function chooseCanonicalNode(nodes: NodeRow[]): NodeRow {
  return [...nodes].sort((left, right) => canonicalScore(right) - canonicalScore(left) || left.created_at.localeCompare(right.created_at) || left.id.localeCompare(right.id))[0]!;
}

function canonicalScore(node: NodeRow): number {
  const subkind = normalizeNodeSubkind(node.kind, node.subkind).primary;
  let score = 0;
  if (subkind) score += 10;
  if (subkind && !isGenericSubkind(subkind)) score += 5;
  if (/^[a-z0-9/_:-]+$/.test(node.id)) score += 3;
  if (node.embedding) score += 1;
  return score;
}

function chooseBestSubkind(nodes: NodeRow[]): string | null {
  const canonical = chooseCanonicalNode(nodes);
  let selected = normalizeNodeSubkind(canonical.kind, canonical.subkind).primary;
  for (const node of nodes) {
    selected = choosePrimarySubkind(selected, node.subkind);
  }
  return selected;
}

type CardRow = {
  node_id: string;
  id: string;
  title: string;
  summary: string;
  source_refs_json: string[];
  sections_json: RawRecord[];
  properties_json: RawRecord;
  created_at: string;
};

function toCardRow(row: RawRecord): CardRow {
  return {
    node_id: requiredString(row.node_id, "node_id"),
    id: requiredString(row.id, "id"),
    title: requiredString(row.title, "title"),
    summary: stringValue(row.summary),
    source_refs_json: stringArray(row.source_refs_json),
    sections_json: arrayValue(row.sections_json).filter(isRecord),
    properties_json: recordValue(row.properties_json),
    created_at: requiredString(row.created_at, "created_at"),
  };
}

function mergeCardSections(sections: RawRecord[]): RawRecord[] {
  const byId = new Map<string, RawRecord>();
  for (const section of sections) {
    const id = stringValue(section.id) || `section-${byId.size + 1}`;
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, { ...section, id, source_refs: stringArray(section.source_refs), content: stringArray(section.content), properties: recordValue(section.properties) });
      continue;
    }
    byId.set(id, {
      ...existing,
      title: stringValue(existing.title) || stringValue(section.title),
      content: mergeUniqueStrings(stringArray(existing.content), stringArray(section.content)),
      source_refs: mergeUniqueStrings(stringArray(existing.source_refs), stringArray(section.source_refs)),
      properties: mergeJsonObjects(recordValue(existing.properties), recordValue(section.properties)),
    });
  }
  return [...byId.values()];
}

type BodyRow = {
  node_id: string;
  content: string;
  media_refs_json: string[];
  source_refs_json: string[];
  generated_from: string;
  properties_json: RawRecord;
  created_at: string;
};

function toBodyRow(row: RawRecord): BodyRow {
  return {
    node_id: requiredString(row.node_id, "node_id"),
    content: requiredString(row.content, "content"),
    media_refs_json: stringArray(row.media_refs_json),
    source_refs_json: stringArray(row.source_refs_json),
    generated_from: requiredString(row.generated_from, "generated_from"),
    properties_json: recordValue(row.properties_json),
    created_at: requiredString(row.created_at, "created_at"),
  };
}

function chooseGeneratedFrom(values: string[]): string {
  for (const preferred of ["manual", "model_generation", "card_expansion", "imported_unit"]) {
    if (values.includes(preferred)) return preferred;
  }
  return "model_generation";
}

function toNodeRow(row: RawRecord): NodeRow {
  return {
    dataset_id: requiredString(row.dataset_id, "dataset_id"),
    id: requiredString(row.id, "id"),
    name: requiredString(row.name, "name"),
    kind: requiredString(row.kind, "kind"),
    subkind: optionalString(row.subkind),
    definition: requiredString(row.definition, "definition"),
    aliases_json: stringArray(row.aliases_json),
    domains_json: stringArray(row.domains_json),
    knowledge_form_json: stringArray(row.knowledge_form_json),
    learning_mode_json: stringArray(row.learning_mode_json),
    scope: optionalString(row.scope),
    properties_json: recordValue(row.properties_json),
    external_ids_json: recordValue(row.external_ids_json),
    tags_json: stringArray(row.tags_json),
    embedding: row.embedding,
    status: requiredString(row.status, "status"),
    created_at: requiredString(row.created_at, "created_at"),
    updated_at: requiredString(row.updated_at, "updated_at"),
    notes: optionalString(row.notes),
  };
}

async function queryRows(sql: SqlClient, query: string, params: readonly unknown[]): Promise<RawRecord[]> {
  const rows = await sql.unsafe(query, [...params]);
  return Array.isArray(rows) ? rows.filter(isRecord) : [];
}

function parseFlags(argv: string[]): Map<string, string> {
  const flags = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 1) {
    const raw = argv[index]!;
    if (!raw.startsWith("--")) throw new Error(`Unexpected argument '${raw}'.`);
    const withoutPrefix = raw.slice(2);
    const equalsIndex = withoutPrefix.indexOf("=");
    if (equalsIndex >= 0) {
      flags.set(withoutPrefix.slice(0, equalsIndex), withoutPrefix.slice(equalsIndex + 1));
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith("--")) {
      flags.set(withoutPrefix, "true");
      continue;
    }
    flags.set(withoutPrefix, next);
    index += 1;
  }
  return flags;
}

function required(flags: Map<string, string>, name: string): string {
  const value = flags.get(name);
  if (value === undefined) throw new Error(`Missing required option --${name}.`);
  return value;
}

function requiredString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) throw new Error(`Missing required field '${name}'.`);
  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stringValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === null || value === undefined) return "";
  return String(value);
}

function stringArray(value: unknown): string[] {
  return arrayValue(value).filter((item): item is string => typeof item === "string" && item.length > 0);
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function recordValue(value: unknown): RawRecord {
  return isRecord(value) ? value : {};
}

function isRecord(value: unknown): value is RawRecord {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  raise(main(process.argv.slice(2)));
}

function raise(promise: Promise<number>): void {
  promise.then((code) => {
    process.exitCode = code;
  });
}
