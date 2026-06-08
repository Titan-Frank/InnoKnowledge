#!/usr/bin/env python3
"""OpenAI Responses-backed lesson extractor for the world-knowledge runtime."""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import textwrap
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from scripts.extract_lesson_local import build_artifacts as build_local_artifacts
from scripts.knowledge_store_common import (
    VALID_DOMAINS,
    VALID_EDGE_TYPES,
    VALID_KNOWLEDGE_FORMS,
    VALID_LEARNING_MODES,
    VALID_NODE_KINDS,
    make_edge_id,
    normalize_term,
    resolve_outline_anchor,
)
from scripts.okm_pathing import (
    make_domain_profile_id,
    make_lesson_run_id,
    make_node_card_id,
    resolve_chunk_or_lesson,
    safe_path_token,
)

DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1"
DEFAULT_MODEL = "gpt-4.1"
DEFAULT_TIMEOUT = 180.0


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
    parser = argparse.ArgumentParser(description="OpenAI Responses-backed lesson extractor.")
    parser.add_argument("--book-id", required=True)
    parser.add_argument("--batch-anchor", required=True)
    parser.add_argument("--output-root", required=True)
    parser.add_argument("--dataset-id", default="")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--prompt", default="")
    parser.add_argument("--subject", default="computer-science")
    parser.add_argument("--school-stage", default="higher")
    parser.add_argument("--grade-band", default="university")
    parser.add_argument("--textbook-id", default="")
    parser.add_argument("--write-staging", action="store_true")
    parser.add_argument("--skip-integrity-check", action="store_true")
    parser.add_argument("--timeout", type=float, default=DEFAULT_TIMEOUT)
    parser.add_argument("--base-url", default=DEFAULT_OPENAI_BASE_URL)
    parser.add_argument("--api-key-env", default="OPENAI_API_KEY")
    parser.add_argument("--api-mode", choices=["responses", "chat_completions"], default="responses")
    parser.add_argument("--reasoning-effort", default="")
    parser.add_argument("--retrieval-context", action="store_true")
    parser.add_argument("--retrieval-limit", type=int, default=8)
    parser.add_argument("--fallback-local-on-error", action="store_true")
    parser.add_argument("--pretty", action="store_true")
    return parser.parse_args()


def load_outline(book_id: str) -> dict[str, Any]:
    path = REPO_ROOT / "data" / "outlines" / f"{book_id}.outline.json"
    return json.loads(path.read_text(encoding="utf-8"))


def load_markdown_lines(source_path: str) -> list[str]:
    path = Path(source_path)
    if not path.is_absolute():
        path = REPO_ROOT / path
    return path.read_text(encoding="utf-8").splitlines()


def slice_markdown(book_id: str, anchor: str) -> tuple[dict[str, Any], list[str], dict[str, Any]]:
    outline = load_outline(book_id)
    source_path = outline.get("source_path")
    if not source_path:
        raise SystemExit(f"Outline for {book_id} missing source_path.")
    resolved = resolve_chunk_or_lesson(book_id, anchor)
    if resolved is None:
        raise SystemExit(f"Anchor not found: {anchor}")
    item = resolved[0] if isinstance(resolved, list) else resolved
    lines = load_markdown_lines(source_path)
    start = int(item.get("md_start", 1))
    end = int(item.get("md_end", len(lines)))
    return item, lines[max(0, start - 1): end], outline


