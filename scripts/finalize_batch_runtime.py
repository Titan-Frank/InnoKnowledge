#!/usr/bin/env python3
"""Finalize one batch's SQLite runtime flow for opencode-driven pipeline runs."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

from knowledge_store_common import (
    DEFAULT_DB_PATH,
    connect_db,
    ensure_sqlite_schema,
    require_dataset_row,
    resolve_dataset_id,
    resolve_outline_anchor,
)


REPO_ROOT = Path(__file__).resolve().parent.parent


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Finalize relation proposals, promotion, and SQLite QA for one batch."
    )
    parser.add_argument("--root", required=True, help="Versioned output root, for example data/v5")
    parser.add_argument("--book-id", required=True)
    parser.add_argument("--batch-anchor", required=True)
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH))
    parser.add_argument("--dataset-id")
    parser.add_argument(
        "--proposal-file",
        help="Optional explicit relation proposal JSONL path.",
    )
    parser.add_argument(
        "--sync-from-snapshot",
        action="store_true",
        help="Sync the output-root snapshot into SQLite before storing/promoting proposals.",
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
        "--export-snapshot",
        action="store_true",
        help="Export the SQLite dataset back into the output-root snapshot.",
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
    proposal_path = Path(args.proposal_file).expanduser().resolve() if args.proposal_file else None

    common = [sys.executable]
    dataset_args: list[str] = ["--dataset-id", dataset_id]

    if args.sync_from_snapshot:
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

    if proposal_path is not None and proposal_path.exists():
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
    elif proposal_path is None:
        runtime_cmd = common + [
            str(REPO_ROOT / "scripts" / "store_relation_proposals.py"),
            "--db",
            args.db,
            "--runtime-book-id",
            args.book_id,
            "--runtime-batch-anchor",
            resolved_batch_anchor,
            "--default-status",
            "accepted",
            "--replace",
            *dataset_args,
        ]
        runtime_result = subprocess.run(runtime_cmd, capture_output=True, text=True)
        if runtime_result.returncode == 0:
            if runtime_result.stdout:
                print(runtime_result.stdout, end="")
        elif "No relation_proposal runtime records found" in (
            (runtime_result.stderr or "") + (runtime_result.stdout or "")
        ):
            print(f"No relation proposals staged for batch: {resolved_batch_anchor}")
        else:
            raise subprocess.CalledProcessError(
                runtime_result.returncode,
                runtime_cmd,
                output=runtime_result.stdout,
                stderr=runtime_result.stderr,
            )
    else:
        raise SystemExit(f"Proposal file not found: {proposal_path}")

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

    if args.export_snapshot:
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
        sqlite_qa_cmd = common + [
            str(REPO_ROOT / "scripts" / "sqlite_import_qa.py"),
            "--db",
            args.db,
            *dataset_args,
        ]
        if args.export_snapshot:
            sqlite_qa_cmd.extend(["--output-root", str(root)])
        run_step(sqlite_qa_cmd)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
