#!/usr/bin/env python3
"""
Generic batch inserter for knowledge graph artifacts.

This script accepts JSON data via command line or file and inserts
nodes, edges, profiles, mentions, evidence, and node_cards into SQLite.

Usage:
    # Insert from JSON file
    python scripts/insert_batch.py --input batch_data.json

    # Insert from command line JSON
    python scripts/insert_batch.py --data '{"nodes": [...], "edges": [...]}'

    # Dry run to preview
    python scripts/insert_batch.py --input batch_data.json --dry-run

Input JSON structure:
{
    "nodes": [
        {
            "id": "entity/substance:oxygen",
            "canonical_name": "氧气",
            "node_kind": "entity",
            "node_layer": "backbone",
            "node_subkind": "substance",
            "definition": "...",
            "aliases": ["O₂", "氧"],
            "learning_modes": ["factual", "conceptual"],
            "bridge_tags": ["matter", "properties"],
            ...
        }
    ],
    "edges": [
        {
            "id": "edge:...",
            "edge_type": "is_a",
            "edge_layer": "backbone",
            "from": "entity/substance:oxygen",
            "to": "concept:element",
            ...
        }
    ],
    "profiles": [...],
    "mentions": [...],
    "evidence": [...],
    "node_cards": [...]
}
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB_PATH = REPO_ROOT / "storage" / "knowledge.sqlite"


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def connect_db(db_path: Path) -> sqlite3.Connection:
    path = db_path.expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def insert_node(conn: sqlite3.Connection, dataset_id: str, node: dict) -> None:
    """Insert a canonical node."""
    now = utc_now()
    conn.execute(
        """
        INSERT OR REPLACE INTO nodes (
            dataset_id, id, canonical_name, node_kind, node_layer, node_subkind,
            definition, aliases_json, learning_modes_json, bridge_tags_json,
            framework_refs_json, profile_refs_json, card_ref, same_as_refs_json,
            properties_json, status, created_at, updated_at, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            dataset_id,
            node["id"],
            node["canonical_name"],
            node["node_kind"],
            node["node_layer"],
            node.get("node_subkind"),
            node.get("definition", ""),
            json.dumps(node.get("aliases", []), ensure_ascii=False),
            json.dumps(node.get("learning_modes", []), ensure_ascii=False),
            json.dumps(node.get("bridge_tags", []), ensure_ascii=False),
            json.dumps(node.get("framework_refs", []), ensure_ascii=False),
            json.dumps(node.get("profile_refs", []), ensure_ascii=False),
            node.get("card_ref"),
            json.dumps(node.get("same_as_refs", []), ensure_ascii=False),
            json.dumps(node.get("properties", {}), ensure_ascii=False),
            node.get("status", "active"),
            now,
            now,
            node.get("notes", ""),
        ),
    )

    # Sync to FTS
    _sync_node_to_fts(conn, dataset_id, node)


def _sync_node_to_fts(conn: sqlite3.Connection, dataset_id: str, node: dict) -> None:
    """Sync node to FTS search table."""
    aliases = node.get("aliases", [])
    aliases_str = " ".join(aliases) if isinstance(aliases, list) else str(aliases)
    conn.execute(
        """
        INSERT OR REPLACE INTO node_search (dataset_id, node_id, canonical_name, aliases, definition)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            dataset_id,
            node["id"],
            node["canonical_name"],
            aliases_str,
            node.get("definition", ""),
        ),
    )


def insert_edge(conn: sqlite3.Connection, dataset_id: str, edge: dict) -> None:
    """Insert an edge."""
    now = utc_now()
    conn.execute(
        """
        INSERT OR REPLACE INTO edges (
            dataset_id, id, edge_type, edge_layer, backbone_expand,
            from_id, to_id, directionality, confidence,
            framework_refs_json, profile_refs_json, source_refs_json,
            properties_json, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            dataset_id,
            edge["id"],
            edge["edge_type"],
            edge["edge_layer"],
            1 if edge.get("backbone_expand", False) else 0,
            edge["from"],
            edge["to"],
            edge.get("directionality", "directed"),
            edge.get("confidence", 0.9),
            json.dumps(edge.get("framework_refs", []), ensure_ascii=False),
            json.dumps(edge.get("profile_refs", []), ensure_ascii=False),
            json.dumps(edge.get("source_refs", []), ensure_ascii=False),
            json.dumps(edge.get("properties", {}), ensure_ascii=False),
            edge.get("status", "active"),
            now,
            now,
        ),
    )


