#!/usr/bin/env python3
"""Merge staged lesson artifacts into the canonical SQLite knowledge graph."""

from __future__ import annotations

import argparse
import json
import sqlite3
from collections import Counter, defaultdict
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

from knowledge_store_common import (
    DEFAULT_DB_PATH,
    connect_db,
    cosine_similarity,
    dump_json_text,
    ensure_dataset,
    ensure_sqlite_schema,
    load_json_text,
    make_canonical_node_id,
    make_edge_id,
    make_evidence_id,
    make_lesson_run_id,
    make_merge_run_id,
    make_mention_id,
    make_profile_id,
    merge_json_objects,
    merge_text_blocks,
    merge_unique_strings,
    normalize_term,
    rebuild_node_terms,
    resolve_dataset_id,
    resolve_outline_anchor,
    require_dataset_row,
    safe_path_token,
    utc_now,
)


@dataclass
class CanonicalNode:
    payload: dict[str, Any]
    name_terms: set[str]
    semantic_key: str | None
    embedding: list[float]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Merge staged lesson artifacts into canonical nodes, edges, profiles, evidence, mentions, and node cards."
    )
    parser.add_argument("--root", required=True)
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH))
    parser.add_argument("--dataset-id")
    parser.add_argument("--book-id")
    parser.add_argument("--batch-anchor", action="append", dest="batch_anchors")
    parser.add_argument("--lesson-run-id", action="append", dest="lesson_run_ids")
    parser.add_argument("--similarity-threshold", type=float, default=0.9)
    parser.add_argument("--embedding-threshold", type=float, default=0.92)
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def parse_embedding(value: str | None) -> list[float]:
    payload = load_json_text(value, [])
    if not isinstance(payload, list):
        return []
    result: list[float] = []
    for item in payload:
        try:
            result.append(float(item))
        except (TypeError, ValueError):
            return []
    return result


def parse_rows(rows: list[sqlite3.Row], json_fields: dict[str, str]) -> list[dict[str, Any]]:
    parsed: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        for source_field, target_field in json_fields.items():
            default_value: Any = {} if source_field == "properties_json" else []
            item[target_field] = load_json_text(item.get(source_field), default_value)
        parsed.append(item)
    return parsed


def normalized_name_terms(payload: dict[str, Any]) -> set[str]:
    terms = {
        normalize_term(payload.get("canonical_name", "")),
        *(
            normalize_term(alias)
            for alias in payload.get("aliases", [])
            if isinstance(alias, str)
        ),
    }
    return {term for term in terms if term}


def pick_primary_name(current: str, candidate: str) -> str:
    current_clean = current.strip()
    candidate_clean = candidate.strip()
    if not current_clean:
        return candidate_clean
    if not candidate_clean:
        return current_clean
    if len(candidate_clean) > len(current_clean):
        return candidate_clean
    return current_clean


def lexical_similarity(left_terms: set[str], right_terms: set[str]) -> float:
    if not left_terms or not right_terms:
        return 0.0
    best = 0.0
    for left in left_terms:
        for right in right_terms:
            if left == right:
                return 1.0
            if left in right or right in left:
                best = max(best, 0.96)
            best = max(best, SequenceMatcher(a=left, b=right).ratio())
    return best


def score_node_match(
    staged: dict[str, Any],
    staged_terms: set[str],
    staged_semantic_key: str | None,
    staged_embedding: list[float],
    candidate: CanonicalNode,
) -> float:
    payload = candidate.payload
    if payload["node_kind"] != staged["node_kind"]:
        return 0.0
    if payload.get("node_subkind") and staged.get("node_subkind"):
        if payload["node_subkind"] != staged["node_subkind"]:
            return 0.0

    lexical = lexical_similarity(staged_terms, candidate.name_terms)
    semantic = 1.0 if staged_semantic_key and staged_semantic_key == candidate.semantic_key else 0.0
    embedding = 0.0
    if staged_embedding and candidate.embedding:
        embedding = cosine_similarity(staged_embedding, candidate.embedding)

    score = max(lexical, semantic, embedding)
    if payload.get("node_layer") == staged.get("node_layer"):
        score += 0.02
    if staged.get("definition") and payload.get("definition"):
        definition_overlap = SequenceMatcher(
            a=normalize_term(staged["definition"]),
            b=normalize_term(payload["definition"]),
        ).ratio()
        score = max(score, min(0.9, definition_overlap))
    return min(score, 1.0)


def merge_node_payload(existing: dict[str, Any], staged: dict[str, Any]) -> dict[str, Any]:
    merged = dict(existing)
    merged["canonical_name"] = pick_primary_name(
        existing.get("canonical_name", ""), staged.get("canonical_name", "")
    )
    merged["definition"] = merge_text_blocks(
        existing.get("definition", ""), staged.get("definition", "")
    )
    merged["aliases"] = merge_unique_strings(
        existing.get("aliases", []),
        staged.get("aliases", []),
        [existing.get("canonical_name", ""), staged.get("canonical_name", "")],
    )
    merged["learning_modes"] = merge_unique_strings(
        existing.get("learning_modes", []), staged.get("learning_modes", [])
    )
    merged["bridge_tags"] = merge_unique_strings(
        existing.get("bridge_tags", []), staged.get("bridge_tags", [])
    )
    merged["framework_refs"] = merge_unique_strings(
        existing.get("framework_refs", []), staged.get("framework_refs", [])
    )
    merged["profile_refs"] = merge_unique_strings(
        existing.get("profile_refs", []), staged.get("profile_refs", [])
    )
    merged["same_as_refs"] = merge_unique_strings(
        existing.get("same_as_refs", []),
        staged.get("same_as_refs", []),
        [staged.get("raw_node_ref", "")],
    )
    merged["properties"] = merge_json_objects(
        existing.get("properties", {}), staged.get("properties", {})
    )
    if staged.get("semantic_key"):
        merged["properties"]["semantic_key"] = staged["semantic_key"]
    if staged.get("embedding"):
        merged["properties"]["embedding"] = staged["embedding"]
    merged["notes"] = merge_text_blocks(existing.get("notes", ""), staged.get("notes", ""))
    merged["status"] = existing.get("status") or staged.get("status") or "active"
    return merged


