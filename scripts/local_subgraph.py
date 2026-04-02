#!/usr/bin/env python3
"""Expand a small local subgraph around top retrieval candidates or explicit seed nodes."""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any

from knowledge_store_common import (
    DEFAULT_DB_PATH,
    connect_db,
    ensure_sqlite_schema,
    equivalent_anchor_tokens,
    require_dataset_row,
    resolve_dataset_id,
    safe_path_token,
    utc_now,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description=(
            "Expand a 1-hop or 2-hop local subgraph around retrieval candidates or explicit seed nodes."
        )
    )
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH))
    parser.add_argument("--dataset-id")
    parser.add_argument("--output-root", help="Optional data/<version>/ root for default report paths.")
    parser.add_argument("--book-id", help="Optional textbook id for scoped mention/evidence context.")
    parser.add_argument("--batch-anchor", help="Batch anchor used to load retrieval candidates.")
    parser.add_argument(
        "--query-id",
        action="append",
        dest="query_ids",
        help="Optional retrieval query id(s) within the batch anchor.",
    )
    parser.add_argument(
        "--node-id",
        action="append",
        dest="node_ids",
        help="Explicit seed node id(s). May be combined with retrieval seeds.",
    )
    parser.add_argument("--top-k", type=int, default=8, help="Maximum number of seed candidates.")
    parser.add_argument(
        "--hops",
        type=int,
        choices=(1, 2),
        default=1,
        help="Neighborhood depth to expand from the seed nodes.",
    )
    parser.add_argument(
        "--max-neighbors",
        type=int,
        default=12,
        help="Per-frontier-node neighbor cap at each hop.",
    )
    parser.add_argument(
        "--report",
        help="Optional JSON report path. Defaults under <output-root>/runs/analysis/ when output-root is given.",
    )
    parser.add_argument(
        "--allow-empty",
        action="store_true",
        help="Return success with a skipped report when no seed nodes are available.",
    )
    return parser.parse_args()


def load_json_array(text: str | None) -> list[Any]:
    if not text:
        return []
    return json.loads(text)


def default_report_path(args: argparse.Namespace) -> Path | None:
    if not args.output_root:
        return None
    root = Path(args.output_root).expanduser().resolve()
    token_bits = []
    if args.book_id:
        token_bits.append(safe_path_token(args.book_id))
    if args.batch_anchor:
        token_bits.append(safe_path_token(args.batch_anchor))
    if not token_bits:
        token_bits.append("dataset")
    token_bits.append(f"{args.hops}hop")
    filename = ".".join(token_bits) + ".local-subgraph.json"
    return root / "runs" / "analysis" / filename


def build_empty_report(
    args: argparse.Namespace,
    dataset_id: str,
    reason: str,
) -> dict[str, Any]:
    return {
        "generated_at": utc_now(),
        "dataset_id": dataset_id,
        "output_root": args.output_root,
        "book_id": args.book_id,
        "batch_anchor": args.batch_anchor,
        "query_ids": args.query_ids or [],
        "hops": args.hops,
        "max_neighbors": args.max_neighbors,
        "skipped": True,
        "skip_reason": reason,
        "counts": {
            "seed_nodes": 0,
            "subgraph_nodes": 0,
            "subgraph_edges": 0,
            "profiles": 0,
            "mentions": 0,
            "evidence": 0,
            "scoped_mentions": 0,
            "scoped_evidence": 0,
        },
        "seed_nodes": [],
        "nodes": [],
        "edges": [],
        "profiles": [],
        "context_summary": {
            "node_kind_counts": {},
            "node_layer_counts": {},
            "edge_type_counts": {},
            "batch_mention_roles": {},
        },
    }


def emit_report(report: dict[str, Any], args: argparse.Namespace) -> None:
    report_path = Path(args.report).expanduser().resolve() if args.report else default_report_path(args)
    if report_path is not None:
        report_path.parent.mkdir(parents=True, exist_ok=True)
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(f"Report: {report_path}")
    else:
        print(json.dumps(report, ensure_ascii=False, indent=2))


