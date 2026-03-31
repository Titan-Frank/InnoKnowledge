#!/usr/bin/env python3
"""Export a SQLite dataset into a versioned JSON snapshot for viewer/publishing."""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from knowledge_store_common import (
    DEFAULT_DB_PATH,
    connect_db,
    ensure_sqlite_schema,
    require_dataset_row,
    resolve_dataset_id,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Export a SQLite dataset into data/<version>/ style JSON/JSONL snapshot files."
    )
    parser.add_argument("output_root", help="Target snapshot root, for example data/v5")
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH))
    parser.add_argument("--dataset-id")
    return parser.parse_args()


def load_json_array(text: str | None) -> list[Any]:
    if not text:
        return []
    return json.loads(text)


def load_json_object(text: str | None) -> dict[str, Any]:
    if not text:
        return {}
    return json.loads(text)


def safe_node_card_path(node_id: str) -> str:
    return node_id.replace(":", "__").replace("/", "__") + ".json"


def write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = "".join(json.dumps(record, ensure_ascii=False) + "\n" for record in records)
    path.write_text(payload, encoding="utf-8")


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )


def clear_matching_files(directory: Path, pattern: str) -> None:
    if not directory.exists():
        return
    for path in directory.glob(pattern):
        if path.is_file():
            path.unlink()


def export_nodes(connection, dataset_id: str) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT *
        FROM nodes
        WHERE dataset_id = ?
        ORDER BY id
        """,
        (dataset_id,),
    ).fetchall()
    records: list[dict[str, Any]] = []
    for row in rows:
        record = {
            "id": row["id"],
            "canonical_name": row["canonical_name"],
            "node_kind": row["node_kind"],
            "node_layer": row["node_layer"],
            "definition": row["definition"],
            "aliases": load_json_array(row["aliases_json"]),
            "learning_modes": load_json_array(row["learning_modes_json"]),
            "bridge_tags": load_json_array(row["bridge_tags_json"]),
            "framework_refs": load_json_array(row["framework_refs_json"]),
            "profile_refs": load_json_array(row["profile_refs_json"]),
            "same_as_refs": load_json_array(row["same_as_refs_json"]),
            "properties": load_json_object(row["properties_json"]),
            "status": row["status"],
        }
        if row["node_subkind"] is not None:
            record["node_subkind"] = row["node_subkind"]
        if row["card_ref"] is not None:
            record["card_ref"] = row["card_ref"]
        if row["deprecated_by"] is not None:
            record["deprecated_by"] = row["deprecated_by"]
        if row["created_at"] is not None:
            record["created_at"] = row["created_at"]
        if row["updated_at"] is not None:
            record["updated_at"] = row["updated_at"]
        if row["notes"] is not None:
            record["notes"] = row["notes"]
        records.append(record)
    return records


def export_edges(connection, dataset_id: str) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT *
        FROM edges
        WHERE dataset_id = ?
        ORDER BY id
        """,
        (dataset_id,),
    ).fetchall()
    records: list[dict[str, Any]] = []
    for row in rows:
        record = {
            "id": row["id"],
            "edge_type": row["edge_type"],
            "edge_layer": row["edge_layer"],
            "backbone_expand": bool(row["backbone_expand"]),
            "from": row["from_id"],
            "to": row["to_id"],
            "confidence": row["confidence"],
            "directionality": row["directionality"],
            "framework_refs": load_json_array(row["framework_refs_json"]),
            "profile_refs": load_json_array(row["profile_refs_json"]),
            "source_refs": load_json_array(row["source_refs_json"]),
            "properties": load_json_object(row["properties_json"]),
            "status": row["status"],
        }
        if row["created_at"] is not None:
            record["created_at"] = row["created_at"]
        if row["updated_at"] is not None:
            record["updated_at"] = row["updated_at"]
        records.append(record)
    return records


def export_profiles(connection, dataset_id: str) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT *
        FROM profiles
        WHERE dataset_id = ?
        ORDER BY id
        """,
        (dataset_id,),
    ).fetchall()
    records: list[dict[str, Any]] = []
    for row in rows:
        record = {
            "id": row["id"],
            "node_id": row["node_id"],
            "subject": row["subject"],
            "school_stage": row["school_stage"],
            "grade_band": row["grade_band"],
            "curriculum_role": row["curriculum_role"],
            "mastery_level": row["mastery_level"],
            "framework_refs": load_json_array(row["framework_refs_json"]),
            "textbook_refs": load_json_array(row["textbook_refs_json"]),
            "textbook_ids": load_json_array(row["textbook_ids_json"]),
            "learning_objectives": load_json_array(row["learning_objectives_json"]),
            "assessment_signals": load_json_array(row["assessment_signals_json"]),
            "source_refs": load_json_array(row["source_refs_json"]),
            "properties": load_json_object(row["properties_json"]),
            "status": row["status"],
        }
        if row["updated_at"] is not None:
            record["updated_at"] = row["updated_at"]
        records.append(record)
    return records


def export_mentions(connection, dataset_id: str) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT *
        FROM mentions
        WHERE dataset_id = ?
        ORDER BY source_id, id
        """,
        (dataset_id,),
    ).fetchall()
    return [
        {
            "id": row["id"],
            "source_type": row["source_type"],
            "source_id": row["source_id"],
            "anchor_ref": row["anchor_ref"],
            "target_type": row["target_type"],
            "target_id": row["target_id"],
            "role": row["role"],
            "source_refs": load_json_array(row["source_refs_json"]),
            "confidence": row["confidence"],
            "properties": load_json_object(row["properties_json"]),
        }
        for row in rows
    ]


