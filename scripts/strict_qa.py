#!/usr/bin/env python3
"""
Strict QA for versioned knowledge graph outputs under data/<version>/.
"""

from __future__ import annotations

import argparse
import json
import re
import string
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path

from jsonschema import Draft202012Validator

from export_snapshot import (
    export_edges,
    export_evidence,
    export_mentions,
    export_node_cards,
    export_nodes,
    export_profiles,
)
from knowledge_store_common import (
    DEFAULT_DB_PATH,
    connect_db,
    ensure_sqlite_schema,
    require_dataset_row,
    resolve_dataset_id,
)


HIERARCHICAL_EDGE_TYPES = {
    "is_a",
    "instance_of",
    "contains",
    "part_of",
    "prerequisite_for",
    "depends_on",
    "extends",
}

SCHEMA_FILES = {
    "outline": "schemas/outline.schema.json",
    "node": "schemas/v2/node.schema.json",
    "edge": "schemas/v2/edge.schema.json",
    "profile": "schemas/v2/curriculum-profile.schema.json",
    "mention": "schemas/v2/mention.schema.json",
    "evidence": "schemas/v2/evidence.schema.json",
    "card": "schemas/v2/node-card.schema.json",
}

PUNCT_TRANSLATION = str.maketrans("", "", string.punctuation + "，。；：、“”‘’（）《》【】！？· ")


def now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def add_issue(
    issues: list[dict],
    severity: str,
    code: str,
    message: str,
    file: str,
    record_id: str | None = None,
) -> None:
    entry = {"severity": severity, "code": code, "message": message, "file": file}
    if record_id is not None:
        entry["record_id"] = record_id
    issues.append(entry)


def validate_records(
    validator: Draft202012Validator,
    records: list[dict],
    file_label: str,
    record_id_key: str,
    issues: list[dict],
) -> None:
    for index, record in enumerate(records, start=1):
        record_id = record.get(record_id_key, f"line:{index}")
        for error in validator.iter_errors(record):
            path = ".".join(str(part) for part in error.path)
            location = f"{record_id}" if not path else f"{record_id}.{path}"
            add_issue(
                issues,
                "error",
                "schema_validation",
                f"{location}: {error.message}",
                file_label,
                record_id=record_id,
            )


def check_duplicate_ids(
    records: list[dict], id_key: str, file_label: str, issues: list[dict]
) -> None:
    counter = Counter(record.get(id_key) for record in records if record.get(id_key))
    for record_id, count in counter.items():
        if count > 1:
            add_issue(
                issues,
                "error",
                "duplicate_id",
                f"Record id '{record_id}' appears {count} times.",
                file_label,
                record_id=record_id,
            )


def normalize_name(value: str) -> str:
    normalized = value.lower().translate(PUNCT_TRANSLATION)
    normalized = re.sub(r"\s+", "", normalized)
    return normalized


