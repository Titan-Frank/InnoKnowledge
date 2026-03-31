#!/usr/bin/env python3
"""Store lesson-local relation proposals in SQLite with conflict and evidence checks."""

from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Any

from knowledge_store_common import (
    DEFAULT_DB_PATH,
    connect_db,
    detect_edge_conflict,
    dump_json_text,
    ensure_sqlite_schema,
    fetch_existing_edges,
    make_proposal_id,
    make_review_id,
    require_dataset_row,
    resolve_outline_anchor,
    resolve_dataset_id,
    schema_supports_evidence_link_owner_type,
    utc_now,
)


VALID_PROPOSAL_STATUSES = {"candidate", "accepted", "review", "rejected"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Store relation proposals with conservative conflict detection."
    )
    parser.add_argument("--input", required=True, help="JSONL file containing relation proposals.")
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH))
    parser.add_argument("--dataset-id")
    parser.add_argument("--output-root")
    parser.add_argument("--default-status", default="candidate", choices=sorted(VALID_PROPOSAL_STATUSES))
    parser.add_argument(
        "--replace",
        action="store_true",
        help="Replace existing proposals/reviews with the same proposal id.",
    )
    return parser.parse_args()


def load_records(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        records.append(json.loads(line))
    if not records:
        raise SystemExit(f"No JSONL records found in {path}")
    return records


def require_references(connection, dataset_id: str, records: list[dict[str, Any]]) -> None:
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

    missing_nodes: list[str] = []
    missing_evidence: list[str] = []
    for record in records:
        if record["from_node_id"] not in node_ids:
            missing_nodes.append(record["from_node_id"])
        if record["to_node_id"] not in node_ids:
            missing_nodes.append(record["to_node_id"])
        for evidence_id in record.get("evidence_refs", record.get("source_refs", [])):
            if evidence_id not in evidence_ids:
                missing_evidence.append(evidence_id)

    if missing_nodes:
        preview = ", ".join(sorted(set(missing_nodes))[:10])
        raise SystemExit(f"Proposal input references missing nodes: {preview}")
    if missing_evidence:
        preview = ", ".join(sorted(set(missing_evidence))[:10])
        raise SystemExit(f"Proposal input references missing evidence ids: {preview}")


def normalize_record(record: dict[str, Any], default_status: str) -> dict[str, Any]:
    source_id = record["source_id"]
    batch_anchor = resolve_outline_anchor(source_id, record["batch_anchor"], strict=False)
    anchor_ref = resolve_outline_anchor(source_id, record["anchor_ref"], strict=False)
    from_node_id = record["from_node_id"]
    to_node_id = record["to_node_id"]
    edge_type = record["edge_type"]
    confidence = float(record.get("confidence", 0.0))
    evidence_refs = list(record.get("evidence_refs", record.get("source_refs", [])))
    status = record.get("status", default_status)
    if status not in VALID_PROPOSAL_STATUSES:
        raise SystemExit(f"Invalid proposal status '{status}' for batch '{batch_anchor}'.")

    return {
        "proposal_id": record.get("proposal_id")
        or make_proposal_id(batch_anchor, source_id, anchor_ref, from_node_id, edge_type, to_node_id),
        "batch_anchor": batch_anchor,
        "source_id": source_id,
        "anchor_ref": anchor_ref,
        "subject": record.get("subject"),
        "school_stage": record.get("school_stage"),
        "grade_band": record.get("grade_band"),
        "from_node_id": from_node_id,
        "to_node_id": to_node_id,
        "edge_type": edge_type,
        "confidence": confidence,
        "evidence_refs": evidence_refs,
        "status": status,
        "properties": record.get("properties", {}),
    }


def insert_review(connection, dataset_id: str, proposal: dict[str, Any], review_type: str, details: dict[str, Any]) -> None:
    review_id = make_review_id("relation_proposal", proposal["proposal_id"], review_type)
    now = utc_now()
    connection.execute(
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
        ) VALUES (?, ?, 'relation_proposal', ?, ?, ?, 'open', 2, ?, ?, NULL)
        """,
        (
            dataset_id,
            review_id,
            proposal["proposal_id"],
            proposal["batch_anchor"],
            review_type,
            dump_json_text(details),
            now,
        ),
    )


def store_proposal(connection, dataset_id: str, proposal: dict[str, Any], replace: bool) -> dict[str, Any]:
    existing_edges = fetch_existing_edges(connection, dataset_id)
    conflict_type, conflict_edge_id = detect_edge_conflict(proposal, existing_edges)
    writes_proposal_evidence_links = schema_supports_evidence_link_owner_type(
        connection, "relation_proposal"
    )

    final_status = proposal["status"]
    if not proposal["evidence_refs"]:
        final_status = "review"
        conflict_type = conflict_type or "missing_evidence"
    elif conflict_type == "duplicate_existing_edge":
        final_status = "rejected"
    elif conflict_type is not None:
        final_status = "review"

    if replace:
        connection.execute(
            "DELETE FROM evidence_links WHERE dataset_id = ? AND owner_type = 'relation_proposal' AND owner_id = ?",
            (dataset_id, proposal["proposal_id"]),
        )
        connection.execute(
            "DELETE FROM review_queue WHERE dataset_id = ? AND owner_type = 'relation_proposal' AND owner_id = ?",
            (dataset_id, proposal["proposal_id"]),
        )
        connection.execute(
            "DELETE FROM relation_proposals WHERE dataset_id = ? AND proposal_id = ?",
            (dataset_id, proposal["proposal_id"]),
        )

    now = utc_now()
    connection.execute(
        """
        INSERT INTO relation_proposals (
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
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
        """,
        (
            dataset_id,
            proposal["proposal_id"],
            proposal["batch_anchor"],
            proposal["source_id"],
            proposal["anchor_ref"],
            proposal["subject"],
            proposal["school_stage"],
            proposal["grade_band"],
            proposal["from_node_id"],
            proposal["to_node_id"],
            proposal["edge_type"],
            proposal["confidence"],
            dump_json_text(proposal["evidence_refs"]),
            final_status,
            conflict_type,
            conflict_edge_id,
            dump_json_text(proposal["properties"]),
            now,
        ),
    )

    if proposal["evidence_refs"] and writes_proposal_evidence_links:
        connection.executemany(
            """
            INSERT INTO evidence_links (
              dataset_id,
              owner_type,
              owner_id,
              evidence_id,
              ordinal
            ) VALUES (?, 'relation_proposal', ?, ?, ?)
            """,
            [
                (dataset_id, proposal["proposal_id"], evidence_id, ordinal)
                for ordinal, evidence_id in enumerate(proposal["evidence_refs"], start=1)
            ],
        )

    if final_status == "review":
        review_type = "missing_evidence" if (conflict_type or "") == "missing_evidence" else "conflict"
        insert_review(
            connection,
            dataset_id,
            proposal,
            review_type,
            {
                "raw_conflict_type": conflict_type,
                "conflict_with_edge_id": conflict_edge_id,
                "evidence_refs": proposal["evidence_refs"],
                "edge_type": proposal["edge_type"],
            },
        )

    return {
        "proposal_id": proposal["proposal_id"],
        "status": final_status,
        "conflict_type": conflict_type,
        "conflict_with_edge_id": conflict_edge_id,
        "proposal_evidence_links": "written" if writes_proposal_evidence_links else "json_only",
    }


def main() -> int:
    args = parse_args()
    records = load_records(Path(args.input).expanduser().resolve())
    connection = connect_db(args.db)
    ensure_sqlite_schema(connection)
    dataset_id = resolve_dataset_id(connection, args.dataset_id, args.output_root)
    require_dataset_row(connection, dataset_id)

    normalized = [normalize_record(record, args.default_status) for record in records]
    require_references(connection, dataset_id, normalized)

    results: list[dict[str, Any]] = []
    with connection:
        for proposal in normalized:
            results.append(store_proposal(connection, dataset_id, proposal, args.replace))

    for result in results:
        print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
