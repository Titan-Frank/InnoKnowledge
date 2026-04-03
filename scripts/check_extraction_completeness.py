#!/usr/bin/env python3
"""
Check extraction completeness: verify all lessons in manifest have been extracted to SQLite.

This script compares the manifest's batch list against actual SQLite records
to ensure every lesson has nodes, profiles, evidence, and mentions.
"""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

from knowledge_store_common import connect_db, DEFAULT_DB_PATH


def load_manifest(manifest_path: Path) -> dict:
    """Load pipeline manifest JSON."""
    with manifest_path.open("r", encoding="utf-8") as f:
        return json.load(f)


def extract_anchor_lesson(anchor: str) -> str:
    """Extract lesson/activity identifier from anchor.

    Examples:
        struct:chem-grade8:lesson:1-1-1 -> lesson:1-1-1
        struct:chem-grade8:activity:2-1-1 -> activity:2-1-1
    """
    parts = anchor.split(":")
    if len(parts) >= 4:
        return f"{parts[2]}:{parts[3]}"
    return anchor


def get_sqlite_lesson_stats(
    connection: sqlite3.Connection, dataset_id: str
) -> dict[str, dict[str, int]]:
    """Query SQLite for per-lesson extraction statistics.

    Returns:
        {anchor: {"nodes": N, "profiles": N, "evidence": N, "mentions": N}}
    """
    stats = defaultdict(
        lambda: {"nodes": 0, "profiles": 0, "evidence": 0, "mentions": 0}
    )

    # Get profile counts per lesson
    rows = connection.execute(
        """
        SELECT 
            json_extract(textbook_refs_json, '$[0]') as anchor,
            COUNT(*) as profile_count
        FROM profiles
        WHERE dataset_id = ? AND textbook_refs_json != '[]'
        GROUP BY anchor
        """,
        (dataset_id,),
    ).fetchall()

    for row in rows:
        if row["anchor"]:
            stats[row["anchor"]]["profiles"] = row["profile_count"]

    # Get evidence counts per lesson
    rows = connection.execute(
        """
        SELECT anchor_ref, COUNT(*) as evidence_count
        FROM evidence
        WHERE dataset_id = ?
        GROUP BY anchor_ref
        """,
        (dataset_id,),
    ).fetchall()

    for row in rows:
        if row["anchor_ref"]:
            stats[row["anchor_ref"]]["evidence"] = row["evidence_count"]

    # Get mentions counts per lesson (directly via anchor_ref)
    rows = connection.execute(
        """
        SELECT anchor_ref, COUNT(*) as mention_count
        FROM mentions
        WHERE dataset_id = ?
        GROUP BY anchor_ref
        """,
        (dataset_id,),
    ).fetchall()

    for row in rows:
        if row["anchor_ref"]:
            stats[row["anchor_ref"]]["mentions"] = row["mention_count"]

    # Get node counts per lesson via mentions (target_type = 'node')
    rows = connection.execute(
        """
        SELECT anchor_ref, COUNT(DISTINCT target_id) as node_count
        FROM mentions
        WHERE dataset_id = ? AND target_type = 'node'
        GROUP BY anchor_ref
        """,
        (dataset_id,),
    ).fetchall()

    for row in rows:
        if row["anchor_ref"]:
            stats[row["anchor_ref"]]["nodes"] = row["node_count"]

    return dict(stats)


