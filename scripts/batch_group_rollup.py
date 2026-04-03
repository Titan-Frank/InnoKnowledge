#!/usr/bin/env python3
"""Generate a thematic normalization roll-up for a small group of batch anchors."""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from knowledge_store_common import (
    DEFAULT_DB_PATH,
    connect_db,
    ensure_sqlite_schema,
    require_dataset_row,
    resolve_dataset_id,
    resolve_outline_anchors,
    safe_path_token,
    utc_now,
)


PUNCT_TRANSLATION = str.maketrans("", "", r"""'".,;:!?()[]{}<>/\|-_+*=~`@#$%^&，。；：、“”‘’（）《》【】！？· """)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate a thematic roll-up for a small group of lesson anchors."
    )
    parser.add_argument("--root", required=True, help="Versioned output root, for example data/v4")
    parser.add_argument("--book-id", required=True)
    parser.add_argument("--anchors", required=True, help="Comma-separated outline anchor ids.")
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH))
    parser.add_argument("--dataset-id")
    parser.add_argument("--top-n", type=int, default=15)
    parser.add_argument(
        "--report",
        help="Optional JSON report path. Defaults under <root>/qa/.",
    )
    return parser.parse_args()


def split_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def load_json_array(text: str | None) -> list[Any]:
    if not text:
        return []
    return json.loads(text)


def normalize_name(value: str) -> str:
    normalized = value.lower().translate(PUNCT_TRANSLATION)
    normalized = re.sub(r"\s+", "", normalized)
    return normalized


def default_report_path(root: Path, book_id: str, anchors: list[str]) -> Path:
    anchor_stem = "__".join(
        safe_path_token(anchor.replace("struct:", "")) for anchor in anchors[:4]
    )
    if len(anchors) > 4:
        anchor_stem += "__more"
    return root / "qa" / f"{safe_path_token(book_id)}.{anchor_stem}.batch-group-rollup.json"


def fetch_mentions(connection, dataset_id: str, book_id: str, anchors: list[str]) -> list[dict[str, Any]]:
    rows = connection.execute(
        f"""
        SELECT *
        FROM mentions
        WHERE dataset_id = ?
          AND source_type = 'textbook'
          AND source_id = ?
          AND anchor_ref IN ({','.join('?' for _ in anchors)})
        ORDER BY anchor_ref, id
        """,
        (dataset_id, book_id, *anchors),
    ).fetchall()
    return [
        {
            "id": row["id"],
            "anchor_ref": row["anchor_ref"],
            "target_type": row["target_type"],
            "target_id": row["target_id"],
            "role": row["role"],
            "source_refs": load_json_array(row["source_refs_json"]),
            "confidence": row["confidence"],
        }
        for row in rows
    ]


def fetch_evidence(connection, dataset_id: str, book_id: str, anchors: list[str]) -> list[dict[str, Any]]:
    rows = connection.execute(
        f"""
        SELECT *
        FROM evidence
        WHERE dataset_id = ?
          AND source_type = 'textbook'
          AND source_id = ?
          AND anchor_ref IN ({','.join('?' for _ in anchors)})
        ORDER BY anchor_ref, id
        """,
        (dataset_id, book_id, *anchors),
    ).fetchall()
    return [
        {
            "id": row["id"],
            "anchor_ref": row["anchor_ref"],
            "locator": row["locator"],
            "page_start": row["page_start"],
            "page_end": row["page_end"],
            "normalized_claims": load_json_array(row["normalized_claims_json"]),
        }
        for row in rows
    ]


def fetch_relation_proposals(connection, dataset_id: str, anchors: list[str]) -> list[dict[str, Any]]:
    rows = connection.execute(
        f"""
        SELECT *
        FROM relation_proposals
        WHERE dataset_id = ?
          AND batch_anchor IN ({','.join('?' for _ in anchors)})
        ORDER BY batch_anchor, proposal_id
        """,
        (dataset_id, *anchors),
    ).fetchall()
    return [
        {
            "proposal_id": row["proposal_id"],
            "batch_anchor": row["batch_anchor"],
            "from_node_id": row["from_node_id"],
            "to_node_id": row["to_node_id"],
            "edge_type": row["edge_type"],
            "confidence": row["confidence"],
            "status": row["status"],
            "conflict_type": row["conflict_type"],
            "evidence_refs": load_json_array(row["evidence_refs_json"]),
        }
        for row in rows
    ]


