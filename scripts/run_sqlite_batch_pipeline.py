#!/usr/bin/env python3
"""Run the SQLite-first batch pipeline for one lesson anchor."""

from __future__ import annotations

import argparse
import subprocess
import sys
from pathlib import Path

from knowledge_store_common import load_outline_items, resolve_outline_anchor


REPO_ROOT = Path(__file__).resolve().parent.parent


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the SQLite-native lesson closeout pipeline: coverage, normalize, and strict QA."
    )
    parser.add_argument(
        "--root", required=True, help="Versioned output root, for example data/v5"
    )
    parser.add_argument("--book-id", required=True)
    parser.add_argument(
        "--batch-anchor", required=True, help="Outline anchor id for the batch"
    )
    parser.add_argument("--db", default=str(REPO_ROOT / "storage" / "knowledge.sqlite"))
    parser.add_argument("--dataset-id")
    parser.add_argument("--manifest")
    parser.add_argument("--require-node-cards", action="store_true")
    parser.add_argument("--fail-on-warning", action="store_true")
    parser.add_argument("--skip-coverage", action="store_true")
    parser.add_argument(
        "--skip-apply",
        action="store_true",
        help="Deprecated. The SQLite-native pipeline no longer has an apply stage.",
    )
    parser.add_argument("--skip-strict-qa", action="store_true")
    parser.add_argument(
        "--skip-local-subgraph",
        action="store_true",
        help="Skip the local retrieval-neighborhood analysis step.",
    )
    parser.add_argument(
        "--local-subgraph-hops",
        type=int,
        choices=(1, 2),
        default=1,
        help="Hop depth for automatic local subgraph expansion.",
    )
    parser.add_argument(
        "--local-subgraph-max-neighbors",
        type=int,
        default=12,
        help="Per-frontier-node neighbor cap for local subgraph expansion.",
    )
    parser.add_argument(
        "--local-subgraph-top-k",
        type=int,
        default=8,
        help="Maximum number of retrieval seed nodes to expand.",
    )
    parser.add_argument(
        "--local-subgraph-query-id",
        action="append",
        dest="local_subgraph_query_ids",
        help="Optional retrieval query id(s) to narrow the automatic local subgraph step.",
    )
    parser.add_argument(
        "--local-subgraph-node-id",
        action="append",
        dest="local_subgraph_node_ids",
        help="Optional explicit seed node id(s) for the automatic local subgraph step.",
    )
    parser.add_argument(
        "--skip-batch-group-rollup",
        action="store_true",
        help="Skip the thematic normalization roll-up step.",
    )
    parser.add_argument(
        "--batch-group-anchors",
        help=(
            "Optional comma-separated outline anchor ids for a thematic roll-up. "
            "If omitted, the pipeline auto-selects a recent same-kind window ending at the current batch."
        ),
    )
    parser.add_argument(
        "--batch-group-size",
        type=int,
        default=3,
        help=(
            "Auto-selected roll-up window size ending at the current batch anchor. "
            "Use 0 or 1 to disable automatic selection."
        ),
    )
    parser.add_argument(
        "--batch-group-top-n",
        type=int,
        default=15,
        help="Maximum number of items to keep per batch-group roll-up section.",
    )
    return parser.parse_args()


def run_step(args: list[str]) -> None:
    subprocess.run(args, check=True)


def split_csv(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def anchor_kind(anchor: str) -> str | None:
    parts = anchor.split(":", 3)
    if len(parts) < 4:
        return None
    return parts[2]


def resolve_batch_group_anchors(
    book_id: str,
    batch_anchor: str,
    explicit_anchors: str | None,
    window_size: int,
) -> list[str]:
    explicit = split_csv(explicit_anchors)
    if explicit:
        return [
            resolve_outline_anchor(book_id, anchor, strict=True) for anchor in explicit
        ]

    if window_size < 2:
        return []

    kind = anchor_kind(batch_anchor)
    outline_items = load_outline_items(book_id)
    ordered_ids = []
    for item in outline_items:
        item_id = item.get("id")
        if not item_id:
            continue
        if kind is not None and anchor_kind(item_id) != kind:
            continue
        ordered_ids.append(item_id)

    if batch_anchor not in ordered_ids:
        return []

    end_index = ordered_ids.index(batch_anchor) + 1
    start_index = max(0, end_index - window_size)
    return ordered_ids[start_index:end_index]


def run_local_subgraph(
    parsed_args: argparse.Namespace,
    root: Path,
    batch_anchor: str,
    dataset_args: list[str],
) -> None:
    cmd = [
        sys.executable,
        str(REPO_ROOT / "scripts" / "local_subgraph.py"),
        "--output-root",
        str(root),
        "--book-id",
        parsed_args.book_id,
        "--batch-anchor",
        batch_anchor,
        "--db",
        parsed_args.db,
        "--top-k",
        str(parsed_args.local_subgraph_top_k),
        "--hops",
        str(parsed_args.local_subgraph_hops),
        "--max-neighbors",
        str(parsed_args.local_subgraph_max_neighbors),
        "--allow-empty",
        *dataset_args,
    ]
    for query_id in parsed_args.local_subgraph_query_ids or []:
        cmd.extend(["--query-id", query_id])
    for node_id in parsed_args.local_subgraph_node_ids or []:
        cmd.extend(["--node-id", node_id])
    run_step(cmd)


def run_batch_group_rollup(
    parsed_args: argparse.Namespace,
    root: Path,
    batch_anchor: str,
    dataset_args: list[str],
) -> None:
    anchors = resolve_batch_group_anchors(
        parsed_args.book_id,
        batch_anchor,
        parsed_args.batch_group_anchors,
        parsed_args.batch_group_size,
    )
    if not anchors:
        print("Batch group roll-up skipped: no eligible anchor window was resolved.")
        return
    if not parsed_args.batch_group_anchors and len(anchors) < 2:
        print(
            "Batch group roll-up skipped: fewer than two anchors are available in the current window."
        )
        return

    run_step(
        [
            sys.executable,
            str(REPO_ROOT / "scripts" / "batch_group_rollup.py"),
            "--root",
            str(root),
            "--book-id",
            parsed_args.book_id,
            "--anchors",
            ",".join(anchors),
            "--db",
            parsed_args.db,
            "--top-n",
            str(parsed_args.batch_group_top_n),
            *dataset_args,
        ]
    )


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

    dataset_args: list[str] = (
        ["--dataset-id", args.dataset_id] if args.dataset_id else []
    )

    try:
        mark_manifest(manifest_path, "backbone", "in_progress", batch_anchor)
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
                    "--db",
                    args.db,
                    *dataset_args,
                    *(["--require-node-cards"] if args.require_node_cards else []),
                    *(["--fail-on-warning"] if args.fail_on_warning else []),
                ]
            )
        if not args.skip_local_subgraph:
            run_local_subgraph(args, root, batch_anchor, dataset_args)
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
        run_step(finalize_cmd)
        mark_manifest(manifest_path, "normalize", "completed", batch_anchor)

        mark_manifest(manifest_path, "qa", "in_progress", batch_anchor)
        if not args.skip_strict_qa:
            strict_qa_cmd = [
                sys.executable,
                str(REPO_ROOT / "scripts" / "strict_qa_sqlite.py"),
                "--dataset-id",
                args.dataset_id or root.name,
                "--db",
                args.db,
                "--scope",
                batch_anchor,
                *(["--fail-on-warning"] if args.fail_on_warning else []),
            ]
            run_step(strict_qa_cmd)
        if not args.skip_batch_group_rollup:
            run_batch_group_rollup(args, root, batch_anchor, dataset_args)
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
