#!/usr/bin/env python3
"""Promote accepted relation proposals into canonical edges conservatively."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from knowledge_store_common import (
    DEFAULT_DB_PATH,
    connect_db,
    detect_edge_conflict,
    dump_json_text,
    ensure_sqlite_schema,
    fetch_existing_edges,
    make_edge_id,
    make_review_id,
    require_dataset_row,
    resolve_dataset_id,
    utc_now,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Promote accepted relation proposals into canonical edges."
    )
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH))
    parser.add_argument("--dataset-id")
    parser.add_argument("--output-root")
    parser.add_argument("--batch-anchor")
    parser.add_argument(
        "--proposal-id",
        action="append",
        dest="proposal_ids",
        help="Specific proposal id(s) to promote.",
    )
    parser.add_argument(
        "--include-candidate",
        action="store_true",
        help="Also consider candidate proposals that are evidence-backed and conflict-free.",
    )
    parser.add_argument(
        "--export-edges-json",
        action="store_true",
        help="Upsert promoted edges back into <output-root>/graph/knowledge.edges.jsonl.",
    )
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def insert_review(connection, dataset_id: str, proposal_row, review_type: str, details: dict) -> None:
    review_id = make_review_id("relation_proposal", proposal_row["proposal_id"], review_type)
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
            proposal_row["proposal_id"],
            proposal_row["batch_anchor"],
            review_type,
            dump_json_text(details),
            now,
        ),
    )


def select_proposals(connection, dataset_id: str, args: argparse.Namespace):
    statuses = ["accepted"]
    if args.include_candidate:
        statuses.append("candidate")

    where = ["dataset_id = ?", f"status IN ({','.join('?' for _ in statuses)})"]
    params = [dataset_id, *statuses]
    if args.batch_anchor:
        where.append("batch_anchor = ?")
        params.append(args.batch_anchor)
    if args.proposal_ids:
        where.append(f"proposal_id IN ({','.join('?' for _ in args.proposal_ids)})")
        params.extend(args.proposal_ids)

    sql = (
        "SELECT * FROM relation_proposals WHERE "
        + " AND ".join(where)
        + " ORDER BY batch_anchor, proposal_id"
    )
    return connection.execute(sql, params).fetchall()


def edge_row_to_json(edge_row) -> dict:
    return {
        "id": edge_row["id"],
        "edge_type": edge_row["edge_type"],
        "edge_layer": edge_row["edge_layer"],
        "backbone_expand": bool(edge_row["backbone_expand"]),
        "from": edge_row["from_id"],
        "to": edge_row["to_id"],
        "confidence": edge_row["confidence"],
        "directionality": edge_row["directionality"],
        "framework_refs": json.loads(edge_row["framework_refs_json"] or "[]"),
        "profile_refs": json.loads(edge_row["profile_refs_json"] or "[]"),
        "source_refs": json.loads(edge_row["source_refs_json"] or "[]"),
        "properties": json.loads(edge_row["properties_json"] or "{}"),
        "status": edge_row["status"],
        "created_at": edge_row["created_at"],
        "updated_at": edge_row["updated_at"],
    }


def export_edges_json(connection, dataset_id: str, output_root: str, edge_ids: list[str]) -> None:
    if not edge_ids:
        return

    rows = connection.execute(
        f"""
        SELECT *
        FROM edges
        WHERE dataset_id = ?
          AND id IN ({','.join('?' for _ in edge_ids)})
        ORDER BY id
        """,
        (dataset_id, *edge_ids),
    ).fetchall()
    if not rows:
        return

    edges_path = Path(output_root).expanduser().resolve() / "graph" / "knowledge.edges.jsonl"
    if not edges_path.exists():
        raise SystemExit(f"Cannot export promoted edges because file is missing: {edges_path}")

    existing_rows: list[dict] = []
    by_id: dict[str, dict] = {}
    for line in edges_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line:
            continue
        row = json.loads(line)
        existing_rows.append(row)
        by_id[row["id"]] = row

    updated_rows = [edge_row_to_json(row) for row in rows]
    updated_ids = {row["id"] for row in updated_rows}

    merged_rows: list[dict] = []
    seen_ids: set[str] = set()
    for row in existing_rows:
        row_id = row["id"]
        if row_id in updated_ids:
            merged_rows.append(next(updated for updated in updated_rows if updated["id"] == row_id))
        else:
            merged_rows.append(row)
        seen_ids.add(row_id)

    for row in updated_rows:
        if row["id"] not in seen_ids:
            merged_rows.append(row)

    edges_path.write_text(
        "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in merged_rows),
        encoding="utf-8",
    )


def main() -> int:
    args = parse_args()
    connection = connect_db(args.db)
    ensure_sqlite_schema(connection)
    dataset_id = resolve_dataset_id(connection, args.dataset_id, args.output_root)
    require_dataset_row(connection, dataset_id)

    proposals = select_proposals(connection, dataset_id, args)
    existing_edges = fetch_existing_edges(connection, dataset_id)
    results: list[dict[str, str]] = []
    promoted_edge_ids: list[str] = []

    if args.export_edges_json and not args.output_root:
        raise SystemExit("--export-edges-json requires --output-root.")

    with connection:
        for proposal in proposals:
            evidence_refs = json.loads(proposal["evidence_refs_json"])
            proposal_payload = {
                "from_node_id": proposal["from_node_id"],
                "to_node_id": proposal["to_node_id"],
                "edge_type": proposal["edge_type"],
            }
            conflict_type, conflict_edge_id = detect_edge_conflict(proposal_payload, existing_edges)

            if not evidence_refs:
                if not args.dry_run:
                    connection.execute(
                        """
                        UPDATE relation_proposals
                        SET status = 'review',
                            conflict_type = 'missing_evidence'
                        WHERE dataset_id = ? AND proposal_id = ?
                        """,
                        (dataset_id, proposal["proposal_id"]),
                    )
                    insert_review(
                        connection,
                        dataset_id,
                        proposal,
                        "missing_evidence",
                        {"proposal_id": proposal["proposal_id"]},
                    )
                results.append(
                    {
                        "proposal_id": proposal["proposal_id"],
                        "result": "review",
                        "reason": "missing_evidence",
                    }
                )
                continue

            if conflict_type == "duplicate_existing_edge":
                results.append(
                    {
                        "proposal_id": proposal["proposal_id"],
                        "result": "skipped",
                        "reason": "duplicate_existing_edge",
                        "edge_id": conflict_edge_id or "",
                    }
                )
                continue

            if conflict_type is not None:
                if not args.dry_run:
                    connection.execute(
                        """
                        UPDATE relation_proposals
                        SET status = 'review',
                            conflict_type = ?,
                            conflict_with_edge_id = ?
                        WHERE dataset_id = ? AND proposal_id = ?
                        """,
                        (conflict_type, conflict_edge_id, dataset_id, proposal["proposal_id"]),
                    )
                    insert_review(
                        connection,
                        dataset_id,
                        proposal,
                        "conflict",
                        {
                            "proposal_id": proposal["proposal_id"],
                            "conflict_type": conflict_type,
                            "conflict_with_edge_id": conflict_edge_id,
                        },
                    )
                results.append(
                    {
                        "proposal_id": proposal["proposal_id"],
                        "result": "review",
                        "reason": conflict_type,
                        "edge_id": conflict_edge_id or "",
                    }
                )
                continue

            properties = json.loads(proposal["properties_json"])
            edge_id = properties.get("edge_id") or make_edge_id(
                proposal["from_node_id"], proposal["edge_type"], proposal["to_node_id"]
            )
            edge_layer = properties.get("edge_layer", "backbone")
            backbone_expand = int(bool(properties.get("backbone_expand", False)))
            directionality = properties.get("directionality", "directed")
            framework_refs = properties.get("framework_refs", [])
            profile_refs = properties.get("profile_refs", [])

            if not args.dry_run:
                now = utc_now()
                connection.execute(
                    """
                    INSERT INTO edges (
                      dataset_id,
                      id,
                      edge_type,
                      edge_layer,
                      backbone_expand,
                      from_id,
                      to_id,
                      directionality,
                      confidence,
                      framework_refs_json,
                      profile_refs_json,
                      source_refs_json,
                      properties_json,
                      status,
                      created_at,
                      updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
                    """,
                    (
                        dataset_id,
                        edge_id,
                        proposal["edge_type"],
                        edge_layer,
                        backbone_expand,
                        proposal["from_node_id"],
                        proposal["to_node_id"],
                        directionality,
                        proposal["confidence"],
                        dump_json_text(framework_refs),
                        dump_json_text(profile_refs),
                        dump_json_text(evidence_refs),
                        dump_json_text(
                            {
                                **properties,
                                "promoted_from_proposal": proposal["proposal_id"],
                                "proposal_batch_anchor": proposal["batch_anchor"],
                            }
                        ),
                        now,
                        now,
                    ),
                )
                connection.executemany(
                    """
                    INSERT INTO evidence_links (
                      dataset_id,
                      owner_type,
                      owner_id,
                      evidence_id,
                      ordinal
                    ) VALUES (?, 'edge', ?, ?, ?)
                    """,
                    [
                        (dataset_id, edge_id, evidence_id, ordinal)
                        for ordinal, evidence_id in enumerate(evidence_refs, start=1)
                    ],
                )
                connection.execute(
                    """
                    UPDATE relation_proposals
                    SET status = 'accepted',
                        conflict_type = NULL,
                        conflict_with_edge_id = NULL,
                        resolved_at = ?
                    WHERE dataset_id = ? AND proposal_id = ?
                    """,
                    (now, dataset_id, proposal["proposal_id"]),
                )

            existing_edges.append(
                {
                    "id": edge_id,
                    "edge_type": proposal["edge_type"],
                    "from_id": proposal["from_node_id"],
                    "to_id": proposal["to_node_id"],
                    "directionality": directionality,
                    "confidence": proposal["confidence"],
                    "status": "active",
                }
            )
            promoted_edge_ids.append(edge_id)
            results.append(
                {
                    "proposal_id": proposal["proposal_id"],
                    "result": "promoted" if not args.dry_run else "would_promote",
                    "edge_id": edge_id,
                }
            )

    if args.export_edges_json and not args.dry_run:
        export_edges_json(connection, dataset_id, args.output_root, promoted_edge_ids)

    for result in results:
        print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
