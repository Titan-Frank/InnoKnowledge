from __future__ import annotations

import json
import shlex
from dataclasses import dataclass
from typing import Any, Protocol


@dataclass
class LessonJob:
    item: dict[str, Any]
    context: dict[str, Any]


@dataclass
class BackendLaunchSpec:
    command: str
    cwd: str
    env: dict[str, str]


class LessonBackend(Protocol):
    def build_launch_spec(self, job: LessonJob) -> BackendLaunchSpec:
        ...


class ShellLessonBackend:
    def __init__(self, runtime: Any, executor: dict[str, Any]) -> None:
        self.runtime = runtime
        self.executor = executor

    def build_launch_spec(self, job: LessonJob) -> BackendLaunchSpec:
        item_context = {
            "item": job.item,
            "lesson_run_id": job.item.get("lesson_run_id", ""),
            "batch_anchor": job.item.get("batch_anchor", ""),
        }
        command = self.runtime._render(self.executor["command"], item_context)
        env = {
            "OKM_BOOK_ID": str(job.item.get("book_id", "")),
            "OKM_BATCH_ANCHOR": str(job.item.get("batch_anchor", "")),
            "OKM_LESSON_RUN_ID": str(job.item.get("lesson_run_id", "")),
            "OKM_LESSON_TITLE": str(job.item.get("title", "")),
        }
        env.update(
            {
                key: str(value)
                for key, value in self.executor.get("env", {}).items()
            }
        )
        cwd = self.runtime._render(
            self.executor.get("cwd", str(self.runtime.repo_root)),
            item_context,
        )
        return BackendLaunchSpec(command=command, cwd=cwd, env=env)


class LocalRuleBasedBackend:
    def __init__(self, runtime: Any, executor: dict[str, Any]) -> None:
        self.runtime = runtime
        self.executor = executor

    def build_launch_spec(self, job: LessonJob) -> BackendLaunchSpec:
        item = job.item
        command_parts = [
            "python3",
            str(self.runtime.repo_root / "scripts" / "extract_lesson_local.py"),
            "--book-id",
            str(item["book_id"]),
            "--batch-anchor",
            str(item["batch_anchor"]),
            "--output-root",
            str(job.context["output_root"]),
            "--dataset-id",
            str(job.context.get("dataset_id", "")),
        ]
        subject = self.executor.get("subject")
        school_stage = self.executor.get("school_stage")
        grade_band = self.executor.get("grade_band")
        if subject:
            command_parts.extend(["--subject", str(subject)])
        if school_stage:
            command_parts.extend(["--school-stage", str(school_stage)])
        if grade_band:
            command_parts.extend(["--grade-band", str(grade_band)])
        if self.executor.get("framework_ref"):
            command_parts.extend(["--framework-ref", str(self.executor["framework_ref"])])
        if self.executor.get("textbook-id"):
            command_parts.extend(["--textbook-id", str(self.executor["textbook-id"])])
        if self.executor.get("write_staging", True):
            command_parts.append("--write-staging")
        if self.executor.get("skip_integrity_check", False):
            command_parts.append("--skip-integrity-check")
        if self.executor.get("emit_pretty_json", False):
            command_parts.append("--pretty")

        env = {}
        if self.executor.get("embedding_api_key_env"):
            env["EMBEDDING_API_KEY"] = str(self.executor["embedding_api_key_env"])
        return BackendLaunchSpec(
            command=" ".join(shlex.quote(part) for part in command_parts),
            cwd=str(self.runtime.repo_root),
            env=env,
        )


class OpenAIResponsesBackend:
    def __init__(self, runtime: Any, executor: dict[str, Any], api_mode: str = "responses") -> None:
        self.runtime = runtime
        self.executor = executor
        self.api_mode = api_mode

    def build_launch_spec(self, job: LessonJob) -> BackendLaunchSpec:
        prompt = self.executor.get("prompt", "")
        command_parts = [
            "python3",
            str(self.runtime.repo_root / "scripts" / "extract_lesson_openai.py"),
            "--book-id",
            str(job.item["book_id"]),
            "--batch-anchor",
            str(job.item["batch_anchor"]),
            "--output-root",
            str(job.context["output_root"]),
            "--dataset-id",
            str(job.context.get("dataset_id", "")),
        ]
        if self.executor.get("model"):
            command_parts.extend(["--model", str(self.executor["model"])])
        if prompt:
            command_parts.extend(["--prompt", json.dumps(prompt, ensure_ascii=False)])
        if self.executor.get("subject"):
            command_parts.extend(["--subject", str(self.executor["subject"])])
        if self.executor.get("school_stage"):
            command_parts.extend(["--school-stage", str(self.executor["school_stage"])])
        if self.executor.get("grade_band"):
            command_parts.extend(["--grade-band", str(self.executor["grade_band"])])
        if self.executor.get("framework_ref"):
            command_parts.extend(["--framework-ref", str(self.executor["framework_ref"])])
        if self.executor.get("textbook-id"):
            command_parts.extend(["--textbook-id", str(self.executor["textbook-id"])])
        if self.executor.get("base_url"):
            command_parts.extend(["--base-url", str(self.executor["base_url"])])
        if self.executor.get("api_key_env"):
            command_parts.extend(["--api-key-env", str(self.executor["api_key_env"])])
        command_parts.extend(["--api-mode", self.api_mode])
        if self.executor.get("timeout"):
            command_parts.extend(["--timeout", str(self.executor["timeout"])])
        if self.executor.get("reasoning_effort"):
            command_parts.extend(["--reasoning-effort", str(self.executor["reasoning_effort"])])
        if str(self.executor.get("retrieval_context", "")).lower() in {"1", "true", "yes", "on"}:
            command_parts.append("--retrieval-context")
        if self.executor.get("retrieval_limit"):
            command_parts.extend(["--retrieval-limit", str(self.executor["retrieval_limit"])])
        if self.executor.get("fallback_local_on_error", False):
            command_parts.append("--fallback-local-on-error")
        if self.executor.get("write_staging", True):
            command_parts.append("--write-staging")
        return BackendLaunchSpec(
            command=" ".join(shlex.quote(part) for part in command_parts),
            cwd=str(self.runtime.repo_root),
            env={},
        )


def build_backend(runtime: Any, executor: dict[str, Any]) -> LessonBackend:
    kind = executor.get("kind")
    if kind == "shell":
        return ShellLessonBackend(runtime, executor)
    if kind == "local_rule_based":
        return LocalRuleBasedBackend(runtime, executor)
    if kind == "openai_responses":
        return OpenAIResponsesBackend(runtime, executor, api_mode="responses")
    if kind == "openai_chat_completions":
        return OpenAIResponsesBackend(runtime, executor, api_mode="chat_completions")
    raise ValueError(f"Unsupported lesson backend kind: {kind}")
