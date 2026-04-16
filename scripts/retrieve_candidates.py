#!/usr/bin/env python3
"""Retrieve top-k node candidates for a lesson/batch and optionally persist them.

The default path now uses a LightRAG-inspired hybrid retrieval strategy:

- `local`: exact/prefix/FTS matching on canonical node terms
- `global`: relation-aware graph expansion from local seed hits
- `hybrid`: local + global + vector fusion
- `mix`: hybrid + profile/evidence text support
- `vector`: embedding cosine similarity via pgvector `<=>` operator
"""

from __future__ import annotations

import argparse
from collections import Counter
import json
import os
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row

from knowledge_store_common import (
    connect_db,
    dump_json_text,
    ensure_pg_schema,
    make_query_id,
    normalize_term,
    require_dataset_row,
    resolve_dataset_id,
    utc_now,
    unique_stable,
)
from embedding_client import embed_single, DEFAULT_EMBEDDING_URL, DEFAULT_EMBEDDING_MODEL


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Retrieve constrained node candidates from the PostgreSQL knowledge store."
    )
    parser.add_argument("queries", nargs="*", help="One or more query strings.")
    parser.add_argument("--queries-file", help="Optional text or JSONL file of queries.")
    parser.add_argument("--db", default=os.environ.get("DATABASE_URL"),
                        help="PostgreSQL connection URL (or set DATABASE_URL env var)")
    parser.add_argument("--dataset-id")
    parser.add_argument("--output-root")
    parser.add_argument("--batch-anchor", help="Batch anchor used when persisting retrieval results.")
    parser.add_argument("--subject")
    parser.add_argument("--school-stage")
    parser.add_argument("--grade-band")
    parser.add_argument("--node-kind")
    parser.add_argument(
        "--mode",
        choices=("local", "global", "hybrid", "mix", "vector"),
        default="hybrid",
        help="LightRAG-inspired retrieval mode. Defaults to hybrid fusion.",
    )
    parser.add_argument("--limit", type=int, default=8)
    parser.add_argument(
        "--graph-seed-limit",
        type=int,
        default=8,
        help="Maximum number of lexical seed nodes used for global graph expansion.",
    )
    parser.add_argument(
        "--graph-neighbor-limit",
        type=int,
        default=6,
        help="Per-seed neighbor cap during LightRAG-style global expansion.",
    )
    parser.add_argument(
        "--text-hit-limit",
        type=int,
        default=18,
        help="Maximum number of profile/evidence text hits considered in mix mode.",
    )
    parser.add_argument(
        "--embedding-url",
        default=DEFAULT_EMBEDDING_URL,
        help="URL for the embedding API endpoint.",
    )
    parser.add_argument(
        "--embedding-model",
        default=DEFAULT_EMBEDDING_MODEL,
        help="Embedding model name.",
    )
    parser.add_argument(
        "--vector-min-similarity",
        type=float,
        default=0.5,
        help="Minimum cosine similarity for vector retrieval candidates.",
    )
    parser.add_argument(
        "--write",
        action="store_true",
        help="Persist results into retrieval_candidates.",
    )
    parser.add_argument(
        "--replace",
        action="store_true",
        help="Replace existing retrieval rows for the same dataset/query_id before writing.",
    )
    return parser.parse_args()


def load_queries(args: argparse.Namespace) -> list[dict[str, str]]:
    queries: list[dict[str, str]] = [{"query_text": text} for text in args.queries if text.strip()]
    if args.queries_file:
        path = Path(args.queries_file).expanduser().resolve()
        if path.suffix == ".jsonl":
            for line in path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if not line:
                    continue
                record = json.loads(line)
                queries.append(
                    {
                        "query_text": str(record["query_text"]).strip(),
                        "query_id": str(record["query_id"]).strip()
                        if record.get("query_id")
                        else "",
                    }
                )
        else:
            for line in path.read_text(encoding="utf-8").splitlines():
                line = line.strip()
                if line:
                    queries.append({"query_text": line})

    queries = [query for query in queries if query.get("query_text")]
    if not queries:
        raise SystemExit("Provide at least one query or --queries-file.")
    return queries


