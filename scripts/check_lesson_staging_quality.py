#!/usr/bin/env python3
"""Validate staged lesson artifacts before canonical merge."""

from __future__ import annotations

import argparse
import json
import os
from typing import Any

from psycopg.rows import dict_row

from knowledge_store_common import (
    VALID_EDGE_TYPES,
    VALID_NODE_KINDS,
    connect_db,
    ensure_pg_schema,
    resolve_dataset_id,
    utc_now,
)


REQUIRED_CARD_SECTIONS = {
    "definition",
    "essence",
    "key_points",
    "example",
    "application",
    "misconception",
}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Check staged lesson quality before reducer merge.")
    parser.add_argument("--root", required=True)
    parser.add_argument("--db", default=os.environ.get("DATABASE_URL"))
    parser.add_argument("--dataset-id")
    parser.add_argument("--book-id")
    parser.add_argument("--lesson-run-id", action="append", dest="lesson_run_ids")
    parser.add_argument("--batch-anchor", action="append", dest="batch_anchors")
    parser.add_argument("--warn-only", action="store_true")
    return parser.parse_args()


def fetch_lesson_runs(connection, dataset_id: str, args: argparse.Namespace) -> list[dict[str, Any]]:
    clauses = ["dataset_id = %s", "status = 'staged'"]
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
        return [dict(row) for row in cur.fetchall()]


def check_lesson(connection, dataset_id: str, lesson_run_id: str) -> dict[str, Any]:
    errors: list[str] = []
    warnings: list[str] = []

    with connection.cursor(row_factory=dict_row) as cur:
        cur.execute(
            "SELECT * FROM world_staging_nodes WHERE dataset_id = %s AND lesson_run_id = %s",
            (dataset_id, lesson_run_id),
        )
        nodes = [dict(row) for row in cur.fetchall()]
        cur.execute(
            "SELECT * FROM world_staging_edges WHERE dataset_id = %s AND lesson_run_id = %s",
            (dataset_id, lesson_run_id),
        )
        edges = [dict(row) for row in cur.fetchall()]
        cur.execute(
            "SELECT * FROM world_staging_domain_profiles WHERE dataset_id = %s AND lesson_run_id = %s",
            (dataset_id, lesson_run_id),
        )
        profiles = [dict(row) for row in cur.fetchall()]
        cur.execute(
            "SELECT * FROM world_staging_mentions WHERE dataset_id = %s AND lesson_run_id = %s",
            (dataset_id, lesson_run_id),
        )
        mentions = [dict(row) for row in cur.fetchall()]
        cur.execute(
            "SELECT * FROM world_staging_evidence WHERE dataset_id = %s AND lesson_run_id = %s",
            (dataset_id, lesson_run_id),
        )
        evidence = [dict(row) for row in cur.fetchall()]
        cur.execute(
            "SELECT * FROM world_staging_node_cards WHERE dataset_id = %s AND lesson_run_id = %s",
            (dataset_id, lesson_run_id),
        )
        cards = [dict(row) for row in cur.fetchall()]

    node_ids = {row["raw_node_id"] for row in nodes}
    evidence_ids = {row["raw_evidence_id"] for row in evidence}
    profile_node_ids = {row["raw_node_id"] for row in profiles}
    card_by_node = {row["raw_node_id"]: row for row in cards}
    mention_by_target = {}
    for mention in mentions:
        mention_by_target.setdefault(mention["target_raw_id"], []).append(mention)

    if not nodes:
        errors.append("Lesson produced no staged nodes.")
    if not evidence:
        errors.append("Lesson produced no staged evidence.")

    for node in nodes:
        node_id = node["raw_node_id"]
        if node["kind"] not in VALID_NODE_KINDS:
            errors.append(f"Node {node_id} has invalid kind {node['kind']}.")
        if not node.get("definition"):
            errors.append(f"Node {node_id} is missing definition.")
        if node_id not in profile_node_ids:
            errors.append(f"Node {node_id} is missing a domain profile.")
        if node_id not in card_by_node:
            errors.append(f"Node {node_id} is missing a node card.")
        if node_id not in mention_by_target:
            errors.append(f"Node {node_id} is missing a mention.")

        source_refs = node.get("source_refs_json") if isinstance(node.get("source_refs_json"), list) else []
        mention_refs = [
            ref
            for mention in mention_by_target.get(node_id, [])
            for ref in (mention.get("source_refs_json") or [])
        ]
        if not source_refs and not mention_refs:
            errors.append(f"Node {node_id} has no evidence-backed source reference.")

    for edge in edges:
        if edge["type"] not in VALID_EDGE_TYPES:
            errors.append(f"Edge {edge['raw_edge_id']} has invalid type {edge['type']}.")
        if edge["from_raw_node_id"] not in node_ids or edge["to_raw_node_id"] not in node_ids:
            errors.append(f"Edge {edge['raw_edge_id']} references missing node endpoint.")
        if not edge.get("source_refs_json"):
            errors.append(f"Edge {edge['raw_edge_id']} has no evidence source_refs.")

    for profile in profiles:
        if profile["raw_node_id"] not in node_ids:
            errors.append(f"Domain profile {profile['raw_profile_id']} references missing node.")
        if not profile.get("source_refs_json"):
            warnings.append(f"Domain profile {profile['raw_profile_id']} has no source_refs.")

    for mention in mentions:
        if mention["target_type"] == "node" and mention["target_raw_id"] not in node_ids:
            errors.append(f"Mention {mention['raw_mention_id']} references missing node.")
        for ref in mention.get("source_refs_json") or []:
            if ref not in evidence_ids:
                errors.append(f"Mention {mention['raw_mention_id']} references missing evidence {ref}.")

    for card in cards:
        if card["raw_node_id"] not in node_ids:
            errors.append(f"Node card {card['raw_card_id']} references missing node.")
        if not card.get("summary"):
            errors.append(f"Node card {card['raw_card_id']} is missing summary.")
        sections = card.get("sections_json") if isinstance(card.get("sections_json"), list) else []
        section_types = {section.get("section_type") for section in sections if isinstance(section, dict)}
        missing = sorted(REQUIRED_CARD_SECTIONS - section_types)
        if missing:
            errors.append(f"Node card {card['raw_card_id']} missing sections: {missing}.")
        for section in sections:
            if not isinstance(section, dict):
                continue
            if not section.get("source_refs"):
                errors.append(f"Node card {card['raw_card_id']} section {section.get('id')} has no evidence source_refs.")

    return {
        "lesson_run_id": lesson_run_id,
        "status": "blocked" if errors else "success",
        "errors": errors,
        "warnings": warnings,
        "counts": {
            "nodes": len(nodes),
            "edges": len(edges),
            "domain_profiles": len(profiles),
            "mentions": len(mentions),
            "evidence": len(evidence),
            "node_cards": len(cards),
        },
    }


