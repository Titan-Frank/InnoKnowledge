#!/usr/bin/env python3
"""Convert one PDF or document URL to MinerU Markdown for OKM extraction."""

from __future__ import annotations

import argparse
import http.client
import json
import os
import shutil
import sys
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

REPO_ROOT = Path(__file__).resolve().parent.parent

DEFAULT_BASE_URL = "https://mineru.net"
DEFAULT_MODEL_VERSION = "vlm"
DONE_STATES = {"done"}
FAILED_STATES = {"failed"}
PENDING_STATES = {"waiting-file", "pending", "running", "converting"}


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
    parser = argparse.ArgumentParser(description="Run MinerU and extract full.md.")
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--pdf-path", help="Local PDF/document path to upload.")
    source.add_argument("--file-url", help="HTTP(S) PDF/document URL for MinerU to fetch.")
    parser.add_argument("--book-id", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--api-key-env", default="MINERU_API_KEY")
    parser.add_argument("--base-url", default=DEFAULT_BASE_URL)
    parser.add_argument("--model-version", default=DEFAULT_MODEL_VERSION)
    parser.add_argument("--language", default="ch")
    parser.add_argument("--data-id", default="")
    parser.add_argument("--is-ocr", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--enable-formula", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--enable-table", action=argparse.BooleanOptionalAction, default=True)
    parser.add_argument("--page-ranges", default="")
    parser.add_argument("--poll-interval", type=float, default=10.0)
    parser.add_argument("--timeout", type=float, default=1800.0)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--pretty", action="store_true")
    return parser.parse_args()


def bearer_token(raw: str) -> str:
    token = raw.strip()
    if not token:
        return ""
    return token if token.lower().startswith("bearer ") else f"Bearer {token}"


def request_json(
    method: str,
    url: str,
    *,
    api_key: str,
    payload: dict[str, Any] | None = None,
    timeout: float = 60.0,
) -> dict[str, Any]:
    data = json.dumps(payload, ensure_ascii=False).encode("utf-8") if payload is not None else None
    headers = {
        "Authorization": bearer_token(api_key),
        "Accept": "*/*",
    }
    if payload is not None:
        headers["Content-Type"] = "application/json"
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"MinerU HTTP {exc.code} for {url}: {detail}") from exc


def put_file(upload_url: str, path: Path, *, timeout: float = 300.0) -> None:
    parsed = urlsplit(upload_url)
    target = parsed.path or "/"
    if parsed.query:
        target = f"{target}?{parsed.query}"
    conn_cls = http.client.HTTPSConnection if parsed.scheme == "https" else http.client.HTTPConnection
    conn = conn_cls(parsed.netloc, timeout=timeout)
    try:
        conn.request("PUT", target, body=path.read_bytes(), headers={})
        response = conn.getresponse()
        detail = response.read().decode("utf-8", errors="replace")
        if response.status < 200 or response.status >= 300:
            raise RuntimeError(f"MinerU upload failed with HTTP {response.status}: {detail}")
    finally:
        conn.close()


def common_task_payload(args: argparse.Namespace, file_payload: dict[str, Any]) -> dict[str, Any]:
    payload: dict[str, Any] = {
        "enable_formula": args.enable_formula,
        "enable_table": args.enable_table,
        "language": args.language,
        "model_version": args.model_version,
        "files": [file_payload],
    }
    if args.page_ranges:
        payload["page_ranges"] = args.page_ranges
    return payload


def submit_local_file(args: argparse.Namespace, api_key: str, pdf_path: Path) -> str:
    data_id = args.data_id or args.book_id
    payload = common_task_payload(
        args,
        {"name": pdf_path.name, "is_ocr": args.is_ocr, "data_id": data_id},
    )
    body = request_json(
        "POST",
        f"{args.base_url.rstrip('/')}/api/v4/file-urls/batch",
        api_key=api_key,
        payload=payload,
    )
    if body.get("code") != 0:
        raise RuntimeError(f"MinerU upload-url request failed: {body.get('msg') or body}")
    data = body.get("data") if isinstance(body.get("data"), dict) else {}
    batch_id = str(data.get("batch_id") or "").strip()
    file_urls = data.get("file_urls")
    if not batch_id or not isinstance(file_urls, list) or not file_urls:
        raise RuntimeError(f"MinerU returned an invalid upload-url response: {body}")

    upload_item = file_urls[0]
    if isinstance(upload_item, str):
        upload_url = upload_item
    elif isinstance(upload_item, dict):
        upload_url = str(
            upload_item.get("upload_url")
            or upload_item.get("url")
            or upload_item.get("file_url")
            or ""
        )
    else:
        upload_url = ""
    if not upload_url:
        raise RuntimeError(f"MinerU upload URL was missing: {upload_item}")
    put_file(upload_url, pdf_path)
    return batch_id


def submit_file_url(args: argparse.Namespace, api_key: str) -> str:
    payload = common_task_payload(
        args,
        {
            "url": args.file_url,
            "is_ocr": args.is_ocr,
            "data_id": args.data_id or args.book_id,
        },
    )
    body = request_json(
        "POST",
        f"{args.base_url.rstrip('/')}/api/v4/extract/task/batch",
        api_key=api_key,
        payload=payload,
    )
    if body.get("code") != 0:
        raise RuntimeError(f"MinerU task submission failed: {body.get('msg') or body}")
    data = body.get("data") if isinstance(body.get("data"), dict) else {}
    batch_id = str(data.get("batch_id") or "").strip()
    if not batch_id:
        raise RuntimeError(f"MinerU returned no batch_id: {body}")
    return batch_id