def load_retrieval_seeds(connection, dataset_id: str, args: argparse.Namespace) -> list[dict[str, Any]]:
    if not args.batch_anchor:
        return []

    where = ["dataset_id = ?", "batch_anchor = ?"]
    params: list[Any] = [dataset_id, args.batch_anchor]
    if args.query_ids:
        where.append(f"query_id IN ({','.join('?' for _ in args.query_ids)})")
        params.extend(args.query_ids)

    rows = connection.execute(
        """
        SELECT query_id, query_text, candidate_node_id, rank, score, retrieval_method
        FROM retrieval_candidates
        WHERE """
        + " AND ".join(where)
        + """
        ORDER BY rank ASC, score DESC, candidate_node_id ASC
        """,
        params,
    ).fetchall()

    by_node: dict[str, dict[str, Any]] = {}
    for row in rows:
        current = by_node.get(row["candidate_node_id"])
        candidate = {
            "node_id": row["candidate_node_id"],
            "best_rank": int(row["rank"]),
            "best_score": float(row["score"] or 0.0),
            "retrieval_method": row["retrieval_method"],
            "query_ids": [row["query_id"]],
            "query_texts": [row["query_text"]],
        }
        if current is None:
            by_node[row["candidate_node_id"]] = candidate
            continue
        if candidate["best_rank"] < current["best_rank"] or (
            candidate["best_rank"] == current["best_rank"]
            and candidate["best_score"] > current["best_score"]
        ):
            current["best_rank"] = candidate["best_rank"]
            current["best_score"] = candidate["best_score"]
            current["retrieval_method"] = candidate["retrieval_method"]
        current["query_ids"] = sorted(set(current["query_ids"] + candidate["query_ids"]))
        current["query_texts"] = sorted(set(current["query_texts"] + candidate["query_texts"]))

    seeds = sorted(
        by_node.values(),
        key=lambda item: (item["best_rank"], -item["best_score"], item["node_id"]),
    )
    return seeds[: args.top_k]


def load_explicit_seeds(node_ids: list[str] | None) -> list[dict[str, Any]]:
    if not node_ids:
        return []
    seen: set[str] = set()
    seeds: list[dict[str, Any]] = []
    for node_id in node_ids:
        if node_id in seen:
            continue
        seen.add(node_id)
        seeds.append(
            {
                "node_id": node_id,
                "best_rank": None,
                "best_score": None,
                "retrieval_method": "explicit_seed",
                "query_ids": [],
                "query_texts": [],
            }
        )
    return seeds


def merge_seed_specs(seed_groups: list[list[dict[str, Any]]]) -> list[dict[str, Any]]:
    by_node: dict[str, dict[str, Any]] = {}
    for group in seed_groups:
        for seed in group:
            current = by_node.get(seed["node_id"])
            if current is None:
                by_node[seed["node_id"]] = dict(seed)
                continue
            current["query_ids"] = sorted(set(current["query_ids"] + seed["query_ids"]))
            current["query_texts"] = sorted(set(current["query_texts"] + seed["query_texts"]))
            if current["best_rank"] is None or (
                seed["best_rank"] is not None
                and (
                    seed["best_rank"] < current["best_rank"]
                    or (
                        seed["best_rank"] == current["best_rank"]
                        and (seed["best_score"] or 0.0) > (current["best_score"] or 0.0)
                    )
                )
            ):
                current["best_rank"] = seed["best_rank"]
                current["best_score"] = seed["best_score"]
                current["retrieval_method"] = seed["retrieval_method"]
    return sorted(
        by_node.values(),
        key=lambda item: (
            item["best_rank"] if item["best_rank"] is not None else 10**9,
            -(item["best_score"] or 0.0),
            item["node_id"],
        ),
    )


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


def expand_subgraph(
    connection,
    dataset_id: str,
    seed_node_ids: list[str],
    hops: int,
    max_neighbors: int,
) -> tuple[dict[str, int], dict[str, dict[str, Any]]]:
    node_distance = {node_id: 0 for node_id in seed_node_ids}
    selected_edges: dict[str, dict[str, Any]] = {}
    frontier = set(seed_node_ids)

    for hop in range(1, hops + 1):
        if not frontier:
            break
        frontier_list = sorted(frontier)
        rows = connection.execute(
            f"""
            SELECT *
            FROM edges
            WHERE dataset_id = ?
              AND status != 'deprecated'
              AND (
                from_id IN ({','.join('?' for _ in frontier_list)})
                OR to_id IN ({','.join('?' for _ in frontier_list)})
              )
            ORDER BY confidence DESC, id ASC
            """,
            (dataset_id, *frontier_list, *frontier_list),
        ).fetchall()

        per_frontier_count: Counter[str] = Counter()
        next_frontier: set[str] = set()
        for row in rows:
            endpoints = [row["from_id"], row["to_id"]]
            touched_frontier = [node_id for node_id in endpoints if node_id in frontier]
            if not touched_frontier:
                continue
            if any(per_frontier_count[node_id] >= max_neighbors for node_id in touched_frontier):
                continue
            edge_id = row["id"]
            if edge_id not in selected_edges:
                selected_edges[edge_id] = {
                    "id": edge_id,
                    "edge_type": row["edge_type"],
                    "edge_layer": row["edge_layer"],
                    "backbone_expand": bool(row["backbone_expand"]),
                    "from": row["from_id"],
                    "to": row["to_id"],
                    "confidence": row["confidence"],
                    "directionality": row["directionality"],
                    "source_refs": load_json_array(row["source_refs_json"]),
                    "status": row["status"],
                }
            for node_id in touched_frontier:
                per_frontier_count[node_id] += 1
            for endpoint in endpoints:
                if endpoint not in node_distance:
                    node_distance[endpoint] = hop
                    next_frontier.add(endpoint)
        frontier = next_frontier

    return node_distance, selected_edges


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


