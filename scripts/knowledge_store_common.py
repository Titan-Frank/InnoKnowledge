#!/usr/bin/env python3
"""Shared helpers for the PostgreSQL knowledge store scripts."""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import psycopg
import psycopg2.extras
from psycopg.rows import dict_row
from psycopg import sql as pg_sql
from psycopg.types import TypeInfo

# psycopg2 backwards compat - use psycopg2.extras for execute_values
psycopg.extras = psycopg2.extras


REPO_ROOT = Path(__file__).resolve().parent.parent
PG_SCHEMA_PATH = REPO_ROOT / "schemas" / "pg" / "knowledge_store.sql"
OUTLINES_DIR = REPO_ROOT / "data" / "outlines"
RUNTIME_RECORD_TYPES = (
    "query",
    "node",
    "profile",
    "mention",
    "evidence",
    "node_card",
    "relation_proposal",
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
VALID_EDGE_TYPES = {
    "is_a",
    "instance_of",
    "part_of",
    "contains",
    "prerequisite_for",
    "depends_on",
    "extends",
    "explains",
    "causes",
    "affects",
    "has_property",
    "uses",
    "measures",
    "produces",
    "consumes",
    "applies_to",
    "represented_by",
    "symbolizes",
    "analogous_to",
    "same_as",
    "related_to",
}
ANCHOR_ID_PATTERN = re.compile(
    r"^struct:(?P<book_id>[^:]+):(?P<kind>[^:]+):(?P<local>.+)$"
)
TEXTBOOK_SOURCE_PREFIX = "textbook:"

# pgvector dimension — matches BGE-large-zh-v1.5
VECTOR_DIM = 1024


# ---------------------------------------------------------------------------
# JSON helpers (kept for JSONL export / legacy compat)
# ---------------------------------------------------------------------------

def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def dump_json_text(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def normalize_term(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


def load_json_text(value: str | None, default: Any) -> Any:
    """Parse JSON text — kept for reading non-JSONB sources (e.g. JSONL files)."""
    if value is None or value == "":
        return default
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return default


# ---------------------------------------------------------------------------
# Domain helpers (unchanged from SQLite version)
# ---------------------------------------------------------------------------

def infer_learning_modes(
    node_kind: str | None, node_layer: str | None = None
) -> list[str]:
    if node_kind in {"activity", "method", "skill"}:
        return ["procedural"]
    if node_kind == "representation":
        return ["conceptual"]
    if node_kind == "issue":
        return ["conceptual"]
    if node_kind == "entity":
        return ["conceptual"] if node_layer == "backbone" else ["factual"]
    return ["conceptual"]


def normalize_learning_modes(
    learning_modes: Iterable[str] | None,
    node_kind: str | None,
    node_layer: str | None = None,
) -> list[str]:
    cleaned = unique_stable(
        mode
        for mode in (learning_modes or [])
        if mode in {"factual", "conceptual", "procedural", "metacognitive"}
    )
    if cleaned:
        return cleaned
    return infer_learning_modes(node_kind, node_layer)


def require_valid_edge_type(edge_type: str) -> str:
    if edge_type not in VALID_EDGE_TYPES:
        allowed = ", ".join(sorted(VALID_EDGE_TYPES))
        raise SystemExit(
            f"Invalid edge_type '{edge_type}'. Use a schema-valid relation type only: {allowed}"
        )
    return edge_type


# ---------------------------------------------------------------------------
# ID generation helpers
# ---------------------------------------------------------------------------

def make_stable_suffix(*parts: str, length: int = 16) -> str:
    digest = hashlib.sha1("||".join(parts).encode("utf-8")).hexdigest()
    return digest[:length]


def make_query_id(batch_anchor: str, query_text: str) -> str:
    suffix = make_stable_suffix(batch_anchor, query_text, length=12)
    return f"query:{suffix}"


def make_proposal_id(
    batch_anchor: str,
    source_id: str,
    anchor_ref: str,
    from_node_id: str,
    edge_type: str,
    to_node_id: str,
) -> str:
    suffix = make_stable_suffix(
        batch_anchor,
        source_id,
        anchor_ref,
        from_node_id,
        edge_type,
        to_node_id,
        length=12,
    )
    return f"proposal:{suffix}"


def make_review_id(owner_type: str, owner_id: str, review_type: str) -> str:
    suffix = make_stable_suffix(owner_type, owner_id, review_type, length=12)
    return f"review:{suffix}"


def make_edge_id(from_node_id: str, edge_type: str, to_node_id: str) -> str:
    suffix = make_stable_suffix(from_node_id, edge_type, to_node_id, length=12)
    return f"edge:auto-{suffix}"


def make_lesson_run_id(book_id: str, batch_anchor: str) -> str:
    suffix = make_stable_suffix(book_id, batch_anchor, length=12)
    return f"lesson-run:{suffix}"


def make_merge_run_id(dataset_id: str, lesson_run_ids: Iterable[str]) -> str:
    suffix = make_stable_suffix(dataset_id, *sorted(lesson_run_ids), length=12)
    return f"merge:{suffix}"


def make_canonical_node_id(
    node_kind: str, canonical_name: str, node_subkind: str | None = None
) -> str:
    prefix = node_kind
    if node_subkind:
        prefix = f"{prefix}/{node_subkind}"
    suffix = make_stable_suffix(prefix, normalize_term(canonical_name), length=12)
    return f"{prefix}:auto-{suffix}"


def make_profile_id(node_id: str, context_key: str) -> str:
    suffix = make_stable_suffix(node_id, context_key, length=12)
    return f"profile:auto-{suffix}"


def make_evidence_id(
    lesson_run_id: str, raw_evidence_id: str, anchor_ref: str, excerpt: str
) -> str:
    suffix = make_stable_suffix(
        lesson_run_id, raw_evidence_id, anchor_ref, excerpt, length=12
    )
    return f"evidence:auto-{suffix}"


def make_mention_id(
    lesson_run_id: str, raw_mention_id: str, target_type: str, target_id: str
) -> str:
    suffix = make_stable_suffix(
        lesson_run_id, raw_mention_id, target_type, target_id, length=12
    )
    return f"mention:auto-{suffix}"


# ---------------------------------------------------------------------------
# String / collection helpers
# ---------------------------------------------------------------------------

def safe_path_token(value: str) -> str:
    token = re.sub(r"[^a-zA-Z0-9._-]+", "__", value.strip())
    token = token.strip("._")
    return token or "item"


def unique_stable(values: Iterable[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def merge_unique_strings(*groups: Iterable[str] | None) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for group in groups:
        for value in group or []:
            if not isinstance(value, str):
                continue
            token = value.strip()
            if not token or token in seen:
                continue
            seen.add(token)
            result.append(token)
    return result


def merge_text_blocks(*values: str | None) -> str:
    parts = merge_unique_strings(
        [value.strip() for value in values if isinstance(value, str) and value.strip()]
    )
    if not parts:
        return ""
    return "\n\n".join(parts)


def merge_json_objects(base: dict[str, Any], update: dict[str, Any]) -> dict[str, Any]:
    merged = dict(base)
    for key, value in update.items():
        if key not in merged or merged[key] in (None, "", [], {}):
            merged[key] = value
            continue
        current = merged[key]
        if current == value:
            continue
        if isinstance(current, dict) and isinstance(value, dict):
            merged[key] = merge_json_objects(current, value)
            continue
        if isinstance(current, list) and isinstance(value, list):
            merged[key] = merge_unique_strings(current, value)
            continue
        if isinstance(current, str) and isinstance(value, str):
            merged[key] = merge_text_blocks(current, value)
            continue
        merged[key] = current
    return merged


def cosine_similarity(left: Iterable[float], right: Iterable[float]) -> float:
    left_values = [float(value) for value in left]
    right_values = [float(value) for value in right]
    if not left_values or len(left_values) != len(right_values):
        return 0.0
    numerator = sum(a * b for a, b in zip(left_values, right_values))
    left_norm = math.sqrt(sum(a * a for a in left_values))
    right_norm = math.sqrt(sum(b * b for b in right_values))
    if left_norm == 0 or right_norm == 0:
        return 0.0
    return numerator / (left_norm * right_norm)


# ---------------------------------------------------------------------------
# node_terms rebuild
# ---------------------------------------------------------------------------

def rebuild_node_terms(connection: psycopg.Connection, dataset_id: str) -> int:
    with connection.cursor() as cur:
        cur.execute("DELETE FROM node_terms WHERE dataset_id = %s", (dataset_id,))
        cur.execute(
            """
            SELECT id, canonical_name, aliases_json
            FROM nodes
            WHERE dataset_id = %s AND status != 'deprecated'
            """,
            (dataset_id,),
        )
        rows = cur.fetchall()

    inserts: list[tuple[str, str, str, str, str]] = []
    for row in rows:
        node_id = row["id"]
        canonical_name = row["canonical_name"] or ""
        # aliases_json is JSONB → already a Python list
        aliases = row["aliases_json"] if isinstance(row["aliases_json"], list) else []
        for term, term_type in [(canonical_name, "canonical"), *[(alias, "alias") for alias in aliases]]:
            if not isinstance(term, str):
                continue
            normalized = normalize_term(term)
            if not normalized:
                continue
            inserts.append((dataset_id, node_id, term, normalized, term_type))
    if inserts:
        with connection.cursor() as cur:
            psycopg.extras.execute_values(
                cur,
                """
                INSERT INTO node_terms (
                  dataset_id, node_id, term, term_norm, term_type
                ) VALUES %s
                ON CONFLICT (dataset_id, node_id, term_norm, term_type)
                DO UPDATE SET term = EXCLUDED.term
                """,
                inserts,
            )
    return len(inserts)


# ---------------------------------------------------------------------------
# Outline helpers
# ---------------------------------------------------------------------------

def outline_path_for_book(book_id: str) -> Path:
    return OUTLINES_DIR / f"{book_id}.outline.json"


def iter_outline_items(items: Iterable[dict[str, Any]]) -> Iterable[dict[str, Any]]:
    queue = list(items)
    while queue:
        item = queue.pop(0)
        if not isinstance(item, dict):
            continue
        yield item
        children = item.get("children")
        if isinstance(children, list):
            queue.extend(child for child in children if isinstance(child, dict))


def load_outline_items(book_id: str) -> list[dict[str, Any]]:
    outline_path = outline_path_for_book(book_id)
    if not outline_path.exists():
        return []
    outline = load_json(outline_path)
    if isinstance(outline, dict):
        items = outline.get("structure", outline.get("items", []))
    else:
        items = []
    return list(iter_outline_items(items))


def anchor_token_variants(anchor_id: str, book_id: str | None = None) -> list[str]:
    variants = [anchor_id]
    match = ANCHOR_ID_PATTERN.match(anchor_id)
    if match and (book_id is None or match.group("book_id") == book_id):
        kind = match.group("kind")
        local = match.group("local")
        scoped = f"{kind}:{local}"
        variants.extend([scoped, scoped.replace(":", "-", 1), local])
    return unique_stable(variants)


def resolve_outline_anchor(book_id: str, anchor: str, *, strict: bool = False) -> str:
    items = load_outline_items(book_id)
    if not items:
        if strict:
            raise SystemExit(
                f"Outline not found for book '{book_id}': {outline_path_for_book(book_id)}"
            )
        return anchor

    by_id = {item["id"]: item for item in items if item.get("id")}
    if anchor in by_id:
        return anchor

    matches = unique_stable(
        item_id
        for item_id in by_id
        if anchor in anchor_token_variants(item_id, book_id)
    )
    if len(matches) == 1:
        return matches[0]
    if matches and strict:
        preview = ", ".join(matches[:5])
        raise SystemExit(
            f"Anchor '{anchor}' is ambiguous for book '{book_id}'. Matches: {preview}"
        )
    if strict:
        sample = ", ".join(sorted(by_id)[:5])
        raise SystemExit(
            f"Anchor '{anchor}' was not found in outline for book '{book_id}'. "
            f"Use a canonical outline id such as: {sample}"
        )
    return anchor


def resolve_outline_anchors(
    book_id: str, anchors: Iterable[str], *, strict: bool = False
) -> list[str]:
    return [
        resolve_outline_anchor(book_id, anchor, strict=strict) for anchor in anchors
    ]


def book_id_from_anchor(anchor_ref: str | None) -> str | None:
    if not anchor_ref:
        return None
    match = ANCHOR_ID_PATTERN.match(anchor_ref)
    return match.group("book_id") if match else None


def strip_textbook_source_prefix(source_id: str | None) -> str | None:
    if not source_id:
        return source_id
    if source_id.startswith(TEXTBOOK_SOURCE_PREFIX):
        return source_id[len(TEXTBOOK_SOURCE_PREFIX) :]
    return source_id


def normalize_textbook_source_id(
    source_type: str | None,
    source_id: str | None,
    anchor_ref: str | None = None,
    *,
    expected_book_id: str | None = None,
) -> str | None:
    if source_type != "textbook":
        return source_id
    return (
        expected_book_id
        or book_id_from_anchor(anchor_ref)
        or strip_textbook_source_prefix(source_id)
        or source_id
    )


def canonicalize_source_anchor(
    source_type: str | None,
    source_id: str | None,
    anchor_ref: str | None,
    *,
    expected_book_id: str | None = None,
) -> str | None:
    if not anchor_ref or source_type != "textbook":
        return anchor_ref
    normalized_source_id = normalize_textbook_source_id(
        source_type,
        source_id,
        anchor_ref,
        expected_book_id=expected_book_id,
    )
    if not normalized_source_id:
        return anchor_ref
    return resolve_outline_anchor(normalized_source_id, anchor_ref, strict=False)


def equivalent_anchor_tokens(book_id: str, anchor: str) -> list[str]:
    resolved = resolve_outline_anchor(book_id, anchor, strict=False)
    variants = [anchor]
    if resolved != anchor:
        variants.append(resolved)
    variants.extend(anchor_token_variants(anchor, book_id))
    if resolved != anchor:
        variants.extend(anchor_token_variants(resolved, book_id))
    return unique_stable(variants)


# ---------------------------------------------------------------------------
# Runtime path helpers
# ---------------------------------------------------------------------------

def runtime_batch_dir(output_root: Path | str, book_id: str) -> Path:
    root = Path(output_root).expanduser().resolve()
    return root / "runs" / "runtime" / safe_path_token(book_id)


def runtime_queries_path(
    output_root: Path | str, book_id: str, batch_anchor: str
) -> Path:
    return (
        runtime_batch_dir(output_root, book_id)
        / f"{safe_path_token(batch_anchor)}.queries.jsonl"
    )


def runtime_relation_proposals_path(
    output_root: Path | str, book_id: str, batch_anchor: str
) -> Path:
    return runtime_batch_dir(output_root, book_id) / (
        f"{safe_path_token(batch_anchor)}.relation-proposals.jsonl"
    )


def runtime_nodes_path(
    output_root: Path | str, book_id: str, batch_anchor: str
) -> Path:
    return (
        runtime_batch_dir(output_root, book_id)
        / f"{safe_path_token(batch_anchor)}.nodes.jsonl"
    )


def runtime_profiles_path(
    output_root: Path | str, book_id: str, batch_anchor: str
) -> Path:
    return (
        runtime_batch_dir(output_root, book_id)
        / f"{safe_path_token(batch_anchor)}.profiles.jsonl"
    )


def runtime_mentions_path(
    output_root: Path | str, book_id: str, batch_anchor: str
) -> Path:
    return (
        runtime_batch_dir(output_root, book_id)
        / f"{safe_path_token(batch_anchor)}.mentions.jsonl"
    )


def runtime_evidence_path(
    output_root: Path | str, book_id: str, batch_anchor: str
) -> Path:
    return (
        runtime_batch_dir(output_root, book_id)
        / f"{safe_path_token(batch_anchor)}.evidence.jsonl"
    )


def runtime_node_cards_path(
    output_root: Path | str, book_id: str, batch_anchor: str
) -> Path:
    return (
        runtime_batch_dir(output_root, book_id)
        / f"{safe_path_token(batch_anchor)}.node-cards.jsonl"
    )


def resolve_runtime_artifact_path(
    output_root: Path | str,
    book_id: str,
    batch_anchor: str,
    builder,
) -> Path:
    candidates = [
        builder(output_root, book_id, token)
        for token in equivalent_anchor_tokens(book_id, batch_anchor)
    ]
    for path in candidates:
        if path.exists():
            return path
    return candidates[0]


def runtime_record_id(record_type: str, payload: dict[str, Any]) -> str:
    if record_type == "query":
        query_id = payload.get("query_id")
        if query_id:
            return str(query_id)
        query_text = payload.get("query_text")
        batch_anchor = payload.get("batch_anchor", "")
        if not query_text:
            raise ValueError("Runtime query payload requires query_text.")
        return make_query_id(str(batch_anchor), str(query_text))
    if record_type in {"node", "profile", "mention", "evidence"}:
        record_id = payload.get("id")
        if not record_id:
            raise ValueError(f"Runtime {record_type} payload requires id.")
        return str(record_id)
    if record_type == "node_card":
        record_id = payload.get("node_id") or payload.get("id")
        if not record_id:
            raise ValueError("Runtime node_card payload requires node_id or id.")
        return str(record_id)
    if record_type == "relation_proposal":
        proposal_id = payload.get("proposal_id")
        if proposal_id:
            return str(proposal_id)
        return make_proposal_id(
            str(payload["batch_anchor"]),
            str(payload["source_id"]),
            str(payload["anchor_ref"]),
            str(payload["from_node_id"]),
            str(payload["edge_type"]),
            str(payload["to_node_id"]),
        )
    raise ValueError(f"Unsupported runtime record type: {record_type}")


# ---------------------------------------------------------------------------
# Batch runtime records
# ---------------------------------------------------------------------------

def store_batch_runtime_records(
    connection: psycopg.Connection,
    dataset_id: str,
    book_id: str,
    batch_anchor: str,
    record_type: str,
    records: list[dict[str, Any]],
    *,
    replace: bool = True,
) -> int:
    if record_type not in RUNTIME_RECORD_TYPES:
        raise ValueError(f"Unsupported runtime record type: {record_type}")
    with connection.cursor() as cur:
        if replace:
            cur.execute(
                """
                DELETE FROM batch_runtime_records
                WHERE dataset_id = %s AND book_id = %s AND batch_anchor = %s AND record_type = %s
                """,
                (dataset_id, book_id, batch_anchor, record_type),
            )
        now = utc_now()
        rows = []
        for payload in records:
            record_id = runtime_record_id(record_type, payload)
            rows.append(
                (
                    dataset_id,
                    book_id,
                    batch_anchor,
                    record_type,
                    record_id,
                    json.dumps(payload, ensure_ascii=False),  # JSONB accepts JSON text
                    now,
                    now,
                )
            )
        if rows:
            psycopg.extras.execute_values(
                cur,
                """
                INSERT INTO batch_runtime_records (
                  dataset_id, book_id, batch_anchor, record_type,
                  record_id, payload_json, created_at, updated_at
                ) VALUES %s
                ON CONFLICT (dataset_id, batch_anchor, record_type, record_id)
                DO UPDATE SET
                  payload_json = EXCLUDED.payload_json,
                  updated_at = EXCLUDED.updated_at
                """,
                rows,
            )
    return len(rows)


def load_batch_runtime_records(
    connection: psycopg.Connection,
    dataset_id: str,
    book_id: str,
    batch_anchor: str,
    record_type: str,
) -> list[dict[str, Any]]:
    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT payload_json
            FROM batch_runtime_records
            WHERE dataset_id = %s AND book_id = %s AND batch_anchor = %s AND record_type = %s
            ORDER BY record_id
            """,
            (dataset_id, book_id, batch_anchor, record_type),
        )
        rows = cur.fetchall()
    # JSONB columns are returned as native Python dicts by psycopg3
    return [row["payload_json"] if isinstance(row["payload_json"], dict) else row["payload_json"] for row in rows]


# ---------------------------------------------------------------------------
# PostgreSQL connection & schema
# ---------------------------------------------------------------------------

def connect_db(database_url: str | None = None) -> psycopg.Connection:
    """Connect to PostgreSQL using DATABASE_URL env var or explicit URL.

    The --db CLI flag or DATABASE_URL environment variable should contain
    a PostgreSQL connection string like:
        postgresql://user:pass@host:port/dbname
    """
    url = database_url or os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit(
            "No database URL provided. Set DATABASE_URL or pass --db with a "
            "PostgreSQL connection string (e.g. postgresql://okm:okm@localhost:5432/knowledge)"
        )
    conn = psycopg.connect(url, row_factory=dict_row, autocommit=False)
    return conn


def ensure_pg_schema(connection: psycopg.Connection) -> None:
    """Apply the PG schema DDL file if tables do not exist yet."""
    with connection.cursor() as cur:
        cur.execute(
            "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'datasets')"
        )
        exists = cur.fetchone()["exists"]
    if exists:
        return
    schema_sql = PG_SCHEMA_PATH.read_text(encoding="utf-8")
    # Execute the schema file — psycopg3 can run multi-statement SQL
    with connection.cursor() as cur:
        cur.execute(schema_sql)
    connection.commit()


def ensure_community_id_column(connection: psycopg.Connection) -> None:
    """Add community_id, pca_x, pca_y columns to nodes table if they don't exist (idempotent migration)."""
    with connection.cursor() as cur:
        cur.execute("""
            ALTER TABLE nodes
            ADD COLUMN IF NOT EXISTS community_id INTEGER DEFAULT NULL
        """)
        cur.execute("""
            ALTER TABLE nodes
            ADD COLUMN IF NOT EXISTS pca_x REAL DEFAULT NULL
        """)
        cur.execute("""
            ALTER TABLE nodes
            ADD COLUMN IF NOT EXISTS pca_y REAL DEFAULT NULL
        """)
    connection.commit()


def resolve_dataset_id(
    connection: psycopg.Connection,
    dataset_id: str | None = None,
    output_root: Path | str | None = None,
) -> str:
    if dataset_id:
        return dataset_id
    if output_root is not None:
        return dataset_id_from_output_root(output_root)

    with connection.cursor() as cur:
        cur.execute(
            "SELECT dataset_id FROM datasets WHERE is_active = 1 LIMIT 1"
        )
        row = cur.fetchone()
    if row is None:
        raise SystemExit(
            "No dataset id provided and no active dataset found in PostgreSQL."
        )
    return row["dataset_id"]


def require_dataset_row(connection: psycopg.Connection, dataset_id: str) -> dict:
    with connection.cursor() as cur:
        cur.execute(
            "SELECT * FROM datasets WHERE dataset_id = %s",
            (dataset_id,),
        )
        row = cur.fetchone()
    if row is None:
        raise SystemExit(f"Dataset '{dataset_id}' not found in PostgreSQL.")
    return row


def ensure_dataset(
    connection: psycopg.Connection, dataset_id: str, root: Path | str
) -> None:
    with connection.cursor() as cur:
        cur.execute(
            "SELECT dataset_id FROM datasets WHERE dataset_id = %s",
            (dataset_id,),
        )
        if cur.fetchone() is not None:
            return

        now = utc_now()
        root_path = str(Path(root).expanduser().resolve())
        cur.execute(
            """
            INSERT INTO datasets (
              dataset_id, version_key, root_path, schema_version,
              status, is_active, created_at, notes
            ) VALUES (%s, %s, %s, 'v2', 'draft', 0, %s, %s)
            """,
            (dataset_id, version_key_from_output_root(root), root_path, now, None),
        )
    connection.commit()


def fetch_existing_edges(
    connection: psycopg.Connection, dataset_id: str
) -> list[dict]:
    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT id, edge_type, from_id, to_id, directionality, confidence, status
            FROM edges
            WHERE dataset_id = %s
              AND status != 'deprecated'
            """,
            (dataset_id,),
        )
        return cur.fetchall()


def detect_edge_conflict(
    proposal: dict[str, Any], existing_edges: Iterable[dict]
) -> tuple[str | None, str | None]:
    from_id = proposal["from_node_id"]
    to_id = proposal["to_node_id"]
    edge_type = proposal["edge_type"]

    for edge in existing_edges:
        if (
            edge["from_id"] == from_id
            and edge["to_id"] == to_id
            and edge["edge_type"] == edge_type
        ):
            return "duplicate_existing_edge", edge["id"]

        if (
            edge["from_id"] == from_id
            and edge["to_id"] == to_id
            and edge["edge_type"] != edge_type
        ):
            return "same_endpoints_different_edge_type", edge["id"]

        if edge_type in HIERARCHICAL_EDGE_TYPES:
            if (
                edge["edge_type"] == edge_type
                and edge["from_id"] == to_id
                and edge["to_id"] == from_id
            ):
                return "reverse_hierarchical_conflict", edge["id"]

    return None, None


# ---------------------------------------------------------------------------
# Snapshot dataclasses (unchanged structure)
# ---------------------------------------------------------------------------

@dataclass
class SnapshotPaths:
    output_root: Path
    graph_dir: Path
    nodes_path: Path
    edges_path: Path
    profiles_path: Path | None
    node_cards_dir: Path | None
    mention_paths: tuple[Path, ...]
    evidence_paths: tuple[Path, ...]
    node_card_paths: tuple[Path, ...]


@dataclass
class SnapshotData:
    nodes: list[dict[str, Any]]
    edges: list[dict[str, Any]]
    profiles: list[dict[str, Any]]
    mentions: list[dict[str, Any]]
    evidence: list[dict[str, Any]]
    node_cards: list[dict[str, Any]]


def build_snapshot_paths(output_root: Path | str) -> SnapshotPaths:
    root = Path(output_root).expanduser().resolve()
    graph_dir = root / "graph"
    nodes_path = graph_dir / "knowledge.nodes.jsonl"
    edges_path = graph_dir / "knowledge.edges.jsonl"
    profiles_path = root / "profiles" / "knowledge.profiles.jsonl"
    node_cards_dir = root / "node_cards"

    if not graph_dir.exists():
        raise FileNotFoundError(f"Missing graph directory: {graph_dir}")
    if not nodes_path.exists():
        raise FileNotFoundError(f"Missing nodes file: {nodes_path}")
    if not edges_path.exists():
        raise FileNotFoundError(f"Missing edges file: {edges_path}")

    mention_paths = tuple(sorted(graph_dir.glob("*.mentions.jsonl")))
    evidence_paths = tuple(sorted(graph_dir.glob("*.evidence.jsonl")))
    card_paths = (
        tuple(sorted(path for path in node_cards_dir.glob("*.json") if path.is_file()))
        if node_cards_dir.exists()
        else ()
    )

    return SnapshotPaths(
        output_root=root,
        graph_dir=graph_dir,
        nodes_path=nodes_path,
        edges_path=edges_path,
        profiles_path=profiles_path if profiles_path.exists() else None,
        node_cards_dir=node_cards_dir if node_cards_dir.exists() else None,
        mention_paths=mention_paths,
        evidence_paths=evidence_paths,
        node_card_paths=card_paths,
    )


def dataset_id_from_output_root(output_root: Path | str) -> str:
    return Path(output_root).expanduser().resolve().name


def version_key_from_output_root(output_root: Path | str) -> str:
    return Path(output_root).expanduser().resolve().name


def iter_node_terms(nodes: Iterable[dict[str, Any]]) -> Iterable[tuple[str, str, str]]:
    for node in nodes:
        yield node["id"], node["canonical_name"], "canonical"
        for alias in node.get("aliases", []):
            yield node["id"], alias, "alias"


def iter_profile_textbook_links(
    profiles: Iterable[dict[str, Any]],
) -> Iterable[tuple[str, str]]:
    for profile in profiles:
        for textbook_id in profile.get("textbook_ids", []):
            yield profile["id"], textbook_id


def card_owner_id(card: dict[str, Any]) -> str:
    return card.get("id") or card["node_id"]


def iter_evidence_links(
    snapshot: SnapshotData,
) -> Iterable[tuple[str, str, str, int | None]]:
    for edge in snapshot.edges:
        for ordinal, evidence_id in enumerate(edge.get("source_refs", []), start=1):
            yield "edge", edge["id"], evidence_id, ordinal

    for profile in snapshot.profiles:
        for ordinal, evidence_id in enumerate(profile.get("source_refs", []), start=1):
            yield "profile", profile["id"], evidence_id, ordinal

    for mention in snapshot.mentions:
        for ordinal, evidence_id in enumerate(mention.get("source_refs", []), start=1):
            yield "mention", mention["id"], evidence_id, ordinal

    for card in snapshot.node_cards:
        owner_id = card_owner_id(card)
        for ordinal, evidence_id in enumerate(card.get("source_refs", []), start=1):
            yield "card", owner_id, evidence_id, ordinal

        for section in card.get("sections", []):
            section_owner = f"{owner_id}#{section['id']}"
            for ordinal, evidence_id in enumerate(
                section.get("source_refs", []), start=1
            ):
                yield "card_section", section_owner, evidence_id, ordinal


def collect_source_artifacts(snapshot: SnapshotData) -> list[dict[str, Any]]:
    artifacts: dict[tuple[str, str], dict[str, Any]] = {}

    for record in snapshot.evidence + snapshot.mentions:
        key = (record["source_type"], record["source_id"])
        artifact = artifacts.setdefault(
            key,
            {
                "source_id": record["source_id"],
                "source_type": record["source_type"],
                "book_id": record["source_id"]
                if record["source_type"] == "textbook"
                else None,
                "title": None,
                "file_path": None,
                "outline_path": None,
                "properties_json": {},
            },
        )

        source_path = record.get("source_path")
        if source_path and not artifact["file_path"]:
            artifact["file_path"] = source_path

    for artifact in artifacts.values():
        outline_path = OUTLINES_DIR / f"{artifact['source_id']}.outline.json"
        if outline_path.exists():
            artifact["outline_path"] = str(outline_path)

    return sorted(
        artifacts.values(), key=lambda item: (item["source_type"], item["source_id"])
    )


# ============================================================================
# PostgreSQL Data Access Functions
# ============================================================================


def _strip_json_suffix(row: dict, keys: list[str]) -> dict:
    """For JSONB columns named `key_json`, expose as `key` (without _json suffix).

    psycopg3 returns JSONB columns as native Python objects already,
    so no json.loads() needed.  This function renames `key_json` → `key`
    for backward-compatible API output.
    """
    result = dict(row)
    for key in keys:
        json_key = f"{key}_json"
        if json_key in result:
            result[key] = result[json_key]
            del result[json_key]
    return result


def load_nodes(
    connection: psycopg.Connection,
    dataset_id: str,
    output_path: Path | None = None,
) -> list[dict[str, Any]]:
    """Load nodes from PostgreSQL, optionally export to JSONL."""
    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT * FROM nodes
            WHERE dataset_id = %s
            ORDER BY id
            """,
            (dataset_id,),
        )
        rows = cur.fetchall()

    nodes = []
    for row in rows:
        node = _strip_json_suffix(
            row,
            ["aliases", "learning_modes", "bridge_tags", "framework_refs",
             "profile_refs", "same_as_refs", "properties"],
        )
        # Strip large fields not needed by viewers/exports
        node.pop("embedding", None)
        nodes.append(node)

    if output_path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            for node in nodes:
                f.write(json.dumps(node, ensure_ascii=False) + "\n")

    return nodes


def load_edges(
    connection: psycopg.Connection,
    dataset_id: str,
    output_path: Path | None = None,
) -> list[dict[str, Any]]:
    """Load edges from PostgreSQL, optionally export to JSONL."""
    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT * FROM edges
            WHERE dataset_id = %s
            ORDER BY id
            """,
            (dataset_id,),
        )
        rows = cur.fetchall()

    edges = []
    for row in rows:
        edge = _strip_json_suffix(
            row,
            ["framework_refs", "profile_refs", "source_refs", "properties"],
        )
        # Map database column names to API field names
        if "from_id" in edge:
            edge["from"] = edge["from_id"]
        if "to_id" in edge:
            edge["to"] = edge["to_id"]
        edges.append(edge)

    if output_path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            for edge in edges:
                f.write(json.dumps(edge, ensure_ascii=False) + "\n")

    return edges


def load_profiles(
    connection: psycopg.Connection,
    dataset_id: str,
    output_path: Path | None = None,
) -> list[dict[str, Any]]:
    """Load curriculum profiles from PostgreSQL, optionally export to JSONL."""
    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT * FROM profiles
            WHERE dataset_id = %s
            ORDER BY id
            """,
            (dataset_id,),
        )
        rows = cur.fetchall()

    profiles = []
    for row in rows:
        profile = _strip_json_suffix(
            row,
            ["framework_refs", "textbook_refs", "textbook_ids",
             "learning_objectives", "assessment_signals", "source_refs", "properties"],
        )
        profiles.append(profile)

    if output_path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            for profile in profiles:
                f.write(json.dumps(profile, ensure_ascii=False) + "\n")

    return profiles


def load_mentions(
    connection: psycopg.Connection,
    dataset_id: str,
    book_id: str | None = None,
    output_path: Path | None = None,
) -> list[dict[str, Any]]:
    """Load mentions from PostgreSQL, optionally export to JSONL."""
    sql = """
        SELECT * FROM mentions
        WHERE dataset_id = %s
    """
    params: list[Any] = [dataset_id]

    if book_id:
        sql += " AND source_id = %s"
        params.append(book_id)

    sql += " ORDER BY id"

    with connection.cursor() as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()

    mentions = []
    for row in rows:
        mention = _strip_json_suffix(row, ["source_refs", "properties"])
        mentions.append(mention)

    if output_path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            for mention in mentions:
                f.write(json.dumps(mention, ensure_ascii=False) + "\n")

    return mentions


def load_evidence(
    connection: psycopg.Connection,
    dataset_id: str,
    book_id: str | None = None,
    output_path: Path | None = None,
) -> list[dict[str, Any]]:
    """Load evidence from PostgreSQL, optionally export to JSONL."""
    sql = """
        SELECT * FROM evidence
        WHERE dataset_id = %s
    """
    params: list[Any] = [dataset_id]

    if book_id:
        sql += " AND source_id = %s"
        params.append(book_id)

    sql += " ORDER BY id"

    with connection.cursor() as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()

    evidence_list = []
    for row in rows:
        evidence = _strip_json_suffix(row, ["normalized_claims", "properties"])
        evidence_list.append(evidence)

    if output_path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            for evidence in evidence_list:
                f.write(json.dumps(evidence, ensure_ascii=False) + "\n")

    return evidence_list


def load_node_cards(
    connection: psycopg.Connection,
    dataset_id: str,
    output_dir: Path | None = None,
) -> list[dict[str, Any]]:
    """Load node cards from PostgreSQL, optionally export to individual JSON files."""
    with connection.cursor() as cur:
        cur.execute(
            """
            SELECT * FROM node_cards
            WHERE dataset_id = %s
            ORDER BY node_id
            """,
            (dataset_id,),
        )
        rows = cur.fetchall()

    cards = []
    for row in rows:
        card = _strip_json_suffix(
            row,
            ["pattern_refs", "framework_refs", "profile_refs",
             "mention_refs", "source_refs", "sections", "properties"],
        )
        cards.append(card)

    if output_dir:
        output_dir.mkdir(parents=True, exist_ok=True)
        for card in cards:
            safe_id = card["node_id"].replace(":", "__").replace("/", "__")
            card_path = output_dir / f"{safe_id}.json"
            with open(card_path, "w", encoding="utf-8") as f:
                json.dump(card, f, ensure_ascii=False, indent=2)

    return cards


def export_full_snapshot(
    connection: psycopg.Connection,
    dataset_id: str,
    output_root: Path,
    book_id: str | None = None,
) -> dict[str, int]:
    """Export complete snapshot to output_root (for backup/external systems)."""
    output_root.mkdir(parents=True, exist_ok=True)

    counts = {}

    graph_dir = output_root / "graph"
    graph_dir.mkdir(exist_ok=True)

    counts["nodes"] = len(
        load_nodes(connection, dataset_id, graph_dir / "knowledge.nodes.jsonl")
    )
    counts["edges"] = len(
        load_edges(connection, dataset_id, graph_dir / "knowledge.edges.jsonl")
    )

    profiles_dir = output_root / "profiles"
    profiles_dir.mkdir(exist_ok=True)
    counts["profiles"] = len(
        load_profiles(connection, dataset_id, profiles_dir / "knowledge.profiles.jsonl")
    )

    counts["mentions"] = len(
        load_mentions(
            connection,
            dataset_id,
            book_id,
            graph_dir / f"{book_id or 'knowledge'}.mentions.jsonl",
        )
    )
    counts["evidence"] = len(
        load_evidence(
            connection,
            dataset_id,
            book_id,
            graph_dir / f"{book_id or 'knowledge'}.evidence.jsonl",
        )
    )

    counts["node_cards"] = len(
        load_node_cards(connection, dataset_id, output_root / "node_cards")
    )

    return counts