def main() -> int:
    args = parse_args()
    connection = connect_db(args.db)
    ensure_pg_schema(connection)
    dataset_id = resolve_dataset_id(connection, args.dataset_id, args.root)
    lesson_runs = fetch_lesson_runs(connection, dataset_id, args)
    results = [check_lesson(connection, dataset_id, row["lesson_run_id"]) for row in lesson_runs]
    blocked = [row for row in results if row["status"] == "blocked"]

    if blocked and not args.warn_only:
        now = utc_now()
        with connection.cursor() as cur:
            for row in blocked:
                cur.execute(
                    """
                    UPDATE world_lesson_runs
                    SET status = 'blocked', properties_json = jsonb_set(
                      COALESCE(properties_json, '{}'::jsonb),
                      '{quality_issues}',
                      %s::jsonb,
                      true
                    ), updated_at = %s
                    WHERE dataset_id = %s AND lesson_run_id = %s
                    """,
                    (json.dumps(row["errors"], ensure_ascii=False), now, dataset_id, row["lesson_run_id"]),
                )
        connection.commit()
    else:
        connection.rollback()

    status = "blocked" if blocked and not args.warn_only else "success"
    print(
        json.dumps(
            {
                "status": status,
                "dataset_id": dataset_id,
                "checked": len(results),
                "blocked": len(blocked),
                "results": results,
            },
            ensure_ascii=False,
        )
    )
    return 2 if status == "blocked" else 0


if __name__ == "__main__":
    raise SystemExit(main())
