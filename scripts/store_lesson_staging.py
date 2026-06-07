#!/usr/bin/env python3
"""Write lesson extraction artifacts into world_staging_* tables."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from scripts.embedding_client import DEFAULT_EMBEDDING_MODEL, DEFAULT_EMBEDDING_URL, embed_texts
from scripts.knowledge_store_common import (
    VALID_CURRICULUM_ROLES,
    VALID_DOMAINS,
    VALID_KNOWLEDGE_FORMS,
    VALID_LEARNING_MODES,
    VALID_NODE_KINDS,
    VALID_SCHOOL_STAGES,
    VALID_SCOPE,
    connect_db,
    ensure_dataset,
    ensure_pg_schema,
    make_lesson_run_id,
    normalize_learning_modes,
    normalize_term,
    require_valid_edge_type,
    resolve_dataset_id,
    resolve_outline_anchor,
    unique_stable,
    utc_now,
)


def _list(value: Any) -> list[Any]:
    if value is None:
        return []
    if isinstance(value, list):
        return value
    return [value]


def _dict(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _unique_enum(values: Any, allowed: set[str]) -> list[str]:
    return unique_stable(
        str(value).strip()
        for value in _list(values)
        if str(value).strip() in allowed
    )


def normalize_nodes(nodes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for node in nodes:
        raw_node_id = str(node.get("id") or node.get("raw_node_id") or "").strip()
        name = str(node.get("name") or node.get("canonical_name") or "").strip()
        kind = str(node.get("kind") or node.get("node_kind") or "").strip()
        definition = str(node.get("definition") or "").strip()
        if not raw_node_id or not name or not definition:
            raise SystemExit(f"Invalid node payload: missing id/name/definition for {node!r}")
        if kind not in VALID_NODE_KINDS:
            raise SystemExit(f"Invalid node kind '{kind}' for node '{raw_node_id}'.")
        domains = _unique_enum(node.get("domains"), VALID_DOMAINS)
        if not domains:
            domains = ["general"]
        normalized.append(
            {
                "raw_node_id": raw_node_id,
                "name": name,
                "kind": kind,
                "subkind": str(node.get("subkind") or node.get("node_subkind") or "").strip() or None,
                "definition": definition,
                "aliases_json": unique_stable(
                    str(alias).strip()
                    for alias in _list(node.get("aliases"))
                    if str(alias).strip()
                ),
                "domains_json": domains,
                "knowledge_form_json": _unique_enum(node.get("knowledge_form"), VALID_KNOWLEDGE_FORMS),
                "learning_mode_json": normalize_learning_modes(node.get("learning_mode"), kind),
                "scope": str(node.get("scope") or "").strip() or "domain-specific",
                "properties_json": _dict(node.get("properties")),
                "external_ids_json": _dict(node.get("external_ids")),
                "tags_json": unique_stable(
                    str(tag).strip()
                    for tag in _list(node.get("tags"))
                    if str(tag).strip()
                ),
                "semantic_key": str(node.get("semantic_key") or normalize_term(name)),
                "embedding_json": node.get("embedding_json"),
                "source_refs_json": unique_stable(
                    str(ref).strip()
                    for ref in _list(node.get("source_refs"))
                    if str(ref).strip()
                ),
                "status": str(node.get("status") or "draft"),
                "notes": str(node.get("notes") or "").strip(),
            }
        )
    return normalized


def normalize_edges(edges: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for edge in edges:
        raw_edge_id = str(edge.get("id") or edge.get("raw_edge_id") or "").strip()
        if not raw_edge_id:
            raise SystemExit("Edge missing id.")
        normalized.append(
            {
                "raw_edge_id": raw_edge_id,
                "type": require_valid_edge_type(str(edge.get("type") or edge.get("edge_type") or "").strip()),
                "from_raw_node_id": str(edge.get("from") or edge.get("from_raw_node_id") or "").strip(),
                "to_raw_node_id": str(edge.get("to") or edge.get("to_raw_node_id") or "").strip(),
                "directionality": str(edge.get("directionality") or "directed"),
                "confidence": float(edge.get("confidence") or 0.8),
                "source_refs_json": unique_stable(
                    str(ref).strip()
                    for ref in _list(edge.get("source_refs"))
                    if str(ref).strip()
                ),
                "properties_json": _dict(edge.get("properties")),
                "status": str(edge.get("status") or "draft"),
                "notes": str(edge.get("notes") or "").strip(),
            }
        )
    return normalized


def normalize_domain_profiles(domain_profiles: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for profile in domain_profiles:
        raw_profile_id = str(profile.get("id") or profile.get("raw_profile_id") or "").strip()
        raw_node_id = str(profile.get("node_id") or profile.get("raw_node_id") or "").strip()
        domain = str(profile.get("domain") or "").strip()
        if not raw_profile_id or not raw_node_id or domain not in VALID_DOMAINS:
            raise SystemExit(f"Invalid domain profile payload: {profile!r}")
        normalized.append(
            {
                "raw_profile_id": raw_profile_id,
                "raw_node_id": raw_node_id,
                "domain": domain,
                "school_stages_json": _unique_enum(profile.get("school_stages"), VALID_SCHOOL_STAGES),
                "curriculum_roles_json": _unique_enum(profile.get("curriculum_roles"), VALID_CURRICULUM_ROLES),
                "source_refs_json": unique_stable(
                    str(ref).strip()
                    for ref in _list(profile.get("source_refs"))
                    if str(ref).strip()
                ),
                "properties_json": _dict(profile.get("properties")),
                "status": str(profile.get("status") or "draft"),
                "notes": str(profile.get("notes") or "").strip(),
            }
        )
    return normalized


def normalize_mentions(mentions: list[dict[str, Any]], book_id: str, anchor: str) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for mention in mentions:
        raw_mention_id = str(mention.get("id") or mention.get("raw_mention_id") or "").strip()
        if not raw_mention_id:
            raise SystemExit("Mention missing id.")
        normalized.append(
            {
                "raw_mention_id": raw_mention_id,
                "source_type": str(mention.get("source_type") or "textbook"),
                "source_id": str(mention.get("source_id") or book_id),
                "anchor_ref": str(mention.get("anchor_ref") or anchor),
                "target_type": str(mention.get("target_type") or "node"),
                "target_raw_id": str(mention.get("target_id") or mention.get("target_raw_id") or "").strip(),
                "role": str(mention.get("role") or "mentions"),
                "source_refs_json": unique_stable(
                    str(ref).strip()
                    for ref in _list(mention.get("source_refs"))
                    if str(ref).strip()
                ),
                "confidence": float(mention.get("confidence") or 0.8),
                "properties_json": _dict(mention.get("properties")),
            }
        )
    return normalized


def normalize_evidence(evidence: list[dict[str, Any]], book_id: str, anchor: str) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for item in evidence:
        raw_evidence_id = str(item.get("id") or item.get("raw_evidence_id") or "").strip()
        if not raw_evidence_id:
            raise SystemExit("Evidence missing id.")
        normalized.append(
            {
                "raw_evidence_id": raw_evidence_id,
                "source_type": str(item.get("source_type") or "textbook"),
                "source_id": str(item.get("source_id") or book_id),
                "anchor_ref": str(item.get("anchor_ref") or anchor),
                "source_path": str(item.get("source_path") or ""),
                "page_start": item.get("page_start"),
                "page_end": item.get("page_end"),
                "excerpt": str(item.get("excerpt") or "").strip(),
                "locator": str(item.get("locator") or "").strip(),
                "modality": str(item.get("modality") or "text"),
                "extraction_method": str(item.get("extraction_method") or "ocr"),
                "normalized_claims_json": [
                    str(claim).strip()
                    for claim in _list(item.get("normalized_claims"))
                    if str(claim).strip()
                ],
                "properties_json": _dict(item.get("properties")),
            }
        )
    return normalized


def normalize_node_cards(node_cards: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for card in node_cards:
        raw_card_id = str(card.get("id") or card.get("raw_card_id") or "").strip()
        raw_node_id = str(card.get("node_id") or card.get("raw_node_id") or "").strip()
        if not raw_card_id or not raw_node_id:
            raise SystemExit(f"Invalid node card payload: {card!r}")
        sections = []
        for section in _list(card.get("sections")):
            if not isinstance(section, dict):
                continue
            sections.append(
                {
                    "id": str(section.get("id") or "section").strip(),
                    "title": str(section.get("title") or "").strip(),
                    "section_type": str(section.get("section_type") or "other").strip(),
                    "content": [
                        str(item).strip()
                        for item in _list(section.get("content"))
                        if str(item).strip()
                    ],
                    "source_refs": unique_stable(
                        str(ref).strip()
                        for ref in _list(section.get("source_refs"))
                        if str(ref).strip()
                    ),
                    "properties": _dict(section.get("properties")),
                }
            )
        normalized.append(
            {
                "raw_card_id": raw_card_id,
                "raw_node_id": raw_node_id,
                "title": str(card.get("title") or "").strip(),
                "summary": str(card.get("summary") or "").strip(),
                "source_refs_json": unique_stable(
                    str(ref).strip()
                    for ref in _list(card.get("source_refs"))
                    if str(ref).strip()
                ),
                "sections_json": sections,
                "properties_json": _dict(card.get("properties")),
                "status": str(card.get("status") or "draft"),
            }
        )
    return normalized


def build_embedding_text(node: dict[str, Any]) -> str:
    aliases = ", ".join(node["aliases_json"])
    domains = ", ".join(node["domains_json"])
    return "\n".join(part for part in [node["name"], node["definition"], aliases, domains] if part)


def auto_embed_nodes(
    nodes: list[dict[str, Any]],
    *,
    url: str = DEFAULT_EMBEDDING_URL,
    model: str = DEFAULT_EMBEDDING_MODEL,
    api_key: str | None = None,
) -> list[dict[str, Any]]:
    pending_indexes: list[int] = []
    pending_texts: list[str] = []
    for index, node in enumerate(nodes):
        if node.get("embedding_json"):
            continue
        pending_indexes.append(index)
        pending_texts.append(build_embedding_text(node))
    vectors = embed_texts(pending_texts, url=url, model=model, api_key=api_key)
    for index, vector in zip(pending_indexes, vectors):
        if vector:
            nodes[index]["embedding_json"] = vector
    return nodes


def replace_table_rows(conn: psycopg.Connection, table_name: str, dataset_id: str, lesson_run_id: str) -> None:
    with conn.cursor() as cur:
        cur.execute(
            f"DELETE FROM {table_name} WHERE dataset_id = %s AND lesson_run_id = %s",
            (dataset_id, lesson_run_id),
        )


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Store lesson extraction artifacts into world staging tables.")
    parser.add_argument("--root", required=True)
    parser.add_argument("--book-id", required=True)
    parser.add_argument("--batch-anchor", required=True)
    parser.add_argument("--lesson-run-id")
    parser.add_argument("--dataset-id")
    parser.add_argument("--db", default=None)
    parser.add_argument("--nodes-json", required=True)
    parser.add_argument("--edges-json", required=True)
    parser.add_argument("--domain-profiles-json", required=True)
    parser.add_argument("--mentions-json", required=True)
    parser.add_argument("--evidence-json", required=True)
    parser.add_argument("--node-cards-json", required=True)
    parser.add_argument("--skip-integrity-check", action="store_true")
    return parser.parse_args()


def _upsert_lesson_run(conn: psycopg.Connection, dataset_id: str, lesson_run_id: str, book_id: str, batch_anchor: str) -> None:
    now = utc_now()
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO world_lesson_runs (
              dataset_id, lesson_run_id, book_id, batch_anchor,
              status, counts_json, properties_json, created_at, updated_at
            ) VALUES (%s, %s, %s, %s, 'staged', '{}'::jsonb, '{}'::jsonb, %s, %s)
            ON CONFLICT (dataset_id, lesson_run_id) DO UPDATE SET
              book_id = EXCLUDED.book_id,
              batch_anchor = EXCLUDED.batch_anchor,
              updated_at = EXCLUDED.updated_at
            """,
            (dataset_id, lesson_run_id, book_id, batch_anchor, now, now),
        )


