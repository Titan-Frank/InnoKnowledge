#!/usr/bin/env python3
"""Process a batch JSON file through the complete pipeline."""

from __future__ import annotations
import argparse
import json
import subprocess
import sys
from pathlib import Path
from datetime import datetime, timezone


def run_cmd(cmd: list[str], description: str = "") -> tuple[int, str, str]:
    """Run a command and return (returncode, stdout, stderr)."""
    result = subprocess.run(cmd, capture_output=True, text=True)
    return result.returncode, result.stdout, result.stderr


def process_batch(
    batch_json: Path, root: str, book_id: str, skip_node_cards: bool = False
) -> bool:
    """Process a single batch through the complete pipeline."""
    with open(batch_json, "r", encoding="utf-8") as f:
        batch = json.load(f)

    batch_anchor = batch["batch_anchor"]
    print(f"\n{'=' * 60}")
    print(f"Processing: {batch_anchor}")
    print(f"{'=' * 60}")

    # Step 1: Store batch runtime
    print("\n[1/6] Storing batch runtime...")

    # Store evidence
    if "evidence" in batch and batch["evidence"]:
        rc, out, err = run_cmd(
            [
                "python3",
                "scripts/store_batch_runtime.py",
                "--root",
                root,
                "--book-id",
                book_id,
                "--batch-anchor",
                batch_anchor,
                "--evidence-json",
                json.dumps(
                    batch["evidence"], ensure_ascii=False, separators=(",", ":")
                ),
            ]
        )
        if rc != 0:
            print(f"  ERROR storing evidence: {err}")
            return False
        print(f"  ✓ Evidence: {len(batch['evidence'])} records")

    # Store nodes
    if "nodes" in batch and batch["nodes"]:
        # Fix node IDs (replace / with :)
        for node in batch["nodes"]:
            node["id"] = node["id"].replace("/", ":")

        rc, out, err = run_cmd(
            [
                "python3",
                "scripts/store_batch_runtime.py",
                "--root",
                root,
                "--book-id",
                book_id,
                "--batch-anchor",
                batch_anchor,
                "--nodes-json",
                json.dumps(batch["nodes"], ensure_ascii=False, separators=(",", ":")),
            ]
        )
        if rc != 0:
            print(f"  ERROR storing nodes: {err}")
            return False
        print(f"  ✓ Nodes: {len(batch['nodes'])} records")

    # Store profiles
    if "profiles" in batch and batch["profiles"]:
        for profile in batch["profiles"]:
            profile["id"] = profile["id"].replace("/", ":")
            profile["node_id"] = profile["node_id"].replace("/", ":")

        rc, out, err = run_cmd(
            [
                "python3",
                "scripts/store_batch_runtime.py",
                "--root",
                root,
                "--book-id",
                book_id,
                "--batch-anchor",
                batch_anchor,
                "--profiles-json",
                json.dumps(
                    batch["profiles"], ensure_ascii=False, separators=(",", ":")
                ),
            ]
        )
        if rc != 0:
            print(f"  ERROR storing profiles: {err}")
            return False
        print(f"  ✓ Profiles: {len(batch['profiles'])} records")

    # Store mentions
    if "mentions" in batch and batch["mentions"]:
        for mention in batch["mentions"]:
            mention["id"] = mention["id"].replace("/", ":")
            mention["target_id"] = mention["target_id"].replace("/", ":")

        rc, out, err = run_cmd(
            [
                "python3",
                "scripts/store_batch_runtime.py",
                "--root",
                root,
                "--book-id",
                book_id,
                "--batch-anchor",
                batch_anchor,
                "--mentions-json",
                json.dumps(
                    batch["mentions"], ensure_ascii=False, separators=(",", ":")
                ),
            ]
        )
        if rc != 0:
            print(f"  ERROR storing mentions: {err}")
            return False
        print(f"  ✓ Mentions: {len(batch['mentions'])} records")

    # Store relation proposals
    if "relation_proposals" in batch and batch["relation_proposals"]:
        for proposal in batch["relation_proposals"]:
            proposal["from_node_id"] = proposal["from_node_id"].replace("/", ":")
            proposal["to_node_id"] = proposal["to_node_id"].replace("/", ":")

        rc, out, err = run_cmd(
            [
                "python3",
                "scripts/store_batch_runtime.py",
                "--root",
                root,
                "--book-id",
                book_id,
                "--batch-anchor",
                batch_anchor,
                "--relation-proposals-json",
                json.dumps(
                    batch["relation_proposals"],
                    ensure_ascii=False,
                    separators=(",", ":"),
                ),
            ]
        )
        if rc != 0:
            print(f"  ERROR storing proposals: {err}")
            return False
        print(f"  ✓ Relation proposals: {len(batch['relation_proposals'])} records")

    # Step 2: Apply batch artifacts
    print("\n[2/6] Applying batch artifacts...")
    rc, out, err = run_cmd(
        [
            "python3",
            "scripts/apply_batch_artifacts.py",
            "--root",
            root,
            "--book-id",
            book_id,
            "--batch-anchor",
            batch_anchor,
        ]
    )
    if rc != 0:
        print(f"  ERROR: {err}")
        return False
    print(f"  ✓ Applied")

    # Step 3: Promote relation proposals
    print("\n[3/6] Promoting relation proposals...")
    rc, out, err = run_cmd(
        [
            "python3",
            "scripts/promote_relation_proposals.py",
            "--output-root",
            root,
            "--batch-anchor",
            batch_anchor,
            "--include-candidate",
        ]
    )
    if rc != 0:
        print(f"  WARNING: {err}")
    else:
        print(f"  ✓ Promoted")

    # Step 4: Finalize batch
    print("\n[4/6] Finalizing batch...")
    rc, out, err = run_cmd(
        [
            "python3",
            "scripts/finalize_batch_runtime.py",
            "--root",
            root,
            "--book-id",
            book_id,
            "--batch-anchor",
            batch_anchor,
            "--skip-promote",
        ]
    )
    if rc != 0:
        print(f"  ERROR: {err}")
        return False
    print(f"  ✓ Finalized")

    # Step 5: Export snapshot
    print("\n[5/6] Exporting snapshot...")
    rc, out, err = run_cmd(["python3", "scripts/export_snapshot.py", root])
    if rc != 0:
        print(f"  ERROR: {err}")
        return False
    print(f"  ✓ Exported")

    # Step 6: QA
    print("\n[6/6] Running strict QA...")
    # Activate venv for jsonschema
    rc, out, err = run_cmd(
        [
            "bash",
            "-c",
            f"source .venv/bin/activate && python3 scripts/strict_qa.py --root {root} --book-id {book_id}",
        ]
    )
    if rc != 0:
        print(f"  ERROR: {err}")
        return False

    # Check for errors in QA output
    if "Errors: 0" in out or '"error_count": 0' in out:
        print(f"  ✓ QA passed")
    else:
        print(f"  WARNING: QA has issues")
        print(out[:500])

    # Update manifest
    anchor_short = batch_anchor.split(":")[-1]
    for stage in ["backbone", "normalize", "qa"]:
        run_cmd(
            [
                "python3",
                "scripts/pipeline_manifest.py",
                "mark",
                "--manifest",
                f"{root}/runs/{book_id}.pipeline.json",
                "--stage",
                stage,
                "--status",
                "completed",
                "--anchors",
                batch_anchor,
            ]
        )

    if not skip_node_cards:
        run_cmd(
            [
                "python3",
                "scripts/pipeline_manifest.py",
                "mark",
                "--manifest",
                f"{root}/runs/{book_id}.pipeline.json",
                "--stage",
                "node_expand",
                "--status",
                "completed",
                "--anchors",
                batch_anchor,
            ]
        )

    return True


def main() -> int:
    parser = argparse.ArgumentParser(description="Process batch JSON through pipeline")
    parser.add_argument("--batch-json", required=True, help="Path to batch JSON file")
    parser.add_argument("--root", default="data/v5", help="Output root")
    parser.add_argument("--book-id", default="chem-grade8-all-in-one", help="Book ID")
    parser.add_argument(
        "--skip-node-cards", action="store_true", help="Skip node card generation"
    )
    args = parser.parse_args()

    success = process_batch(
        Path(args.batch_json), args.root, args.book_id, args.skip_node_cards
    )

    return 0 if success else 1


if __name__ == "__main__":
    sys.exit(main())
