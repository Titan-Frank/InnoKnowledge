#!/usr/bin/env python3
"""Run the project-local OKM harness workflow."""

from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from harness.okm_harness import HarnessRuntime, load_workflow
from harness.okm_harness.runtime import StageExecutionError


def load_dotenv_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not key:
            continue
        os.environ.setdefault(key, value.strip())


def parse_key_value(raw: str) -> tuple[str, str]:
    if "=" not in raw:
        raise argparse.ArgumentTypeError(
            f"Expected KEY=VALUE format, got: {raw}"
        )
    key, value = raw.split("=", 1)
    if not key.strip():
        raise argparse.ArgumentTypeError(f"Invalid empty key in: {raw}")
    return key.strip(), value


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run the Open Knowledge Map specialized harness workflow."
    )
    parser.add_argument(
        "--workflow",
        default=str(REPO_ROOT / "harness" / "workflows" / "knowledge_extraction.yaml"),
        help="Path to workflow YAML.",
    )
    parser.add_argument("--manifest-path", help="Optional explicit manifest output path.")
    parser.add_argument("--book-id", required=True)
    parser.add_argument("--pdf-path", help="PDF used for outline creation when outline is missing.")
    parser.add_argument("--book-title", default="")
    parser.add_argument("--dataset-id", default="")
    parser.add_argument("--output-root", default="data/main")
    parser.add_argument("--parallelism", type=int, default=4)
    parser.add_argument("--outline-start-page", type=int, default=1)
    parser.add_argument("--outline-end-page", type=int, default=20)
    parser.add_argument("--no-chunks", action="store_true")
    parser.add_argument("--normalize-auto-merge", action="store_true")
    parser.add_argument("--skip-normalize", action="store_true")
    parser.add_argument("--skip-qa", action="store_true")
    parser.add_argument("--skip-integrity", action="store_true")
    parser.add_argument(
        "--set",
        dest="overrides",
        action="append",
        type=parse_key_value,
        default=[],
        help="Override any workflow context value via KEY=VALUE.",
    )
    return parser.parse_args()


def main() -> int:
    load_dotenv_file(REPO_ROOT / ".env")
    args = parse_args()
    workflow = load_workflow(args.workflow)
    context = {
        "book_id": args.book_id,
        "pdf_path": args.pdf_path or "",
        "book_title": args.book_title,
        "dataset_id": args.dataset_id,
        "output_root": args.output_root,
        "parallelism": args.parallelism,
        "outline_start_page": args.outline_start_page,
        "outline_end_page": args.outline_end_page,
        "no_chunks": args.no_chunks,
        "normalize_auto_merge": args.normalize_auto_merge,
        "skip_normalize": args.skip_normalize,
        "skip_qa": args.skip_qa,
        "skip_integrity": args.skip_integrity,
    }
    for key, value in args.overrides:
        context[key] = value

    runtime = HarnessRuntime(
        workflow,
        repo_root=REPO_ROOT,
        context=context,
        manifest_path=args.manifest_path,
    )
    try:
        manifest = runtime.run()
    except StageExecutionError:
        manifest = runtime.manifest
        print(
            json.dumps(
                {
                    "status": manifest.get("status", "blocked"),
                    "manifest_path": str(runtime.manifest_path),
                },
                ensure_ascii=False,
            )
        )
        return 2

    print(
        json.dumps(
            {
                "status": manifest.get("status", "completed"),
                "manifest_path": str(runtime.manifest_path),
            },
            ensure_ascii=False,
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
