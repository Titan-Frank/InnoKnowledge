#!/usr/bin/env python3
"""MCP server for world-knowledge staging operations."""

from __future__ import annotations

import json
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

import psycopg
from mcp.server.fastmcp import FastMCP

from knowledge_store_common import (
    connect_db,
    ensure_dataset,
    ensure_pg_schema,
    make_lesson_run_id,
    require_dataset_row,
    resolve_dataset_id,
    resolve_outline_anchor,
)
from store_lesson_staging import (
    auto_embed_nodes,
    check_staging_integrity,
    normalize_domain_profiles,
    normalize_edges,
    normalize_evidence,
    normalize_mentions,
    normalize_node_cards,
    normalize_nodes,
    replace_table_rows,
    _store_domain_profiles,
    _store_edges,
    _store_evidence,
    _store_mentions,
    _store_node_cards,
    _store_nodes,
    _upsert_lesson_run,
)

mcp = FastMCP("world-knowledge-staging")

_connection: psycopg.Connection | None = None
_dataset_id: str | None = None


def _get_connection() -> psycopg.Connection:
    global _connection
    if _connection is not None and not _connection.closed:
        return _connection
    _connection = connect_db()
    ensure_pg_schema(_connection)
    return _connection


def _resolve_dataset(conn: psycopg.Connection, dataset_id: str | None, root: str = "data/main") -> str:
    global _dataset_id
    if dataset_id:
        return dataset_id
    if _dataset_id is None:
        _dataset_id = resolve_dataset_id(conn, output_root=root)
        ensure_dataset(conn, _dataset_id, root)
        require_dataset_row(conn, _dataset_id)
    return _dataset_id


@mcp.tool()
def start_lesson_run(
    book_id: str,
    batch_anchor: str,
    root: str = "data/main",
    dataset_id: str | None = None,
    lesson_run_id: str | None = None,
) -> dict[str, Any]:
    conn = _get_connection()
    did = _resolve_dataset(conn, dataset_id, root)
    anchor = resolve_outline_anchor(book_id, batch_anchor, strict=True)
    lrid = lesson_run_id or make_lesson_run_id(book_id, anchor)
    _upsert_lesson_run(conn, did, lrid, book_id, anchor)
    conn.commit()
    return {"lesson_run_id": lrid, "dataset_id": did, "batch_anchor": anchor}


@mcp.tool()
def store_staging_nodes(
    lesson_run_id: str,
    book_id: str,
    batch_anchor: str,
    nodes: list[dict[str, Any]],
    embed: bool = True,
    dataset_id: str | None = None,
) -> dict[str, Any]:
    conn = _get_connection()
    did = _resolve_dataset(conn, dataset_id)
    payload = normalize_nodes(nodes)
    if embed:
        payload = auto_embed_nodes(payload)
    _store_nodes(conn, did, lesson_run_id, book_id, batch_anchor, payload)
    conn.commit()
    return {"stored": len(payload)}


@mcp.tool()
def store_staging_edges(
    lesson_run_id: str,
    book_id: str,
    batch_anchor: str,
    edges: list[dict[str, Any]],
    dataset_id: str | None = None,
) -> dict[str, Any]:
    conn = _get_connection()
    did = _resolve_dataset(conn, dataset_id)
    payload = normalize_edges(edges)
    _store_edges(conn, did, lesson_run_id, book_id, batch_anchor, payload)
    conn.commit()
    return {"stored": len(payload)}


@mcp.tool()
def store_staging_domain_profiles(
    lesson_run_id: str,
    domain_profiles: list[dict[str, Any]],
    dataset_id: str | None = None,
) -> dict[str, Any]:
    conn = _get_connection()
    did = _resolve_dataset(conn, dataset_id)
    payload = normalize_domain_profiles(domain_profiles)
    _store_domain_profiles(conn, did, lesson_run_id, payload)
    conn.commit()
    return {"stored": len(payload)}


@mcp.tool()
def store_staging_mentions(
    lesson_run_id: str,
    book_id: str,
    batch_anchor: str,
    mentions: list[dict[str, Any]],
    dataset_id: str | None = None,
) -> dict[str, Any]:
    conn = _get_connection()
    did = _resolve_dataset(conn, dataset_id)
    payload = normalize_mentions(mentions, book_id, batch_anchor)
    _store_mentions(conn, did, lesson_run_id, payload)
    conn.commit()
    return {"stored": len(payload)}


@mcp.tool()
def store_staging_evidence(
    lesson_run_id: str,
    book_id: str,
    batch_anchor: str,
    evidence: list[dict[str, Any]],
    dataset_id: str | None = None,
) -> dict[str, Any]:
    conn = _get_connection()
    did = _resolve_dataset(conn, dataset_id)
    payload = normalize_evidence(evidence, book_id, batch_anchor)
    _store_evidence(conn, did, lesson_run_id, payload)
    conn.commit()
    return {"stored": len(payload)}


@mcp.tool()
def store_staging_node_cards(
    lesson_run_id: str,
    node_cards: list[dict[str, Any]],
    dataset_id: str | None = None,
) -> dict[str, Any]:
    conn = _get_connection()
    did = _resolve_dataset(conn, dataset_id)
    payload = normalize_node_cards(node_cards)
    _store_node_cards(conn, did, lesson_run_id, payload)
    conn.commit()
    return {"stored": len(payload)}


@mcp.tool()
def finalize_lesson_run(lesson_run_id: str, dataset_id: str | None = None) -> dict[str, Any]:
    conn = _get_connection()
    did = _resolve_dataset(conn, dataset_id)
    tables = {
        "nodes": "world_staging_nodes",
        "edges": "world_staging_edges",
        "domain_profiles": "world_staging_domain_profiles",
        "mentions": "world_staging_mentions",
        "evidence": "world_staging_evidence",
        "node_cards": "world_staging_node_cards",
    }
    counts: dict[str, int] = {}
    with conn.cursor() as cur:
        for key, table in tables.items():
            cur.execute(
                f"SELECT COUNT(*) AS count FROM {table} WHERE dataset_id = %s AND lesson_run_id = %s",
                (did, lesson_run_id),
            )
            counts[key] = int(cur.fetchone()["count"])
        cur.execute(
            """
            UPDATE world_lesson_runs
            SET status = 'staged', counts_json = %s::jsonb
            WHERE dataset_id = %s AND lesson_run_id = %s
            """,
            (json.dumps(counts, ensure_ascii=False), did, lesson_run_id),
        )
    conn.commit()
    return {"lesson_run_id": lesson_run_id, "counts": counts}


@mcp.tool()
def check_lesson_staging_integrity(lesson_run_id: str, dataset_id: str | None = None) -> dict[str, Any]:
    conn = _get_connection()
    did = _resolve_dataset(conn, dataset_id)
    return check_staging_integrity(conn, did, lesson_run_id)


if __name__ == "__main__":
    mcp.run()
