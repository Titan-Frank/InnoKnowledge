#!/usr/bin/env python3
"""Strict QA validation for the world knowledge runtime."""

from __future__ import annotations

import argparse
import json
from typing import Any

from knowledge_store_common import (
    VALID_CURRICULUM_ROLES,
    VALID_DOMAINS,
    VALID_EDGE_TYPES,
    VALID_LEARNING_MODES,
    VALID_NODE_KINDS,
    VALID_SCHOOL_STAGES,
    connect_db,
    ensure_pg_schema,
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Strict QA for world knowledge graph.")
    parser.add_argument("--dataset-id", required=True)
    parser.add_argument("--db")
    return parser.parse_args()


class StrictQA:
    def __init__(self, connection, dataset_id: str):
        self.connection = connection
        self.dataset_id = dataset_id
        self.errors: list[dict[str, Any]] = []
        self.warnings: list[dict[str, Any]] = []
        self._evidence_exists_cache: dict[str, bool] = {}

    def error(self, category: str, item_id: str, message: str) -> None:
        self.errors.append({"category": category, "id": item_id, "message": message})

    def warn(self, category: str, item_id: str, message: str) -> None:
        self.warnings.append({"category": category, "id": item_id, "message": message})

    def evidence_exists(self, evidence_id: str) -> bool:
        if evidence_id not in self._evidence_exists_cache:
            with self.connection.cursor() as cur:
                cur.execute(
                    "SELECT 1 FROM world_evidence WHERE dataset_id = %s AND id = %s",
                    (self.dataset_id, evidence_id),
                )
                self._evidence_exists_cache[evidence_id] = cur.fetchone() is not None
        return self._evidence_exists_cache[evidence_id]

    def validate_source_refs(self, category: str, item_id: str, source_refs: Any, *, required: bool = True) -> None:
        refs = source_refs if isinstance(source_refs, list) else []
        if required and not refs:
            self.error(category, item_id, "Missing evidence source references")
            return
        for evidence_id in refs:
            if not isinstance(evidence_id, str) or not evidence_id.strip():
                self.error(category, item_id, "Invalid empty evidence reference")
                continue
            if not self.evidence_exists(evidence_id):
                self.error(category, item_id, f"Missing evidence {evidence_id}")

    def validate_nodes(self) -> None:
        with self.connection.cursor() as cur:
            cur.execute("SELECT * FROM world_nodes WHERE dataset_id = %s", (self.dataset_id,))
            rows = cur.fetchall()
        for row in rows:
            if row["kind"] not in VALID_NODE_KINDS:
                self.error("node", row["id"], f"Invalid kind: {row['kind']}")
            if not row["name"] or not row["definition"]:
                self.error("node", row["id"], "Missing name or definition")
            if not isinstance(row["domains_json"], list) or not row["domains_json"]:
                self.error("node", row["id"], "domains_json must be a non-empty array")
            else:
                invalid = [item for item in row["domains_json"] if item not in VALID_DOMAINS]
                if invalid:
                    self.error("node", row["id"], f"Invalid domains: {invalid}")
            if not isinstance(row["learning_mode_json"], list) or not row["learning_mode_json"]:
                self.error("node", row["id"], "learning_mode_json must be a non-empty array")
            else:
                invalid = [item for item in row["learning_mode_json"] if item not in VALID_LEARNING_MODES]
                if invalid:
                    self.error("node", row["id"], f"Invalid learning modes: {invalid}")
            with self.connection.cursor() as cur:
                cur.execute("SELECT 1 FROM world_node_cards WHERE dataset_id = %s AND node_id = %s", (self.dataset_id, row["id"]))
                if cur.fetchone() is None:
                    self.error("node_card", row["id"], "Missing node card")
                cur.execute("SELECT 1 FROM world_mentions WHERE dataset_id = %s AND target_id = %s", (self.dataset_id, row["id"]))
                if cur.fetchone() is None:
                    self.error("mention", row["id"], "Missing mention")
                cur.execute("SELECT 1 FROM world_domain_profiles WHERE dataset_id = %s AND node_id = %s", (self.dataset_id, row["id"]))
                if cur.fetchone() is None:
                    self.error("domain_profile", row["id"], "Missing domain profile")

    def validate_edges(self) -> None:
        with self.connection.cursor() as cur:
            cur.execute("SELECT * FROM world_edges WHERE dataset_id = %s", (self.dataset_id,))
            rows = cur.fetchall()
        for row in rows:
            if row["type"] not in VALID_EDGE_TYPES:
                self.error("edge", row["id"], f"Invalid edge type: {row['type']}")
            if row["directionality"] not in {"directed", "undirected"}:
                self.error("edge", row["id"], f"Invalid directionality: {row['directionality']}")
            self.validate_source_refs("edge", row["id"], row["source_refs_json"])
            with self.connection.cursor() as cur:
                cur.execute("SELECT 1 FROM world_nodes WHERE dataset_id = %s AND id = %s", (self.dataset_id, row["from_id"]))
                if cur.fetchone() is None:
                    self.error("edge", row["id"], "Missing source node")
                cur.execute("SELECT 1 FROM world_nodes WHERE dataset_id = %s AND id = %s", (self.dataset_id, row["to_id"]))
                if cur.fetchone() is None:
                    self.error("edge", row["id"], "Missing target node")

    def validate_domain_profiles(self) -> None:
        with self.connection.cursor() as cur:
            cur.execute("SELECT * FROM world_domain_profiles WHERE dataset_id = %s", (self.dataset_id,))
            rows = cur.fetchall()
        for row in rows:
            if row["domain"] not in VALID_DOMAINS:
                self.error("domain_profile", row["id"], f"Invalid domain: {row['domain']}")
            invalid_stages = [item for item in (row["school_stages_json"] or []) if item not in VALID_SCHOOL_STAGES]
            if invalid_stages:
                self.error("domain_profile", row["id"], f"Invalid school stages: {invalid_stages}")
            invalid_roles = [item for item in (row["curriculum_roles_json"] or []) if item not in VALID_CURRICULUM_ROLES]
            if invalid_roles:
                self.error("domain_profile", row["id"], f"Invalid curriculum roles: {invalid_roles}")
            self.validate_source_refs("domain_profile", row["id"], row["source_refs_json"])

    def validate_mentions_and_evidence(self) -> None:
        with self.connection.cursor() as cur:
            cur.execute("SELECT * FROM world_mentions WHERE dataset_id = %s", (self.dataset_id,))
            mentions = cur.fetchall()
        for row in mentions:
            self.validate_source_refs("mention", row["id"], row["source_refs_json"])

    def validate_node_cards(self) -> None:
        with self.connection.cursor() as cur:
            cur.execute("SELECT * FROM world_node_cards WHERE dataset_id = %s", (self.dataset_id,))
            cards = cur.fetchall()
        required_sections = {"definition", "essence", "key_points", "example", "application", "misconception"}
        for row in cards:
            if not row["summary"]:
                self.error("node_card", row["node_id"], "Missing summary")
            self.validate_source_refs("node_card", row["node_id"], row["source_refs_json"])
            sections = row["sections_json"] if isinstance(row["sections_json"], list) else []
            section_types = {section.get("section_type") for section in sections if isinstance(section, dict)}
            missing = sorted(required_sections - section_types)
            if missing:
                self.error("node_card", row["node_id"], f"Missing required sections: {missing}")
            for section in sections:
                if not isinstance(section, dict):
                    continue
                section_id = str(section.get("id") or section.get("section_type") or "section")
                self.validate_source_refs(
                    "node_card_section",
                    f"{row['node_id']}:{section_id}",
                    section.get("source_refs"),
                )

    def run(self) -> dict[str, Any]:
        self.validate_nodes()
        self.validate_edges()
        self.validate_domain_profiles()
        self.validate_mentions_and_evidence()
        self.validate_node_cards()
        return {"errors": self.errors, "warnings": self.warnings}


def main() -> int:
    args = parse_args()
    connection = connect_db(args.db)
    ensure_pg_schema(connection)
    qa = StrictQA(connection, args.dataset_id)
    result = qa.run()
    status = "success" if not result["errors"] else "blocked"
    print(json.dumps({"status": status, **result}, ensure_ascii=False))
    return 0 if status == "success" else 2


if __name__ == "__main__":
    raise SystemExit(main())