def _store_nodes(conn: psycopg.Connection, dataset_id: str, lesson_run_id: str, book_id: str, batch_anchor: str, nodes: list[dict[str, Any]]) -> None:
    now = utc_now()
    replace_table_rows(conn, "world_staging_nodes", dataset_id, lesson_run_id)
    rows = [
        (
            dataset_id,
            lesson_run_id,
            node["raw_node_id"],
            book_id,
            batch_anchor,
            node["name"],
            node["kind"],
            node["subkind"],
            node["definition"],
            json.dumps(node["aliases_json"], ensure_ascii=False),
            json.dumps(node["domains_json"], ensure_ascii=False),
            json.dumps(node["knowledge_form_json"], ensure_ascii=False),
            json.dumps(node["learning_mode_json"], ensure_ascii=False),
            node["scope"] if node["scope"] in VALID_SCOPE else "domain-specific",
            json.dumps(node["properties_json"], ensure_ascii=False),
            json.dumps(node["external_ids_json"], ensure_ascii=False),
            json.dumps(node["tags_json"], ensure_ascii=False),
            node["semantic_key"],
            node.get("embedding_json"),
            json.dumps(node["source_refs_json"], ensure_ascii=False),
            node["status"],
            now,
            now,
            node["notes"],
        )
        for node in nodes
    ]
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO world_staging_nodes (
              dataset_id, lesson_run_id, raw_node_id, book_id, batch_anchor,
              name, kind, subkind, definition, aliases_json, domains_json,
              knowledge_form_json, learning_mode_json, scope, properties_json,
              external_ids_json, tags_json, semantic_key, embedding, source_refs_json,
              status, created_at, updated_at, notes
            ) VALUES (
              %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb,
              %s::jsonb, %s::jsonb, %s, %s::jsonb, %s::jsonb, %s::jsonb, %s, %s,
              %s::jsonb, %s, %s, %s, %s
            )
            """,
            rows,
        )


def _store_edges(conn: psycopg.Connection, dataset_id: str, lesson_run_id: str, book_id: str, batch_anchor: str, edges: list[dict[str, Any]]) -> None:
    now = utc_now()
    replace_table_rows(conn, "world_staging_edges", dataset_id, lesson_run_id)
    rows = [
        (
            dataset_id,
            lesson_run_id,
            edge["raw_edge_id"],
            book_id,
            batch_anchor,
            edge["type"],
            edge["from_raw_node_id"],
            edge["to_raw_node_id"],
            edge["directionality"],
            edge["confidence"],
            json.dumps(edge["source_refs_json"], ensure_ascii=False),
            json.dumps(edge["properties_json"], ensure_ascii=False),
            edge["status"],
            now,
            now,
            edge["notes"],
        )
        for edge in edges
    ]
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO world_staging_edges (
              dataset_id, lesson_run_id, raw_edge_id, book_id, batch_anchor, type,
              from_raw_node_id, to_raw_node_id, directionality, confidence,
              source_refs_json, properties_json, status, created_at, updated_at, notes
            ) VALUES (
              %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
              %s::jsonb, %s::jsonb, %s, %s, %s, %s
            )
            """,
            rows,
        )