def insert_profile(conn: sqlite3.Connection, dataset_id: str, profile: dict) -> None:
    """Insert a curriculum profile."""
    now = utc_now()
    conn.execute(
        """
        INSERT OR REPLACE INTO profiles (
            dataset_id, id, node_id, subject, school_stage, grade_band,
            context_key, curriculum_role, mastery_level, framework_refs_json,
            textbook_refs_json, textbook_ids_json, learning_objectives_json,
            assessment_signals_json, source_refs_json, properties_json, status, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            dataset_id,
            profile["id"],
            profile["node_id"],
            profile.get("subject", "chemistry"),
            profile.get("school_stage", ""),
            profile.get("grade_band", ""),
            profile.get("context_key", f"{profile.get('subject', 'chemistry')}:{profile.get('school_stage', '')}:{profile.get('grade_band', '')}"),
            profile.get("curriculum_role", "introduced"),
            profile.get("mastery_level", "understand"),
            json.dumps(profile.get("framework_refs", []), ensure_ascii=False),
            json.dumps(profile.get("textbook_refs", []), ensure_ascii=False),
            json.dumps(profile.get("textbook_ids", []), ensure_ascii=False),
            json.dumps(profile.get("learning_objectives", []), ensure_ascii=False),
            json.dumps(profile.get("assessment_signals", []), ensure_ascii=False),
            json.dumps(profile.get("source_refs", []), ensure_ascii=False),
            json.dumps(profile.get("properties", {}), ensure_ascii=False),
            profile.get("status", "active"),
            now,
        ),
    )

    # Sync to FTS
    _sync_profile_to_fts(conn, dataset_id, profile)


def _sync_profile_to_fts(conn: sqlite3.Connection, dataset_id: str, profile: dict) -> None:
    """Sync profile to FTS search table."""
    objectives = profile.get("learning_objectives", [])
    objectives_str = " ".join(objectives) if isinstance(objectives, list) else str(objectives)
    signals = profile.get("assessment_signals", [])
    signals_str = " ".join(signals) if isinstance(signals, list) else str(signals)
    conn.execute(
        """
        INSERT OR REPLACE INTO profile_search (dataset_id, profile_id, learning_objectives, assessment_signals)
        VALUES (?, ?, ?, ?)
        """,
        (
            dataset_id,
            profile["id"],
            objectives_str,
            signals_str,
        ),
    )


def insert_mention(conn: sqlite3.Connection, dataset_id: str, mention: dict) -> None:
    """Insert a mention record."""
    conn.execute(
        """
        INSERT OR REPLACE INTO mentions (
            dataset_id, id, source_type, source_id, anchor_ref,
            target_type, target_id, role, source_refs_json,
            confidence, properties_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            dataset_id,
            mention["id"],
            mention.get("source_type", "textbook"),
            mention.get("source_id", ""),
            mention["anchor_ref"],
            mention.get("target_type", "node"),
            mention["target_id"],
            mention.get("role", "focuses_on"),
            json.dumps(mention.get("source_refs", []), ensure_ascii=False),
            mention.get("confidence", 0.95),
            json.dumps(mention.get("properties", {}), ensure_ascii=False),
        ),
    )


