#!/usr/bin/env python3
"""Store one lesson's extracted artifacts into explicit staging tables (PostgreSQL)."""

from __future__ import annotations

import argparse
import json
import os
from collections import Counter
from pathlib import Path
from typing import Any

import psycopg
from psycopg.rows import dict_row

from knowledge_store_common import (
    canonicalize_source_anchor,
    connect_db,
    dump_json_text,
    ensure_dataset,
    ensure_pg_schema,
    load_json_text,
    make_lesson_run_id,
    normalize_textbook_source_id,
    resolve_dataset_id,
    resolve_outline_anchor,
    require_dataset_row,
    utc_now,
)
from embedding_client import embed_texts, DEFAULT_EMBEDDING_URL, DEFAULT_EMBEDDING_MODEL

VALID_CARD_STATUSES = {"draft", "reviewed", "validated"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Store one lesson's extracted runtime artifacts into staging tables."
    )
    parser.add_argument("--root", required=True)
    parser.add_argument("--book-id", required=True)
    parser.add_argument("--batch-anchor", required=True)
    parser.add_argument("--lesson-run-id")
    parser.add_argument("--db", default=os.environ.get("DATABASE_URL"))
    parser.add_argument("--dataset-id")
    parser.add_argument("--nodes-json")
    parser.add_argument("--edges-json")
    parser.add_argument("--profiles-json")
    parser.add_argument("--mentions-json")
    parser.add_argument("--evidence-json")
    parser.add_argument("--node-cards-json")
    parser.add_argument(
        "--input",
        type=Path,
        help="Read all artifacts from a JSON file (keys: nodes, edges, profiles, mentions, evidence, node_cards). "
        "Individual --*-json flags are merged on top and take precedence.",
    )
    parser.add_argument("--append", action="store_true")
    parser.add_argument("--embed", action="store_true", default=True,
                        help="Auto-embed nodes with empty embeddings (default: True)")
    parser.add_argument("--no-embed", action="store_false", dest="embed",
                        help="Skip embedding generation")
    parser.add_argument("--embedding-url", default=DEFAULT_EMBEDDING_URL)
    parser.add_argument("--embedding-model", default=DEFAULT_EMBEDDING_MODEL)
    return parser.parse_args()


def parse_json_array(raw: str | None, label: str) -> list[dict[str, Any]]:
    if not raw:
        return []
    payload = json.loads(raw)
    if not isinstance(payload, list):
        raise SystemExit(f"--{label}-json must be a JSON array.")
    return [item for item in payload if isinstance(item, dict)]