def _store_domain_profiles(conn: psycopg.Connection, dataset_id: str, lesson_run_id: str, domain_profiles: list[dict[str, Any]]) -> None:
    now = utc_now()
    replace_table_rows(conn, "world_staging_domain_profiles", dataset_id, lesson_run_id)
    rows = [
        (
            dataset_id,
            lesson_run_id,
            profile["raw_profile_id"],
            profile["raw_node_id"],
            profile["domain"],
            json.dumps(profile["school_stages_json"], ensure_ascii=False),
            json.dumps(profile["curriculum_roles_json"], ensure_ascii=False),
            json.dumps(profile["source_refs_json"], ensure_ascii=False),
            json.dumps(profile["properties_json"], ensure_ascii=False),
            profile["status"],
            now,
            now,
            profile["notes"],
        )
        for profile in domain_profiles
    ]
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO world_staging_domain_profiles (
              dataset_id, lesson_run_id, raw_profile_id, raw_node_id, domain,
              school_stages_json, curriculum_roles_json, source_refs_json,
              properties_json, status, created_at, updated_at, notes
            ) VALUES (
              %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb,
              %s::jsonb, %s, %s, %s, %s
            )
            """,
            rows,
        )


def _store_mentions(conn: psycopg.Connection, dataset_id: str, lesson_run_id: str, mentions: list[dict[str, Any]]) -> None:
    now = utc_now()
    replace_table_rows(conn, "world_staging_mentions", dataset_id, lesson_run_id)
    rows = [
        (
            dataset_id,
            lesson_run_id,
            mention["raw_mention_id"],
            mention["source_type"],
            mention["source_id"],
            mention["anchor_ref"],
            mention["target_type"],
            mention["target_raw_id"],
            mention["role"],
            json.dumps(mention["source_refs_json"], ensure_ascii=False),
            mention["confidence"],
            json.dumps(mention["properties_json"], ensure_ascii=False),
            now,
            now,
        )
        for mention in mentions
    ]
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO world_staging_mentions (
              dataset_id, lesson_run_id, raw_mention_id, source_type, source_id,
              anchor_ref, target_type, target_raw_id, role, source_refs_json,
              confidence, properties_json, created_at, updated_at
            ) VALUES (
              %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb,
              %s, %s::jsonb, %s, %s
            )
            """,
            rows,
        )


