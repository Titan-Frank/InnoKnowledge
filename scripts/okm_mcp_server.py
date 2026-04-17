#!/usr/bin/env python3
"""MCP server for Open-Knowledge-Map staging operations.

Exposes staging table writes as MCP tools so LLM agents can write
directly to PostgreSQL without constructing JSON files or bash commands.

SQL and normalize logic are reused from store_lesson_staging.py.
"""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path
from typing import Any

# Ensure scripts/ is importable
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
    utc_now,
)
from store_lesson_staging import (
    auto_embed_nodes,
    normalize_edges,
    normalize_evidence,
    normalize_mentions,
    normalize_node_cards,
    normalize_nodes,
    normalize_profiles,
    replace_table_rows,
)
from embedding_client import DEFAULT_EMBEDDING_URL, DEFAULT_EMBEDDING_MODEL

EMBEDDING_API_KEY = "2uuD5+89UvtRc4nCn5ZMjQyArLh37ndg3Q5fMeZl7p0="

mcp = FastMCP("okm-staging")

# ---------------------------------------------------------------------------
# Connection management
# ---------------------------------------------------------------------------

_connection: psycopg.Connection | None = None
_dataset_id: str | None = None


def _get_connection() -> psycopg.Connection:
    global _connection
    if _connection is not None and not _connection.closed:
        return _connection
    _connection = connect_db()
    ensure_pg_schema(_connection)
    return _connection


def _ensure_dataset_id(conn: psycopg.Connection, root: str = "data/main") -> str:
    global _dataset_id
    if _dataset_id is not None:
        return _dataset_id
    _dataset_id = resolve_dataset_id(conn, output_root=root)
    ensure_dataset(conn, _dataset_id, root)
    require_dataset_row(conn, _dataset_id)
    return _dataset_id


def _resolve_dataset(conn: psycopg.Connection, dataset_id: str | None) -> str:
    if dataset_id:
        return dataset_id
    return _ensure_dataset_id(conn)


# ---------------------------------------------------------------------------
# Shared INSERT helpers (SQL mirrors store_lesson_staging.py)
# ---------------------------------------------------------------------------

_SQL_INSERT_LESSON_RUN = """
INSERT INTO lesson_runs (
  dataset_id, lesson_run_id, book_id, batch_anchor,
  status, counts_json, properties_json, created_at, updated_at
) VALUES (%s, %s, %s, %s, 'staged', %s, %s, %s, %s)
ON CONFLICT (dataset_id, lesson_run_id) DO UPDATE SET
  book_id = EXCLUDED.book_id,
  batch_anchor = EXCLUDED.batch_anchor,
  status = EXCLUDED.status,
  counts_json = EXCLUDED.counts_json,
  properties_json = EXCLUDED.properties_json,
  updated_at = EXCLUDED.updated_at
"""

_SQL_UPSERT_NODE = """
INSERT INTO staging_nodes (
  dataset_id, lesson_run_id, raw_node_id, book_id, batch_anchor,
  canonical_name, node_kind, node_layer, node_subkind, definition,
  aliases_json, learning_modes_json, bridge_tags_json, framework_refs_json,
  profile_refs_json, same_as_refs_json, properties_json, semantic_key,
  embedding, source_refs_json, status, created_at, updated_at, notes
) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
          %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
          %s, %s, %s, %s)
ON CONFLICT (dataset_id, lesson_run_id, raw_node_id) DO UPDATE SET
  book_id = EXCLUDED.book_id,
  batch_anchor = EXCLUDED.batch_anchor,
  canonical_name = EXCLUDED.canonical_name,
  node_kind = EXCLUDED.node_kind,
  node_layer = EXCLUDED.node_layer,
  node_subkind = EXCLUDED.node_subkind,
  definition = EXCLUDED.definition,
  aliases_json = EXCLUDED.aliases_json,
  learning_modes_json = EXCLUDED.learning_modes_json,
  bridge_tags_json = EXCLUDED.bridge_tags_json,
  framework_refs_json = EXCLUDED.framework_refs_json,
  profile_refs_json = EXCLUDED.profile_refs_json,
  same_as_refs_json = EXCLUDED.same_as_refs_json,
  properties_json = EXCLUDED.properties_json,
  semantic_key = EXCLUDED.semantic_key,
  embedding = EXCLUDED.embedding,
  source_refs_json = EXCLUDED.source_refs_json,
  status = EXCLUDED.status,
  updated_at = EXCLUDED.updated_at,
  notes = EXCLUDED.notes
"""

