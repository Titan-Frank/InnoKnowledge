#!/usr/bin/env python3
"""
Maintain a machine-checkable manifest for strict kg-pipeline runs.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path


RUN_STAGE_NAMES = ("outline", "framework", "pattern", "final_qa")
BATCH_STAGE_NAMES = ("backbone", "normalize", "qa", "node_expand")
REQUIRED_BATCH_STAGE_NAMES = ("backbone", "normalize", "qa")
VALID_STATUSES = {
    "pending",
    "in_progress",
    "completed",
    "blocked",
    "not_requested",
    "missing",
}


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def load_json(path: Path) -> dict:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def manifest_path_for(root: Path, book_id: str) -> Path:
    return root / "runs" / f"{book_id}.pipeline.json"


def normalize_stage_name(stage: str) -> str:
    return stage.replace("-", "_")


def split_csv(value: str | None) -> list[str]:
    if not value:
        return []
    return [item.strip() for item in value.split(",") if item.strip()]


def batch_stage_template() -> dict:
    return {stage: "pending" for stage in REQUIRED_BATCH_STAGE_NAMES} | {
        "node_expand": "not_requested"
    }


def make_batch(item: dict) -> dict:
    return {
        "anchor_id": item["id"],
        "kind": item["kind"],
        "label": item["label"],
        "title": item["title"],
        "page_start": item["page_start"],
        "status": "pending",
        "stages": batch_stage_template(),
        "notes": [],
        "updated_at": now_iso(),
    }


def compute_batch_status(batch: dict) -> str:
    required_statuses = [batch["stages"][stage] for stage in REQUIRED_BATCH_STAGE_NAMES]
    if any(status == "blocked" for status in required_statuses):
        return "blocked"
    if all(status == "completed" for status in required_statuses):
        return "completed"
    if any(status == "in_progress" for status in required_statuses):
        return "in_progress"
    if any(status == "completed" for status in required_statuses):
        return "in_progress"
    return "pending"


def compute_run_status(manifest: dict) -> str:
    run_stage_statuses = [
        manifest["run_stages"][stage]["status"] for stage in RUN_STAGE_NAMES
    ]
    batch_statuses = [batch["status"] for batch in manifest["batches"]]
    if any(status in {"blocked", "missing"} for status in run_stage_statuses):
        return "blocked"
    if any(status == "blocked" for status in batch_statuses):
        return "blocked"
    if all(
        manifest["run_stages"][stage]["status"] == "completed"
        for stage in RUN_STAGE_NAMES
    ) and all(status == "completed" for status in batch_statuses):
        return "completed"
    if any(
        status in {"completed", "in_progress"} for status in run_stage_statuses
    ) or any(status in {"completed", "in_progress"} for status in batch_statuses):
        return "in_progress"
    return "initialized"


def find_batches(outline: dict, anchors: list[str], kinds: list[str]) -> list[dict]:
    # Support both 'structure' (current) and 'items' (legacy) field names
    items = outline.get("structure", outline.get("items", []))
    if anchors:
        by_id = {item["id"]: item for item in items}
        missing = [anchor for anchor in anchors if anchor not in by_id]
        if missing:
            raise ValueError(f"Unknown outline anchors: {', '.join(missing)}")
        return [by_id[anchor] for anchor in anchors]

    selected = [item for item in items if item["kind"] in set(kinds)]
    if not selected:
        raise ValueError(
            "No outline items matched the requested batch kinds. "
            "Use --anchors or broaden --kinds."
        )
    return selected


def validate_manifest(manifest: dict) -> list[str]:
    errors: list[str] = []

    for stage in RUN_STAGE_NAMES:
        status = manifest["run_stages"].get(stage, {}).get("status")
        if status not in VALID_STATUSES:
            errors.append(f"Run stage '{stage}' has invalid status '{status}'.")

    seen_anchors: set[str] = set()
    for batch in manifest.get("batches", []):
        anchor_id = batch.get("anchor_id")
        if not anchor_id:
            errors.append("Batch is missing anchor_id.")
            continue
        if anchor_id in seen_anchors:
            errors.append(f"Duplicate batch anchor '{anchor_id}'.")
        seen_anchors.add(anchor_id)

        stages = batch.get("stages", {})
        for stage in BATCH_STAGE_NAMES:
            status = stages.get(stage)
            if status not in VALID_STATUSES:
                errors.append(
                    f"Batch '{anchor_id}' stage '{stage}' has invalid status '{status}'."
                )

        if (
            stages.get("normalize") == "completed"
            and stages.get("backbone") != "completed"
        ):
            errors.append(
                f"Batch '{anchor_id}' completed normalize before backbone was completed."
            )
        if stages.get("qa") == "completed" and stages.get("normalize") != "completed":
            errors.append(
                f"Batch '{anchor_id}' completed QA before normalize was completed."
            )
        if stages.get("node_expand") == "completed" and stages.get("qa") != "completed":
            errors.append(
                f"Batch '{anchor_id}' completed node_expand before QA was completed."
            )

    return errors


def save_manifest(path: Path, manifest: dict) -> None:
    for batch in manifest["batches"]:
        batch["status"] = compute_batch_status(batch)
    manifest["status"] = compute_run_status(manifest)
    manifest["updated_at"] = now_iso()
    write_json(path, manifest)


def cmd_init(args: argparse.Namespace) -> int:
    root = Path(args.root)
    manifest_path = (
        Path(args.manifest) if args.manifest else manifest_path_for(root, args.book_id)
    )
    if manifest_path.exists() and not args.force:
        print(f"Manifest already exists: {manifest_path}", file=sys.stderr)
        print("Use --force to overwrite it.", file=sys.stderr)
        return 1

    outline_path = Path(args.outline or f"data/outlines/{args.book_id}.outline.json")
    if not outline_path.exists():
        print(f"Outline not found: {outline_path}", file=sys.stderr)
        return 1

    outline = load_json(outline_path)
    batch_items = find_batches(outline, split_csv(args.anchors), split_csv(args.kinds))
    framework_path = Path(args.framework)
    pattern_path = Path(args.pattern)

    manifest = {
        "book_id": args.book_id,
        "output_root": str(root),
        "outline_path": str(outline_path),
        "framework_path": str(framework_path),
        "pattern_path": str(pattern_path),
        "strict_mode": True,
        "created_at": now_iso(),
        "updated_at": now_iso(),
        "status": "initialized",
        "run_stages": {
            "outline": {"status": "completed", "path": str(outline_path)},
            "framework": {
                "status": "completed" if framework_path.exists() else "missing",
                "path": str(framework_path),
            },
            "pattern": {
                "status": "completed" if pattern_path.exists() else "missing",
                "path": str(pattern_path),
            },
            "final_qa": {"status": "pending"},
        },
        "batches": [make_batch(item) for item in batch_items],
    }

    save_manifest(manifest_path, manifest)
    print(f"Wrote manifest: {manifest_path}")
    print(f"Batches: {len(manifest['batches'])}")
    return 0


def cmd_mark(args: argparse.Namespace) -> int:
    manifest_path = Path(args.manifest)
    manifest = load_json(manifest_path)
    updated_manifest = json.loads(json.dumps(manifest))
    stage = normalize_stage_name(args.stage)
    status = args.status
    if status not in VALID_STATUSES:
        print(f"Invalid status '{status}'.", file=sys.stderr)
        return 1

    if stage in RUN_STAGE_NAMES:
        updated_manifest["run_stages"][stage]["status"] = status
        updated_manifest["run_stages"][stage]["updated_at"] = now_iso()
        if args.note:
            updated_manifest["run_stages"][stage]["note"] = args.note
    elif stage in BATCH_STAGE_NAMES:
        anchors = split_csv(args.anchors)
        if args.all_batches:
            targets = updated_manifest["batches"]
        else:
            if not anchors:
                print(
                    "Batch stage updates require --anchors or --all-batches.",
                    file=sys.stderr,
                )
                return 1
            by_anchor = {
                batch["anchor_id"]: batch for batch in updated_manifest["batches"]
            }
            missing = [anchor for anchor in anchors if anchor not in by_anchor]
            if missing:
                print(
                    f"Unknown batch anchors in manifest: {', '.join(missing)}",
                    file=sys.stderr,
                )
                return 1
            targets = [by_anchor[anchor] for anchor in anchors]

        for batch in targets:
            batch["stages"][stage] = status
            batch["updated_at"] = now_iso()
            if args.note:
                batch["notes"].append(
                    {
                        "at": now_iso(),
                        "stage": stage,
                        "status": status,
                        "note": args.note,
                    }
                )
    else:
        print(f"Unknown stage '{args.stage}'.", file=sys.stderr)
        return 1

    errors = validate_manifest(updated_manifest)
    if errors:
        print("Manifest update rejected due to consistency issues:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    save_manifest(manifest_path, updated_manifest)
    print(f"Updated manifest: {manifest_path}")
    print(f"Run status: {updated_manifest['status']}")
    return 0


def cmd_check(args: argparse.Namespace) -> int:
    manifest_path = Path(args.manifest)
    manifest = load_json(manifest_path)

    errors = validate_manifest(manifest)
    for stage in ("outline", "framework", "pattern"):
        status = manifest["run_stages"][stage]["status"]
        if status != "completed":
            errors.append(f"Run stage '{stage}' is '{status}', expected 'completed'.")

    for batch in manifest["batches"]:
        anchor_id = batch["anchor_id"]
        for stage in REQUIRED_BATCH_STAGE_NAMES:
            status = batch["stages"][stage]
            if status != "completed":
                errors.append(f"Batch '{anchor_id}' stage '{stage}' is '{status}'.")

    if (
        args.require_final_qa
        and manifest["run_stages"]["final_qa"]["status"] != "completed"
    ):
        errors.append(
            "Run stage 'final_qa' is "
            f"'{manifest['run_stages']['final_qa']['status']}', expected 'completed'."
        )

    if errors:
        print(f"Manifest check failed: {manifest_path}", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print(f"Manifest check passed: {manifest_path}")
    print(f"Batches completed: {len(manifest['batches'])}/{len(manifest['batches'])}")
    return 0


def cmd_status(args: argparse.Namespace) -> int:
    manifest = load_json(Path(args.manifest))
    print(f"Manifest: {args.manifest}")
    print(f"Book: {manifest['book_id']}")
    print(f"Output root: {manifest['output_root']}")
    print(f"Run status: {manifest['status']}")
    for stage in RUN_STAGE_NAMES:
        print(f"- run.{stage}: {manifest['run_stages'][stage]['status']}")
    print("Batches:")
    for batch in manifest["batches"]:
        print(
            f"- {batch['anchor_id']} [{batch['kind']}] {batch['status']} "
            f"(backbone={batch['stages']['backbone']}, "
            f"normalize={batch['stages']['normalize']}, qa={batch['stages']['qa']}, "
            f"node_expand={batch['stages']['node_expand']})"
        )
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    subparsers = parser.add_subparsers(dest="command", required=True)

    init_parser = subparsers.add_parser(
        "init", help="Create a new strict pipeline manifest."
    )
    init_parser.add_argument(
        "--root", required=True, help="Versioned output root, e.g. data/v4"
    )
    init_parser.add_argument("--book-id", required=True)
    init_parser.add_argument(
        "--outline",
        help="Outline path. Defaults to data/outlines/<book-id>.outline.json",
    )
    init_parser.add_argument("--manifest", help="Explicit manifest path.")
    init_parser.add_argument(
        "--anchors",
        help="Comma-separated outline anchors to include. If omitted, --kinds is used.",
    )
    init_parser.add_argument(
        "--kinds",
        default="lesson,review,activity",
        help="Comma-separated outline kinds used when --anchors is omitted.",
    )
    init_parser.add_argument(
        "--framework",
        default="data/frameworks/junior-chemistry-framework.json",
        help="Framework path recorded in the manifest.",
    )
    init_parser.add_argument(
        "--pattern",
        default="data/patterns/unified-knowledge-patterns.v2.json",
        help="Pattern library path recorded in the manifest.",
    )
    init_parser.add_argument("--force", action="store_true")
    init_parser.set_defaults(func=cmd_init)

    mark_parser = subparsers.add_parser(
        "mark", help="Update stage status in a manifest."
    )
    mark_parser.add_argument("--manifest", required=True)
    mark_parser.add_argument("--stage", required=True)
    mark_parser.add_argument("--status", required=True)
    mark_parser.add_argument("--anchors", help="Comma-separated batch anchors.")
    mark_parser.add_argument("--all-batches", action="store_true")
    mark_parser.add_argument("--note")
    mark_parser.set_defaults(func=cmd_mark)

    check_parser = subparsers.add_parser(
        "check", help="Verify all required stages are complete."
    )
    check_parser.add_argument("--manifest", required=True)
    check_parser.add_argument("--require-final-qa", action="store_true")
    check_parser.set_defaults(func=cmd_check)

    status_parser = subparsers.add_parser("status", help="Show manifest status.")
    status_parser.add_argument("--manifest", required=True)
    status_parser.set_defaults(func=cmd_status)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main())
