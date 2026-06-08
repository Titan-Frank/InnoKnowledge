#!/usr/bin/env python3
"""Local rule-based lesson extractor for the world-knowledge runtime."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from scripts.knowledge_store_common import (
    make_edge_id,
    normalize_term,
    resolve_outline_anchor,
)
from scripts.okm_pathing import (
    load_outline_items,
    make_domain_profile_id,
    make_lesson_run_id,
    make_node_card_id,
    resolve_chunk_or_lesson,
    safe_path_token,
)

HEADING_RE = re.compile(r"^(#{1,6})\s+(.+?)\s*$")
TOKEN_RE = re.compile(r"[A-Za-z][A-Za-z0-9./_-]{2,}|[\u4e00-\u9fff]{2,}")
STOPWORDS = {
    "chapter", "section", "example", "figure", "table", "network", "computer",
    "我们", "你们", "以及", "或者", "因为", "这个", "那个", "进行", "通过",
    "可以", "包括", "一个", "一种", "中的", "对于", "the", "and", "for", "with",
}
SKIP_TITLES = {"习题", "问题", "术语表", "参考文献", "本章小结", "小结", "复习题"}


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Extract one lesson locally.")
    parser.add_argument("--book-id", required=True)
    parser.add_argument("--batch-anchor", required=True)
    parser.add_argument("--output-root", required=True)
    parser.add_argument("--dataset-id", default="")
    parser.add_argument("--subject", default="computer-science")
    parser.add_argument("--school-stage", default="higher")
    parser.add_argument("--grade-band", default="university")
    parser.add_argument("--textbook-id", default="")
    parser.add_argument("--write-staging", action="store_true")
    parser.add_argument("--skip-integrity-check", action="store_true")
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


def clean_heading_title(title: str) -> str:
    title = re.sub(r"^[第章节一二三四五六七八九十0-9.\s]+", "", title).strip()
    return re.sub(r"\s+", " ", title)


def make_excerpt(lines: list[str], limit: int = 280) -> str:
    text = " ".join(line.strip() for line in lines if line.strip())
    text = re.sub(r"\s+", " ", text)
    return text if len(text) <= limit else text[: limit - 1].rstrip() + "…"


def extract_image_hints(lines: list[str]) -> list[dict[str, str]]:
    hints: list[dict[str, str]] = []
    for line_number, raw_line in enumerate(lines, start=1):
        for match in re.finditer(r"!\[([^\]]*)\]\(([^)]+)\)", raw_line):
            image_path = match.group(2).strip()
            if not image_path:
                continue
            hints.append(
                {
                    "caption": match.group(1).strip(),
                    "path": image_path,
                    "locator": f"line:{line_number}",
                    "excerpt": match.group(0),
                }
            )
    return hints[:30]


def top_aliases(lines: list[str], title: str) -> list[str]:
    tokens: list[str] = []
    for line in lines[:12]:
        tokens.extend(TOKEN_RE.findall(line))
    result: list[str] = []
    for token in tokens:
        lowered = token.lower()
        if lowered in STOPWORDS or token == title or len(token) < 2 or len(token) > 40 or " " in token:
            continue
        if token not in result:
            result.append(token)
        if len(result) >= 4:
            break
    return result


def extract_sections(lines: list[str]) -> list[dict[str, Any]]:
    sections: list[dict[str, Any]] = []
    current_title = "lesson-overview"
    current_lines: list[str] = []
    current_heading = ""
    for line in lines:
        heading = HEADING_RE.match(line)
        if heading:
            if current_lines:
                sections.append({"title": current_title, "heading": current_heading, "lines": current_lines[:]})
            current_heading = heading.group(2).strip()
            current_title = clean_heading_title(current_heading) or current_heading
            current_lines = []
        else:
            current_lines.append(line)
    if current_lines:
        sections.append({"title": current_title, "heading": current_heading, "lines": current_lines[:]})
    return [section for section in sections if any(line.strip() for line in section["lines"])]


def classify_node(title: str, heading: str) -> tuple[str, str | None]:
    lowered = f"{title} {heading}".lower()
    if any(key in lowered for key in ("figure", "图", "表", "format", "header")):
        return "representation", None
    if any(key in lowered for key in ("protocol", "协议", "algorithm", "算法", "method", "方法")):
        return "method", None
    if any(key in lowered for key in ("law", "定律", "principle", "原理", "theorem", "规则")):
        return "rule", None
    if any(key in lowered for key in ("flow", "过程", "routing", "转发", "reaction", "cycle")):
        return "process", None
    if any(key in lowered for key in ("resource", "教材", "文献", "工具")):
        return "resource", None
    if any(key in lowered for key in ("router", "switch", "network", "queue", "plane", "layer")):
        return "entity", None
    return "concept", None


def infer_domains(subject: str) -> list[str]:
    if subject in {"computer-science", "chemistry", "physics", "biology", "mathematics"}:
        return [subject]
    return ["general"]


def infer_knowledge_form(kind: str) -> list[str]:
    return ["practical"] if kind in {"method", "resource"} else ["propositional"]


def infer_learning_mode(title: str, kind: str) -> list[str]:
    lowered = title.lower()
    modes = ["conceptual"] if kind not in {"entity", "representation"} else ["factual"]
    if kind == "method" or any(word in lowered for word in ("实验", "步骤", "how", "实现")):
        modes.append("procedural")
    if any(word in lowered for word in ("策略", "反思", "检查", "总结", "review", "self-check")):
        modes.append("metacognitive")
    return list(dict.fromkeys(modes))


def build_node_id(kind: str, title: str, subkind: str | None = None) -> str:
    ascii_bits = re.findall(r"[A-Za-z0-9]+", title.lower())
    base = "-".join(ascii_bits[:6]).strip("-")
    if not base:
        base = hashlib.sha1(title.encode("utf-8")).hexdigest()[:10]
    prefix = kind if not subkind else f"{kind}/{subkind}"
    return f"{prefix}:{safe_path_token(base)}"


def build_node_card(node: dict[str, Any], evidence_id: str, excerpt: str, related_titles: list[str]) -> dict[str, Any]:
    title = node["name"]
    key_points = [
        f"{title} 在本课时中被直接引入或展开说明",
        "它适合作为稳定知识对象写入统一知识图谱",
        "理解时应结合定义、场景和相邻知识点一起把握",
    ]
    if related_titles:
        key_points.append(f"它与 {related_titles[0]} 等内容在本课时共同出现")
    return {
        "id": make_node_card_id(node["id"]),
        "node_id": node["id"],
        "title": title,
        "summary": f"{title} 是本课时中的关键知识对象，需要结合当前证据理解其定义、作用与边界。",
        "sections": [
            {"id": "definition", "title": "定义", "section_type": "definition", "content": [excerpt], "source_refs": [evidence_id], "properties": {}},
            {"id": "essence", "title": "核心本质", "section_type": "essence", "content": [f"{title} 在本课时中承担稳定知识锚点作用。"], "source_refs": [evidence_id], "properties": {}},
            {"id": "key-points", "title": "关键要点", "section_type": "key_points", "content": key_points, "source_refs": [evidence_id], "properties": {}},
            {"id": "example", "title": "示例", "section_type": "example", "content": [f"教材在当前段落通过 {title} 展开说明。"], "source_refs": [evidence_id], "properties": {}},
            {"id": "application", "title": "应用", "section_type": "application", "content": [f"{title} 可作为后续学习相关内容的基础。"], "source_refs": [evidence_id], "properties": {}},
            {"id": "misconception", "title": "常见误解", "section_type": "misconception", "content": [f"不要只把 {title} 当作术语标签，要关注它的作用与边界。"], "source_refs": [evidence_id], "properties": {}},
        ],
        "source_refs": [evidence_id],
        "properties": {},
        "status": "draft",
    }


def build_artifacts(args: argparse.Namespace) -> dict[str, Any]:
    item, lines, outline = slice_markdown(args.book_id, args.batch_anchor)
    source_id = args.textbook_id or args.book_id
    anchor_ref = resolve_outline_anchor(args.book_id, args.batch_anchor, strict=True)
    lesson_run_id = make_lesson_run_id(args.book_id, anchor_ref)
    sections = extract_sections(lines) or [{"title": item.get("title", "lesson-overview"), "heading": "", "lines": lines}]
    source_path = outline.get("source_path", "")
    domains = infer_domains(args.subject)

    nodes: list[dict[str, Any]] = []
    edges: list[dict[str, Any]] = []
    domain_profiles: list[dict[str, Any]] = []
    mentions: list[dict[str, Any]] = []
    evidence: list[dict[str, Any]] = []
    node_cards: list[dict[str, Any]] = []

    for index, section in enumerate(sections, start=1):
        title = section["title"]
        if not title or title in SKIP_TITLES:
            continue
        excerpt = make_excerpt(section["lines"])
        if not excerpt:
            continue
        kind, subkind = classify_node(title, section["heading"])
        node_id = build_node_id(kind, title, subkind)
        evidence_id = f"evidence:{safe_path_token(args.book_id)}:{safe_path_token(normalize_term(title))}:{index}"
        mention_id = f"mention:{safe_path_token(args.book_id)}:{safe_path_token(node_id)}:{index}"
        if any(existing["id"] == node_id for existing in nodes):
            continue

        node = {
            "id": node_id,
            "name": title,
            "kind": kind,
            "subkind": subkind,
            "definition": excerpt,
            "aliases": top_aliases(section["lines"], title),
            "domains": domains,
            "knowledge_form": infer_knowledge_form(kind),
            "learning_mode": infer_learning_mode(title, kind),
            "scope": "domain-specific",
            "properties": {},
            "external_ids": {},
            "tags": [safe_path_token(args.subject), safe_path_token(args.grade_band)],
            "status": "draft",
            "notes": "",
            "source_refs": [evidence_id],
        }
        nodes.append(node)
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
                "locator": f"{item.get('label', item.get('id'))} / {title}",
                "modality": "text",
                "extraction_method": "ocr",
                "normalized_claims": [excerpt[:120]],
                "properties": {},
            }
        )
        mentions.append(
            {
                "id": mention_id,
                "source_type": "textbook",
                "source_id": source_id,
                "anchor_ref": anchor_ref,
                "target_type": "node",
                "target_id": node_id,
                "role": "defines" if index == 1 else "focuses_on",
                "source_refs": [evidence_id],
                "confidence": 0.85,
                "properties": {},
            }
        )
        domain_profiles.append(
            {
                "id": make_domain_profile_id(node_id, domains[0]),
                "node_id": node_id,
                "domain": domains[0],
                "school_stages": [args.school_stage],
                "curriculum_roles": ["core" if kind in {"concept", "rule", "process"} else "support"],
                "source_refs": [evidence_id],
                "properties": {"subject": args.subject, "grade_band": args.grade_band},
                "status": "draft",
                "notes": "",
            }
        )

    for left, right in zip(nodes, nodes[1:]):
        edge_type = "part_of" if left["kind"] in {"concept", "rule", "process"} and right["kind"] in {"concept", "rule", "process"} else "related_to"
        edges.append(
            {
                "id": make_edge_id(left["id"], edge_type, right["id"]),
                "type": edge_type,
                "from": left["id"],
                "to": right["id"],
                "directionality": "directed" if edge_type != "related_to" else "undirected",
                "confidence": 0.72,
                "source_refs": [evidence[min(len(evidence) - 1, 0)]["id"]] if evidence else [],
                "properties": {},
                "status": "draft",
                "notes": "",
            }
        )

    for image_index, hint in enumerate(extract_image_hints(lines), start=1):
        image_path = hint["path"]
        evidence_id = f"evidence:{safe_path_token(args.book_id)}:image:{image_index}"
        evidence.append(
            {
                "id": evidence_id,
                "source_type": "textbook",
                "source_id": source_id,
                "anchor_ref": anchor_ref,
                "source_path": source_path,
                "page_start": item.get("page_start"),
                "page_end": item.get("page_end"),
                "excerpt": hint["excerpt"],
                "locator": hint["locator"],
                "modality": "image",
                "extraction_method": "ocr_image",
                "normalized_claims": [hint["caption"] or image_path],
                "properties": {
                    "caption": hint["caption"],
                    "path": image_path,
                },
            }
        )

    node_titles = [node["name"] for node in nodes]
    for node in nodes:
        evidence_id = next(
            (mention["source_refs"][0] for mention in mentions if mention["target_id"] == node["id"]),
            "",
        )
        excerpt = next((item["excerpt"] for item in evidence if item["id"] == evidence_id), node["definition"])
        node_cards.append(build_node_card(node, evidence_id, excerpt, [title for title in node_titles if title != node["name"]][:3]))

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
        "issues": [],
    }


def main() -> int:
    args = parse_args()
    payload = build_artifacts(args)
    if args.write_staging:
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
            json.dumps(payload["nodes"], ensure_ascii=False),
            "--edges-json",
            json.dumps(payload["edges"], ensure_ascii=False),
            "--domain-profiles-json",
            json.dumps(payload["domain_profiles"], ensure_ascii=False),
            "--mentions-json",
            json.dumps(payload["mentions"], ensure_ascii=False),
            "--evidence-json",
            json.dumps(payload["evidence"], ensure_ascii=False),
            "--node-cards-json",
            json.dumps(payload["node_cards"], ensure_ascii=False),
        ]
        if args.skip_integrity_check:
            command.append("--skip-integrity-check")
        env = os.environ.copy()
        dotenv_path = REPO_ROOT / ".env"
        if dotenv_path.exists():
            for raw_line in dotenv_path.read_text(encoding="utf-8").splitlines():
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                env.setdefault(key.strip(), value.strip())
        result = subprocess.run(command, cwd=REPO_ROOT, text=True, capture_output=True, env=env)
        last = {}
        if result.stdout.strip():
            try:
                last = json.loads(result.stdout.strip().splitlines()[-1])
            except json.JSONDecodeError:
                last = {}
        if result.returncode != 0 and not last:
            payload["status"] = "failed"
            payload["issues"] = [result.stderr.strip() or "store_lesson_staging failed"]
        else:
            payload["status"] = last.get("status", payload["status"])
            payload["lesson_run_id"] = last.get("lesson_run_id", payload["lesson_run_id"])
            payload["issues"] = last.get("issues", payload["issues"])
            payload["counts"] = last.get("counts", payload["counts"])

    indent = 2 if args.pretty else None
    print(json.dumps(payload, ensure_ascii=False, indent=indent))
    return 0 if payload["status"] == "success" else (2 if payload["status"] == "blocked" else 1)


if __name__ == "__main__":
    raise SystemExit(main())
