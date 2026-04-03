#!/usr/bin/env python3
"""SQLite-native graph normalization - No JSONL files."""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
import sys
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).resolve().parent))

from knowledge_store_common import (
    connect_db,
    ensure_sqlite_schema,
    HIERARCHICAL_EDGE_TYPES,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB_PATH = REPO_ROOT / "storage" / "knowledge.sqlite"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class GraphNormalizer:
    """Normalize and deduplicate graph directly in SQLite."""

    def __init__(
        self,
        connection: sqlite3.Connection,
        dataset_id: str,
    ):
        self.connection = connection
        self.dataset_id = dataset_id
        self.now = utc_now()
        self.stats = {
            "merged_nodes": 0,
            "merged_aliases": 0,
            "deduped_edges": 0,
            "normalized_cards": 0,
        }

    def find_duplicate_nodes(self) -> list[dict[str, Any]]:
        """Find nodes that may be duplicates based on name similarity."""
        # Get all active nodes
        rows = self.connection.execute(
            """
            SELECT id, canonical_name, definition, aliases_json, node_kind
            FROM nodes
            WHERE dataset_id = ? AND status != 'deprecated'
            """,
            (self.dataset_id,),
        ).fetchall()

        nodes = []
        for row in rows:
            nodes.append(
                {
                    "id": row["id"],
                    "canonical_name": row["canonical_name"],
                    "definition": row["definition"],
                    "aliases": json.loads(row["aliases_json"]),
                    "node_kind": row["node_kind"],
                }
            )

        # Find potential duplicates
        duplicates = []
        seen = set()

        for i, node1 in enumerate(nodes):
            if node1["id"] in seen:
                continue

            similar = []
            for node2 in nodes[i + 1 :]:
                if node2["id"] in seen:
                    continue

                similarity = self._compute_similarity(node1, node2)
                if similarity > 0.85:  # High similarity threshold
                    similar.append(
                        {
                            "node": node2,
                            "similarity": similarity,
                        }
                    )

            if similar:
                similar.sort(key=lambda x: x["similarity"], reverse=True)
                duplicates.append(
                    {
                        "primary": node1,
                        "duplicates": similar[:3],  # Top 3 matches
                    }
                )
                seen.add(node1["id"])
                for s in similar[:3]:
                    seen.add(s["node"]["id"])

        return duplicates

    def _compute_similarity(self, node1: dict, node2: dict) -> float:
        """Compute similarity score between two nodes."""
        # Must be same kind
        if node1["node_kind"] != node2["node_kind"]:
            return 0.0

        scores = []

        # Name similarity
        name1 = node1["canonical_name"].lower()
        name2 = node2["canonical_name"].lower()
        name_sim = self._text_similarity(name1, name2)
        scores.append(name_sim * 0.5)  # 50% weight

        # Definition similarity (if both have definitions)
        def1 = node1.get("definition", "").lower()
        def2 = node2.get("definition", "").lower()
        if def1 and def2:
            def_sim = self._text_similarity(def1, def2)
            scores.append(def_sim * 0.3)  # 30% weight

        # Alias overlap
        aliases1 = set(a.lower() for a in node1.get("aliases", []))
        aliases2 = set(a.lower() for a in node2.get("aliases", []))
        if aliases1 and aliases2:
            overlap = len(aliases1 & aliases2)
            union = len(aliases1 | aliases2)
            if union > 0:
                alias_sim = overlap / union
                scores.append(alias_sim * 0.2)  # 20% weight

        return sum(scores)

    def _text_similarity(self, text1: str, text2: str) -> float:
        """Simple Jaccard-like similarity."""
        words1 = set(re.findall(r"\w+", text1)) if text1 else set()
        words2 = set(re.findall(r"\w+", text2)) if text2 else set()

        if not words1 or not words2:
            return 0.0

        intersection = len(words1 & words2)
        union = len(words1 | words2)

        return intersection / union if union > 0 else 0.0

    def merge_duplicate_nodes(
        self,
        primary_id: str,
        duplicate_id: str,
        strategy: str = "merge_aliases",
    ) -> bool:
        """Merge duplicate nodes into one."""
        # Get both nodes
        primary = self.connection.execute(
            "SELECT * FROM nodes WHERE dataset_id = ? AND id = ?",
            (self.dataset_id, primary_id),
        ).fetchone()

        duplicate = self.connection.execute(
            "SELECT * FROM nodes WHERE dataset_id = ? AND id = ?",
            (self.dataset_id, duplicate_id),
        ).fetchone()

        if not primary or not duplicate:
            return False

        if strategy == "merge_aliases":
            # Merge aliases
            primary_aliases = set(json.loads(primary["aliases_json"]))
            duplicate_aliases = set(json.loads(duplicate["aliases_json"]))
            duplicate_aliases.add(duplicate["canonical_name"])
            merged_aliases = list(primary_aliases | duplicate_aliases)

            # Update primary
            self.connection.execute(
                """
                UPDATE nodes 
                SET aliases_json = ?, updated_at = ?
                WHERE dataset_id = ? AND id = ?
                """,
                (
                    json.dumps(merged_aliases, ensure_ascii=False),
                    self.now,
                    self.dataset_id,
                    primary_id,
                ),
            )

            # Mark duplicate as deprecated
            self.connection.execute(
                """
                UPDATE nodes 
                SET status = 'deprecated', deprecated_by = ?, updated_at = ?
                WHERE dataset_id = ? AND id = ?
                """,
                (primary_id, self.now, self.dataset_id, duplicate_id),
            )

            # Redirect edges from duplicate to primary
            self.connection.execute(
                """
                UPDATE edges
                SET from_id = ?, updated_at = ?
                WHERE dataset_id = ? AND from_id = ? AND status != 'deprecated'
                """,
                (primary_id, self.now, self.dataset_id, duplicate_id),
            )

            self.connection.execute(
                """
                UPDATE edges
                SET to_id = ?, updated_at = ?
                WHERE dataset_id = ? AND to_id = ? AND status != 'deprecated'
                """,
                (primary_id, self.now, self.dataset_id, duplicate_id),
            )

            # Merge profiles
            self.connection.execute(
                """
                UPDATE profiles
                SET node_id = ?
                WHERE dataset_id = ? AND node_id = ?
                """,
                (primary_id, self.dataset_id, duplicate_id),
            )

            # Redirect mentions
            self.connection.execute(
                """
                UPDATE mentions
                SET target_id = ?
                WHERE dataset_id = ? AND target_id = ?
                """,
                (primary_id, self.dataset_id, duplicate_id),
            )

            self.stats["merged_nodes"] += 1
            self.stats["merged_aliases"] += len(merged_aliases) - len(primary_aliases)

        self.connection.commit()
        return True

    def deduplicate_edges(self) -> int:
        """Remove duplicate edges between same node pairs."""
        # Find duplicate edges
        duplicates = self.connection.execute(
            """
            SELECT from_id, to_id, edge_type, COUNT(*) as cnt,
                   GROUP_CONCAT(id) as ids
            FROM edges
            WHERE dataset_id = ? AND status != 'deprecated'
            GROUP BY from_id, to_id, edge_type
            HAVING COUNT(*) > 1
            """,
            (self.dataset_id,),
        ).fetchall()

        removed = 0
        for dup in duplicates:
            edge_ids = dup["ids"].split(",")
            # Keep first, deprecate rest
            for edge_id in edge_ids[1:]:
                self.connection.execute(
                    """
                    UPDATE edges
                    SET status = 'deprecated', updated_at = ?
                    WHERE dataset_id = ? AND id = ?
                    """,
                    (self.now, self.dataset_id, edge_id),
                )
                removed += 1

        self.stats["deduped_edges"] = removed
        self.connection.commit()
        return removed

    def normalize_node_cards(self) -> int:
        """Normalize node card content."""
        # Find cards that need normalization
        cards = self.connection.execute(
            """
            SELECT node_id, sections_json
            FROM node_cards
            WHERE dataset_id = ?
            """,
            (self.dataset_id,),
        ).fetchall()

        normalized = 0
        for card in cards:
            sections = json.loads(card["sections_json"])
            modified = False

            # Ensure all sections have required fields
            for i, section in enumerate(sections):
                if isinstance(section, dict):
                    if "id" not in section:
                        section["id"] = f"section-{i}"
                        modified = True
                    if "title" not in section:
                        section["title"] = section.get("id", "Section")
                        modified = True
                    if "section_type" not in section:
                        section["section_type"] = "content"
                        modified = True

            if modified:
                self.connection.execute(
                    """
                    UPDATE node_cards
                    SET sections_json = ?, updated_at = ?
                    WHERE dataset_id = ? AND node_id = ?
                    """,
                    (
                        json.dumps(sections, ensure_ascii=False),
                        self.now,
                        self.dataset_id,
                        card["node_id"],
                    ),
                )
                normalized += 1

        self.stats["normalized_cards"] = normalized
        self.connection.commit()
        return normalized

    def rebuild_fts_indexes(self) -> dict[str, int]:
        """Rebuild all FTS indexes."""
        counts = {}

        # Node search
        self.connection.execute(
            "DELETE FROM node_search WHERE dataset_id = ?", (self.dataset_id,)
        )
        for row in self.connection.execute(
            "SELECT id, canonical_name, definition FROM nodes WHERE dataset_id = ? AND status != 'deprecated'",
            (self.dataset_id,),
        ).fetchall():
            self.connection.execute(
                "INSERT INTO node_search (dataset_id, id, searchable_content) VALUES (?, ?, ?)",
                (
                    self.dataset_id,
                    row["id"],
                    f"{row['canonical_name']}\n{row['definition']}",
                ),
            )
        counts["nodes"] = self.connection.execute(
            "SELECT COUNT(*) FROM node_search WHERE dataset_id = ?", (self.dataset_id,)
        ).fetchone()[0]

        # Card search
        self.connection.execute(
            "DELETE FROM card_search WHERE dataset_id = ?", (self.dataset_id,)
        )
        for row in self.connection.execute(
            "SELECT node_id, title, summary, sections_json FROM node_cards WHERE dataset_id = ?",
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
                "INSERT INTO card_search (dataset_id, id, searchable_content) VALUES (?, ?, ?)",
                (self.dataset_id, row["node_id"], searchable),
            )
        counts["cards"] = self.connection.execute(
            "SELECT COUNT(*) FROM card_search WHERE dataset_id = ?", (self.dataset_id,)
        ).fetchone()[0]

        # Profile search
        self.connection.execute(
            "DELETE FROM profile_search WHERE dataset_id = ?", (self.dataset_id,)
        )
        for row in self.connection.execute(
            "SELECT id, learning_objectives_json FROM profiles WHERE dataset_id = ?",
            (self.dataset_id,),
        ).fetchall():
            objectives = json.loads(row["learning_objectives_json"])
            searchable = "\n".join(objectives)
            self.connection.execute(
                "INSERT INTO profile_search (dataset_id, id, searchable_content) VALUES (?, ?, ?)",
                (self.dataset_id, row["id"], searchable),
            )
        counts["profiles"] = self.connection.execute(
            "SELECT COUNT(*) FROM profile_search WHERE dataset_id = ?",
            (self.dataset_id,),
        ).fetchone()[0]

        # Evidence search
        self.connection.execute(
            "DELETE FROM evidence_search WHERE dataset_id = ?", (self.dataset_id,)
        )
        for row in self.connection.execute(
            "SELECT id, excerpt FROM evidence WHERE dataset_id = ?", (self.dataset_id,)
        ).fetchall():
            self.connection.execute(
                "INSERT INTO evidence_search (dataset_id, id, searchable_content) VALUES (?, ?, ?)",
                (self.dataset_id, row["id"], row["excerpt"]),
            )
        counts["evidence"] = self.connection.execute(
            "SELECT COUNT(*) FROM evidence_search WHERE dataset_id = ?",
            (self.dataset_id,),
        ).fetchone()[0]

        self.connection.commit()
        return counts

    def get_stats(self) -> dict[str, Any]:
        """Get normalization statistics."""
        return self.stats


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Normalize graph directly in SQLite (no JSONL files)."
    )
    parser.add_argument(
        "--dataset-id",
        required=True,
        help="Dataset ID to normalize (e.g., v4)",
    )
    parser.add_argument(
        "--db",
        default=str(DEFAULT_DB_PATH),
        help="Path to SQLite database",
    )
    parser.add_argument(
        "--auto-merge",
        action="store_true",
        help="Automatically merge high-confidence duplicates",
    )
    parser.add_argument(
        "--similarity-threshold",
        type=float,
        default=0.85,
        help="Similarity threshold for duplicate detection",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be normalized without making changes",
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

    # Check dataset exists
    dataset = connection.execute(
        "SELECT 1 FROM datasets WHERE dataset_id = ?", (args.dataset_id,)
    ).fetchone()

    if not dataset:
        print(f"Error: Dataset '{args.dataset_id}' not found")
        return 1

    print(f"Normalizing dataset: {args.dataset_id}")
    print(f"Database: {db_path}")

    if args.dry_run:
        print("\n** DRY RUN - No changes will be made **\n")

    normalizer = GraphNormalizer(
        connection=connection,
        dataset_id=args.dataset_id,
    )

    # Step 1: Find and report duplicates
    print("\n[1/4] Finding duplicate nodes...")
    duplicates = normalizer.find_duplicate_nodes()
    print(f"  Found {len(duplicates)} potential duplicate groups")

    for dup in duplicates[:5]:  # Show first 5
        primary = dup["primary"]
        print(f"\n  Primary: {primary['canonical_name']} ({primary['id']})")
        for sim in dup["duplicates"]:
            node = sim["node"]
            print(
                f"    → Similar: {node['canonical_name']} ({node['id']}) - {sim['similarity']:.2f}"
            )

    if duplicates and args.auto_merge and not args.dry_run:
        print(f"\n  Auto-merging {len(duplicates)} duplicate groups...")
        for dup in duplicates:
            primary_id = dup["primary"]["id"]
            for sim in dup["duplicates"]:
                if sim["similarity"] >= args.similarity_threshold:
                    normalizer.merge_duplicate_nodes(primary_id, sim["node"]["id"])
        print(f"  ✓ Merged {normalizer.stats['merged_nodes']} nodes")

    # Step 2: Deduplicate edges
    print("\n[2/4] Deduplicating edges...")
    if not args.dry_run:
        removed = normalizer.deduplicate_edges()
        print(f"  ✓ Removed {removed} duplicate edges")
    else:
        # Count would-be removed
        count = connection.execute(
            """
            SELECT COUNT(*) FROM (
                SELECT from_id, to_id, edge_type
                FROM edges
                WHERE dataset_id = ? AND status != 'deprecated'
                GROUP BY from_id, to_id, edge_type
                HAVING COUNT(*) > 1
            )
            """,
            (args.dataset_id,),
        ).fetchone()[0]
        print(f"  Would remove {count} duplicate edge groups")

    # Step 3: Normalize node cards
    print("\n[3/4] Normalizing node cards...")
    if not args.dry_run:
        normalized = normalizer.normalize_node_cards()
        print(f"  ✓ Normalized {normalized} cards")
    else:
        print(f"  Would normalize cards with missing fields")

    # Step 4: Rebuild FTS indexes
    print("\n[4/4] Rebuilding FTS indexes...")
    if not args.dry_run:
        counts = normalizer.rebuild_fts_indexes()
        print(f"  ✓ Node search: {counts['nodes']} entries")
        print(f"  ✓ Card search: {counts['cards']} entries")
        print(f"  ✓ Profile search: {counts['profiles']} entries")
        print(f"  ✓ Evidence search: {counts['evidence']} entries")
    else:
        # Count existing
        for table in [
            "node_search",
            "card_search",
            "profile_search",
            "evidence_search",
        ]:
            count = connection.execute(
                f"SELECT COUNT(*) FROM {table} WHERE dataset_id = ?", (args.dataset_id,)
            ).fetchone()[0]
            print(f"  Current {table}: {count} entries")

    # Summary
    print("\n" + "=" * 50)
    print("NORMALIZATION COMPLETE")
    print("=" * 50)

    if not args.dry_run:
        stats = normalizer.get_stats()
        print(f"\n✓ Merged nodes: {stats['merged_nodes']}")
        print(f"✓ Merged aliases: {stats['merged_aliases']}")
        print(f"✓ Deduplicated edges: {stats['deduped_edges']}")
        print(f"✓ Normalized cards: {stats['normalized_cards']}")
    else:
        print("\n(Dry run - no changes made)")

    connection.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