def make_excerpt(lines: list[str], limit: int = 1200) -> str:
    text = " ".join(line.strip() for line in lines if line.strip())
    text = re.sub(r"\s+", " ", text)
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def extract_markdown_evidence_hints(lines: list[str]) -> list[dict[str, Any]]:
    hints: list[dict[str, Any]] = []
    in_equation = False
    equation_lines: list[str] = []
    table_lines: list[str] = []

    def flush_table() -> None:
        nonlocal table_lines
        if len(table_lines) >= 2:
            hints.append(
                {
                    "modality": "table",
                    "locator": f"markdown-table-{len(hints) + 1}",
                    "excerpt": "\n".join(table_lines[:12]),
                }
            )
        table_lines = []

    for line_number, raw_line in enumerate(lines, start=1):
        line = raw_line.strip()
        if not line:
            flush_table()
            continue

        if line.startswith("$$"):
            if in_equation:
                equation_lines.append(line)
                hints.append(
                    {
                        "modality": "equation",
                        "locator": f"line:{line_number}",
                        "excerpt": "\n".join(equation_lines),
                    }
                )
                equation_lines = []
                in_equation = False
            else:
                flush_table()
                equation_lines = [line]
                in_equation = not line.endswith("$$") or len(line) <= 2
                if not in_equation:
                    hints.append(
                        {
                            "modality": "equation",
                            "locator": f"line:{line_number}",
                            "excerpt": line,
                        }
                    )
                    equation_lines = []
            continue

        if in_equation:
            equation_lines.append(line)
            continue

        if re.search(r"(?<!\$)\$[^$]+\$(?!\$)", line):
            flush_table()
            hints.append(
                {
                    "modality": "equation",
                    "locator": f"line:{line_number}",
                    "excerpt": line,
                }
            )
            continue

        image_match = re.search(r"!\[([^\]]*)\]\(([^)]+)\)", line)
        if image_match:
            flush_table()
            hints.append(
                {
                    "modality": "image",
                    "locator": f"line:{line_number}",
                    "excerpt": line,
                    "caption": image_match.group(1).strip(),
                    "path": image_match.group(2).strip(),
                }
            )
            continue

        if line.startswith("|") and line.endswith("|"):
            table_lines.append(line)
            continue

        flush_table()

    flush_table()
    if in_equation and equation_lines:
        hints.append(
            {
                "modality": "equation",
                "locator": "markdown-equation-unclosed",
                "excerpt": "\n".join(equation_lines),
            }
        )
    return hints[:20]


def build_retrieval_queries(item: dict[str, Any], lines: list[str], limit: int = 6) -> list[str]:
    queries: list[str] = []
    title = str(item.get("title") or "").strip()
    if title:
        queries.append(title)
    for line in lines:
        stripped = line.strip()
        if not stripped or stripped.startswith("!") or stripped.startswith("|"):
            continue
        if stripped.startswith("#"):
            queries.append(stripped.lstrip("#").strip())
        elif len(stripped) <= 40 and not re.search(r"[。.!?？]$", stripped):
            queries.append(stripped)
        if len(queries) >= limit:
            break
    return list(dict.fromkeys(query for query in queries if query))[:limit]


def load_retrieval_candidates(args: argparse.Namespace, item: dict[str, Any], lines: list[str]) -> list[dict[str, Any]]:
    if not args.retrieval_context or not args.dataset_id:
        return []
    queries = build_retrieval_queries(item, lines)
    if not queries:
        return []
    command = [
        sys.executable,
        str(REPO_ROOT / "scripts" / "retrieve_candidates.py"),
        "--dataset-id",
        args.dataset_id,
        "--output-root",
        args.output_root,
        "--batch-anchor",
        args.batch_anchor,
        "--domain",
        args.subject,
        "--school-stage",
        args.school_stage,
        "--mode",
        "hybrid",
        "--limit",
        str(args.retrieval_limit),
        *queries,
    ]
    result = subprocess.run(command, cwd=REPO_ROOT, text=True, capture_output=True, env=os.environ.copy())
    if result.returncode != 0:
        return []
    candidates: dict[str, dict[str, Any]] = {}
    for line in result.stdout.splitlines():
        if not line.strip().startswith("{"):
            continue
        try:
            payload = json.loads(line)
        except json.JSONDecodeError:
            continue
        for candidate in payload.get("candidates", []):
            node_id = str(candidate.get("node_id") or "").strip()
            if not node_id:
                continue
            existing = candidates.get(node_id)
            if existing is None or float(candidate.get("score") or 0) > float(existing.get("score") or 0):
                candidates[node_id] = candidate
    return sorted(candidates.values(), key=lambda row: -float(row.get("score") or 0))[: args.retrieval_limit]


