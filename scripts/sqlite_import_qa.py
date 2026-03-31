#!/usr/bin/env python3
"""Post-import QA checks for the SQLite knowledge store."""

from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path

from knowledge_store_common import (
    DEFAULT_DB_PATH,
    dataset_id_from_output_root,
    iter_evidence_links,
    iter_node_terms,
    iter_profile_textbook_links,
    load_snapshot,
    schema_supports_evidence_link_owner_type,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run consistency checks against an imported SQLite dataset."
    )
    parser.add_argument(
        "--db",
        default=str(DEFAULT_DB_PATH),
        help="SQLite database path. Defaults to storage/knowledge.sqlite",
    )
    parser.add_argument(
        "--output-root",
        help="Optional data/<version>/ root to compare database counts against snapshot files.",
    )
    parser.add_argument(
        "--dataset-id",
        help="Dataset id in SQLite. Defaults to the output root name, or the active dataset if no output root is given.",
    )
    return parser.parse_args()


def connect(db_path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(db_path)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


def resolve_dataset_id(
    connection: sqlite3.Connection, dataset_id: str | None, output_root: Path | None
) -> str:
    if dataset_id:
        return dataset_id
    if output_root is not None:
        return dataset_id_from_output_root(output_root)

    row = connection.execute(
        "SELECT dataset_id FROM datasets WHERE is_active = 1 LIMIT 1"
    ).fetchone()
    if row is None:
        raise SystemExit("No dataset id provided and no active dataset found in SQLite.")
    return row["dataset_id"]


def table_count(connection: sqlite3.Connection, table: str, dataset_id: str) -> int:
    row = connection.execute(
        f"SELECT COUNT(*) AS count FROM {table} WHERE dataset_id = ?",
        (dataset_id,),
    ).fetchone()
    return int(row["count"])


def check(condition: bool, message: str, failures: list[str]) -> None:
    if condition:
        print(f"PASS {message}")
    else:
        print(f"FAIL {message}")
        failures.append(message)


def load_json_array(text: str | None) -> list[str]:
    if not text:
        return []
    value = json.loads(text)
    if not isinstance(value, list):
        raise ValueError(f"Expected JSON array, got: {text}")
    return [str(item) for item in value]


def run_snapshot_count_checks(
    connection: sqlite3.Connection, dataset_id: str, output_root: Path, failures: list[str]
) -> None:
    snapshot = load_snapshot(output_root)
    expected_counts = {
        "nodes": len(snapshot.nodes),
        "edges": len(snapshot.edges),
        "profiles": len(snapshot.profiles),
        "mentions": len(snapshot.mentions),
        "evidence": len(snapshot.evidence),
        "node_cards": len(snapshot.node_cards),
        "node_terms": sum(1 for _ in iter_node_terms(snapshot.nodes)),
        "profile_textbooks": sum(1 for _ in iter_profile_textbook_links(snapshot.profiles)),
        "evidence_links": sum(1 for _ in iter_evidence_links(snapshot)),
    }

    print("\nCount comparison against snapshot:")
    runtime_mutable_tables = {"edges", "evidence_links"}
    for table, expected in expected_counts.items():
        actual = table_count(connection, table, dataset_id)
        if table in runtime_mutable_tables:
            check(
                actual >= expected,
                f"{table}: db={actual}, snapshot={expected}, runtime_delta={actual - expected}",
                failures,
            )
        else:
            check(actual == expected, f"{table}: db={actual}, snapshot={expected}", failures)


def run_relational_checks(connection: sqlite3.Connection, dataset_id: str, failures: list[str]) -> None:
    print("\nRelational integrity checks:")

    queries = {
        "edges have existing from/to nodes": """
            SELECT COUNT(*) AS count
            FROM edges e
            LEFT JOIN nodes nf
              ON nf.dataset_id = e.dataset_id AND nf.id = e.from_id
            LEFT JOIN nodes nt
              ON nt.dataset_id = e.dataset_id AND nt.id = e.to_id
            WHERE e.dataset_id = ?
              AND (nf.id IS NULL OR nt.id IS NULL)
        """,
        "profiles point to existing nodes": """
            SELECT COUNT(*) AS count
            FROM profiles p
            LEFT JOIN nodes n
              ON n.dataset_id = p.dataset_id AND n.id = p.node_id
            WHERE p.dataset_id = ?
              AND n.id IS NULL
        """,
        "node cards point to existing nodes": """
            SELECT COUNT(*) AS count
            FROM node_cards c
            LEFT JOIN nodes n
              ON n.dataset_id = c.dataset_id AND n.id = c.node_id
            WHERE c.dataset_id = ?
              AND n.id IS NULL
        """,
        "mentions target a known object": """
            SELECT COUNT(*) AS count
            FROM mentions m
            LEFT JOIN nodes n
              ON m.target_type = 'node' AND n.dataset_id = m.dataset_id AND n.id = m.target_id
            LEFT JOIN edges e
              ON m.target_type = 'edge' AND e.dataset_id = m.dataset_id AND e.id = m.target_id
            LEFT JOIN profiles p
              ON m.target_type = 'profile' AND p.dataset_id = m.dataset_id AND p.id = m.target_id
            LEFT JOIN node_cards c_by_id
              ON m.target_type = 'card' AND c_by_id.dataset_id = m.dataset_id AND c_by_id.id = m.target_id
            LEFT JOIN node_cards c_by_node
              ON m.target_type = 'card' AND c_by_node.dataset_id = m.dataset_id AND c_by_node.node_id = m.target_id
            WHERE m.dataset_id = ?
              AND (
                (m.target_type = 'node' AND n.id IS NULL) OR
                (m.target_type = 'edge' AND e.id IS NULL) OR
                (m.target_type = 'profile' AND p.id IS NULL) OR
                (m.target_type = 'card' AND c_by_id.node_id IS NULL AND c_by_node.node_id IS NULL)
              )
        """,
        "evidence links point to existing evidence": """
            SELECT COUNT(*) AS count
            FROM evidence_links l
            LEFT JOIN evidence e
              ON e.dataset_id = l.dataset_id AND e.id = l.evidence_id
            WHERE l.dataset_id = ?
              AND e.id IS NULL
        """,
        "mention evidence links exist": """
            SELECT COUNT(*) AS count
            FROM mentions m
            LEFT JOIN evidence_links l
              ON l.dataset_id = m.dataset_id
             AND l.owner_type = 'mention'
             AND l.owner_id = m.id
            WHERE m.dataset_id = ?
              AND l.owner_id IS NULL
        """,
        "profile evidence links exist": """
            SELECT COUNT(*) AS count
            FROM profiles p
            LEFT JOIN evidence_links l
              ON l.dataset_id = p.dataset_id
             AND l.owner_type = 'profile'
             AND l.owner_id = p.id
            WHERE p.dataset_id = ?
              AND json_array_length(p.source_refs_json) > 0
              AND l.owner_id IS NULL
        """,
        "edge evidence links exist": """
            SELECT COUNT(*) AS count
            FROM edges e
            LEFT JOIN evidence_links l
              ON l.dataset_id = e.dataset_id
             AND l.owner_type = 'edge'
             AND l.owner_id = e.id
            WHERE e.dataset_id = ?
              AND json_array_length(e.source_refs_json) > 0
              AND l.owner_id IS NULL
        """,
    }

    for label, query in queries.items():
        count = int(connection.execute(query, (dataset_id,)).fetchone()["count"])
        check(count == 0, f"{label} (violations={count})", failures)

    card_section_violations = int(
        connection.execute(
            """
            SELECT COUNT(*) AS count
            FROM evidence_links l
            LEFT JOIN node_cards c
              ON c.dataset_id = l.dataset_id
             AND l.owner_type = 'card_section'
             AND substr(l.owner_id, 1, instr(l.owner_id, '#') - 1) = COALESCE(c.id, c.node_id)
            WHERE l.dataset_id = ?
              AND l.owner_type = 'card_section'
              AND c.node_id IS NULL
            """,
            (dataset_id,),
        ).fetchone()["count"]
    )
    check(
        card_section_violations == 0,
        f"card section evidence links resolve to a card (violations={card_section_violations})",
        failures,
    )


def run_search_checks(connection: sqlite3.Connection, dataset_id: str, failures: list[str]) -> None:
    print("\nFTS checks:")
    count_specs = (
        ("node_search", "nodes"),
        ("profile_search", "profiles"),
        ("evidence_search", "evidence"),
        ("card_search", "node_cards"),
    )
    for search_table, source_table in count_specs:
        search_count = int(
            connection.execute(
                f"SELECT COUNT(*) AS count FROM {search_table} WHERE dataset_id = ?",
                (dataset_id,),
            ).fetchone()["count"]
        )
        source_count = table_count(connection, source_table, dataset_id)
        expected = source_count if source_table in {"profiles", "node_cards"} else min(source_count, 1)
        check(
            search_count >= expected,
            (
                f"{search_table} coverage is sufficient "
                f"(search={search_count}, source={source_count}, expected>={expected})"
            ),
            failures,
        )

    sample = connection.execute(
        """
        SELECT canonical_name
        FROM node_search
        WHERE dataset_id = ?
          AND canonical_name IS NOT NULL
          AND trim(canonical_name) <> ''
        LIMIT 1
        """,
        (dataset_id,),
    ).fetchone()
    if sample is None:
        check(False, "node_search has a searchable sample row", failures)
        return

    match_count = int(
        connection.execute(
            """
            SELECT COUNT(*) AS count
            FROM node_search
            WHERE dataset_id = ?
              AND node_search MATCH ?
            """,
            (dataset_id, sample["canonical_name"]),
        ).fetchone()["count"]
    )
    check(
        match_count > 0,
        f"node_search matches a stored sample term (count={match_count})",
        failures,
    )


def run_runtime_pipeline_checks(
    connection: sqlite3.Connection, dataset_id: str, failures: list[str]
) -> None:
    print("\nRuntime pipeline checks:")

    retrieval_count = table_count(connection, "retrieval_candidates", dataset_id)
    proposal_rows = connection.execute(
        """
        SELECT proposal_id, status, evidence_refs_json
        FROM relation_proposals
        WHERE dataset_id = ?
        """,
        (dataset_id,),
    ).fetchall()
    review_count = table_count(connection, "review_queue", dataset_id)
    print(
        f"INFO retrieval_candidates={retrieval_count} "
        f"relation_proposals={len(proposal_rows)} review_queue={review_count}"
    )

    retrieval_violations = int(
        connection.execute(
            """
            SELECT COUNT(*) AS count
            FROM retrieval_candidates c
            LEFT JOIN nodes n
              ON n.dataset_id = c.dataset_id AND n.id = c.candidate_node_id
            WHERE c.dataset_id = ?
              AND n.id IS NULL
            """,
            (dataset_id,),
        ).fetchone()["count"]
    )
    check(
        retrieval_violations == 0,
        f"retrieval candidates point to existing nodes (violations={retrieval_violations})",
        failures,
    )

    proposal_node_violations = int(
        connection.execute(
            """
            SELECT COUNT(*) AS count
            FROM relation_proposals p
            LEFT JOIN nodes nf
              ON nf.dataset_id = p.dataset_id AND nf.id = p.from_node_id
            LEFT JOIN nodes nt
              ON nt.dataset_id = p.dataset_id AND nt.id = p.to_node_id
            WHERE p.dataset_id = ?
              AND (nf.id IS NULL OR nt.id IS NULL)
            """,
            (dataset_id,),
        ).fetchone()["count"]
    )
    check(
        proposal_node_violations == 0,
        f"relation proposals point to existing nodes (violations={proposal_node_violations})",
        failures,
    )

    evidence_ids = {
        row["id"]
        for row in connection.execute(
            "SELECT id FROM evidence WHERE dataset_id = ?",
            (dataset_id,),
        ).fetchall()
    }
    proposal_statuses: dict[str, str] = {}
    proposal_evidence_violations = 0
    proposal_missing_evidence_violations = 0
    for proposal in proposal_rows:
        proposal_id = proposal["proposal_id"]
        proposal_statuses[proposal_id] = proposal["status"]
        evidence_refs = load_json_array(proposal["evidence_refs_json"])
        if proposal["status"] in {"candidate", "accepted"} and not evidence_refs:
            proposal_missing_evidence_violations += 1
        proposal_evidence_violations += sum(1 for evidence_id in evidence_refs if evidence_id not in evidence_ids)

    check(
        proposal_evidence_violations == 0,
        f"relation proposal evidence refs resolve to known evidence (violations={proposal_evidence_violations})",
        failures,
    )
    check(
        proposal_missing_evidence_violations == 0,
        "candidate/accepted proposals always keep at least one evidence ref",
        failures,
    )

    review_owner_rows = connection.execute(
        """
        SELECT owner_id
        FROM review_queue
        WHERE dataset_id = ?
          AND owner_type = 'relation_proposal'
          AND status = 'open'
        """,
        (dataset_id,),
    ).fetchall()
    open_review_owner_ids = {row["owner_id"] for row in review_owner_rows}

    missing_review_links = sum(
        1
        for proposal_id, status in proposal_statuses.items()
        if status == "review" and proposal_id not in open_review_owner_ids
    )
    stale_open_reviews = sum(
        1
        for proposal_id in open_review_owner_ids
        if proposal_statuses.get(proposal_id) != "review"
    )

    check(
        missing_review_links == 0,
        f"review proposals have an open review_queue item (violations={missing_review_links})",
        failures,
    )
    check(
        stale_open_reviews == 0,
        f"open relation-proposal reviews still point to review-status proposals (violations={stale_open_reviews})",
        failures,
    )

    review_owner_violations = int(
        connection.execute(
            """
            SELECT COUNT(*) AS count
            FROM review_queue r
            LEFT JOIN relation_proposals p
              ON p.dataset_id = r.dataset_id AND p.proposal_id = r.owner_id
            WHERE r.dataset_id = ?
              AND r.owner_type = 'relation_proposal'
              AND p.proposal_id IS NULL
            """,
            (dataset_id,),
        ).fetchone()["count"]
    )
    check(
        review_owner_violations == 0,
        f"relation-proposal review rows point to existing proposals (violations={review_owner_violations})",
        failures,
    )

    promoted_edge_violations = 0
    for row in connection.execute(
        """
        SELECT id, properties_json
        FROM edges
        WHERE dataset_id = ?
        """,
        (dataset_id,),
    ).fetchall():
        properties = json.loads(row["properties_json"] or "{}")
        proposal_id = properties.get("promoted_from_proposal")
        if proposal_id and proposal_id not in proposal_statuses:
            promoted_edge_violations += 1

    check(
        promoted_edge_violations == 0,
        f"promoted edges keep a resolvable promoted_from_proposal pointer (violations={promoted_edge_violations})",
        failures,
    )

    supports_proposal_evidence_links = schema_supports_evidence_link_owner_type(
        connection, "relation_proposal"
    )
    if supports_proposal_evidence_links:
        print("INFO schema supports evidence_links.owner_type='relation_proposal'")
    else:
        print(
            "INFO legacy evidence_links schema detected; relation proposal evidence is stored in "
            "relation_proposals.evidence_refs_json only"
        )


def main() -> int:
    args = parse_args()
    db_path = Path(args.db).expanduser().resolve()
    output_root = Path(args.output_root).expanduser().resolve() if args.output_root else None

    connection = connect(db_path)
    dataset_id = resolve_dataset_id(connection, args.dataset_id, output_root)
    dataset_row = connection.execute(
        "SELECT dataset_id, version_key, root_path, status, is_active FROM datasets WHERE dataset_id = ?",
        (dataset_id,),
    ).fetchone()
    if dataset_row is None:
        raise SystemExit(f"Dataset '{dataset_id}' not found in {db_path}")

    print(
        f"Running SQLite QA for dataset '{dataset_id}' "
        f"(version={dataset_row['version_key']}, active={bool(dataset_row['is_active'])})"
    )

    failures: list[str] = []
    if output_root is not None:
        run_snapshot_count_checks(connection, dataset_id, output_root, failures)
    run_relational_checks(connection, dataset_id, failures)
    run_search_checks(connection, dataset_id, failures)
    run_runtime_pipeline_checks(connection, dataset_id, failures)

    if failures:
        print(f"\nQA failed with {len(failures)} issue(s).")
        return 1

    print("\nQA passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