_SQL_UPSERT_EDGE = """
INSERT INTO staging_edges (
  dataset_id, lesson_run_id, raw_edge_id, book_id, batch_anchor,
  edge_type, edge_layer, backbone_expand, from_raw_node_id, to_raw_node_id,
  directionality, confidence, framework_refs_json, profile_refs_json,
  source_refs_json, properties_json, status, created_at, updated_at
) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
          %s, %s, %s, %s, %s, %s, %s, %s, %s)
ON CONFLICT (dataset_id, lesson_run_id, raw_edge_id) DO UPDATE SET
  book_id = EXCLUDED.book_id,
  batch_anchor = EXCLUDED.batch_anchor,
  edge_type = EXCLUDED.edge_type,
  edge_layer = EXCLUDED.edge_layer,
  backbone_expand = EXCLUDED.backbone_expand,
  from_raw_node_id = EXCLUDED.from_raw_node_id,
  to_raw_node_id = EXCLUDED.to_raw_node_id,
  directionality = EXCLUDED.directionality,
  confidence = EXCLUDED.confidence,
  framework_refs_json = EXCLUDED.framework_refs_json,
  profile_refs_json = EXCLUDED.profile_refs_json,
  source_refs_json = EXCLUDED.source_refs_json,
  properties_json = EXCLUDED.properties_json,
  status = EXCLUDED.status,
  updated_at = EXCLUDED.updated_at
"""

_SQL_UPSERT_PROFILE = """
INSERT INTO staging_profiles (
  dataset_id, lesson_run_id, raw_profile_id, raw_node_id, subject,
  school_stage, grade_band, context_key, curriculum_role, mastery_level,
  framework_refs_json, textbook_refs_json, textbook_ids_json,
  learning_objectives_json, assessment_signals_json, source_refs_json,
  properties_json, status, created_at, updated_at
) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
          %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
ON CONFLICT (dataset_id, lesson_run_id, raw_profile_id) DO UPDATE SET
  raw_node_id = EXCLUDED.raw_node_id,
  subject = EXCLUDED.subject,
  school_stage = EXCLUDED.school_stage,
  grade_band = EXCLUDED.grade_band,
  context_key = EXCLUDED.context_key,
  curriculum_role = EXCLUDED.curriculum_role,
  mastery_level = EXCLUDED.mastery_level,
  framework_refs_json = EXCLUDED.framework_refs_json,
  textbook_refs_json = EXCLUDED.textbook_refs_json,
  textbook_ids_json = EXCLUDED.textbook_ids_json,
  learning_objectives_json = EXCLUDED.learning_objectives_json,
  assessment_signals_json = EXCLUDED.assessment_signals_json,
  source_refs_json = EXCLUDED.source_refs_json,
  properties_json = EXCLUDED.properties_json,
  status = EXCLUDED.status,
  updated_at = EXCLUDED.updated_at
"""