def _response_schema() -> dict[str, Any]:
    node_item = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "id": {"type": "string"},
            "name": {"type": "string"},
            "kind": {"type": "string", "enum": sorted(VALID_NODE_KINDS)},
            "subkind": {"type": ["string", "null"]},
            "definition": {"type": "string"},
            "aliases": {"type": "array", "items": {"type": "string"}},
            "domains": {"type": "array", "items": {"type": "string", "enum": sorted(VALID_DOMAINS)}},
            "knowledge_form": {"type": "array", "items": {"type": "string", "enum": sorted(VALID_KNOWLEDGE_FORMS)}},
            "learning_mode": {"type": "array", "items": {"type": "string", "enum": sorted(VALID_LEARNING_MODES)}},
            "scope": {"type": "string", "enum": ["universal", "domain-specific", "culture-specific"]},
            "properties": {"type": "object", "additionalProperties": True},
            "external_ids": {"type": "object", "additionalProperties": {"type": "string"}},
            "tags": {"type": "array", "items": {"type": "string"}},
            "notes": {"type": "string"},
        },
        "required": ["id", "name", "kind", "subkind", "definition", "domains", "knowledge_form", "learning_mode", "scope", "properties", "external_ids", "tags", "notes"],
    }
    edge_item = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "from": {"type": "string"},
            "to": {"type": "string"},
            "type": {"type": "string", "enum": sorted(VALID_EDGE_TYPES)},
            "directionality": {"type": "string", "enum": ["directed", "undirected"]},
            "confidence": {"type": "number"},
            "evidence_anchor": {"type": "string"},
            "notes": {"type": "string"},
        },
        "required": ["from", "to", "type", "directionality", "confidence", "evidence_anchor", "notes"],
    }
    evidence_item = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "anchor": {"type": "string"},
            "excerpt": {"type": "string"},
            "locator": {"type": "string"},
            "modality": {"type": "string", "enum": ["text", "image", "table", "equation"]},
            "node_ids": {"type": "array", "items": {"type": "string"}},
        },
        "required": ["anchor", "excerpt", "locator", "modality", "node_ids"],
    }
    domain_profile_item = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "node_id": {"type": "string"},
            "domain": {"type": "string", "enum": sorted(VALID_DOMAINS)},
            "school_stages": {"type": "array", "items": {"type": "string"}},
            "curriculum_roles": {"type": "array", "items": {"type": "string"}},
            "properties": {"type": "object", "additionalProperties": True},
        },
        "required": ["node_id", "domain", "school_stages", "curriculum_roles", "properties"],
    }
    card_item = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "node_id": {"type": "string"},
            "summary": {"type": "string"},
            "definition": {"type": "string"},
            "essence": {"type": "string"},
            "key_points": {"type": "array", "items": {"type": "string"}},
            "example": {"type": "string"},
            "application": {"type": "string"},
            "misconception": {"type": "string"},
            "evidence_anchor": {"type": "string"},
        },
        "required": ["node_id", "summary", "definition", "essence", "key_points", "example", "application", "misconception", "evidence_anchor"],
    }
    return {
        "name": "world_knowledge_lesson_bundle",
        "strict": True,
        "schema": {
            "type": "object",
            "additionalProperties": False,
            "properties": {
                "nodes": {"type": "array", "items": node_item},
                "edges": {"type": "array", "items": edge_item},
                "evidence_units": {"type": "array", "items": evidence_item},
                "domain_profiles": {"type": "array", "items": domain_profile_item},
                "node_cards": {"type": "array", "items": card_item},
                "issues": {"type": "array", "items": {"type": "string"}},
            },
            "required": ["nodes", "edges", "evidence_units", "domain_profiles", "node_cards", "issues"],
        },
    }