def export_evidence(connection, dataset_id: str) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT *
        FROM evidence
        WHERE dataset_id = ?
        ORDER BY source_id, id
        """,
        (dataset_id,),
    ).fetchall()
    records: list[dict[str, Any]] = []
    for row in rows:
        record = {
            "id": row["id"],
            "source_type": row["source_type"],
            "source_id": row["source_id"],
            "anchor_ref": row["anchor_ref"],
            "excerpt": row["excerpt"],
            "locator": row["locator"],
            "extraction_method": row["extraction_method"],
            "normalized_claims": load_json_array(row["normalized_claims_json"]),
            "properties": load_json_object(row["properties_json"]),
        }
        if row["source_path"] is not None:
            record["source_path"] = row["source_path"]
        if row["page_start"] is not None:
            record["page_start"] = row["page_start"]
        if row["page_end"] is not None:
            record["page_end"] = row["page_end"]
        if row["modality"] is not None:
            record["modality"] = row["modality"]
        records.append(record)
    return records


def export_node_cards(connection, dataset_id: str) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT *
        FROM node_cards
        WHERE dataset_id = ?
        ORDER BY node_id
        """,
        (dataset_id,),
    ).fetchall()
    records: list[dict[str, Any]] = []
    for row in rows:
        record = {
            "node_id": row["node_id"],
            "card_layer": row["card_layer"],
            "title": row["title"],
            "summary": row["summary"],
            "pattern_refs": load_json_array(row["pattern_refs_json"]),
            "framework_refs": load_json_array(row["framework_refs_json"]),
            "profile_refs": load_json_array(row["profile_refs_json"]),
            "mention_refs": load_json_array(row["mention_refs_json"]),
            "source_refs": load_json_array(row["source_refs_json"]),
            "sections": load_json_array(row["sections_json"]),
            "properties": load_json_object(row["properties_json"]),
            "status": row["status"],
        }
        if row["id"] is not None:
            record["id"] = row["id"]
        if row["updated_at"] is not None:
            record["updated_at"] = row["updated_at"]
        records.append(record)
    return records


def group_records_by_source(records: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        grouped[record["source_id"]].append(record)
    return dict(sorted(grouped.items()))


def export_dataset(connection, dataset_id: str, output_root: Path | str) -> Counter:
    output_root = Path(output_root).expanduser().resolve()
    nodes = export_nodes(connection, dataset_id)
    edges = export_edges(connection, dataset_id)
    profiles = export_profiles(connection, dataset_id)
    mentions = export_mentions(connection, dataset_id)
    evidence = export_evidence(connection, dataset_id)
    node_cards = export_node_cards(connection, dataset_id)

    graph_dir = output_root / "graph"
    profiles_dir = output_root / "profiles"
    node_cards_dir = output_root / "node_cards"

    graph_dir.mkdir(parents=True, exist_ok=True)
    profiles_dir.mkdir(parents=True, exist_ok=True)
    node_cards_dir.mkdir(parents=True, exist_ok=True)

    write_jsonl(graph_dir / "knowledge.nodes.jsonl", nodes)
    write_jsonl(graph_dir / "knowledge.edges.jsonl", edges)
    write_jsonl(profiles_dir / "knowledge.profiles.jsonl", profiles)

    clear_matching_files(graph_dir, "*.mentions.jsonl")
    clear_matching_files(graph_dir, "*.evidence.jsonl")
    for source_id, records in group_records_by_source(mentions).items():
        write_jsonl(graph_dir / f"{source_id}.mentions.jsonl", records)
    for source_id, records in group_records_by_source(evidence).items():
        write_jsonl(graph_dir / f"{source_id}.evidence.jsonl", records)

    clear_matching_files(node_cards_dir, "*.json")
    for card in node_cards:
        write_json(node_cards_dir / safe_node_card_path(card["node_id"]), card)

    stats = Counter(
        {
            "nodes": len(nodes),
            "edges": len(edges),
            "profiles": len(profiles),
            "mentions": len(mentions),
            "evidence": len(evidence),
            "node_cards": len(node_cards),
            "mention_files": len(group_records_by_source(mentions)),
            "evidence_files": len(group_records_by_source(evidence)),
        }
    )
    return stats


def main() -> int:
    args = parse_args()
    output_root = Path(args.output_root).expanduser().resolve()
    connection = connect_db(args.db)
    ensure_sqlite_schema(connection)
    dataset_id = resolve_dataset_id(connection, args.dataset_id, output_root)
    require_dataset_row(connection, dataset_id)
    stats = export_dataset(connection, dataset_id, output_root)
    print(f"Exported dataset '{dataset_id}' to {output_root}")
    for key in sorted(stats):
        print(f"  {key}: {stats[key]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