_SQL_UPSERT_MENTION = """
INSERT INTO staging_mentions (
  dataset_id, lesson_run_id, raw_mention_id, source_type, source_id,
  anchor_ref, target_type, target_raw_id, role, source_refs_json,
  confidence, properties_json, created_at, updated_at
) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
          %s, %s, %s, %s)
ON CONFLICT (dataset_id, lesson_run_id, raw_mention_id) DO UPDATE SET
  source_type = EXCLUDED.source_type,
  source_id = EXCLUDED.source_id,
  anchor_ref = EXCLUDED.anchor_ref,
  target_type = EXCLUDED.target_type,
  target_raw_id = EXCLUDED.target_raw_id,
  role = EXCLUDED.role,
  source_refs_json = EXCLUDED.source_refs_json,
  confidence = EXCLUDED.confidence,
  properties_json = EXCLUDED.properties_json,
  updated_at = EXCLUDED.updated_at
"""

_SQL_UPSERT_EVIDENCE = """
INSERT INTO staging_evidence (
  dataset_id, lesson_run_id, raw_evidence_id, source_type, source_id,
  anchor_ref, source_path, page_start, page_end, excerpt, locator,
  modality, extraction_method, normalized_claims_json, properties_json,
  created_at, updated_at
) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
          %s, %s, %s, %s, %s, %s, %s)
ON CONFLICT (dataset_id, lesson_run_id, raw_evidence_id) DO UPDATE SET
  source_type = EXCLUDED.source_type,
  source_id = EXCLUDED.source_id,
  anchor_ref = EXCLUDED.anchor_ref,
  source_path = EXCLUDED.source_path,
  page_start = EXCLUDED.page_start,
  page_end = EXCLUDED.page_end,
  excerpt = EXCLUDED.excerpt,
  locator = EXCLUDED.locator,
  modality = EXCLUDED.modality,
  extraction_method = EXCLUDED.extraction_method,
  normalized_claims_json = EXCLUDED.normalized_claims_json,
  properties_json = EXCLUDED.properties_json,
  updated_at = EXCLUDED.updated_at
"""

_SQL_UPSERT_NODE_CARD = """
INSERT INTO staging_node_cards (
  dataset_id, lesson_run_id, raw_card_id, raw_node_id, card_layer,
  title, summary, pattern_refs_json, framework_refs_json, profile_refs_json,
  mention_refs_json, source_refs_json, sections_json, properties_json,
  status, created_at, updated_at
) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
          %s, %s, %s, %s, %s, %s, %s)
ON CONFLICT (dataset_id, lesson_run_id, raw_card_id) DO UPDATE SET
  raw_node_id = EXCLUDED.raw_node_id,
  card_layer = EXCLUDED.card_layer,
  title = EXCLUDED.title,
  summary = EXCLUDED.summary,
  pattern_refs_json = EXCLUDED.pattern_refs_json,
  framework_refs_json = EXCLUDED.framework_refs_json,
  profile_refs_json = EXCLUDED.profile_refs_json,
  mention_refs_json = EXCLUDED.mention_refs_json,
  source_refs_json = EXCLUDED.source_refs_json,
  sections_json = EXCLUDED.sections_json,
  properties_json = EXCLUDED.properties_json,
  status = EXCLUDED.status,
  updated_at = EXCLUDED.updated_at
"""

_SQL_UPDATE_LESSON_RUN_FINALIZED = """
UPDATE lesson_runs
SET status = 'staged', counts_json = %s, updated_at = %s
WHERE dataset_id = %s AND lesson_run_id = %s
"""

_STAGING_TABLES = [
    "staging_nodes",
    "staging_edges",
    "staging_profiles",
    "staging_mentions",
    "staging_evidence",
    "staging_node_cards",
]


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------


@mcp.tool()
def start_lesson_run(
    book_id: str,
    batch_anchor: str,
    root: str = "data/main",
    dataset_id: str | None = None,
    lesson_run_id: str | None = None,
) -> dict[str, Any]:
    """Create a lesson_runs row and return the lesson_run_id.

    Call this before any store_staging_* tool. If the lesson_run already
    exists it is updated (idempotent).
    """
    conn = _get_connection()
    did = _resolve_dataset(conn, dataset_id)
    anchor = resolve_outline_anchor(book_id, batch_anchor, strict=True)
    lrid = lesson_run_id or make_lesson_run_id(book_id, anchor)
    now = utc_now()

    with conn.cursor() as cur:
        cur.execute(
            _SQL_INSERT_LESSON_RUN,
            (did, lrid, book_id, anchor, json.dumps({}), json.dumps({}), now, now),
        )
    conn.commit()

    return {
        "lesson_run_id": lrid,
        "dataset_id": did,
        "batch_anchor": anchor,
    }