def check_completeness(
    manifest: dict,
    sqlite_stats: dict[str, dict[str, int]],
    min_evidence: int = 1,
    min_nodes: int = 1,
) -> dict[str, Any]:
    """Check extraction completeness for all manifest batches.

    Returns:
        {
            "complete": [anchors],
            "partial": [{anchor, stats, missing}],
            "missing": [anchors],
            "extra_sqlite": [anchors],
        }
    """
    manifest_anchors = {batch["anchor_id"] for batch in manifest.get("batches", [])}
    sqlite_anchors = set(sqlite_stats.keys())

    result = {
        "complete": [],
        "partial": [],
        "missing": [],
        "extra_sqlite": [],
        "summary": {
            "total_manifest": len(manifest_anchors),
            "total_sqlite": len(sqlite_anchors),
            "complete_count": 0,
            "partial_count": 0,
            "missing_count": 0,
        },
    }

    # Check manifest lessons
    for batch in manifest.get("batches", []):
        anchor = batch["anchor_id"]
        stats = sqlite_stats.get(
            anchor, {"nodes": 0, "profiles": 0, "evidence": 0, "mentions": 0}
        )

        # Determine completeness
        has_nodes = stats["nodes"] >= min_nodes
        has_profiles = stats["profiles"] >= min_nodes
        has_evidence = stats["evidence"] >= min_evidence

        if has_nodes and has_profiles and has_evidence:
            result["complete"].append(
                {
                    "anchor": anchor,
                    "kind": batch.get("kind"),
                    "title": batch.get("title"),
                    "stats": stats,
                }
            )
            result["summary"]["complete_count"] += 1
        elif stats["nodes"] > 0 or stats["evidence"] > 0:
            result["partial"].append(
                {
                    "anchor": anchor,
                    "kind": batch.get("kind"),
                    "title": batch.get("title"),
                    "stats": stats,
                    "missing": {
                        "nodes": min_nodes - stats["nodes"] if not has_nodes else 0,
                        "profiles": min_nodes - stats["profiles"]
                        if not has_profiles
                        else 0,
                        "evidence": min_evidence - stats["evidence"]
                        if not has_evidence
                        else 0,
                    },
                }
            )
            result["summary"]["partial_count"] += 1
        else:
            result["missing"].append(
                {
                    "anchor": anchor,
                    "kind": batch.get("kind"),
                    "title": batch.get("title"),
                }
            )
            result["summary"]["missing_count"] += 1

    # Find extra SQLite lessons not in manifest
    for anchor in sqlite_anchors:
        if anchor not in manifest_anchors:
            result["extra_sqlite"].append(
                {
                    "anchor": anchor,
                    "stats": sqlite_stats[anchor],
                }
            )

    return result