def fetch_retrieval_rows(connection, dataset_id: str, anchors: list[str]) -> list[dict[str, Any]]:
    rows = connection.execute(
        f"""
        SELECT batch_anchor, query_id, query_text, candidate_node_id, rank, score, retrieval_method
        FROM retrieval_candidates
        WHERE dataset_id = ?
          AND batch_anchor IN ({','.join('?' for _ in anchors)})
        ORDER BY batch_anchor, query_id, rank, candidate_node_id
        """,
        (dataset_id, *anchors),
    ).fetchall()
    return [dict(row) for row in rows]


def fetch_nodes(connection, dataset_id: str, node_ids: set[str]) -> dict[str, dict[str, Any]]:
    if not node_ids:
        return {}
    rows = connection.execute(
        f"""
        SELECT *
        FROM nodes
        WHERE dataset_id = ?
          AND id IN ({','.join('?' for _ in node_ids)})
        """,
        (dataset_id, *sorted(node_ids)),
    ).fetchall()
    result: dict[str, dict[str, Any]] = {}
    for row in rows:
        record = {
            "id": row["id"],
            "canonical_name": row["canonical_name"],
            "node_kind": row["node_kind"],
            "node_layer": row["node_layer"],
            "definition": row["definition"],
            "aliases": load_json_array(row["aliases_json"]),
            "learning_modes": load_json_array(row["learning_modes_json"]),
            "bridge_tags": load_json_array(row["bridge_tags_json"]),
            "status": row["status"],
        }
        if row["node_subkind"] is not None:
            record["node_subkind"] = row["node_subkind"]
        result[row["id"]] = record
    return result


def fetch_profiles(connection, dataset_id: str, node_ids: set[str]) -> list[dict[str, Any]]:
    if not node_ids:
        return []
    rows = connection.execute(
        f"""
        SELECT id, node_id, subject, school_stage, grade_band, curriculum_role, mastery_level
        FROM profiles
        WHERE dataset_id = ?
          AND node_id IN ({','.join('?' for _ in node_ids)})
        ORDER BY node_id, id
        """,
        (dataset_id, *sorted(node_ids)),
    ).fetchall()
    return [dict(row) for row in rows]


