#!/usr/bin/env python3
"""Store one lesson's extracted artifacts into explicit staging tables."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any

from knowledge_store_common import (
    DEFAULT_DB_PATH,
    canonicalize_source_anchor,
    connect_db,
    dump_json_text,
    ensure_dataset,
    ensure_sqlite_schema,
    load_json_text,
    make_lesson_run_id,
    normalize_textbook_source_id,
    resolve_dataset_id,
    resolve_outline_anchor,
    require_dataset_row,
    utc_now,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Store one lesson's extracted runtime artifacts into staging tables."
    )
    parser.add_argument("--root", required=True)
    parser.add_argument("--book-id", required=True)
    parser.add_argument("--batch-anchor", required=True)
    parser.add_argument("--lesson-run-id")
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH))
    parser.add_argument("--dataset-id")
    parser.add_argument("--nodes-json")
    parser.add_argument("--edges-json")
    parser.add_argument("--profiles-json")
    parser.add_argument("--mentions-json")
    parser.add_argument("--evidence-json")
    parser.add_argument("--node-cards-json")
    parser.add_argument("--append", action="store_true")
    return parser.parse_args()


def parse_json_array(raw: str | None, label: str) -> list[dict[str, Any]]:
    if not raw:
        return []
    payload = json.loads(raw)
    if not isinstance(payload, list):
        raise SystemExit(f"--{label}-json must be a JSON array.")
    return [item for item in payload if isinstance(item, dict)]


def normalize_nodes(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for index, record in enumerate(records, start=1):
        payload = dict(record)
        raw_node_id = str(payload.get("id") or payload.get("raw_node_id") or f"node-{index}")
        properties = dict(payload.get("properties") or {})
        semantic_key = payload.get("semantic_key") or properties.get("semantic_key")
        embedding = payload.get("embedding") or properties.get("embedding") or []
        normalized.append(
            {
                "raw_node_id": raw_node_id,
                "canonical_name": str(payload.get("canonical_name") or payload.get("name") or raw_node_id),
                "node_kind": str(payload.get("node_kind") or "concept"),
                "node_layer": str(payload.get("node_layer") or "backbone"),
                "node_subkind": payload.get("node_subkind"),
                "definition": str(payload.get("definition") or ""),
                "aliases_json": dump_json_text(payload.get("aliases", [])),
                "learning_modes_json": dump_json_text(payload.get("learning_modes", [])),
                "bridge_tags_json": dump_json_text(payload.get("bridge_tags", [])),
                "framework_refs_json": dump_json_text(payload.get("framework_refs", [])),
                "profile_refs_json": dump_json_text(payload.get("profile_refs", [])),
                "same_as_refs_json": dump_json_text(payload.get("same_as_refs", [])),
                "properties_json": dump_json_text(properties),
                "semantic_key": semantic_key,
                "embedding_json": dump_json_text(embedding),
                "source_refs_json": dump_json_text(payload.get("source_refs", [])),
                "status": str(payload.get("status") or "candidate"),
                "notes": payload.get("notes"),
            }
        )
    return normalized


def normalize_edges(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for index, record in enumerate(records, start=1):
        payload = dict(record)
        normalized.append(
            {
                "raw_edge_id": str(payload.get("id") or payload.get("raw_edge_id") or f"edge-{index}"),
                "edge_type": str(payload.get("edge_type") or "related_to"),
                "edge_layer": str(payload.get("edge_layer") or "backbone"),
                "backbone_expand": 1 if payload.get("backbone_expand") else 0,
                "from_raw_node_id": str(payload.get("from") or payload.get("from_raw_node_id") or ""),
                "to_raw_node_id": str(payload.get("to") or payload.get("to_raw_node_id") or ""),
                "directionality": str(payload.get("directionality") or "directed"),
                "confidence": float(payload.get("confidence") or 0.8),
                "framework_refs_json": dump_json_text(payload.get("framework_refs", [])),
                "profile_refs_json": dump_json_text(payload.get("profile_refs", [])),
                "source_refs_json": dump_json_text(payload.get("source_refs", [])),
                "properties_json": dump_json_text(payload.get("properties", {})),
                "status": str(payload.get("status") or "candidate"),
            }
        )
    return normalized


def normalize_profiles(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for index, record in enumerate(records, start=1):
        payload = dict(record)
        subject = str(payload.get("subject") or "chemistry")
        school_stage = str(payload.get("school_stage") or "")
        grade_band = str(payload.get("grade_band") or "")
        context_key = str(
            payload.get("context_key") or f"{subject}:{school_stage}:{grade_band}"
        )
        normalized.append(
            {
                "raw_profile_id": str(payload.get("id") or payload.get("raw_profile_id") or f"profile-{index}"),
                "raw_node_id": str(payload.get("node_id") or payload.get("raw_node_id") or ""),
                "subject": subject,
                "school_stage": school_stage,
                "grade_band": grade_band,
                "context_key": context_key,
                "curriculum_role": str(payload.get("curriculum_role") or "introduced"),
                "mastery_level": str(payload.get("mastery_level") or "understand"),
                "framework_refs_json": dump_json_text(payload.get("framework_refs", [])),
                "textbook_refs_json": dump_json_text(payload.get("textbook_refs", [])),
                "textbook_ids_json": dump_json_text(payload.get("textbook_ids", [])),
                "learning_objectives_json": dump_json_text(payload.get("learning_objectives", [])),
                "assessment_signals_json": dump_json_text(payload.get("assessment_signals", [])),
                "source_refs_json": dump_json_text(payload.get("source_refs", [])),
                "properties_json": dump_json_text(payload.get("properties", {})),
                "status": str(payload.get("status") or "candidate"),
            }
        )
    return normalized


def normalize_mentions(
    records: list[dict[str, Any]], book_id: str, batch_anchor: str
) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for index, record in enumerate(records, start=1):
        payload = dict(record)
        source_type = str(payload.get("source_type") or "textbook")
        anchor_ref = canonicalize_source_anchor(
            source_type,
            payload.get("source_id"),
            payload.get("anchor_ref") or batch_anchor,
            expected_book_id=book_id,
        )
        source_id = normalize_textbook_source_id(
            source_type,
            payload.get("source_id"),
            anchor_ref,
            expected_book_id=book_id,
        )
        normalized.append(
            {
                "raw_mention_id": str(payload.get("id") or payload.get("raw_mention_id") or f"mention-{index}"),
                "source_type": source_type,
                "source_id": source_id or "",
                "anchor_ref": anchor_ref or batch_anchor,
                "target_type": str(payload.get("target_type") or "node"),
                "target_raw_id": str(payload.get("target_id") or payload.get("target_raw_id") or ""),
                "role": str(payload.get("role") or "focuses_on"),
                "source_refs_json": dump_json_text(payload.get("source_refs", [])),
                "confidence": float(payload.get("confidence") or 0.95),
                "properties_json": dump_json_text(payload.get("properties", {})),
            }
        )
    return normalized


def normalize_evidence(
    records: list[dict[str, Any]], book_id: str, batch_anchor: str
) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for index, record in enumerate(records, start=1):
        payload = dict(record)
        source_type = str(payload.get("source_type") or "textbook")
        anchor_ref = canonicalize_source_anchor(
            source_type,
            payload.get("source_id"),
            payload.get("anchor_ref") or batch_anchor,
            expected_book_id=book_id,
        )
        source_id = normalize_textbook_source_id(
            source_type,
            payload.get("source_id"),
            anchor_ref,
            expected_book_id=book_id,
        )
        normalized.append(
            {
                "raw_evidence_id": str(payload.get("id") or payload.get("raw_evidence_id") or f"evidence-{index}"),
                "source_type": source_type,
                "source_id": source_id or "",
                "anchor_ref": anchor_ref or batch_anchor,
                "source_path": payload.get("source_path"),
                "page_start": payload.get("page_start"),
                "page_end": payload.get("page_end"),
                "excerpt": str(payload.get("excerpt") or ""),
                "locator": str(payload.get("locator") or ""),
                "modality": payload.get("modality"),
                "extraction_method": str(payload.get("extraction_method") or "llm"),
                "normalized_claims_json": dump_json_text(payload.get("normalized_claims", [])),
                "properties_json": dump_json_text(payload.get("properties", {})),
            }
        )
    return normalized


def normalize_node_cards(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for index, record in enumerate(records, start=1):
        payload = dict(record)
        raw_card_id = str(payload.get("id") or payload.get("raw_card_id") or f"card-{index}")
        raw_node_id = str(payload.get("node_id") or payload.get("raw_node_id") or "")
        sections = payload.get("sections", [])
        if isinstance(sections, dict):
            sections = [
                {
                    "id": section_id,
                    "title": section_id,
                    "section_type": section_id,
                    "content": section_value.get("content", "")
                    if isinstance(section_value, dict)
                    else section_value,
                    "source_refs": section_value.get("source_refs", [])
                    if isinstance(section_value, dict)
                    else [],
                }
                for section_id, section_value in sections.items()
            ]
        normalized.append(
            {
                "raw_card_id": raw_card_id,
                "raw_node_id": raw_node_id,
                "card_layer": str(payload.get("card_layer") or "backbone"),
                "title": str(payload.get("title") or ""),
                "summary": str(payload.get("summary") or ""),
                "pattern_refs_json": dump_json_text(payload.get("pattern_refs", [])),
                "framework_refs_json": dump_json_text(payload.get("framework_refs", [])),
                "profile_refs_json": dump_json_text(payload.get("profile_refs", [])),
                "mention_refs_json": dump_json_text(payload.get("mention_refs", [])),
                "source_refs_json": dump_json_text(payload.get("source_refs", [])),
                "sections_json": dump_json_text(sections),
                "properties_json": dump_json_text(payload.get("properties", {})),
                "status": str(payload.get("status") or "candidate"),
            }
        )
    return normalized


def replace_table_rows(
    connection,
    table_name: str,
    dataset_id: str,
    lesson_run_id: str,
) -> None:
    connection.execute(
        f"DELETE FROM {table_name} WHERE dataset_id = ? AND lesson_run_id = ?",
        (dataset_id, lesson_run_id),
    )


def main() -> int:
    args = parse_args()
    root = Path(args.root).expanduser().resolve()
    batch_anchor = resolve_outline_anchor(args.book_id, args.batch_anchor, strict=True)

    connection = connect_db(args.db)
    ensure_sqlite_schema(connection)
    dataset_id = resolve_dataset_id(connection, args.dataset_id, root)
    ensure_dataset(connection, dataset_id, root)
    require_dataset_row(connection, dataset_id)

    lesson_run_id = args.lesson_run_id or make_lesson_run_id(args.book_id, batch_anchor)
    now = utc_now()

    nodes = normalize_nodes(parse_json_array(args.nodes_json, "nodes"))
    edges = normalize_edges(parse_json_array(args.edges_json, "edges"))
    profiles = normalize_profiles(parse_json_array(args.profiles_json, "profiles"))
    mentions = normalize_mentions(
        parse_json_array(args.mentions_json, "mentions"), args.book_id, batch_anchor
    )
    evidence = normalize_evidence(
        parse_json_array(args.evidence_json, "evidence"), args.book_id, batch_anchor
    )
    node_cards = normalize_node_cards(parse_json_array(args.node_cards_json, "node-cards"))

    stats = Counter(
        {
            "nodes": len(nodes),
            "edges": len(edges),
            "profiles": len(profiles),
            "mentions": len(mentions),
            "evidence": len(evidence),
            "node_cards": len(node_cards),
        }
    )

    with connection:
        connection.execute(
            """
            INSERT OR REPLACE INTO lesson_runs (
              dataset_id,
              lesson_run_id,
              book_id,
              batch_anchor,
              status,
              counts_json,
              properties_json,
              created_at,
              updated_at
            ) VALUES (
              ?,
              ?,
              ?,
              ?,
              COALESCE((SELECT status FROM lesson_runs WHERE dataset_id = ? AND lesson_run_id = ?), 'staged'),
              ?,
              COALESCE((SELECT properties_json FROM lesson_runs WHERE dataset_id = ? AND lesson_run_id = ?), '{}'),
              COALESCE((SELECT created_at FROM lesson_runs WHERE dataset_id = ? AND lesson_run_id = ?), ?),
              ?
            )
            """,
            (
                dataset_id,
                lesson_run_id,
                args.book_id,
                batch_anchor,
                dataset_id,
                lesson_run_id,
                dump_json_text(dict(stats)),
                dataset_id,
                lesson_run_id,
                dataset_id,
                lesson_run_id,
                now,
                now,
            ),
        )

        if not args.append:
            for table_name in (
                "staging_nodes",
                "staging_edges",
                "staging_profiles",
                "staging_mentions",
                "staging_evidence",
                "staging_node_cards",
            ):
                replace_table_rows(connection, table_name, dataset_id, lesson_run_id)

        if nodes:
            connection.executemany(
                """
                INSERT OR REPLACE INTO staging_nodes (
                  dataset_id, lesson_run_id, raw_node_id, book_id, batch_anchor,
                  canonical_name, node_kind, node_layer, node_subkind, definition,
                  aliases_json, learning_modes_json, bridge_tags_json, framework_refs_json,
                  profile_refs_json, same_as_refs_json, properties_json, semantic_key,
                  embedding_json, source_refs_json, status, created_at, updated_at, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        dataset_id,
                        lesson_run_id,
                        record["raw_node_id"],
                        args.book_id,
                        batch_anchor,
                        record["canonical_name"],
                        record["node_kind"],
                        record["node_layer"],
                        record["node_subkind"],
                        record["definition"],
                        record["aliases_json"],
                        record["learning_modes_json"],
                        record["bridge_tags_json"],
                        record["framework_refs_json"],
                        record["profile_refs_json"],
                        record["same_as_refs_json"],
                        record["properties_json"],
                        record["semantic_key"],
                        record["embedding_json"],
                        record["source_refs_json"],
                        record["status"],
                        now,
                        now,
                        record["notes"],
                    )
                    for record in nodes
                ],
            )

        if edges:
            connection.executemany(
                """
                INSERT OR REPLACE INTO staging_edges (
                  dataset_id, lesson_run_id, raw_edge_id, book_id, batch_anchor,
                  edge_type, edge_layer, backbone_expand, from_raw_node_id, to_raw_node_id,
                  directionality, confidence, framework_refs_json, profile_refs_json,
                  source_refs_json, properties_json, status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        dataset_id,
                        lesson_run_id,
                        record["raw_edge_id"],
                        args.book_id,
                        batch_anchor,
                        record["edge_type"],
                        record["edge_layer"],
                        record["backbone_expand"],
                        record["from_raw_node_id"],
                        record["to_raw_node_id"],
                        record["directionality"],
                        record["confidence"],
                        record["framework_refs_json"],
                        record["profile_refs_json"],
                        record["source_refs_json"],
                        record["properties_json"],
                        record["status"],
                        now,
                        now,
                    )
                    for record in edges
                ],
            )

        if profiles:
            connection.executemany(
                """
                INSERT OR REPLACE INTO staging_profiles (
                  dataset_id, lesson_run_id, raw_profile_id, raw_node_id, subject,
                  school_stage, grade_band, context_key, curriculum_role, mastery_level,
                  framework_refs_json, textbook_refs_json, textbook_ids_json,
                  learning_objectives_json, assessment_signals_json, source_refs_json,
                  properties_json, status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        dataset_id,
                        lesson_run_id,
                        record["raw_profile_id"],
                        record["raw_node_id"],
                        record["subject"],
                        record["school_stage"],
                        record["grade_band"],
                        record["context_key"],
                        record["curriculum_role"],
                        record["mastery_level"],
                        record["framework_refs_json"],
                        record["textbook_refs_json"],
                        record["textbook_ids_json"],
                        record["learning_objectives_json"],
                        record["assessment_signals_json"],
                        record["source_refs_json"],
                        record["properties_json"],
                        record["status"],
                        now,
                        now,
                    )
                    for record in profiles
                ],
            )

        if mentions:
            connection.executemany(
                """
                INSERT OR REPLACE INTO staging_mentions (
                  dataset_id, lesson_run_id, raw_mention_id, source_type, source_id,
                  anchor_ref, target_type, target_raw_id, role, source_refs_json,
                  confidence, properties_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        dataset_id,
                        lesson_run_id,
                        record["raw_mention_id"],
                        record["source_type"],
                        record["source_id"],
                        record["anchor_ref"],
                        record["target_type"],
                        record["target_raw_id"],
                        record["role"],
                        record["source_refs_json"],
                        record["confidence"],
                        record["properties_json"],
                        now,
                        now,
                    )
                    for record in mentions
                ],
            )

        if evidence:
            connection.executemany(
                """
                INSERT OR REPLACE INTO staging_evidence (
                  dataset_id, lesson_run_id, raw_evidence_id, source_type, source_id,
                  anchor_ref, source_path, page_start, page_end, excerpt, locator,
                  modality, extraction_method, normalized_claims_json, properties_json,
                  created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        dataset_id,
                        lesson_run_id,
                        record["raw_evidence_id"],
                        record["source_type"],
                        record["source_id"],
                        record["anchor_ref"],
                        record["source_path"],
                        record["page_start"],
                        record["page_end"],
                        record["excerpt"],
                        record["locator"],
                        record["modality"],
                        record["extraction_method"],
                        record["normalized_claims_json"],
                        record["properties_json"],
                        now,
                        now,
                    )
                    for record in evidence
                ],
            )

        if node_cards:
            connection.executemany(
                """
                INSERT OR REPLACE INTO staging_node_cards (
                  dataset_id, lesson_run_id, raw_card_id, raw_node_id, card_layer,
                  title, summary, pattern_refs_json, framework_refs_json, profile_refs_json,
                  mention_refs_json, source_refs_json, sections_json, properties_json,
                  status, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                [
                    (
                        dataset_id,
                        lesson_run_id,
                        record["raw_card_id"],
                        record["raw_node_id"],
                        record["card_layer"],
                        record["title"],
                        record["summary"],
                        record["pattern_refs_json"],
                        record["framework_refs_json"],
                        record["profile_refs_json"],
                        record["mention_refs_json"],
                        record["source_refs_json"],
                        record["sections_json"],
                        record["properties_json"],
                        record["status"],
                        now,
                        now,
                    )
                    for record in node_cards
                ],
            )

        connection.execute(
            """
            UPDATE lesson_runs
            SET status = 'staged', counts_json = ?, updated_at = ?
            WHERE dataset_id = ? AND lesson_run_id = ?
            """,
            (dump_json_text(dict(stats)), now, dataset_id, lesson_run_id),
        )

    print(
        dump_json_text(
            {
                "lesson_run_id": lesson_run_id,
                "dataset_id": dataset_id,
                "book_id": args.book_id,
                "batch_anchor": batch_anchor,
                "stats": dict(stats),
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
