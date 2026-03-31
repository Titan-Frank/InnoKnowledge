#!/usr/bin/env python3
"""Sync a versioned output root into SQLite while preserving runtime pipeline tables."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any

from import_to_sqlite import (
    activate_dataset,
    delete_dataset,
    find_conflicting_dataset_ids,
    import_snapshot,
    insert_dataset,
    mark_dataset_ready,
    preflight_snapshot,
)
from knowledge_store_common import (
    DEFAULT_DB_PATH,
    connect_db,
    dataset_id_from_output_root,
    ensure_sqlite_schema,
    load_snapshot,
    schema_supports_evidence_link_owner_type,
    version_key_from_output_root,
)
from upgrade_sqlite_runtime_schema import rebuild_evidence_links


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Sync data/<version>/ into SQLite while preserving runtime tables."
    )
    parser.add_argument("output_root", help="Versioned output root, for example data/v5")
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH))
    parser.add_argument("--dataset-id")
    parser.add_argument("--version-key")
    parser.add_argument("--notes")
    parser.add_argument("--activate", action="store_true")
    parser.add_argument(
        "--replace",
        action="store_true",
        help="Replace the existing dataset when the dataset id, version key, or root path already exists.",
    )
    parser.add_argument(
        "--preserve-runtime",
        action="store_true",
        help="Preserve retrieval/proposal/review runtime rows when replacing the same dataset id.",
    )
    return parser.parse_args()


def rows_to_dicts(rows) -> list[dict[str, Any]]:
    return [dict(row) for row in rows]


def capture_runtime_state(connection, dataset_id: str) -> dict[str, list[dict[str, Any]]]:
    return {
        "batch_runtime_records": rows_to_dicts(
            connection.execute(
                """
                SELECT *
                FROM batch_runtime_records
                WHERE dataset_id = ?
                ORDER BY book_id, batch_anchor, record_type, record_id
                """,
                (dataset_id,),
            ).fetchall()
        ),
        "retrieval_candidates": rows_to_dicts(
            connection.execute(
                """
                SELECT *
                FROM retrieval_candidates
                WHERE dataset_id = ?
                ORDER BY batch_anchor, query_id, rank
                """,
                (dataset_id,),
            ).fetchall()
        ),
        "relation_proposals": rows_to_dicts(
            connection.execute(
                """
                SELECT *
                FROM relation_proposals
                WHERE dataset_id = ?
                ORDER BY batch_anchor, proposal_id
                """,
                (dataset_id,),
            ).fetchall()
        ),
        "review_queue": rows_to_dicts(
            connection.execute(
                """
                SELECT *
                FROM review_queue
                WHERE dataset_id = ?
                ORDER BY created_at, review_id
                """,
                (dataset_id,),
            ).fetchall()
        ),
        "proposal_evidence_links": rows_to_dicts(
            connection.execute(
                """
                SELECT *
                FROM evidence_links
                WHERE dataset_id = ?
                  AND owner_type = 'relation_proposal'
                ORDER BY owner_id, ordinal, evidence_id
                """,
                (dataset_id,),
            ).fetchall()
        ),
    }


def restore_runtime_state(connection, dataset_id: str, state: dict[str, list[dict[str, Any]]]) -> Counter:
    stats: Counter[str] = Counter()
    node_ids = {
        row["id"]
        for row in connection.execute(
            "SELECT id FROM nodes WHERE dataset_id = ?",
            (dataset_id,),
        ).fetchall()
    }
    evidence_ids = {
        row["id"]
        for row in connection.execute(
            "SELECT id FROM evidence WHERE dataset_id = ?",
            (dataset_id,),
        ).fetchall()
    }
    profile_ids = {
        row["id"]
        for row in connection.execute(
            "SELECT id FROM profiles WHERE dataset_id = ?",
            (dataset_id,),
        ).fetchall()
    }
    mention_ids = {
        row["id"]
        for row in connection.execute(
            "SELECT id FROM mentions WHERE dataset_id = ?",
            (dataset_id,),
        ).fetchall()
    }

    runtime_rows: list[dict[str, Any]] = []
    for row in state["batch_runtime_records"]:
        payload = json.loads(row["payload_json"] or "{}")
        record_type = row["record_type"]
        if record_type == "node" and payload.get("id") not in node_ids:
            continue
        if record_type == "profile" and payload.get("id") not in profile_ids:
            continue
        if record_type == "mention" and payload.get("id") not in mention_ids:
            continue
        if record_type == "evidence" and payload.get("id") not in evidence_ids:
            continue
        if record_type == "node_card" and (payload.get("node_id") or payload.get("id")) not in node_ids:
            continue
        runtime_rows.append(row)

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
        [
            (
                dataset_id,
                row["book_id"],
                row["batch_anchor"],
                row["record_type"],
                row["record_id"],
                row["payload_json"],
                row["created_at"],
                row["updated_at"],
            )
            for row in runtime_rows
        ],
    )
    stats["batch_runtime_records_restored"] = len(runtime_rows)
    stats["batch_runtime_records_skipped"] = len(state["batch_runtime_records"]) - len(runtime_rows)

    retrieval_rows = [
        row
        for row in state["retrieval_candidates"]
        if row["candidate_node_id"] in node_ids
    ]
    connection.executemany(
        """
        INSERT OR REPLACE INTO retrieval_candidates (
          dataset_id,
          batch_anchor,
          query_id,
          query_text,
          candidate_node_id,
          rank,
          score,
          retrieval_method,
          filters_json,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                dataset_id,
                row["batch_anchor"],
                row["query_id"],
                row["query_text"],
                row["candidate_node_id"],
                row["rank"],
                row["score"],
                row["retrieval_method"],
                row["filters_json"],
                row["created_at"],
            )
            for row in retrieval_rows
        ],
    )
    stats["retrieval_candidates_restored"] = len(retrieval_rows)
    stats["retrieval_candidates_skipped"] = len(state["retrieval_candidates"]) - len(retrieval_rows)

    relation_rows: list[dict[str, Any]] = []
    for row in state["relation_proposals"]:
        if row["from_node_id"] not in node_ids or row["to_node_id"] not in node_ids:
            continue
        evidence_refs = json.loads(row["evidence_refs_json"] or "[]")
        if any(evidence_id not in evidence_ids for evidence_id in evidence_refs):
            continue
        relation_rows.append(row)

    connection.executemany(
        """
        INSERT OR REPLACE INTO relation_proposals (
          dataset_id,
          proposal_id,
          batch_anchor,
          source_id,
          anchor_ref,
          subject,
          school_stage,
          grade_band,
          from_node_id,
          to_node_id,
          edge_type,
          confidence,
          evidence_refs_json,
          status,
          conflict_type,
          conflict_with_edge_id,
          properties_json,
          created_at,
          resolved_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                dataset_id,
                row["proposal_id"],
                row["batch_anchor"],
                row["source_id"],
                row["anchor_ref"],
                row["subject"],
                row["school_stage"],
                row["grade_band"],
                row["from_node_id"],
                row["to_node_id"],
                row["edge_type"],
                row["confidence"],
                row["evidence_refs_json"],
                row["status"],
                row["conflict_type"],
                row["conflict_with_edge_id"],
                row["properties_json"],
                row["created_at"],
                row["resolved_at"],
            )
            for row in relation_rows
        ],
    )
    restored_proposal_ids = {row["proposal_id"] for row in relation_rows}
    stats["relation_proposals_restored"] = len(relation_rows)
    stats["relation_proposals_skipped"] = len(state["relation_proposals"]) - len(relation_rows)

    review_rows = [
        row
        for row in state["review_queue"]
        if row["owner_type"] != "relation_proposal" or row["owner_id"] in restored_proposal_ids
    ]
    connection.executemany(
        """
        INSERT OR REPLACE INTO review_queue (
          dataset_id,
          review_id,
          owner_type,
          owner_id,
          batch_anchor,
          review_type,
          status,
          priority,
          details_json,
          created_at,
          resolved_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        [
            (
                dataset_id,
                row["review_id"],
                row["owner_type"],
                row["owner_id"],
                row["batch_anchor"],
                row["review_type"],
                row["status"],
                row["priority"],
                row["details_json"],
                row["created_at"],
                row["resolved_at"],
            )
            for row in review_rows
        ],
    )
    stats["review_queue_restored"] = len(review_rows)
    stats["review_queue_skipped"] = len(state["review_queue"]) - len(review_rows)

    proposal_evidence_rows = [
        row
        for row in state["proposal_evidence_links"]
        if row["owner_id"] in restored_proposal_ids and row["evidence_id"] in evidence_ids
    ]
    if proposal_evidence_rows and schema_supports_evidence_link_owner_type(
        connection, "relation_proposal"
    ):
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
                (
                    dataset_id,
                    row["owner_type"],
                    row["owner_id"],
                    row["evidence_id"],
                    row["ordinal"],
                )
                for row in proposal_evidence_rows
            ],
        )
    stats["proposal_evidence_links_restored"] = len(proposal_evidence_rows)
    stats["proposal_evidence_links_skipped"] = (
        len(state["proposal_evidence_links"]) - len(proposal_evidence_rows)
    )

    return stats


