#!/usr/bin/env python3
"""Apply lesson-batch extraction artifacts into SQLite."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any

from export_snapshot import export_dataset
from import_to_sqlite import activate_dataset, insert_dataset
from knowledge_store_common import (
    DEFAULT_DB_PATH,
    connect_db,
    dump_json_text,
    ensure_sqlite_schema,
    iter_node_terms,
    load_batch_runtime_records,
    load_jsonl,
    normalize_term,
    require_dataset_row,
    resolve_dataset_id,
    resolve_outline_anchor,
    resolve_runtime_artifact_path,
    runtime_evidence_path,
    runtime_mentions_path,
    runtime_node_cards_path,
    runtime_nodes_path,
    runtime_profiles_path,
    version_key_from_output_root,
)


STATUS_RANK = {"draft": 0, "candidate": 1, "ready": 2, "active": 3}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Apply batch extraction artifacts into SQLite."
    )
    parser.add_argument("--root", required=True, help="Versioned output root, for example data/v5")
    parser.add_argument("--book-id", required=True)
    parser.add_argument("--batch-anchor", required=True)
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH))
    parser.add_argument("--dataset-id")
    parser.add_argument("--nodes-file")
    parser.add_argument("--profiles-file")
    parser.add_argument("--mentions-file")
    parser.add_argument("--evidence-file")
    parser.add_argument("--node-cards-file")
    parser.add_argument(
        "--prefer-file-runtime",
        action="store_true",
        help="Prefer runtime JSONL files over SQLite batch_runtime_records when both exist.",
    )
    parser.add_argument(
        "--export-snapshot",
        action="store_true",
        help="Export snapshot files into <root> after applying SQLite updates.",
    )
    return parser.parse_args()


def stable_unique(values: list[Any]) -> list[Any]:
    result: list[Any] = []
    seen: set[str] = set()
    for value in values:
        key = json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
        if key in seen:
            continue
        seen.add(key)
        result.append(value)
    return result


def merge_lists(existing: list[Any], incoming: list[Any]) -> list[Any]:
    return stable_unique([*existing, *incoming])


def merge_objects(existing: dict[str, Any], incoming: dict[str, Any]) -> dict[str, Any]:
    merged = dict(existing)
    for key, value in incoming.items():
        if key not in merged:
            merged[key] = value
            continue
        current = merged[key]
        if isinstance(current, dict) and isinstance(value, dict):
            merged[key] = merge_objects(current, value)
        elif isinstance(current, list) and isinstance(value, list):
            merged[key] = merge_lists(current, value)
        elif current in (None, "", [], {}):
            merged[key] = value
    return merged


def merge_status(existing: str | None, incoming: str | None) -> str | None:
    if not existing:
        return incoming
    if not incoming:
        return existing
    if STATUS_RANK.get(incoming, -1) > STATUS_RANK.get(existing, -1):
        return incoming
    return existing


def choose_scalar(existing: Any, incoming: Any) -> Any:
    if existing not in (None, "", [], {}):
        return existing
    return incoming


def ensure_dataset(connection, dataset_id: str, root: Path) -> None:
    row = connection.execute(
        "SELECT dataset_id FROM datasets WHERE dataset_id = ?",
        (dataset_id,),
    ).fetchone()
    if row is not None:
        return
    insert_dataset(connection, dataset_id, version_key_from_output_root(root), str(root), None)
    activate_dataset(connection, dataset_id)


def load_records(path: Path | None) -> list[dict[str, Any]]:
    if path is None or not path.exists():
        return []
    return load_jsonl(path)


def load_runtime_records(
    connection,
    dataset_id: str,
    root: Path,
    book_id: str,
    batch_anchor: str,
    record_type: str,
    explicit_path: Path | None,
    default_builder,
    *,
    prefer_file_runtime: bool,
) -> list[dict[str, Any]]:
    if explicit_path is not None:
        return load_records(explicit_path)

    runtime_path = resolve_runtime_artifact_path(root, book_id, batch_anchor, default_builder)
    if prefer_file_runtime:
        file_records = load_records(runtime_path)
        if file_records:
            return file_records
        return load_batch_runtime_records(connection, dataset_id, book_id, batch_anchor, record_type)

    sqlite_records = load_batch_runtime_records(connection, dataset_id, book_id, batch_anchor, record_type)
    if sqlite_records:
        return sqlite_records
    return load_records(runtime_path)


def canonicalize_source_anchor(
    source_type: str | None, source_id: str | None, anchor_ref: str | None
) -> str | None:
    if not anchor_ref or not source_id or source_type != "textbook":
        return anchor_ref
    return resolve_outline_anchor(source_id, anchor_ref, strict=False)


def refresh_node_terms(connection, dataset_id: str, node: dict[str, Any]) -> None:
    connection.execute(
        "DELETE FROM node_terms WHERE dataset_id = ? AND node_id = ?",
        (dataset_id, node["id"]),
    )
    terms = [
        (dataset_id, node_id, term, normalize_term(term), term_type)
        for node_id, term, term_type in iter_node_terms([node])
    ]
    connection.executemany(
        """
        INSERT INTO node_terms (
          dataset_id,
          node_id,
          term,
          term_norm,
          term_type
        ) VALUES (?, ?, ?, ?, ?)
        """,
        terms,
    )


def refresh_node_search(connection, dataset_id: str, node: dict[str, Any]) -> None:
    connection.execute(
        "DELETE FROM node_search WHERE dataset_id = ? AND node_id = ?",
        (dataset_id, node["id"]),
    )
    connection.execute(
        """
        INSERT INTO node_search (
          dataset_id,
          node_id,
          canonical_name,
          aliases,
          definition
        ) VALUES (?, ?, ?, ?, ?)
        """,
        (
            dataset_id,
            node["id"],
            node["canonical_name"],
            "\n".join(node.get("aliases", [])),
            node["definition"],
        ),
    )


def upsert_nodes(connection, dataset_id: str, records: list[dict[str, Any]]) -> Counter:
    stats: Counter[str] = Counter()
    for record in records:
        existing = connection.execute(
            "SELECT * FROM nodes WHERE dataset_id = ? AND id = ?",
            (dataset_id, record["id"]),
        ).fetchone()

        incoming_aliases = list(record.get("aliases", []))
        if existing is None:
            merged = {
                "id": record["id"],
                "canonical_name": record["canonical_name"],
                "node_kind": record["node_kind"],
                "node_layer": record["node_layer"],
                "node_subkind": record.get("node_subkind"),
                "definition": record["definition"],
                "aliases": stable_unique(incoming_aliases),
                "learning_modes": list(record.get("learning_modes", [])),
                "bridge_tags": list(record.get("bridge_tags", [])),
                "framework_refs": list(record.get("framework_refs", [])),
                "profile_refs": list(record.get("profile_refs", [])),
                "card_ref": record.get("card_ref"),
                "same_as_refs": list(record.get("same_as_refs", [])),
                "properties": dict(record.get("properties", {})),
                "status": record.get("status", "draft"),
                "deprecated_by": record.get("deprecated_by"),
                "created_at": record.get("created_at"),
                "updated_at": record.get("updated_at"),
                "notes": record.get("notes"),
            }
            stats["nodes_inserted"] += 1
        else:
            existing_aliases = json.loads(existing["aliases_json"] or "[]")
            existing_name = existing["canonical_name"]
            incoming_name = record["canonical_name"]
            merged_aliases = merge_lists(existing_aliases, incoming_aliases)
            if incoming_name and incoming_name != existing_name:
                merged_aliases = merge_lists(merged_aliases, [incoming_name])
                stats["node_scalar_conflicts_preserved"] += 1
            merged = {
                "id": record["id"],
                "canonical_name": choose_scalar(existing["canonical_name"], record.get("canonical_name")),
                "node_kind": choose_scalar(existing["node_kind"], record.get("node_kind")),
                "node_layer": choose_scalar(existing["node_layer"], record.get("node_layer")),
                "node_subkind": choose_scalar(existing["node_subkind"], record.get("node_subkind")),
                "definition": choose_scalar(existing["definition"], record.get("definition")),
                "aliases": merged_aliases,
                "learning_modes": merge_lists(
                    json.loads(existing["learning_modes_json"] or "[]"),
                    list(record.get("learning_modes", [])),
                ),
                "bridge_tags": merge_lists(
                    json.loads(existing["bridge_tags_json"] or "[]"),
                    list(record.get("bridge_tags", [])),
                ),
                "framework_refs": merge_lists(
                    json.loads(existing["framework_refs_json"] or "[]"),
                    list(record.get("framework_refs", [])),
                ),
                "profile_refs": merge_lists(
                    json.loads(existing["profile_refs_json"] or "[]"),
                    list(record.get("profile_refs", [])),
                ),
                "card_ref": choose_scalar(existing["card_ref"], record.get("card_ref")),
                "same_as_refs": merge_lists(
                    json.loads(existing["same_as_refs_json"] or "[]"),
                    list(record.get("same_as_refs", [])),
                ),
                "properties": merge_objects(
                    json.loads(existing["properties_json"] or "{}"),
                    dict(record.get("properties", {})),
                ),
                "status": merge_status(existing["status"], record.get("status")),
                "deprecated_by": choose_scalar(existing["deprecated_by"], record.get("deprecated_by")),
                "created_at": choose_scalar(existing["created_at"], record.get("created_at")),
                "updated_at": record.get("updated_at") or existing["updated_at"],
                "notes": choose_scalar(existing["notes"], record.get("notes")),
            }
            stats["nodes_merged"] += 1

        connection.execute(
            """
            INSERT OR REPLACE INTO nodes (
              dataset_id,
              id,
              canonical_name,
              node_kind,
              node_layer,
              node_subkind,
              definition,
              aliases_json,
              learning_modes_json,
              bridge_tags_json,
              framework_refs_json,
              profile_refs_json,
              card_ref,
              same_as_refs_json,
              properties_json,
              status,
              deprecated_by,
              created_at,
              updated_at,
              notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                dataset_id,
                merged["id"],
                merged["canonical_name"],
                merged["node_kind"],
                merged["node_layer"],
                merged["node_subkind"],
                merged["definition"],
                dump_json_text(merged["aliases"]),
                dump_json_text(merged["learning_modes"]),
                dump_json_text(merged["bridge_tags"]),
                dump_json_text(merged["framework_refs"]),
                dump_json_text(merged["profile_refs"]),
                merged["card_ref"],
                dump_json_text(merged["same_as_refs"]),
                dump_json_text(merged["properties"]),
                merged["status"],
                merged["deprecated_by"],
                merged["created_at"],
                merged["updated_at"],
                merged["notes"],
            ),
        )
        refresh_node_terms(connection, dataset_id, merged)
        refresh_node_search(connection, dataset_id, merged)
    return stats