def build_profile_exists_clause(
    args: argparse.Namespace,
    *,
    node_alias: str = "n",
    profile_alias: str = "p",
) -> tuple[str, list[str]]:
    clauses: list[str] = []
    params: list[str] = []
    if args.subject:
        clauses.append(f"{profile_alias}.subject = %s")
        params.append(args.subject)
    if args.school_stage:
        clauses.append(f"{profile_alias}.school_stage = %s")
        params.append(args.school_stage)
    if args.grade_band:
        clauses.append(f"{profile_alias}.grade_band = %s")
        params.append(args.grade_band)

    if not clauses:
        return "", []

    sql = (
        f"EXISTS (SELECT 1 FROM profiles {profile_alias} "
        f"WHERE {profile_alias}.dataset_id = {node_alias}.dataset_id "
        f"AND {profile_alias}.node_id = {node_alias}.id AND "
        + " AND ".join(clauses)
        + ")"
    )
    return sql, params


def recompute_candidate(candidate: dict[str, Any]) -> None:
    score_breakdown = candidate["score_breakdown"]
    ordered_channels = sorted(
        score_breakdown,
        key=lambda channel: (-score_breakdown[channel], candidate["channel_methods"][channel], channel),
    )
    candidate["support_methods"] = unique_stable(
        candidate["channel_methods"][channel] for channel in ordered_channels
    )
    support_bonus = max(0.0, (len(ordered_channels) - 1) * 2.5)
    candidate["score"] = round(sum(score_breakdown.values()) + support_bonus, 4)
    candidate["primary_method"] = (
        candidate["channel_methods"][ordered_channels[0]] if ordered_channels else None
    )


def add_candidate_support(
    candidates: dict[str, dict[str, Any]],
    node_id: str,
    canonical_name: str,
    node_kind: str,
    score: float,
    channel: str,
    method: str,
) -> None:
    existing = candidates.setdefault(
        node_id,
        {
            "node_id": node_id,
            "canonical_name": canonical_name,
            "node_kind": node_kind,
            "score": 0.0,
            "primary_method": None,
            "support_methods": [],
            "score_breakdown": {},
            "channel_methods": {},
        },
    )
    if score <= existing["score_breakdown"].get(channel, float("-inf")):
        return
    existing["canonical_name"] = canonical_name
    existing["node_kind"] = node_kind
    existing["score_breakdown"][channel] = round(float(score), 4)
    existing["channel_methods"][channel] = method
    recompute_candidate(existing)


def merge_candidate_sets(
    target: dict[str, dict[str, Any]],
    source: dict[str, dict[str, Any]],
) -> None:
    for candidate in source.values():
        for channel, score in candidate["score_breakdown"].items():
            add_candidate_support(
                target,
                candidate["node_id"],
                candidate["canonical_name"],
                candidate["node_kind"],
                score,
                channel,
                candidate["channel_methods"][channel],
            )