def insert_evidence(conn: sqlite3.Connection, dataset_id: str, evidence: dict) -> None:
    """Insert an evidence record."""
    conn.execute(
        """
        INSERT OR REPLACE INTO evidence (
            dataset_id, id, source_type, source_id, anchor_ref,
            source_path, page_start, page_end, excerpt, locator,
            modality, extraction_method, normalized_claims_json, properties_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            dataset_id,
            evidence["id"],
            evidence.get("source_type", "textbook"),
            evidence.get("source_id", ""),
            evidence["anchor_ref"],
            evidence.get("source_path"),
            evidence.get("page_start"),
            evidence.get("page_end"),
            evidence.get("excerpt", ""),
            evidence.get("locator", ""),
            evidence.get("modality", "text"),
            evidence.get("extraction_method", "manual"),
            json.dumps(evidence.get("normalized_claims", []), ensure_ascii=False),
            json.dumps(evidence.get("properties", {}), ensure_ascii=False),
        ),
    )

    # Sync to FTS
    _sync_evidence_to_fts(conn, dataset_id, evidence)


def _sync_evidence_to_fts(conn: sqlite3.Connection, dataset_id: str, evidence: dict) -> None:
    """Sync evidence to FTS search table."""
    claims = evidence.get("normalized_claims", [])
    claims_str = " ".join(claims) if isinstance(claims, list) else str(claims)
    conn.execute(
        """
        INSERT OR REPLACE INTO evidence_search (dataset_id, evidence_id, excerpt, locator, normalized_claims)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            dataset_id,
            evidence["id"],
            evidence.get("excerpt", ""),
            evidence.get("locator", ""),
            claims_str,
        ),
    )