def refresh_profile_search(connection, dataset_id: str, profile: dict[str, Any]) -> None:
    connection.execute(
        "DELETE FROM profile_search WHERE dataset_id = ? AND profile_id = ?",
        (dataset_id, profile["id"]),
    )
    connection.execute(
        """
        INSERT INTO profile_search (
          dataset_id,
          profile_id,
          learning_objectives,
          assessment_signals
        ) VALUES (?, ?, ?, ?)
        """,
        (
            dataset_id,
            profile["id"],
            "\n".join(profile.get("learning_objectives", [])),
            "\n".join(profile.get("assessment_signals", [])),
        ),
    )


def refresh_profile_evidence_links(connection, dataset_id: str, profile: dict[str, Any]) -> None:
    connection.execute(
        "DELETE FROM evidence_links WHERE dataset_id = ? AND owner_type = 'profile' AND owner_id = ?",
        (dataset_id, profile["id"]),
    )
    rows = [
        (dataset_id, profile["id"], evidence_id, ordinal)
        for ordinal, evidence_id in enumerate(profile.get("source_refs", []), start=1)
    ]
    if rows:
        connection.executemany(
            """
            INSERT INTO evidence_links (
              dataset_id,
              owner_type,
              owner_id,
              evidence_id,
              ordinal
            ) VALUES (?, 'profile', ?, ?, ?)
            """,
            rows,
        )


