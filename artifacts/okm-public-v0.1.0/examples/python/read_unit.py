#!/usr/bin/env python3

import hashlib
import json
import sys
from pathlib import Path


ARTIFACT_ROOT = Path(__file__).resolve().parents[2]


def read_json(path: Path):
    return json.loads(path.read_text(encoding="utf-8"))


def verify_checksum(relative_path: str, absolute_path: Path) -> None:
    expected = None
    for line in (ARTIFACT_ROOT / "SHA256SUMS").read_text(encoding="utf-8").splitlines():
        digest, _, path = line.partition("  ")
        if path == relative_path:
            expected = digest
            break
    if expected is None:
        raise RuntimeError(f"Checksum is missing for {relative_path}.")
    actual = hashlib.sha256(absolute_path.read_bytes()).hexdigest()
    if actual != expected:
        raise RuntimeError(f"Checksum mismatch for {relative_path}.")


index = read_json(ARTIFACT_ROOT / "data/units/index.json")
requested_node_id = sys.argv[1] if len(sys.argv) > 1 else None
entry = next(
    (item for item in index["units"] if item["node_id"] == requested_node_id),
    index["units"][0] if requested_node_id is None else None,
)
if entry is None:
    raise SystemExit(f"Unknown node id '{requested_node_id}'.")

relative_path = f"data/units/{entry['file']}"
unit_path = ARTIFACT_ROOT / relative_path
verify_checksum(relative_path, unit_path)
unit = read_json(unit_path)

print(json.dumps({
    "node_id": unit["node"]["id"],
    "name": unit["node"]["name"],
    "kind": unit["node"]["kind"],
    "definition": unit["node"]["definition"],
    "outgoing_relations": len(unit["relations"]["outgoing"]),
    "incoming_relations": len(unit["relations"]["incoming"]),
    "evidence_ids": [item["id"] for item in unit["evidence"]],
    "completeness": unit["completeness"],
}, ensure_ascii=False, indent=2))