def extract_results_from_body(body: dict[str, Any]) -> list[dict[str, Any]]:
    data = body.get("data") if isinstance(body.get("data"), dict) else {}
    results = data.get("extract_result")
    if isinstance(results, list):
        return [item for item in results if isinstance(item, dict)]
    if isinstance(results, dict):
        return [results]
    return []


def select_result(results: list[dict[str, Any]], *, data_id: str, file_name: str) -> dict[str, Any]:
    for result in results:
        if data_id and str(result.get("data_id") or "") == data_id:
            return result
    for result in results:
        if file_name and str(result.get("file_name") or "") == file_name:
            return result
    if results:
        return results[0]
    return {}


def poll_for_zip_url(args: argparse.Namespace, api_key: str, batch_id: str, *, file_name: str) -> str:
    deadline = time.monotonic() + args.timeout
    data_id = args.data_id or args.book_id
    last_state = ""
    while time.monotonic() < deadline:
        body = request_json(
            "GET",
            f"{args.base_url.rstrip('/')}/api/v4/extract-results/batch/{batch_id}",
            api_key=api_key,
        )
        if body.get("code") != 0:
            raise RuntimeError(f"MinerU result polling failed: {body.get('msg') or body}")
        result = select_result(extract_results_from_body(body), data_id=data_id, file_name=file_name)
        state = str(result.get("state") or "").strip()
        last_state = state or last_state
        if state in DONE_STATES:
            zip_url = str(result.get("full_zip_url") or "").strip()
            if not zip_url:
                raise RuntimeError(f"MinerU task finished but full_zip_url was missing: {result}")
            return zip_url
        if state in FAILED_STATES:
            raise RuntimeError(str(result.get("err_msg") or "MinerU task failed."))
        if state and state not in PENDING_STATES:
            raise RuntimeError(f"MinerU returned unknown task state '{state}': {result}")
        time.sleep(max(1.0, args.poll_interval))
    raise RuntimeError(f"MinerU task timed out after {args.timeout:.0f}s; last state: {last_state or 'unknown'}")


def download_file(url: str, out_path: Path, *, timeout: float = 300.0) -> None:
    request = urllib.request.Request(url, headers={"Accept": "*/*"}, method="GET")
    with urllib.request.urlopen(request, timeout=timeout) as response:
        out_path.write_bytes(response.read())


def safe_extract_zip(zip_path: Path, target_dir: Path) -> None:
    target_dir.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(zip_path) as archive:
        for member in archive.infolist():
            destination = (target_dir / member.filename).resolve()
            if not destination.is_relative_to(target_dir.resolve()):
                raise RuntimeError(f"Refusing unsafe zip member path: {member.filename}")
        archive.extractall(target_dir)


def find_full_markdown(target_dir: Path) -> Path:
    matches = sorted(target_dir.rglob("full.md"))
    if matches:
        return matches[0]
    markdown_files = sorted(target_dir.rglob("*.md"))
    if markdown_files:
        return markdown_files[0]
    raise RuntimeError(f"No Markdown file found in MinerU zip output: {target_dir}")


def copy_markdown_for_pipeline(markdown_path: Path, output_dir: Path) -> Path:
    target = output_dir / "full.md"
    if markdown_path.resolve() != target.resolve():
        shutil.copyfile(markdown_path, target)
    for child in markdown_path.parent.iterdir():
        if not child.is_dir():
            continue
        target_child = output_dir / child.name
        if target_child.exists():
            continue
        shutil.copytree(child, target_child)
    return target


def main() -> int:
    load_dotenv_file(REPO_ROOT / ".env")
    args = parse_args()
    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    final_markdown = output_dir / "full.md"
    manifest_path = output_dir / "mineru-result.json"

    if final_markdown.exists() and not args.force:
        payload = {
            "status": "success",
            "created": False,
            "source_markdown_path": str(final_markdown),
            "manifest_path": str(manifest_path),
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2 if args.pretty else None))
        return 0

    api_key = os.environ.get(args.api_key_env, "").strip()
    if not api_key:
        raise SystemExit(f"Missing MinerU API key in environment variable {args.api_key_env}.")

    pdf_path: Path | None = None
    file_name = ""
    if args.pdf_path:
        pdf_path = Path(args.pdf_path).expanduser().resolve()
        if not pdf_path.exists():
            raise SystemExit(f"PDF not found: {pdf_path}")
        file_name = pdf_path.name
        batch_id = submit_local_file(args, api_key, pdf_path)
    else:
        file_name = Path(str(args.file_url).split("?", 1)[0]).name or f"{args.book_id}.pdf"
        batch_id = submit_file_url(args, api_key)

    zip_url = poll_for_zip_url(args, api_key, batch_id, file_name=file_name)
    zip_path = output_dir / "mineru-result.zip"
    extract_dir = output_dir / "extract"
    download_file(zip_url, zip_path)
    safe_extract_zip(zip_path, extract_dir)
    raw_markdown = find_full_markdown(extract_dir)
    source_markdown = copy_markdown_for_pipeline(raw_markdown, output_dir)

    payload = {
        "status": "success",
        "created": True,
        "book_id": args.book_id,
        "batch_id": batch_id,
        "zip_url": zip_url,
        "zip_path": str(zip_path),
        "extract_dir": str(extract_dir),
        "raw_markdown_path": str(raw_markdown),
        "source_markdown_path": str(source_markdown),
    }
    manifest_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    payload["manifest_path"] = str(manifest_path)
    print(json.dumps(payload, ensure_ascii=False, indent=2 if args.pretty else None))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