def _system_instructions(args: argparse.Namespace) -> str:
    extra_prompt = args.prompt.strip()
    base = """
    你是 Open Knowledge Map 项目的专用教材知识抽取器。
    任务是为当前单个 lesson/chunk 生成统一世界知识标准下的结构化候选。

    硬约束：
    1. 只处理当前一个 lesson/chunk。
    2. 先证据后知识对象：每个节点和关系都必须能落到当前 lesson 的 evidence anchor。
    3. 不要把章节编号、复习题、术语表、小结当成正式知识节点。
    4. 节点主类只能使用 9 类：entity/concept/property/process/event/method/rule/representation/resource。
    5. tag 只是辅助检索，不承担主分类；主分类靠 kind、domain、relation。
    6. 关系只允许使用 schema 合法 type，证据不足就不要编造。
    7. 输出必须严格符合 JSON schema。

    主类判断：
    - entity：具体对象、物质、人物、地点、设备、样本。
    - concept：抽象概念、理论对象、学科核心术语。
    - property：性质、属性、状态量、可观测特征。
    - process：连续过程、机制、变化过程。
    - event：具有时间边界的事件或历史事实。
    - method：步骤、算法、实验方法、操作技能。
    - rule：定律、规则、公式、原则、约束。
    - representation：图、表、模型、符号、方程、示意图。
    - resource：资料、文本、工具、数据集、媒介资源。

    关系判断：
    - is_a 用于类属关系；instance_of 用于具体实例属于某类。
    - part_of/contains 用于组成和包含。
    - has_property 用于对象具有属性。
    - uses/produces 用于方法或过程使用、产出某对象。
    - depends_on/prerequisite_for 用于依赖和先修。
    - causes/affects 用于因果和影响。
    - represents/about 用于表示对象和论述主题。
    - same_as 只用于高度确定的同一对象；不确定时用 related_to。

    学习维度判断：
    - factual：事实、名称、符号、具体信息。
    - conceptual：概念、分类、原理、结构关系。
    - procedural：步骤、算法、实验操作、解题方法。
    - metacognitive：策略选择、反思、认知监控。
    """
    if extra_prompt:
        base += f"\n补充项目提示：\n{extra_prompt}\n"
    return textwrap.dedent(base).strip()


def _build_user_payload(args: argparse.Namespace) -> str:
    item, lines, outline = slice_markdown(args.book_id, args.batch_anchor)
    anchor_ref = resolve_outline_anchor(args.book_id, args.batch_anchor, strict=True)
    retrieval_candidates = load_retrieval_candidates(args, item, lines)
    lesson_context = {
        "book_id": args.book_id,
        "textbook_id": args.textbook_id or args.book_id,
        "batch_anchor": anchor_ref,
        "lesson_run_id": make_lesson_run_id(args.book_id, anchor_ref),
        "lesson_title": item.get("title", ""),
        "subject": args.subject,
        "school_stage": args.school_stage,
        "grade_band": args.grade_band,
        "page_start": item.get("page_start"),
        "page_end": item.get("page_end"),
        "source_path": outline.get("source_path", ""),
        "markdown_excerpt_preview": make_excerpt(lines),
        "retrieval_candidates": retrieval_candidates,
        "markdown_evidence_hints": extract_markdown_evidence_hints(lines),
    }
    return json.dumps({"lesson_context": lesson_context, "markdown_lines": lines}, ensure_ascii=False, indent=2)