@mcp.tool()
def store_staging_nodes(
    lesson_run_id: str,
    book_id: str,
    batch_anchor: str,
    nodes: list[dict[str, Any]],
    embed: bool = True,
    append: bool = False,
    dataset_id: str | None = None,
) -> dict[str, Any]:
    """Normalize, optionally auto-embed, and upsert nodes into staging_nodes."""
    conn = _get_connection()
    did = _resolve_dataset(conn, dataset_id)
    anchor = resolve_outline_anchor(book_id, batch_anchor, strict=True)
    now = utc_now()

    normalized = normalize_nodes(nodes)
    embedded_count = 0
    if embed:
        before = sum(1 for n in normalized if n.get("embedding_json"))
        normalized = auto_embed_nodes(
            normalized,
            url=DEFAULT_EMBEDDING_URL,
            model=DEFAULT_EMBEDDING_MODEL,
            api_key=EMBEDDING_API_KEY,
        )
        after = sum(1 for n in normalized if n.get("embedding_json"))
        embedded_count = after - before

    if not append:
        replace_table_rows(conn, "staging_nodes", did, lesson_run_id)

    with conn.cursor() as cur:
        for r in normalized:
            cur.execute(
                _SQL_UPSERT_NODE,
                (
                    did, lesson_run_id, r["raw_node_id"], book_id, anchor,
                    r["canonical_name"], r["node_kind"], r["node_layer"],
                    r["node_subkind"], r["definition"],
                    json.dumps(r["aliases_json"]),
                    json.dumps(r["learning_modes_json"]),
                    json.dumps(r["bridge_tags_json"]),
                    json.dumps(r["framework_refs_json"]),
                    json.dumps(r["profile_refs_json"]),
                    json.dumps(r["same_as_refs_json"]),
                    json.dumps(r["properties_json"]),
                    r["semantic_key"],
                    json.dumps(r["embedding_json"]) if r.get("embedding_json") else None,
                    json.dumps(r["source_refs_json"]),
                    r["status"], now, now, r["notes"],
                ),
            )
    conn.commit()

    return {"stored": len(normalized), "embedded": embedded_count}


@mcp.tool()
def store_staging_edges(
    lesson_run_id: str,
    book_id: str,
    batch_anchor: str,
    edges: list[dict[str, Any]],
    append: bool = False,
    dataset_id: str | None = None,
) -> dict[str, Any]:
    """Normalize and upsert edges into staging_edges."""
    conn = _get_connection()
    did = _resolve_dataset(conn, dataset_id)
    anchor = resolve_outline_anchor(book_id, batch_anchor, strict=True)
    now = utc_now()

    normalized = normalize_edges(edges)

    if not append:
        replace_table_rows(conn, "staging_edges", did, lesson_run_id)

    with conn.cursor() as cur:
        for r in normalized:
            cur.execute(
                _SQL_UPSERT_EDGE,
                (
                    did, lesson_run_id, r["raw_edge_id"], book_id, anchor,
                    r["edge_type"], r["edge_layer"], r["backbone_expand"],
                    r["from_raw_node_id"], r["to_raw_node_id"],
                    r["directionality"], r["confidence"],
                    json.dumps(r["framework_refs_json"]),
                    json.dumps(r["profile_refs_json"]),
                    json.dumps(r["source_refs_json"]),
                    json.dumps(r["properties_json"]),
                    r["status"], now, now,
                ),
            )
    conn.commit()

    return {"stored": len(normalized)}


