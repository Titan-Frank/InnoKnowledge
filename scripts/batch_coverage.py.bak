#!/usr/bin/env python3
"""
Check batch-local mention/evidence coverage for one book and a set of outline anchors.
"""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from knowledge_store_common import load_evidence, load_mentions, load_node_cards_cards, load_nodes
from knowledge_store_common import (
    DEFAULT_DB_PATH,
    connect_db,
    ensure_sqlite_schema,
    require_dataset_row,
    resolve_dataset_id,
    resolve_outline_anchors,
)


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def split_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]

def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")

def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, help="Versioned output root, e.g. data/v4")
    parser.add_argument("--book-id", required=True)
    parser.add_argument("--anchors", required=True, help="Comma-separated outline anchor ids.")
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH))
    parser.add_argument("--dataset-id")
    parser.add_argument(
        "--report",
        help="JSON report path. Defaults to <root>/qa/<book-id>.<anchor-stem>.batch-coverage.json",
    )
    parser.add_argument("--require-node-cards", action="store_true")
    parser.add_argument("--fail-on-warning", action="store_true")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    root = Path(args.root)
    connection = connect_db(args.db)
    ensure_sqlite_schema(connection)
    dataset_id = resolve_dataset_id(connection, args.dataset_id, root)
    require_dataset_row(connection, dataset_id)
    anchors = resolve_outline_anchors(args.book_id, split_csv(args.anchors), strict=True)
    anchor_set = set(anchors)
    anchor_stem = "__".join(anchor.replace("struct:", "").replace(":", "-") for anchor in anchors[:4])
    if len(anchors) > 4:
        anchor_stem += "__more"
    report_path = Path(
        args.report or root / "qa" / f"{args.book_id}.{anchor_stem}.batch-coverage.json"
    )

    nodes = load_nodes(connection, dataset_id)
    mentions = [
        record
        for record in load_mentions(connection, dataset_id)
        if record.get("source_type") == "textbook" and record.get("source_id") == args.book_id
    ]
    evidence = [
        record
        for record in load_evidence(connection, dataset_id)
        if record.get("source_type") == "textbook" and record.get("source_id") == args.book_id
    ]
    node_card_ids = {record["node_id"] for record in load_node_cards_cards(connection, dataset_id)}
    node_by_id = {record["id"]: record for record in nodes if record.get("id")}
    evidence_by_id = {record["id"]: record for record in evidence if record.get("id")}

    scoped_mentions = [record for record in mentions if record.get("anchor_ref") in anchor_set]
    scoped_evidence = [record for record in evidence if record.get("anchor_ref") in anchor_set]

    errors: list[dict] = []
    warnings: list[dict] = []

    def add_issue(target: list[dict], code: str, message: str, record_id: str | None = None) -> None:
        issue = {"code": code, "message": message}
        if record_id is not None:
            issue["record_id"] = record_id
        target.append(issue)

    if not scoped_mentions:
        add_issue(errors, "no_batch_mentions", "No mentions were found for the requested anchors.")

    if not scoped_evidence:
        add_issue(errors, "no_batch_evidence", "No evidence records were found for the requested anchors.")

    valid_node_mentions: dict[str, list[dict]] = {}
    referenced_evidence_ids: set[str] = set()
    for mention in scoped_mentions:
        mention_id = mention.get("id")
        target_type = mention.get("target_type")
        target_id = mention.get("target_id")
        source_refs = mention.get("source_refs") or []

        if not source_refs:
            add_issue(errors, "mention_without_evidence", "Mention has no source_refs.", mention_id)
            continue

        missing_evidence = [ref for ref in source_refs if ref not in evidence_by_id]
        if missing_evidence:
            add_issue(
                errors,
                "mention_missing_evidence",
                f"Mention references missing evidence: {', '.join(missing_evidence)}",
                mention_id,
            )
            continue

        referenced_evidence_ids.update(source_refs)
        off_anchor_refs = [
            ref for ref in source_refs if evidence_by_id[ref].get("anchor_ref") not in anchor_set
        ]
        if off_anchor_refs:
            add_issue(
                warnings,
                "cross_anchor_evidence",
                f"Mention references evidence outside the current anchors: {', '.join(off_anchor_refs)}",
                mention_id,
            )

        if target_type == "node":
            if target_id not in node_by_id:
                add_issue(
                    errors,
                    "mention_target_missing_node",
                    f"Mention target node '{target_id}' does not exist.",
                    mention_id,
                )
                continue
            valid_node_mentions.setdefault(target_id, []).append(mention)

    for evidence_id in sorted(referenced_evidence_ids):
        evidence_record = evidence_by_id[evidence_id]
        if evidence_record.get("anchor_ref") not in anchor_set:
            add_issue(
                warnings,
                "cross_anchor_evidence",
                f"Evidence '{evidence_id}' is outside the requested anchors.",
                evidence_id,
            )

    backbone_node_ids = sorted(
        node_id
        for node_id in valid_node_mentions
        if node_by_id[node_id].get("node_layer") == "backbone"
    )
    support_node_ids = sorted(
        node_id
        for node_id in valid_node_mentions
        if node_by_id[node_id].get("node_layer") == "support"
    )

    missing_card_node_ids: list[str] = []
    for node_id in backbone_node_ids:
        if node_id not in node_card_ids:
            missing_card_node_ids.append(node_id)

    if args.require_node_cards and missing_card_node_ids:
        for node_id in missing_card_node_ids:
            add_issue(
                errors,
                "missing_backbone_node_card",
                "Backbone node in this batch has no node card yet.",
                node_id,
            )
    elif missing_card_node_ids:
        for node_id in missing_card_node_ids:
            add_issue(
                warnings,
                "missing_backbone_node_card",
                "Backbone node in this batch has no node card yet.",
                node_id,
            )

    report = {
        "generated_at": now_iso(),
        "book_id": args.book_id,
        "dataset_id": dataset_id,
        "output_root": str(root),
        "anchors": anchors,
        "counts": {
            "scoped_mentions": len(scoped_mentions),
            "scoped_evidence": len(scoped_evidence),
            "backbone_nodes_in_mentions": len(backbone_node_ids),
            "support_nodes_in_mentions": len(support_node_ids),
            "missing_backbone_node_cards": len(missing_card_node_ids),
        },
        "backbone_node_ids": backbone_node_ids,
        "support_node_ids": support_node_ids,
        "missing_backbone_node_cards": missing_card_node_ids,
        "errors": errors,
        "warnings": warnings,
    }
    write_json(report_path, report)

    print(f"Batch coverage report: {report_path}")
    print(
        f"Mentions={len(scoped_mentions)} Evidence={len(scoped_evidence)} "
        f"BackboneNodes={len(backbone_node_ids)} MissingCards={len(missing_card_node_ids)}"
    )
    print(f"Errors: {len(errors)}")
    print(f"Warnings: {len(warnings)}")

    if errors or (warnings and args.fail_on_warning):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
