from __future__ import annotations

import json
from pathlib import Path
from typing import Any


class WorkflowValidationError(ValueError):
    """Raised when a workflow YAML file is structurally invalid."""


def _expect_mapping(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise WorkflowValidationError(f"{label} must be a mapping.")
    return value


def _expect_list(value: Any, label: str) -> list[Any]:
    if not isinstance(value, list):
        raise WorkflowValidationError(f"{label} must be a list.")
    return value


def load_workflow(path: str | Path) -> dict[str, Any]:
    workflow_path = Path(path).expanduser().resolve()
    text = workflow_path.read_text(encoding="utf-8")
    try:
        import yaml  # type: ignore

        raw = yaml.safe_load(text)
    except ModuleNotFoundError:
        raw = json.loads(text)
    doc = _expect_mapping(raw, "workflow")

    version = doc.get("version")
    if version != 1:
        raise WorkflowValidationError(
            f"Unsupported workflow version {version!r}. Expected 1."
        )

    workflow_id = doc.get("workflow_id")
    if not isinstance(workflow_id, str) or not workflow_id.strip():
        raise WorkflowValidationError("workflow_id is required.")

    stages = _expect_list(doc.get("stages"), "stages")
    if not stages:
        raise WorkflowValidationError("stages must contain at least one stage.")

    stage_ids: set[str] = set()
    for index, stage in enumerate(stages):
        stage_doc = _expect_mapping(stage, f"stages[{index}]")
        stage_id = stage_doc.get("id")
        kind = stage_doc.get("kind")
        if not isinstance(stage_id, str) or not stage_id.strip():
            raise WorkflowValidationError(f"stages[{index}].id is required.")
        if stage_id in stage_ids:
            raise WorkflowValidationError(f"Duplicate stage id: {stage_id}")
        if not isinstance(kind, str) or not kind.strip():
            raise WorkflowValidationError(f"stages[{index}].kind is required.")
        stage_ids.add(stage_id)

        config = stage_doc.get("config", {})
        _expect_mapping(config, f"stages[{index}].config")

    defaults = doc.get("defaults", {})
    _expect_mapping(defaults, "defaults")

    return doc