@mcp.tool()
def store_staging_profiles(
    lesson_run_id: str,
    book_id: str,
    batch_anchor: str,
    profiles: list[dict[str, Any]],
    append: bool = False,
    dataset_id: str | None = None,
) -> dict[str, Any]:
    """Normalize and upsert profiles into staging_profiles."""
    conn = _get_connection()
    did = _resolve_dataset(conn, dataset_id)
    anchor = resolve_outline_anchor(book_id, batch_anchor, strict=True)
    now = utc_now()

    normalized = normalize_profiles(profiles)

    if not append:
        replace_table_rows(conn, "staging_profiles", did, lesson_run_id)

    with conn.cursor() as cur:
        for r in normalized:
            cur.execute(
                _SQL_UPSERT_PROFILE,
                (
                    did, lesson_run_id, r["raw_profile_id"],
                    r["raw_node_id"], r["subject"], r["school_stage"],
                    r["grade_band"], r["context_key"],
                    r["curriculum_role"], r["mastery_level"],
                    json.dumps(r["framework_refs_json"]),
                    json.dumps(r["textbook_refs_json"]),
                    json.dumps(r["textbook_ids_json"]),
                    json.dumps(r["learning_objectives_json"]),
                    json.dumps(r["assessment_signals_json"]),
                    json.dumps(r["source_refs_json"]),
                    json.dumps(r["properties_json"]),
                    r["status"], now, now,
                ),
            )
    conn.commit()

    return {"stored": len(normalized)}


@mcp.tool()
def store_staging_mentions(
    lesson_run_id: str,
    book_id: str,
    batch_anchor: str,
    mentions: list[dict[str, Any]],
    append: bool = False,
    dataset_id: str | None = None,
) -> dict[str, Any]:
    """Normalize and upsert mentions into staging_mentions."""
    conn = _get_connection()
    did = _resolve_dataset(conn, dataset_id)
    anchor = resolve_outline_anchor(book_id, batch_anchor, strict=True)
    now = utc_now()

    normalized = normalize_mentions(mentions, book_id, anchor)

    if not append:
        replace_table_rows(conn, "staging_mentions", did, lesson_run_id)

    with conn.cursor() as cur:
        for r in normalized:
            cur.execute(
                _SQL_UPSERT_MENTION,
                (
                    did, lesson_run_id, r["raw_mention_id"],
                    r["source_type"], r["source_id"], r["anchor_ref"],
                    r["target_type"], r["target_raw_id"], r["role"],
                    json.dumps(r["source_refs_json"]),
                    r["confidence"],
                    json.dumps(r["properties_json"]),
                    now, now,
                ),
            )
    conn.commit()

    return {"stored": len(normalized)}


@mcp.tool()
def store_staging_evidence(
    lesson_run_id: str,
    book_id: str,
    batch_anchor: str,
    evidence: list[dict[str, Any]],
    append: bool = False,
    dataset_id: str | None = None,
) -> dict[str, Any]:
    """Normalize and upsert evidence into staging_evidence."""
    conn = _get_connection()
    did = _resolve_dataset(conn, dataset_id)
    anchor = resolve_outline_anchor(book_id, batch_anchor, strict=True)
    now = utc_now()

    normalized = normalize_evidence(evidence, book_id, anchor)

    if not append:
        replace_table_rows(conn, "staging_evidence", did, lesson_run_id)

    with conn.cursor() as cur:
        for r in normalized:
            cur.execute(
                _SQL_UPSERT_EVIDENCE,
                (
                    did, lesson_run_id, r["raw_evidence_id"],
                    r["source_type"], r["source_id"], r["anchor_ref"],
                    r["source_path"], r["page_start"], r["page_end"],
                    r["excerpt"], r["locator"],
                    r["modality"], r["extraction_method"],
                    json.dumps(r["normalized_claims_json"]),
                    json.dumps(r["properties_json"]),
                    now, now,
                ),
            )
    conn.commit()

    return {"stored": len(normalized)}


