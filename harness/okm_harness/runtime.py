from __future__ import annotations

import json
import os
import re
import shlex
import subprocess
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
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
        if kind == "ensure_outline":
            return self._run_ensure_outline_stage(stage)
        if kind == "plan_lessons":
            return self._run_plan_lessons_stage(stage)
        if kind == "parallel_lessons":
            return self._run_parallel_lessons_stage(stage)
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

    def _run_ensure_outline_stage(self, stage: dict[str, Any]) -> dict[str, Any]:
        config = self._render(stage.get("config", {}))
        outline_path = Path(config["outline_path"]).expanduser().resolve()
        if outline_path.exists():
            return {"outline_path": str(outline_path), "created": False}

        pdf_path = config.get("pdf_path")
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
            raise StageExecutionError(result.stderr.strip() or "Outline extraction failed.")
        return {
            "outline_path": str(outline_path),
            "created": True,
            "stdout": result.stdout,
        }

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
