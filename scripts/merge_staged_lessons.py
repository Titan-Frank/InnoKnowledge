#!/usr/bin/env python3
"""Merge world_staging_* lesson artifacts into canonical world_* tables."""

from __future__ import annotations

import argparse
import json
import os
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Any

from psycopg.rows import dict_row

from knowledge_store_common import (
    connect_db,
    cosine_similarity,
    ensure_dataset,
    ensure_pg_schema,
    make_canonical_node_id,
    make_edge_id,
    make_evidence_id,
    make_lesson_run_id,
    make_merge_run_id,
    make_mention_id,
    merge_json_objects,
    merge_text_blocks,
    merge_unique_strings,
    normalize_term,
    rebuild_node_terms,
    resolve_dataset_id,
    utc_now,
)


@dataclass
class CanonicalNode:
    payload: dict[str, Any]
    terms: set[str]
    semantic_key: str | None
    embedding: list[float]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Merge world staging lesson artifacts.")
    parser.add_argument("--root", required=True)
    parser.add_argument("--db", default=os.environ.get("DATABASE_URL"))
    parser.add_argument("--dataset-id")
    parser.add_argument("--book-id")
    parser.add_argument("--batch-anchor", action="append", dest="batch_anchors")
    parser.add_argument("--lesson-run-id", action="append", dest="lesson_run_ids")
    parser.add_argument("--similarity-threshold", type=float, default=0.9)
    parser.add_argument("--embedding-threshold", type=float, default=0.92)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def parse_embedding(value: Any) -> list[float]:
    if isinstance(value, list):
        try:
            return [float(item) for item in value]
        except (TypeError, ValueError):
            return []
    return []


def normalized_terms(payload: dict[str, Any]) -> set[str]:
    aliases = payload.get("aliases_json", [])
    terms = {normalize_term(payload.get("name", ""))}
    terms.update(normalize_term(alias) for alias in aliases if isinstance(alias, str))
    return {term for term in terms if term}


def lexical_similarity(left_terms: set[str], right_terms: set[str]) -> float:
    if not left_terms or not right_terms:
        return 0.0
    best = 0.0
    for left in left_terms:
        for right in right_terms:
            if left == right:
                return 1.0
            if left in right or right in left:
                best = max(best, 0.96)
            best = max(best, SequenceMatcher(a=left, b=right).ratio())
    return best


def score_node_match(staged: dict[str, Any], candidate: CanonicalNode) -> float:
    payload = candidate.payload
    if payload["kind"] != staged["kind"]:
        return 0.0
    if payload.get("subkind") and staged.get("subkind") and payload["subkind"] != staged["subkind"]:
        return 0.0
    lexical = lexical_similarity(normalized_terms(staged), candidate.terms)
    semantic = 1.0 if staged.get("semantic_key") and staged.get("semantic_key") == candidate.semantic_key else 0.0
    embedding = 0.0
    if staged.get("embedding") and candidate.embedding:
        embedding = cosine_similarity(staged["embedding"], candidate.embedding)
    return min(max(lexical, semantic, embedding), 1.0)


def load_lesson_runs(connection, dataset_id: str, args: argparse.Namespace) -> list[dict[str, Any]]:
    clauses = ["dataset_id = %s", "status IN ('staged', 'merging')"]
    params: list[Any] = [dataset_id]
    if args.book_id:
        clauses.append("book_id = %s")
        params.append(args.book_id)
    if args.lesson_run_ids:
        clauses.append("lesson_run_id = ANY(%s)")
        params.append(args.lesson_run_ids)
    if args.batch_anchors:
        clauses.append("batch_anchor = ANY(%s)")
        params.append(args.batch_anchors)
    with connection.cursor(row_factory=dict_row) as cur:
        cur.execute(
            f"SELECT * FROM world_lesson_runs WHERE {' AND '.join(clauses)} ORDER BY created_at, lesson_run_id",
            params,
        )
        return cur.fetchall()


