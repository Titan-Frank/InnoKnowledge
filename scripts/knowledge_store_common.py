#!/usr/bin/env python3
"""Shared helpers for the world-knowledge PostgreSQL runtime."""

from __future__ import annotations

import hashlib
import json
import math
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable

import psycopg
from psycopg.rows import dict_row

REPO_ROOT = Path(__file__).resolve().parent.parent
PG_SCHEMA_PATH = REPO_ROOT / "schemas" / "pg" / "knowledge_store.sql"
OUTLINES_DIR = REPO_ROOT / "data" / "outlines"
TEXTBOOK_SOURCE_PREFIX = "textbook:"
ANCHOR_ID_PATTERN = re.compile(
    r"^struct:(?P<book_id>[^:]+):(?P<kind>[^:]+):(?P<local>.+)$"
)

VALID_NODE_KINDS = {
    "entity",
    "concept",
    "property",
    "process",
    "event",
    "method",
    "rule",
    "representation",
    "resource",
}
VALID_DOMAINS = {
    "mathematics",
    "physics",
    "chemistry",
    "biology",
    "earth-science",
    "astronomy",
    "computer-science",
    "engineering",
    "language-arts",
    "linguistics",
    "literature",
    "history",
    "geography",
    "civics",
    "economics",
    "law",
    "education",
    "arts",
    "music",
    "health",
    "sports",
    "philosophy",
    "general",
}
VALID_KNOWLEDGE_FORMS = {"propositional", "practical"}
VALID_LEARNING_MODES = {"factual", "conceptual", "procedural", "metacognitive"}
VALID_SCOPE = {"universal", "domain-specific", "culture-specific"}
VALID_EDGE_TYPES = {
    "is_a",
    "instance_of",
    "part_of",
    "contains",
    "has_property",
    "uses",
    "produces",
    "depends_on",
    "prerequisite_for",
    "causes",
    "affects",
    "represents",
    "about",
    "same_as",
    "related_to",
}
HIERARCHICAL_EDGE_TYPES = {
    "is_a",
    "instance_of",
    "part_of",
    "contains",
    "depends_on",
    "prerequisite_for",
}
VALID_SCHOOL_STAGES = {
    "primary",
    "junior-secondary",
    "senior-secondary",
    "higher",
}
VALID_CURRICULUM_ROLES = {
    "core",
    "support",
    "assessment",
    "practice",
    "literacy",
}


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
    if value is None or value == "":
        return default
    try:
        return json.loads(value)
    except json.JSONDecodeError:
        return default


def infer_learning_modes(kind: str | None) -> list[str]:
    if kind in {"method"}:
        return ["procedural"]
    if kind in {"representation", "property"}:
        return ["factual", "conceptual"]
    if kind in {"entity", "event", "resource"}:
        return ["factual"]
    return ["conceptual"]


def normalize_learning_modes(learning_modes: Iterable[str] | None, kind: str | None) -> list[str]:
    cleaned = unique_stable(
        mode for mode in (learning_modes or []) if mode in VALID_LEARNING_MODES
    )
    if cleaned:
        return cleaned
    return infer_learning_modes(kind)


def require_valid_edge_type(edge_type: str) -> str:
    if edge_type not in VALID_EDGE_TYPES:
        allowed = ", ".join(sorted(VALID_EDGE_TYPES))
        raise SystemExit(
            f"Invalid edge type '{edge_type}'. Allowed values: {allowed}"
        )
    return edge_type


def make_stable_suffix(*parts: str, length: int = 16) -> str:
    digest = hashlib.sha1("||".join(parts).encode("utf-8")).hexdigest()
    return digest[:length]


def make_query_id(batch_anchor: str, query_text: str) -> str:
    suffix = make_stable_suffix(batch_anchor, query_text, length=12)
    return f"query:{suffix}"


def make_edge_id(from_node_id: str, edge_type: str, to_node_id: str) -> str:
    suffix = make_stable_suffix(from_node_id, edge_type, to_node_id, length=12)
    return f"edge:auto-{suffix}"


def make_lesson_run_id(book_id: str, batch_anchor: str) -> str:
    suffix = make_stable_suffix(book_id, batch_anchor, length=12)
    return f"lesson-run:{suffix}"


def make_merge_run_id(dataset_id: str, lesson_run_ids: Iterable[str]) -> str:
    suffix = make_stable_suffix(dataset_id, *sorted(lesson_run_ids), length=12)
    return f"merge:{suffix}"


def make_canonical_node_id(kind: str, name: str, subkind: str | None = None) -> str:
    prefix = kind if not subkind else f"{kind}/{subkind}"
    suffix = make_stable_suffix(prefix, normalize_term(name), length=12)
    return f"{prefix}:auto-{suffix}"


def make_domain_profile_id(node_id: str, domain: str) -> str:
    suffix = make_stable_suffix(node_id, domain, length=12)
    return f"domain-profile:auto-{suffix}"


def make_node_card_id(node_id: str) -> str:
    suffix = make_stable_suffix(node_id, length=12)
    return f"node-card:auto-{suffix}"


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