@mcp.tool()
def store_staging_node_cards(
    lesson_run_id: str,
    book_id: str,
    batch_anchor: str,
    node_cards: list[dict[str, Any]],
    append: bool = False,
    dataset_id: str | None = None,
) -> dict[str, Any]:
    """Normalize and upsert node cards into staging_node_cards."""
    conn = _get_connection()
    did = _resolve_dataset(conn, dataset_id)
    anchor = resolve_outline_anchor(book_id, batch_anchor, strict=True)
    now = utc_now()

    normalized = normalize_node_cards(node_cards)

    if not append:
        replace_table_rows(conn, "staging_node_cards", did, lesson_run_id)

    with conn.cursor() as cur:
        for r in normalized:
            cur.execute(
                _SQL_UPSERT_NODE_CARD,
                (
                    did, lesson_run_id, r["raw_card_id"],
                    r["raw_node_id"], r["card_layer"],
                    r["title"], r["summary"],
                    json.dumps(r["pattern_refs_json"]),
                    json.dumps(r["framework_refs_json"]),
                    json.dumps(r["profile_refs_json"]),
                    json.dumps(r["mention_refs_json"]),
                    json.dumps(r["source_refs_json"]),
                    json.dumps(r["sections_json"]),
                    json.dumps(r["properties_json"]),
                    r["status"], now, now,
                ),
            )
    conn.commit()

    return {"stored": len(normalized)}


@mcp.tool()
def finalize_lesson_run(
    lesson_run_id: str,
    dataset_id: str | None = None,
) -> dict[str, Any]:
    """Count staging rows and update lesson_runs status to 'staged'.

    Call after all store_staging_* writes are complete.
    """
    conn = _get_connection()
    did = _resolve_dataset(conn, dataset_id)
    now = utc_now()

    counts: dict[str, int] = {}
    with conn.cursor() as cur:
        for table in _STAGING_TABLES:
            cur.execute(
                f"SELECT COUNT(*) AS cnt FROM {table} "
                f"WHERE dataset_id = %s AND lesson_run_id = %s",
                (did, lesson_run_id),
            )
            row = cur.fetchone()
            key = table.replace("staging_", "")
            counts[key] = row["cnt"] if row else 0

    with conn.cursor() as cur:
        cur.execute(
            _SQL_UPDATE_LESSON_RUN_FINALIZED,
            (json.dumps(counts), now, did, lesson_run_id),
        )
    conn.commit()

    return {"lesson_run_id": lesson_run_id, "counts": counts, "status": "staged"}