def merge_profile_payload(existing: dict[str, Any], staged: dict[str, Any]) -> dict[str, Any]:
    merged = dict(existing)
    merged["framework_refs"] = merge_unique_strings(existing.get("framework_refs", []), staged.get("framework_refs", []))
    merged["textbook_refs"] = merge_unique_strings(existing.get("textbook_refs", []), staged.get("textbook_refs", []))
    merged["textbook_ids"] = merge_unique_strings(existing.get("textbook_ids", []), staged.get("textbook_ids", []))
    merged["learning_objectives"] = merge_unique_strings(existing.get("learning_objectives", []), staged.get("learning_objectives", []))
    merged["assessment_signals"] = merge_unique_strings(existing.get("assessment_signals", []), staged.get("assessment_signals", []))
    merged["source_refs"] = merge_unique_strings(existing.get("source_refs", []), staged.get("source_refs", []))
    merged["properties"] = merge_json_objects(existing.get("properties", {}), staged.get("properties", {}))
    return merged


def merge_card_payload(existing: dict[str, Any], staged: dict[str, Any], title: str) -> dict[str, Any]:
    merged = dict(existing)
    merged["title"] = title
    merged["summary"] = merge_text_blocks(existing.get("summary", ""), staged.get("summary", ""))
    merged["pattern_refs"] = merge_unique_strings(existing.get("pattern_refs", []), staged.get("pattern_refs", []))
    merged["framework_refs"] = merge_unique_strings(existing.get("framework_refs", []), staged.get("framework_refs", []))
    merged["profile_refs"] = merge_unique_strings(existing.get("profile_refs", []), staged.get("profile_refs", []))
    merged["mention_refs"] = merge_unique_strings(existing.get("mention_refs", []), staged.get("mention_refs", []))
    merged["source_refs"] = merge_unique_strings(existing.get("source_refs", []), staged.get("source_refs", []))
    merged["properties"] = merge_json_objects(existing.get("properties", {}), staged.get("properties", {}))
    sections_by_key: dict[str, dict[str, Any]] = {}
    for section in existing.get("sections", []) + staged.get("sections", []):
        if not isinstance(section, dict):
            continue
        key = str(section.get("section_type") or section.get("id") or "content")
        current = sections_by_key.setdefault(
            key,
            {
                "id": str(section.get("id") or key),
                "title": str(section.get("title") or key),
                "section_type": key,
                "content": "",
                "source_refs": [],
            },
        )
        current["content"] = merge_text_blocks(current.get("content", ""), str(section.get("content") or ""))
        current["source_refs"] = merge_unique_strings(current.get("source_refs", []), section.get("source_refs", []))
    merged["sections"] = list(sections_by_key.values())
    return merged