def sorted_candidates(candidates: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(
        candidates.values(),
        key=lambda item: (-item["score"], item["canonical_name"], item["node_id"]),
    )


def finalize_candidates(
    candidates: dict[str, dict[str, Any]],
    mode: str,
    limit: int,
) -> list[dict[str, Any]]:
    payloads: list[dict[str, Any]] = []
    for candidate in sorted_candidates(candidates)[:limit]:
        support_methods = candidate["support_methods"][:4]
        method_suffix = "+".join(support_methods) if support_methods else "none"
        payloads.append(
            {
                "node_id": candidate["node_id"],
                "canonical_name": candidate["canonical_name"],
                "node_kind": candidate["node_kind"],
                "score": round(candidate["score"], 4),
                "method": f"{mode}:{method_suffix}",
                "primary_method": candidate["primary_method"],
                "support_methods": support_methods,
                "score_breakdown": {
                    channel: round(score, 4)
                    for channel, score in sorted(
                        candidate["score_breakdown"].items(),
                        key=lambda item: item[0],
                    )
                },
            }
        )
    return payloads


def fts_tsquery(query_text: str) -> str:
    """Sanitize query text for LIKE-based search.

    Returns the cleaned query text with percent/wildcard chars removed,
    suitable for use in LIKE '%%query%%' patterns.
    """
    cleaned = query_text.replace("%", "").replace("_", "").strip()
    return cleaned


import re as _re  # ensure re is available for fts_tsquery


def fetch_filtered_nodes(
    connection: psycopg.Connection,
    dataset_id: str,
    node_ids: set[str],
    args: argparse.Namespace,
) -> dict[str, dict[str, str]]:
    if not node_ids:
        return {}

    profile_clause, profile_params = build_profile_exists_clause(args, node_alias="n", profile_alias="pf")
    id_placeholders = ",".join(["%s"] * len(node_ids))
    where_parts = ["n.dataset_id = %s", f"n.id IN ({id_placeholders})"]
    params: list[Any] = [dataset_id, *sorted(node_ids)]
    if args.node_kind:
        where_parts.append("n.node_kind = %s")
        params.append(args.node_kind)
    if profile_clause:
        where_parts.append(profile_clause)
        params.extend(profile_params)

    with connection.cursor() as cur:
        cur.execute(
            f"""
            SELECT n.id, n.canonical_name, n.node_kind
            FROM nodes n
            WHERE {' AND '.join(where_parts)}
            """,
            params,
        )
        rows = cur.fetchall()
    return {
        row["id"]: {
            "canonical_name": row["canonical_name"],
            "node_kind": row["node_kind"],
        }
        for row in rows
    }


def collect_local_support(
    connection: psycopg.Connection,
    dataset_id: str,
    query_text: str,
    args: argparse.Namespace,
    candidates: dict[str, dict[str, Any]],
    *,
    limit_override: int | None = None,
) -> None:
    normalized = normalize_term(query_text)
    profile_clause, profile_params = build_profile_exists_clause(args, node_alias="n", profile_alias="p")

    where_parts = ["n.dataset_id = %s"]
    base_params: list[Any] = [dataset_id]
    if args.node_kind:
        where_parts.append("n.node_kind = %s")
        base_params.append(args.node_kind)
    if profile_clause:
        where_parts.append(profile_clause)
        base_params.extend(profile_params)
    where_sql = " AND ".join(where_parts)

    # Exact term match
    with connection.cursor() as cur:
        cur.execute(
            f"""
            SELECT nt.node_id, nt.term_type, n.canonical_name, n.node_kind
            FROM node_terms nt
            JOIN nodes n
              ON n.dataset_id = nt.dataset_id AND n.id = nt.node_id
            WHERE {where_sql}
              AND nt.term_norm = %s
            ORDER BY CASE nt.term_type WHEN 'canonical' THEN 0 ELSE 1 END, n.canonical_name
            LIMIT %s
            """,
            (*base_params, normalized, limit_override or max(args.limit, args.graph_seed_limit, 12)),
        )
        exact_rows = cur.fetchall()

    for row in exact_rows:
        score = 100.0 if row["term_type"] == "canonical" else 95.0
        add_candidate_support(
            candidates,
            row["node_id"],
            row["canonical_name"],
            row["node_kind"],
            score,
            "local",
            f"exact_{row['term_type']}",
        )

    # Prefix match
    with connection.cursor() as cur:
        cur.execute(
            f"""
            SELECT nt.node_id, nt.term_type, n.canonical_name, n.node_kind
            FROM node_terms nt
            JOIN nodes n
              ON n.dataset_id = nt.dataset_id AND n.id = nt.node_id
            WHERE {where_sql}
              AND nt.term_norm LIKE %s
            ORDER BY CASE nt.term_type WHEN 'canonical' THEN 0 ELSE 1 END, n.canonical_name
            LIMIT %s
            """,
            (*base_params, f"{normalized}%", limit_override or max(args.limit * 3, 18)),
        )
        prefix_rows = cur.fetchall()

    for rank, row in enumerate(prefix_rows, start=1):
        score = 85.0 - min(rank, 20) * 0.5
        add_candidate_support(
            candidates,
            row["node_id"],
            row["canonical_name"],
            row["node_kind"],
            score,
            "local",
            f"prefix_{row['term_type']}",
        )

    # Text search via LIKE
    ts_query_str = fts_tsquery(query_text)
    if ts_query_str:
        with connection.cursor() as cur:
            cur.execute(
                f"""
                SELECT id AS node_id, canonical_name, node_kind
                FROM nodes
                WHERE {where_sql}
                  AND (canonical_name LIKE %s OR definition LIKE %s
                       OR EXISTS (SELECT 1 FROM jsonb_array_elements_text(aliases_json) AS a WHERE a LIKE %s))
                LIMIT %s
                """,
                (*base_params,
                 f"%{ts_query_str}%", f"%{ts_query_str}%", f"%{ts_query_str}%",
                 limit_override or max(args.limit * 3, 18)),
            )
            fts_rows = cur.fetchall()

        for rank, row in enumerate(fts_rows, start=1):
            score = 70.0 - min(rank, 20) * 0.5
            add_candidate_support(
                candidates,
                row["node_id"],
                row["canonical_name"],
                row["node_kind"],
                score,
                "local",
                "text_match",
            )


def collect_global_support(
    connection: psycopg.Connection,
    dataset_id: str,
    seed_candidates: list[dict[str, Any]],
    args: argparse.Namespace,
    candidates: dict[str, dict[str, Any]],
) -> None:
    if not seed_candidates:
        return

    seed_candidates = seed_candidates[: max(1, args.graph_seed_limit)]
    seed_score_by_id = {candidate["node_id"]: float(candidate["score"]) for candidate in seed_candidates}
    seed_ids = set(seed_score_by_id)
    filtered_seed_nodes = fetch_filtered_nodes(connection, dataset_id, seed_ids, args)
    for seed in seed_candidates:
        seed_meta = filtered_seed_nodes.get(seed["node_id"])
        if seed_meta is None:
            continue
        add_candidate_support(
            candidates,
            seed["node_id"],
            seed_meta["canonical_name"],
            seed_meta["node_kind"],
            min(float(seed["score"]) * 0.35, 32.0),
            "global",
            "seed_local_support",
        )

    seed_id_placeholders = ",".join(["%s"] * len(seed_ids))
    with connection.cursor() as cur:
        cur.execute(
            f"""
            SELECT id, edge_type, confidence, from_id, to_id
            FROM edges
            WHERE dataset_id = %s
              AND status != 'deprecated'
              AND (
                from_id IN ({seed_id_placeholders})
                OR to_id IN ({seed_id_placeholders})
              )
            ORDER BY confidence DESC, id ASC
            """,
            (dataset_id, *sorted(seed_ids), *sorted(seed_ids)),
        )
        rows = cur.fetchall()

    per_seed_neighbor_count: Counter[str] = Counter()
    neighbor_edges: list[tuple[str, str, str, float]] = []
    neighbor_ids: set[str] = set()
    for row in rows:
        endpoints = (row["from_id"], row["to_id"])
        touched_seeds = [node_id for node_id in endpoints if node_id in seed_ids]
        for seed_id in touched_seeds:
            if per_seed_neighbor_count[seed_id] >= args.graph_neighbor_limit:
                continue
            neighbor_id = row["to_id"] if row["from_id"] == seed_id else row["from_id"]
            if neighbor_id == seed_id:
                continue
            per_seed_neighbor_count[seed_id] += 1
            neighbor_ids.add(neighbor_id)
            neighbor_edges.append(
                (
                    seed_id,
                    neighbor_id,
                    row["edge_type"],
                    float(row["confidence"] or 0.0),
                )
            )

    neighbor_nodes = fetch_filtered_nodes(connection, dataset_id, neighbor_ids, args)
    for seed_id, neighbor_id, edge_type, edge_confidence in neighbor_edges:
        neighbor_meta = neighbor_nodes.get(neighbor_id)
        if neighbor_meta is None:
            continue
        score = min(seed_score_by_id.get(seed_id, 0.0) * 0.3, 28.0) + min(max(edge_confidence, 0.0), 1.0) * 18.0
        add_candidate_support(
            candidates,
            neighbor_id,
            neighbor_meta["canonical_name"],
            neighbor_meta["node_kind"],
            score,
            "global",
            f"graph_{edge_type}",
        )


def collect_text_support(
    connection: psycopg.Connection,
    dataset_id: str,
    query_text: str,
    args: argparse.Namespace,
    candidates: dict[str, dict[str, Any]],
) -> None:
    ts_query_str = fts_tsquery(query_text)
    if not ts_query_str:
        return

    # Profile text search
    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT node_id
            FROM profiles
            WHERE dataset_id = %s
              AND array_to_string(learning_objectives_json, ' ') LIKE %s
            LIMIT %s
            """,
            (dataset_id, f"%{ts_query_str}%", args.text_hit_limit),
        )
        profile_rows = cur.fetchall()

    profile_nodes = fetch_filtered_nodes(
        connection,
        dataset_id,
        {row["node_id"] for row in profile_rows},
        args,
    )
    for rank, row in enumerate(profile_rows, start=1):
        node_meta = profile_nodes.get(row["node_id"])
        if node_meta is None:
            continue
        score = 52.0 - min(rank, 20) * 1.1
        add_candidate_support(
            candidates,
            row["node_id"],
            node_meta["canonical_name"],
            node_meta["node_kind"],
            score,
            "text",
            "profile_text",
        )

    # Evidence text search
    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT DISTINCT m.target_id AS node_id
            FROM evidence e
            JOIN evidence_links el
              ON el.dataset_id = e.dataset_id
             AND el.evidence_id = e.id
             AND el.owner_type = 'mention'
            JOIN mentions m
              ON m.dataset_id = el.dataset_id
             AND m.id = el.owner_id
             AND m.target_type = 'node'
            WHERE e.dataset_id = %s
              AND e.excerpt LIKE %s
            LIMIT %s
            """,
            (dataset_id, f"%{ts_query_str}%", args.text_hit_limit),
        )
        evidence_rows = cur.fetchall()

    evidence_nodes = fetch_filtered_nodes(
        connection,
        dataset_id,
        {row["node_id"] for row in evidence_rows},
        args,
    )
    for rank, row in enumerate(evidence_rows, start=1):
        node_meta = evidence_nodes.get(row["node_id"])
        if node_meta is None:
            continue
        score = 48.0 - min(rank, 20) * 1.1
        add_candidate_support(
            candidates,
            row["node_id"],
            node_meta["canonical_name"],
            node_meta["node_kind"],
            score,
            "text",
            "evidence_text",
        )


