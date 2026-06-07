#!/usr/bin/env python3
"""Dependency-light path, id, and outline helpers for the OKM harness."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any, Iterable

REPO_ROOT = Path(__file__).resolve().parent.parent
OUTLINES_DIR = REPO_ROOT / "data" / "outlines"
ANCHOR_ID_PATTERN = re.compile(r"^struct:(?P<book_id>[^:]+):(?P<kind>[^:]+):(?P<local>.+)$")


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def normalize_term(value: str) -> str:
    return re.sub(r"\s+", " ", value.strip().lower())


def make_stable_suffix(*parts: str, length: int = 16) -> str:
    digest = hashlib.sha1("||".join(parts).encode("utf-8")).hexdigest()
    return digest[:length]


def make_edge_id(from_node_id: str, edge_type: str, to_node_id: str) -> str:
    suffix = make_stable_suffix(from_node_id, edge_type, to_node_id, length=12)
    return f"edge:auto-{suffix}"


def make_lesson_run_id(book_id: str, batch_anchor: str) -> str:
    suffix = make_stable_suffix(book_id, batch_anchor, length=12)
    return f"lesson-run:{suffix}"


def make_profile_id(node_id: str, context_key: str) -> str:
    suffix = make_stable_suffix(node_id, context_key, length=12)
    return f"profile:auto-{suffix}"


def make_domain_profile_id(node_id: str, domain: str) -> str:
    suffix = make_stable_suffix(node_id, domain, length=12)
    return f"domain-profile:auto-{suffix}"


def make_node_card_id(node_id: str) -> str:
    suffix = make_stable_suffix(node_id, length=12)
    return f"node-card:auto-{suffix}"


def safe_path_token(value: str) -> str:
    token = re.sub(r"[^a-zA-Z0-9._-]+", "__", value.strip())
    token = token.strip("._")
    return token or "item"


def unique_stable(values: Iterable[str]) -> list[str]:
    result: list[str] = []
    seen: set[str] = set()
    for value in values:
        if value in seen:
            continue
        seen.add(value)
        result.append(value)
    return result


def outline_path_for_book(book_id: str) -> Path:
    return OUTLINES_DIR / f"{book_id}.outline.json"


def iter_outline_items(items: Iterable[dict[str, Any]]) -> Iterable[dict[str, Any]]:
    queue = list(items)
    while queue:
        item = queue.pop(0)
        if not isinstance(item, dict):
            continue
        yield item
        children = item.get("children")
        if isinstance(children, list):
            queue.extend(child for child in children if isinstance(child, dict))


def load_outline_items(book_id: str) -> list[dict[str, Any]]:
    outline_path = outline_path_for_book(book_id)
    if not outline_path.exists():
        return []
    outline = load_json(outline_path)
    if isinstance(outline, dict):
        items = outline.get("structure", outline.get("items", []))
    else:
        items = []
    return list(iter_outline_items(items))


def anchor_token_variants(anchor_id: str, book_id: str | None = None) -> list[str]:
    variants = [anchor_id]
    match = ANCHOR_ID_PATTERN.match(anchor_id)
    if match and (book_id is None or match.group("book_id") == book_id):
        kind = match.group("kind")
        local = match.group("local")
        scoped = f"{kind}:{local}"
        variants.extend([scoped, scoped.replace(":", "-", 1), local])
    return unique_stable(variants)


def resolve_outline_anchor(book_id: str, anchor: str, *, strict: bool = False) -> str:
    items = load_outline_items(book_id)
    if not items:
        if strict:
            raise SystemExit(
                f"Outline not found for book '{book_id}': {outline_path_for_book(book_id)}"
            )
        return anchor

    by_id = {item["id"]: item for item in items if item.get("id")}
    if anchor in by_id:
        return anchor

    matches = unique_stable(
        item_id for item_id in by_id if anchor in anchor_token_variants(item_id, book_id)
    )
    if len(matches) == 1:
        return matches[0]
    if matches and strict:
        preview = ", ".join(matches[:5])
        raise SystemExit(
            f"Anchor '{anchor}' is ambiguous for book '{book_id}'. Matches: {preview}"
        )
    if strict:
        sample = ", ".join(sorted(by_id)[:5])
        raise SystemExit(
            f"Anchor '{anchor}' was not found in outline for book '{book_id}'. Use a canonical outline id such as: {sample}"
        )
    return anchor


def resolve_chunk_or_lesson(book_id: str, anchor: str) -> list[dict[str, Any]] | dict[str, Any] | None:
    items = load_outline_items(book_id)
    by_id = {item["id"]: item for item in items if item.get("id")}
    resolved = resolve_outline_anchor(book_id, anchor, strict=False)
    if resolved not in by_id:
        return None
    item = by_id[resolved]
    if item.get("kind") == "chunk":
        return item
    chunks = [candidate for candidate in items if candidate.get("parent_id") == resolved and candidate.get("kind") == "chunk"]
    if chunks:
        return sorted(chunks, key=lambda candidate: candidate.get("order_path", ""))
    return item
