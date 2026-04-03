#!/usr/bin/env python3
"""Shared helpers for the SQLite knowledge store scripts."""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterable


REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DB_PATH = REPO_ROOT / "storage" / "knowledge.sqlite"
SQLITE_SCHEMA_PATH = REPO_ROOT / "schemas" / "sqlite" / "knowledge_store.sql"
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


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def dump_json_text(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"))


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def normalize_term(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


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
        # Support both 'structure' (current) and 'items' (legacy) field names
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


def equivalent_anchor_tokens(book_id: str, anchor: str) -> list[str]:
    resolved = resolve_outline_anchor(book_id, anchor, strict=False)
    variants = [anchor]
    if resolved != anchor:
        variants.append(resolved)
    variants.extend(anchor_token_variants(anchor, book_id))
    if resolved != anchor:
        variants.extend(anchor_token_variants(resolved, book_id))
    return unique_stable(variants)


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


def store_batch_runtime_records(
    connection: sqlite3.Connection,
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
    if replace:
        connection.execute(
            """
            DELETE FROM batch_runtime_records
            WHERE dataset_id = ? AND book_id = ? AND batch_anchor = ? AND record_type = ?
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
                dump_json_text(payload),
                now,
                now,
            )
        )
    if rows:
        connection.executemany(
            """
            INSERT OR REPLACE INTO batch_runtime_records (
              dataset_id,
              book_id,
              batch_anchor,
              record_type,
              record_id,
              payload_json,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            rows,
        )
    return len(rows)


def load_batch_runtime_records(
    connection: sqlite3.Connection,
    dataset_id: str,
    book_id: str,
    batch_anchor: str,
    record_type: str,
) -> list[dict[str, Any]]:
    rows = connection.execute(
        """
        SELECT payload_json
        FROM batch_runtime_records
        WHERE dataset_id = ? AND book_id = ? AND batch_anchor = ? AND record_type = ?
        ORDER BY record_id
        """,
        (dataset_id, book_id, batch_anchor, record_type),
    ).fetchall()
    return [json.loads(row["payload_json"]) for row in rows]


def connect_db(db_path: Path | str) -> sqlite3.Connection:
    path = Path(db_path).expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def ensure_sqlite_schema(connection: sqlite3.Connection) -> None:
    connection.executescript(SQLITE_SCHEMA_PATH.read_text(encoding="utf-8"))


def get_table_sql(connection: sqlite3.Connection, table_name: str) -> str | None:
    row = connection.execute(
        """
        SELECT sql
        FROM sqlite_master
        WHERE type = 'table' AND name = ?
        """,
        (table_name,),
    ).fetchone()
    if row is None:
        return None
    return row["sql"]


def schema_supports_evidence_link_owner_type(
    connection: sqlite3.Connection, owner_type: str
) -> bool:
    table_sql = get_table_sql(connection, "evidence_links")
    if not table_sql:
        return False
    return f"'{owner_type}'" in table_sql


def resolve_dataset_id(
    connection: sqlite3.Connection,
    dataset_id: str | None = None,
    output_root: Path | str | None = None,
) -> str:
    if dataset_id:
        return dataset_id
    if output_root is not None:
        return dataset_id_from_output_root(output_root)

    row = connection.execute(
        "SELECT dataset_id FROM datasets WHERE is_active = 1 LIMIT 1"
    ).fetchone()
    if row is None:
        raise SystemExit(
            "No dataset id provided and no active dataset found in SQLite."
        )
    return row["dataset_id"]


def require_dataset_row(connection: sqlite3.Connection, dataset_id: str) -> sqlite3.Row:
    row = connection.execute(
        "SELECT * FROM datasets WHERE dataset_id = ?",
        (dataset_id,),
    ).fetchone()
    if row is None:
        raise SystemExit(f"Dataset '{dataset_id}' not found in SQLite.")
    return row


def fetch_existing_edges(
    connection: sqlite3.Connection, dataset_id: str
) -> list[sqlite3.Row]:
    return connection.execute(
        """
        SELECT id, edge_type, from_id, to_id, directionality, confidence, status
        FROM edges
        WHERE dataset_id = ?
          AND status != 'deprecated'
        """,
        (dataset_id,),
    ).fetchall()


def detect_edge_conflict(
    proposal: dict[str, Any], existing_edges: Iterable[sqlite3.Row]
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
# SQLite Data Access Functions
# ============================================================================


def load_nodes(
    connection: sqlite3.Connection,
    dataset_id: str,
    output_path: Path | None = None,
) -> list[dict[str, Any]]:
    """Load nodes from SQLite, optionally export to JSONL.

    Args:
        connection: SQLite database connection
        dataset_id: Dataset ID to load
        output_path: Optional path to export JSONL (for backup/external systems)

    Returns:
        List of node dictionaries with parsed JSON fields
    """
    rows = connection.execute(
        """
        SELECT * FROM nodes
        WHERE dataset_id = ?
        ORDER BY id
        """,
        (dataset_id,),
    ).fetchall()

    nodes = []
    for row in rows:
        node = dict(row)
        # Parse JSON fields
        for key in ["aliases", "learning_modes", "bridge_tags", "framework_refs"]:
            if f"{key}_json" in node:
                node[key] = json.loads(node[f"{key}_json"])
                del node[f"{key}_json"]
        nodes.append(node)

    if output_path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            for node in nodes:
                f.write(json.dumps(node, ensure_ascii=False) + "\n")

    return nodes


def load_edges(
    connection: sqlite3.Connection,
    dataset_id: str,
    output_path: Path | None = None,
) -> list[dict[str, Any]]:
    """Load edges from SQLite, optionally export to JSONL."""
    rows = connection.execute(
        """
        SELECT * FROM edges
        WHERE dataset_id = ?
        ORDER BY id
        """,
        (dataset_id,),
    ).fetchall()

    edges = []
    for row in rows:
        edge = dict(row)
        # Parse JSON fields
        for key in ["source_refs"]:
            if f"{key}_json" in edge:
                edge[key] = json.loads(edge[f"{key}_json"])
                del edge[f"{key}_json"]
        edges.append(edge)

    if output_path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            for edge in edges:
                f.write(json.dumps(edge, ensure_ascii=False) + "\n")

    return edges


def load_profiles(
    connection: sqlite3.Connection,
    dataset_id: str,
    output_path: Path | None = None,
) -> list[dict[str, Any]]:
    """Load curriculum profiles from SQLite, optionally export to JSONL."""
    rows = connection.execute(
        """
        SELECT * FROM profiles
        WHERE dataset_id = ?
        ORDER BY id
        """,
        (dataset_id,),
    ).fetchall()

    profiles = []
    for row in rows:
        profile = dict(row)
        # Parse JSON fields
        for key in ["learning_objectives", "framework_refs", "textbook_refs"]:
            if f"{key}_json" in profile:
                profile[key] = json.loads(profile[f"{key}_json"])
                del profile[f"{key}_json"]
        profiles.append(profile)

    if output_path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            for profile in profiles:
                f.write(json.dumps(profile, ensure_ascii=False) + "\n")

    return profiles


def load_mentions(
    connection: sqlite3.Connection,
    dataset_id: str,
    book_id: str | None = None,
    output_path: Path | None = None,
) -> list[dict[str, Any]]:
    """Load mentions from SQLite, optionally export to JSONL."""
    sql = """
        SELECT * FROM mentions
        WHERE dataset_id = ?
    """
    params = [dataset_id]

    if book_id:
        sql += " AND source_id = ?"
        params.append(book_id)

    sql += " ORDER BY id"

    rows = connection.execute(sql, params).fetchall()

    mentions = []
    for row in rows:
        mention = dict(row)
        # Parse JSON fields
        for key in ["source_refs"]:
            if f"{key}_json" in mention:
                mention[key] = json.loads(mention[f"{key}_json"])
                del mention[f"{key}_json"]
        mentions.append(mention)

    if output_path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            for mention in mentions:
                f.write(json.dumps(mention, ensure_ascii=False) + "\n")

    return mentions


def load_evidence(
    connection: sqlite3.Connection,
    dataset_id: str,
    book_id: str | None = None,
    output_path: Path | None = None,
) -> list[dict[str, Any]]:
    """Load evidence from SQLite, optionally export to JSONL."""
    sql = """
        SELECT * FROM evidence
        WHERE dataset_id = ?
    """
    params = [dataset_id]

    if book_id:
        sql += " AND source_id = ?"
        params.append(book_id)

    sql += " ORDER BY id"

    rows = connection.execute(sql, params).fetchall()

    evidence_list = []
    for row in rows:
        evidence = dict(row)
        # Parse JSON fields
        for key in ["properties"]:
            if f"{key}_json" in evidence:
                evidence[key] = json.loads(evidence[f"{key}_json"])
                del evidence[f"{key}_json"]
        evidence_list.append(evidence)

    if output_path:
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "w", encoding="utf-8") as f:
            for evidence in evidence_list:
                f.write(json.dumps(evidence, ensure_ascii=False) + "\n")

    return evidence_list


def load_node_cards(
    connection: sqlite3.Connection,
    dataset_id: str,
    output_dir: Path | None = None,
) -> list[dict[str, Any]]:
    """Load node cards from SQLite, optionally export to individual JSON files."""
    rows = connection.execute(
        """
        SELECT * FROM node_cards
        WHERE dataset_id = ?
        ORDER BY node_id
        """,
        (dataset_id,),
    ).fetchall()

    cards = []
    for row in rows:
        card = dict(row)
        # Parse JSON fields
        for key in ["sections", "mention_refs", "source_refs", "properties"]:
            if f"{key}_json" in card:
                card[key] = json.loads(card[f"{key}_json"])
                del card[f"{key}_json"]
        cards.append(card)

    if output_dir:
        output_dir.mkdir(parents=True, exist_ok=True)
        for card in cards:
            # Create safe filename from node_id
            safe_id = card["node_id"].replace(":", "__").replace("/", "__")
            card_path = output_dir / f"{safe_id}.json"
            with open(card_path, "w", encoding="utf-8") as f:
                json.dump(card, f, ensure_ascii=False, indent=2)

    return cards


def export_full_snapshot(
    connection: sqlite3.Connection,
    dataset_id: str,
    output_root: Path,
    book_id: str | None = None,
) -> dict[str, int]:
    """Export complete snapshot to output_root (for backup/external systems).

    Creates:
    - output_root/graph/knowledge.nodes.jsonl
    - output_root/graph/knowledge.edges.jsonl
    - output_root/profiles/knowledge.profiles.jsonl
    - output_root/graph/{book_id}.mentions.jsonl
    - output_root/graph/{book_id}.evidence.jsonl
    - output_root/node_cards/*.json

    Returns count of each artifact type.
    """
    output_root.mkdir(parents=True, exist_ok=True)

    counts = {}

    # Export graph
    graph_dir = output_root / "graph"
    graph_dir.mkdir(exist_ok=True)

    counts["nodes"] = len(
        load_nodes(connection, dataset_id, graph_dir / "knowledge.nodes.jsonl")
    )
    counts["edges"] = len(
        load_edges(connection, dataset_id, graph_dir / "knowledge.edges.jsonl")
    )

    # Export profiles
    profiles_dir = output_root / "profiles"
    profiles_dir.mkdir(exist_ok=True)
    counts["profiles"] = len(
        load_profiles(connection, dataset_id, profiles_dir / "knowledge.profiles.jsonl")
    )

    # Export mentions and evidence
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

    # Export node cards
    counts["node_cards"] = len(
        load_node_cards(connection, dataset_id, output_root / "node_cards")
    )

    return counts