def load_canonical_nodes(connection, dataset_id: str) -> list[CanonicalNode]:
    with connection.cursor(row_factory=dict_row) as cur:
        cur.execute(
            """
            SELECT *
            FROM world_nodes
            WHERE dataset_id = %s AND status != 'deprecated'
            ORDER BY id
            """,
            (dataset_id,),
        )
        rows = cur.fetchall()
    result = []
    for row in rows:
        result.append(
            CanonicalNode(
                payload=dict(row),
                terms=normalized_terms(row),
                semantic_key=row.get("properties_json", {}).get("semantic_key"),
                embedding=parse_embedding(row.get("embedding")),
            )
        )
    return result


def fetch_staged_rows(connection, table: str, dataset_id: str, lesson_run_id: str) -> list[dict[str, Any]]:
    with connection.cursor(row_factory=dict_row) as cur:
        cur.execute(
            f"SELECT * FROM {table} WHERE dataset_id = %s AND lesson_run_id = %s ORDER BY created_at",
            (dataset_id, lesson_run_id),
        )
        return cur.fetchall()


def upsert_node(connection, dataset_id: str, payload: dict[str, Any]) -> None:
    with connection.cursor() as cur:
        cur.execute(
            """
            INSERT INTO world_nodes (
              dataset_id, id, name, kind, subkind, definition, aliases_json, domains_json,
              knowledge_form_json, learning_mode_json, scope, properties_json,
              external_ids_json, tags_json, embedding, status, deprecated_by,
              created_at, updated_at, notes
            ) VALUES (
              %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb, %s::jsonb,
              %s, %s::jsonb, %s::jsonb, %s::jsonb, %s, %s, NULL, %s, %s, %s
            )
            ON CONFLICT (dataset_id, id) DO UPDATE SET
              name = EXCLUDED.name,
              definition = EXCLUDED.definition,
              aliases_json = EXCLUDED.aliases_json,
              domains_json = EXCLUDED.domains_json,
              knowledge_form_json = EXCLUDED.knowledge_form_json,
              learning_mode_json = EXCLUDED.learning_mode_json,
              scope = EXCLUDED.scope,
              properties_json = EXCLUDED.properties_json,
              external_ids_json = EXCLUDED.external_ids_json,
              tags_json = EXCLUDED.tags_json,
              embedding = COALESCE(EXCLUDED.embedding, world_nodes.embedding),
              status = EXCLUDED.status,
              updated_at = EXCLUDED.updated_at,
              notes = EXCLUDED.notes
            """,
            (
                dataset_id,
                payload["id"],
                payload["name"],
                payload["kind"],
                payload.get("subkind"),
                payload["definition"],
                json.dumps(payload.get("aliases", []), ensure_ascii=False),
                json.dumps(payload.get("domains", []), ensure_ascii=False),
                json.dumps(payload.get("knowledge_form", []), ensure_ascii=False),
                json.dumps(payload.get("learning_mode", []), ensure_ascii=False),
                payload.get("scope"),
                json.dumps(payload.get("properties", {}), ensure_ascii=False),
                json.dumps(payload.get("external_ids", {}), ensure_ascii=False),
                json.dumps(payload.get("tags", []), ensure_ascii=False),
                payload.get("embedding"),
                payload.get("status", "active"),
                payload["created_at"],
                payload["updated_at"],
                payload.get("notes", ""),
            ),
        )


