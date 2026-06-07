#!/usr/bin/env python3
"""Fast PostgreSQL readiness check for the OKM harness preflight stage."""

from __future__ import annotations

import argparse
import json
import os
import socket
import sys
from pathlib import Path
from urllib.parse import urlparse

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))


def load_dotenv_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key:
            os.environ.setdefault(key, value.strip())


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Check whether DATABASE_URL is reachable.")
    parser.add_argument("--database-url", default="")
    parser.add_argument("--timeout", type=float, default=2.0)
    parser.add_argument("--require-psycopg-query", action="store_true")
    return parser.parse_args()


def socket_ready(database_url: str, timeout: float) -> dict[str, object]:
    parsed = urlparse(database_url)
    host = parsed.hostname or "localhost"
    port = parsed.port or 5432
    with socket.create_connection((host, port), timeout=timeout):
        return {"host": host, "port": port}


def psycopg_query(database_url: str) -> None:
    import psycopg  # type: ignore

    with psycopg.connect(database_url, autocommit=True) as conn:
        with conn.cursor() as cur:
            cur.execute("select 1")
            cur.fetchone()


def main() -> int:
    load_dotenv_file(REPO_ROOT / ".env")
    args = parse_args()
    database_url = (args.database_url or os.environ.get("DATABASE_URL", "")).strip()
    if not database_url:
        print(json.dumps({"status": "blocked", "issues": ["DATABASE_URL is not set."]}, ensure_ascii=False))
        return 2

    try:
        details = socket_ready(database_url, args.timeout)
        psycopg_available = False
        if args.require_psycopg_query:
            psycopg_query(database_url)
            psycopg_available = True
        print(
            json.dumps(
                {
                    "status": "success",
                    "database_url_present": True,
                    "socket_ready": True,
                    "psycopg_query_ok": psycopg_available,
                    **details,
                },
                ensure_ascii=False,
            )
        )
        return 0
    except ModuleNotFoundError as exc:
        print(
            json.dumps(
                {
                    "status": "blocked",
                    "issues": [f"psycopg is not installed in the active Python environment: {exc}"],
                },
                ensure_ascii=False,
            )
        )
        return 2
    except OSError as exc:
        print(
            json.dumps(
                {
                    "status": "blocked",
                    "issues": [f"PostgreSQL is not reachable via DATABASE_URL: {exc}"],
                },
                ensure_ascii=False,
            )
        )
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
