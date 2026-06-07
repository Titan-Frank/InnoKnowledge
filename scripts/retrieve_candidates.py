#!/usr/bin/env python3
"""Retrieve top-k world node candidates for a lesson/batch."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

import psycopg

from knowledge_store_common import (
    connect_db,
    ensure_pg_schema,
    make_query_id,
    normalize_term,
    require_valid_edge_type,
    require_dataset_row,
    resolve_dataset_id,
    utc_now,
)
from embedding_client import embed_single, DEFAULT_EMBEDDING_MODEL, DEFAULT_EMBEDDING_URL


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Retrieve constrained node candidates from world knowledge store.")
    parser.add_argument("queries", nargs="*")
    parser.add_argument("--queries-file")
    parser.add_argument("--db", default=os.environ.get("DATABASE_URL"))
    parser.add_argument("--dataset-id")
    parser.add_argument("--output-root")
    parser.add_argument("--batch-anchor")
    parser.add_argument("--domain")
    parser.add_argument("--school-stage")
    parser.add_argument("--node-kind")
    parser.add_argument("--mode", choices=("local", "hybrid", "vector"), default="hybrid")
    parser.add_argument("--limit", type=int, default=8)
    parser.add_argument("--embedding-url", default=DEFAULT_EMBEDDING_URL)
    parser.add_argument("--embedding-model", default=DEFAULT_EMBEDDING_MODEL)
    parser.add_argument("--vector-min-similarity", type=float, default=0.5)
    parser.add_argument("--write", action="store_true")
    parser.add_argument("--replace", action="store_true")
    return parser.parse_args()


def load_queries(args: argparse.Namespace) -> list[dict[str, str]]:
    queries = [{"query_text": item} for item in args.queries if item.strip()]
    if args.queries_file:
        path = Path(args.queries_file).expanduser().resolve()
        if path.suffix == ".jsonl":
            for line in path.read_text(encoding="utf-8").splitlines():
                if not line.strip():
                    continue
                record = json.loads(line)
                queries.append({"query_text": str(record["query_text"]).strip(), "query_id": str(record.get("query_id") or "").strip()})
        else:
            for line in path.read_text(encoding="utf-8").splitlines():
                if line.strip():
                    queries.append({"query_text": line.strip()})
    if not queries:
        raise SystemExit("Provide at least one query or --queries-file.")
    return queries


def fetch_local_candidates(connection: psycopg.Connection, dataset_id: str, query_text: str, args: argparse.Namespace) -> list[dict[str, Any]]:
    term = normalize_term(query_text)
    clauses = ["n.dataset_id = %s", "n.status != 'deprecated'"]
    params: list[Any] = [dataset_id]
    if args.node_kind:
        clauses.append("n.kind = %s")
        params.append(args.node_kind)
    if args.domain:
        clauses.append("EXISTS (SELECT 1 FROM world_domain_profiles p WHERE p.dataset_id = n.dataset_id AND p.node_id = n.id AND p.domain = %s)")
        params.append(args.domain)
    if args.school_stage:
        clauses.append("EXISTS (SELECT 1 FROM world_domain_profiles p WHERE p.dataset_id = n.dataset_id AND p.node_id = n.id AND %s = ANY(SELECT jsonb_array_elements_text(p.school_stages_json)))")
        params.append(args.school_stage)
    with connection.cursor() as cur:
        cur.execute(
            f"""
            SELECT n.id, n.name, n.kind,
                   CASE
                     WHEN nt.term_norm = %s THEN 100
                     WHEN nt.term_norm LIKE %s THEN 85
                     ELSE 70
                   END AS score
            FROM world_node_terms nt
            JOIN world_nodes n
              ON n.dataset_id = nt.dataset_id AND n.id = nt.node_id
            WHERE {' AND '.join(clauses)}
              AND (nt.term_norm = %s OR nt.term_norm LIKE %s OR n.definition ILIKE %s)
            ORDER BY score DESC, n.name
            LIMIT %s
            """,
            [term, f"{term}%", *params, term, f"{term}%", f"%{query_text.strip()}%", args.limit * 3],
        )
        rows = cur.fetchall()
    return [{"node_id": row["id"], "name": row["name"], "kind": row["kind"], "score": float(row["score"]), "method": "local"} for row in rows]


def fetch_vector_candidates(connection: psycopg.Connection, dataset_id: str, query_text: str, args: argparse.Namespace) -> list[dict[str, Any]]:
    embedding = embed_single(query_text, url=args.embedding_url, model=args.embedding_model, api_key=os.environ.get("EMBEDDING_API_KEY"))
    if not embedding:
        return []
    clauses = ["dataset_id = %s", "status != 'deprecated'", "embedding IS NOT NULL"]
    params: list[Any] = [dataset_id]
    if args.node_kind:
        clauses.append("kind = %s")
        params.append(args.node_kind)
    with connection.cursor() as cur:
        cur.execute(
            f"""
            SELECT id, name, kind, 1 - (embedding <=> %s::vector) AS similarity
            FROM world_nodes
            WHERE {' AND '.join(clauses)}
            ORDER BY embedding <=> %s::vector
            LIMIT %s
            """,
            [embedding, *params, embedding, args.limit * 2],
        )
        rows = cur.fetchall()
    result = []
    for row in rows:
        similarity = float(row["similarity"])
        if similarity < args.vector_min_similarity:
            continue
        result.append({"node_id": row["id"], "name": row["name"], "kind": row["kind"], "score": 40 + similarity * 50, "method": "vector"})
    return result


def merge_candidates(*groups: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    merged: dict[str, dict[str, Any]] = {}
    for group in groups:
        for candidate in group:
            existing = merged.get(candidate["node_id"])
            if existing is None or candidate["score"] > existing["score"]:
                merged[candidate["node_id"]] = dict(candidate)
            elif existing is not None:
                existing["score"] += candidate["score"] * 0.1
                existing["method"] = f"{existing['method']}+{candidate['method']}"
    return sorted(merged.values(), key=lambda item: (-item["score"], item["name"], item["node_id"]))[:limit]


def persist_candidates(connection: psycopg.Connection, dataset_id: str, batch_anchor: str, query_id: str, query_text: str, candidates: list[dict[str, Any]], args: argparse.Namespace) -> None:
    with connection.cursor() as cur:
        if args.replace:
            cur.execute("DELETE FROM retrieval_candidates WHERE dataset_id = %s AND query_id = %s", (dataset_id, query_id))
        now = utc_now()
        for rank, candidate in enumerate(candidates, start=1):
            cur.execute(
                """
                INSERT INTO retrieval_candidates (
                  dataset_id, batch_anchor, query_id, query_text, candidate_node_id,
                  rank, score, retrieval_method, filters_json, created_at
                ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s)
                ON CONFLICT (dataset_id, query_id, candidate_node_id) DO UPDATE SET
                  rank = EXCLUDED.rank,
                  score = EXCLUDED.score,
                  retrieval_method = EXCLUDED.retrieval_method,
                  filters_json = EXCLUDED.filters_json,
                  created_at = EXCLUDED.created_at
                """,
                (
                    dataset_id,
                    batch_anchor,
                    query_id,
                    query_text,
                    candidate["node_id"],
                    rank,
                    candidate["score"],
                    candidate["method"],
                    json.dumps({"mode": args.mode, "domain": args.domain, "school_stage": args.school_stage, "node_kind": args.node_kind}, ensure_ascii=False),
                    now,
                ),
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
    payloads = []
    with connection:
        for raw_query in queries:
            query_text = raw_query["query_text"]
            query_id = raw_query.get("query_id") or make_query_id(args.batch_anchor or "adhoc", query_text)
            local = fetch_local_candidates(connection, dataset_id, query_text, args)
            vector = fetch_vector_candidates(connection, dataset_id, query_text, args) if args.mode in {"hybrid", "vector"} else []
            candidates = merge_candidates(local, vector, limit=args.limit) if args.mode == "hybrid" else (vector[: args.limit] if args.mode == "vector" else local[: args.limit])
            payload = {"dataset_id": dataset_id, "batch_anchor": args.batch_anchor, "query_id": query_id, "query_text": query_text, "candidates": candidates}
            payloads.append(payload)
            if args.write:
                persist_candidates(connection, dataset_id, args.batch_anchor, query_id, query_text, candidates, args)
    for payload in payloads:
        print(json.dumps(payload, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
