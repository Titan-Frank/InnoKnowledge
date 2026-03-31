#!/usr/bin/env python3
"""Finalize one batch's SQLite runtime flow for opencode-driven pipeline runs."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
import tempfile
from pathlib import Path

from knowledge_store_common import (
    DEFAULT_DB_PATH,
    connect_db,
    ensure_sqlite_schema,
    load_batch_runtime_records,
    require_dataset_row,
    resolve_dataset_id,
    resolve_outline_anchor,
    resolve_runtime_artifact_path,
    runtime_relation_proposals_path,
)


REPO_ROOT = Path(__file__).resolve().parent.parent


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Sync output root, store relation proposals, promote edges, and run SQLite QA."
    )
    parser.add_argument("--root", required=True, help="Versioned output root, for example data/v5")
    parser.add_argument("--book-id", required=True)
    parser.add_argument("--batch-anchor", required=True)
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH))
    parser.add_argument("--dataset-id")
    parser.add_argument(
        "--proposal-file",
        help="Optional explicit relation proposal JSONL path. Defaults to runs/runtime artifact path.",
    )
    parser.add_argument(
        "--skip-sync",
        action="store_true",
        help="Skip syncing the output root into SQLite before storing/promoting proposals.",
    )
    parser.add_argument(
        "--skip-promote",
        action="store_true",
        help="Skip promoting accepted proposals into canonical edges.",
    )
    parser.add_argument(
        "--skip-sqlite-qa",
        action="store_true",
        help="Skip sqlite_import_qa after finishing the batch runtime flow.",
    )
    parser.add_argument(
        "--skip-export-snapshot",
        action="store_true",
        help="Skip exporting the SQLite dataset back into the output-root snapshot.",
    )
    parser.add_argument(
        "--include-candidate",
        action="store_true",
        help="Allow promote_relation_proposals to also consider candidate proposals.",
    )
    return parser.parse_args()


def run_step(args: list[str]) -> None:
    subprocess.run(args, check=True)


def main() -> int:
    args = parse_args()
    root = Path(args.root).expanduser().resolve()
    resolved_batch_anchor = resolve_outline_anchor(args.book_id, args.batch_anchor, strict=False)
    connection = connect_db(args.db)
    ensure_sqlite_schema(connection)
    dataset_id = resolve_dataset_id(connection, args.dataset_id, root)
    require_dataset_row(connection, dataset_id)
    proposal_path = (
        Path(args.proposal_file).expanduser().resolve()
        if args.proposal_file
        else resolve_runtime_artifact_path(
            root,
            args.book_id,
            args.batch_anchor,
            runtime_relation_proposals_path,
        )
    )

    common = [sys.executable]
    dataset_args: list[str] = ["--dataset-id", dataset_id]
    temp_proposal_path: Path | None = None
    if not proposal_path.exists():
        runtime_proposals = load_batch_runtime_records(
            connection,
            dataset_id,
            args.book_id,
            resolved_batch_anchor,
            "relation_proposal",
        )
        if runtime_proposals:
            handle = tempfile.NamedTemporaryFile(
                prefix="relation-proposals-",
                suffix=".jsonl",
                delete=False,
                mode="w",
                encoding="utf-8",
            )
            with handle:
                for record in runtime_proposals:
                    handle.write(json.dumps(record, ensure_ascii=False) + "\n")
            temp_proposal_path = Path(handle.name)
            proposal_path = temp_proposal_path

    try:
        if not args.skip_sync:
            run_step(
                common
                + [
                    str(REPO_ROOT / "scripts" / "sync_output_root_to_sqlite.py"),
                    str(root),
                    "--db",
                    args.db,
                    "--replace",
                    "--activate",
                    "--preserve-runtime",
                    *dataset_args,
                ]
            )

        if proposal_path.exists():
            run_step(
                common
                + [
                    str(REPO_ROOT / "scripts" / "store_relation_proposals.py"),
                    "--db",
                    args.db,
                    "--input",
                    str(proposal_path),
                    "--replace",
                    *dataset_args,
                ]
            )

            if not args.skip_promote:
                promote_args = common + [
                    str(REPO_ROOT / "scripts" / "promote_relation_proposals.py"),
                    "--db",
                    args.db,
                    "--batch-anchor",
                    resolved_batch_anchor,
                    *dataset_args,
                ]
                if args.include_candidate:
                    promote_args.append("--include-candidate")
                run_step(promote_args)
        else:
            print(f"No relation proposal file found for batch: {proposal_path}")

        if not args.skip_export_snapshot:
            run_step(
                common
                + [
                    str(REPO_ROOT / "scripts" / "export_snapshot.py"),
                    str(root),
                    "--db",
                    args.db,
                    *dataset_args,
                ]
            )

        if not args.skip_sqlite_qa:
            run_step(
                common
                + [
                    str(REPO_ROOT / "scripts" / "sqlite_import_qa.py"),
                    "--db",
                    args.db,
                    "--output-root",
                    str(root),
                    *dataset_args,
                ]
            )
    finally:
        if temp_proposal_path is not None and temp_proposal_path.exists():
            temp_proposal_path.unlink()

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
