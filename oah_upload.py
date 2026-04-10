#!/usr/bin/env python3
"""Upload files to OAH workspace via API."""

import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

OAH_BASE = "http://10.11.20.89:8787"
WS_ID = "ws_ce531b3571e84592b8d672b0546f21c2"
PROJECT_ROOT = Path(__file__).parent

BINARY_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".zip", ".tar", ".gz", ".db", ".sqlite", ".xlsx"}


def api_json(method, path, body=None):
    url = f"{OAH_BASE}{path}"
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, timeout=30) as resp:
        text = resp.read().decode()
        return json.loads(text) if text else {}


def api_upload(path, remote_path, file_path):
    """Upload binary file via PUT /files/upload."""
    qs = urllib.parse.urlencode({"path": remote_path})
    url = f"{OAH_BASE}/api/v1/workspaces/{WS_ID}/files/upload?{qs}"
    with open(file_path, "rb") as f:
        data = f.read()
    req = urllib.request.Request(url, data=data, method="PUT")
    req.add_header("Content-Type", "application/octet-stream")
    with urllib.request.urlopen(req, timeout=60) as resp:
        return resp.status == 200


def mkdir(remote_path):
    try:
        api_json("POST", f"/api/v1/workspaces/{WS_ID}/directories",
                 {"path": remote_path, "createParents": True})
    except urllib.error.HTTPError:
        pass  # already exists is fine


def upload_file(local_path, remote_path):
    """Upload a single file. Returns True on success."""
    if local_path.suffix.lower() in BINARY_EXTS:
        return api_upload(f"/api/v1/workspaces/{WS_ID}/files/upload", remote_path, local_path)
    else:
        try:
            content = local_path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            return api_upload(f"/api/v1/workspaces/{WS_ID}/files/upload", remote_path, local_path)
        api_json("PUT", f"/api/v1/workspaces/{WS_ID}/files/content", {
            "path": remote_path,
            "content": content,
        })
        return True


def upload_tree(local_dir, remote_prefix="", skip_dirs=None, skip_exts=None):
    """Upload a directory tree."""
    skip_dirs = skip_dirs or set()
    skip_exts = skip_exts or set()
    created_dirs = set()
    ok, fail = 0, 0

    for root, dirs, files in os.walk(local_dir):
        root_path = Path(root)
        dirs[:] = [d for d in dirs if d not in skip_dirs]

        for fname in sorted(files):
            fpath = root_path / fname
            if fpath.suffix in skip_exts or fname == ".DS_Store":
                continue

            rel = fpath.relative_to(local_dir).as_posix()
            remote = f"{remote_prefix}/{rel}" if remote_prefix else rel

            # Ensure parent dir
            parent = str(Path(remote).parent)
            if parent != "." and parent not in created_dirs:
                mkdir(parent)
                created_dirs.add(parent)

            try:
                upload_file(fpath, remote)
                ok += 1
            except Exception as e:
                print(f"  FAIL {remote}: {e}")
                fail += 1

    return ok, fail


def upload_file_list(file_list, label=""):
    """Upload a list of (local_path, remote_path) tuples."""
    created_dirs = set()
    ok, fail = 0, 0

    for local, remote in file_list:
        parent = str(Path(remote).parent)
        if parent != "." and parent not in created_dirs:
            mkdir(parent)
            created_dirs.add(parent)
        try:
            upload_file(Path(local), remote)
            ok += 1
        except Exception as e:
            print(f"  FAIL {remote}: {e}")
            fail += 1

    return ok, fail


if __name__ == "__main__":
    what = sys.argv[1] if len(sys.argv) > 1 else "all"

    if what in ("config", "all"):
        print("=== Uploading .openharness/ config ===")
        ok, fail = upload_tree(
            PROJECT_ROOT / ".openharness",
            remote_prefix=".openharness",
        )
        print(f"  {ok} ok, {fail} failed")

    if what in ("context", "all"):
        print("=== Uploading project context ===")
        files = []
        for f in ["AGENTS.md"]:
            p = PROJECT_ROOT / f
            if p.exists():
                files.append((p, f))
        g = PROJECT_ROOT / ".claude/GLOSSARY.md"
        if g.exists():
            files.append((g, ".claude/GLOSSARY.md"))
        for f in (PROJECT_ROOT / "schemas").rglob("*"):
            if f.is_file() and f.suffix in (".json", ".sql"):
                rel = f.relative_to(PROJECT_ROOT).as_posix()
                files.append((f, rel))
        ok, fail = upload_file_list(files)
        print(f"  {ok} ok, {fail} failed")

    if what in ("scripts", "all"):
        print("=== Uploading scripts/ ===")
        ok, fail = upload_tree(
            PROJECT_ROOT / "scripts",
            remote_prefix="scripts",
        )
        print(f"  {ok} ok, {fail} failed")

    if what in ("data", "all"):
        print("=== Uploading data/ ===")
        ok, fail = upload_tree(
            PROJECT_ROOT / "data",
            remote_prefix="data",
        )
        print(f"  {ok} ok, {fail} failed")

    if what in ("ocr", "all"):
        print("=== Uploading ocr/ (this may take a while...) ===")
        ok, fail = upload_tree(
            PROJECT_ROOT / "ocr",
            remote_prefix="ocr",
            skip_dirs={"__pycache__"},
        )
        print(f"  {ok} ok, {fail} failed")

    if what == "verify":
        print("=== Verifying catalog ===")
        cat = api_json("GET", f"/api/v1/workspaces/{WS_ID}/catalog")
        agents = [a["name"] for a in cat.get("agents", [])]
        skills = [s["name"] for s in cat.get("skills", [])]
        models = [m["ref"] for m in cat.get("models", [])]
        print(f"  Agents: {agents}")
        print(f"  Skills: {skills}")
        print(f"  Models: {models}")