@mcp.tool()
def check_staging_integrity(
    lesson_run_id: str,
    dataset_id: str | None = None,
) -> dict[str, Any]:
    """Validate staging completeness for a lesson run.

    Checks: lesson_runs row exists, status=staged, and each backbone
    node has node + profile + evidence + mention + node_card entries.
    """
    conn = _get_connection()
    did = _resolve_dataset(conn, dataset_id)

    issues: list[str] = []
    checks: list[dict[str, Any]] = []

    # 1. lesson_runs row exists
    with conn.cursor() as cur:
        cur.execute(
            "SELECT status, counts_json FROM lesson_runs "
            "WHERE dataset_id = %s AND lesson_run_id = %s",
            (did, lesson_run_id),
        )
        run_row = cur.fetchone()
    checks.append({"check": "lesson_run_exists", "pass": run_row is not None})
    if not run_row:
        issues.append("lesson_runs row not found")
        return {"valid": False, "checks": checks, "issues": issues}

    # 2. status = staged
    is_staged = run_row["status"] == "staged"
    checks.append({"check": "status_is_staged", "pass": is_staged})
    if not is_staged:
        issues.append(f"lesson_run status is '{run_row['status']}', expected 'staged'")

    # 3. Row counts per table
    raw_counts = run_row["counts_json"]
    counts = json.loads(raw_counts) if isinstance(raw_counts, str) else (raw_counts or {})
    for table in _STAGING_TABLES:
        with conn.cursor() as cur:
            cur.execute(
                f"SELECT COUNT(*) AS cnt FROM {table} "
                f"WHERE dataset_id = %s AND lesson_run_id = %s",
                (did, lesson_run_id),
            )
            actual = cur.fetchone()["cnt"]
        key = table.replace("staging_", "")
        has_rows = actual > 0
        checks.append({"check": f"{key}_has_rows", "pass": has_rows, "count": actual})
        if not has_rows:
            issues.append(f"{table} has 0 rows")

    # 4. Backbone nodes have all five categories
    with conn.cursor() as cur:
        cur.execute(
            "SELECT raw_node_id FROM staging_nodes "
            "WHERE dataset_id = %s AND lesson_run_id = %s AND node_layer = 'backbone'",
            (did, lesson_run_id),
        )
        backbone_ids = [row["raw_node_id"] for row in cur.fetchall()]

    for nid in backbone_ids:
        missing: list[str] = []
        with conn.cursor() as cur:
            cur.execute(
                "SELECT COUNT(*) AS cnt FROM staging_profiles "
                "WHERE dataset_id = %s AND lesson_run_id = %s AND raw_node_id = %s",
                (did, lesson_run_id, nid),
            )
            if cur.fetchone()["cnt"] == 0:
                missing.append("profile")

            cur.execute(
                "SELECT COUNT(*) AS cnt FROM staging_evidence se "
                "JOIN staging_mentions sm ON se.dataset_id = sm.dataset_id "
                "  AND se.lesson_run_id = sm.lesson_run_id "
                "  AND se.anchor_ref = sm.anchor_ref "
                "WHERE se.dataset_id = %s AND se.lesson_run_id = %s "
                "  AND sm.target_raw_id = %s",
                (did, lesson_run_id, nid),
            )
            if cur.fetchone()["cnt"] == 0:
                missing.append("evidence")

            cur.execute(
                "SELECT COUNT(*) AS cnt FROM staging_mentions "
                "WHERE dataset_id = %s AND lesson_run_id = %s "
                "  AND target_raw_id = %s AND target_type = 'node'",
                (did, lesson_run_id, nid),
            )
            if cur.fetchone()["cnt"] == 0:
                missing.append("mention")

            cur.execute(
                "SELECT COUNT(*) AS cnt FROM staging_node_cards "
                "WHERE dataset_id = %s AND lesson_run_id = %s AND raw_node_id = %s",
                (did, lesson_run_id, nid),
            )
            if cur.fetchone()["cnt"] == 0:
                missing.append("node_card")

        if missing:
            issues.append(f"backbone node '{nid}' missing: {', '.join(missing)}")

    checks.append({
        "check": "backbone_completeness",
        "pass": len(issues) == 0 or not any("backbone node" in i for i in issues),
        "backbone_count": len(backbone_ids),
    })

    return {"valid": len(issues) == 0, "checks": checks, "issues": issues}


@mcp.tool()
def query_staging_counts(
    lesson_run_id: str,
    dataset_id: str | None = None,
) -> dict[str, Any]:
    """Return row counts for each staging table of a lesson run."""
    conn = _get_connection()
    did = _resolve_dataset(conn, dataset_id)

    counts: dict[str, int] = {}
    with conn.cursor() as cur:
        for table in _STAGING_TABLES:
            cur.execute(
                f"SELECT COUNT(*) AS cnt FROM {table} "
                f"WHERE dataset_id = %s AND lesson_run_id = %s",
                (did, lesson_run_id),
            )
            key = table.replace("staging_", "")
            counts[key] = cur.fetchone()["cnt"]

    return {"lesson_run_id": lesson_run_id, "counts": counts}


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    mcp.run(transport="stdio")