def rebuild_node_terms(connection: psycopg.Connection, dataset_id: str) -> int:
    with connection.cursor() as cur:
        cur.execute("DELETE FROM world_node_terms WHERE dataset_id = %s", (dataset_id,))
        cur.execute(
            """
            SELECT id, name, aliases_json, tags_json
            FROM world_nodes
            WHERE dataset_id = %s AND status != 'deprecated'
            """,
            (dataset_id,),
        )
        rows = cur.fetchall()

    inserts: list[tuple[str, str, str, str, str]] = []
    for row in rows:
        node_id = row["id"]
        canonical_name = row["name"] or ""
        aliases = row["aliases_json"] if isinstance(row["aliases_json"], list) else []
        tags = row["tags_json"] if isinstance(row["tags_json"], list) else []
        terms = [(canonical_name, "canonical")]
        terms.extend((alias, "alias") for alias in aliases)
        terms.extend((tag, "tag") for tag in tags)
        for term, term_type in terms:
            if not isinstance(term, str):
                continue
            term_norm = normalize_term(term)
            if not term_norm:
                continue
            inserts.append((dataset_id, node_id, term, term_norm, term_type))

    if inserts:
        with connection.cursor() as cur:
            cur.executemany(
                """
                INSERT INTO world_node_terms (
                  dataset_id, node_id, term, term_norm, term_type
                ) VALUES (%s, %s, %s, %s, %s)
                ON CONFLICT (dataset_id, node_id, term_norm, term_type)
                DO UPDATE SET term = EXCLUDED.term
                """,
                inserts,
            )
    return len(inserts)


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
        item_id for item_id in by_id if anchor in anchor_token_variants(item_id, book_id)
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
            f"Anchor '{anchor}' was not found in outline for book '{book_id}'. Use a canonical outline id such as: {sample}"
        )
    return anchor


def resolve_chunk_or_lesson(book_id: str, anchor: str) -> list[dict[str, Any]] | dict[str, Any] | None:
    items = load_outline_items(book_id)
    by_id = {item["id"]: item for item in items if item.get("id")}
    resolved = resolve_outline_anchor(book_id, anchor, strict=False)
    if resolved not in by_id:
        return None
    item = by_id[resolved]
    if item.get("kind") == "chunk":
        return item
    chunks = [candidate for candidate in items if candidate.get("parent_id") == resolved and candidate.get("kind") == "chunk"]
    if chunks:
        return sorted(chunks, key=lambda candidate: candidate.get("order_path", ""))
    return item


def book_id_from_anchor(anchor_ref: str | None) -> str | None:
    if not anchor_ref:
        return None
    match = ANCHOR_ID_PATTERN.match(anchor_ref)
    return match.group("book_id") if match else None


def strip_textbook_source_prefix(source_id: str | None) -> str | None:
    if not source_id:
        return source_id
    if source_id.startswith(TEXTBOOK_SOURCE_PREFIX):
        return source_id[len(TEXTBOOK_SOURCE_PREFIX):]
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


def connect_db(database_url: str | None = None) -> psycopg.Connection:
    url = database_url or os.environ.get("DATABASE_URL")
    if not url:
        raise SystemExit(
            "No database URL provided. Set DATABASE_URL or pass --db with a PostgreSQL connection string."
        )
    return psycopg.connect(url, row_factory=dict_row, autocommit=False)


def ensure_pg_schema(connection: psycopg.Connection) -> None:
    with connection.cursor() as cur:
        cur.execute(
            "SELECT EXISTS(SELECT 1 FROM information_schema.tables WHERE table_name = 'world_datasets')"
        )
        exists = cur.fetchone()["exists"]
    if exists:
        return
    schema_sql = PG_SCHEMA_PATH.read_text(encoding="utf-8")
    with connection.cursor() as cur:
        cur.execute(schema_sql)
    connection.commit()


def resolve_dataset_id(
    connection: psycopg.Connection,
    dataset_id: str | None = None,
    output_root: Path | str | None = None,
) -> str:
    if dataset_id:
        return dataset_id
    if output_root is not None:
        return Path(output_root).expanduser().resolve().name

    with connection.cursor() as cur:
        cur.execute(
            "SELECT dataset_id FROM world_datasets WHERE is_active = 1 LIMIT 1"
        )
        row = cur.fetchone()
    if row is None:
        raise SystemExit(
            "No dataset id provided and no active dataset found in PostgreSQL."
        )
    return row["dataset_id"]


def require_dataset_row(connection: psycopg.Connection, dataset_id: str) -> dict[str, Any]:
    with connection.cursor() as cur:
        cur.execute(
            "SELECT * FROM world_datasets WHERE dataset_id = %s",
            (dataset_id,),
        )
        row = cur.fetchone()
    if row is None:
        raise SystemExit(f"Dataset '{dataset_id}' not found in PostgreSQL.")
    return row


def ensure_dataset(connection: psycopg.Connection, dataset_id: str, root: Path | str) -> None:
    with connection.cursor() as cur:
        cur.execute(
            "SELECT dataset_id FROM world_datasets WHERE dataset_id = %s",
            (dataset_id,),
        )
        if cur.fetchone() is not None:
            return
        now = utc_now()
        cur.execute(
            """
            INSERT INTO world_datasets (
              dataset_id, dataset_name, schema_version, status, is_active,
              root_path, created_at, updated_at, notes
            ) VALUES (%s, %s, 'world-v1.2', 'draft', 0, %s, %s, %s, %s)
            """,
            (
                dataset_id,
                dataset_id,
                str(Path(root).expanduser().resolve()),
                now,
                now,
                None,
            ),
        )
    connection.commit()