def print_report(result: dict[str, Any], verbose: bool = False) -> None:
    """Print human-readable completeness report."""
    print("\n" + "=" * 70)
    print("EXTRACTION COMPLETENESS REPORT")
    print("=" * 70)

    summary = result["summary"]
    print(f"\nSummary:")
    print(f"  Total lessons in manifest: {summary['total_manifest']}")
    print(f"  Total lessons in SQLite:   {summary['total_sqlite']}")
    print(f"  ✓ Complete:  {summary['complete_count']}")
    print(f"  ⚠ Partial:   {summary['partial_count']}")
    print(f"  ✗ Missing:   {summary['missing_count']}")

    if result["complete"]:
        print(f"\n✓ COMPLETE ({len(result['complete'])}):")
        for item in result["complete"][:5]:
            stats = item["stats"]
            print(
                f"  - {extract_anchor_lesson(item['anchor'])}: "
                f"{stats['nodes']} nodes, {stats['evidence']} evidence"
            )
        if len(result["complete"]) > 5:
            print(f"  ... and {len(result['complete']) - 5} more")

    if result["partial"]:
        print(f"\n⚠ PARTIAL ({len(result['partial'])}):")
        for item in result["partial"]:
            stats = item["stats"]
            missing = item["missing"]
            print(f"  - {extract_anchor_lesson(item['anchor'])}: {item['title']}")
            print(f"    Stats: {stats['nodes']} nodes, {stats['evidence']} evidence")
            if missing["nodes"] > 0:
                print(f"    Missing: {missing['nodes']} nodes")
            if missing["evidence"] > 0:
                print(f"    Missing: {missing['evidence']} evidence")

    if result["missing"]:
        print(f"\n✗ MISSING ({len(result['missing'])}):")
        for item in result["missing"]:
            print(f"  - {extract_anchor_lesson(item['anchor'])}: {item['title']}")

    if result["extra_sqlite"]:
        print(f"\n⚠ EXTRA IN SQLITE (not in manifest) ({len(result['extra_sqlite'])}):")
        for item in result["extra_sqlite"][:5]:
            stats = item["stats"]
            print(
                f"  - {extract_anchor_lesson(item['anchor'])}: "
                f"{stats['nodes']} nodes, {stats['evidence']} evidence"
            )
        if len(result["extra_sqlite"]) > 5:
            print(f"  ... and {len(result['extra_sqlite']) - 5} more")

    print("\n" + "=" * 70)

    if result["missing"] or result["partial"]:
        print("❌ EXTRACTION INCOMPLETE")
        print("\nAction required:")
        if result["missing"]:
            print(f"  1. Extract {len(result['missing'])} missing lesson(s)")
        if result["partial"]:
            print(f"  2. Re-extract {len(result['partial'])} incomplete lesson(s)")
    else:
        print("✅ EXTRACTION COMPLETE")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Check extraction completeness: verify all lessons extracted."
    )
    parser.add_argument(
        "--manifest",
        required=True,
        help="Path to pipeline manifest JSON",
    )
    parser.add_argument(
        "--db",
        default=str(DEFAULT_DB_PATH),
        help="Path to SQLite database",
    )
    parser.add_argument(
        "--dataset-id",
        help="Dataset ID (defaults to extracting from manifest book_id)",
    )
    parser.add_argument(
        "--min-evidence",
        type=int,
        default=1,
        help="Minimum evidence records per lesson (default: 1)",
    )
    parser.add_argument(
        "--min-nodes",
        type=int,
        default=1,
        help="Minimum nodes per lesson (default: 1)",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Show detailed per-lesson statistics",
    )
    parser.add_argument(
        "--output-json",
        help="Write report to JSON file",
    )
    parser.add_argument(
        "--fail-on-incomplete",
        action="store_true",
        help="Exit with error code if any lessons are missing or partial",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    manifest_path = Path(args.manifest).expanduser().resolve()
    if not manifest_path.exists():
        print(f"Error: Manifest not found: {manifest_path}", file=sys.stderr)
        return 1

    db_path = Path(args.db).expanduser().resolve()
    if not db_path.exists():
        print(f"Error: Database not found: {db_path}", file=sys.stderr)
        return 1

    manifest = load_manifest(manifest_path)
    dataset_id = args.dataset_id or manifest.get("book_id", "v4")

    print(f"Checking extraction completeness...")
    print(f"Manifest: {manifest_path}")
    print(f"Database: {db_path}")
    print(f"Dataset ID: {dataset_id}")

    conn = connect_db(db_path)

    # Verify dataset exists
    dataset_count = conn.execute(
        "SELECT COUNT(*) FROM datasets WHERE dataset_id = ?", (dataset_id,)
    ).fetchone()[0]

    if dataset_count == 0:
        print(f"Warning: Dataset '{dataset_id}' not found in database", file=sys.stderr)

    sqlite_stats = get_sqlite_lesson_stats(conn, dataset_id)
    conn.close()

    result = check_completeness(
        manifest,
        sqlite_stats,
        min_evidence=args.min_evidence,
        min_nodes=args.min_nodes,
    )

    print_report(result, verbose=args.verbose)

    if args.output_json:
        report = {
            "manifest_path": str(manifest_path),
            "database_path": str(db_path),
            "dataset_id": dataset_id,
            "summary": result["summary"],
            "complete": result["complete"],
            "partial": result["partial"],
            "missing": result["missing"],
            "extra_sqlite": result["extra_sqlite"],
        }
        with open(args.output_json, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        print(f"\nReport written to: {args.output_json}")

    if args.fail_on_incomplete and (result["missing"] or result["partial"]):
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