def detect_cycles(edges: list[dict]) -> list[tuple[str, list[str]]]:
    results: list[tuple[str, list[str]]] = []
    for edge_type in HIERARCHICAL_EDGE_TYPES:
        adjacency: dict[str, list[tuple[str, str]]] = defaultdict(list)
        for edge in edges:
            if edge.get("edge_type") != edge_type or edge.get("status") == "deprecated":
                continue
            adjacency[edge["from"]].append((edge["to"], edge["id"]))

        visited: set[str] = set()
        active: set[str] = set()
        stack: list[tuple[str, str | None]] = []
        found_cycle: list[str] | None = None

        def dfs(node: str) -> bool:
            nonlocal found_cycle
            visited.add(node)
            active.add(node)
            stack.append((node, None))
            for neighbor, edge_id in adjacency.get(node, []):
                if found_cycle:
                    return True
                if neighbor not in visited:
                    stack[-1] = (node, edge_id)
                    if dfs(neighbor):
                        return True
                elif neighbor in active:
                    cycle_nodes = [neighbor]
                    for stacked_node, _ in reversed(stack):
                        cycle_nodes.append(stacked_node)
                        if stacked_node == neighbor:
                            break
                    cycle_nodes.reverse()
                    cycle_nodes.append(neighbor)
                    found_cycle = cycle_nodes
                    return True
            stack.pop()
            active.remove(node)
            return False

        for start in list(adjacency):
            if start not in visited and dfs(start):
                break

        if found_cycle:
            results.append((edge_type, found_cycle))

    return results


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", required=True, help="Versioned output root, e.g. data/v4")
    parser.add_argument("--book-id", required=True)
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH))
    parser.add_argument("--dataset-id")
    parser.add_argument(
        "--outline",
        help="Outline path. Defaults to data/outlines/<book-id>.outline.json",
    )
    parser.add_argument(
        "--report",
        help="JSON report path. Defaults to <root>/qa/<book-id>.strict-qa.json",
    )
    parser.add_argument("--fail-on-warning", action="store_true")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    root = Path(args.root)
    connection = connect_db(args.db)
    ensure_sqlite_schema(connection)
    dataset_id = resolve_dataset_id(connection, args.dataset_id, root)
    require_dataset_row(connection, dataset_id)
    outline_path = Path(args.outline or f"data/outlines/{args.book_id}.outline.json")
    report_path = Path(args.report or root / "qa" / f"{args.book_id}.strict-qa.json")
    issues: list[dict] = []

    schema_validators = {
        name: Draft202012Validator(load_json(Path(path))) for name, path in SCHEMA_FILES.items()
    }

    if not outline_path.exists():
        add_issue(
            issues,
            "error",
            "missing_file",
            f"Outline file not found: {outline_path}",
            str(outline_path),
        )
        outline = None
        outline_item_ids: set[str] = set()
    else:
        outline = load_json(outline_path)
        for error in schema_validators["outline"].iter_errors(outline):
            add_issue(
                issues,
                "error",
                "schema_validation",
                error.message,
                str(outline_path),
            )
        outline_item_ids = {item["id"] for item in outline.get("items", [])}

    required_paths = {
        "nodes": root / "graph" / "knowledge.nodes.jsonl",
        "edges": root / "graph" / "knowledge.edges.jsonl",
        "profiles": root / "profiles" / "knowledge.profiles.jsonl",
        "mentions": root / "graph" / f"{args.book_id}.mentions.jsonl",
        "evidence": root / "graph" / f"{args.book_id}.evidence.jsonl",
    }
    loaded: dict[str, list[dict]] = {
        "nodes": export_nodes(connection, dataset_id),
        "edges": export_edges(connection, dataset_id),
        "profiles": export_profiles(connection, dataset_id),
        "mentions": [
            record
            for record in export_mentions(connection, dataset_id)
            if record.get("source_type") == "textbook" and record.get("source_id") == args.book_id
        ],
        "evidence": [
            record
            for record in export_evidence(connection, dataset_id)
            if record.get("source_type") == "textbook" and record.get("source_id") == args.book_id
        ],
    }
    all_evidence_ids = {
        record["id"] for record in export_evidence(connection, dataset_id) if record.get("id")
    }
    all_mention_ids = {
        record["id"] for record in export_mentions(connection, dataset_id) if record.get("id")
    }

    node_cards_dir = root / "node_cards"
    cards = export_node_cards(connection, dataset_id)
    card_store_label = f"{node_cards_dir} (sqlite)"

    validate_records(
        schema_validators["node"],
        loaded["nodes"],
        str(required_paths["nodes"]),
        "id",
        issues,
    )
    validate_records(
        schema_validators["edge"],
        loaded["edges"],
        str(required_paths["edges"]),
        "id",
        issues,
    )
    validate_records(
        schema_validators["profile"],
        loaded["profiles"],
        str(required_paths["profiles"]),
        "id",
        issues,
    )
    validate_records(
        schema_validators["mention"],
        loaded["mentions"],
        str(required_paths["mentions"]),
        "id",
        issues,
    )
    validate_records(
        schema_validators["evidence"],
        loaded["evidence"],
        str(required_paths["evidence"]),
        "id",
        issues,
    )
    validate_records(schema_validators["card"], cards, card_store_label, "node_id", issues)

    check_duplicate_ids(loaded["nodes"], "id", str(required_paths["nodes"]), issues)
    check_duplicate_ids(loaded["edges"], "id", str(required_paths["edges"]), issues)
    check_duplicate_ids(loaded["profiles"], "id", str(required_paths["profiles"]), issues)
    check_duplicate_ids(loaded["mentions"], "id", str(required_paths["mentions"]), issues)
    check_duplicate_ids(loaded["evidence"], "id", str(required_paths["evidence"]), issues)

    node_ids = {record["id"] for record in loaded["nodes"] if record.get("id")}
    edge_ids = {record["id"] for record in loaded["edges"] if record.get("id")}
    profile_ids = {record["id"] for record in loaded["profiles"] if record.get("id")}
    evidence_ids = {record["id"] for record in loaded["evidence"] if record.get("id")}
    card_ids = {record["id"] for record in cards if record.get("id")}
    card_ids.update(record["node_id"] for record in cards if record.get("node_id"))
    mention_ids = {record["id"] for record in loaded["mentions"] if record.get("id")}
    node_by_id = {record["id"]: record for record in loaded["nodes"] if record.get("id")}
    support_node_ids = {
        record["id"]
        for record in loaded["nodes"]
        if record.get("id") and record.get("node_layer") == "support"
    }

    if not all_evidence_ids:
        all_evidence_ids = set(evidence_ids)
    if not all_mention_ids:
        all_mention_ids = set(mention_ids)

    normalized_node_names: dict[tuple[str, str], list[str]] = defaultdict(list)
    for record in loaded["nodes"]:
        node_kind = record.get("node_kind")
        canonical_name = record.get("canonical_name")
        if node_kind and canonical_name:
            normalized_node_names[(node_kind, normalize_name(canonical_name))].append(record["id"])
        for profile_ref in record.get("profile_refs", []):
            if profile_ref not in profile_ids:
                add_issue(
                    issues,
                    "warning",
                    "dangling_profile_ref",
                    f"Node references missing profile '{profile_ref}'.",
                    str(required_paths["nodes"]),
                    record_id=record["id"],
                )
        card_ref = record.get("card_ref")
        if card_ref and card_ref not in card_ids:
            add_issue(
                issues,
                "warning",
                "dangling_card_ref",
                f"Node references missing card '{card_ref}'.",
                str(required_paths["nodes"]),
                record_id=record["id"],
            )

    for (node_kind, normalized_name), node_group in normalized_node_names.items():
        if normalized_name and len(node_group) > 1:
            add_issue(
                issues,
                "warning",
                "near_duplicate_nodes",
                f"Potential duplicate nodes for node_kind '{node_kind}': {', '.join(sorted(node_group))}",
                str(required_paths["nodes"]),
            )

    edge_signatures: dict[tuple[str, str, str], list[str]] = defaultdict(list)
    for record in loaded["edges"]:
        record_id = record.get("id")
        if not record_id:
            continue
        edge_signatures[(record["from"], record["to"], record["edge_type"])].append(record_id)
        if record["from"] not in node_ids:
            add_issue(
                issues,
                "error",
                "missing_edge_endpoint",
                f"Edge 'from' endpoint '{record['from']}' does not exist.",
                str(required_paths["edges"]),
                record_id=record_id,
            )
        if record["to"] not in node_ids:
            add_issue(
                issues,
                "error",
                "missing_edge_endpoint",
                f"Edge 'to' endpoint '{record['to']}' does not exist.",
                str(required_paths["edges"]),
                record_id=record_id,
            )
        for source_ref in record.get("source_refs", []):
            if source_ref not in all_evidence_ids:
                add_issue(
                    issues,
                    "error",
                    "missing_edge_evidence",
                    f"Edge references missing evidence '{source_ref}'.",
                    str(required_paths["edges"]),
                    record_id=record_id,
                )
        from_node = node_by_id.get(record["from"])
        to_node = node_by_id.get(record["to"])
        if record.get("backbone_expand") and from_node and to_node:
            node_layers = {from_node.get("node_layer"), to_node.get("node_layer")}
            if node_layers != {"backbone", "support"}:
                add_issue(
                    issues,
                    "warning",
                    "suspicious_backbone_expand",
                    "backbone_expand=true but endpoints are not one backbone node and one support node.",
                    str(required_paths["edges"]),
                    record_id=record_id,
                )

    for signature, ids in edge_signatures.items():
        if len(ids) > 1:
            add_issue(
                issues,
                "warning",
                "duplicate_edge_signature",
                f"Duplicate canonical edge signature {signature!r}: {', '.join(ids)}",
                str(required_paths["edges"]),
            )

    for edge_type, cycle in detect_cycles(loaded["edges"]):
        add_issue(
            issues,
            "error",
            "hierarchy_cycle",
            f"Detected {edge_type} cycle: {' -> '.join(cycle)}",
            str(required_paths["edges"]),
        )

    support_nodes_with_expand = set()
    support_nodes_with_backbone_neighbor = set()
    for record in loaded["edges"]:
        from_node = node_by_id.get(record.get("from"))
        to_node = node_by_id.get(record.get("to"))
        if not from_node or not to_node:
            continue
        node_layers = {from_node.get("node_layer"), to_node.get("node_layer")}
        if node_layers == {"backbone", "support"}:
            if from_node.get("node_layer") == "support":
                support_nodes_with_backbone_neighbor.add(from_node["id"])
                if record.get("backbone_expand"):
                    support_nodes_with_expand.add(from_node["id"])
            if to_node.get("node_layer") == "support":
                support_nodes_with_backbone_neighbor.add(to_node["id"])
                if record.get("backbone_expand"):
                    support_nodes_with_expand.add(to_node["id"])

    dangling_support_expand = sorted(
        support_nodes_with_backbone_neighbor - support_nodes_with_expand
    )
    for node_id in dangling_support_expand:
        add_issue(
            issues,
            "warning",
            "support_node_missing_backbone_expand",
            "Support node has a backbone neighbor but no connecting edge is marked backbone_expand.",
            str(required_paths["edges"]),
            record_id=node_id,
        )

    if support_node_ids and not support_nodes_with_expand:
        add_issue(
            issues,
            "warning",
            "no_support_expansion_edges",
            "Support nodes exist in the graph, but no edge is marked backbone_expand.",
            str(required_paths["edges"]),
        )

    for record in loaded["profiles"]:
        record_id = record.get("id")
        if record.get("node_id") not in node_ids:
            add_issue(
                issues,
                "error",
                "missing_profile_node",
                f"Profile node_id '{record.get('node_id')}' does not exist.",
                str(required_paths["profiles"]),
                record_id=record_id,
            )
        for source_ref in record.get("source_refs", []):
            if source_ref not in all_evidence_ids:
                add_issue(
                    issues,
                    "error",
                    "missing_profile_evidence",
                    f"Profile references missing evidence '{source_ref}'.",
                    str(required_paths["profiles"]),
                    record_id=record_id,
                )

    for record in loaded["evidence"]:
        record_id = record.get("id")
        if record.get("anchor_ref") not in outline_item_ids:
            add_issue(
                issues,
                "error",
                "missing_outline_anchor",
                f"Evidence anchor_ref '{record.get('anchor_ref')}' is not present in the outline.",
                str(required_paths["evidence"]),
                record_id=record_id,
            )
        if record.get("source_type") == "textbook" and record.get("source_id") != args.book_id:
            add_issue(
                issues,
                "warning",
                "book_id_mismatch",
                f"Evidence source_id '{record.get('source_id')}' does not match book '{args.book_id}'.",
                str(required_paths["evidence"]),
                record_id=record_id,
            )

    for record in loaded["mentions"]:
        record_id = record.get("id")
        target_type = record.get("target_type")
        target_id = record.get("target_id")
        if record.get("anchor_ref") not in outline_item_ids:
            add_issue(
                issues,
                "error",
                "missing_outline_anchor",
                f"Mention anchor_ref '{record.get('anchor_ref')}' is not present in the outline.",
                str(required_paths["mentions"]),
                record_id=record_id,
            )
        if record.get("source_type") == "textbook" and record.get("source_id") != args.book_id:
            add_issue(
                issues,
                "warning",
                "book_id_mismatch",
                f"Mention source_id '{record.get('source_id')}' does not match book '{args.book_id}'.",
                str(required_paths["mentions"]),
                record_id=record_id,
            )
        for source_ref in record.get("source_refs", []):
            if source_ref not in all_evidence_ids:
                add_issue(
                    issues,
                    "error",
                    "missing_mention_evidence",
                    f"Mention references missing evidence '{source_ref}'.",
                    str(required_paths["mentions"]),
                    record_id=record_id,
                )
        if target_type == "node" and target_id not in node_ids:
            add_issue(
                issues,
                "error",
                "missing_mention_target",
                f"Mention target node '{target_id}' does not exist.",
                str(required_paths["mentions"]),
                record_id=record_id,
            )
        elif target_type == "edge" and target_id not in edge_ids:
            add_issue(
                issues,
                "error",
                "missing_mention_target",
                f"Mention target edge '{target_id}' does not exist.",
                str(required_paths["mentions"]),
                record_id=record_id,
            )
        elif target_type == "profile" and target_id not in profile_ids:
            add_issue(
                issues,
                "error",
                "missing_mention_target",
                f"Mention target profile '{target_id}' does not exist.",
                str(required_paths["mentions"]),
                record_id=record_id,
            )
        elif target_type == "card" and target_id not in card_ids:
            add_issue(
                issues,
                "error",
                "missing_mention_target",
                f"Mention target card '{target_id}' does not exist.",
                str(required_paths["mentions"]),
                record_id=record_id,
            )

    cards_by_node: dict[str, list[dict]] = defaultdict(list)
    for card in cards:
        node_id = card.get("node_id")
        if node_id:
            cards_by_node[node_id].append(card)
        if node_id not in node_ids:
            add_issue(
                issues,
                "error",
                "missing_card_node",
                f"Node card references missing node '{node_id}'.",
                card_store_label,
                record_id=node_id,
            )
            continue
        if card.get("card_layer") != node_by_id[node_id].get("node_layer"):
            add_issue(
                issues,
                "error",
                "card_layer_mismatch",
                "Node card layer does not match the canonical node layer.",
                card_store_label,
                record_id=node_id,
            )
        for source_ref in card.get("source_refs", []):
            if source_ref not in all_evidence_ids:
                add_issue(
                    issues,
                    "error",
                    "missing_card_evidence",
                    f"Node card references missing evidence '{source_ref}'.",
                    card_store_label,
                    record_id=node_id,
                )
        for mention_ref in card.get("mention_refs", []):
            if mention_ref not in all_mention_ids:
                add_issue(
                    issues,
                    "warning",
                    "missing_card_mention",
                    f"Node card references missing mention '{mention_ref}'.",
                    card_store_label,
                    record_id=node_id,
                )
        for profile_ref in card.get("profile_refs", []):
            if profile_ref not in profile_ids:
                add_issue(
                    issues,
                    "warning",
                    "missing_card_profile",
                    f"Node card references missing profile '{profile_ref}'.",
                    card_store_label,
                    record_id=node_id,
                )
        for section in card.get("sections", []):
            for source_ref in section.get("source_refs", []):
                if source_ref not in all_evidence_ids:
                    add_issue(
                        issues,
                        "error",
                        "missing_section_evidence",
                        f"Section references missing evidence '{source_ref}'.",
                        card_store_label,
                        record_id=node_id,
                    )
            for related_node_ref in section.get("related_node_refs", []):
                if related_node_ref not in node_ids:
                    add_issue(
                        issues,
                        "warning",
                        "missing_related_node",
                        f"Section references missing related node '{related_node_ref}'.",
                        card_store_label,
                        record_id=node_id,
                    )

    for node_id, card_group in cards_by_node.items():
        if len(card_group) > 1:
            add_issue(
                issues,
                "error",
                "duplicate_node_card",
                f"Multiple node cards found for node '{node_id}'.",
                str(node_cards_dir),
                record_id=node_id,
            )

    errors = [issue for issue in issues if issue["severity"] == "error"]
    warnings = [issue for issue in issues if issue["severity"] == "warning"]
    report = {
        "generated_at": now_iso(),
        "book_id": args.book_id,
        "dataset_id": dataset_id,
        "output_root": str(root),
        "outline_path": str(outline_path),
        "counts": {
            "nodes": len(loaded["nodes"]),
            "edges": len(loaded["edges"]),
            "profiles": len(loaded["profiles"]),
            "mentions": len(loaded["mentions"]),
            "evidence": len(loaded["evidence"]),
            "node_cards": len(cards),
            "all_root_mentions": len(all_mention_ids),
            "all_root_evidence": len(all_evidence_ids),
        },
        "summary": {
            "passed": not errors and (not warnings or not args.fail_on_warning),
            "error_count": len(errors),
            "warning_count": len(warnings),
        },
        "errors": errors,
        "warnings": warnings,
    }
    write_json(report_path, report)

    print(f"Strict QA report: {report_path}")
    print(
        f"Counts: nodes={report['counts']['nodes']} edges={report['counts']['edges']} "
        f"profiles={report['counts']['profiles']} mentions={report['counts']['mentions']} "
        f"evidence={report['counts']['evidence']} node_cards={report['counts']['node_cards']}"
    )
    print(f"Errors: {len(errors)}")
    print(f"Warnings: {len(warnings)}")

    if errors or (warnings and args.fail_on_warning):
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
