#!/usr/bin/env python3
"""SQLite-native node card expansion - Directly writes to SQLite, no JSON files."""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Add parent directory to path for imports
REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "scripts"))

from knowledge_store_common import (
    connect_db,
    ensure_sqlite_schema,
    ANCHOR_ID_PATTERN,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB_PATH = REPO_ROOT / "storage" / "knowledge.sqlite"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def make_card_id(node_id: str) -> str:
    """Generate card ID from node ID."""
    return f"node-card:{node_id}"


class NodeCardInserter:
    """Insert or update node cards directly in SQLite."""

    def __init__(
        self,
        connection: sqlite3.Connection,
        dataset_id: str,
    ):
        self.connection = connection
        self.dataset_id = dataset_id
        self.now = utc_now()

    def insert_or_update_card(
        self,
        node_id: str,
        card_data: dict[str, Any],
    ) -> bool:
        """
        Insert or update a node card.

        Args:
            node_id: The canonical node ID this card belongs to
            card_data: Dictionary with card content

        Returns:
            True if successful
        """
        # Validate node exists
        node_row = self.connection.execute(
            "SELECT 1 FROM nodes WHERE dataset_id = ? AND id = ?",
            (self.dataset_id, node_id),
        ).fetchone()

        if not node_row:
            print(f"Error: Node '{node_id}' not found in dataset '{self.dataset_id}'")
            return False

        # Prepare card data
        card_id = card_data.get("id") or make_card_id(node_id)
        card_layer = card_data.get("card_layer", "backbone")
        title = card_data.get("title", "")
        summary = card_data.get("summary", "")

        # Convert sections to proper format
        sections = card_data.get("sections", [])
        if isinstance(sections, dict):
            # Convert dict format to array format
            sections = self._convert_sections_dict_to_array(sections)

        # Ensure each section has required fields
        validated_sections = []
        for section in sections:
            if not isinstance(section, dict):
                continue
            validated_section = {
                "id": section.get("id", "section-" + str(len(validated_sections))),
                "title": section.get("title", "Section"),
                "section_type": section.get("section_type", "content"),
                "content": section.get("content", ""),
            }
            if "source_refs" in section:
                validated_section["source_refs"] = section["source_refs"]
            validated_sections.append(validated_section)

        sections_json = json.dumps(validated_sections, ensure_ascii=False)

        # Insert or update
        self.connection.execute(
            """
            INSERT OR REPLACE INTO node_cards (
                dataset_id, node_id, id, card_layer, title, summary,
                pattern_refs_json, framework_refs_json, profile_refs_json,
                mention_refs_json, source_refs_json, sections_json,
                properties_json, status, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                self.dataset_id,
                node_id,
                card_id,
                card_layer,
                title,
                summary,
                json.dumps(card_data.get("pattern_refs", []), ensure_ascii=False),
                json.dumps(card_data.get("framework_refs", []), ensure_ascii=False),
                json.dumps(card_data.get("profile_refs", []), ensure_ascii=False),
                json.dumps(card_data.get("mention_refs", []), ensure_ascii=False),
                json.dumps(card_data.get("source_refs", []), ensure_ascii=False),
                sections_json,
                json.dumps(card_data.get("properties", {}), ensure_ascii=False),
                card_data.get("status", "active"),
                self.now,
            ),
        )

        # Update node.card_ref to link to this card
        self.connection.execute(
            """
            UPDATE nodes SET card_ref = ?, updated_at = ?
            WHERE dataset_id = ? AND id = ?
            """,
            (card_id, self.now, self.dataset_id, node_id),
        )

        self.connection.commit()
        return True

    def _convert_sections_dict_to_array(self, sections_dict: dict) -> list[dict]:
        """Convert old dict format to new array format."""
        section_type_map = {
            "definition": {"title": "定义", "section_type": "definition"},
            "essence": {"title": "本质", "section_type": "essence"},
            "key_points": {"title": "关键要点", "section_type": "key_points"},
            "example": {"title": "示例", "section_type": "example"},
            "application": {"title": "应用", "section_type": "application"},
            "misconception": {"title": "常见误解", "section_type": "misconception"},
            "structure": {"title": "结构", "section_type": "structure"},
            "procedure": {"title": "步骤", "section_type": "procedure"},
        }

        result = []
        for section_id, section_data in sections_dict.items():
            if not isinstance(section_data, dict):
                continue

            mapping = section_type_map.get(section_id, {})
            section = {
                "id": section_id,
                "title": section_data.get("title", mapping.get("title", section_id)),
                "section_type": section_data.get(
                    "section_type", mapping.get("section_type", "content")
                ),
                "content": section_data.get("content", section_data)
                if isinstance(section_data.get("content"), str)
                else str(section_data.get("content", "")),
            }
            if "source_refs" in section_data:
                section["source_refs"] = section_data["source_refs"]
            result.append(section)

        return result

    def update_card_search_index(self) -> int:
        """Rebuild FTS index for cards."""
        # Clear existing
        self.connection.execute(
            "DELETE FROM card_search WHERE dataset_id = ?", (self.dataset_id,)
        )

        # Rebuild
        count = 0
        for row in self.connection.execute(
            """
            SELECT node_id, title, summary, sections_json 
            FROM node_cards 
            WHERE dataset_id = ?
            """,
            (self.dataset_id,),
        ).fetchall():
            sections = json.loads(row["sections_json"])
            searchable = "\n".join(
                [
                    row["title"],
                    row["summary"],
                    *[s.get("content", "") for s in sections if isinstance(s, dict)],
                ]
            )

            self.connection.execute(
                """
                INSERT INTO card_search (dataset_id, id, searchable_content)
                VALUES (?, ?, ?)
                """,
                (self.dataset_id, row["node_id"], searchable),
            )
            count += 1

        self.connection.commit()
        return count


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Expand node card directly into SQLite (no JSON files)."
    )
    parser.add_argument(
        "--node-id",
        required=True,
        help="Canonical node ID to expand (e.g., concept:chemical-change)",
    )
    parser.add_argument(
        "--db",
        default=str(DEFAULT_DB_PATH),
        help="Path to SQLite database",
    )
    parser.add_argument(
        "--dataset-id",
        required=True,
        help="Dataset ID (e.g., v4)",
    )
    parser.add_argument(
        "--title",
        help="Card title (defaults to node canonical_name)",
    )
    parser.add_argument(
        "--summary",
        help="Card summary",
    )
    parser.add_argument(
        "--sections",
        help="JSON string of sections array or dict",
    )
    parser.add_argument(
        "--source-refs",
        help="JSON array of evidence references",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be inserted without actually inserting",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    # Connect to database
    db_path = Path(args.db).expanduser().resolve()

    if not db_path.exists():
        print(f"Error: Database not found: {db_path}")
        return 1

    connection = connect_db(db_path)
    ensure_sqlite_schema(connection)

    inserter = NodeCardInserter(
        connection=connection,
        dataset_id=args.dataset_id,
    )

    # Build card data from args
    card_data = {
        "card_layer": "backbone",
        "status": "active",
    }

    if args.title:
        card_data["title"] = args.title

    if args.summary:
        card_data["summary"] = args.summary

    if args.sections:
        try:
            sections = json.loads(args.sections)
            card_data["sections"] = sections
        except json.JSONDecodeError as e:
            print(f"Error parsing sections JSON: {e}")
            return 1

    if args.source_refs:
        try:
            card_data["source_refs"] = json.loads(args.source_refs)
        except json.JSONDecodeError as e:
            print(f"Error parsing source_refs JSON: {e}")
            return 1

    if args.dry_run:
        print(f"\nDry run for node: {args.node_id}")
        print(f"Dataset: {args.dataset_id}")
        print(f"Card data: {json.dumps(card_data, ensure_ascii=False, indent=2)}")
        return 0

    # Insert card
    success = inserter.insert_or_update_card(args.node_id, card_data)

    if success:
        # Update search index
        count = inserter.update_card_search_index()
        print(f"✓ Node card for '{args.node_id}' inserted/updated")
        print(f"  - FTS entries: {count}")

    connection.close()
    return 0 if success else 1


if __name__ == "__main__":
    raise SystemExit(main())
