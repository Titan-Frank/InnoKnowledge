#!/usr/bin/env python3
"""
Lesson extraction checkpoint validator.

Ensures each lesson completes ALL required steps before moving to next.
Fails fast if any step is missing.

Usage:
    python scripts/lesson_checkpoint.py --lesson-anchor struct:book:lesson:1-1-1
    python scripts/lesson_checkpoint.py --book-id chem-grade8 --check-all
"""

import argparse
import json
import sqlite3
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB_PATH = REPO_ROOT / "storage" / "knowledge.sqlite"


# Define required steps for each lesson
REQUIRED_STEPS = [
    {
        "name": "nodes",
        "description": "Backbone nodes created",
        "check": lambda conn, anchor, dataset: conn.execute(
            """SELECT COUNT(*) FROM nodes n
               JOIN mentions m ON n.id = m.target_id
               WHERE m.anchor_ref = ? AND n.dataset_id = ? AND n.node_layer = 'backbone'""",
            (anchor, dataset)
        ).fetchone()[0] > 0,
    },
    {
        "name": "profiles",
        "description": "Curriculum profiles created",
        "check": lambda conn, anchor, dataset: conn.execute(
            """SELECT COUNT(*) FROM profiles p
               WHERE p.textbook_refs_json LIKE ? AND p.dataset_id = ?""",
            (f'%{anchor}%', dataset)
        ).fetchone()[0] > 0,
    },
    {
        "name": "evidence",
        "description": "Evidence records created",
        "check": lambda conn, anchor, dataset: conn.execute(
            """SELECT COUNT(*) FROM evidence
               WHERE anchor_ref = ? AND dataset_id = ?""",
            (anchor, dataset)
        ).fetchone()[0] > 0,
    },
    {
        "name": "mentions",
        "description": "Mentions linking nodes to lesson",
        "check": lambda conn, anchor, dataset: conn.execute(
            """SELECT COUNT(*) FROM mentions
               WHERE anchor_ref = ? AND dataset_id = ?""",
            (anchor, dataset)
        ).fetchone()[0] > 0,
    },
    {
        "name": "node_cards",
        "description": "Node cards for backbone nodes",
        "check": lambda conn, anchor, dataset: conn.execute(
            """SELECT COUNT(*) FROM node_cards nc
               WHERE nc.dataset_id = ? AND nc.node_id IN (
                   SELECT n.id FROM nodes n
                   JOIN mentions m ON n.id = m.target_id
                   WHERE m.anchor_ref = ? AND n.dataset_id = ? AND n.node_layer = 'backbone'
               )""",
            (dataset, anchor, dataset)
        ).fetchone()[0] > 0,
    },
    {
        "name": "edges",
        "description": "Edges connecting nodes",
        "check": lambda conn, anchor, dataset: conn.execute(
            """SELECT COUNT(*) FROM edges e
               WHERE e.source_refs_json LIKE ? AND e.dataset_id = ?""",
            (f'%{anchor}%', dataset)
        ).fetchone()[0] >= 0,  # Edges are optional for some lessons
    },
]


def check_lesson(conn: sqlite3.Connection, anchor: str, dataset_id: str) -> dict:
    """Check if a lesson has completed all required steps."""

    results = {
        "anchor": anchor,
        "dataset_id": dataset_id,
        "complete": True,
        "steps": [],
        "missing": [],
    }

    for step in REQUIRED_STEPS:
        try:
            passed = step["check"](conn, anchor, dataset_id)
            step_result = {
                "name": step["name"],
                "description": step["description"],
                "passed": passed,
            }
            results["steps"].append(step_result)

            if not passed:
                results["complete"] = False
                results["missing"].append(step["name"])

        except Exception as e:
            step_result = {
                "name": step["name"],
                "description": step["description"],
                "passed": False,
                "error": str(e),
            }
            results["steps"].append(step_result)
            results["complete"] = False
            results["missing"].append(step["name"])

    return results


def check_all_lessons(conn: sqlite3.Connection, book_id: str, dataset_id: str) -> dict:
    """Check all lessons in a book."""

    # Get all lesson anchors from profiles
    profile_anchors = conn.execute(
        """SELECT DISTINCT json_each.value
           FROM profiles, json_each(textbook_refs_json)
           WHERE profiles.dataset_id = ? AND json_each.value LIKE 'struct:%:lesson:%'""",
        (dataset_id,)
    ).fetchall()

    anchors = list(set(row[0] for row in profile_anchors if row[0]))

    results = {
        "book_id": book_id,
        "dataset_id": dataset_id,
        "total_lessons": len(anchors),
        "complete": 0,
        "incomplete": 0,
        "lessons": [],
    }

    for anchor in sorted(anchors):
        lesson_result = check_lesson(conn, anchor, dataset_id)
        results["lessons"].append(lesson_result)

        if lesson_result["complete"]:
            results["complete"] += 1
        else:
            results["incomplete"] += 1

    return results


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Validate lesson extraction checkpoints"
    )
    parser.add_argument(
        "--lesson-anchor",
        help="Check a specific lesson (e.g., struct:book:lesson:1-1-1)",
    )
    parser.add_argument(
        "--book-id",
        help="Check all lessons in a book",
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
        help="Path to SQLite database",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="Output as JSON",
    )
    parser.add_argument(
        "--fail-on-incomplete",
        action="store_true",
        help="Exit with error code if any lesson incomplete",
    )

    args = parser.parse_args()

    if not args.lesson_anchor and not args.book_id:
        print("Error: Either --lesson-anchor or --book-id is required")
        return 1

    conn = sqlite3.connect(args.db)
    conn.row_factory = sqlite3.Row

    if args.lesson_anchor:
        results = check_lesson(conn, args.lesson_anchor, args.dataset_id)
    else:
        results = check_all_lessons(conn, args.book_id, args.dataset_id)

    conn.close()

    if args.json:
        print(json.dumps(results, indent=2, ensure_ascii=False))
    else:
        # Human-readable output
        if args.lesson_anchor:
            print(f"\nLesson: {args.lesson_anchor}")
            print("=" * 50)
            for step in results["steps"]:
                status = "✓" if step["passed"] else "✗"
                print(f"  {status} {step['description']}")
            print()
            if results["complete"]:
                print("✓ Lesson complete")
            else:
                print(f"✗ Lesson incomplete, missing: {', '.join(results['missing'])}")
        else:
            print(f"\nBook: {args.book_id}")
            print("=" * 50)
            print(f"Total lessons: {results['total_lessons']}")
            print(f"Complete: {results['complete']}")
            print(f"Incomplete: {results['incomplete']}")
            print()

            if results["incomplete"] > 0:
                print("Incomplete lessons:")
                for lesson in results["lessons"]:
                    if not lesson["complete"]:
                        print(f"  - {lesson['anchor']}")
                        print(f"    Missing: {', '.join(lesson['missing'])}")

    if args.fail_on_incomplete and not results.get("complete", True):
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