def main() -> int:
    args = parse_args()
    output_root = Path(args.output_root).expanduser().resolve()
    dataset_id = args.dataset_id or dataset_id_from_output_root(output_root)
    version_key = args.version_key or version_key_from_output_root(output_root)

    snapshot = load_snapshot(output_root)
    preflight_snapshot(snapshot)

    connection = connect_db(args.db)
    ensure_sqlite_schema(connection)
    if not schema_supports_evidence_link_owner_type(connection, "relation_proposal"):
        with connection:
            rebuild_evidence_links(connection)

    conflicts = find_conflicting_dataset_ids(connection, dataset_id, version_key, str(output_root))
    if conflicts and not args.replace:
        joined = ", ".join(conflicts)
        raise SystemExit(
            f"Dataset conflict for {dataset_id} / {version_key} at {output_root}. "
            f"Existing dataset ids: {joined}. Re-run with --replace to overwrite them."
        )

    runtime_state = {
        "batch_runtime_records": [],
        "retrieval_candidates": [],
        "relation_proposals": [],
        "review_queue": [],
        "proposal_evidence_links": [],
    }
    if args.preserve_runtime and dataset_id in conflicts:
        runtime_state = capture_runtime_state(connection, dataset_id)

    with connection:
        for conflict_id in conflicts:
            delete_dataset(connection, conflict_id)

        insert_dataset(connection, dataset_id, version_key, str(output_root), args.notes)
        import_stats = import_snapshot(connection, dataset_id, snapshot)
        restore_stats = Counter()
        if args.preserve_runtime and dataset_id in conflicts:
            restore_stats = restore_runtime_state(connection, dataset_id, runtime_state)

        if args.activate:
            activate_dataset(connection, dataset_id)
        else:
            mark_dataset_ready(connection, dataset_id)

    print(f"Synced dataset '{dataset_id}' from {output_root} into {Path(args.db).expanduser().resolve()}")
    for key in sorted(import_stats):
        print(f"  {key}: {import_stats[key]}")
    for key in sorted(restore_stats):
        print(f"  {key}: {restore_stats[key]}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
