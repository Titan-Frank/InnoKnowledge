#!/usr/bin/env python3
"""Upgrade runtime SQLite tables when an older database is missing new owner types."""

from __future__ import annotations

import argparse

from knowledge_store_common import (
    DEFAULT_DB_PATH,
    connect_db,
    ensure_sqlite_schema,
    schema_supports_evidence_link_owner_type,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Upgrade older runtime SQLite tables to the latest retrieval-first schema."
    )
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH))
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Apply table rebuilds when legacy constraints are detected.",
    )
    return parser.parse_args()


def rebuild_evidence_links(connection) -> None:
    connection.execute("DROP INDEX IF EXISTS idx_evidence_links_owner")
    connection.execute("DROP INDEX IF EXISTS idx_evidence_links_evidence")
    connection.execute("ALTER TABLE evidence_links RENAME TO evidence_links__old")
    connection.execute(
        """
        CREATE TABLE evidence_links (
          dataset_id TEXT NOT NULL,
          owner_type TEXT NOT NULL CHECK (
            owner_type IN (
              'edge',
              'profile',
              'mention',
              'card',
              'card_section',
              'relation_proposal'
            )
          ),
          owner_id TEXT NOT NULL,
          evidence_id TEXT NOT NULL,
          ordinal INTEGER,
          PRIMARY KEY (dataset_id, owner_type, owner_id, evidence_id),
          FOREIGN KEY (dataset_id, evidence_id) REFERENCES evidence(dataset_id, id) ON DELETE CASCADE
        )
        """
    )
    connection.execute(
        """
        INSERT INTO evidence_links (
          dataset_id,
          owner_type,
          owner_id,
          evidence_id,
          ordinal
        )
        SELECT
          dataset_id,
          owner_type,
          owner_id,
          evidence_id,
          ordinal
        FROM evidence_links__old
        """
    )
    connection.execute(
        """
        CREATE INDEX idx_evidence_links_owner
        ON evidence_links(dataset_id, owner_type, owner_id)
        """
    )
    connection.execute(
        """
        CREATE INDEX idx_evidence_links_evidence
        ON evidence_links(dataset_id, evidence_id)
        """
    )
    connection.execute("DROP TABLE evidence_links__old")


def main() -> int:
    args = parse_args()
    connection = connect_db(args.db)
    ensure_sqlite_schema(connection)

    supports_relation_proposal = schema_supports_evidence_link_owner_type(
        connection, "relation_proposal"
    )
    if supports_relation_proposal:
        print("Schema already supports relation_proposal evidence links.")
        return 0

    print("Legacy schema detected: evidence_links is missing owner_type 'relation_proposal'.")
    if not args.apply:
        print("Re-run with --apply to rebuild evidence_links in place.")
        return 1

    with connection:
        rebuild_evidence_links(connection)

    print("Upgraded evidence_links to support relation_proposal owner rows.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
