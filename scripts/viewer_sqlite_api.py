#!/usr/bin/env python3
"""Serve the local viewer and a SQLite-backed JSON API."""

from __future__ import annotations

import argparse
import json
import re
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import unquote, urlparse

from export_snapshot import (
    export_edges,
    export_evidence,
    export_mentions,
    export_nodes,
    export_profiles,
    load_json_array,
    load_json_object,
)
from knowledge_store_common import DEFAULT_DB_PATH, connect_db, ensure_sqlite_schema, load_json


REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_FRAMEWORK_PATH = REPO_ROOT / "data" / "frameworks" / "junior-chemistry-framework.json"
DEFAULT_PATTERNS_PATH = REPO_ROOT / "data" / "patterns" / "unified-knowledge-patterns.v2.json"
SOURCE_PATH_RE = re.compile(r"^/api/source/(?P<key>[^/]+)/(?P<kind>bundle)$")
NODE_CARD_PATH_RE = re.compile(r"^/api/source/(?P<key>[^/]+)/node-card/(?P<node_id>.+)$")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Serve viewer/ static files and a SQLite-backed local API."
    )
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--db", default=str(DEFAULT_DB_PATH))
    return parser.parse_args()


def resolve_dataset_row(connection, key: str):
    row = connection.execute(
        """
        SELECT dataset_id, version_key, root_path, is_active
        FROM datasets
        WHERE dataset_id = ? OR version_key = ?
        ORDER BY is_active DESC, dataset_id ASC
        LIMIT 1
        """,
        (key, key),
    ).fetchone()
    return row


def load_optional_json(path: Path):
    if not path.exists():
        return None
    return load_json(path)


def load_book_ids(connection, dataset_id: str) -> list[str]:
    rows = connection.execute(
        """
        SELECT DISTINCT source_id
        FROM evidence
        WHERE dataset_id = ?
          AND source_type = 'textbook'
        UNION
        SELECT DISTINCT source_id
        FROM mentions
        WHERE dataset_id = ?
          AND source_type = 'textbook'
        ORDER BY source_id
        """,
        (dataset_id, dataset_id),
    ).fetchall()
    return [row["source_id"] for row in rows]


def build_sources_payload(connection) -> dict:
    rows = connection.execute(
        """
        SELECT dataset_id, version_key, root_path, is_active
        FROM datasets
        ORDER BY is_active DESC, dataset_id ASC
        """
    ).fetchall()
    sources = []
    active_source = None
    for row in rows:
        dataset_id = row["dataset_id"]
        profile_count = connection.execute(
            "SELECT COUNT(*) AS count FROM profiles WHERE dataset_id = ?",
            (dataset_id,),
        ).fetchone()["count"]
        book_ids = load_book_ids(connection, dataset_id)
        payload = {
            "key": dataset_id,
            "label": row["version_key"].upper(),
            "description": f"SQLite dataset {dataset_id}",
            "has_profiles": profile_count > 0,
            "book_count": len(book_ids),
            "books": [{"book_id": book_id} for book_id in book_ids],
            "is_active": bool(row["is_active"]),
            "root_path": row["root_path"],
        }
        if row["is_active"]:
            active_source = dataset_id
        sources.append(payload)

    return {
        "active_source": active_source or (sources[0]["key"] if sources else None),
        "sources": sources,
    }


def build_books_payload(connection, dataset_id: str) -> list[dict]:
    mentions = [item for item in export_mentions(connection, dataset_id) if item["source_type"] == "textbook"]
    evidence = [item for item in export_evidence(connection, dataset_id) if item["source_type"] == "textbook"]
    mentions_by_book: dict[str, list[dict]] = {}
    evidence_by_book: dict[str, list[dict]] = {}

    for item in mentions:
        mentions_by_book.setdefault(item["source_id"], []).append(item)
    for item in evidence:
        evidence_by_book.setdefault(item["source_id"], []).append(item)

    book_ids = sorted(set(mentions_by_book) | set(evidence_by_book))
    books: list[dict] = []
    for book_id in book_ids:
        outline = load_optional_json(REPO_ROOT / "data" / "outlines" / f"{book_id}.outline.json")
        books.append(
            {
                "bookId": book_id,
                "outline": outline,
                "mentions": mentions_by_book.get(book_id, []),
                "evidence": evidence_by_book.get(book_id, []),
            }
        )
    return books