def ensure_source_artifacts(connection: sqlite3.Connection, dataset_id: str, evidence_rows: list[dict[str, Any]]) -> None:
    seen: set[tuple[str, str]] = set()
    for record in evidence_rows:
        key = (record["source_type"], record["source_id"])
        if key in seen:
            continue
        seen.add(key)
        connection.execute(
            """
            INSERT OR IGNORE INTO source_artifacts (
              dataset_id,
              source_id,
              source_type,
              book_id,
              title,
              file_path,
              outline_path,
              properties_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                dataset_id,
                record["source_id"],
                record["source_type"],
                record["source_id"] if record["source_type"] == "textbook" else None,
                None,
                record.get("source_path"),
                None,
                "{}",
            ),
        )


def upsert_evidence_links(
    connection: sqlite3.Connection,
    dataset_id: str,
    owner_type: str,
    owner_id: str,
    evidence_ids: list[str],
) -> None:
    connection.execute(
        """
        DELETE FROM evidence_links
        WHERE dataset_id = ? AND owner_type = ? AND owner_id = ?
        """,
        (dataset_id, owner_type, owner_id),
    )
    if not evidence_ids:
        return
    connection.executemany(
        """
        INSERT OR REPLACE INTO evidence_links (
          dataset_id,
          owner_type,
          owner_id,
          evidence_id,
          ordinal
        ) VALUES (?, ?, ?, ?, ?)
        """,
        [
            (dataset_id, owner_type, owner_id, evidence_id, index)
            for index, evidence_id in enumerate(evidence_ids, start=1)
        ],
    )


def load_selected_lesson_runs(connection: sqlite3.Connection, args: argparse.Namespace, dataset_id: str) -> list[sqlite3.Row]:
    params: list[Any] = [dataset_id]
    filters = ["dataset_id = ?"]

    explicit_run_ids = args.lesson_run_ids or []
    explicit_anchors = [
        resolve_outline_anchor(args.book_id, anchor, strict=False)
        if args.book_id
        else anchor
        for anchor in (args.batch_anchors or [])
    ]

    if explicit_run_ids:
        placeholders = ",".join(["?"] * len(explicit_run_ids))
        filters.append(f"lesson_run_id IN ({placeholders})")
        params.extend(explicit_run_ids)
    if args.book_id:
        filters.append("book_id = ?")
        params.append(args.book_id)
    if explicit_anchors:
        placeholders = ",".join(["?"] * len(explicit_anchors))
        filters.append(f"batch_anchor IN ({placeholders})")
        params.extend(explicit_anchors)
    if not explicit_run_ids and not explicit_anchors:
        filters.append("status = 'staged'")

    sql = f"""
        SELECT *
        FROM lesson_runs
        WHERE {' AND '.join(filters)}
        ORDER BY book_id, batch_anchor, lesson_run_id
    """
    return connection.execute(sql, params).fetchall()


def main() -> int:
    args = parse_args()
    root = Path(args.root).expanduser().resolve()
    connection = connect_db(args.db)
    ensure_sqlite_schema(connection)
    dataset_id = resolve_dataset_id(connection, args.dataset_id, root)
    ensure_dataset(connection, dataset_id, root)
    require_dataset_row(connection, dataset_id)

    selected_runs = load_selected_lesson_runs(connection, args, dataset_id)
    if not selected_runs:
        raise SystemExit("No staged lesson runs matched the selection.")

    lesson_run_ids = [row["lesson_run_id"] for row in selected_runs]
    merge_run_id = make_merge_run_id(dataset_id, lesson_run_ids)
    now = utc_now()

    placeholders = ",".join(["?"] * len(lesson_run_ids))
    lesson_params = [dataset_id, *lesson_run_ids]

    staging_nodes = parse_rows(
        connection.execute(
            f"""
            SELECT *
            FROM staging_nodes
            WHERE dataset_id = ? AND lesson_run_id IN ({placeholders})
            ORDER BY lesson_run_id, raw_node_id
            """,
            lesson_params,
        ).fetchall(),
        {
            "aliases_json": "aliases",
            "learning_modes_json": "learning_modes",
            "bridge_tags_json": "bridge_tags",
            "framework_refs_json": "framework_refs",
            "profile_refs_json": "profile_refs",
            "same_as_refs_json": "same_as_refs",
            "properties_json": "properties",
            "embedding_json": "embedding",
            "source_refs_json": "source_refs",
        },
    )

    staging_edges = parse_rows(
        connection.execute(
            f"""
            SELECT *
            FROM staging_edges
            WHERE dataset_id = ? AND lesson_run_id IN ({placeholders})
            ORDER BY lesson_run_id, raw_edge_id
            """,
            lesson_params,
        ).fetchall(),
        {
            "framework_refs_json": "framework_refs",
            "profile_refs_json": "profile_refs",
            "source_refs_json": "source_refs",
            "properties_json": "properties",
        },
    )

    staging_profiles = parse_rows(
        connection.execute(
            f"""
            SELECT *
            FROM staging_profiles
            WHERE dataset_id = ? AND lesson_run_id IN ({placeholders})
            ORDER BY lesson_run_id, raw_profile_id
            """,
            lesson_params,
        ).fetchall(),
        {
            "framework_refs_json": "framework_refs",
            "textbook_refs_json": "textbook_refs",
            "textbook_ids_json": "textbook_ids",
            "learning_objectives_json": "learning_objectives",
            "assessment_signals_json": "assessment_signals",
            "source_refs_json": "source_refs",
            "properties_json": "properties",
        },
    )

    staging_mentions = parse_rows(
        connection.execute(
            f"""
            SELECT *
            FROM staging_mentions
            WHERE dataset_id = ? AND lesson_run_id IN ({placeholders})
            ORDER BY lesson_run_id, raw_mention_id
            """,
            lesson_params,
        ).fetchall(),
        {
            "source_refs_json": "source_refs",
            "properties_json": "properties",
        },
    )

    staging_evidence = parse_rows(
        connection.execute(
            f"""
            SELECT *
            FROM staging_evidence
            WHERE dataset_id = ? AND lesson_run_id IN ({placeholders})
            ORDER BY lesson_run_id, raw_evidence_id
            """,
            lesson_params,
        ).fetchall(),
        {
            "normalized_claims_json": "normalized_claims",
            "properties_json": "properties",
        },
    )

    staging_cards = parse_rows(
        connection.execute(
            f"""
            SELECT *
            FROM staging_node_cards
            WHERE dataset_id = ? AND lesson_run_id IN ({placeholders})
            ORDER BY lesson_run_id, raw_card_id
            """,
            lesson_params,
        ).fetchall(),
        {
            "pattern_refs_json": "pattern_refs",
            "framework_refs_json": "framework_refs",
            "profile_refs_json": "profile_refs",
            "mention_refs_json": "mention_refs",
            "source_refs_json": "source_refs",
            "sections_json": "sections",
            "properties_json": "properties",
        },
    )

    existing_nodes: dict[str, CanonicalNode] = {}
    exact_term_index: defaultdict[str, set[str]] = defaultdict(set)
    semantic_key_index: defaultdict[str, set[str]] = defaultdict(set)

    for row in parse_rows(
        connection.execute(
            """
            SELECT *
            FROM nodes
            WHERE dataset_id = ? AND status != 'deprecated'
            ORDER BY id
            """,
            (dataset_id,),
        ).fetchall(),
        {
            "aliases_json": "aliases",
            "learning_modes_json": "learning_modes",
            "bridge_tags_json": "bridge_tags",
            "framework_refs_json": "framework_refs",
            "profile_refs_json": "profile_refs",
            "same_as_refs_json": "same_as_refs",
            "properties_json": "properties",
        },
    ):
        semantic_key = row.get("properties", {}).get("semantic_key")
        embedding = row.get("properties", {}).get("embedding", [])
        canonical = CanonicalNode(
            payload=row,
            name_terms=normalized_name_terms(row),
            semantic_key=semantic_key,
            embedding=embedding if isinstance(embedding, list) else [],
        )
        existing_nodes[row["id"]] = canonical
        for term in canonical.name_terms:
            exact_term_index[term].add(row["id"])
        if semantic_key:
            semantic_key_index[str(semantic_key)].add(row["id"])

    existing_edges = {
        (row["from_id"], row["edge_type"], row["to_id"]): dict(row)
        for row in connection.execute(
            """
            SELECT *
            FROM edges
            WHERE dataset_id = ? AND status != 'deprecated'
            """,
            (dataset_id,),
        ).fetchall()
    }
    existing_profiles = {
        (row["node_id"], row["context_key"]): dict(row)
        for row in connection.execute(
            """
            SELECT *
            FROM profiles
            WHERE dataset_id = ? AND status != 'deprecated'
            """,
            (dataset_id,),
        ).fetchall()
    }
    existing_cards = {
        row["node_id"]: dict(row)
        for row in connection.execute(
            """
            SELECT *
            FROM node_cards
            WHERE dataset_id = ?
            """,
            (dataset_id,),
        ).fetchall()
    }

    stats = Counter(
        {
            "lesson_runs": len(lesson_run_ids),
            "staged_nodes": len(staging_nodes),
            "staged_edges": len(staging_edges),
            "staged_profiles": len(staging_profiles),
            "staged_mentions": len(staging_mentions),
            "staged_evidence": len(staging_evidence),
            "staged_cards": len(staging_cards),
        }
    )

    node_map: dict[tuple[str, str], str] = {}
    canonical_map_rows: list[tuple[str, str, str, str, str, str, float, str, str]] = []

    for staged in staging_nodes:
        staged["raw_node_ref"] = f"{staged['lesson_run_id']}:{staged['raw_node_id']}"
        staged_terms = normalized_name_terms(staged)
        staged_semantic_key = staged.get("semantic_key")
        staged_embedding = staged.get("embedding") if isinstance(staged.get("embedding"), list) else []
        candidate_ids = set()
        for term in staged_terms:
            candidate_ids.update(exact_term_index.get(term, set()))
        if staged_semantic_key:
            candidate_ids.update(semantic_key_index.get(str(staged_semantic_key), set()))
        if not candidate_ids:
            candidate_ids.update(
                node_id
                for node_id, candidate in existing_nodes.items()
                if candidate.payload["node_kind"] == staged["node_kind"]
            )

        best_id: str | None = None
        best_score = 0.0
        for candidate_id in candidate_ids:
            score = score_node_match(
                staged,
                staged_terms,
                staged_semantic_key,
                staged_embedding,
                existing_nodes[candidate_id],
            )
            if score > best_score:
                best_score = score
                best_id = candidate_id

        if best_id and (
            best_score >= args.similarity_threshold
            or best_score >= args.embedding_threshold
        ):
            canonical_id = best_id
            resolution = "matched"
            stats["matched_nodes"] += 1
            existing_nodes[canonical_id].payload = merge_node_payload(
                existing_nodes[canonical_id].payload,
                staged,
            )
            existing_nodes[canonical_id].name_terms = normalized_name_terms(
                existing_nodes[canonical_id].payload
            )
            existing_nodes[canonical_id].semantic_key = (
                existing_nodes[canonical_id].payload.get("properties", {}).get("semantic_key")
            )
            existing_nodes[canonical_id].embedding = (
                existing_nodes[canonical_id].payload.get("properties", {}).get("embedding", [])
            )
        else:
            canonical_id = make_canonical_node_id(
                staged["node_kind"], staged["canonical_name"], staged.get("node_subkind")
            )
            resolution = "created"
            stats["created_nodes"] += 1
            if canonical_id in existing_nodes:
                existing_nodes[canonical_id].payload = merge_node_payload(
                    existing_nodes[canonical_id].payload,
                    staged,
                )
            else:
                payload = {
                    "dataset_id": dataset_id,
                    "id": canonical_id,
                    "canonical_name": staged["canonical_name"],
                    "node_kind": staged["node_kind"],
                    "node_layer": staged["node_layer"],
                    "node_subkind": staged.get("node_subkind"),
                    "definition": staged.get("definition", ""),
                    "aliases": staged.get("aliases", []),
                    "learning_modes": staged.get("learning_modes", []),
                    "bridge_tags": staged.get("bridge_tags", []),
                    "framework_refs": staged.get("framework_refs", []),
                    "profile_refs": staged.get("profile_refs", []),
                    "card_ref": f"node-card:{canonical_id}",
                    "same_as_refs": merge_unique_strings(
                        staged.get("same_as_refs", []), [staged["raw_node_ref"]]
                    ),
                    "properties": merge_json_objects(
                        dict(staged.get("properties", {})),
                        {
                            "semantic_key": staged_semantic_key,
                            "embedding": staged_embedding,
                        },
                    ),
                    "status": staged.get("status") or "active",
                    "deprecated_by": None,
                    "created_at": now,
                    "updated_at": now,
                    "notes": staged.get("notes") or "",
                }
                existing_nodes[canonical_id] = CanonicalNode(
                    payload=payload,
                    name_terms=staged_terms,
                    semantic_key=staged_semantic_key,
                    embedding=staged_embedding,
                )

        for term in existing_nodes[canonical_id].name_terms:
            exact_term_index[term].add(canonical_id)
        if existing_nodes[canonical_id].semantic_key:
            semantic_key_index[str(existing_nodes[canonical_id].semantic_key)].add(canonical_id)

        node_map[(staged["lesson_run_id"], staged["raw_node_id"])] = canonical_id
        canonical_map_rows.append(
            (
                dataset_id,
                merge_run_id,
                staged["lesson_run_id"],
                staged["raw_node_id"],
                canonical_id,
                resolution,
                round(best_score, 4),
                dump_json_text(
                    {
                        "semantic_key": staged_semantic_key,
                        "matched_terms": sorted(staged_terms),
                    }
                ),
                now,
            )
        )

    evidence_id_map: dict[tuple[str, str], str] = {}
    canonical_evidence_rows: dict[str, dict[str, Any]] = {}
    for record in staging_evidence:
        evidence_id = make_evidence_id(
            record["lesson_run_id"],
            record["raw_evidence_id"],
            record["anchor_ref"],
            record["excerpt"],
        )
        evidence_id_map[(record["lesson_run_id"], record["raw_evidence_id"])] = evidence_id
        canonical_evidence_rows[evidence_id] = {
            "dataset_id": dataset_id,
            "id": evidence_id,
            "source_type": record["source_type"],
            "source_id": record["source_id"],
            "anchor_ref": record["anchor_ref"],
            "source_path": record.get("source_path"),
            "page_start": record.get("page_start"),
            "page_end": record.get("page_end"),
            "excerpt": record["excerpt"],
            "locator": record["locator"],
            "modality": record.get("modality"),
            "extraction_method": record["extraction_method"],
            "normalized_claims": record.get("normalized_claims", []),
            "properties": merge_json_objects(
                record.get("properties", {}),
                {
                    "lesson_run_id": record["lesson_run_id"],
                    "raw_evidence_id": record["raw_evidence_id"],
                },
            ),
        }

    profile_refs_by_node: defaultdict[str, set[str]] = defaultdict(set)
    mention_refs_by_node: defaultdict[str, set[str]] = defaultdict(set)
    source_refs_by_node: defaultdict[str, set[str]] = defaultdict(set)

    canonical_profiles: dict[tuple[str, str], dict[str, Any]] = {}
    for key, row in existing_profiles.items():
        profile = dict(row)
        profile["framework_refs"] = load_json_text(profile.pop("framework_refs_json"), [])
        profile["textbook_refs"] = load_json_text(profile.pop("textbook_refs_json"), [])
        profile["textbook_ids"] = load_json_text(profile.pop("textbook_ids_json"), [])
        profile["learning_objectives"] = load_json_text(profile.pop("learning_objectives_json"), [])
        profile["assessment_signals"] = load_json_text(profile.pop("assessment_signals_json"), [])
        profile["source_refs"] = load_json_text(profile.pop("source_refs_json"), [])
        profile["properties"] = load_json_text(profile.pop("properties_json"), {})
        canonical_profiles[key] = profile

    for profile in staging_profiles:
        canonical_node_id = node_map.get((profile["lesson_run_id"], profile["raw_node_id"]))
        if not canonical_node_id:
            stats["skipped_profiles"] += 1
            continue
        remapped_source_refs = merge_unique_strings(
            [
                evidence_id_map.get((profile["lesson_run_id"], source_ref), source_ref)
                for source_ref in profile.get("source_refs", [])
            ]
        )
        key = (canonical_node_id, profile["context_key"])
        payload = canonical_profiles.get(
            key,
            {
                "dataset_id": dataset_id,
                "id": make_profile_id(canonical_node_id, profile["context_key"]),
                "node_id": canonical_node_id,
                "subject": profile["subject"],
                "school_stage": profile["school_stage"],
                "grade_band": profile["grade_band"],
                "context_key": profile["context_key"],
                "curriculum_role": profile["curriculum_role"],
                "mastery_level": profile["mastery_level"],
                "framework_refs": [],
                "textbook_refs": [],
                "textbook_ids": [],
                "learning_objectives": [],
                "assessment_signals": [],
                "source_refs": [],
                "properties": {},
                "status": "active",
                "updated_at": now,
            },
        )
        payload = merge_profile_payload(
            payload,
            {
                **profile,
                "source_refs": remapped_source_refs,
            },
        )
        canonical_profiles[key] = payload
        profile_refs_by_node[canonical_node_id].add(payload["id"])

    canonical_mentions: dict[str, dict[str, Any]] = {}
    for mention in staging_mentions:
        if mention["target_type"] == "node":
            target_id = node_map.get((mention["lesson_run_id"], mention["target_raw_id"]))
            if not target_id:
                stats["skipped_mentions"] += 1
                continue
        else:
            target_id = mention["target_raw_id"]
        mention_id = make_mention_id(
            mention["lesson_run_id"],
            mention["raw_mention_id"],
            mention["target_type"],
            target_id,
        )
        remapped_source_refs = merge_unique_strings(
            [
                evidence_id_map.get((mention["lesson_run_id"], source_ref), source_ref)
                for source_ref in mention.get("source_refs", [])
            ]
        )
        canonical_mentions[mention_id] = {
            "dataset_id": dataset_id,
            "id": mention_id,
            "source_type": mention["source_type"],
            "source_id": mention["source_id"],
            "anchor_ref": mention["anchor_ref"],
            "target_type": mention["target_type"],
            "target_id": target_id,
            "role": mention["role"],
            "source_refs": remapped_source_refs,
            "confidence": mention["confidence"],
            "properties": merge_json_objects(
                mention.get("properties", {}),
                {
                    "lesson_run_id": mention["lesson_run_id"],
                    "raw_mention_id": mention["raw_mention_id"],
                },
            ),
        }
        if mention["target_type"] == "node":
            mention_refs_by_node[target_id].add(mention_id)
            source_refs_by_node[target_id].update(remapped_source_refs)

    canonical_cards: dict[str, dict[str, Any]] = {}
    for node_id, row in existing_cards.items():
        canonical_cards[node_id] = {
            "dataset_id": dataset_id,
            "node_id": node_id,
            "id": row.get("id") or f"node-card:{node_id}",
            "card_layer": row["card_layer"],
            "title": row["title"],
            "summary": row["summary"],
            "pattern_refs": load_json_text(row.get("pattern_refs_json"), []),
            "framework_refs": load_json_text(row.get("framework_refs_json"), []),
            "profile_refs": load_json_text(row.get("profile_refs_json"), []),
            "mention_refs": load_json_text(row.get("mention_refs_json"), []),
            "source_refs": load_json_text(row.get("source_refs_json"), []),
            "sections": load_json_text(row.get("sections_json"), []),
            "properties": load_json_text(row.get("properties_json"), {}),
            "status": row["status"],
            "updated_at": row.get("updated_at") or now,
        }

    for card in staging_cards:
        canonical_node_id = node_map.get((card["lesson_run_id"], card["raw_node_id"]))
        if not canonical_node_id:
            stats["skipped_cards"] += 1
            continue
        remapped_source_refs = merge_unique_strings(
            [
                evidence_id_map.get((card["lesson_run_id"], source_ref), source_ref)
                for source_ref in card.get("source_refs", [])
            ]
        )
        remapped_sections = []
        for section in card.get("sections", []):
            if not isinstance(section, dict):
                continue
            remapped_sections.append(
                {
                    "id": str(section.get("id") or "section"),
                    "title": str(section.get("title") or section.get("section_type") or "Section"),
                    "section_type": str(section.get("section_type") or section.get("id") or "content"),
                    "content": str(section.get("content") or ""),
                    "source_refs": merge_unique_strings(
                        [
                            evidence_id_map.get((card["lesson_run_id"], source_ref), source_ref)
                            for source_ref in section.get("source_refs", [])
                        ]
                    ),
                }
            )
        payload = canonical_cards.get(
            canonical_node_id,
            {
                "dataset_id": dataset_id,
                "node_id": canonical_node_id,
                "id": f"node-card:{canonical_node_id}",
                "card_layer": card["card_layer"],
                "title": existing_nodes[canonical_node_id].payload["canonical_name"],
                "summary": "",
                "pattern_refs": [],
                "framework_refs": [],
                "profile_refs": [],
                "mention_refs": [],
                "source_refs": [],
                "sections": [],
                "properties": {},
                "status": "active",
                "updated_at": now,
            },
        )
        payload = merge_card_payload(
            payload,
            {
                **card,
                "source_refs": remapped_source_refs,
                "sections": remapped_sections,
            },
            existing_nodes[canonical_node_id].payload["canonical_name"],
        )
        payload["profile_refs"] = merge_unique_strings(
            payload.get("profile_refs", []), sorted(profile_refs_by_node[canonical_node_id])
        )
        payload["mention_refs"] = merge_unique_strings(
            payload.get("mention_refs", []), sorted(mention_refs_by_node[canonical_node_id])
        )
        payload["source_refs"] = merge_unique_strings(
            payload.get("source_refs", []), sorted(source_refs_by_node[canonical_node_id])
        )
        canonical_cards[canonical_node_id] = payload

    for node_id, canonical in existing_nodes.items():
        payload = canonical.payload
        if payload.get("node_layer") != "backbone" or node_id in canonical_cards:
            continue
        fallback_source_refs = sorted(source_refs_by_node[node_id])
        canonical_cards[node_id] = {
            "dataset_id": dataset_id,
            "node_id": node_id,
            "id": f"node-card:{node_id}",
            "card_layer": "backbone",
            "title": payload["canonical_name"],
            "summary": payload.get("definition", ""),
            "pattern_refs": [],
            "framework_refs": payload.get("framework_refs", []),
            "profile_refs": sorted(profile_refs_by_node[node_id]),
            "mention_refs": sorted(mention_refs_by_node[node_id]),
            "source_refs": fallback_source_refs,
            "sections": [
                {
                    "id": "definition",
                    "title": "定义",
                    "section_type": "definition",
                    "content": payload.get("definition", ""),
                    "source_refs": fallback_source_refs,
                }
            ],
            "properties": {"generated_by": "merge_staged_lessons"},
            "status": "active",
            "updated_at": now,
        }
        stats["generated_fallback_cards"] += 1

    canonical_edges: dict[tuple[str, str, str], dict[str, Any]] = {}
    for key, row in existing_edges.items():
        edge = dict(row)
        edge["framework_refs"] = load_json_text(edge.pop("framework_refs_json"), [])
        edge["profile_refs"] = load_json_text(edge.pop("profile_refs_json"), [])
        edge["source_refs"] = load_json_text(edge.pop("source_refs_json"), [])
        edge["properties"] = load_json_text(edge.pop("properties_json"), {})
        canonical_edges[key] = edge

    for edge in staging_edges:
        from_id = node_map.get((edge["lesson_run_id"], edge["from_raw_node_id"]))
        to_id = node_map.get((edge["lesson_run_id"], edge["to_raw_node_id"]))
        if not from_id or not to_id:
            stats["skipped_edges"] += 1
            continue
        remapped_source_refs = merge_unique_strings(
            [
                evidence_id_map.get((edge["lesson_run_id"], source_ref), source_ref)
                for source_ref in edge.get("source_refs", [])
            ]
        )
        key = (from_id, edge["edge_type"], to_id)
        current = canonical_edges.get(
            key,
            {
                "dataset_id": dataset_id,
                "id": make_edge_id(from_id, edge["edge_type"], to_id),
                "edge_type": edge["edge_type"],
                "edge_layer": edge["edge_layer"],
                "backbone_expand": edge["backbone_expand"],
                "from_id": from_id,
                "to_id": to_id,
                "directionality": edge["directionality"],
                "confidence": edge["confidence"],
                "framework_refs": [],
                "profile_refs": [],
                "source_refs": [],
                "properties": {"support_count": 0, "lesson_run_ids": []},
                "status": "active",
                "created_at": now,
                "updated_at": now,
            },
        )
        current["confidence"] = max(float(current.get("confidence") or 0.0), float(edge["confidence"]))
        current["framework_refs"] = merge_unique_strings(current.get("framework_refs", []), edge.get("framework_refs", []))
        current["profile_refs"] = merge_unique_strings(current.get("profile_refs", []), edge.get("profile_refs", []))
        current["source_refs"] = merge_unique_strings(current.get("source_refs", []), remapped_source_refs)
        properties = dict(current.get("properties", {}))
        properties["support_count"] = int(properties.get("support_count") or 0) + 1
        properties["lesson_run_ids"] = merge_unique_strings(
            properties.get("lesson_run_ids", []), [edge["lesson_run_id"]]
        )
        current["properties"] = merge_json_objects(properties, edge.get("properties", {}))
        current["updated_at"] = now
        canonical_edges[key] = current

    for node_id, canonical in existing_nodes.items():
        canonical.payload["profile_refs"] = merge_unique_strings(
            canonical.payload.get("profile_refs", []), sorted(profile_refs_by_node[node_id])
        )
        canonical.payload["card_ref"] = f"node-card:{node_id}"
        if node_id in canonical_cards:
            canonical_cards[node_id]["profile_refs"] = merge_unique_strings(
                canonical_cards[node_id].get("profile_refs", []), sorted(profile_refs_by_node[node_id])
            )
            canonical_cards[node_id]["mention_refs"] = merge_unique_strings(
                canonical_cards[node_id].get("mention_refs", []), sorted(mention_refs_by_node[node_id])
            )
            canonical_cards[node_id]["source_refs"] = merge_unique_strings(
                canonical_cards[node_id].get("source_refs", []), sorted(source_refs_by_node[node_id])
            )

    if args.dry_run:
        print(
            dump_json_text(
                {
                    "merge_run_id": merge_run_id,
                    "dataset_id": dataset_id,
                    "lesson_run_ids": lesson_run_ids,
                    "stats": dict(stats),
                }
            )
        )
        return 0

    with connection:
        connection.execute(
            """
            INSERT OR REPLACE INTO merge_runs (
              dataset_id,
              merge_run_id,
              selection_json,
              stats_json,
              status,
              created_at,
              updated_at
            ) VALUES (?, ?, ?, ?, 'in_progress', ?, ?)
            """,
            (
                dataset_id,
                merge_run_id,
                dump_json_text(lesson_run_ids),
                dump_json_text({}),
                now,
                now,
            ),
        )
        connection.executemany(
            """
            UPDATE lesson_runs
            SET status = 'merging', updated_at = ?
            WHERE dataset_id = ? AND lesson_run_id = ?
            """,
            [(now, dataset_id, lesson_run_id) for lesson_run_id in lesson_run_ids],
        )

        ensure_source_artifacts(connection, dataset_id, list(canonical_evidence_rows.values()))

        connection.executemany(
            """
            INSERT OR REPLACE INTO evidence (
              dataset_id, id, source_type, source_id, anchor_ref, source_path, page_start,
              page_end, excerpt, locator, modality, extraction_method, normalized_claims_json,
              properties_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    row["dataset_id"],
                    row["id"],
                    row["source_type"],
                    row["source_id"],
                    row["anchor_ref"],
                    row.get("source_path"),
                    row.get("page_start"),
                    row.get("page_end"),
                    row["excerpt"],
                    row["locator"],
                    row.get("modality"),
                    row["extraction_method"],
                    dump_json_text(row.get("normalized_claims", [])),
                    dump_json_text(row.get("properties", {})),
                )
                for row in canonical_evidence_rows.values()
            ],
        )

        connection.executemany(
            """
            INSERT OR REPLACE INTO nodes (
              dataset_id, id, canonical_name, node_kind, node_layer, node_subkind,
              definition, aliases_json, learning_modes_json, bridge_tags_json,
              framework_refs_json, profile_refs_json, card_ref, same_as_refs_json,
              properties_json, status, deprecated_by, created_at, updated_at, notes
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    dataset_id,
                    node_id,
                    canonical.payload["canonical_name"],
                    canonical.payload["node_kind"],
                    canonical.payload["node_layer"],
                    canonical.payload.get("node_subkind"),
                    canonical.payload.get("definition", ""),
                    dump_json_text(canonical.payload.get("aliases", [])),
                    dump_json_text(canonical.payload.get("learning_modes", [])),
                    dump_json_text(canonical.payload.get("bridge_tags", [])),
                    dump_json_text(canonical.payload.get("framework_refs", [])),
                    dump_json_text(canonical.payload.get("profile_refs", [])),
                    canonical.payload.get("card_ref"),
                    dump_json_text(canonical.payload.get("same_as_refs", [])),
                    dump_json_text(canonical.payload.get("properties", {})),
                    canonical.payload.get("status", "active"),
                    canonical.payload.get("deprecated_by"),
                    canonical.payload.get("created_at") or now,
                    now,
                    canonical.payload.get("notes", ""),
                )
                for node_id, canonical in existing_nodes.items()
            ],
        )

        connection.executemany(
            """
            INSERT OR REPLACE INTO profiles (
              dataset_id, id, node_id, subject, school_stage, grade_band, context_key,
              curriculum_role, mastery_level, framework_refs_json, textbook_refs_json,
              textbook_ids_json, learning_objectives_json, assessment_signals_json,
              source_refs_json, properties_json, status, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    dataset_id,
                    profile["id"],
                    profile["node_id"],
                    profile["subject"],
                    profile["school_stage"],
                    profile["grade_band"],
                    profile["context_key"],
                    profile["curriculum_role"],
                    profile["mastery_level"],
                    dump_json_text(profile.get("framework_refs", [])),
                    dump_json_text(profile.get("textbook_refs", [])),
                    dump_json_text(profile.get("textbook_ids", [])),
                    dump_json_text(profile.get("learning_objectives", [])),
                    dump_json_text(profile.get("assessment_signals", [])),
                    dump_json_text(profile.get("source_refs", [])),
                    dump_json_text(profile.get("properties", {})),
                    profile.get("status", "active"),
                    now,
                )
                for profile in canonical_profiles.values()
            ],
        )

        connection.executemany(
            """
            INSERT OR REPLACE INTO mentions (
              dataset_id, id, source_type, source_id, anchor_ref, target_type, target_id,
              role, source_refs_json, confidence, properties_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    dataset_id,
                    mention["id"],
                    mention["source_type"],
                    mention["source_id"],
                    mention["anchor_ref"],
                    mention["target_type"],
                    mention["target_id"],
                    mention["role"],
                    dump_json_text(mention.get("source_refs", [])),
                    mention["confidence"],
                    dump_json_text(mention.get("properties", {})),
                )
                for mention in canonical_mentions.values()
            ],
        )

        connection.executemany(
            """
            INSERT OR REPLACE INTO edges (
              dataset_id, id, edge_type, edge_layer, backbone_expand, from_id, to_id,
              directionality, confidence, framework_refs_json, profile_refs_json,
              source_refs_json, properties_json, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    dataset_id,
                    edge["id"],
                    edge["edge_type"],
                    edge["edge_layer"],
                    edge["backbone_expand"],
                    edge["from_id"],
                    edge["to_id"],
                    edge["directionality"],
                    edge["confidence"],
                    dump_json_text(edge.get("framework_refs", [])),
                    dump_json_text(edge.get("profile_refs", [])),
                    dump_json_text(edge.get("source_refs", [])),
                    dump_json_text(edge.get("properties", {})),
                    edge.get("status", "active"),
                    edge.get("created_at") or now,
                    now,
                )
                for edge in canonical_edges.values()
            ],
        )

        connection.executemany(
            """
            INSERT OR REPLACE INTO node_cards (
              dataset_id, node_id, id, card_layer, title, summary, pattern_refs_json,
              framework_refs_json, profile_refs_json, mention_refs_json, source_refs_json,
              sections_json, properties_json, status, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            [
                (
                    dataset_id,
                    node_id,
                    card["id"],
                    card["card_layer"],
                    card["title"],
                    card["summary"],
                    dump_json_text(card.get("pattern_refs", [])),
                    dump_json_text(card.get("framework_refs", [])),
                    dump_json_text(card.get("profile_refs", [])),
                    dump_json_text(card.get("mention_refs", [])),
                    dump_json_text(card.get("source_refs", [])),
                    dump_json_text(card.get("sections", [])),
                    dump_json_text(card.get("properties", {})),
                    card.get("status", "active"),
                    now,
                )
                for node_id, card in canonical_cards.items()
            ],
        )

        connection.execute(
            "DELETE FROM canonical_node_map WHERE dataset_id = ? AND merge_run_id = ?",
            (dataset_id, merge_run_id),
        )
        connection.executemany(
            """
            INSERT OR REPLACE INTO canonical_node_map (
              dataset_id, merge_run_id, lesson_run_id, raw_node_id, canonical_node_id,
              resolution, similarity, rationale_json, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            canonical_map_rows,
        )

        for edge in canonical_edges.values():
            upsert_evidence_links(connection, dataset_id, "edge", edge["id"], edge.get("source_refs", []))
        for profile in canonical_profiles.values():
            upsert_evidence_links(connection, dataset_id, "profile", profile["id"], profile.get("source_refs", []))
        for mention in canonical_mentions.values():
            upsert_evidence_links(connection, dataset_id, "mention", mention["id"], mention.get("source_refs", []))
        for node_id, card in canonical_cards.items():
            upsert_evidence_links(connection, dataset_id, "card", card["id"], card.get("source_refs", []))
            for section in card.get("sections", []):
                section_owner = f"{card['id']}#{section['id']}"
                upsert_evidence_links(
                    connection,
                    dataset_id,
                    "card_section",
                    section_owner,
                    section.get("source_refs", []),
                )

        rebuild_node_terms(connection, dataset_id)

        connection.execute(
            """
            UPDATE merge_runs
            SET stats_json = ?, status = 'completed', updated_at = ?
            WHERE dataset_id = ? AND merge_run_id = ?
            """,
            (dump_json_text(dict(stats)), now, dataset_id, merge_run_id),
        )
        connection.executemany(
            """
            UPDATE lesson_runs
            SET status = 'merged', updated_at = ?
            WHERE dataset_id = ? AND lesson_run_id = ?
            """,
            [(now, dataset_id, lesson_run_id) for lesson_run_id in lesson_run_ids],
        )

    print(
        dump_json_text(
            {
                "merge_run_id": merge_run_id,
                "dataset_id": dataset_id,
                "lesson_run_ids": lesson_run_ids,
                "stats": dict(stats),
            }
        )
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
