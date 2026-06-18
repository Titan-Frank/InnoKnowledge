#!/usr/bin/env python3
"""Normalize world knowledge graph in PostgreSQL."""

from __future__ import annotations

import argparse
import json
from collections import defaultdict
from typing import Any

from knowledge_store_common import (
    HIERARCHICAL_EDGE_TYPES,
    connect_db,
    ensure_pg_schema,
    make_domain_profile_id,
    merge_json_objects,
    merge_text_blocks,
    merge_unique_strings,
    rebuild_node_terms,
    utc_now,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Normalize world graph.")
    parser.add_argument("--dataset-id", required=True)
    parser.add_argument("--db")
    parser.add_argument("--auto-merge", action="store_true")
    return parser.parse_args()


def normalize_cards(connection, dataset_id: str) -> int:
    updated = 0
    with connection.cursor() as cur:
        cur.execute(
            "SELECT node_id, sections_json FROM world_node_cards WHERE dataset_id = %s",
            (dataset_id,),
        )
        rows = cur.fetchall()
    for row in rows:
        sections = row["sections_json"] if isinstance(row["sections_json"], list) else []
        modified = False
        for index, section in enumerate(sections):
            if not isinstance(section, dict):
                continue
            if not section.get("id"):
                section["id"] = f"section-{index}"
                modified = True
            if not section.get("title"):
                section["title"] = section["id"]
                modified = True
            if not section.get("section_type"):
                section["section_type"] = "other"
                modified = True
            content = section.get("content")
            if isinstance(content, list):
                cleaned = [str(item).strip() for item in content if str(item).strip()]
                if cleaned != content:
                    section["content"] = cleaned
                    modified = True
        if modified:
            with connection.cursor() as cur:
                cur.execute(
                    """
                    UPDATE world_node_cards
                    SET sections_json = %s::jsonb, updated_at = %s
                    WHERE dataset_id = %s AND node_id = %s
                    """,
                    (__import__("json").dumps(sections, ensure_ascii=False), utc_now(), dataset_id, row["node_id"]),
                )
            updated += 1
    return updated


def deduplicate_edges(connection, dataset_id: str) -> int:
    removed = 0
    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT from_id, to_id, type, array_agg(id ORDER BY created_at) AS ids
            FROM world_edges
            WHERE dataset_id = %s AND status != 'deprecated'
            GROUP BY from_id, to_id, type
            HAVING COUNT(*) > 1
            """,
            (dataset_id,),
        )
        rows = cur.fetchall()
    for row in rows:
        for edge_id in row["ids"][1:]:
            with connection.cursor() as cur:
                cur.execute(
                    """
                    UPDATE world_edges
                    SET status = 'deprecated', updated_at = %s
                    WHERE dataset_id = %s AND id = %s
                    """,
                    (utc_now(), dataset_id, edge_id),
                )
            removed += 1
    return removed


def replace_domain_profile_evidence_links(
    connection,
    dataset_id: str,
    profile_id: str,
    evidence_ids: list[str],
) -> None:
    with connection.cursor() as cur:
        cur.execute(
            """
            DELETE FROM world_evidence_links
            WHERE dataset_id = %s AND owner_type = 'domain_profile' AND owner_id = %s
            """,
            (dataset_id, profile_id),
        )
        for ordinal, evidence_id in enumerate(evidence_ids, start=1):
            cur.execute(
                """
                INSERT INTO world_evidence_links (
                  dataset_id, owner_type, owner_id, evidence_id, ordinal
                ) VALUES (%s, 'domain_profile', %s, %s, %s)
                ON CONFLICT (dataset_id, owner_type, owner_id, evidence_id)
                DO UPDATE SET ordinal = EXCLUDED.ordinal
                """,
                (dataset_id, profile_id, evidence_id, ordinal),
            )


def filter_existing_evidence_ids(connection, dataset_id: str, evidence_ids: list[str]) -> list[str]:
    if not evidence_ids:
        return []
    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT id
            FROM world_evidence
            WHERE dataset_id = %s AND id = ANY(%s)
            """,
            (dataset_id, evidence_ids),
        )
        existing = {row["id"] for row in cur.fetchall()}
    return [evidence_id for evidence_id in evidence_ids if evidence_id in existing]