def fetch_edges(connection, dataset_id: str, node_ids: set[str]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    if not node_ids:
        return [], []
    rows = connection.execute(
        f"""
        SELECT *
        FROM edges
        WHERE dataset_id = ?
          AND status != 'deprecated'
          AND (from_id IN ({','.join('?' for _ in node_ids)}) OR to_id IN ({','.join('?' for _ in node_ids)}))
        ORDER BY edge_type, id
        """,
        (dataset_id, *sorted(node_ids), *sorted(node_ids)),
    ).fetchall()
    internal: list[dict[str, Any]] = []
    boundary: list[dict[str, Any]] = []
    for row in rows:
        record = {
            "id": row["id"],
            "edge_type": row["edge_type"],
            "from": row["from_id"],
            "to": row["to_id"],
            "confidence": row["confidence"],
            "edge_layer": row["edge_layer"],
            "source_refs": load_json_array(row["source_refs_json"]),
        }
        if row["from_id"] in node_ids and row["to_id"] in node_ids:
            internal.append(record)
        else:
            boundary.append(record)
    return internal, boundary


def build_anchor_overview(
    anchors: list[str],
    mentions: list[dict[str, Any]],
    evidence: list[dict[str, Any]],
    proposals: list[dict[str, Any]],
    retrieval_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    mention_by_anchor: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    evidence_by_anchor: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    proposals_by_anchor: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    retrieval_by_anchor: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in mentions:
        mention_by_anchor[record["anchor_ref"]].append(record)
    for record in evidence:
        evidence_by_anchor[record["anchor_ref"]].append(record)
    for record in proposals:
        proposals_by_anchor[record["batch_anchor"]].append(record)
    for record in retrieval_rows:
        retrieval_by_anchor[record["batch_anchor"]].append(record)

    overview: list[dict[str, Any]] = []
    for anchor in anchors:
        node_mentions = [m for m in mention_by_anchor[anchor] if m["target_type"] == "node"]
        overview.append(
            {
                "anchor_ref": anchor,
                "mentions": len(mention_by_anchor[anchor]),
                "evidence": len(evidence_by_anchor[anchor]),
                "node_mentions": len(node_mentions),
                "distinct_nodes": len({m["target_id"] for m in node_mentions}),
                "relation_proposals": len(proposals_by_anchor[anchor]),
                "retrieval_candidates": len(retrieval_by_anchor[anchor]),
            }
        )
    return overview


def build_term_overlap_candidates(
    nodes_by_id: dict[str, dict[str, Any]],
    node_anchor_sets: dict[str, set[str]],
    top_n: int,
) -> list[dict[str, Any]]:
    term_index: defaultdict[str, set[str]] = defaultdict(set)
    for node_id, node in nodes_by_id.items():
        for term in [node["canonical_name"], *node.get("aliases", [])]:
            normalized = normalize_name(term)
            if normalized:
                term_index[normalized].add(node_id)

    candidates: list[dict[str, Any]] = []
    for normalized_term, node_ids in term_index.items():
        if len(node_ids) < 2:
            continue
        ordered = sorted(node_ids)
        candidate = {
            "normalized_term": normalized_term,
            "node_ids": ordered,
            "canonical_names": [nodes_by_id[node_id]["canonical_name"] for node_id in ordered],
            "node_kinds": sorted({nodes_by_id[node_id]["node_kind"] for node_id in ordered}),
            "node_layers": sorted({nodes_by_id[node_id]["node_layer"] for node_id in ordered}),
            "anchors": sorted({anchor for node_id in ordered for anchor in node_anchor_sets.get(node_id, set())}),
        }
        candidates.append(candidate)
    candidates.sort(
        key=lambda item: (
            -len(item["node_ids"]),
            -len(item["anchors"]),
            item["canonical_names"][0],
        )
    )
    return candidates[:top_n]


def build_recurring_nodes(
    nodes_by_id: dict[str, dict[str, Any]],
    node_anchor_sets: dict[str, set[str]],
    node_mention_counts: Counter[str],
    top_n: int,
) -> list[dict[str, Any]]:
    recurring = []
    for node_id, anchors in node_anchor_sets.items():
        if len(anchors) < 2:
            continue
        node = nodes_by_id.get(node_id)
        if node is None:
            continue
        recurring.append(
            {
                "node_id": node_id,
                "canonical_name": node["canonical_name"],
                "node_kind": node["node_kind"],
                "node_layer": node["node_layer"],
                "anchor_count": len(anchors),
                "anchors": sorted(anchors),
                "mention_count": node_mention_counts[node_id],
            }
        )
    recurring.sort(
        key=lambda item: (-item["anchor_count"], -item["mention_count"], item["canonical_name"])
    )
    return recurring[:top_n]


def build_cross_anchor_edges(
    edges: list[dict[str, Any]],
    node_anchor_sets: dict[str, set[str]],
    nodes_by_id: dict[str, dict[str, Any]],
    top_n: int,
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for edge in edges:
        from_anchors = node_anchor_sets.get(edge["from"], set())
        to_anchors = node_anchor_sets.get(edge["to"], set())
        combined = from_anchors | to_anchors
        if len(combined) < 2:
            continue
        records.append(
            {
                "edge_id": edge["id"],
                "edge_type": edge["edge_type"],
                "from_node_id": edge["from"],
                "from_name": nodes_by_id.get(edge["from"], {}).get("canonical_name", edge["from"]),
                "to_node_id": edge["to"],
                "to_name": nodes_by_id.get(edge["to"], {}).get("canonical_name", edge["to"]),
                "anchors": sorted(combined),
                "confidence": edge["confidence"],
            }
        )
    records.sort(key=lambda item: (-len(item["anchors"]), -item["confidence"], item["edge_id"]))
    return records[:top_n]


def build_cross_anchor_proposals(
    proposals: list[dict[str, Any]],
    node_anchor_sets: dict[str, set[str]],
    nodes_by_id: dict[str, dict[str, Any]],
    top_n: int,
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for proposal in proposals:
        combined = node_anchor_sets.get(proposal["from_node_id"], set()) | node_anchor_sets.get(
            proposal["to_node_id"], set()
        )
        if len(combined) < 2:
            continue
        records.append(
            {
                "proposal_id": proposal["proposal_id"],
                "batch_anchor": proposal["batch_anchor"],
                "edge_type": proposal["edge_type"],
                "status": proposal["status"],
                "from_node_id": proposal["from_node_id"],
                "from_name": nodes_by_id.get(proposal["from_node_id"], {}).get(
                    "canonical_name", proposal["from_node_id"]
                ),
                "to_node_id": proposal["to_node_id"],
                "to_name": nodes_by_id.get(proposal["to_node_id"], {}).get(
                    "canonical_name", proposal["to_node_id"]
                ),
                "anchors": sorted(combined),
                "confidence": proposal["confidence"],
                "conflict_type": proposal["conflict_type"],
            }
        )
    records.sort(key=lambda item: (-len(item["anchors"]), item["status"], -item["confidence"]))
    return records[:top_n]


def build_retrieval_recurrence(
    retrieval_rows: list[dict[str, Any]],
    nodes_by_id: dict[str, dict[str, Any]],
    top_n: int,
) -> list[dict[str, Any]]:
    by_node: defaultdict[str, dict[str, Any]] = defaultdict(
        lambda: {"anchors": set(), "query_ids": set(), "best_rank": 10**9, "best_score": 0.0}
    )
    for row in retrieval_rows:
        current = by_node[row["candidate_node_id"]]
        current["anchors"].add(row["batch_anchor"])
        current["query_ids"].add(row["query_id"])
        current["best_rank"] = min(current["best_rank"], int(row["rank"]))
        current["best_score"] = max(current["best_score"], float(row["score"] or 0.0))

    records = []
    for node_id, info in by_node.items():
        node = nodes_by_id.get(node_id)
        if node is None:
            continue
        records.append(
            {
                "node_id": node_id,
                "canonical_name": node["canonical_name"],
                "node_kind": node["node_kind"],
                "anchor_count": len(info["anchors"]),
                "anchors": sorted(info["anchors"]),
                "query_count": len(info["query_ids"]),
                "best_rank": info["best_rank"],
                "best_score": info["best_score"],
            }
        )
    records.sort(key=lambda item: (-item["anchor_count"], item["best_rank"], -item["best_score"]))
    return records[:top_n]


def build_focus_points(
    recurring_nodes: list[dict[str, Any]],
    term_overlap_candidates: list[dict[str, Any]],
    unresolved_proposals: list[dict[str, Any]],
    cross_anchor_proposals: list[dict[str, Any]],
) -> list[str]:
    focus: list[str] = []
    if recurring_nodes:
        focus.append(
            f"Review recurring concepts across anchors first; {len(recurring_nodes)} nodes appear in multiple lessons."
        )
    if term_overlap_candidates:
        focus.append(
            f"Check terminology drift and duplicate identity; {len(term_overlap_candidates)} overlap groups share canonical or alias terms."
        )
    if unresolved_proposals:
        focus.append(
            f"Resolve relation proposals before broad normalization; {len(unresolved_proposals)} proposals remain in candidate/review status."
        )
    if cross_anchor_proposals:
        focus.append(
            f"Cross-lesson relation proposals are present; inspect whether they should stay local or promote into the canonical graph."
        )
    if not focus:
        focus.append("No strong normalization hotspots were detected in this batch group.")
    return focus


def build_summary_lines(
    anchors: list[str],
    recurring_nodes: list[dict[str, Any]],
    term_overlap_candidates: list[dict[str, Any]],
    unresolved_proposals: list[dict[str, Any]],
    cross_anchor_edges: list[dict[str, Any]],
) -> list[str]:
    lines = [f"Batch group covers {len(anchors)} anchors."]
    if recurring_nodes:
        preview = ", ".join(item["canonical_name"] for item in recurring_nodes[:5])
        lines.append(f"Most recurring concepts: {preview}.")
    if term_overlap_candidates:
        preview = ", ".join(
            " / ".join(item["canonical_names"][:2]) for item in term_overlap_candidates[:3]
        )
        lines.append(f"Potential terminology drift groups: {preview}.")
    if unresolved_proposals:
        lines.append(f"Unresolved relation proposals: {len(unresolved_proposals)}.")
    if cross_anchor_edges:
        preview = ", ".join(
            f"{item['from_name']} -> {item['to_name']}" for item in cross_anchor_edges[:3]
        )
        lines.append(f"Cross-anchor canonical links already present: {preview}.")
    return lines


def main() -> int:
    args = parse_args()
    root = Path(args.root).expanduser().resolve()
    connection = connect_db(args.db)
    ensure_sqlite_schema(connection)
    dataset_id = resolve_dataset_id(connection, args.dataset_id, root)
    require_dataset_row(connection, dataset_id)

    anchors = resolve_outline_anchors(args.book_id, split_csv(args.anchors), strict=True)
    mentions = fetch_mentions(connection, dataset_id, args.book_id, anchors)
    evidence = fetch_evidence(connection, dataset_id, args.book_id, anchors)
    proposals = fetch_relation_proposals(connection, dataset_id, anchors)
    retrieval_rows = fetch_retrieval_rows(connection, dataset_id, anchors)

    scoped_node_ids = {
        mention["target_id"] for mention in mentions if mention["target_type"] == "node"
    }
    scoped_node_ids.update(proposal["from_node_id"] for proposal in proposals)
    scoped_node_ids.update(proposal["to_node_id"] for proposal in proposals)
    nodes_by_id = fetch_nodes(connection, dataset_id, scoped_node_ids)
    profiles = fetch_profiles(connection, dataset_id, set(nodes_by_id))
    internal_edges, boundary_edges = fetch_edges(connection, dataset_id, set(nodes_by_id))

    node_anchor_sets: defaultdict[str, set[str]] = defaultdict(set)
    node_mention_counts: Counter[str] = Counter()
    for mention in mentions:
        if mention["target_type"] != "node":
            continue
        node_anchor_sets[mention["target_id"]].add(mention["anchor_ref"])
        node_mention_counts[mention["target_id"]] += 1

    recurring_nodes = build_recurring_nodes(
        nodes_by_id,
        node_anchor_sets,
        node_mention_counts,
        args.top_n,
    )
    term_overlap_candidates = build_term_overlap_candidates(
        nodes_by_id,
        node_anchor_sets,
        args.top_n,
    )
    cross_anchor_edges = build_cross_anchor_edges(
        internal_edges,
        node_anchor_sets,
        nodes_by_id,
        args.top_n,
    )
    cross_anchor_proposals = build_cross_anchor_proposals(
        proposals,
        node_anchor_sets,
        nodes_by_id,
        args.top_n,
    )
    retrieval_recurrence = build_retrieval_recurrence(
        retrieval_rows,
        nodes_by_id,
        args.top_n,
    )
    unresolved_proposals = [
        proposal for proposal in proposals if proposal["status"] in {"candidate", "review"}
    ]
    unresolved_proposals.sort(
        key=lambda item: (item["status"], -item["confidence"], item["proposal_id"])
    )

    report = {
        "generated_at": utc_now(),
        "dataset_id": dataset_id,
        "output_root": str(root),
        "book_id": args.book_id,
        "anchors": anchors,
        "counts": {
            "anchors": len(anchors),
            "mentions": len(mentions),
            "evidence": len(evidence),
            "scoped_nodes": len(nodes_by_id),
            "profiles": len(profiles),
            "internal_edges": len(internal_edges),
            "boundary_edges": len(boundary_edges),
            "relation_proposals": len(proposals),
            "unresolved_relation_proposals": len(unresolved_proposals),
            "retrieval_candidates": len(retrieval_rows),
        },
        "anchor_overview": build_anchor_overview(anchors, mentions, evidence, proposals, retrieval_rows),
        "summary_lines": build_summary_lines(
            anchors,
            recurring_nodes,
            term_overlap_candidates,
            unresolved_proposals,
            cross_anchor_edges,
        ),
        "normalization_focus": build_focus_points(
            recurring_nodes,
            term_overlap_candidates,
            unresolved_proposals,
            cross_anchor_proposals,
        ),
        "recurring_nodes": recurring_nodes,
        "term_overlap_candidates": term_overlap_candidates,
        "cross_anchor_canonical_edges": cross_anchor_edges,
        "cross_anchor_relation_proposals": cross_anchor_proposals,
        "unresolved_relation_proposals": unresolved_proposals[: args.top_n],
        "retrieval_recurrence": retrieval_recurrence,
        "node_kind_counts": dict(Counter(node["node_kind"] for node in nodes_by_id.values())),
        "node_layer_counts": dict(Counter(node["node_layer"] for node in nodes_by_id.values())),
        "proposal_status_counts": dict(Counter(proposal["status"] for proposal in proposals)),
        "edge_type_counts": dict(Counter(edge["edge_type"] for edge in internal_edges)),
    }

    report_path = (
        Path(args.report).expanduser().resolve()
        if args.report
        else default_report_path(root, args.book_id, anchors)
    )
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    print(
        f"Batch group roll-up: anchors={len(anchors)} nodes={len(nodes_by_id)} "
        f"proposals={len(proposals)} recurring_nodes={len(recurring_nodes)}"
    )
    print(f"Report: {report_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
