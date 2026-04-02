#!/usr/bin/env python3
"""Load batch artifacts from a JSON file and store them to SQLite."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description="Load batch JSON to SQLite")
    parser.add_argument("--root", required=True, help="Output root, e.g. data/v5")
    parser.add_argument("--book-id", required=True)
    parser.add_argument("--batch-json", required=True, help="Path to batch JSON file")
    parser.add_argument("--db", default="storage/knowledge.sqlite")
    args = parser.parse_args()

    with open(args.batch_json, "r", encoding="utf-8") as f:
        batch = json.load(f)

    batch_anchor = batch["batch_anchor"]
    book_id = batch["book_id"]

    # Store each artifact type
    artifact_types = [
        ("evidence", "evidence-json"),
        ("nodes", "nodes-json"),
        ("profiles", "profiles-json"),
        ("mentions", "mentions-json"),
        ("relation_proposals", "relation-proposals-json"),
    ]

    for key, arg_name in artifact_types:
        if key not in batch:
            continue
        data = batch[key]
        if not data:
            continue

        json_str = json.dumps(data, ensure_ascii=False, separators=(",", ":"))
        cmd = [
            "python3",
            "scripts/store_batch_runtime.py",
            "--root",
            args.root,
            "--book-id",
            book_id,
            "--batch-anchor",
            batch_anchor,
            f"--{arg_name}",
            json_str,
        ]
        if args.db:
            cmd.extend(["--db", args.db])

        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            print(f"Error storing {key}: {result.stderr}")
            return 1
        print(result.stdout.strip())

    print(f"Batch {batch_anchor} stored successfully")
    return 0


if __name__ == "__main__":
    sys.exit(main())