def collect_vector_support(
    connection: psycopg.Connection,
    dataset_id: str,
    query_text: str,
    args: argparse.Namespace,
    candidates: dict[str, dict[str, Any]],
) -> None:
    """Embed the query and find canonical nodes via pgvector cosine distance."""
    query_embedding = embed_single(
        query_text,
        url=args.embedding_url,
        model=args.embedding_model,
        api_key=os.environ.get("EMBEDDING_API_KEY"),
    )
    if not query_embedding:
        return

    # pgvector: `<=>` is cosine distance (1 - cosine_similarity).
    # Pass the embedding list directly — psycopg3 + pgvector handle casting.
    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT id, canonical_name, node_kind,
                   1 - (embedding <=> %s::vector) AS similarity
            FROM nodes
            WHERE dataset_id = %s AND status != 'deprecated' AND embedding IS NOT NULL
            ORDER BY embedding <=> %s::vector
            LIMIT %s
            """,
            (query_embedding, dataset_id, query_embedding, args.limit),
        )
        rows = cur.fetchall()

    for rank, row in enumerate(rows, start=1):
        similarity = float(row["similarity"])
        if similarity < args.vector_min_similarity:
            continue
        score = 40.0 + similarity * 50.0 - min(rank, 10) * 1.0
        add_candidate_support(
            candidates,
            row["id"],
            row["canonical_name"],
            row["node_kind"],
            score,
            "vector",
            "cosine_sim",
        )


def retrieve_for_query(
    connection: psycopg.Connection,
    dataset_id: str,
    query_text: str,
    args: argparse.Namespace,
) -> list[dict[str, Any]]:
    seed_candidates: dict[str, dict[str, Any]] = {}
    collect_local_support(
        connection,
        dataset_id,
        query_text,
        args,
        seed_candidates,
        limit_override=max(args.limit, args.graph_seed_limit, args.text_hit_limit),
    )
    sorted_seed_candidates = sorted_candidates(seed_candidates)

    fused_candidates: dict[str, dict[str, Any]] = {}
    if args.mode in {"local", "hybrid", "mix"}:
        merge_candidate_sets(fused_candidates, seed_candidates)
    if args.mode in {"global", "hybrid", "mix"}:
        collect_global_support(connection, dataset_id, sorted_seed_candidates, args, fused_candidates)
    if args.mode in {"hybrid", "mix", "vector"}:
        collect_vector_support(connection, dataset_id, query_text, args, fused_candidates)
    if args.mode == "mix":
        collect_text_support(connection, dataset_id, query_text, args, fused_candidates)

    if not fused_candidates:
        merge_candidate_sets(fused_candidates, seed_candidates)
    return finalize_candidates(fused_candidates, args.mode, args.limit)


def persist_candidates(
    connection: psycopg.Connection,
    dataset_id: str,
    batch_anchor: str,
    query_id: str,
    query_text: str,
    candidates: list[dict[str, Any]],
    args: argparse.Namespace,
) -> None:
    with connection.cursor() as cur:
        if args.replace:
            cur.execute(
                """
                DELETE FROM retrieval_candidates
                WHERE dataset_id = %s AND query_id = %s
                """,
                (dataset_id, query_id),
            )

        now = utc_now()
        filters = {
            "mode": args.mode,
            "subject": args.subject,
            "school_stage": args.school_stage,
            "grade_band": args.grade_band,
            "node_kind": args.node_kind,
            "limit": args.limit,
            "graph_seed_limit": args.graph_seed_limit,
            "graph_neighbor_limit": args.graph_neighbor_limit,
            "text_hit_limit": args.text_hit_limit,
        }

        rows = [
            (
                dataset_id,
                batch_anchor,
                query_id,
                query_text,
                candidate["node_id"],
                rank,
                candidate["score"],
                candidate["method"],
                filters,  # JSONB — pass native Python dict directly
                now,
            )
            for rank, candidate in enumerate(candidates, start=1)
        ]
        if rows:
            psycopg.extras.execute_values(
                cur,
                """
                INSERT INTO retrieval_candidates (
                  dataset_id,
                  batch_anchor,
                  query_id,
                  query_text,
                  candidate_node_id,
                  rank,
                  score,
                  retrieval_method,
                  filters_json,
                  created_at
                ) VALUES %s
                ON CONFLICT (dataset_id, query_id, candidate_node_id)
                DO UPDATE SET
                  batch_anchor = EXCLUDED.batch_anchor,
                  query_text = EXCLUDED.query_text,
                  rank = EXCLUDED.rank,
                  score = EXCLUDED.score,
                  retrieval_method = EXCLUDED.retrieval_method,
                  filters_json = EXCLUDED.filters_json,
                  created_at = EXCLUDED.created_at
                """,
                rows,
            )


def main() -> int:
    args = parse_args()
    queries = load_queries(args)
    connection = connect_db(args.db)
    ensure_pg_schema(connection)
    dataset_id = resolve_dataset_id(connection, args.dataset_id, args.output_root)
    require_dataset_row(connection, dataset_id)

    if args.write and not args.batch_anchor:
        raise SystemExit("--write requires --batch-anchor.")

    payloads: list[dict[str, Any]] = []
    with connection:
        for raw_query in queries:
            query_text = raw_query["query_text"]
            query_id = raw_query.get("query_id") or make_query_id(args.batch_anchor or "adhoc", query_text)
            candidates = retrieve_for_query(connection, dataset_id, query_text, args)
            payload = {
                "dataset_id": dataset_id,
                "batch_anchor": args.batch_anchor,
                "query_id": query_id,
                "query_text": query_text,
                "filters": {
                    "mode": args.mode,
                    "subject": args.subject,
                    "school_stage": args.school_stage,
                    "grade_band": args.grade_band,
                    "node_kind": args.node_kind,
                },
                "candidates": candidates,
            }
            payloads.append(payload)
            if args.write:
                persist_candidates(
                    connection,
                    dataset_id,
                    args.batch_anchor,
                    query_id,
                    query_text,
                    candidates,
                    args,
                )

    for payload in payloads:
        print(json.dumps(payload, ensure_ascii=False))

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
