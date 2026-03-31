#!/usr/bin/env python3
"""Run the SQLite-first batch pipeline for one lesson anchor."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

from knowledge_store_common import resolve_outline_anchor


REPO_ROOT = Path(__file__).resolve().parent.parent


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Apply batch artifacts, run coverage, finalize runtime, and run strict QA."
    )
    parser.add_argument("--root", required=True, help="Versioned output root, for example data/v5")
    parser.add_argument("--book-id", required=True)
    parser.add_argument("--batch-anchor", required=True, help="Outline anchor id for the batch")
    parser.add_argument("--db", default=str(REPO_ROOT / "storage" / "knowledge.sqlite"))
    parser.add_argument("--dataset-id")
    parser.add_argument("--manifest")
    parser.add_argument("--require-node-cards", action="store_true")
    parser.add_argument("--fail-on-warning", action="store_true")
    parser.add_argument("--skip-apply", action="store_true")
    parser.add_argument("--skip-coverage", action="store_true")
    parser.add_argument("--skip-finalize-sync", action="store_true")
    parser.add_argument("--skip-promote", action="store_true")
    parser.add_argument("--include-candidate", action="store_true")
    parser.add_argument("--skip-sqlite-qa", action="store_true")
    parser.add_argument("--skip-strict-qa", action="store_true")
    return parser.parse_args()


def run_step(args: list[str]) -> None:
    subprocess.run(args, check=True)


def mark_manifest(
    manifest_path: Path | None,
    stage: str,
    status: str,
    anchor: str,
    note: str | None = None,
) -> None:
    if manifest_path is None:
        return
    cmd = [
        sys.executable,
        str(REPO_ROOT / "scripts" / "pipeline_manifest.py"),
        "mark",
        "--manifest",
        str(manifest_path),
        "--stage",
        stage,
        "--status",
        status,
        "--anchors",
        anchor,
    ]
    if note:
        cmd.extend(["--note", note])
    run_step(cmd)


def main() -> int:
    args = parse_args()
    root = Path(args.root).expanduser().resolve()
    batch_anchor = resolve_outline_anchor(args.book_id, args.batch_anchor, strict=True)
    manifest_path = (
        Path(args.manifest).expanduser().resolve()
        if args.manifest
        else (root / "runs" / f"{args.book_id}.pipeline.json")
    )
    if not manifest_path.exists():
        manifest_path = None

    dataset_args: list[str] = ["--dataset-id", args.dataset_id] if args.dataset_id else []

    try:
        if not args.skip_apply:
            mark_manifest(manifest_path, "backbone", "in_progress", batch_anchor)
            run_step(
                [
                    sys.executable,
                    str(REPO_ROOT / "scripts" / "apply_batch_artifacts.py"),
                    "--root",
                    str(root),
                    "--book-id",
                    args.book_id,
                    "--batch-anchor",
                    batch_anchor,
                    "--db",
                    args.db,
                    *dataset_args,
                ]
            )
        if not args.skip_coverage:
            run_step(
                [
                    sys.executable,
                    str(REPO_ROOT / "scripts" / "batch_coverage.py"),
                    "--root",
                    str(root),
                    "--book-id",
                    args.book_id,
                    "--anchors",
                    batch_anchor,
                    *(["--require-node-cards"] if args.require_node_cards else []),
                    *(["--fail-on-warning"] if args.fail_on_warning else []),
                ]
            )
        if not args.skip_apply:
            mark_manifest(manifest_path, "backbone", "completed", batch_anchor)

        mark_manifest(manifest_path, "normalize", "in_progress", batch_anchor)
        finalize_cmd = [
            sys.executable,
            str(REPO_ROOT / "scripts" / "finalize_batch_runtime.py"),
            "--root",
            str(root),
            "--book-id",
            args.book_id,
            "--batch-anchor",
            batch_anchor,
            "--db",
            args.db,
            *dataset_args,
        ]
        if args.skip_finalize_sync:
            finalize_cmd.append("--skip-sync")
        if args.skip_promote:
            finalize_cmd.append("--skip-promote")
        if args.include_candidate:
            finalize_cmd.append("--include-candidate")
        if args.skip_sqlite_qa:
            finalize_cmd.append("--skip-sqlite-qa")
        run_step(finalize_cmd)
        mark_manifest(manifest_path, "normalize", "completed", batch_anchor)

        mark_manifest(manifest_path, "qa", "in_progress", batch_anchor)
        if not args.skip_strict_qa:
            strict_qa_cmd = [
                sys.executable,
                str(REPO_ROOT / "scripts" / "strict_qa.py"),
                "--root",
                str(root),
                "--book-id",
                args.book_id,
                *(["--fail-on-warning"] if args.fail_on_warning else []),
            ]
            run_step(strict_qa_cmd)
        mark_manifest(manifest_path, "qa", "completed", batch_anchor)
        return 0
    except subprocess.CalledProcessError as exc:
        note = f"Command failed with exit {exc.returncode}: {' '.join(exc.cmd)}"
        if manifest_path is not None:
            for stage in ("qa", "normalize", "backbone"):
                try:
                    mark_manifest(manifest_path, stage, "blocked", batch_anchor, note)
                    break
                except subprocess.CalledProcessError:
                    continue
        return exc.returncode


if __name__ == "__main__":
    raise SystemExit(main())