def _call_openai_responses(*, base_url: str, api_key: str, model: str, timeout: float, instructions: str, user_payload: str, reasoning_effort: str) -> dict[str, Any]:
    body: dict[str, Any] = {
        "model": model,
        "instructions": instructions,
        "input": [{"role": "user", "content": [{"type": "input_text", "text": user_payload}]}],
        "text": {"format": {"type": "json_schema", **_response_schema()}},
    }
    if reasoning_effort:
        body["reasoning"] = {"effort": reasoning_effort}
    payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/responses",
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def _call_openai_chat_completions(*, base_url: str, api_key: str, model: str, timeout: float, instructions: str, user_payload: str, reasoning_effort: str) -> dict[str, Any]:
    body: dict[str, Any] = {
        "model": model,
        "messages": [
            {"role": "system", "content": instructions},
            {"role": "user", "content": user_payload},
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": _response_schema(),
        },
    }
    if reasoning_effort:
        body["reasoning_effort"] = reasoning_effort
    payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
    request = urllib.request.Request(
        f"{base_url.rstrip('/')}/chat/completions",
        data=payload,
        headers={"Content-Type": "application/json", "Authorization": f"Bearer {api_key}"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode("utf-8"))


def _extract_text_output(body: dict[str, Any]) -> str:
    choices = body.get("choices")
    if isinstance(choices, list) and choices:
        message = choices[0].get("message") if isinstance(choices[0], dict) else None
        if isinstance(message, dict):
            content = message.get("content")
            if isinstance(content, str) and content.strip():
                return content
    for message in body.get("output", []):
        if not isinstance(message, dict):
            continue
        for content in message.get("content", []):
            if content.get("type") == "output_text" and isinstance(content.get("text"), str):
                return str(content["text"])
    raise ValueError("Responses API returned no output_text payload.")


def _build_payload_from_model(args: argparse.Namespace, body: dict[str, Any]) -> dict[str, Any]:
    bundle = json.loads(_extract_text_output(body))
    item, markdown_lines, outline = slice_markdown(args.book_id, args.batch_anchor)
    anchor_ref = resolve_outline_anchor(args.book_id, args.batch_anchor, strict=True)
    source_id = args.textbook_id or args.book_id
    source_path = outline.get("source_path", "")
    lesson_run_id = make_lesson_run_id(args.book_id, anchor_ref)

    nodes = []
    node_ids = set()
    for raw in bundle.get("nodes", []):
        node = {
            "id": str(raw["id"]).strip(),
            "name": str(raw["name"]).strip(),
            "kind": str(raw["kind"]).strip(),
            "subkind": raw.get("subkind"),
            "definition": str(raw["definition"]).strip(),
            "aliases": [str(item).strip() for item in raw.get("aliases", []) if str(item).strip()],
            "domains": [str(item).strip() for item in raw.get("domains", []) if str(item).strip()] or ["general"],
            "knowledge_form": [str(item).strip() for item in raw.get("knowledge_form", []) if str(item).strip()] or ["propositional"],
            "learning_mode": [str(item).strip() for item in raw.get("learning_mode", []) if str(item).strip()] or ["conceptual"],
            "scope": str(raw.get("scope") or "domain-specific"),
            "properties": raw.get("properties") if isinstance(raw.get("properties"), dict) else {},
            "external_ids": raw.get("external_ids") if isinstance(raw.get("external_ids"), dict) else {},
            "tags": [str(item).strip() for item in raw.get("tags", []) if str(item).strip()],
            "notes": str(raw.get("notes") or "").strip(),
            "status": "draft",
            "source_refs": [],
        }
        if node["id"] in node_ids:
            continue
        node_ids.add(node["id"])
        nodes.append(node)

    evidence = []
    evidence_by_anchor: dict[str, str] = {}
    for index, raw in enumerate(bundle.get("evidence_units", []), start=1):
        anchor = str(raw.get("anchor") or "").strip()
        excerpt = str(raw.get("excerpt") or "").strip()
        if not anchor or not excerpt:
            continue
        evidence_id = f"evidence:{safe_path_token(args.book_id)}:{index}"
        evidence_by_anchor[anchor] = evidence_id
        evidence.append(
            {
                "id": evidence_id,
                "source_type": "textbook",
                "source_id": source_id,
                "anchor_ref": anchor_ref,
                "source_path": source_path,
                "page_start": item.get("page_start"),
                "page_end": item.get("page_end"),
                "excerpt": excerpt,
                "locator": str(raw.get("locator") or "").strip(),
                "modality": str(raw.get("modality") or "text"),
                "extraction_method": "openai_responses",
                "normalized_claims": [excerpt[:120]],
                "properties": {},
            }
        )

    for hint_index, hint in enumerate(extract_markdown_evidence_hints(markdown_lines), start=len(evidence) + 1):
        excerpt = str(hint.get("excerpt") or "").strip()
        if not excerpt:
            continue
        evidence_id = f"evidence:{safe_path_token(args.book_id)}:hint:{hint_index}"
        evidence.append(
            {
                "id": evidence_id,
                "source_type": "textbook",
                "source_id": source_id,
                "anchor_ref": anchor_ref,
                "source_path": source_path,
                "page_start": item.get("page_start"),
                "page_end": item.get("page_end"),
                "excerpt": excerpt,
                "locator": str(hint.get("locator") or "").strip(),
                "modality": str(hint.get("modality") or "text"),
                "extraction_method": "markdown_hint",
                "normalized_claims": [excerpt[:120]],
                "properties": {key: value for key, value in hint.items() if key not in {"excerpt", "locator", "modality"}},
            }
        )

    mentions = []
    for index, raw in enumerate(bundle.get("evidence_units", []), start=1):
        evidence_id = evidence_by_anchor.get(str(raw.get("anchor") or "").strip())
        if not evidence_id:
            continue
        for node_id in raw.get("node_ids", []):
            node_id = str(node_id).strip()
            if node_id not in node_ids:
                continue
            mentions.append(
                {
                    "id": f"mention:{safe_path_token(args.book_id)}:{safe_path_token(node_id)}:{index}",
                    "source_type": "textbook",
                    "source_id": source_id,
                    "anchor_ref": anchor_ref,
                    "target_type": "node",
                    "target_id": node_id,
                    "role": "defines" if index == 1 else "focuses_on",
                    "source_refs": [evidence_id],
                    "confidence": 0.88,
                    "properties": {},
                }
            )

    edges = []
    dropped_edges = 0
    node_lookup: dict[str, str] = {}
    for node in nodes:
        node_lookup[node["id"]] = node["id"]
        node_lookup[node["name"]] = node["id"]
        node_lookup[normalize_term(node["name"])] = node["id"]
        for alias in node.get("aliases", []):
            node_lookup[alias] = node["id"]
            node_lookup[normalize_term(alias)] = node["id"]
    for raw in bundle.get("edges", []):
        raw_from = str(raw.get("from") or "").strip()
        raw_to = str(raw.get("to") or "").strip()
        from_id = node_lookup.get(raw_from) or node_lookup.get(normalize_term(raw_from)) or raw_from
        to_id = node_lookup.get(raw_to) or node_lookup.get(normalize_term(raw_to)) or raw_to
        edge_type = str(raw.get("type") or "").strip()
        if from_id not in node_ids or to_id not in node_ids or edge_type not in VALID_EDGE_TYPES:
            dropped_edges += 1
            continue
        evidence_id = evidence_by_anchor.get(str(raw.get("evidence_anchor") or "").strip(), evidence[0]["id"] if evidence else "")
        edges.append(
            {
                "id": make_edge_id(from_id, edge_type, to_id),
                "type": edge_type,
                "from": from_id,
                "to": to_id,
                "directionality": str(raw.get("directionality") or "directed"),
                "confidence": float(raw.get("confidence") or 0.8),
                "source_refs": [evidence_id] if evidence_id else [],
                "properties": {},
                "status": "draft",
                "notes": str(raw.get("notes") or "").strip(),
            }
        )

    domain_profiles = []
    for raw in bundle.get("domain_profiles", []):
        node_id = str(raw.get("node_id") or "").strip()
        domain = str(raw.get("domain") or "").strip()
        if node_id not in node_ids or domain not in VALID_DOMAINS:
            continue
        source_refs = [mention["source_refs"][0] for mention in mentions if mention["target_id"] == node_id and mention.get("source_refs")]
        domain_profiles.append(
            {
                "id": make_domain_profile_id(node_id, domain),
                "node_id": node_id,
                "domain": domain,
                "school_stages": [str(item).strip() for item in raw.get("school_stages", []) if str(item).strip()] or [args.school_stage],
                "curriculum_roles": [str(item).strip() for item in raw.get("curriculum_roles", []) if str(item).strip()] or ["core"],
                "source_refs": source_refs[:1] if source_refs else [evidence[0]["id"]] if evidence else [],
                "properties": raw.get("properties") if isinstance(raw.get("properties"), dict) else {"subject": args.subject, "grade_band": args.grade_band},
                "status": "draft",
                "notes": "",
            }
        )

    evidence_text = {item["id"]: item["excerpt"] for item in evidence}
    node_cards = []
    for raw in bundle.get("node_cards", []):
        node_id = str(raw.get("node_id") or "").strip()
        if node_id not in node_ids:
            continue
        evidence_id = evidence_by_anchor.get(str(raw.get("evidence_anchor") or "").strip(), evidence[0]["id"] if evidence else "")
        node_cards.append(
            {
                "id": make_node_card_id(node_id),
                "node_id": node_id,
                "title": next(node["name"] for node in nodes if node["id"] == node_id),
                "summary": str(raw.get("summary") or "").strip(),
                "sections": [
                    {"id": "definition", "title": "定义", "section_type": "definition", "content": [str(raw.get("definition") or evidence_text.get(evidence_id, "")).strip()], "source_refs": [evidence_id], "properties": {}},
                    {"id": "essence", "title": "核心本质", "section_type": "essence", "content": [str(raw.get("essence") or "").strip()], "source_refs": [evidence_id], "properties": {}},
                    {"id": "key-points", "title": "关键要点", "section_type": "key_points", "content": [str(item).strip() for item in raw.get("key_points", []) if str(item).strip()], "source_refs": [evidence_id], "properties": {}},
                    {"id": "example", "title": "示例", "section_type": "example", "content": [str(raw.get("example") or "").strip()], "source_refs": [evidence_id], "properties": {}},
                    {"id": "application", "title": "应用", "section_type": "application", "content": [str(raw.get("application") or "").strip()], "source_refs": [evidence_id], "properties": {}},
                    {"id": "misconception", "title": "常见误解", "section_type": "misconception", "content": [str(raw.get("misconception") or "").strip()], "source_refs": [evidence_id], "properties": {}},
                ],
                "source_refs": [evidence_id] if evidence_id else [],
                "properties": {},
                "status": "draft",
            }
        )

    return {
        "status": "success",
        "lesson_run_id": lesson_run_id,
        "book_id": args.book_id,
        "batch_anchor": anchor_ref,
        "nodes": nodes,
        "edges": edges,
        "domain_profiles": domain_profiles,
        "mentions": mentions,
        "evidence": evidence,
        "node_cards": node_cards,
        "counts": {
            "nodes": len(nodes),
            "edges": len(edges),
            "domain_profiles": len(domain_profiles),
            "mentions": len(mentions),
            "evidence": len(evidence),
            "node_cards": len(node_cards),
        },
        "issues": [str(item).strip() for item in bundle.get("issues", []) if str(item).strip()]
        + ([f"Dropped {dropped_edges} edges that could not be resolved to valid node ids or relation types."] if dropped_edges else []),
    }


def _run_local_fallback(args: argparse.Namespace, issue: str) -> dict[str, Any]:
    payload = build_local_artifacts(args)
    payload.setdefault("issues", [])
    payload["issues"] = [issue] + [str(item) for item in payload.get("issues", [])]
    return payload


def _write_staging(args: argparse.Namespace, payload: dict[str, Any]) -> dict[str, Any]:
    command = [
        "python3",
        str(REPO_ROOT / "scripts" / "store_lesson_staging.py"),
        "--root",
        args.output_root,
        "--book-id",
        args.book_id,
        "--batch-anchor",
        payload["batch_anchor"],
        "--lesson-run-id",
        payload["lesson_run_id"],
        "--dataset-id",
        args.dataset_id,
        "--nodes-json",
        json.dumps(payload["nodes"], ensure_ascii=False, separators=(",", ":")),
        "--edges-json",
        json.dumps(payload["edges"], ensure_ascii=False, separators=(",", ":")),
        "--domain-profiles-json",
        json.dumps(payload["domain_profiles"], ensure_ascii=False, separators=(",", ":")),
        "--mentions-json",
        json.dumps(payload["mentions"], ensure_ascii=False, separators=(",", ":")),
        "--evidence-json",
        json.dumps(payload["evidence"], ensure_ascii=False, separators=(",", ":")),
        "--node-cards-json",
        json.dumps(payload["node_cards"], ensure_ascii=False, separators=(",", ":")),
    ]
    if args.skip_integrity_check:
        command.append("--skip-integrity-check")
    result = subprocess.run(command, cwd=REPO_ROOT, text=True, capture_output=True, env=os.environ.copy())
    last = {}
    if result.stdout.strip():
        try:
            last = json.loads(result.stdout.strip().splitlines()[-1])
        except json.JSONDecodeError:
            last = {}
    if result.returncode != 0 and not last:
        payload["status"] = "failed"
        payload["issues"] = payload.get("issues", []) + [result.stderr.strip() or "store_lesson_staging failed"]
        return payload
    payload["status"] = last.get("status", payload["status"])
    payload["lesson_run_id"] = last.get("lesson_run_id", payload["lesson_run_id"])
    payload["issues"] = payload.get("issues", []) + [str(item) for item in last.get("issues", [])]
    payload["counts"] = last.get("counts", payload["counts"])
    return payload


def main() -> int:
    load_dotenv_file(REPO_ROOT / ".env")
    args = parse_args()
    api_key = os.environ.get(args.api_key_env, "").strip()
    try:
        if not api_key:
            raise RuntimeError(f"Missing API key in environment variable {args.api_key_env}.")
        response_body = _call_openai_responses(
            base_url=args.base_url,
            api_key=api_key,
            model=args.model,
            timeout=args.timeout,
            instructions=_system_instructions(args),
            user_payload=_build_user_payload(args),
            reasoning_effort=args.reasoning_effort,
        ) if args.api_mode == "responses" else _call_openai_chat_completions(
            base_url=args.base_url,
            api_key=api_key,
            model=args.model,
            timeout=args.timeout,
            instructions=_system_instructions(args),
            user_payload=_build_user_payload(args),
            reasoning_effort=args.reasoning_effort,
        )
        payload = _build_payload_from_model(args, response_body)
    except (RuntimeError, ValueError, urllib.error.URLError, urllib.error.HTTPError, json.JSONDecodeError) as exc:
        issue = f"OpenAI Responses extraction failed: {exc}"
        payload = _run_local_fallback(args, issue) if args.fallback_local_on_error else {"status": "blocked", "issues": [issue]}
    except Exception as exc:
        issue = f"Unexpected OpenAI extraction error: {exc}"
        payload = _run_local_fallback(args, issue) if args.fallback_local_on_error else {"status": "failed", "issues": [issue]}

    if payload.get("status") == "success" and args.write_staging:
        payload = _write_staging(args, payload)

    indent = 2 if args.pretty else None
    print(json.dumps(payload, ensure_ascii=False, indent=indent))
    return 0 if payload.get("status") == "success" else (2 if payload.get("status") == "blocked" else 1)


if __name__ == "__main__":
    raise SystemExit(main())