def refresh_profile_textbooks(connection, dataset_id: str, profile: dict[str, Any]) -> None:
    connection.execute(
        "DELETE FROM profile_textbooks WHERE dataset_id = ? AND profile_id = ?",
        (dataset_id, profile["id"]),
    )
    rows = [
        (dataset_id, profile["id"], textbook_id)
        for textbook_id in profile.get("textbook_ids", [])
    ]
    if rows:
        connection.executemany(
            """
            INSERT INTO profile_textbooks (
              dataset_id,
              profile_id,
              textbook_id
            ) VALUES (?, ?, ?)
            """,
            rows,
        )


def upsert_profiles(connection, dataset_id: str, records: list[dict[str, Any]]) -> Counter:
    stats: Counter[str] = Counter()
    for record in records:
        existing = connection.execute(
            "SELECT * FROM profiles WHERE dataset_id = ? AND id = ?",
            (dataset_id, record["id"]),
        ).fetchone()
        if existing is None:
            merged = {
                "id": record["id"],
                "node_id": record["node_id"],
                "subject": record["subject"],
                "school_stage": record["school_stage"],
                "grade_band": record["grade_band"],
                "curriculum_role": record["curriculum_role"],
                "mastery_level": record["mastery_level"],
                "framework_refs": list(record.get("framework_refs", [])),
                "textbook_refs": list(record.get("textbook_refs", [])),
                "textbook_ids": list(record.get("textbook_ids", [])),
                "learning_objectives": list(record.get("learning_objectives", [])),
                "assessment_signals": list(record.get("assessment_signals", [])),
                "source_refs": list(record.get("source_refs", [])),
                "properties": dict(record.get("properties", {})),
                "status": record.get("status", "draft"),
                "updated_at": record.get("updated_at"),
            }
            stats["profiles_inserted"] += 1
        else:
            merged = {
                "id": record["id"],
                "node_id": choose_scalar(existing["node_id"], record.get("node_id")),
                "subject": choose_scalar(existing["subject"], record.get("subject")),
                "school_stage": choose_scalar(existing["school_stage"], record.get("school_stage")),
                "grade_band": choose_scalar(existing["grade_band"], record.get("grade_band")),
                "curriculum_role": choose_scalar(existing["curriculum_role"], record.get("curriculum_role")),
                "mastery_level": choose_scalar(existing["mastery_level"], record.get("mastery_level")),
                "framework_refs": merge_lists(
                    json.loads(existing["framework_refs_json"] or "[]"),
                    list(record.get("framework_refs", [])),
                ),
                "textbook_refs": merge_lists(
                    json.loads(existing["textbook_refs_json"] or "[]"),
                    list(record.get("textbook_refs", [])),
                ),
                "textbook_ids": merge_lists(
                    json.loads(existing["textbook_ids_json"] or "[]"),
                    list(record.get("textbook_ids", [])),
                ),
                "learning_objectives": merge_lists(
                    json.loads(existing["learning_objectives_json"] or "[]"),
                    list(record.get("learning_objectives", [])),
                ),
                "assessment_signals": merge_lists(
                    json.loads(existing["assessment_signals_json"] or "[]"),
                    list(record.get("assessment_signals", [])),
                ),
                "source_refs": merge_lists(
                    json.loads(existing["source_refs_json"] or "[]"),
                    list(record.get("source_refs", [])),
                ),
                "properties": merge_objects(
                    json.loads(existing["properties_json"] or "{}"),
                    dict(record.get("properties", {})),
                ),
                "status": merge_status(existing["status"], record.get("status")),
                "updated_at": record.get("updated_at") or existing["updated_at"],
            }
            stats["profiles_merged"] += 1

        context_key = (
            f"{merged['subject']}|{merged['school_stage']}|{merged['grade_band']}"
        )
        connection.execute(
            """
            INSERT OR REPLACE INTO profiles (
              dataset_id,
              id,
              node_id,
              subject,
              school_stage,
              grade_band,
              context_key,
              curriculum_role,
              mastery_level,
              framework_refs_json,
              textbook_refs_json,
              textbook_ids_json,
              learning_objectives_json,
              assessment_signals_json,
              source_refs_json,
              properties_json,
              status,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                dataset_id,
                merged["id"],
                merged["node_id"],
                merged["subject"],
                merged["school_stage"],
                merged["grade_band"],
                context_key,
                merged["curriculum_role"],
                merged["mastery_level"],
                dump_json_text(merged["framework_refs"]),
                dump_json_text(merged["textbook_refs"]),
                dump_json_text(merged["textbook_ids"]),
                dump_json_text(merged["learning_objectives"]),
                dump_json_text(merged["assessment_signals"]),
                dump_json_text(merged["source_refs"]),
                dump_json_text(merged["properties"]),
                merged["status"],
                merged["updated_at"],
            ),
        )
        refresh_profile_textbooks(connection, dataset_id, merged)
        refresh_profile_evidence_links(connection, dataset_id, merged)
        refresh_profile_search(connection, dataset_id, merged)
    return stats


def refresh_evidence_search(connection, dataset_id: str, record: dict[str, Any]) -> None:
    connection.execute(
        "DELETE FROM evidence_search WHERE dataset_id = ? AND evidence_id = ?",
        (dataset_id, record["id"]),
    )
    connection.execute(
        """
        INSERT INTO evidence_search (
          dataset_id,
          evidence_id,
          excerpt,
          locator,
          normalized_claims
        ) VALUES (?, ?, ?, ?, ?)
        """,
        (
            dataset_id,
            record["id"],
            record["excerpt"],
            record["locator"],
            "\n".join(record.get("normalized_claims", [])),
        ),
    )


def upsert_evidence(connection, dataset_id: str, records: list[dict[str, Any]]) -> Counter:
    stats: Counter[str] = Counter()
    for record in records:
        anchor_ref = canonicalize_source_anchor(
            record.get("source_type"),
            record.get("source_id"),
            record.get("anchor_ref"),
        )
        connection.execute(
            """
            INSERT OR REPLACE INTO evidence (
              dataset_id,
              id,
              source_type,
              source_id,
              anchor_ref,
              source_path,
              page_start,
              page_end,
              excerpt,
              locator,
              modality,
              extraction_method,
              normalized_claims_json,
              properties_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                dataset_id,
                record["id"],
                record["source_type"],
                record["source_id"],
                anchor_ref,
                record.get("source_path"),
                record.get("page_start"),
                record.get("page_end"),
                record["excerpt"],
                record["locator"],
                record.get("modality"),
                record["extraction_method"],
                dump_json_text(record.get("normalized_claims", [])),
                dump_json_text(record.get("properties", {})),
            ),
        )
        refresh_evidence_search(connection, dataset_id, record)
        stats["evidence_upserted"] += 1
    return stats


