#!/usr/bin/env python3
"""PostgreSQL-native graph normalization."""

from __future__ import annotations

import argparse
import os
import re
import sys
from collections import defaultdict
from datetime import datetime, timezone
from typing import Any

# Add parent directory to path for imports
sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parent))

import psycopg
from psycopg import errors as pg_errors
from psycopg.rows import dict_row

from knowledge_store_common import (
    connect_db,
    ensure_pg_schema,
    HIERARCHICAL_EDGE_TYPES,
    rebuild_node_terms,
)


def normalize_section_id(value: object, fallback: str = "section") -> str:
    token = str(value or fallback).strip().lower().replace("_", "-")
    token = re.sub(r"[^a-z0-9-]+", "-", token)
    token = "-".join(part for part in token.split("-") if part)
    return token or fallback


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


class GraphNormalizer:
    """Normalize and deduplicate graph directly in PostgreSQL."""

    def __init__(
        self,
        connection: psycopg.Connection,
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
            "isolated_found": 0,
            "isolated_resolved": 0,
            "isolated_intentional": 0,
            "isolated_flagged": 0,
        }

    def find_duplicate_nodes(self) -> list[dict[str, Any]]:
        """Find nodes that may be duplicates based on name similarity."""
        # Get all active nodes
        with self.connection.cursor() as cur:
            cur.execute(
                """
                SELECT id, canonical_name, definition, aliases_json, node_kind
                FROM nodes
                WHERE dataset_id = %s AND status != 'deprecated'
                """,
                (self.dataset_id,),
            )
            rows = cur.fetchall()

        nodes = []
        for row in rows:
            nodes.append(
                {
                    "id": row["id"],
                    "canonical_name": row["canonical_name"],
                    "definition": row["definition"],
                    "aliases": row["aliases_json"] if isinstance(row["aliases_json"], list) else [],
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
                if similarity > 0.95:  # High threshold — Jaccard is unreliable for Chinese
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
        """Jaccard-like similarity on word tokens.

        NOTE: This is character-level for Chinese text (no whitespace
        delimiters), so it produces inflated similarity for terms that
        share common characters (e.g., "氧化铜" vs "氧化铁"). The
        embedding cosine similarity in merge_staged_lessons.py is the
        primary semantic signal; this is a secondary tiebreaker only.
        """
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
        with self.connection.cursor() as cur:
            cur.execute(
                "SELECT * FROM nodes WHERE dataset_id = %s AND id = %s",
                (self.dataset_id, primary_id),
            )
            primary = cur.fetchone()

            cur.execute(
                "SELECT * FROM nodes WHERE dataset_id = %s AND id = %s",
                (self.dataset_id, duplicate_id),
            )
            duplicate = cur.fetchone()

        if not primary or not duplicate:
            return False

        if strategy == "merge_aliases":
            # Merge aliases — JSONB columns return native Python objects
            primary_aliases = set(primary["aliases_json"] if isinstance(primary["aliases_json"], list) else [])
            duplicate_aliases = set(duplicate["aliases_json"] if isinstance(duplicate["aliases_json"], list) else [])
            duplicate_aliases.add(duplicate["canonical_name"])
            merged_aliases = list(primary_aliases | duplicate_aliases)

            # Update primary
            with self.connection.cursor() as cur:
                cur.execute(
                    """
                    UPDATE nodes
                    SET aliases_json = %s, updated_at = %s
                    WHERE dataset_id = %s AND id = %s
                    """,
                    (
                        merged_aliases,
                        self.now,
                        self.dataset_id,
                        primary_id,
                    ),
                )

                # Mark duplicate as deprecated
                cur.execute(
                    """
                    UPDATE nodes
                    SET status = 'deprecated', deprecated_by = %s, updated_at = %s
                    WHERE dataset_id = %s AND id = %s
                    """,
                    (primary_id, self.now, self.dataset_id, duplicate_id),
                )

                # Redirect edges from duplicate to primary
                cur.execute(
                    """
                    UPDATE edges
                    SET from_id = %s, updated_at = %s
                    WHERE dataset_id = %s AND from_id = %s AND status != 'deprecated'
                    """,
                    (primary_id, self.now, self.dataset_id, duplicate_id),
                )

                cur.execute(
                    """
                    UPDATE edges
                    SET to_id = %s, updated_at = %s
                    WHERE dataset_id = %s AND to_id = %s AND status != 'deprecated'
                    """,
                    (primary_id, self.now, self.dataset_id, duplicate_id),
                )

                # Merge profiles
                cur.execute(
                    """
                    UPDATE profiles
                    SET node_id = %s
                    WHERE dataset_id = %s AND node_id = %s
                    """,
                    (primary_id, self.dataset_id, duplicate_id),
                )

                # Redirect mentions
                cur.execute(
                    """
                    UPDATE mentions
                    SET target_id = %s
                    WHERE dataset_id = %s AND target_id = %s
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
        with self.connection.cursor() as cur:
            cur.execute(
                """
                SELECT from_id, to_id, edge_type, COUNT(*) as cnt,
                       string_agg(id::text, ','::text) as ids
                FROM edges
                WHERE dataset_id = %s AND status != 'deprecated'
                GROUP BY from_id, to_id, edge_type
                HAVING COUNT(*) > 1
                """,
                (self.dataset_id,),
            )
            duplicates = cur.fetchall()

        removed = 0
        with self.connection.cursor() as cur:
            for dup in duplicates:
                edge_ids = dup["ids"].split(",")
                # Keep first, deprecate rest
                for edge_id in edge_ids[1:]:
                    cur.execute(
                        """
                        UPDATE edges
                        SET status = 'deprecated', updated_at = %s
                        WHERE dataset_id = %s AND id = %s
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
        with self.connection.cursor() as cur:
            cur.execute(
                """
                SELECT node_id, sections_json, status
                FROM node_cards
                WHERE dataset_id = %s
                """,
                (self.dataset_id,),
            )
            cards = cur.fetchall()

        normalized = 0
        with self.connection.cursor() as cur:
            for card in cards:
                # JSONB returns native Python object
                sections = card["sections_json"] if isinstance(card["sections_json"], list) else []
                modified = False

                # Ensure all sections have required fields
                for i, section in enumerate(sections):
                    if isinstance(section, dict):
                        if "id" not in section:
                            section["id"] = f"section-{i}"
                            modified = True
                        normalized_id = normalize_section_id(section.get("id"), f"section-{i}")
                        if normalized_id != section.get("id"):
                            section["id"] = normalized_id
                            modified = True
                        if "title" not in section:
                            section["title"] = section.get("id", "Section")
                            modified = True
                        if "section_type" not in section:
                            section["section_type"] = "other"
                            modified = True
                        elif section["section_type"] == "content":
                            section["section_type"] = "other"
                            modified = True
                        content = section.get("content")
                        if isinstance(content, list):
                            normalized_content = [
                                str(item).strip() for item in content if str(item).strip()
                            ]
                        elif content is None:
                            normalized_content = []
                        else:
                            text = str(content).strip()
                            normalized_content = [text] if text else []
                        if content != normalized_content:
                            section["content"] = normalized_content
                            modified = True

                status = card["status"]
                normalized_status = status if status in {"draft", "reviewed", "validated"} else "draft"
                if normalized_status != status:
                    modified = True

                if modified:
                    cur.execute(
                        """
                        UPDATE node_cards
                        SET sections_json = %s, status = %s, updated_at = %s
                        WHERE dataset_id = %s AND node_id = %s
                        """,
                        (
                            sections,
                            normalized_status,
                            self.now,
                            self.dataset_id,
                            card["node_id"],
                        ),
                    )
                    normalized += 1

        self.stats["normalized_cards"] = normalized
        self.connection.commit()
        return normalized

    def find_isolated_nodes(self) -> list[dict[str, Any]]:
        """Find nodes with no incoming or outgoing edges."""
        with self.connection.cursor() as cur:
            cur.execute(
                """
                SELECT n.id, n.canonical_name, n.node_kind, n.node_layer, n.notes
                FROM nodes n
                WHERE n.dataset_id = %s
                  AND n.status != 'deprecated'
                  AND NOT EXISTS (
                      SELECT 1 FROM edges e
                      WHERE e.dataset_id = %s
                        AND e.status != 'deprecated'
                        AND (e.from_id = n.id OR e.to_id = n.id)
                  )
                """,
                (self.dataset_id, self.dataset_id),
            )
            isolated = cur.fetchall()

        result = []
        for row in isolated:
            result.append(
                {
                    "id": row["id"],
                    "canonical_name": row["canonical_name"],
                    "node_kind": row["node_kind"],
                    "node_layer": row["node_layer"],
                    "notes": row["notes"],
                }
            )

        self.stats["isolated_found"] = len(result)
        return result

    def resolve_isolated_nodes(
        self,
        isolated_nodes: list[dict[str, Any]],
        auto_resolve: bool = False,
    ) -> dict[str, Any]:
        """
        Resolve isolated nodes by attempting to connect them.

        Resolution strategy:
        1. Check if isolation is intentional (documented in notes)
        2. Search for semantically related nodes in current dataset
        3. If evidence exists in mentions/evidence, add edge
        4. Otherwise flag for human review

        Returns dict with counts and any issues.
        """
        results = {
            "resolved": [],
            "intentional": [],
            "flagged": [],
            "excessive_rate": False,
        }

        for node in isolated_nodes:
            # Check if already documented as intentional
            notes = node.get("notes", "") or ""
            if self._is_intentionally_isolated(node, notes):
                results["intentional"].append(node)
                self.stats["isolated_intentional"] += 1
                continue

            # Try to find related nodes
            related = self._find_related_nodes(node)

            if related and auto_resolve:
                # Auto-add edge if we have evidence
                edge_added = self._add_edge_with_evidence(node, related[0])
                if edge_added:
                    results["resolved"].append(
                        {
                            "node": node,
                            "connected_to": related[0],
                        }
                    )
                    self.stats["isolated_resolved"] += 1
                    continue

            # Flag for human review
            results["flagged"].append(node)
            self.stats["isolated_flagged"] += 1

        # Check for excessive isolation rate (only for backbone nodes)
        with self.connection.cursor() as cur:
            cur.execute(
                """
                SELECT COUNT(*) FROM nodes
                WHERE dataset_id = %s
                  AND status != 'deprecated'
                  AND node_layer = 'backbone'
                """,
                (self.dataset_id,),
            )
            backbone_count = cur.fetchone()["count"]

        if backbone_count > 0:
            backbone_isolated = sum(
                1 for n in isolated_nodes if n.get("node_layer") == "backbone"
            )
            isolation_rate = backbone_isolated / backbone_count
            if isolation_rate > 0.10:  # > 10%
                results["excessive_rate"] = True
                results["isolation_rate"] = isolation_rate
                results["backbone_isolated"] = backbone_isolated
                results["backbone_total"] = backbone_count

        self.connection.commit()
        return results

    def _is_intentionally_isolated(self, node: dict, notes: str) -> bool:
        """Check if node isolation is intentional based on notes or node context."""
        intentional_keywords = [
            "placeholder",
            "cross-reference",
            "awaiting connection",
            "intentionally isolated",
            "standalone",
            "introductory concept",
        ]
        notes_lower = notes.lower()
        if any(kw in notes_lower for kw in intentional_keywords):
            return True

        # Support nodes of inherently ancillary kinds (representation, method)
        # are common without explicit edges — downgrade to a soft signal
        # rather than flagging for mandatory human review.
        ancillary_kinds = {"representation", "method"}
        if node.get("node_layer") == "support" and node.get("node_kind") in ancillary_kinds:
            return True

        return False

    def _find_related_nodes(self, node: dict) -> list[dict]:
        """Find semantically related nodes based on mentions and evidence."""
        node_kind = node.get("node_kind", "")

        # Get mentions for this node
        with self.connection.cursor() as cur:
            cur.execute(
                """
                SELECT m.anchor_ref, m.role
                FROM mentions m
                WHERE m.dataset_id = %s AND m.target_id = %s
                LIMIT 5
                """,
                (self.dataset_id, node["id"]),
            )
            mentions = cur.fetchall()

        if not mentions:
            return []

        # Find other nodes mentioned in the same context
        related = []
        for mention in mentions:
            anchor = mention["anchor_ref"]
            if not anchor:
                continue

            # Find nodes mentioned in same anchor context
            with self.connection.cursor() as cur:
                cur.execute(
                    """
                    SELECT DISTINCT n.id, n.canonical_name, n.node_kind, n.node_layer
                    FROM mentions m
                    JOIN nodes n ON n.id = m.target_id
                    WHERE m.dataset_id = %s
                      AND m.anchor_ref = %s
                      AND m.target_id != %s
                      AND n.status != 'deprecated'
                    LIMIT 3
                    """,
                    (self.dataset_id, anchor, node["id"]),
                )
                same_context = cur.fetchall()

            for candidate in same_context:
                # Prefer same node_kind or concept nodes
                if candidate["node_kind"] == node_kind or candidate[
                    "node_kind"
                ].startswith("concept"):
                    related.append(
                        {
                            "id": candidate["id"],
                            "canonical_name": candidate["canonical_name"],
                            "node_kind": candidate["node_kind"],
                            "context": anchor,
                        }
                    )

        return related[:3]  # Return top 3 candidates

    def _add_edge_with_evidence(
        self,
        from_node: dict,
        to_node: dict,
    ) -> bool:
        """Add an edge between nodes if we have evidence support."""
        # Get evidence for the relation
        with self.connection.cursor() as cur:
            cur.execute(
                """
                SELECT e.id
                FROM evidence e
                JOIN mentions m ON m.anchor_ref = e.anchor_ref
                WHERE m.dataset_id = %s
                  AND m.target_id IN (%s, %s)
                  AND e.dataset_id = %s
                LIMIT 1
                """,
                (self.dataset_id, from_node["id"], to_node["id"], self.dataset_id),
            )
            evidence = cur.fetchone()

        if not evidence:
            return False

        # Determine appropriate edge type
        edge_type = self._get_preferred_edge_type(from_node, to_node)

        # Create edge
        edge_id = f"edge:{from_node['id']}:{to_node['id']}:{edge_type}"
        edge_layer = "support"
        backbone_expand = (
            from_node.get("node_layer") == "backbone"
            or to_node.get("node_layer") == "backbone"
        )

        try:
            with self.connection.cursor() as cur:
                cur.execute(
                    """
                    INSERT INTO edges (
                        id, dataset_id, from_id, to_id, edge_type,
                        edge_layer, backbone_expand, directionality, source_refs_json,
                        confidence, status, created_at, updated_at
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (dataset_id, id) DO NOTHING
                    """,
                    (
                        edge_id,
                        self.dataset_id,
                        from_node["id"],
                        to_node["id"],
                        edge_type,
                        edge_layer,
                        backbone_expand,
                        "directed",
                        [evidence["id"]],  # JSONB — pass native Python list
                        0.7,  # Moderate confidence for auto-added
                        "active",
                        self.now,
                        self.now,
                    ),
                )
            return True
        except pg_errors.UniqueViolation:
            return False

    def _get_preferred_edge_type(self, from_node: dict, to_node: dict) -> str:
        """Determine the best edge type based on node kinds."""
        from_kind = from_node.get("node_kind", "")
        to_kind = to_node.get("node_kind", "")

        # Concept hierarchy
        if from_kind.startswith("concept") and to_kind.startswith("concept"):
            return "related_to"

        # Entity relationships
        if from_kind.startswith("entity") and to_kind.startswith("entity"):
            return "related_to"

        # Activity uses/produces
        if from_kind.startswith("activity"):
            if to_kind.startswith("entity"):
                return "uses"
            if to_kind.startswith("method"):
                return "applies"

        # Method relationships
        if from_kind.startswith("method"):
            if to_kind.startswith("method"):
                return "extends"
            return "applies"

        # Representation explains
        if from_kind.startswith("representation"):
            return "explains"

        # Default to related_to
        return "related_to"

    def rebuild_fts_indexes(self) -> dict[str, int]:
        """No-op: FTS search tables removed in favor of LIKE queries."""
        return {}

    def get_stats(self) -> dict[str, Any]:
        """Get normalization statistics."""
        return self.stats


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Normalize graph directly in PostgreSQL."
    )
    parser.add_argument(
        "--dataset-id",
        default="main",
        help="Dataset ID to normalize (e.g., v4)",
    )
    parser.add_argument(
        "--db",
        default=os.environ.get("DATABASE_URL"),
        help="PostgreSQL connection URL (or set DATABASE_URL env var)",
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
    parser.add_argument(
        "--auto-resolve-isolated",
        action="store_true",
        help="Automatically add edges for isolated nodes when evidence exists",
    )
    parser.add_argument(
        "--fail-on-excessive-isolation",
        action="store_true",
        help="Fail if >10%% of backbone nodes are isolated (indicates extraction issues)",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    # Connect to database
    connection = connect_db(args.db)
    ensure_pg_schema(connection)

    # Check dataset exists
    with connection.cursor() as cur:
        cur.execute(
            "SELECT 1 FROM datasets WHERE dataset_id = %s", (args.dataset_id,)
        )
        dataset = cur.fetchone()

    if not dataset:
        print(f"Error: Dataset '{args.dataset_id}' not found")
        return 1

    print(f"Normalizing dataset: {args.dataset_id}")

    if args.dry_run:
        print("\n** DRY RUN - No changes will be made **\n")

    normalizer = GraphNormalizer(
        connection=connection,
        dataset_id=args.dataset_id,
    )

    # Step 1: Find and report duplicates
    print("\n[1/6] Finding duplicate nodes...")
    duplicates = normalizer.find_duplicate_nodes()
    print(f"  Found {len(duplicates)} potential duplicate groups")

    for dup in duplicates[:5]:  # Show first 5
        primary = dup["primary"]
        print(f"\n  Primary: {primary['canonical_name']} ({primary['id']})")
        for sim in dup["duplicates"]:
            node = sim["node"]
            print(
                f"    -> Similar: {node['canonical_name']} ({node['id']}) - {sim['similarity']:.2f}"
            )

    if duplicates and args.auto_merge and not args.dry_run:
        print(f"\n  Auto-merging {len(duplicates)} duplicate groups...")
        for dup in duplicates:
            primary_id = dup["primary"]["id"]
            for sim in dup["duplicates"]:
                if sim["similarity"] >= args.similarity_threshold:
                    normalizer.merge_duplicate_nodes(primary_id, sim["node"]["id"])
        print(f"  Merged {normalizer.stats['merged_nodes']} nodes")

    # Step 2: Deduplicate edges
    print("\n[2/6] Deduplicating edges...")
    if not args.dry_run:
        removed = normalizer.deduplicate_edges()
        print(f"  Removed {removed} duplicate edges")
    else:
        # Count would-be removed
        with connection.cursor() as cur:
            cur.execute(
                """
                SELECT COUNT(*) FROM (
                    SELECT from_id, to_id, edge_type
                    FROM edges
                    WHERE dataset_id = %s AND status != 'deprecated'
                    GROUP BY from_id, to_id, edge_type
                    HAVING COUNT(*) > 1
                ) sub
                """,
                (args.dataset_id,),
            )
            count = cur.fetchone()["count"]
        print(f"  Would remove {count} duplicate edge groups")

    # Step 3: Detect and resolve isolated nodes
    print("\n[3/6] Detecting isolated nodes...")
    isolated = normalizer.find_isolated_nodes()
    print(f"  Found {len(isolated)} isolated nodes")

    if isolated:
        # Categorize
        backbone_isolated = [n for n in isolated if n.get("node_layer") == "backbone"]
        support_isolated = [n for n in isolated if n.get("node_layer") == "support"]

        print(f"  Backbone isolated: {len(backbone_isolated)}")
        print(f"  Support isolated: {len(support_isolated)}")

        if backbone_isolated:
            print("\n  Isolated backbone nodes:")
            for node in backbone_isolated[:5]:
                print(
                    f"    - {node['canonical_name']} ({node['id']}) [{node['node_kind']}]"
                )
            if len(backbone_isolated) > 5:
                print(f"    ... and {len(backbone_isolated) - 5} more")

        if not args.dry_run:
            resolution = normalizer.resolve_isolated_nodes(
                isolated,
                auto_resolve=args.auto_resolve_isolated,
            )

            print(f"\n  Resolution results:")
            print(f"    Resolved: {len(resolution['resolved'])}")
            print(f"    Intentional: {len(resolution['intentional'])}")
            print(f"    Flagged for review: {len(resolution['flagged'])}")

            if resolution["excessive_rate"]:
                print(
                    f"\n  WARNING: EXCESSIVE ISOLATION RATE: {resolution['isolation_rate'] * 100:.1f}%"
                )
                print(
                    f"    {resolution['backbone_isolated']}/{resolution['backbone_total']} backbone nodes isolated"
                )
                if args.fail_on_excessive_isolation:
                    print(
                        "\n  FAILING: Excessive isolation indicates extraction issues"
                    )
                    connection.close()
                    return 1

            if resolution["flagged"]:
                print("\n  Nodes requiring manual review:")
                for node in resolution["flagged"][:3]:
                    print(f"    - {node['canonical_name']} ({node['id']})")
    else:
        print("  No isolated nodes found")

    # Step 4: Normalize node cards
    print("\n[4/6] Normalizing node cards...")
    if not args.dry_run:
        normalized = normalizer.normalize_node_cards()
        print(f"  Normalized {normalized} cards")
    else:
        print(f"  Would normalize cards with missing fields")

    # Step 5: Check for cycles in hierarchical edges
    print("\n[5/6] Checking for cycles in hierarchical edges...")
    hierarchical_types = list(HIERARCHICAL_EDGE_TYPES)
    placeholders = ",".join(["%s"] * len(hierarchical_types))
    with connection.cursor() as cur:
        cur.execute(
            f"""
            SELECT from_id, to_id, edge_type FROM edges
            WHERE dataset_id = %s
              AND status != 'deprecated'
              AND edge_type IN ({placeholders})
            """,
            (args.dataset_id, *hierarchical_types),
        )
        hier_rows = cur.fetchall()
    print(f"  Checked {len(hier_rows)} hierarchical edges")

    # Build adjacency list and detect cycles via DFS
    adj: dict[str, list[str]] = {}
    for row in hier_rows:
        adj.setdefault(row["from_id"], []).append(row["to_id"])

    visited: set[str] = set()
    rec_stack: set[str] = set()
    cycles_found: list[list[str]] = []

    def _dfs(node: str, path: list[str]) -> None:
        visited.add(node)
        rec_stack.add(node)
        path.append(node)
        for neighbor in adj.get(node, []):
            if neighbor not in visited:
                _dfs(neighbor, path)
            elif neighbor in rec_stack:
                cycle_start = path.index(neighbor)
                cycles_found.append(path[cycle_start:] + [neighbor])
        path.pop()
        rec_stack.discard(node)

    for node in list(adj.keys()):
        if node not in visited:
            _dfs(node, [])

    if cycles_found:
        print(f"  Found {len(cycles_found)} cycle(s) in hierarchical edges:")
        for i, cycle in enumerate(cycles_found[:5], 1):
            print(f"    {i}. {' -> '.join(cycle)}")
        if len(cycles_found) > 5:
            print(f"    ... and {len(cycles_found) - 5} more")
    else:
        print("  No cycles detected in hierarchical edges")

    # Step 6: Rebuild FTS indexes (now a no-op — text search uses LIKE)
    print("\n[6/6] FTS indexes skipped (using LIKE queries)")

    # Summary
    print("\n" + "=" * 50)
    print("NORMALIZATION COMPLETE")
    print("=" * 50)

    if not args.dry_run:
        stats = normalizer.get_stats()
        print(f"\nMerged nodes: {stats['merged_nodes']}")
        print(f"Merged aliases: {stats['merged_aliases']}")
        print(f"Deduplicated edges: {stats['deduped_edges']}")
        print(f"Normalized cards: {stats['normalized_cards']}")
        print(f"\nIsolated nodes found: {stats['isolated_found']}")
        print(f"  - Resolved: {stats['isolated_resolved']}")
        print(f"  - Intentional: {stats['isolated_intentional']}")
        print(f"  - Flagged: {stats['isolated_flagged']}")
    else:
        print("\n(Dry run - no changes made)")

    connection.close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
