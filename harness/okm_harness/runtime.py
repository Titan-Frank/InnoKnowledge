from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from .backends import LessonJob, build_backend
from scripts.okm_pathing import safe_path_token


class StageExecutionError(RuntimeError):
    """Raised when a required stage fails or blocks the workflow."""


@dataclass
class CommandResult:
    command: str
    cwd: str
    returncode: int
    stdout: str
    stderr: str


_PLACEHOLDER_PATTERN = re.compile(r"\{([A-Za-z_][A-Za-z0-9_]*)(\[[^\]]+\])?\}")


def _stringify(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    return str(value)


def _coerce_bool(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def _coerce_int(value: Any) -> int:
    if isinstance(value, int):
        return value
    return int(str(value))


def _last_json_object(text: str) -> dict[str, Any] | None:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for line in reversed(lines):
        if not line.startswith("{"):
            continue
        try:
            parsed = json.loads(line)
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            return parsed
    return None


def _repo_display_path(repo_root: Path, path: Path) -> str:
    resolved = path.expanduser().resolve()
    try:
        return str(resolved.relative_to(repo_root))
    except ValueError:
        return str(resolved)


def _normalize_heading_text(value: Any) -> str:
    text = str(value or "").lower()
    text = re.sub(r"!\[[^\]]*\]\([^)]+\)", " ", text)
    text = re.sub(r"[#*_`~\[\]().,，。:：;；!?！？/\\|\"'《》“”‘’、\-]+", " ", text)
    text = re.sub(r"\s+", "", text)
    return text


def _heading_title(raw_line: str) -> str:
    return re.sub(r"^#{1,6}\s+", "", raw_line).strip()


def _order_key(item: dict[str, Any]) -> tuple[int, ...]:
    raw = str(item.get("order_path") or "")
    parts = [int(part) for part in raw.split(".") if part.isdigit()]
    return tuple(parts) if parts else (999999,)


class HarnessRuntime:
    """Runs a YAML-defined, project-specific extraction workflow."""

    def __init__(
        self,
        workflow: dict[str, Any],
        *,
        repo_root: str | Path,
        context: dict[str, Any],
        manifest_path: str | Path | None = None,
    ) -> None:
        self.workflow = workflow
        self.repo_root = Path(repo_root).expanduser().resolve()
        self.context = dict(context)
        self.context.setdefault("repo_root", str(self.repo_root))
        self.stage_outputs: dict[str, dict[str, Any]] = {}
        self.manifest_path = (
            Path(manifest_path).expanduser().resolve()
            if manifest_path
            else self._default_manifest_path()
        )
        self.manifest_path.parent.mkdir(parents=True, exist_ok=True)
        self.manifest: dict[str, Any] = {
            "workflow_id": self.workflow["workflow_id"],
            "description": self.workflow.get("description", ""),
            "context": self.context,
            "stages": [],
        }

    def run(self) -> dict[str, Any]:
        self._write_manifest()
        for stage in self.workflow["stages"]:
            self._run_stage(stage)
        self.manifest["status"] = "completed"
        self._write_manifest()
        return self.manifest

    def _default_manifest_path(self) -> Path:
        book_id = safe_path_token(_stringify(self.context.get("book_id") or "workflow"))
        workflow_id = safe_path_token(self.workflow["workflow_id"])
        return self.repo_root / "runs" / "harness" / f"{book_id}.{workflow_id}.json"

    def _write_manifest(self) -> None:
        self.manifest_path.write_text(
            json.dumps(self.manifest, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )

    def _render(self, value: Any, extra: dict[str, Any] | None = None) -> Any:
        if isinstance(value, str):
            scope = {
                **self.workflow.get("defaults", {}),
                **self.context,
                "stage_outputs": self.stage_outputs,
            }
            if extra:
                scope.update(extra)
            rendered = value
            for _ in range(5):
                next_rendered = self._render_string_once(rendered, scope)
                if next_rendered == rendered:
                    break
                rendered = next_rendered
            return rendered
        if isinstance(value, list):
            return [self._render(item, extra) for item in value]
        if isinstance(value, dict):
            return {key: self._render(item, extra) for key, item in value.items()}
        return value

    def _render_string_once(self, template: str, scope: dict[str, Any]) -> str:
        def replace(match: re.Match[str]) -> str:
            key = match.group(1)
            accessor = match.group(2)
            if key not in scope:
                return match.group(0)
            value: Any = scope[key]
            if accessor:
                token = accessor[1:-1].strip()
                token = token.strip("\"'")
                if isinstance(value, dict):
                    value = value.get(token, match.group(0))
                else:
                    return match.group(0)
            return _stringify(value)

        return _PLACEHOLDER_PATTERN.sub(replace, template)

    def _run_stage(self, stage: dict[str, Any]) -> None:
        stage_id = stage["id"]
        required = stage.get("required", True)
        stage_record: dict[str, Any] = {
            "id": stage_id,
            "kind": stage["kind"],
            "required": required,
            "status": "running",
        }
        self.manifest["stages"].append(stage_record)
        self._write_manifest()

        try:
            output = self._dispatch_stage(stage)
            stage_record["status"] = "completed"
            stage_record["output"] = output
            self.stage_outputs[stage_id] = output
        except StageExecutionError as exc:
            stage_record["status"] = "blocked"
            stage_record["error"] = str(exc)
            self.manifest["status"] = "blocked"
            self._write_manifest()
            raise
        except Exception as exc:  # pragma: no cover - defensive harness surface
            stage_record["status"] = "failed"
            stage_record["error"] = str(exc)
            self.manifest["status"] = "failed"
            self._write_manifest()
            if required:
                raise
        else:
            self._write_manifest()

    def _dispatch_stage(self, stage: dict[str, Any]) -> dict[str, Any]:
        kind = stage["kind"]
        if kind == "command":
            return self._run_command_stage(stage)
        if kind == "ensure_source_markdown":
            return self._run_ensure_source_markdown_stage(stage)
        if kind == "ensure_outline":
            return self._run_ensure_outline_stage(stage)
        if kind == "plan_lessons":
            return self._run_plan_lessons_stage(stage)
        if kind == "parallel_lessons":
            return self._run_parallel_lessons_stage(stage)
        if kind == "check_lesson_quality":
            return self._run_lesson_quality_stage(stage)
        if kind == "run_reducer":
            return self._run_reducer_stage(stage)
        raise StageExecutionError(f"Unsupported stage kind: {kind}")

    def _run_subprocess(
        self,
        command: str,
        *,
        cwd: str | Path | None = None,
        env: dict[str, str] | None = None,
    ) -> CommandResult:
        resolved_cwd = Path(cwd or self.repo_root).expanduser().resolve()
        merged_env = os.environ.copy()
        if env:
            merged_env.update(env)
        completed = subprocess.run(
            command,
            shell=True,
            cwd=resolved_cwd,
            env=merged_env,
            text=True,
            capture_output=True,
        )
        return CommandResult(
            command=command,
            cwd=str(resolved_cwd),
            returncode=completed.returncode,
            stdout=completed.stdout,
            stderr=completed.stderr,
        )

    def _run_command_stage(self, stage: dict[str, Any]) -> dict[str, Any]:
        config = self._render(stage.get("config", {}))
        result = self._run_subprocess(
            config["command"],
            cwd=config.get("cwd", self.repo_root),
            env={k: _stringify(v) for k, v in config.get("env", {}).items()},
        )
        if result.returncode != 0:
            raise StageExecutionError(
                f"Command stage '{stage['id']}' failed with exit code {result.returncode}."
            )
        return {
            "command": result.command,
            "cwd": result.cwd,
            "stdout": result.stdout,
            "stderr": result.stderr,
        }

    def _run_ensure_source_markdown_stage(self, stage: dict[str, Any]) -> dict[str, Any]:
        config = self._render(stage.get("config", {}))
        source_markdown_path = str(config.get("source_markdown_path") or "").strip()
        if source_markdown_path:
            resolved_markdown = Path(source_markdown_path).expanduser().resolve()
            if not resolved_markdown.exists():
                raise StageExecutionError(f"Configured source markdown not found: {resolved_markdown}")
            self.context["source_markdown_path"] = str(resolved_markdown)
            return {
                "source_markdown_path": str(resolved_markdown),
                "created": False,
                "skipped": False,
            }

        pdf_path = str(config.get("pdf_path") or "").strip()
        file_url = str(config.get("file_url") or "").strip()
        if not pdf_path and not file_url:
            self.context["source_markdown_path"] = ""
            return {"source_markdown_path": "", "created": False, "skipped": True}

        book_id = str(config["book_id"])
        output_dir = Path(
            config.get("output_dir")
            or self.repo_root / "data" / "mineru" / safe_path_token(book_id)
        ).expanduser()
        if not output_dir.is_absolute():
            output_dir = self.repo_root / output_dir

        command_parts = [
            "python3",
            str(self.repo_root / "scripts" / "mineru_extract_pdf.py"),
            "--book-id",
            book_id,
            "--output-dir",
            str(output_dir),
            "--api-key-env",
            str(config.get("api_key_env") or "MINERU_API_KEY"),
            "--base-url",
            str(config.get("base_url") or "https://mineru.net"),
            "--model-version",
            str(config.get("model_version") or "vlm"),
            "--language",
            str(config.get("language") or "ch"),
            "--timeout",
            str(config.get("timeout") or 1800),
            "--poll-interval",
            str(config.get("poll_interval") or 10),
        ]
        if pdf_path:
            command_parts.extend(["--pdf-path", pdf_path])
        else:
            command_parts.extend(["--file-url", file_url])
        if config.get("data_id"):
            command_parts.extend(["--data-id", str(config["data_id"])])
        if config.get("page_ranges"):
            command_parts.extend(["--page-ranges", str(config["page_ranges"])])
        if not _coerce_bool(config.get("is_ocr", True)):
            command_parts.append("--no-is-ocr")
        if not _coerce_bool(config.get("enable_formula", True)):
            command_parts.append("--no-enable-formula")
        if not _coerce_bool(config.get("enable_table", True)):
            command_parts.append("--no-enable-table")
        if _coerce_bool(config.get("force", False)):
            command_parts.append("--force")

        command = " ".join(shlex.quote(part) for part in command_parts)
        result = self._run_subprocess(command, cwd=self.repo_root)
        payload = _last_json_object(result.stdout) or {}
        if result.returncode != 0:
            raise StageExecutionError(
                result.stderr.strip()
                or payload.get("error")
                or "MinerU source markdown extraction failed."
            )
        source_markdown_path = str(payload.get("source_markdown_path") or "").strip()
        if not source_markdown_path:
            raise StageExecutionError("MinerU finished without returning source_markdown_path.")
        self.context["source_markdown_path"] = source_markdown_path
        return {
            "source_markdown_path": source_markdown_path,
            "created": bool(payload.get("created")),
            "manifest_path": payload.get("manifest_path", ""),
            "batch_id": payload.get("batch_id", ""),
            "stdout": result.stdout,
            "stderr": result.stderr,
            "command": command,
        }

    def _run_ensure_outline_stage(self, stage: dict[str, Any]) -> dict[str, Any]:
        config = self._render(stage.get("config", {}))
        outline_path = Path(config["outline_path"]).expanduser().resolve()
        source_markdown_path = str(config.get("source_markdown_path") or "").strip()
        source_markdown = Path(source_markdown_path).expanduser().resolve() if source_markdown_path else None
        if outline_path.exists():
            alignment = (
                self._align_outline_to_markdown(outline_path, source_markdown)
                if source_markdown
                else {"updated": False, "matched_items": 0, "total_items": 0}
            )
            if source_markdown and alignment["total_items"] and not alignment["matched_items"]:
                raise StageExecutionError(
                    f"Outline exists but could not be aligned to MinerU markdown: {outline_path}"
                )
            return {"outline_path": str(outline_path), "created": False, "markdown_alignment": alignment}

        pdf_path = config.get("pdf_path")
        if not pdf_path and source_markdown:
            payload = self._derive_outline_from_markdown(
                outline_path,
                source_markdown,
                book_id=str(config["book_id"]),
                title=str(config.get("title") or config["book_id"]),
                toc_start=int(config.get("start_page") or 1),
                toc_end=int(config.get("end_page") or 1),
            )
            return {
                "outline_path": str(outline_path),
                "created": True,
                "markdown_alignment": {
                    "updated": True,
                    "matched_items": len(payload["items"]),
                    "total_items": len(payload["items"]),
                },
                "stdout": "",
            }
        if not pdf_path:
            raise StageExecutionError(
                f"Outline not found at {outline_path} and no pdf_path was provided."
            )

        command = " ".join(
            shlex.quote(part)
            for part in [
                "python3",
                str(
                    self.repo_root
                    / ".claude"
                    / "skills"
                    / "textbook-outline"
                    / "scripts"
                    / "extract_outline.py"
                ),
                "--pdf",
                str(pdf_path),
                "--book-id",
                str(config["book_id"]),
                "--out",
                str(outline_path),
                "--start-page",
                str(config.get("start_page", 1)),
                "--end-page",
                str(config.get("end_page", 20)),
                "--pretty",
            ]
            + (
                ["--title", str(config["title"])]
                if config.get("title")
                else []
            )
        )
        result = self._run_subprocess(command, cwd=self.repo_root)
        if result.returncode != 0:
            if source_markdown:
                payload = self._derive_outline_from_markdown(
                    outline_path,
                    source_markdown,
                    book_id=str(config["book_id"]),
                    title=str(config.get("title") or config["book_id"]),
                    toc_start=int(config.get("start_page") or 1),
                    toc_end=int(config.get("end_page") or 1),
                )
                return {
                    "outline_path": str(outline_path),
                    "created": True,
                    "markdown_alignment": {
                        "updated": True,
                        "matched_items": len(payload["items"]),
                        "total_items": len(payload["items"]),
                    },
                    "stdout": result.stdout,
                    "outline_fallback": "markdown_headings",
                }
            raise StageExecutionError(result.stderr.strip() or "Outline extraction failed.")
        alignment = (
            self._align_outline_to_markdown(outline_path, source_markdown)
            if source_markdown
            else {"updated": False, "matched_items": 0, "total_items": 0}
        )
        if source_markdown and not alignment["matched_items"]:
            raise StageExecutionError(
                f"Outline was created but no items aligned to MinerU markdown: {outline_path}"
            )
        return {
            "outline_path": str(outline_path),
            "created": True,
            "markdown_alignment": alignment,
            "stdout": result.stdout,
        }

    def _align_outline_to_markdown(self, outline_path: Path, source_markdown: Path) -> dict[str, Any]:
        if not source_markdown.exists():
            raise StageExecutionError(f"MinerU markdown not found: {source_markdown}")
        outline = json.loads(outline_path.read_text(encoding="utf-8"))
        items = outline.get("items", outline.get("structure", []))
        if not isinstance(items, list):
            raise StageExecutionError(f"Outline has no items list: {outline_path}")

        lines = source_markdown.read_text(encoding="utf-8").splitlines()
        marker_lines: dict[str, int] = {}
        headings: list[dict[str, Any]] = []
        for line_number, line in enumerate(lines, start=1):
            marker = re.search(r'LESSON_START\s+id="([^"]+)"', line)
            if marker:
                marker_lines[marker.group(1)] = line_number
            if not re.match(r"^#{1,6}\s+\S", line):
                continue
            title = _heading_title(line)
            headings.append(
                {
                    "line": line_number,
                    "title": title,
                    "norm": _normalize_heading_text(title),
                    "raw": line.strip(),
                }
            )

        used_lines: set[int] = set()
        matched: list[tuple[dict[str, Any], int]] = []
        last_line = 0
        for item in sorted(items, key=_order_key):
            item_id = str(item.get("id") or "")
            if item.get("md_start") and item.get("md_end"):
                line_number = int(item["md_start"])
                last_line = max(last_line, line_number)
                matched.append((item, line_number))
                continue
            if item_id in marker_lines:
                line_number = marker_lines[item_id]
                item["md_start"] = line_number
                used_lines.add(line_number)
                last_line = max(last_line, line_number)
                matched.append((item, line_number))
                continue
            title_norm = _normalize_heading_text(item.get("title"))
            label_norm = _normalize_heading_text(item.get("label"))
            if not title_norm and not label_norm:
                continue
            candidates = []
            for heading in headings:
                if heading["line"] in used_lines:
                    continue
                heading_norm = heading["norm"]
                score = 0
                if title_norm and label_norm and title_norm in heading_norm and label_norm in heading_norm:
                    score = 110
                elif title_norm and title_norm == heading_norm:
                    score = 100
                elif title_norm and title_norm in heading_norm:
                    score = 90
                elif (
                    title_norm
                    and heading_norm in title_norm
                    and len(heading_norm) / max(1, len(title_norm)) >= 0.75
                ):
                    score = 70
                elif label_norm and label_norm in heading_norm:
                    score = 50
                if score:
                    candidates.append((score, heading))
            if not candidates:
                continue
            after_previous = [row for row in candidates if row[1]["line"] > last_line]
            ordered_candidates = sorted(
                after_previous or candidates,
                key=lambda row: (-row[0], row[1]["line"]),
            )
            chosen = ordered_candidates[0][1]
            line_number = int(chosen["line"])
            item["md_start"] = line_number
            item["raw_line"] = item.get("raw_line") or str(chosen["raw"])
            used_lines.add(line_number)
            last_line = max(last_line, line_number)
            matched.append((item, line_number))

        matched_sorted = sorted(matched, key=lambda row: row[1])
        for index, (item, start_line) in enumerate(matched_sorted):
            if index + 1 < len(matched_sorted):
                item["md_end"] = max(start_line, matched_sorted[index + 1][1] - 1)
            else:
                item["md_end"] = len(lines)

        ordered_items = sorted(items, key=_order_key)
        for index, item in enumerate(ordered_items):
            if item.get("page_end"):
                continue
            for later in ordered_items[index + 1 :]:
                if later.get("page_start"):
                    item["page_end"] = max(int(item.get("page_start") or 1), int(later["page_start"]) - 1)
                    break

        outline["source_path"] = _repo_display_path(self.repo_root, source_markdown)
        outline_path.write_text(
            json.dumps(outline, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return {
            "updated": True,
            "matched_items": len(matched_sorted),
            "total_items": len(items),
            "source_path": outline["source_path"],
        }

    def _derive_outline_from_markdown(
        self,
        outline_path: Path,
        source_markdown: Path,
        *,
        book_id: str,
        title: str,
        toc_start: int,
        toc_end: int,
    ) -> dict[str, Any]:
        if not source_markdown.exists():
            raise StageExecutionError(f"MinerU markdown not found: {source_markdown}")
        lines = source_markdown.read_text(encoding="utf-8").splitlines()
        heading_rows: list[dict[str, Any]] = []
        for line_number, line in enumerate(lines, start=1):
            match = re.match(r"^(#{1,6})\s+(.+?)\s*$", line)
            if not match:
                continue
            level = len(match.group(1))
            heading = match.group(2).strip()
            if not heading or len(_normalize_heading_text(heading)) < 2:
                continue
            heading_rows.append({"line": line_number, "level": level, "heading": heading, "raw": line.strip()})
        if not heading_rows:
            raise StageExecutionError("Could not derive an outline because MinerU markdown has no headings.")

        h1_rows = [row for row in heading_rows if row["level"] == 1]
        selected = h1_rows if len(h1_rows) >= 2 else [row for row in heading_rows if row["level"] <= 2]
        if not selected:
            selected = heading_rows[:1]

        items: list[dict[str, Any]] = []
        for index, row in enumerate(selected, start=1):
            next_start = selected[index]["line"] if index < len(selected) else len(lines) + 1
            heading = str(row["heading"]).strip()
            label_match = re.match(r"^((?:第\s*)?[0-9一二三四五六七八九十百千万]+[章节课题单元]+)\s*(.*)$", heading)
            if label_match:
                label = re.sub(r"\s+", "", label_match.group(1))
                item_title = label_match.group(2).strip() or heading
            else:
                label = f"第{index}课"
                item_title = heading
            items.append(
                {
                    "id": f"struct:{book_id}:lesson:{index}",
                    "kind": "lesson",
                    "label": label,
                    "title": item_title,
                    "page_start": 1,
                    "page_end": 1,
                    "level": 1,
                    "order_path": str(index),
                    "raw_line": row["raw"],
                    "md_start": int(row["line"]),
                    "md_end": max(int(row["line"]), int(next_start) - 1),
                }
            )

        payload = {
            "book_id": book_id,
            "title": title or book_id,
            "source_path": _repo_display_path(self.repo_root, source_markdown),
            "generated_at": datetime.now(UTC).isoformat(),
            "toc_pages": {"start": toc_start, "end": toc_end},
            "items": items,
        }
        outline_path.parent.mkdir(parents=True, exist_ok=True)
        outline_path.write_text(
            json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        return payload

    def _run_plan_lessons_stage(self, stage: dict[str, Any]) -> dict[str, Any]:
        config = self._render(stage.get("config", {}))
        command_parts = [
            "python3",
            str(self.repo_root / "scripts" / "parallel_batch_runner.py"),
            "--book-id",
            str(config["book_id"]),
            "--output-root",
            str(config["output_root"]),
            "--parallel",
            str(config.get("parallel", 4)),
        ]
        if _coerce_bool(config.get("no_chunks", False)):
            command_parts.append("--no-chunks")
        command = " ".join(shlex.quote(part) for part in command_parts)
        result = self._run_subprocess(command, cwd=self.repo_root)
        if result.returncode != 0:
            raise StageExecutionError(result.stderr.strip() or "Lesson planning failed.")

        lines = [line.strip() for line in result.stdout.splitlines() if line.strip()]
        if not lines:
            raise StageExecutionError("parallel_batch_runner.py returned no plan path.")

        plan_path = Path(lines[-1]).expanduser().resolve()
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
        return {
            "plan_path": str(plan_path),
            "total_units": plan["total_units"],
            "unit_kind": plan["unit_kind"],
            "parallel": plan["parallel"],
            "workers": plan["workers"],
        }

    def _run_parallel_lessons_stage(self, stage: dict[str, Any]) -> dict[str, Any]:
        config = stage.get("config", {})
        rendered = self._render(config)
        plan_stage = rendered.get("plan_stage")
        if not isinstance(plan_stage, str) or plan_stage not in self.stage_outputs:
            raise StageExecutionError(
                "parallel_lessons stage requires config.plan_stage to reference a prior plan stage."
            )

        plan_path = Path(self.stage_outputs[plan_stage]["plan_path"]).expanduser().resolve()
        plan = json.loads(plan_path.read_text(encoding="utf-8"))
        items = [worker_item["items"][0] for worker_item in plan["workers"] if worker_item["items"]]
        if not items:
            return {"lesson_run_ids": [], "results": [], "counts": {"success": 0, "failed": 0, "blocked": 0}}

        executor = rendered.get("executor", {})
        try:
            backend = build_backend(self, executor)
        except ValueError as exc:
            raise StageExecutionError(str(exc)) from exc

        max_parallel = _coerce_int(rendered.get("max_parallel", plan.get("parallel", 4)))

        def run_item(item: dict[str, Any]) -> dict[str, Any]:
            launch = backend.build_launch_spec(
                LessonJob(
                    item=item,
                    context={
                        **self.context,
                        **self.workflow.get("defaults", {}),
                    },
                )
            )
            result = self._run_subprocess(
                launch.command,
                cwd=launch.cwd,
                env=launch.env,
            )
            payload = _last_json_object(result.stdout) or {}
            status = payload.get("status")
            if not isinstance(status, str):
                status = "success" if result.returncode == 0 else "failed"
            return {
                "item": item,
                "status": status,
                "returncode": result.returncode,
                "lesson_run_id": payload.get("lesson_run_id") or item.get("lesson_run_id"),
                "counts": payload.get("counts", {}),
                "issues": payload.get("issues", []),
                "stdout": result.stdout,
                "stderr": result.stderr,
                "command": launch.command,
            }

        results: list[dict[str, Any]] = []
        with ThreadPoolExecutor(max_workers=max_parallel) as pool:
            future_map = {pool.submit(run_item, item): item for item in items}
            for future in as_completed(future_map):
                results.append(future.result())

        success = [result for result in results if result["status"] == "success"]
        failed = [result for result in results if result["status"] == "failed"]
        blocked = [result for result in results if result["status"] == "blocked"]

        if failed or blocked:
            sample = failed[0] if failed else blocked[0]
            raise StageExecutionError(
                f"Lesson staging did not complete cleanly. "
                f"sample_anchor={sample['item'].get('batch_anchor')} status={sample['status']}"
            )

        return {
            "lesson_run_ids": [result["lesson_run_id"] for result in success if result.get("lesson_run_id")],
            "results": results,
            "counts": {
                "success": len(success),
                "failed": len(failed),
                "blocked": len(blocked),
            },
        }

    def _run_reducer_stage(self, stage: dict[str, Any]) -> dict[str, Any]:
        config = self._render(stage.get("config", {}))
        lesson_stage = config.get("lesson_stage")
        if not isinstance(lesson_stage, str) or lesson_stage not in self.stage_outputs:
            raise StageExecutionError(
                "run_reducer stage requires config.lesson_stage to reference a prior lesson stage."
            )
        lesson_run_ids = self.stage_outputs[lesson_stage].get("lesson_run_ids", [])
        if not lesson_run_ids:
            raise StageExecutionError("Reducer stage has no successful lesson_run_ids to merge.")

        command_parts = [
            "python3",
            str(self.repo_root / "scripts" / "run_parallel_lesson_pipeline.py"),
            "--root",
            str(config["output_root"]),
            "--book-id",
            str(config["book_id"]),
        ]
        if config.get("dataset_id"):
            command_parts.extend(["--dataset-id", str(config["dataset_id"])])
        if config.get("similarity_threshold") is not None:
            command_parts.extend(
                ["--similarity-threshold", str(config["similarity_threshold"])]
            )
        if config.get("embedding_threshold") is not None:
            command_parts.extend(
                ["--embedding-threshold", str(config["embedding_threshold"])]
            )
        if _coerce_bool(config.get("normalize_auto_merge", False)):
            command_parts.append("--normalize-auto-merge")
        if _coerce_bool(config.get("skip_integrity", False)):
            command_parts.append("--skip-integrity")
        if _coerce_bool(config.get("skip_normalize", False)):
            command_parts.append("--skip-normalize")
        if _coerce_bool(config.get("skip_qa", False)):
            command_parts.append("--skip-qa")
        for lesson_run_id in lesson_run_ids:
            command_parts.extend(["--lesson-run-id", str(lesson_run_id)])

        command = " ".join(shlex.quote(part) for part in command_parts)
        result = self._run_subprocess(command, cwd=self.repo_root)
        if result.returncode != 0:
            raise StageExecutionError(result.stderr.strip() or "Reducer stage failed.")
        return {
            "lesson_run_ids": lesson_run_ids,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "command": command,
        }

    def _run_lesson_quality_stage(self, stage: dict[str, Any]) -> dict[str, Any]:
        config = self._render(stage.get("config", {}))
        lesson_stage = config.get("lesson_stage")
        if not isinstance(lesson_stage, str) or lesson_stage not in self.stage_outputs:
            raise StageExecutionError(
                "check_lesson_quality stage requires config.lesson_stage to reference a prior lesson stage."
            )
        lesson_run_ids = self.stage_outputs[lesson_stage].get("lesson_run_ids", [])
        if not lesson_run_ids:
            raise StageExecutionError("Lesson quality stage has no lesson_run_ids to check.")

        command_parts = [
            "python3",
            str(self.repo_root / "scripts" / "check_lesson_staging_quality.py"),
            "--root",
            str(config["output_root"]),
            "--book-id",
            str(config["book_id"]),
        ]
        if config.get("dataset_id"):
            command_parts.extend(["--dataset-id", str(config["dataset_id"])])
        if _coerce_bool(config.get("warn_only", False)):
            command_parts.append("--warn-only")
        for lesson_run_id in lesson_run_ids:
            command_parts.extend(["--lesson-run-id", str(lesson_run_id)])

        command = " ".join(shlex.quote(part) for part in command_parts)
        result = self._run_subprocess(command, cwd=self.repo_root)
        payload = _last_json_object(result.stdout) or {}
        if result.returncode != 0:
            raise StageExecutionError(
                f"Lesson quality stage blocked. checked={payload.get('checked')} blocked={payload.get('blocked')}"
            )
        return {
            "lesson_run_ids": lesson_run_ids,
            "stdout": result.stdout,
            "stderr": result.stderr,
            "command": command,
            "checked": payload.get("checked", 0),
            "blocked": payload.get("blocked", 0),
        }