def deduplicate_domain_profiles(connection, dataset_id: str) -> int:
    merged_count = 0
    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT *
            FROM world_domain_profiles
            WHERE dataset_id = %s AND status != 'deprecated'
            ORDER BY created_at, id
            """,
            (dataset_id,),
        )
        rows = cur.fetchall()

    grouped: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        grouped[(row["node_id"], row["domain"])].append(dict(row))

    for (node_id, domain), profiles in grouped.items():
        canonical_profile_id = make_domain_profile_id(node_id, domain)
        needs_merge = len(profiles) > 1 or any(row["id"] != canonical_profile_id for row in profiles)
        if not needs_merge:
            continue

        primary = next((row for row in profiles if row["id"] == canonical_profile_id), profiles[0])
        school_stages: list[str] = []
        curriculum_roles: list[str] = []
        source_refs: list[str] = []
        properties: dict[str, Any] = {}
        notes = ""
        created_at = primary["created_at"]
        for row in profiles:
            school_stages = merge_unique_strings(school_stages, row.get("school_stages_json") or [])
            curriculum_roles = merge_unique_strings(curriculum_roles, row.get("curriculum_roles_json") or [])
            source_refs = merge_unique_strings(source_refs, row.get("source_refs_json") or [])
            properties = merge_json_objects(properties, row.get("properties_json") or {})
            notes = merge_text_blocks(notes, row.get("notes") or "")
            if str(row["created_at"]) < str(created_at):
                created_at = row["created_at"]
        source_refs = filter_existing_evidence_ids(connection, dataset_id, source_refs)

        now = utc_now()
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
                  status = 'active',
                  updated_at = EXCLUDED.updated_at,
                  notes = EXCLUDED.notes
                """,
                (
                    dataset_id,
                    canonical_profile_id,
                    node_id,
                    domain,
                    json.dumps(school_stages, ensure_ascii=False),
                    json.dumps(curriculum_roles, ensure_ascii=False),
                    json.dumps(source_refs, ensure_ascii=False),
                    json.dumps(properties, ensure_ascii=False),
                    created_at,
                    now,
                    notes,
                ),
            )
            duplicate_ids = [row["id"] for row in profiles if row["id"] != canonical_profile_id]
            if duplicate_ids:
                cur.execute(
                    """
                    UPDATE world_mentions
                    SET target_id = %s, updated_at = %s
                    WHERE dataset_id = %s
                      AND target_type = 'domain_profile'
                      AND target_id = ANY(%s)
                    """,
                    (canonical_profile_id, now, dataset_id, duplicate_ids),
                )
                cur.execute(
                    """
                    DELETE FROM world_evidence_links
                    WHERE dataset_id = %s
                      AND owner_type = 'domain_profile'
                      AND owner_id = ANY(%s)
                    """,
                    (dataset_id, duplicate_ids),
                )
                cur.execute(
                    """
                    DELETE FROM world_domain_profiles
                    WHERE dataset_id = %s AND id = ANY(%s)
                    """,
                    (dataset_id, duplicate_ids),
                )
        replace_domain_profile_evidence_links(connection, dataset_id, canonical_profile_id, source_refs)
        merged_count += max(1, len(profiles) - 1)

    return merged_count


def find_cycles(connection, dataset_id: str) -> list[list[str]]:
    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT from_id, to_id, type
            FROM world_edges
            WHERE dataset_id = %s AND type = ANY(%s) AND status != 'deprecated'
            """,
            (dataset_id, list(HIERARCHICAL_EDGE_TYPES)),
        )
        rows = cur.fetchall()
    graph = defaultdict(list)
    for row in rows:
        graph[row["from_id"]].append(row["to_id"])
    visited: set[str] = set()
    stack: set[str] = set()
    path: list[str] = []
    cycles: list[list[str]] = []

    def dfs(node: str) -> None:
        visited.add(node)
        stack.add(node)
        path.append(node)
        for neighbor in graph.get(node, []):
            if neighbor not in visited:
                dfs(neighbor)
            elif neighbor in stack:
                start = path.index(neighbor)
                cycles.append(path[start:] + [neighbor])
        path.pop()
        stack.discard(node)

    for node in list(graph):
        if node not in visited:
            dfs(node)
    return cycles


def main() -> int:
    args = parse_args()
    connection = connect_db(args.db)
    ensure_pg_schema(connection)
    cards_updated = normalize_cards(connection, args.dataset_id)
    profiles_deduplicated = deduplicate_domain_profiles(connection, args.dataset_id)
    edges_removed = deduplicate_edges(connection, args.dataset_id)
    cycles = find_cycles(connection, args.dataset_id)
    rebuild_node_terms(connection, args.dataset_id)
    connection.commit()
    print(
        __import__("json").dumps(
            {
                "status": "success",
                "cards_updated": cards_updated,
                "domain_profiles_deduplicated": profiles_deduplicated,
                "edges_deduplicated": edges_removed,
                "cycle_count": len(cycles),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