def insert_node_card(conn: sqlite3.Connection, dataset_id: str, card: dict) -> None:
    """Insert a node card."""
    now = utc_now()
    node_id = card["node_id"]
    card_id = card.get("id", f"node-card:{node_id}")

    # Ensure sections is array format
    sections = card.get("sections", [])
    if isinstance(sections, dict):
        sections = _convert_sections_dict_to_array(sections)

    conn.execute(
        """
        INSERT OR REPLACE INTO node_cards (
            dataset_id, node_id, id, card_layer, title, summary,
            pattern_refs_json, framework_refs_json, profile_refs_json,
            mention_refs_json, source_refs_json, sections_json,
            properties_json, status, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            dataset_id,
            node_id,
            card_id,
            card.get("card_layer", "backbone"),
            card.get("title", ""),
            card.get("summary", ""),
            json.dumps(card.get("pattern_refs", []), ensure_ascii=False),
            json.dumps(card.get("framework_refs", []), ensure_ascii=False),
            json.dumps(card.get("profile_refs", []), ensure_ascii=False),
            json.dumps(card.get("mention_refs", []), ensure_ascii=False),
            json.dumps(card.get("source_refs", []), ensure_ascii=False),
            json.dumps(sections, ensure_ascii=False),
            json.dumps(card.get("properties", {}), ensure_ascii=False),
            card.get("status", "active"),
            now,
        ),
    )

    # Update node.card_ref
    conn.execute(
        """
        UPDATE nodes SET card_ref = ?, updated_at = ?
        WHERE dataset_id = ? AND id = ?
        """,
        (card_id, now, dataset_id, node_id),
    )

    # Sync to FTS
    _sync_card_to_fts(conn, dataset_id, card, sections)


def _sync_card_to_fts(conn: sqlite3.Connection, dataset_id: str, card: dict, sections: list) -> None:
    """Sync node card to FTS search table."""
    # Flatten sections content for search
    sections_text = []
    for section in sections:
        content = section.get("content", "")
        if isinstance(content, list):
            sections_text.extend(content)
        else:
            sections_text.append(str(content))

    sections_str = " ".join(sections_text)
    conn.execute(
        """
        INSERT OR REPLACE INTO card_search (dataset_id, node_id, title, summary, sections)
        VALUES (?, ?, ?, ?, ?)
        """,
        (
            dataset_id,
            card["node_id"],
            card.get("title", ""),
            card.get("summary", ""),
            sections_str,
        ),
    )


def _convert_sections_dict_to_array(sections_dict: dict) -> list[dict]:
    """Convert dict format sections to array format."""
    section_type_map = {
        "definition": {"title": "定义", "section_type": "definition"},
        "essence": {"title": "核心本质", "section_type": "essence"},
        "key_points": {"title": "关键要点", "section_type": "key_points"},
        "example": {"title": "示例", "section_type": "example"},
        "application": {"title": "应用", "section_type": "application"},
        "misconception": {"title": "常见误解", "section_type": "misconception"},
    }

    result = []
    for section_id, section_data in sections_dict.items():
        if not isinstance(section_data, dict):
            continue
        mapping = section_type_map.get(section_id, {})
        section = {
            "id": section_id,
            "title": section_data.get("title", mapping.get("title", section_id)),
            "section_type": section_data.get("section_type", mapping.get("section_type", "content")),
            "content": section_data.get("content", ""),
        }
        if "source_refs" in section_data:
            section["source_refs"] = section_data["source_refs"]
        result.append(section)

    return result


def insert_batch(
    conn: sqlite3.Connection,
    dataset_id: str,
    batch_data: dict[str, Any],
    dry_run: bool = False,
) -> dict[str, int]:
    """Insert all artifacts from batch data.

    Args:
        conn: SQLite connection
        dataset_id: Dataset ID
        batch_data: Dictionary with nodes, edges, profiles, mentions, evidence, node_cards
        dry_run: If True, don't actually insert

    Returns:
        Dictionary with counts of each artifact type
    """
    counts = {
        "nodes": 0,
        "edges": 0,
        "profiles": 0,
        "mentions": 0,
        "evidence": 0,
        "node_cards": 0,
    }

    # Insert in dependency order
    order = ["evidence", "nodes", "edges", "profiles", "mentions", "node_cards"]

    for artifact_type in order:
        items = batch_data.get(artifact_type, [])
        if not items:
            continue

        if dry_run:
            counts[artifact_type] = len(items)
            continue

        inserters = {
            "nodes": insert_node,
            "edges": insert_edge,
            "profiles": insert_profile,
            "mentions": insert_mention,
            "evidence": insert_evidence,
            "node_cards": insert_node_card,
        }

        inserter = inserters[artifact_type]
        for item in items:
            inserter(conn, dataset_id, item)
            counts[artifact_type] += 1

    if not dry_run:
        conn.commit()

    return counts


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generic batch inserter for knowledge graph artifacts."
    )
    parser.add_argument(
        "--input",
        type=Path,
        help="Path to JSON file containing batch data",
    )
    parser.add_argument(
        "--data",
        type=str,
        help="JSON string containing batch data (alternative to --input)",
    )
    parser.add_argument(
        "--dataset-id",
        default="main",
        help="Dataset ID (default: main)",
    )
    parser.add_argument(
        "--db",
        type=Path,
        default=DEFAULT_DB_PATH,
        help=f"Path to SQLite database (default: {DEFAULT_DB_PATH})",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Preview what would be inserted without actually inserting",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    # Load batch data
    if args.input:
        with open(args.input, encoding="utf-8") as f:
            batch_data = json.load(f)
    elif args.data:
        batch_data = json.loads(args.data)
    else:
        print("Error: Either --input or --data is required")
        return 1

    # Connect to database
    conn = connect_db(args.db)

    # Insert batch
    counts = insert_batch(conn, args.dataset_id, batch_data, args.dry_run)

    # Report results
    action = "Would insert" if args.dry_run else "Inserted"
    print(f"{action}:")
    for artifact_type, count in counts.items():
        if count > 0:
            print(f"  - {artifact_type}: {count}")

    conn.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