def refresh_mention_evidence_links(connection, dataset_id: str, record: dict[str, Any]) -> None:
    connection.execute(
        "DELETE FROM evidence_links WHERE dataset_id = ? AND owner_type = 'mention' AND owner_id = ?",
        (dataset_id, record["id"]),
    )
    rows = [
        (dataset_id, record["id"], evidence_id, ordinal)
        for ordinal, evidence_id in enumerate(record.get("source_refs", []), start=1)
    ]
    if rows:
        connection.executemany(
            """
            INSERT INTO evidence_links (
              dataset_id,
              owner_type,
              owner_id,
              evidence_id,
              ordinal
            ) VALUES (?, 'mention', ?, ?, ?)
            """,
            rows,
        )


def upsert_mentions(connection, dataset_id: str, records: list[dict[str, Any]]) -> Counter:
    stats: Counter[str] = Counter()
    for record in records:
        anchor_ref = canonicalize_source_anchor(
            record.get("source_type"),
            record.get("source_id"),
            record.get("anchor_ref"),
        )
        connection.execute(
            """
            INSERT OR REPLACE INTO mentions (
              dataset_id,
              id,
              source_type,
              source_id,
              anchor_ref,
              target_type,
              target_id,
              role,
              source_refs_json,
              confidence,
              properties_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                dataset_id,
                record["id"],
                record["source_type"],
                record["source_id"],
                anchor_ref,
                record["target_type"],
                record["target_id"],
                record["role"],
                dump_json_text(record.get("source_refs", [])),
                record["confidence"],
                dump_json_text(record.get("properties", {})),
            ),
        )
        refresh_mention_evidence_links(connection, dataset_id, record)
        stats["mentions_upserted"] += 1
    return stats


def refresh_card_evidence_links(connection, dataset_id: str, card: dict[str, Any]) -> None:
    owner_id = card.get("id") or card["node_id"]
    connection.execute(
        "DELETE FROM evidence_links WHERE dataset_id = ? AND owner_type = 'card' AND owner_id = ?",
        (dataset_id, owner_id),
    )
    connection.execute(
        "DELETE FROM evidence_links WHERE dataset_id = ? AND owner_type = 'card_section' AND owner_id LIKE ?",
        (dataset_id, f"{owner_id}#%"),
    )
    card_rows = [
        (dataset_id, owner_id, evidence_id, ordinal)
        for ordinal, evidence_id in enumerate(card.get("source_refs", []), start=1)
    ]
    if card_rows:
        connection.executemany(
            """
            INSERT INTO evidence_links (
              dataset_id,
              owner_type,
              owner_id,
              evidence_id,
              ordinal
            ) VALUES (?, 'card', ?, ?, ?)
            """,
            card_rows,
        )
    section_rows = []
    for section in card.get("sections", []):
        section_owner = f"{owner_id}#{section['id']}"
        for ordinal, evidence_id in enumerate(section.get("source_refs", []), start=1):
            section_rows.append((dataset_id, section_owner, evidence_id, ordinal))
    if section_rows:
        connection.executemany(
            """
            INSERT INTO evidence_links (
              dataset_id,
              owner_type,
              owner_id,
              evidence_id,
              ordinal
            ) VALUES (?, 'card_section', ?, ?, ?)
            """,
            section_rows,
        )


def refresh_card_search(connection, dataset_id: str, card: dict[str, Any]) -> None:
    connection.execute(
        "DELETE FROM card_search WHERE dataset_id = ? AND node_id = ?",
        (dataset_id, card["node_id"]),
    )
    connection.execute(
        """
        INSERT INTO card_search (
          dataset_id,
          node_id,
          title,
          summary,
          sections
        ) VALUES (?, ?, ?, ?, ?)
        """,
        (
            dataset_id,
            card["node_id"],
            card["title"],
            card["summary"],
            "\n".join(
                piece
                for section in card.get("sections", [])
                for piece in ([section.get("title", "")] + section.get("content", []))
                if piece
            ),
        ),
    )


def upsert_node_cards(connection, dataset_id: str, records: list[dict[str, Any]]) -> Counter:
    stats: Counter[str] = Counter()
    for record in records:
        existing = connection.execute(
            "SELECT * FROM node_cards WHERE dataset_id = ? AND node_id = ?",
            (dataset_id, record["node_id"]),
        ).fetchone()
        if existing is None:
            merged = dict(record)
            stats["node_cards_inserted"] += 1
        else:
            merged = {
                "node_id": record["node_id"],
                "id": choose_scalar(existing["id"], record.get("id")),
                "card_layer": choose_scalar(existing["card_layer"], record.get("card_layer")),
                "title": record.get("title") or existing["title"],
                "summary": record.get("summary") or existing["summary"],
                "pattern_refs": merge_lists(
                    json.loads(existing["pattern_refs_json"] or "[]"),
                    list(record.get("pattern_refs", [])),
                ),
                "framework_refs": merge_lists(
                    json.loads(existing["framework_refs_json"] or "[]"),
                    list(record.get("framework_refs", [])),
                ),
                "profile_refs": merge_lists(
                    json.loads(existing["profile_refs_json"] or "[]"),
                    list(record.get("profile_refs", [])),
                ),
                "mention_refs": merge_lists(
                    json.loads(existing["mention_refs_json"] or "[]"),
                    list(record.get("mention_refs", [])),
                ),
                "source_refs": merge_lists(
                    json.loads(existing["source_refs_json"] or "[]"),
                    list(record.get("source_refs", [])),
                ),
                "sections": record.get("sections") or json.loads(existing["sections_json"] or "[]"),
                "properties": merge_objects(
                    json.loads(existing["properties_json"] or "{}"),
                    dict(record.get("properties", {})),
                ),
                "status": merge_status(existing["status"], record.get("status")),
                "updated_at": record.get("updated_at") or existing["updated_at"],
            }
            stats["node_cards_merged"] += 1

        connection.execute(
            """
            INSERT OR REPLACE INTO node_cards (
              dataset_id,
              node_id,
              id,
              card_layer,
              title,
              summary,
              pattern_refs_json,
              framework_refs_json,
              profile_refs_json,
              mention_refs_json,
              source_refs_json,
              sections_json,
              properties_json,
              status,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                dataset_id,
                merged["node_id"],
                merged.get("id"),
                merged["card_layer"],
                merged["title"],
                merged["summary"],
                dump_json_text(merged.get("pattern_refs", [])),
                dump_json_text(merged.get("framework_refs", [])),
                dump_json_text(merged.get("profile_refs", [])),
                dump_json_text(merged.get("mention_refs", [])),
                dump_json_text(merged.get("source_refs", [])),
                dump_json_text(merged.get("sections", [])),
                dump_json_text(merged.get("properties", {})),
                merged.get("status", "draft"),
                merged.get("updated_at"),
            ),
        )
        refresh_card_evidence_links(connection, dataset_id, merged)
        refresh_card_search(connection, dataset_id, merged)
    return stats