def merge_node_payload(existing: dict[str, Any], staged: dict[str, Any]) -> dict[str, Any]:
    properties = merge_json_objects(existing.get("properties", {}), staged.get("properties", {}))
    if staged.get("semantic_key"):
        properties["semantic_key"] = staged["semantic_key"]
    return {
        "id": existing["id"],
        "name": existing["name"] if len(existing["name"]) <= len(staged["name"]) else staged["name"],
        "kind": existing["kind"],
        "subkind": existing.get("subkind") or staged.get("subkind"),
        "definition": merge_text_blocks(existing.get("definition", ""), staged.get("definition", "")),
        "aliases": merge_unique_strings(existing.get("aliases", []), staged.get("aliases", []), [existing.get("name", ""), staged.get("name", "")]),
        "domains": merge_unique_strings(existing.get("domains", []), staged.get("domains", [])),
        "knowledge_form": merge_unique_strings(existing.get("knowledge_form", []), staged.get("knowledge_form", [])),
        "learning_mode": merge_unique_strings(existing.get("learning_mode", []), staged.get("learning_mode", [])),
        "scope": existing.get("scope") or staged.get("scope") or "domain-specific",
        "properties": properties,
        "external_ids": merge_json_objects(existing.get("external_ids", {}), staged.get("external_ids", {})),
        "tags": merge_unique_strings(existing.get("tags", []), staged.get("tags", [])),
        "embedding": existing.get("embedding") or staged.get("embedding"),
        "status": "active",
        "created_at": existing.get("created_at") or staged["created_at"],
        "updated_at": staged["updated_at"],
        "notes": merge_text_blocks(existing.get("notes", ""), staged.get("notes", "")),
    }


def load_existing_by_id(connection, dataset_id: str, table: str, item_id: str, key: str = "id") -> dict[str, Any] | None:
    with connection.cursor(row_factory=dict_row) as cur:
        cur.execute(
            f"SELECT * FROM {table} WHERE dataset_id = %s AND {key} = %s",
            (dataset_id, item_id),
        )
        row = cur.fetchone()
    return dict(row) if row else None