def normalize_nodes(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for index, record in enumerate(records, start=1):
        payload = dict(record)
        raw_node_id = str(payload.get("id") or payload.get("raw_node_id") or f"node-{index}")
        properties = dict(payload.get("properties") or {})
        semantic_key = payload.get("semantic_key") or properties.get("semantic_key")
        embedding = payload.get("embedding") or properties.get("embedding") or []
        normalized.append(
            {
                "raw_node_id": raw_node_id,
                "canonical_name": str(payload.get("canonical_name") or payload.get("name") or raw_node_id),
                "node_kind": str(payload.get("node_kind") or "concept"),
                "node_layer": str(payload.get("node_layer") or "backbone"),
                "node_subkind": payload.get("node_subkind"),
                "definition": str(payload.get("definition") or ""),
                "aliases_json": payload.get("aliases", []),
                "learning_modes_json": payload.get("learning_modes", []),
                "bridge_tags_json": payload.get("bridge_tags", []),
                "framework_refs_json": payload.get("framework_refs", []),
                "profile_refs_json": payload.get("profile_refs", []),
                "same_as_refs_json": payload.get("same_as_refs", []),
                "properties_json": properties,
                "semantic_key": semantic_key,
                "embedding_json": embedding,
                "source_refs_json": payload.get("source_refs", []),
                "status": str(payload.get("status") or "candidate"),
                "notes": payload.get("notes"),
            }
        )
    return normalized


def normalize_edges(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for index, record in enumerate(records, start=1):
        payload = dict(record)
        normalized.append(
            {
                "raw_edge_id": str(payload.get("id") or payload.get("raw_edge_id") or f"edge-{index}"),
                "edge_type": str(payload.get("edge_type") or "related_to"),
                "edge_layer": str(payload.get("edge_layer") or "backbone"),
                "backbone_expand": 1 if payload.get("backbone_expand") else 0,
                "from_raw_node_id": str(payload.get("from") or payload.get("from_raw_node_id") or ""),
                "to_raw_node_id": str(payload.get("to") or payload.get("to_raw_node_id") or ""),
                "directionality": str(payload.get("directionality") or "directed"),
                "confidence": float(payload.get("confidence") or 0.8),
                "framework_refs_json": payload.get("framework_refs", []),
                "profile_refs_json": payload.get("profile_refs", []),
                "source_refs_json": payload.get("source_refs", []),
                "properties_json": payload.get("properties", {}),
                "status": str(payload.get("status") or "candidate"),
            }
        )
    return normalized


def normalize_profiles(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for index, record in enumerate(records, start=1):
        payload = dict(record)
        subject = str(payload.get("subject") or "chemistry")
        school_stage = str(payload.get("school_stage") or "")
        grade_band = str(payload.get("grade_band") or "")
        context_key = str(
            payload.get("context_key") or f"{subject}:{school_stage}:{grade_band}"
        )
        normalized.append(
            {
                "raw_profile_id": str(payload.get("id") or payload.get("raw_profile_id") or f"profile-{index}"),
                "raw_node_id": str(payload.get("node_id") or payload.get("raw_node_id") or ""),
                "subject": subject,
                "school_stage": school_stage,
                "grade_band": grade_band,
                "context_key": context_key,
                "curriculum_role": str(payload.get("curriculum_role") or "introduced"),
                "mastery_level": str(payload.get("mastery_level") or "understand"),
                "framework_refs_json": payload.get("framework_refs", []),
                "textbook_refs_json": payload.get("textbook_refs", []),
                "textbook_ids_json": payload.get("textbook_ids", []),
                "learning_objectives_json": payload.get("learning_objectives", []),
                "assessment_signals_json": payload.get("assessment_signals", []),
                "source_refs_json": payload.get("source_refs", []),
                "properties_json": payload.get("properties", {}),
                "status": str(payload.get("status") or "candidate"),
            }
        )
    return normalized


def normalize_mentions(
    records: list[dict[str, Any]], book_id: str, batch_anchor: str
) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for index, record in enumerate(records, start=1):
        payload = dict(record)
        source_type = str(payload.get("source_type") or "textbook")
        anchor_ref = canonicalize_source_anchor(
            source_type,
            payload.get("source_id"),
            payload.get("anchor_ref") or batch_anchor,
            expected_book_id=book_id,
        )
        source_id = normalize_textbook_source_id(
            source_type,
            payload.get("source_id"),
            anchor_ref,
            expected_book_id=book_id,
        )
        normalized.append(
            {
                "raw_mention_id": str(payload.get("id") or payload.get("raw_mention_id") or f"mention-{index}"),
                "source_type": source_type,
                "source_id": source_id or "",
                "anchor_ref": anchor_ref or batch_anchor,
                "target_type": str(payload.get("target_type") or "node"),
                "target_raw_id": str(payload.get("target_id") or payload.get("target_raw_id") or ""),
                "role": str(payload.get("role") or "focuses_on"),
                "source_refs_json": payload.get("source_refs", []),
                "confidence": float(payload.get("confidence") or 0.95),
                "properties_json": payload.get("properties", {}),
            }
        )
    return normalized


def normalize_evidence(
    records: list[dict[str, Any]], book_id: str, batch_anchor: str
) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for index, record in enumerate(records, start=1):
        payload = dict(record)
        source_type = str(payload.get("source_type") or "textbook")
        anchor_ref = canonicalize_source_anchor(
            source_type,
            payload.get("source_id"),
            payload.get("anchor_ref") or batch_anchor,
            expected_book_id=book_id,
        )
        source_id = normalize_textbook_source_id(
            source_type,
            payload.get("source_id"),
            anchor_ref,
            expected_book_id=book_id,
        )
        normalized.append(
            {
                "raw_evidence_id": str(payload.get("id") or payload.get("raw_evidence_id") or f"evidence-{index}"),
                "source_type": source_type,
                "source_id": source_id or "",
                "anchor_ref": anchor_ref or batch_anchor,
                "source_path": payload.get("source_path"),
                "page_start": payload.get("page_start"),
                "page_end": payload.get("page_end"),
                "excerpt": str(payload.get("excerpt") or ""),
                "locator": str(payload.get("locator") or ""),
                "modality": payload.get("modality") or "text",
                "extraction_method": str(payload.get("extraction_method") or "ocr"),
                "normalized_claims_json": payload.get("normalized_claims", []),
                "properties_json": payload.get("properties", {}),
            }
        )
    return normalized


def normalize_card_content(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item) for item in value if str(item).strip()]
    if value is None:
        return []
    text = str(value).strip()
    return [text] if text else []


def normalize_card_status(value: Any) -> str:
    status = str(value or "").strip()
    if status in VALID_CARD_STATUSES:
        return status
    if status in {"candidate", "active"}:
        return "draft"
    return "draft"


def normalize_section_id(value: Any, fallback: str = "section") -> str:
    token = str(value or fallback).strip().lower().replace("_", "-")
    token = "".join(ch if ch.isalnum() or ch == "-" else "-" for ch in token)
    token = "-".join(part for part in token.split("-") if part)
    return token or fallback


def normalize_node_cards(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    normalized: list[dict[str, Any]] = []
    for index, record in enumerate(records, start=1):
        payload = dict(record)
        raw_card_id = str(payload.get("id") or payload.get("raw_card_id") or f"card-{index}")
        raw_node_id = str(payload.get("node_id") or payload.get("raw_node_id") or "")
        sections = payload.get("sections", [])
        if isinstance(sections, dict):
            sections = [
                {
                    "id": normalize_section_id(section_id),
                    "title": section_id,
                    "section_type": section_id,
                    "content": normalize_card_content(section_value.get("content", ""))
                    if isinstance(section_value, dict)
                    else normalize_card_content(section_value),
                    "source_refs": section_value.get("source_refs", [])
                    if isinstance(section_value, dict)
                    else [],
                }
                for section_id, section_value in sections.items()
            ]
        elif isinstance(sections, list):
            sections = [
                {
                    **section,
                    "id": normalize_section_id(section.get("id"), f"section-{section_index}"),
                    "content": normalize_card_content(section.get("content")),
                }
                for section_index, section in enumerate(sections, start=1)
                if isinstance(section, dict)
            ]
        normalized.append(
            {
                "raw_card_id": raw_card_id,
                "raw_node_id": raw_node_id,
                "card_layer": str(payload.get("card_layer") or "backbone"),
                "title": str(payload.get("title") or ""),
                "summary": str(payload.get("summary") or ""),
                "pattern_refs_json": payload.get("pattern_refs", []),
                "framework_refs_json": payload.get("framework_refs", []),
                "profile_refs_json": payload.get("profile_refs", []),
                "mention_refs_json": payload.get("mention_refs", []),
                "source_refs_json": payload.get("source_refs", []),
                "sections_json": sections,
                "properties_json": payload.get("properties", {}),
                "status": normalize_card_status(payload.get("status")),
            }
        )
    return normalized


def replace_table_rows(
    connection,
    table_name: str,
    dataset_id: str,
    lesson_run_id: str,
) -> None:
    with connection.cursor() as cur:
        cur.execute(
            f"DELETE FROM {table_name} WHERE dataset_id = %s AND lesson_run_id = %s",
            (dataset_id, lesson_run_id),
        )


def auto_embed_nodes(
    nodes: list[dict[str, Any]],
    *,
    url: str,
    model: str,
) -> list[dict[str, Any]]:
    """Backfill empty embeddings by calling the embedding API."""
    texts_to_embed: list[tuple[int, str]] = []
    for index, node in enumerate(nodes):
        embedding = node.get("embedding_json", [])
        if embedding:
            continue
        parts = [node.get("canonical_name", "")]
        if node.get("definition"):
            parts.append(node["definition"])
        aliases = node.get("aliases_json", [])
        if aliases:
            parts.extend(str(a) for a in aliases if a)
        text = " ".join(p for p in parts if p.strip())
        if text.strip():
            texts_to_embed.append((index, text))

    if not texts_to_embed:
        return nodes

    embeddings = embed_texts(
        [text for _, text in texts_to_embed],
        url=url,
        model=model,
    )
    for (index, _), embedding in zip(texts_to_embed, embeddings):
        if embedding:
            nodes[index]["embedding_json"] = embedding

    return nodes


def main() -> int:
    args = parse_args()
    root = Path(args.root).expanduser().resolve()
    batch_anchor = resolve_outline_anchor(args.book_id, args.batch_anchor, strict=True)

    connection = connect_db(args.db)
    ensure_pg_schema(connection)
    dataset_id = resolve_dataset_id(connection, args.dataset_id, root)
    ensure_dataset(connection, dataset_id, root)
    require_dataset_row(connection, dataset_id)

    lesson_run_id = args.lesson_run_id or make_lesson_run_id(args.book_id, batch_anchor)
    now = utc_now()

    # Load from --input file first (if provided), then overlay individual flags
    file_data: dict[str, Any] = {}
    if args.input:
        input_path = Path(args.input).expanduser().resolve()
        if not input_path.exists():
            raise SystemExit(f"--input file not found: {input_path}")
        with open(input_path, encoding="utf-8") as f:
            file_data = json.load(f)
        if not isinstance(file_data, dict):
            raise SystemExit("--input file must contain a JSON object")

    def merge_artifact(key: str, raw_flag: str | None, label: str) -> list[dict[str, Any]]:
        """Combine file-based and flag-based artifact arrays; flag takes precedence."""
        from_flag = parse_json_array(raw_flag, label)
        if from_flag:
            return from_flag
        return file_data.get(key, []) if isinstance(file_data.get(key), list) else []

    nodes = normalize_nodes(merge_artifact("nodes", args.nodes_json, "nodes"))
    if args.embed:
        nodes = auto_embed_nodes(nodes, url=args.embedding_url, model=args.embedding_model)
    edges = normalize_edges(merge_artifact("edges", args.edges_json, "edges"))
    profiles = normalize_profiles(merge_artifact("profiles", args.profiles_json, "profiles"))
    mentions = normalize_mentions(
        merge_artifact("mentions", args.mentions_json, "mentions"), args.book_id, batch_anchor
    )
    evidence = normalize_evidence(
        merge_artifact("evidence", args.evidence_json, "evidence"), args.book_id, batch_anchor
    )
    node_cards = normalize_node_cards(merge_artifact("node_cards", args.node_cards_json, "node-cards"))

    stats = Counter(
        {
            "nodes": len(nodes),
            "edges": len(edges),
            "profiles": len(profiles),
            "mentions": len(mentions),
            "evidence": len(evidence),
            "node_cards": len(node_cards),
        }
    )

    with connection:
        with connection.cursor() as cur:
            cur.execute(
                """
                INSERT INTO lesson_runs (
                  dataset_id,
                  lesson_run_id,
                  book_id,
                  batch_anchor,
                  status,
                  counts_json,
                  properties_json,
                  created_at,
                  updated_at
                ) VALUES (%s, %s, %s, %s, 'staged', %s, %s, %s, %s)
                ON CONFLICT (dataset_id, lesson_run_id) DO UPDATE SET
                  book_id = EXCLUDED.book_id,
                  batch_anchor = EXCLUDED.batch_anchor,
                  status = EXCLUDED.status,
                  counts_json = EXCLUDED.counts_json,
                  properties_json = EXCLUDED.properties_json,
                  updated_at = EXCLUDED.updated_at
                """,
                (
                    dataset_id,
                    lesson_run_id,
                    args.book_id,
                    batch_anchor,
                    dict(stats),
                    {},
                    now,
                    now,
                ),
            )

        if not args.append:
            for table_name in (
                "staging_nodes",
                "staging_edges",
                "staging_profiles",
                "staging_mentions",
                "staging_evidence",
                "staging_node_cards",
            ):
                replace_table_rows(connection, table_name, dataset_id, lesson_run_id)

        if nodes:
            with connection.cursor() as cur:
                psycopg.extras.execute_values(
                    cur,
                    """
                    INSERT INTO staging_nodes (
                      dataset_id, lesson_run_id, raw_node_id, book_id, batch_anchor,
                      canonical_name, node_kind, node_layer, node_subkind, definition,
                      aliases_json, learning_modes_json, bridge_tags_json, framework_refs_json,
                      profile_refs_json, same_as_refs_json, properties_json, semantic_key,
                      embedding_json, source_refs_json, status, created_at, updated_at, notes
                    ) VALUES %s
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
                      embedding_json = EXCLUDED.embedding_json,
                      source_refs_json = EXCLUDED.source_refs_json,
                      status = EXCLUDED.status,
                      updated_at = EXCLUDED.updated_at,
                      notes = EXCLUDED.notes
                    """,
                    [
                        (
                            dataset_id,
                            lesson_run_id,
                            record["raw_node_id"],
                            args.book_id,
                            batch_anchor,
                            record["canonical_name"],
                            record["node_kind"],
                            record["node_layer"],
                            record["node_subkind"],
                            record["definition"],
                            json.dumps(record["aliases_json"]),
                            json.dumps(record["learning_modes_json"]),
                            json.dumps(record["bridge_tags_json"]),
                            json.dumps(record["framework_refs_json"]),
                            json.dumps(record["profile_refs_json"]),
                            json.dumps(record["same_as_refs_json"]),
                            json.dumps(record["properties_json"]),
                            record["semantic_key"],
                            json.dumps(record["embedding_json"]),
                            json.dumps(record["source_refs_json"]),
                            record["status"],
                            now,
                            now,
                            record["notes"],
                        )
                        for record in nodes
                    ],
                )

        if edges:
            with connection.cursor() as cur:
                psycopg.extras.execute_values(
                    cur,
                    """
                    INSERT INTO staging_edges (
                      dataset_id, lesson_run_id, raw_edge_id, book_id, batch_anchor,
                      edge_type, edge_layer, backbone_expand, from_raw_node_id, to_raw_node_id,
                      directionality, confidence, framework_refs_json, profile_refs_json,
                      source_refs_json, properties_json, status, created_at, updated_at
                    ) VALUES %s
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
                    """,
                    [
                        (
                            dataset_id,
                            lesson_run_id,
                            record["raw_edge_id"],
                            args.book_id,
                            batch_anchor,
                            record["edge_type"],
                            record["edge_layer"],
                            record["backbone_expand"],
                            record["from_raw_node_id"],
                            record["to_raw_node_id"],
                            record["directionality"],
                            record["confidence"],
                            json.dumps(record["framework_refs_json"]),
                            json.dumps(record["profile_refs_json"]),
                            json.dumps(record["source_refs_json"]),
                            json.dumps(record["properties_json"]),
                            record["status"],
                            now,
                            now,
                        )
                        for record in edges
                    ],
                )

        if profiles:
            with connection.cursor() as cur:
                psycopg.extras.execute_values(
                    cur,
                    """
                    INSERT INTO staging_profiles (
                      dataset_id, lesson_run_id, raw_profile_id, raw_node_id, subject,
                      school_stage, grade_band, context_key, curriculum_role, mastery_level,
                      framework_refs_json, textbook_refs_json, textbook_ids_json,
                      learning_objectives_json, assessment_signals_json, source_refs_json,
                      properties_json, status, created_at, updated_at
                    ) VALUES %s
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
                    """,
                    [
                        (
                            dataset_id,
                            lesson_run_id,
                            record["raw_profile_id"],
                            record["raw_node_id"],
                            record["subject"],
                            record["school_stage"],
                            record["grade_band"],
                            record["context_key"],
                            record["curriculum_role"],
                            record["mastery_level"],
                            json.dumps(record["framework_refs_json"]),
                            json.dumps(record["textbook_refs_json"]),
                            json.dumps(record["textbook_ids_json"]),
                            json.dumps(record["learning_objectives_json"]),
                            json.dumps(record["assessment_signals_json"]),
                            json.dumps(record["source_refs_json"]),
                            json.dumps(record["properties_json"]),
                            record["status"],
                            now,
                            now,
                        )
                        for record in profiles
                    ],
                )

        if mentions:
            with connection.cursor() as cur:
                psycopg.extras.execute_values(
                    cur,
                    """
                    INSERT INTO staging_mentions (
                      dataset_id, lesson_run_id, raw_mention_id, source_type, source_id,
                      anchor_ref, target_type, target_raw_id, role, source_refs_json,
                      confidence, properties_json, created_at, updated_at
                    ) VALUES %s
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
                    """,
                    [
                        (
                            dataset_id,
                            lesson_run_id,
                            record["raw_mention_id"],
                            record["source_type"],
                            record["source_id"],
                            record["anchor_ref"],
                            record["target_type"],
                            record["target_raw_id"],
                            record["role"],
                            json.dumps(record["source_refs_json"]),
                            record["confidence"],
                            json.dumps(record["properties_json"]),
                            now,
                            now,
                        )
                        for record in mentions
                    ],
                )

        if evidence:
            with connection.cursor() as cur:
                psycopg.extras.execute_values(
                    cur,
                    """
                    INSERT INTO staging_evidence (
                      dataset_id, lesson_run_id, raw_evidence_id, source_type, source_id,
                      anchor_ref, source_path, page_start, page_end, excerpt, locator,
                      modality, extraction_method, normalized_claims_json, properties_json,
                      created_at, updated_at
                    ) VALUES %s
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
                    """,
                    [
                        (
                            dataset_id,
                            lesson_run_id,
                            record["raw_evidence_id"],
                            record["source_type"],
                            record["source_id"],
                            record["anchor_ref"],
                            record["source_path"],
                            record["page_start"],
                            record["page_end"],
                            record["excerpt"],
                            record["locator"],
                            record["modality"],
                            record["extraction_method"],
                            json.dumps(record["normalized_claims_json"]),
                            json.dumps(record["properties_json"]),
                            now,
                            now,
                        )
                        for record in evidence
                    ],
                )

        if node_cards:
            with connection.cursor() as cur:
                psycopg.extras.execute_values(
                    cur,
                    """
                    INSERT INTO staging_node_cards (
                      dataset_id, lesson_run_id, raw_card_id, raw_node_id, card_layer,
                      title, summary, pattern_refs_json, framework_refs_json, profile_refs_json,
                      mention_refs_json, source_refs_json, sections_json, properties_json,
                      status, created_at, updated_at
                    ) VALUES %s
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
                    """,
                    [
                        (
                            dataset_id,
                            lesson_run_id,
                            record["raw_card_id"],
                            record["raw_node_id"],
                            record["card_layer"],
                            record["title"],
                            record["summary"],
                            json.dumps(record["pattern_refs_json"]),
                            json.dumps(record["framework_refs_json"]),
                            json.dumps(record["profile_refs_json"]),
                            json.dumps(record["mention_refs_json"]),
                            json.dumps(record["source_refs_json"]),
                            json.dumps(record["sections_json"]),
                            json.dumps(record["properties_json"]),
                            record["status"],
                            now,
                            now,
                        )
                        for record in node_cards
                    ],
                )

        with connection.cursor() as cur:
            cur.execute(
                """
                UPDATE lesson_runs
                SET status = 'staged', counts_json = %s, updated_at = %s
                WHERE dataset_id = %s AND lesson_run_id = %s
                """,
                (dict(stats), now, dataset_id, lesson_run_id),
            )

    connection.commit()

    print(
        dump_json_text(
            {
                "lesson_run_id": lesson_run_id,
                "dataset_id": dataset_id,
                "book_id": args.book_id,
                "batch_anchor": batch_anchor,
                "stats": dict(stats),
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