def _store_evidence(conn: psycopg.Connection, dataset_id: str, lesson_run_id: str, evidence: list[dict[str, Any]]) -> None:
    now = utc_now()
    replace_table_rows(conn, "world_staging_evidence", dataset_id, lesson_run_id)
    rows = [
        (
            dataset_id,
            lesson_run_id,
            item["raw_evidence_id"],
            item["source_type"],
            item["source_id"],
            item["anchor_ref"],
            item["source_path"],
            item["page_start"],
            item["page_end"],
            item["excerpt"],
            item["locator"],
            item["modality"],
            item["extraction_method"],
            json.dumps(item["normalized_claims_json"], ensure_ascii=False),
            json.dumps(item["properties_json"], ensure_ascii=False),
            now,
            now,
        )
        for item in evidence
    ]
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO world_staging_evidence (
              dataset_id, lesson_run_id, raw_evidence_id, source_type, source_id,
              anchor_ref, source_path, page_start, page_end, excerpt, locator,
              modality, extraction_method, normalized_claims_json, properties_json,
              created_at, updated_at
            ) VALUES (
              %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
              %s, %s, %s::jsonb, %s::jsonb, %s, %s
            )
            """,
            rows,
        )


def _store_node_cards(conn: psycopg.Connection, dataset_id: str, lesson_run_id: str, node_cards: list[dict[str, Any]]) -> None:
    now = utc_now()
    replace_table_rows(conn, "world_staging_node_cards", dataset_id, lesson_run_id)
    rows = [
        (
            dataset_id,
            lesson_run_id,
            card["raw_card_id"],
            card["raw_node_id"],
            card["title"],
            card["summary"],
            json.dumps(card["source_refs_json"], ensure_ascii=False),
            json.dumps(card["sections_json"], ensure_ascii=False),
            json.dumps(card["properties_json"], ensure_ascii=False),
            card["status"],
            now,
            now,
        )
        for card in node_cards
    ]
    with conn.cursor() as cur:
        cur.executemany(
            """
            INSERT INTO world_staging_node_cards (
              dataset_id, lesson_run_id, raw_card_id, raw_node_id, title, summary,
              source_refs_json, sections_json, properties_json, status, created_at, updated_at
            ) VALUES (
              %s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s::jsonb, %s, %s, %s
            )
            """,
            rows,
        )


def check_staging_integrity(
    conn: psycopg.Connection,
    dataset_id: str,
    lesson_run_id: str,
) -> dict[str, Any]:
    issues: list[str] = []
    checks: list[dict[str, Any]] = []
    with conn.cursor() as cur:
        cur.execute(
            "SELECT raw_node_id FROM world_staging_nodes WHERE dataset_id = %s AND lesson_run_id = %s",
            (dataset_id, lesson_run_id),
        )
        node_ids = {row["raw_node_id"] for row in cur.fetchall()}

        cur.execute(
            "SELECT raw_profile_id, raw_node_id FROM world_staging_domain_profiles WHERE dataset_id = %s AND lesson_run_id = %s",
            (dataset_id, lesson_run_id),
        )
        for row in cur.fetchall():
            if row["raw_node_id"] not in node_ids:
                issues.append(f"Domain profile {row['raw_profile_id']} references missing node {row['raw_node_id']}.")

        cur.execute(
            "SELECT raw_edge_id, from_raw_node_id, to_raw_node_id FROM world_staging_edges WHERE dataset_id = %s AND lesson_run_id = %s",
            (dataset_id, lesson_run_id),
        )
        for row in cur.fetchall():
            if row["from_raw_node_id"] not in node_ids or row["to_raw_node_id"] not in node_ids:
                issues.append(f"Edge {row['raw_edge_id']} references missing node endpoint.")

        cur.execute(
            "SELECT raw_card_id, raw_node_id FROM world_staging_node_cards WHERE dataset_id = %s AND lesson_run_id = %s",
            (dataset_id, lesson_run_id),
        )
        for row in cur.fetchall():
            if row["raw_node_id"] not in node_ids:
                issues.append(f"Node card {row['raw_card_id']} references missing node {row['raw_node_id']}.")

    checks.append({"name": "references", "ok": not issues})
    return {"valid": not issues, "checks": checks, "issues": issues}


def main() -> int:
    args = parse_args()
    conn = connect_db(args.db)
    ensure_pg_schema(conn)
    root = Path(args.root).expanduser().resolve()
    dataset_id = resolve_dataset_id(conn, args.dataset_id, root)
    ensure_dataset(conn, dataset_id, root)
    batch_anchor = resolve_outline_anchor(args.book_id, args.batch_anchor, strict=True)
    lesson_run_id = args.lesson_run_id or make_lesson_run_id(args.book_id, batch_anchor)

    nodes = auto_embed_nodes(normalize_nodes(json.loads(args.nodes_json)))
    edges = normalize_edges(json.loads(args.edges_json))
    domain_profiles = normalize_domain_profiles(json.loads(args.domain_profiles_json))
    mentions = normalize_mentions(json.loads(args.mentions_json), args.book_id, batch_anchor)
    evidence = normalize_evidence(json.loads(args.evidence_json), args.book_id, batch_anchor)
    node_cards = normalize_node_cards(json.loads(args.node_cards_json))

    _upsert_lesson_run(conn, dataset_id, lesson_run_id, args.book_id, batch_anchor)
    _store_nodes(conn, dataset_id, lesson_run_id, args.book_id, batch_anchor, nodes)
    _store_edges(conn, dataset_id, lesson_run_id, args.book_id, batch_anchor, edges)
    _store_domain_profiles(conn, dataset_id, lesson_run_id, domain_profiles)
    _store_mentions(conn, dataset_id, lesson_run_id, mentions)
    _store_evidence(conn, dataset_id, lesson_run_id, evidence)
    _store_node_cards(conn, dataset_id, lesson_run_id, node_cards)

    counts = {
        "nodes": len(nodes),
        "edges": len(edges),
        "domain_profiles": len(domain_profiles),
        "mentions": len(mentions),
        "evidence": len(evidence),
        "node_cards": len(node_cards),
    }
    with conn.cursor() as cur:
        cur.execute(
            """
            UPDATE world_lesson_runs
            SET counts_json = %s::jsonb, updated_at = %s
            WHERE dataset_id = %s AND lesson_run_id = %s
            """,
            (json.dumps(counts, ensure_ascii=False), utc_now(), dataset_id, lesson_run_id),
        )
    integrity = {"valid": True, "checks": [], "issues": []}
    if not args.skip_integrity_check:
        integrity = check_staging_integrity(conn, dataset_id, lesson_run_id)
        if not integrity["valid"]:
            with conn.cursor() as cur:
                cur.execute(
                    """
                    UPDATE world_lesson_runs
                    SET status = 'blocked', updated_at = %s
                    WHERE dataset_id = %s AND lesson_run_id = %s
                    """,
                    (utc_now(), dataset_id, lesson_run_id),
                )
    conn.commit()
    print(
        json.dumps(
            {
                "status": "success" if integrity["valid"] else "blocked",
                "lesson_run_id": lesson_run_id,
                "counts": counts,
                "issues": integrity["issues"],
            },
            ensure_ascii=False,
        )
    )
    return 0 if integrity["valid"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
