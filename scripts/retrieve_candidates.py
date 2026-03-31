#!/usr/bin/env python3
"""Retrieve top-k node candidates for a lesson/batch and optionally persist them."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from knowledge_store_common import (
    DEFAULT_DB_PATH,
    connect_db,
    dump_json_text,
    ensure_sqlite_schema,
    make_query_id,
    normalize_term,
    require_dataset_row,
    resolve_dataset_id,
    utc_now,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Retrieve constrained node candidates from the SQLite knowledge store."
    )
    parser.add_argument("queries", nargs="*", help="One or more query strings.")
    parser.add_argument("--queries-file", help="Optional text or JSONL file of queries.")
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH))
    parser.add_argument("--dataset-id")
    parser.add_argument("--output-root")
    parser.add_argument("--batch-anchor", help="Batch anchor used when persisting retrieval results.")
    parser.add_argument("--subject")
    parser.add_argument("--school-stage")
    parser.add_argument("--grade-band")
    parser.add_argument("--node-kind")
    parser.add_argument("--limit", type=int, default=8)
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


def build_profile_exists_clause(args: argparse.Namespace) -> tuple[str, list[str]]:
    clauses: list[str] = []
    params: list[str] = []
    if args.subject:
        clauses.append("p.subject = ?")
        params.append(args.subject)
    if args.school_stage:
        clauses.append("p.school_stage = ?")
        params.append(args.school_stage)
    if args.grade_band:
        clauses.append("p.grade_band = ?")
        params.append(args.grade_band)

    if not clauses:
        return "", []

    sql = (
        "EXISTS (SELECT 1 FROM profiles p "
        "WHERE p.dataset_id = n.dataset_id AND p.node_id = n.id AND "
        + " AND ".join(clauses)
        + ")"
    )
    return sql, params


def add_candidate(
    candidates: dict[str, dict[str, Any]],
    node_id: str,
    canonical_name: str,
    node_kind: str,
    score: float,
    method: str,
) -> None:
    existing = candidates.get(node_id)
    if existing is None or score > existing["score"]:
        candidates[node_id] = {
            "node_id": node_id,
            "canonical_name": canonical_name,
            "node_kind": node_kind,
            "score": score,
            "method": method,
        }


def retrieve_for_query(
    connection,
    dataset_id: str,
    query_text: str,
    args: argparse.Namespace,
) -> list[dict[str, Any]]:
    candidates: dict[str, dict[str, Any]] = {}
    normalized = normalize_term(query_text)
    profile_clause, profile_params = build_profile_exists_clause(args)

    where_parts = ["n.dataset_id = ?"]
    base_params: list[Any] = [dataset_id]
    if args.node_kind:
        where_parts.append("n.node_kind = ?")
        base_params.append(args.node_kind)
    if profile_clause:
        where_parts.append(profile_clause)
        base_params.extend(profile_params)
    where_sql = " AND ".join(where_parts)

    exact_rows = connection.execute(
        f"""
        SELECT nt.node_id, nt.term_type, n.canonical_name, n.node_kind
        FROM node_terms nt
        JOIN nodes n
          ON n.dataset_id = nt.dataset_id AND n.id = nt.node_id
        WHERE {where_sql}
          AND nt.term_norm = ?
        ORDER BY CASE nt.term_type WHEN 'canonical' THEN 0 ELSE 1 END, n.canonical_name
        LIMIT 50
        """,
        (*base_params, normalized),
    ).fetchall()
    for row in exact_rows:
        score = 100.0 if row["term_type"] == "canonical" else 95.0
        add_candidate(
            candidates,
            row["node_id"],
            row["canonical_name"],
            row["node_kind"],
            score,
            f"exact_{row['term_type']}",
        )

    prefix_rows = connection.execute(
        f"""
        SELECT nt.node_id, nt.term_type, n.canonical_name, n.node_kind
        FROM node_terms nt
        JOIN nodes n
          ON n.dataset_id = nt.dataset_id AND n.id = nt.node_id
        WHERE {where_sql}
          AND nt.term_norm LIKE ?
        ORDER BY CASE nt.term_type WHEN 'canonical' THEN 0 ELSE 1 END, n.canonical_name
        LIMIT 50
        """,
        (*base_params, f"{normalized}%"),
    ).fetchall()
    for rank, row in enumerate(prefix_rows, start=1):
        score = 85.0 - min(rank, 20) * 0.5
        add_candidate(
            candidates,
            row["node_id"],
            row["canonical_name"],
            row["node_kind"],
            score,
            f"prefix_{row['term_type']}",
        )

    escaped_query = query_text.replace('"', '""').strip()
    if escaped_query:
        fts_rows = connection.execute(
            f"""
            SELECT ns.node_id, n.canonical_name, n.node_kind, bm25(node_search) AS rank_score
            FROM node_search ns
            JOIN nodes n
              ON n.dataset_id = ns.dataset_id AND n.id = ns.node_id
            WHERE {where_sql}
              AND node_search MATCH ?
            ORDER BY rank_score
            LIMIT 50
            """,
            (*base_params, f'"{escaped_query}"'),
        ).fetchall()
        for rank, row in enumerate(fts_rows, start=1):
            score = 70.0 - min(rank, 20) * 0.5
            add_candidate(
                candidates,
                row["node_id"],
                row["canonical_name"],
                row["node_kind"],
                score,
                "fts_phrase",
            )

    sorted_candidates = sorted(
        candidates.values(),
        key=lambda item: (-item["score"], item["canonical_name"], item["node_id"]),
    )
    return sorted_candidates[: args.limit]


def persist_candidates(
    connection,
    dataset_id: str,
    batch_anchor: str,
    query_id: str,
    query_text: str,
    candidates: list[dict[str, Any]],
    args: argparse.Namespace,
) -> None:
    if args.replace:
        connection.execute(
            """
            DELETE FROM retrieval_candidates
            WHERE dataset_id = ? AND query_id = ?
            """,
            (dataset_id, query_id),
        )

    now = utc_now()
    filters_json = dump_json_text(
        {
            "subject": args.subject,
            "school_stage": args.school_stage,
            "grade_band": args.grade_band,
            "node_kind": args.node_kind,
            "limit": args.limit,
        }
    )
    connection.executemany(
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                dataset_id,
                batch_anchor,
                query_id,
                query_text,
                candidate["node_id"],
                rank,
                candidate["score"],
                candidate["method"],
                filters_json,
                now,
            )
            for rank, candidate in enumerate(candidates, start=1)
        ],
    )


def main() -> int:
    args = parse_args()
    queries = load_queries(args)
    connection = connect_db(args.db)
    ensure_sqlite_schema(connection)
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
