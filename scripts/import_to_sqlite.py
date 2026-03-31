#!/usr/bin/env python3
"""Import a versioned JSON snapshot into the SQLite knowledge store."""

from __future__ import annotations

import argparse
import json
import sqlite3
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from knowledge_store_common import (
    DEFAULT_DB_PATH,
    SQLITE_SCHEMA_PATH,
    collect_source_artifacts,
    dataset_id_from_output_root,
    dump_json_text,
    iter_evidence_links,
    iter_node_terms,
    iter_profile_textbook_links,
    load_snapshot,
    normalize_term,
    version_key_from_output_root,
)


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def ensure_unique_records(records: list[dict[str, Any]], label: str, key_field: str = "id") -> None:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for record in records:
        record_key = record.get(key_field)
        if not record_key:
            raise SystemExit(f"{label} contains a record without '{key_field}'.")
        grouped.setdefault(record_key, []).append(record)

    conflicts: list[str] = []
    for record_key, rows in grouped.items():
        if len(rows) < 2:
            continue

        unique_payloads = {
            json.dumps(row, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            for row in rows
        }
        if len(unique_payloads) == 1:
            conflicts.append(f"{record_key} ({len(rows)} exact duplicates)")
        else:
            conflicts.append(f"{record_key} ({len(rows)} conflicting records)")

    if conflicts:
        preview = ", ".join(conflicts[:10])
        raise SystemExit(
            f"{label} contains duplicate '{key_field}' values. "
            f"Normalize or clean the snapshot before import. Examples: {preview}"
        )


def preflight_snapshot(snapshot: Any) -> None:
    ensure_unique_records(snapshot.nodes, "nodes")
    ensure_unique_records(snapshot.edges, "edges")
    ensure_unique_records(snapshot.profiles, "profiles")
    ensure_unique_records(snapshot.mentions, "mentions")
    ensure_unique_records(snapshot.evidence, "evidence")
    ensure_unique_records(snapshot.node_cards, "node_cards", key_field="node_id")

    node_ids = {node["id"] for node in snapshot.nodes}
    edge_ids = {edge["id"] for edge in snapshot.edges}
    profile_ids = {profile["id"] for profile in snapshot.profiles}
    card_ids = {card.get("id") for card in snapshot.node_cards if card.get("id")}
    card_ids.update(card["node_id"] for card in snapshot.node_cards)
    evidence_ids = {evidence["id"] for evidence in snapshot.evidence}

    edge_violations = [
        edge["id"]
        for edge in snapshot.edges
        if edge["from"] not in node_ids or edge["to"] not in node_ids
    ]
    if edge_violations:
        preview = ", ".join(edge_violations[:10])
        raise SystemExit(
            "edges reference missing nodes. "
            f"Normalize or repair the snapshot before import. Examples: {preview}"
        )

    profile_violations = [
        profile["id"] for profile in snapshot.profiles if profile["node_id"] not in node_ids
    ]
    if profile_violations:
        preview = ", ".join(profile_violations[:10])
        raise SystemExit(
            "profiles reference missing nodes. "
            f"Normalize or repair the snapshot before import. Examples: {preview}"
        )

    card_violations = [
        card.get("id") or card["node_id"]
        for card in snapshot.node_cards
        if card["node_id"] not in node_ids
    ]
    if card_violations:
        preview = ", ".join(card_violations[:10])
        raise SystemExit(
            "node_cards reference missing nodes. "
            f"Normalize or repair the snapshot before import. Examples: {preview}"
        )

    mention_violations: list[str] = []
    for mention in snapshot.mentions:
        target_type = mention["target_type"]
        target_id = mention["target_id"]
        is_valid = (
            (target_type == "node" and target_id in node_ids)
            or (target_type == "edge" and target_id in edge_ids)
            or (target_type == "profile" and target_id in profile_ids)
            or (target_type == "card" and target_id in card_ids)
        )
        if not is_valid:
            mention_violations.append(mention["id"])

    if mention_violations:
        preview = ", ".join(mention_violations[:10])
        raise SystemExit(
            "mentions reference missing targets. "
            f"Normalize or repair the snapshot before import. Examples: {preview}"
        )

    broken_evidence_refs = [
        f"{owner_type}:{owner_id}->{evidence_id}"
        for owner_type, owner_id, evidence_id, _ordinal in iter_evidence_links(snapshot)
        if evidence_id not in evidence_ids
    ]
    if broken_evidence_refs:
        preview = ", ".join(broken_evidence_refs[:10])
        raise SystemExit(
            "source_refs contain missing evidence ids. "
            f"Normalize or repair the snapshot before import. Examples: {preview}"
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Import data/<version>/ JSON snapshots into the SQLite knowledge store."
    )
    parser.add_argument("output_root", help="Versioned output root, for example data/v4")
    parser.add_argument(
        "--db",
        default=str(DEFAULT_DB_PATH),
        help="SQLite database path. Defaults to storage/knowledge.sqlite",
    )
    parser.add_argument(
        "--dataset-id",
        help="Dataset identifier inside SQLite. Defaults to the output root directory name.",
    )
    parser.add_argument(
        "--version-key",
        help="Version key, such as v4. Defaults to the output root directory name.",
    )
    parser.add_argument(
        "--activate",
        action="store_true",
        help="Mark the imported dataset as the active serving dataset.",
    )
    parser.add_argument(
        "--replace",
        action="store_true",
        help="Replace an existing dataset with the same dataset id, version key, or root path.",
    )
    parser.add_argument("--notes", help="Optional dataset notes stored in SQLite.")
    return parser.parse_args()


def connect(db_path: Path) -> sqlite3.Connection:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def ensure_schema(connection: sqlite3.Connection) -> None:
    schema_sql = SQLITE_SCHEMA_PATH.read_text(encoding="utf-8")
    connection.executescript(schema_sql)


def find_conflicting_dataset_ids(
    connection: sqlite3.Connection, dataset_id: str, version_key: str, root_path: str
) -> list[str]:
    rows = connection.execute(
        """
        SELECT dataset_id
        FROM datasets
        WHERE dataset_id = ? OR version_key = ? OR root_path = ?
        """,
        (dataset_id, version_key, root_path),
    ).fetchall()
    return sorted({row["dataset_id"] for row in rows})


def delete_dataset(connection: sqlite3.Connection, dataset_id: str) -> None:
    for table in ("node_search", "profile_search", "evidence_search", "card_search"):
        connection.execute(f"DELETE FROM {table} WHERE dataset_id = ?", (dataset_id,))
    connection.execute("DELETE FROM datasets WHERE dataset_id = ?", (dataset_id,))


def insert_dataset(
    connection: sqlite3.Connection,
    dataset_id: str,
    version_key: str,
    root_path: str,
    notes: str | None,
) -> None:
    connection.execute(
        """
        INSERT INTO datasets (
          dataset_id,
          version_key,
          root_path,
          schema_version,
          status,
          is_active,
          created_at,
          notes
        ) VALUES (?, ?, ?, 'v2', 'draft', 0, ?, ?)
        """,
        (dataset_id, version_key, root_path, utc_now(), notes),
    )


def activate_dataset(connection: sqlite3.Connection, dataset_id: str) -> None:
    now = utc_now()
    connection.execute("UPDATE datasets SET is_active = 0 WHERE is_active = 1")
    connection.execute(
        """
        UPDATE datasets
        SET is_active = 1,
            status = 'active',
            activated_at = ?
        WHERE dataset_id = ?
        """,
        (now, dataset_id),
    )


def mark_dataset_ready(connection: sqlite3.Connection, dataset_id: str) -> None:
    connection.execute(
        "UPDATE datasets SET status = 'ready' WHERE dataset_id = ?",
        (dataset_id,),
    )


def import_snapshot(connection: sqlite3.Connection, dataset_id: str, snapshot: Any) -> Counter:
    stats: Counter[str] = Counter()

    source_artifacts = collect_source_artifacts(snapshot)
    connection.executemany(
        """
        INSERT INTO source_artifacts (
          dataset_id,
          source_id,
          source_type,
          book_id,
          title,
          file_path,
          outline_path,
          properties_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                dataset_id,
                artifact["source_id"],
                artifact["source_type"],
                artifact["book_id"],
                artifact["title"],
                artifact["file_path"],
                artifact["outline_path"],
                dump_json_text(artifact["properties_json"]),
            )
            for artifact in source_artifacts
        ],
    )
    stats["source_artifacts"] = len(source_artifacts)

    connection.executemany(
        """
        INSERT INTO nodes (
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
        [
            (
                dataset_id,
                node["id"],
                node["canonical_name"],
                node["node_kind"],
                node["node_layer"],
                node.get("node_subkind"),
                node["definition"],
                dump_json_text(node.get("aliases", [])),
                dump_json_text(node.get("learning_modes", [])),
                dump_json_text(node.get("bridge_tags", [])),
                dump_json_text(node.get("framework_refs", [])),
                dump_json_text(node.get("profile_refs", [])),
                node.get("card_ref"),
                dump_json_text(node.get("same_as_refs", [])),
                dump_json_text(node.get("properties", {})),
                node["status"],
                node.get("deprecated_by"),
                node.get("created_at"),
                node.get("updated_at"),
                node.get("notes"),
            )
            for node in snapshot.nodes
        ],
    )
    stats["nodes"] = len(snapshot.nodes)

    node_terms = [
        (
            dataset_id,
            node_id,
            term,
            normalize_term(term),
            term_type,
        )
        for node_id, term, term_type in iter_node_terms(snapshot.nodes)
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
        node_terms,
    )
    stats["node_terms"] = len(node_terms)

    connection.executemany(
        """
        INSERT INTO edges (
          dataset_id,
          id,
          edge_type,
          edge_layer,
          backbone_expand,
          from_id,
          to_id,
          directionality,
          confidence,
          framework_refs_json,
          profile_refs_json,
          source_refs_json,
          properties_json,
          status,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                dataset_id,
                edge["id"],
                edge["edge_type"],
                edge["edge_layer"],
                int(edge["backbone_expand"]),
                edge["from"],
                edge["to"],
                edge["directionality"],
                edge["confidence"],
                dump_json_text(edge.get("framework_refs", [])),
                dump_json_text(edge.get("profile_refs", [])),
                dump_json_text(edge.get("source_refs", [])),
                dump_json_text(edge.get("properties", {})),
                edge["status"],
                edge.get("created_at"),
                edge.get("updated_at"),
            )
            for edge in snapshot.edges
        ],
    )
    stats["edges"] = len(snapshot.edges)

    connection.executemany(
        """
        INSERT INTO profiles (
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
        [
            (
                dataset_id,
                profile["id"],
                profile["node_id"],
                profile["subject"],
                profile["school_stage"],
                profile["grade_band"],
                f"{profile['subject']}|{profile['school_stage']}|{profile['grade_band']}",
                profile["curriculum_role"],
                profile["mastery_level"],
                dump_json_text(profile.get("framework_refs", [])),
                dump_json_text(profile.get("textbook_refs", [])),
                dump_json_text(profile.get("textbook_ids", [])),
                dump_json_text(profile.get("learning_objectives", [])),
                dump_json_text(profile.get("assessment_signals", [])),
                dump_json_text(profile.get("source_refs", [])),
                dump_json_text(profile.get("properties", {})),
                profile["status"],
                profile.get("updated_at"),
            )
            for profile in snapshot.profiles
        ],
    )
    stats["profiles"] = len(snapshot.profiles)

    profile_textbooks = [
        (dataset_id, profile_id, textbook_id)
        for profile_id, textbook_id in iter_profile_textbook_links(snapshot.profiles)
    ]
    connection.executemany(
        """
        INSERT INTO profile_textbooks (
          dataset_id,
          profile_id,
          textbook_id
        ) VALUES (?, ?, ?)
        """,
        profile_textbooks,
    )
    stats["profile_textbooks"] = len(profile_textbooks)

    connection.executemany(
        """
        INSERT INTO mentions (
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
        [
            (
                dataset_id,
                mention["id"],
                mention["source_type"],
                mention["source_id"],
                mention["anchor_ref"],
                mention["target_type"],
                mention["target_id"],
                mention["role"],
                dump_json_text(mention.get("source_refs", [])),
                mention["confidence"],
                dump_json_text(mention.get("properties", {})),
            )
            for mention in snapshot.mentions
        ],
    )
    stats["mentions"] = len(snapshot.mentions)

    connection.executemany(
        """
        INSERT INTO evidence (
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
        [
            (
                dataset_id,
                evidence["id"],
                evidence["source_type"],
                evidence["source_id"],
                evidence["anchor_ref"],
                evidence.get("source_path"),
                evidence.get("page_start"),
                evidence.get("page_end"),
                evidence["excerpt"],
                evidence["locator"],
                evidence.get("modality"),
                evidence["extraction_method"],
                dump_json_text(evidence.get("normalized_claims", [])),
                dump_json_text(evidence.get("properties", {})),
            )
            for evidence in snapshot.evidence
        ],
    )
    stats["evidence"] = len(snapshot.evidence)

    connection.executemany(
        """
        INSERT INTO node_cards (
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
        [
            (
                dataset_id,
                card["node_id"],
                card.get("id"),
                card["card_layer"],
                card["title"],
                card["summary"],
                dump_json_text(card.get("pattern_refs", [])),
                dump_json_text(card.get("framework_refs", [])),
                dump_json_text(card.get("profile_refs", [])),
                dump_json_text(card.get("mention_refs", [])),
                dump_json_text(card.get("source_refs", [])),
                dump_json_text(card.get("sections", [])),
                dump_json_text(card.get("properties", {})),
                card["status"],
                card.get("updated_at"),
            )
            for card in snapshot.node_cards
        ],
    )
    stats["node_cards"] = len(snapshot.node_cards)

    evidence_links = [
        (dataset_id, owner_type, owner_id, evidence_id, ordinal)
        for owner_type, owner_id, evidence_id, ordinal in iter_evidence_links(snapshot)
    ]
    connection.executemany(
        """
        INSERT INTO evidence_links (
          dataset_id,
          owner_type,
          owner_id,
          evidence_id,
          ordinal
        ) VALUES (?, ?, ?, ?, ?)
        """,
        evidence_links,
    )
    stats["evidence_links"] = len(evidence_links)

    rebuild_fts(connection, dataset_id, snapshot)
    stats["fts_node_docs"] = len(snapshot.nodes)
    stats["fts_profile_docs"] = len(snapshot.profiles)
    stats["fts_evidence_docs"] = len(snapshot.evidence)
    stats["fts_card_docs"] = len(snapshot.node_cards)

    return stats


def rebuild_fts(connection: sqlite3.Connection, dataset_id: str, snapshot: Any) -> None:
    for table in ("node_search", "profile_search", "evidence_search", "card_search"):
        connection.execute(f"DELETE FROM {table} WHERE dataset_id = ?", (dataset_id,))

    connection.executemany(
        """
        INSERT INTO node_search (
          dataset_id,
          node_id,
          canonical_name,
          aliases,
          definition
        ) VALUES (?, ?, ?, ?, ?)
        """,
        [
            (
                dataset_id,
                node["id"],
                node["canonical_name"],
                "\n".join(node.get("aliases", [])),
                node["definition"],
            )
            for node in snapshot.nodes
        ],
    )

    connection.executemany(
        """
        INSERT INTO profile_search (
          dataset_id,
          profile_id,
          learning_objectives,
          assessment_signals
        ) VALUES (?, ?, ?, ?)
        """,
        [
            (
                dataset_id,
                profile["id"],
                "\n".join(profile.get("learning_objectives", [])),
                "\n".join(profile.get("assessment_signals", [])),
            )
            for profile in snapshot.profiles
        ],
    )

    connection.executemany(
        """
        INSERT INTO evidence_search (
          dataset_id,
          evidence_id,
          excerpt,
          locator,
          normalized_claims
        ) VALUES (?, ?, ?, ?, ?)
        """,
        [
            (
                dataset_id,
                evidence["id"],
                evidence["excerpt"],
                evidence["locator"],
                "\n".join(evidence.get("normalized_claims", [])),
            )
            for evidence in snapshot.evidence
        ],
    )

    connection.executemany(
        """
        INSERT INTO card_search (
          dataset_id,
          node_id,
          title,
          summary,
          sections
        ) VALUES (?, ?, ?, ?, ?)
        """,
        [
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
            )
            for card in snapshot.node_cards
        ],
    )


def main() -> int:
    args = parse_args()
    output_root = Path(args.output_root).expanduser().resolve()
    db_path = Path(args.db).expanduser().resolve()
    dataset_id = args.dataset_id or dataset_id_from_output_root(output_root)
    version_key = args.version_key or version_key_from_output_root(output_root)

    snapshot = load_snapshot(output_root)
    preflight_snapshot(snapshot)
    connection = connect(db_path)
    ensure_schema(connection)

    conflicts = find_conflicting_dataset_ids(connection, dataset_id, version_key, str(output_root))
    if conflicts and not args.replace:
        joined = ", ".join(conflicts)
        raise SystemExit(
            f"Dataset conflict for {dataset_id} / {version_key} at {output_root}. "
            f"Existing dataset ids: {joined}. Re-run with --replace to overwrite them."
        )

    with connection:
        for conflict_id in conflicts:
            delete_dataset(connection, conflict_id)

        insert_dataset(connection, dataset_id, version_key, str(output_root), args.notes)
        stats = import_snapshot(connection, dataset_id, snapshot)

        if args.activate:
            activate_dataset(connection, dataset_id)
        else:
            mark_dataset_ready(connection, dataset_id)

    print(f"Imported dataset '{dataset_id}' from {output_root} into {db_path}")
    for key in sorted(stats):
        print(f"  {key}: {stats[key]}")

    dataset_row = connection.execute(
        "SELECT dataset_id, version_key, status, is_active FROM datasets WHERE dataset_id = ?",
        (dataset_id,),
    ).fetchone()
    print(
        "  dataset_status:"
        f" {dataset_row['status']} (active={bool(dataset_row['is_active'])}, version={dataset_row['version_key']})"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