def ensure_source_artifacts(connection, dataset_id: str, records: list[dict[str, Any]]) -> Counter:
    stats: Counter[str] = Counter()
    seen: set[tuple[str, str]] = set()
    for record in records:
        key = (record["source_type"], record["source_id"])
        if key in seen:
            continue
        seen.add(key)
        source_type, source_id = key
        book_id = source_id if source_type == "textbook" else None
        connection.execute(
            """
            INSERT OR IGNORE INTO source_artifacts (
              dataset_id,
              source_id,
              source_type,
              book_id,
              title,
              file_path,
              outline_path,
              properties_json
            ) VALUES (?, ?, ?, ?, NULL, NULL, NULL, '{}')
            """,
            (dataset_id, source_id, source_type, book_id),
        )
        stats["source_artifacts_touched"] += 1
    return stats


def main() -> int:
    args = parse_args()
    root = Path(args.root).expanduser().resolve()
    resolved_batch_anchor = resolve_outline_anchor(args.book_id, args.batch_anchor, strict=False)

    connection = connect_db(args.db)
    ensure_sqlite_schema(connection)
    dataset_id = resolve_dataset_id(connection, args.dataset_id, root)
    ensure_dataset(connection, dataset_id, root)
    require_dataset_row(connection, dataset_id)

    nodes = load_runtime_records(
        connection,
        dataset_id,
        root,
        args.book_id,
        resolved_batch_anchor,
        "node",
        Path(args.nodes_file).expanduser().resolve() if args.nodes_file else None,
        runtime_nodes_path,
        prefer_file_runtime=args.prefer_file_runtime,
    )
    profiles = load_runtime_records(
        connection,
        dataset_id,
        root,
        args.book_id,
        resolved_batch_anchor,
        "profile",
        Path(args.profiles_file).expanduser().resolve() if args.profiles_file else None,
        runtime_profiles_path,
        prefer_file_runtime=args.prefer_file_runtime,
    )
    mentions = load_runtime_records(
        connection,
        dataset_id,
        root,
        args.book_id,
        resolved_batch_anchor,
        "mention",
        Path(args.mentions_file).expanduser().resolve() if args.mentions_file else None,
        runtime_mentions_path,
        prefer_file_runtime=args.prefer_file_runtime,
    )
    evidence = load_runtime_records(
        connection,
        dataset_id,
        root,
        args.book_id,
        resolved_batch_anchor,
        "evidence",
        Path(args.evidence_file).expanduser().resolve() if args.evidence_file else None,
        runtime_evidence_path,
        prefer_file_runtime=args.prefer_file_runtime,
    )
    node_cards = load_runtime_records(
        connection,
        dataset_id,
        root,
        args.book_id,
        resolved_batch_anchor,
        "node_card",
        Path(args.node_cards_file).expanduser().resolve() if args.node_cards_file else None,
        runtime_node_cards_path,
        prefer_file_runtime=args.prefer_file_runtime,
    )

    with connection:
        stats = Counter()
        stats.update(ensure_source_artifacts(connection, dataset_id, evidence + mentions))
        stats.update(upsert_nodes(connection, dataset_id, nodes))
        stats.update(upsert_evidence(connection, dataset_id, evidence))
        stats.update(upsert_profiles(connection, dataset_id, profiles))
        stats.update(upsert_mentions(connection, dataset_id, mentions))
        stats.update(upsert_node_cards(connection, dataset_id, node_cards))

    if args.export_snapshot:
        export_stats = export_dataset(connection, dataset_id, root)
        for key, value in export_stats.items():
            stats[f"snapshot_{key}"] = value

    print(
        f"Applied batch artifacts for dataset '{dataset_id}' batch "
        f"'{resolved_batch_anchor}'"
    )
    for key in sorted(stats):
        print(f"  {key}: {stats[key]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