def main() -> int:
    args = parse_args()
    connection = connect_db(args.db)
    ensure_pg_schema(connection)
    dataset_id = resolve_dataset_id(connection, args.dataset_id, args.root)
    ensure_dataset(connection, dataset_id, args.root)

    lesson_runs = load_lesson_runs(connection, dataset_id, args)
    if not lesson_runs:
        print(json.dumps({"status": "success", "merged": 0, "issues": []}, ensure_ascii=False))
        return 0

    merge_run_id = make_merge_run_id(dataset_id, [row["lesson_run_id"] for row in lesson_runs])
    now = utc_now()
    with connection.cursor() as cur:
        cur.execute(
            """
            INSERT INTO world_merge_runs (
              dataset_id, merge_run_id, selection_json, stats_json, status, created_at, updated_at
            ) VALUES (%s, %s, %s::jsonb, '{}'::jsonb, 'in_progress', %s, %s)
            ON CONFLICT (dataset_id, merge_run_id) DO UPDATE SET
              selection_json = EXCLUDED.selection_json,
              status = 'in_progress',
              updated_at = EXCLUDED.updated_at
            """,
            (dataset_id, merge_run_id, json.dumps([row["lesson_run_id"] for row in lesson_runs], ensure_ascii=False), now, now),
        )

    canonical_nodes = load_canonical_nodes(connection, dataset_id)
    stats = {"nodes_created": 0, "nodes_matched": 0, "edges_upserted": 0, "domain_profiles_upserted": 0, "mentions_upserted": 0, "evidence_upserted": 0, "node_cards_upserted": 0}

    for lesson_run in lesson_runs:
        lesson_run_id = lesson_run["lesson_run_id"]
        with connection.cursor() as cur:
            cur.execute(
                "UPDATE world_lesson_runs SET status = 'merging', updated_at = %s WHERE dataset_id = %s AND lesson_run_id = %s",
                (utc_now(), dataset_id, lesson_run_id),
            )

        staged_nodes = fetch_staged_rows(connection, "world_staging_nodes", dataset_id, lesson_run_id)
        node_map: dict[str, str] = {}
        for row in staged_nodes:
            staged_payload = {
                "id": row["raw_node_id"],
                "name": row["name"],
                "kind": row["kind"],
                "subkind": row["subkind"],
                "definition": row["definition"],
                "aliases": row["aliases_json"] or [],
                "domains": row["domains_json"] or [],
                "knowledge_form": row["knowledge_form_json"] or [],
                "learning_mode": row["learning_mode_json"] or [],
                "scope": row["scope"],
                "properties": row["properties_json"] or {},
                "external_ids": row["external_ids_json"] or {},
                "tags": row["tags_json"] or [],
                "semantic_key": row["semantic_key"],
                "embedding": parse_embedding(row.get("embedding")),
                "status": "active",
                "created_at": row["created_at"],
                "updated_at": now,
                "notes": row.get("notes") or "",
            }

            best_match = None
            best_score = 0.0
            for candidate in canonical_nodes:
                score = score_node_match(
                    {
                        "kind": staged_payload["kind"],
                        "subkind": staged_payload["subkind"],
                        "name": staged_payload["name"],
                        "aliases": staged_payload["aliases"],
                        "semantic_key": staged_payload["semantic_key"],
                        "embedding": staged_payload["embedding"],
                    },
                    candidate,
                )
                if score > best_score:
                    best_score = score
                    best_match = candidate

            if best_match and best_score >= args.similarity_threshold:
                canonical_id = best_match.payload["id"]
                merged = merge_node_payload(
                    {
                        "id": best_match.payload["id"],
                        "name": best_match.payload["name"],
                        "kind": best_match.payload["kind"],
                        "subkind": best_match.payload.get("subkind"),
                        "definition": best_match.payload["definition"],
                        "aliases": best_match.payload.get("aliases_json", []),
                        "domains": best_match.payload.get("domains_json", []),
                        "knowledge_form": best_match.payload.get("knowledge_form_json", []),
                        "learning_mode": best_match.payload.get("learning_mode_json", []),
                        "scope": best_match.payload.get("scope"),
                        "properties": best_match.payload.get("properties_json", {}),
                        "external_ids": best_match.payload.get("external_ids_json", {}),
                        "tags": best_match.payload.get("tags_json", []),
                        "embedding": parse_embedding(best_match.payload.get("embedding")),
                        "created_at": best_match.payload.get("created_at", now),
                        "notes": best_match.payload.get("notes", ""),
                    },
                    staged_payload,
                )
                upsert_node(connection, dataset_id, merged)
                stats["nodes_matched"] += 1
                resolution = "matched"
            else:
                canonical_id = make_canonical_node_id(staged_payload["kind"], staged_payload["name"], staged_payload["subkind"])
                staged_payload["id"] = canonical_id
                upsert_node(connection, dataset_id, staged_payload)
                canonical_nodes.append(
                    CanonicalNode(
                        payload={
                            "id": canonical_id,
                            "name": staged_payload["name"],
                            "kind": staged_payload["kind"],
                            "subkind": staged_payload["subkind"],
                            "definition": staged_payload["definition"],
                            "aliases_json": staged_payload["aliases"],
                            "domains_json": staged_payload["domains"],
                            "knowledge_form_json": staged_payload["knowledge_form"],
                            "learning_mode_json": staged_payload["learning_mode"],
                            "scope": staged_payload["scope"],
                            "properties_json": staged_payload["properties"],
                            "external_ids_json": staged_payload["external_ids"],
                            "tags_json": staged_payload["tags"],
                            "embedding": staged_payload["embedding"],
                            "created_at": staged_payload["created_at"],
                            "notes": staged_payload["notes"],
                        },
                        terms=normalized_terms({"name": staged_payload["name"], "aliases_json": staged_payload["aliases"]}),
                        semantic_key=staged_payload["semantic_key"],
                        embedding=staged_payload["embedding"],
                    )
                )
                stats["nodes_created"] += 1
                resolution = "created"

            node_map[row["raw_node_id"]] = canonical_id
            with connection.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO world_canonical_node_map (
                      dataset_id, merge_run_id, lesson_run_id, raw_node_id,
                      canonical_node_id, resolution, similarity, rationale_json, created_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s)
                    ON CONFLICT (dataset_id, merge_run_id, lesson_run_id, raw_node_id)
                    DO UPDATE SET
                      canonical_node_id = EXCLUDED.canonical_node_id,
                      resolution = EXCLUDED.resolution,
                      similarity = EXCLUDED.similarity,
                      rationale_json = EXCLUDED.rationale_json
                    """,
                    (dataset_id, merge_run_id, lesson_run_id, row["raw_node_id"], canonical_id, resolution, best_score, json.dumps({}), now),
                )

        for row in fetch_staged_rows(connection, "world_staging_evidence", dataset_id, lesson_run_id):
            evidence_id = make_evidence_id(lesson_run_id, row["raw_evidence_id"], row["anchor_ref"], row["excerpt"])
            with connection.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO world_evidence (
                      dataset_id, id, source_type, source_id, anchor_ref, source_path, page_start,
                      page_end, excerpt, locator, modality, extraction_method,
                      normalized_claims_json, properties_json, created_at, updated_at
                    ) VALUES (
                      %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                      %s::jsonb, %s::jsonb, %s, %s
                    )
                    ON CONFLICT (dataset_id, id) DO NOTHING
                    """,
                    (
                        dataset_id,
                        evidence_id,
                        row["source_type"],
                        row["source_id"],
                        row["anchor_ref"],
                        row["source_path"],
                        row["page_start"],
                        row["page_end"],
                        row["excerpt"],
                        row["locator"],
                        row["modality"],
                        row["extraction_method"],
                        json.dumps(row["normalized_claims_json"] or [], ensure_ascii=False),
                        json.dumps(row["properties_json"] or {}, ensure_ascii=False),
                        row["created_at"],
                        now,
                    ),
                )
            stats["evidence_upserted"] += 1

        for row in fetch_staged_rows(connection, "world_staging_edges", dataset_id, lesson_run_id):
            from_id = node_map.get(row["from_raw_node_id"])
            to_id = node_map.get(row["to_raw_node_id"])
            if not from_id or not to_id:
                continue
            edge_id = make_edge_id(from_id, row["type"], to_id)
            with connection.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO world_edges (
                      dataset_id, id, type, from_id, to_id, directionality, confidence,
                      source_refs_json, properties_json, status, created_at, updated_at, notes
                    ) VALUES (
                      %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, 'active', %s, %s, %s
                    )
                    ON CONFLICT (dataset_id, id) DO UPDATE SET
                      source_refs_json = EXCLUDED.source_refs_json,
                      properties_json = EXCLUDED.properties_json,
                      confidence = GREATEST(world_edges.confidence, EXCLUDED.confidence),
                      updated_at = EXCLUDED.updated_at,
                      notes = EXCLUDED.notes
                    """,
                    (
                        dataset_id,
                        edge_id,
                        row["type"],
                        from_id,
                        to_id,
                        row["directionality"],
                        row["confidence"],
                        json.dumps(row["source_refs_json"] or [], ensure_ascii=False),
                        json.dumps(row["properties_json"] or {}, ensure_ascii=False),
                        row["created_at"],
                        now,
                        row.get("notes") or "",
                    ),
                )
            stats["edges_upserted"] += 1

        for row in fetch_staged_rows(connection, "world_staging_domain_profiles", dataset_id, lesson_run_id):
            node_id = node_map.get(row["raw_node_id"])
            if not node_id:
                continue
            with connection.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO world_domain_profiles (
                      dataset_id, id, node_id, domain, school_stages_json, curriculum_roles_json,
                      source_refs_json, properties_json, status, created_at, updated_at, notes
                    ) VALUES (
                      %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb, %s::jsonb,
                      'active', %s, %s, %s
                    )
                    ON CONFLICT (dataset_id, id) DO UPDATE SET
                      school_stages_json = EXCLUDED.school_stages_json,
                      curriculum_roles_json = EXCLUDED.curriculum_roles_json,
                      source_refs_json = EXCLUDED.source_refs_json,
                      properties_json = EXCLUDED.properties_json,
                      updated_at = EXCLUDED.updated_at,
                      notes = EXCLUDED.notes
                    """,
                    (
                        dataset_id,
                        row["raw_profile_id"],
                        node_id,
                        row["domain"],
                        json.dumps(row["school_stages_json"] or [], ensure_ascii=False),
                        json.dumps(row["curriculum_roles_json"] or [], ensure_ascii=False),
                        json.dumps(row["source_refs_json"] or [], ensure_ascii=False),
                        json.dumps(row["properties_json"] or {}, ensure_ascii=False),
                        row["created_at"],
                        now,
                        row.get("notes") or "",
                    ),
                )
            stats["domain_profiles_upserted"] += 1

        for row in fetch_staged_rows(connection, "world_staging_mentions", dataset_id, lesson_run_id):
            target_id = node_map.get(row["target_raw_id"], row["target_raw_id"])
            mention_id = make_mention_id(lesson_run_id, row["raw_mention_id"], row["target_type"], target_id)
            with connection.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO world_mentions (
                      dataset_id, id, source_type, source_id, anchor_ref, target_type, target_id,
                      role, source_refs_json, confidence, properties_json, created_at, updated_at
                    ) VALUES (
                      %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s, %s::jsonb, %s, %s
                    )
                    ON CONFLICT (dataset_id, id) DO UPDATE SET
                      source_refs_json = EXCLUDED.source_refs_json,
                      confidence = EXCLUDED.confidence,
                      properties_json = EXCLUDED.properties_json,
                      updated_at = EXCLUDED.updated_at
                    """,
                    (
                        dataset_id,
                        mention_id,
                        row["source_type"],
                        row["source_id"],
                        row["anchor_ref"],
                        row["target_type"],
                        target_id,
                        row["role"],
                        json.dumps(row["source_refs_json"] or [], ensure_ascii=False),
                        row["confidence"],
                        json.dumps(row["properties_json"] or {}, ensure_ascii=False),
                        row["created_at"],
                        now,
                    ),
                )
            stats["mentions_upserted"] += 1

        for row in fetch_staged_rows(connection, "world_staging_node_cards", dataset_id, lesson_run_id):
            node_id = node_map.get(row["raw_node_id"])
            if not node_id:
                continue
            with connection.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO world_node_cards (
                      dataset_id, node_id, id, title, summary, source_refs_json,
                      sections_json, properties_json, status, created_at, updated_at
                    ) VALUES (
                      %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb, 'active', %s, %s
                    )
                    ON CONFLICT (dataset_id, node_id) DO UPDATE SET
                      title = EXCLUDED.title,
                      summary = EXCLUDED.summary,
                      source_refs_json = EXCLUDED.source_refs_json,
                      sections_json = EXCLUDED.sections_json,
                      properties_json = EXCLUDED.properties_json,
                      updated_at = EXCLUDED.updated_at
                    """,
                    (
                        dataset_id,
                        node_id,
                        row["raw_card_id"],
                        row["title"],
                        row["summary"],
                        json.dumps(row["source_refs_json"] or [], ensure_ascii=False),
                        json.dumps(row["sections_json"] or [], ensure_ascii=False),
                        json.dumps(row["properties_json"] or {}, ensure_ascii=False),
                        row["created_at"],
                        now,
                    ),
                )
            stats["node_cards_upserted"] += 1

        with connection.cursor() as cur:
            cur.execute(
                """
                UPDATE world_lesson_runs
                SET status = 'merged', updated_at = %s
                WHERE dataset_id = %s AND lesson_run_id = %s
                """,
                (utc_now(), dataset_id, lesson_run_id),
            )

    rebuild_node_terms(connection, dataset_id)
    with connection.cursor() as cur:
        cur.execute(
            """
            UPDATE world_merge_runs
            SET stats_json = %s::jsonb, status = 'completed', updated_at = %s
            WHERE dataset_id = %s AND merge_run_id = %s
            """,
            (json.dumps(stats, ensure_ascii=False), utc_now(), dataset_id, merge_run_id),
        )
    if not args.dry_run:
        connection.commit()
    else:
        connection.rollback()

    print(json.dumps({"status": "success", "merge_run_id": merge_run_id, "stats": stats}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