def fetch_mentions(connection, dataset_id: str, node_ids: set[str]) -> list[dict[str, Any]]:
    if not node_ids:
        return []
    rows = connection.execute(
        f"""
        SELECT *
        FROM mentions
        WHERE dataset_id = ?
          AND target_type = 'node'
          AND target_id IN ({','.join('?' for _ in node_ids)})
        ORDER BY source_id, anchor_ref, id
        """,
        (dataset_id, *sorted(node_ids)),
    ).fetchall()
    return [
        {
            "id": row["id"],
            "source_type": row["source_type"],
            "source_id": row["source_id"],
            "anchor_ref": row["anchor_ref"],
            "target_id": row["target_id"],
            "role": row["role"],
            "source_refs": load_json_array(row["source_refs_json"]),
            "confidence": row["confidence"],
        }
        for row in rows
    ]


def fetch_evidence(connection, dataset_id: str, evidence_ids: set[str]) -> dict[str, dict[str, Any]]:
    if not evidence_ids:
        return {}
    rows = connection.execute(
        f"""
        SELECT *
        FROM evidence
        WHERE dataset_id = ?
          AND id IN ({','.join('?' for _ in evidence_ids)})
        """,
        (dataset_id, *sorted(evidence_ids)),
    ).fetchall()
    return {
        row["id"]: {
            "id": row["id"],
            "source_type": row["source_type"],
            "source_id": row["source_id"],
            "anchor_ref": row["anchor_ref"],
            "locator": row["locator"],
            "page_start": row["page_start"],
            "page_end": row["page_end"],
        }
        for row in rows
    }


def annotate_node_context(
    node_distance: dict[str, int],
    nodes_by_id: dict[str, dict[str, Any]],
    mentions: list[dict[str, Any]],
    seed_specs: dict[str, dict[str, Any]],
    subgraph_edges: dict[str, dict[str, Any]],
    batch_anchor_tokens: set[str],
    book_id: str | None,
) -> list[dict[str, Any]]:
    node_mentions: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    for mention in mentions:
        node_mentions[mention["target_id"]].append(mention)

    degree_counter: Counter[str] = Counter()
    for edge in subgraph_edges.values():
        degree_counter[edge["from"]] += 1
        degree_counter[edge["to"]] += 1

    records: list[dict[str, Any]] = []
    for node_id, distance in sorted(
        node_distance.items(),
        key=lambda item: (item[1], nodes_by_id.get(item[0], {}).get("canonical_name", item[0]), item[0]),
    ):
        node = nodes_by_id.get(node_id)
        if node is None:
            continue
        node_record = dict(node)
        node_record["hop_distance"] = distance
        node_record["degree_in_subgraph"] = degree_counter.get(node_id, 0)
        node_record["mention_count"] = len(node_mentions.get(node_id, []))
        node_record["batch_mention_count"] = sum(
            1
            for mention in node_mentions.get(node_id, [])
            if (not book_id or mention["source_id"] == book_id)
            and mention["anchor_ref"] in batch_anchor_tokens
        )
        if node_id in seed_specs:
            node_record["seed"] = seed_specs[node_id]
        records.append(node_record)
    return records