def build_bundle_payload(connection, dataset_id: str) -> dict:
    dataset_row = resolve_dataset_row(connection, dataset_id)
    if dataset_row is None:
        raise KeyError(dataset_id)

    framework = load_optional_json(DEFAULT_FRAMEWORK_PATH) or {"domains": []}
    patterns = load_optional_json(DEFAULT_PATTERNS_PATH) or {"patterns": []}
    profile_count = connection.execute(
        "SELECT COUNT(*) AS count FROM profiles WHERE dataset_id = ?",
        (dataset_id,),
    ).fetchone()["count"]

    return {
        "source": {
            "key": dataset_row["dataset_id"],
            "label": dataset_row["version_key"].upper(),
            "description": f"SQLite dataset {dataset_row['dataset_id']}",
            "hasProfiles": profile_count > 0,
            "isActive": bool(dataset_row["is_active"]),
            "rootPath": dataset_row["root_path"],
            "nodeCardPath": f"/api/source/{dataset_row['dataset_id']}/node-card",
        },
        "nodes": export_nodes(connection, dataset_row["dataset_id"]),
        "edges": export_edges(connection, dataset_row["dataset_id"]),
        "profiles": export_profiles(connection, dataset_row["dataset_id"]),
        "framework": framework,
        "patterns": patterns,
        "books": build_books_payload(connection, dataset_row["dataset_id"]),
        "loadWarnings": [],
    }


def load_node_card(connection, dataset_id: str, node_id: str) -> dict | None:
    row = connection.execute(
        """
        SELECT *
        FROM node_cards
        WHERE dataset_id = ? AND node_id = ?
        LIMIT 1
        """,
        (dataset_id, node_id),
    ).fetchone()
    if row is None:
        return None
    payload = {
        "node_id": row["node_id"],
        "card_layer": row["card_layer"],
        "title": row["title"],
        "summary": row["summary"],
        "pattern_refs": load_json_array(row["pattern_refs_json"]),
        "framework_refs": load_json_array(row["framework_refs_json"]),
        "profile_refs": load_json_array(row["profile_refs_json"]),
        "mention_refs": load_json_array(row["mention_refs_json"]),
        "source_refs": load_json_array(row["source_refs_json"]),
        "sections": load_json_array(row["sections_json"]),
        "properties": load_json_object(row["properties_json"]),
        "status": row["status"],
    }
    if row["id"] is not None:
        payload["id"] = row["id"]
    if row["updated_at"] is not None:
        payload["updated_at"] = row["updated_at"]
    return payload


class ViewerApiHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, db_path: Path, **kwargs):
        self.db_path = db_path
        super().__init__(*args, directory=str(REPO_ROOT), **kwargs)

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path == "/":
            self.send_response(HTTPStatus.FOUND)
            self.send_header("Location", "/viewer/")
            self.end_headers()
            return
        if parsed.path.startswith("/api/"):
            self.handle_api(parsed.path)
            return
        super().do_GET()

    def handle_api(self, path: str) -> None:
        connection = connect_db(self.db_path)
        ensure_sqlite_schema(connection)
        try:
            if path == "/api/health":
                self.write_json({"ok": True, "db": str(self.db_path)})
                return
            if path == "/api/meta":
                self.write_json(build_sources_payload(connection))
                return

            source_match = SOURCE_PATH_RE.match(path)
            if source_match:
                key = unquote(source_match.group("key"))
                dataset_row = resolve_dataset_row(connection, key)
                if dataset_row is None:
                    self.write_json({"error": f"Unknown source '{key}'"}, status=HTTPStatus.NOT_FOUND)
                    return
                self.write_json(build_bundle_payload(connection, dataset_row["dataset_id"]))
                return

            card_match = NODE_CARD_PATH_RE.match(path)
            if card_match:
                key = unquote(card_match.group("key"))
                node_id = unquote(card_match.group("node_id"))
                dataset_row = resolve_dataset_row(connection, key)
                if dataset_row is None:
                    self.write_json({"error": f"Unknown source '{key}'"}, status=HTTPStatus.NOT_FOUND)
                    return
                card = load_node_card(connection, dataset_row["dataset_id"], node_id)
                if card is None:
                    self.write_json({"error": f"Node card not found for '{node_id}'"}, status=HTTPStatus.NOT_FOUND)
                    return
                self.write_json(card)
                return

            self.write_json({"error": f"Unknown API path '{path}'"}, status=HTTPStatus.NOT_FOUND)
        finally:
            connection.close()

    def write_json(self, payload: dict, *, status: HTTPStatus = HTTPStatus.OK) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> int:
    args = parse_args()
    db_path = Path(args.db).expanduser().resolve()

    def handler(*handler_args, **handler_kwargs):
        return ViewerApiHandler(*handler_args, db_path=db_path, **handler_kwargs)

    server = ThreadingHTTPServer((args.host, args.port), handler)
    print(f"Viewer API listening on http://{args.host}:{args.port}/viewer/")
    print(f"SQLite DB: {db_path}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