def main() -> int:
    args = parse_args()
    connection = connect_db(args.db)
    ensure_sqlite_schema(connection)
    dataset_id = resolve_dataset_id(connection, args.dataset_id, args.output_root)
    require_dataset_row(connection, dataset_id)

    seed_specs = merge_seed_specs(
        [
            load_retrieval_seeds(connection, dataset_id, args),
            load_explicit_seeds(args.node_ids),
        ]
    )
    if not seed_specs:
        if not args.allow_empty:
            raise SystemExit(
                "Provide seed nodes with --node-id or a retrieval context with --batch-anchor."
            )
        reason = "No retrieval candidates or explicit seed nodes were available for this batch."
        report = build_empty_report(args, dataset_id, reason)
        print(f"Local subgraph skipped: {reason}")
        emit_report(report, args)
        return 0

    seed_node_ids = [seed["node_id"] for seed in seed_specs]
    nodes_by_id = fetch_nodes(connection, dataset_id, set(seed_node_ids))
    missing_seed_nodes = sorted(set(seed_node_ids) - set(nodes_by_id))
    if missing_seed_nodes:
        preview = ", ".join(missing_seed_nodes[:10])
        raise SystemExit(f"Seed nodes not found in dataset '{dataset_id}': {preview}")

    node_distance, subgraph_edges = expand_subgraph(
        connection,
        dataset_id,
        seed_node_ids,
        args.hops,
        args.max_neighbors,
    )
    node_ids = set(node_distance)
    nodes_by_id = fetch_nodes(connection, dataset_id, node_ids)
    profiles = fetch_profiles(connection, dataset_id, node_ids)
    mentions = fetch_mentions(connection, dataset_id, node_ids)

    evidence_ids: set[str] = set()
    for edge in subgraph_edges.values():
        evidence_ids.update(edge["source_refs"])
    for mention in mentions:
        evidence_ids.update(mention["source_refs"])
    evidence_by_id = fetch_evidence(connection, dataset_id, evidence_ids)

    batch_anchor_tokens: set[str] = set()
    if args.batch_anchor and args.book_id:
        batch_anchor_tokens = set(equivalent_anchor_tokens(args.book_id, args.batch_anchor))

    scoped_mentions = [
        mention
        for mention in mentions
        if (not args.book_id or mention["source_id"] == args.book_id)
        and (not batch_anchor_tokens or mention["anchor_ref"] in batch_anchor_tokens)
    ]
    scoped_evidence = [
        record
        for record in evidence_by_id.values()
        if (not args.book_id or record["source_id"] == args.book_id)
        and (not batch_anchor_tokens or record["anchor_ref"] in batch_anchor_tokens)
    ]

    node_records = annotate_node_context(
        node_distance,
        nodes_by_id,
        mentions,
        {seed["node_id"]: seed for seed in seed_specs},
        subgraph_edges,
        batch_anchor_tokens,
        args.book_id,
    )

    report = {
        "generated_at": utc_now(),
        "dataset_id": dataset_id,
        "output_root": args.output_root,
        "book_id": args.book_id,
        "batch_anchor": args.batch_anchor,
        "query_ids": args.query_ids or [],
        "hops": args.hops,
        "max_neighbors": args.max_neighbors,
        "counts": {
            "seed_nodes": len(seed_specs),
            "subgraph_nodes": len(node_records),
            "subgraph_edges": len(subgraph_edges),
            "profiles": len(profiles),
            "mentions": len(mentions),
            "evidence": len(evidence_by_id),
            "scoped_mentions": len(scoped_mentions),
            "scoped_evidence": len(scoped_evidence),
        },
        "seed_nodes": seed_specs,
        "nodes": node_records,
        "edges": sorted(
            subgraph_edges.values(),
            key=lambda edge: (
                min(node_distance.get(edge["from"], 99), node_distance.get(edge["to"], 99)),
                edge["edge_type"],
                edge["id"],
            ),
        ),
        "profiles": profiles,
        "context_summary": {
            "node_kind_counts": Counter(node["node_kind"] for node in node_records),
            "node_layer_counts": Counter(node["node_layer"] for node in node_records),
            "edge_type_counts": Counter(edge["edge_type"] for edge in subgraph_edges.values()),
            "batch_mention_roles": Counter(mention["role"] for mention in scoped_mentions),
        },
    }
    report["context_summary"] = {
        key: dict(value) for key, value in report["context_summary"].items()
    }

    print(
        f"Local subgraph: seeds={len(seed_specs)} nodes={len(node_records)} "
        f"edges={len(subgraph_edges)} hops={args.hops}"
    )
    if scoped_mentions or scoped_evidence:
        print(
            f"Scoped context: mentions={len(scoped_mentions)} evidence={len(scoped_evidence)}"
        )
    emit_report(report, args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
