#!/usr/bin/env python3
"""PostgreSQL-native strict QA validation.

Validates:
1. Schema compliance (required fields, valid enums)
2. Node completeness (backbone nodes have cards, mentions, profiles)
3. Properties completeness (substance/experiment/equipment should have properties or explanation)
4. Support nodes (each lesson should have support nodes where applicable)
5. Edge validity (endpoints exist, valid types)
6. Evidence linkage (mentions have evidence)

Quality tiers:
- ERRORS: Schema violations, missing required fields, broken references
- WARNINGS: Missing recommended content (properties, support nodes) without explanation
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any

import psycopg

sys.path.insert(0, str(Path(__file__).resolve().parent))

from knowledge_store_common import (
    connect_db,
    ensure_pg_schema,
    VALID_EDGE_TYPES,
    normalize_textbook_source_id,
)

# Schema requirements
REQUIRED_NODE_FIELDS = [
    "id",
    "canonical_name",
    "node_kind",
    "node_layer",
    "aliases_json",
    "definition",
    "learning_modes_json",
    "properties_json",
    "status",
]

VALID_NODE_KINDS = [
    "entity",
    "concept",
    "process",
    "principle",
    "method",
    "skill",
    "representation",
    "activity",
    "event",
    "issue",
]

VALID_NODE_LAYERS = ["backbone", "support"]
VALID_NODE_STATUSES = ["candidate", "active", "merged", "deprecated"]
VALID_LEARNING_MODES = ["factual", "conceptual", "procedural", "metacognitive"]
VALID_EDGE_LAYERS = ["backbone", "support"]
VALID_EDGE_STATUSES = ["candidate", "active", "deprecated"]
VALID_DIRECTIONALITIES = ["directed", "undirected"]

VALID_MENTION_ROLES = [
    "introduces",
    "defines",
    "focuses_on",
    "demonstrates",
    "applies",
    "reviews",
    "mentions",
    "supports",
    "assesses",
    "extends",
]

VALID_PROFILE_STATUSES = ["draft", "reviewed", "validated"]
VALID_CARD_STATUSES = ["draft", "reviewed", "validated"]
VALID_CARD_SECTION_TYPES = [
    "definition",
    "essence",
    "key_points",
    "structure",
    "procedure",
    "application",
    "misconception",
    "example",
    "assessment",
    "extension",
    "evidence",
    "background",
    "comparison",
    "reflection",
    "other",
]
VALID_EVIDENCE_MODALITIES = ["text", "image", "table", "equation", "audio", "video", "mixed"]
VALID_EXTRACTION_METHODS = ["manual", "pdftotext", "ocr", "speech_to_text", "mixed"]


class StrictQA:
    """Perform strict QA validation directly on PostgreSQL."""

    def __init__(
        self,
        connection: psycopg.Connection,
        dataset_id: str,
        scope: str | None = None,
    ):
        self.connection = connection
        self.dataset_id = dataset_id
        self.scope = scope  # Optional: limit to specific lesson anchor
        self.errors: list[dict[str, Any]] = []
        self.warnings: list[dict[str, Any]] = []

    def _add_error(
        self, category: str, item_id: str, message: str, details: dict | None = None
    ):
        """Add an error record."""
        self.errors.append(
            {
                "category": category,
                "id": item_id,
                "message": message,
                "details": details or {},
            }
        )

    def _add_warning(
        self, category: str, item_id: str, message: str, details: dict | None = None
    ):
        """Add a warning record."""
        self.warnings.append(
            {
                "category": category,
                "id": item_id,
                "message": message,
                "details": details or {},
            }
        )

    def validate_nodes(self) -> int:
        """Validate all nodes. Returns error count."""
        print("\n[1/7] Validating nodes...")

        # Get nodes (optionally scoped)
        if self.scope:
            # Find nodes mentioned in this scope
            with self.connection.cursor() as cur:
                cur.execute(
                    """
                    SELECT DISTINCT n.* FROM nodes n
                    JOIN mentions m ON n.id = m.target_id
                    WHERE n.dataset_id = %s AND m.dataset_id = %s AND m.anchor_ref = %s
                    """,
                    (self.dataset_id, self.dataset_id, self.scope),
                )
                rows = cur.fetchall()
        else:
            with self.connection.cursor() as cur:
                cur.execute(
                    "SELECT * FROM nodes WHERE dataset_id = %s", (self.dataset_id,)
                )
                rows = cur.fetchall()

        error_count = 0

        for row in rows:
            node_id = row["id"]

            # Check required fields
            for field in REQUIRED_NODE_FIELDS:
                if row[field] is None or row[field] == "":
                    # Special case for JSON fields
                    if field.endswith("_json"):
                        continue  # Empty JSON is valid '[]' or '{}'
                    self._add_error("node", node_id, f"Missing required field: {field}")
                    error_count += 1

            # Validate node_kind
            if row["node_kind"] not in VALID_NODE_KINDS:
                self._add_error(
                    "node",
                    node_id,
                    f"Invalid node_kind: {row['node_kind']}",
                    {"valid_values": VALID_NODE_KINDS},
                )
                error_count += 1

            # Validate node_layer
            if row["node_layer"] not in VALID_NODE_LAYERS:
                self._add_error(
                    "node",
                    node_id,
                    f"Invalid node_layer: {row['node_layer']}",
                    {"valid_values": VALID_NODE_LAYERS},
                )
                error_count += 1

            if row["status"] not in VALID_NODE_STATUSES:
                self._add_error(
                    "node",
                    node_id,
                    f"Invalid status: {row['status']}",
                    {"valid_values": VALID_NODE_STATUSES},
                )
                error_count += 1

            parsed_json: dict[str, Any] = {}
            # Validate JSON fields — JSONB columns are already native Python objects
            for json_field in ["aliases_json", "learning_modes_json", "bridge_tags_json"]:
                try:
                    value = row[json_field]
                    # JSONB may return None, a list, or other native type
                    if value is None:
                        value = []
                    if not isinstance(value, list):
                        raise ValueError("Not a valid JSON array")
                    parsed_json[json_field] = value
                except ValueError as e:
                    self._add_error(
                        "node", node_id, f"Invalid JSON in {json_field}: {e}"
                    )
                    error_count += 1

            learning_modes = parsed_json.get("learning_modes_json", [])
            if not learning_modes:
                self._add_error("node", node_id, "learning_modes must be non-empty")
                error_count += 1
            else:
                invalid_modes = [mode for mode in learning_modes if mode not in VALID_LEARNING_MODES]
                if invalid_modes:
                    self._add_error(
                        "node",
                        node_id,
                        f"Invalid learning_modes: {invalid_modes}",
                        {"valid_values": VALID_LEARNING_MODES},
                    )
                    error_count += 1

            # properties_json is JSONB — already a Python dict
            properties_value = row["properties_json"]
            if properties_value is None:
                properties_value = {}
            if not isinstance(properties_value, dict):
                self._add_error("node", node_id, "properties_json must be an object")
                error_count += 1
                properties_value = {}

            # Check backbone nodes have cards
            if row["node_layer"] == "backbone":
                with self.connection.cursor() as cur:
                    cur.execute(
                        "SELECT 1 FROM node_cards WHERE dataset_id = %s AND node_id = %s",
                        (self.dataset_id, node_id),
                    )
                    card = cur.fetchone()

                if not card:
                    self._add_error(
                        "node_card",
                        node_id,
                        "Backbone node missing node_card",
                        {"node_layer": row["node_layer"]},
                    )
                    error_count += 1

            # Validate card_ref format
            if row["card_ref"] and not row["card_ref"].startswith("node-card:"):
                self._add_error(
                    "node",
                    node_id,
                    f"Invalid card_ref format: {row['card_ref']}",
                    {"expected_format": "node-card:{node-id}"},
                )
                error_count += 1

            # Check properties for specific node types (RECOMMENDED with explanation)
            properties = properties_value
            notes = row["notes"] or ""

            # Entity/substance nodes SHOULD have meaningful properties
            if row["node_kind"] == "entity" and row["node_subkind"] == "substance":
                if not properties or properties == {}:
                    # Check if notes explain why
                    if not notes or len(notes.strip()) < 10:
                        self._add_warning(
                            "node",
                            node_id,
                            "entity/substance node has empty properties and no explanation in notes",
                            {
                                "node_subkind": row["node_subkind"],
                                "suggestion": "Add properties or explain in notes why not available",
                            },
                        )

            # Activity/experiment nodes SHOULD have properties
            if (
                row["node_kind"] == "activity"
                and row["node_subkind"] == "experiment"
            ):
                if not properties or properties == {}:
                    if not notes or len(notes.strip()) < 10:
                        self._add_warning(
                            "node",
                            node_id,
                            "activity/experiment node has empty properties and no explanation in notes",
                            {
                                "node_subkind": row["node_subkind"],
                                "suggestion": "Add method/steps/materials or explain in notes",
                            },
                        )

            # Entity/equipment nodes SHOULD have properties
            if row["node_kind"] == "entity" and row["node_subkind"] == "equipment":
                if not properties or properties == {}:
                    if not notes or len(notes.strip()) < 10:
                        self._add_warning(
                            "node",
                            node_id,
                            "entity/equipment node has empty properties and no explanation in notes",
                            {
                                "node_subkind": row["node_subkind"],
                                "suggestion": "Add instrument_type/usage or explain in notes",
                            },
                        )

            # Activity/experiment nodes SHOULD have properties (warning, not error)
            if (
                row["node_kind"] == "activity"
                and row["node_subkind"] == "experiment"
            ):
                if not properties or properties == {}:
                    if not notes:
                        self._add_warning(
                            "node",
                            node_id,
                            "activity/experiment node has empty properties and no explanation in notes",
                            {
                                "node_subkind": row["node_subkind"],
                                "suggestion": "Add method/steps/materials or explain in notes",
                            },
                        )

            # Entity/equipment nodes SHOULD have properties (warning, not error)
            if row["node_kind"] == "entity" and row["node_subkind"] == "equipment":
                if not properties or properties == {}:
                    if not notes:
                        self._add_warning(
                            "node",
                            node_id,
                            "entity/equipment node has empty properties and no explanation in notes",
                            {
                                "node_subkind": row["node_subkind"],
                                "suggestion": "Add instrument_type/usage or explain in notes",
                            },
                        )

        print(f"  ✓ Validated {len(rows)} nodes, found {error_count} errors")
        return error_count

    def validate_edges(self) -> int:
        """Validate all edges. Returns error count."""
        print("\n[2/7] Validating edges...")

        with self.connection.cursor() as cur:
            cur.execute(
                "SELECT * FROM edges WHERE dataset_id = %s AND status != 'deprecated'",
                (self.dataset_id,),
            )
            rows = cur.fetchall()

        # Pre-load all node IDs for O(1) endpoint checks
        with self.connection.cursor() as cur:
            cur.execute(
                "SELECT id FROM nodes WHERE dataset_id = %s", (self.dataset_id,)
            )
            node_ids = {r["id"] for r in cur.fetchall()}

        error_count = 0

        for row in rows:
            edge_id = row["id"]

            # Validate edge_type
            if row["edge_type"] not in VALID_EDGE_TYPES:
                self._add_error(
                    "edge",
                    edge_id,
                    f"Invalid edge_type: {row['edge_type']}",
                    {"valid_values": list(VALID_EDGE_TYPES)[:10] + ["..."]},
                )
                error_count += 1

            if row["edge_layer"] not in VALID_EDGE_LAYERS:
                self._add_error(
                    "edge",
                    edge_id,
                    f"Invalid edge_layer: {row['edge_layer']}",
                    {"valid_values": VALID_EDGE_LAYERS},
                )
                error_count += 1

            if row["directionality"] not in VALID_DIRECTIONALITIES:
                self._add_error(
                    "edge",
                    edge_id,
                    f"Invalid directionality: {row['directionality']}",
                    {"valid_values": VALID_DIRECTIONALITIES},
                )
                error_count += 1

            if row["status"] not in VALID_EDGE_STATUSES:
                self._add_error(
                    "edge",
                    edge_id,
                    f"Invalid status: {row['status']}",
                    {"valid_values": VALID_EDGE_STATUSES},
                )
                error_count += 1

            # Validate endpoints exist
            if row["from_id"] not in node_ids:
                self._add_error(
                    "edge", edge_id, f"Source node does not exist: {row['from_id']}"
                )
                error_count += 1

            if row["to_id"] not in node_ids:
                self._add_error(
                    "edge", edge_id, f"Target node does not exist: {row['to_id']}"
                )
                error_count += 1

            # Validate confidence
            if not (0.0 <= row["confidence"] <= 1.0):
                self._add_error(
                    "edge",
                    edge_id,
                    f"Confidence out of range: {row['confidence']}",
                    {"valid_range": "[0.0, 1.0]"},
                )
                error_count += 1

            # Check for self-loops (warning, not error)
            if row["from_id"] == row["to_id"]:
                self._add_warning(
                    "edge", edge_id, "Self-loop detected (edge from node to itself)"
                )

        print(f"  ✓ Validated {len(rows)} edges, found {error_count} errors")
        return error_count

    def validate_profiles(self) -> int:
        """Validate all curriculum profiles. Returns error count."""
        print("\n[3/7] Validating profiles...")

        with self.connection.cursor() as cur:
            cur.execute(
                "SELECT * FROM profiles WHERE dataset_id = %s", (self.dataset_id,)
            )
            rows = cur.fetchall()

        error_count = 0

        for row in rows:
            profile_id = row["id"]

            # Validate node_id exists
            with self.connection.cursor() as cur:
                cur.execute(
                    "SELECT 1 FROM nodes WHERE dataset_id = %s AND id = %s",
                    (self.dataset_id, row["node_id"]),
                )
                node_exists = cur.fetchone()

            if not node_exists:
                self._add_error(
                    "profile",
                    profile_id,
                    f"Referenced node does not exist: {row['node_id']}",
                )
                error_count += 1

            # Validate context_key
            if not row["context_key"] or row["context_key"] == "":
                self._add_error("profile", profile_id, "Missing context_key")
                error_count += 1

            if row["status"] not in VALID_PROFILE_STATUSES:
                self._add_error(
                    "profile",
                    profile_id,
                    f"Invalid status: {row['status']}",
                    {"valid_values": VALID_PROFILE_STATUSES},
                )
                error_count += 1

            # Validate learning_objectives not empty — JSONB already parsed
            objectives = row["learning_objectives_json"]
            if objectives is None:
                objectives = []
            if not objectives:
                self._add_error(
                    "profile",
                    profile_id,
                    "Empty learning_objectives",
                    {"node_id": row["node_id"]},
                )
                error_count += 1

            framework_refs = row["framework_refs_json"]
            if framework_refs is None:
                framework_refs = []
            if not framework_refs:
                self._add_error(
                    "profile",
                    profile_id,
                    "Empty framework_refs",
                    {"node_id": row["node_id"]},
                )
                error_count += 1

        print(f"  ✓ Validated {len(rows)} profiles, found {error_count} errors")
        return error_count

    def validate_textbook_sources(self) -> int:
        """Validate textbook source_ids align with canonical book_id from anchor_ref."""
        print("\n[source] Validating textbook source consistency...")

        params: list[str] = [self.dataset_id]
        scoped_clause = ""
        if self.scope:
            scoped_clause = " AND anchor_ref = %s"
            params = [self.dataset_id, self.scope]

        with self.connection.cursor() as cur:
            cur.execute(
                f"""
                SELECT 'mention' AS record_type, id, source_type, source_id, anchor_ref
                FROM mentions
                WHERE dataset_id = %s
                  AND source_type = 'textbook'
                  {scoped_clause}
                """,
                params,
            )
            mention_rows = cur.fetchall()

        with self.connection.cursor() as cur:
            cur.execute(
                f"""
                SELECT 'evidence' AS record_type, id, source_type, source_id, anchor_ref
                FROM evidence
                WHERE dataset_id = %s
                  AND source_type = 'textbook'
                  {scoped_clause}
                """,
                params,
            )
            evidence_rows = cur.fetchall()

        rows = mention_rows + evidence_rows
        error_count = 0

        for row in rows:
            expected_source_id = normalize_textbook_source_id(
                row["source_type"],
                row["source_id"],
                row["anchor_ref"],
            )
            if expected_source_id and row["source_id"] != expected_source_id:
                self._add_error(
                    "source",
                    f"{row['record_type']}:{row['id']}",
                    "Textbook source_id does not match canonical book_id for anchor_ref",
                    {
                        "anchor_ref": row["anchor_ref"],
                        "actual_source_id": row["source_id"],
                        "expected_source_id": expected_source_id,
                    },
                )
                error_count += 1

        print(f"  ✓ Validated {len(rows)} textbook source records, found {error_count} errors")
        return error_count

    def validate_mentions(self) -> int:
        """Validate all mentions. Returns error count."""
        print("\n[4/7] Validating mentions...")

        with self.connection.cursor() as cur:
            cur.execute(
                "SELECT * FROM mentions WHERE dataset_id = %s", (self.dataset_id,)
            )
            rows = cur.fetchall()

        # Pre-load all node IDs for O(1) target checks
        with self.connection.cursor() as cur:
            cur.execute(
                "SELECT id FROM nodes WHERE dataset_id = %s", (self.dataset_id,)
            )
            node_ids = {r["id"] for r in cur.fetchall()}

        # Pre-load evidence link counts for O(1) checks
        evidence_link_counts: dict[str, int] = {}
        with self.connection.cursor() as cur:
            cur.execute(
                """
                SELECT owner_id, COUNT(*) as cnt
                FROM evidence_links
                WHERE dataset_id = %s
                GROUP BY owner_id
                """,
                (self.dataset_id,),
            )
            for r in cur.fetchall():
                evidence_link_counts[r["owner_id"]] = r["cnt"]

        error_count = 0

        for row in rows:
            mention_id = row["id"]

            # Validate target_id exists
            if row["target_type"] == "node":
                if row["target_id"] not in node_ids:
                    self._add_error(
                        "mention",
                        mention_id,
                        f"Target node does not exist: {row['target_id']}",
                    )
                    error_count += 1

            # Validate role
            if row["role"] not in VALID_MENTION_ROLES:
                self._add_error(
                    "mention",
                    mention_id,
                    f"Invalid role: {row['role']}",
                    {"valid_values": VALID_MENTION_ROLES},
                )
                error_count += 1

            # Validate confidence
            if not (0.0 <= row["confidence"] <= 1.0):
                self._add_error(
                    "mention",
                    mention_id,
                    f"Confidence out of range: {row['confidence']}",
                )
                error_count += 1

            # Check for evidence links (using pre-loaded counts)
            evidence_count = evidence_link_counts.get(mention_id, 0)

            if evidence_count == 0:
                # source_refs_json is JSONB — already a Python list
                source_refs = row["source_refs_json"]
                if source_refs is None:
                    source_refs = []
                if not source_refs:
                    self._add_error(
                        "mention",
                        mention_id,
                        "Mention has no evidence (no source_refs)",
                        {"target_id": row["target_id"]},
                    )
                    error_count += 1

        print(f"  ✓ Validated {len(rows)} mentions, found {error_count} errors")
        return error_count

    def validate_evidence(self) -> int:
        """Validate all evidence records. Returns error count."""
        print("\n[5/7] Validating evidence...")

        with self.connection.cursor() as cur:
            cur.execute(
                "SELECT * FROM evidence WHERE dataset_id = %s", (self.dataset_id,)
            )
            rows = cur.fetchall()

        error_count = 0

        for row in rows:
            evidence_id = row["id"]

            # Check excerpt is non-empty
            if not row["excerpt"] or len(row["excerpt"].strip()) == 0:
                self._add_error("evidence", evidence_id, "Empty excerpt")
                error_count += 1

            # Check locator is non-empty
            if not row["locator"] or len(row["locator"].strip()) == 0:
                self._add_error("evidence", evidence_id, "Empty locator")
                error_count += 1

            # Validate modality
            if row["modality"] and row["modality"] not in VALID_EVIDENCE_MODALITIES:
                self._add_error(
                    "evidence",
                    evidence_id,
                    f"Invalid modality: {row['modality']}",
                    {"valid_values": VALID_EVIDENCE_MODALITIES},
                )
                error_count += 1

            if row["extraction_method"] not in VALID_EXTRACTION_METHODS:
                self._add_error(
                    "evidence",
                    evidence_id,
                    f"Invalid extraction_method: {row['extraction_method']}",
                    {"valid_values": VALID_EXTRACTION_METHODS},
                )
                error_count += 1

        print(f"  ✓ Validated {len(rows)} evidence records, found {error_count} errors")
        return error_count

    def validate_node_cards(self) -> int:
        """Validate all node cards. Returns error count."""
        print("\n[6/7] Validating node cards...")

        with self.connection.cursor() as cur:
            cur.execute(
                "SELECT * FROM node_cards WHERE dataset_id = %s", (self.dataset_id,)
            )
            rows = cur.fetchall()

        error_count = 0

        for row in rows:
            card_id = row["id"] if row["id"] else f"node-card:{row['node_id']}"

            # Validate node_id exists
            with self.connection.cursor() as cur:
                cur.execute(
                    "SELECT 1 FROM nodes WHERE dataset_id = %s AND id = %s",
                    (self.dataset_id, row["node_id"]),
                )
                node_exists = cur.fetchone()

            if not node_exists:
                self._add_error(
                    "node_card",
                    card_id,
                    f"Referenced node does not exist: {row['node_id']}",
                )
                error_count += 1

            # Validate card_layer
            if row["card_layer"] not in ["backbone", "support"]:
                self._add_error(
                    "node_card",
                    card_id,
                    f"Invalid card_layer: {row['card_layer']}",
                    {"valid_values": ["backbone", "support"]},
                )
                error_count += 1

            if row["status"] not in VALID_CARD_STATUSES:
                self._add_error(
                    "node_card",
                    card_id,
                    f"Invalid status: {row['status']}",
                    {"valid_values": VALID_CARD_STATUSES},
                )
                error_count += 1

            # Check summary length (100-500 characters recommended)
            summary_len = len(row["summary"])
            if summary_len < 50:
                self._add_warning(
                    "node_card",
                    card_id,
                    f"Summary very short ({summary_len} chars)",
                    {"recommended": "100-200 characters"},
                )
            elif summary_len > 1000:
                self._add_warning(
                    "node_card", card_id, f"Summary very long ({summary_len} chars)"
                )

            # Validate sections — JSONB already parsed
            sections = row["sections_json"]
            if sections is None:
                sections = []
            if not isinstance(sections, list):
                self._add_error("node_card", card_id, "Sections must be a list")
                error_count += 1
                sections = []

            if not sections:
                self._add_error("node_card", card_id, "Empty sections")
                error_count += 1
            else:
                # Check required sections for backbone cards
                if row["card_layer"] == "backbone":
                    section_types = {
                        s.get("section_type") for s in sections if isinstance(s, dict)
                    }
                    recommended = {"definition", "essence", "key_points"}
                    missing = recommended - section_types
                    if missing:
                        self._add_warning(
                            "node_card",
                            card_id,
                            f"Recommended section types missing: {missing}",
                            {"present": list(section_types)},
                        )

                # Validate each section
                for i, section in enumerate(sections):
                    if not isinstance(section, dict):
                        self._add_error(
                            "node_card", card_id, f"Section {i} is not an object"
                        )
                        error_count += 1
                        continue

                    if "id" not in section:
                        self._add_error(
                            "node_card", card_id, f"Section {i} missing 'id'"
                        )
                        error_count += 1
                    elif not re.match(r"^[a-z0-9-]+$", str(section["id"])):
                        self._add_error(
                            "node_card",
                            card_id,
                            f"Invalid section id: {section['id']}",
                            {"expected_pattern": "^[a-z0-9-]+$"},
                        )
                        error_count += 1

                    if "title" not in section:
                        self._add_error(
                            "node_card", card_id, f"Section {i} missing 'title'"
                        )
                        error_count += 1

                    if "content" not in section:
                        self._add_error(
                            "node_card",
                            card_id,
                            f"Section {section.get('id', i)} missing 'content'",
                        )
                        error_count += 1
                    elif not isinstance(section["content"], list):
                        self._add_error(
                            "node_card",
                            card_id,
                            f"Section {section.get('id', i)} content must be an array",
                        )
                        error_count += 1
                    elif not section["content"] or not all(
                        isinstance(item, str) and item.strip()
                        for item in section["content"]
                    ):
                        self._add_error(
                            "node_card",
                            card_id,
                            f"Section {section.get('id', i)} content must contain non-empty strings",
                        )
                        error_count += 1

                    if "section_type" in section and section["section_type"] not in VALID_CARD_SECTION_TYPES:
                        self._add_error(
                            "node_card",
                            card_id,
                            f"Invalid section_type: {section['section_type']}",
                            {"valid_values": VALID_CARD_SECTION_TYPES},
                        )
                        error_count += 1

        print(f"  ✓ Validated {len(rows)} node cards, found {error_count} errors")
        return error_count

    def validate_completeness(self) -> int:
        """Validate overall completeness (every backbone node has mentions, etc.)."""
        print("\n[7/9] Validating completeness...")

        error_count = 0

        # Check 1: Every backbone node has at least one mention
        with self.connection.cursor() as cur:
            cur.execute(
                """
                SELECT n.id, n.canonical_name
                FROM nodes n
                LEFT JOIN mentions m ON n.id = m.target_id AND m.dataset_id = %s
                WHERE n.dataset_id = %s AND n.node_layer = 'backbone' AND n.status != 'deprecated'
                GROUP BY n.id, n.canonical_name
                HAVING COUNT(m.id) = 0
                """,
                (self.dataset_id, self.dataset_id),
            )
            backbone_without_mentions = cur.fetchall()

        for row in backbone_without_mentions:
            self._add_error(
                "completeness",
                row["id"],
                "Backbone node has no mentions",
                {"canonical_name": row["canonical_name"]},
            )
            error_count += 1

        # Check 2: Every mention's target has evidence
        with self.connection.cursor() as cur:
            cur.execute(
                """
                SELECT m.id, m.target_id
                FROM mentions m
                LEFT JOIN evidence_links el ON m.id = el.owner_id
                WHERE m.dataset_id = %s AND el.owner_id IS NULL
                """,
                (self.dataset_id,),
            )
            mentions_without_evidence = cur.fetchall()

        for row in mentions_without_evidence:
            # Check if it has source_refs
            with self.connection.cursor() as cur:
                cur.execute(
                    "SELECT source_refs_json FROM mentions WHERE id = %s", (row["id"],)
                )
                mention_row = cur.fetchone()

            if mention_row:
                # JSONB already parsed
                source_refs = mention_row["source_refs_json"]
                if source_refs is None:
                    source_refs = []
                if not source_refs:
                    self._add_error(
                        "completeness",
                        row["id"],
                        "Mention has no evidence links or source_refs",
                        {"target_id": row["target_id"]},
                    )
                    error_count += 1

        # Check 3: Evidence-to-mention linkage
        with self.connection.cursor() as cur:
            cur.execute(
                """
                SELECT e.id, e.excerpt
                FROM evidence e
                LEFT JOIN evidence_links el ON e.id = el.evidence_id
                WHERE e.dataset_id = %s AND el.evidence_id IS NULL
                """,
                (self.dataset_id,),
            )
            orphaned_evidence = cur.fetchall()

        if len(orphaned_evidence) > 5:
            self._add_warning(
                "completeness",
                "general",
                f"{len(orphaned_evidence)} evidence records not linked to any mentions",
                {"sample_ids": [r["id"] for r in orphaned_evidence[:3]]},
            )

        # Check 4: Support nodes exist for each lesson (RECOMMENDED)
        if self.scope:
            # Check if this scope (lesson) has at least one support node
            with self.connection.cursor() as cur:
                cur.execute(
                    """
                    SELECT COUNT(DISTINCT n.id) as cnt
                    FROM nodes n
                    JOIN mentions m ON n.id = m.target_id
                    WHERE n.dataset_id = %s
                      AND m.dataset_id = %s
                      AND m.anchor_ref = %s
                      AND n.node_layer = 'support'
                      AND n.status != 'deprecated'
                    """,
                    (self.dataset_id, self.dataset_id, self.scope),
                )
                support_count = cur.fetchone()["cnt"]

            if support_count == 0:
                # Check lesson type - some lessons may not have experiments
                self._add_warning(
                    "completeness",
                    self.scope,
                    "Lesson has no support nodes (may be acceptable for concept/theory lessons)",
                    {
                        "suggestion": "Verify lesson content type. If has experiments/methods/equipment, extract as support nodes",
                    },
                )

        # Check 5: Verify support node types distribution
        if self.scope:
            with self.connection.cursor() as cur:
                cur.execute(
                    """
                    SELECT DISTINCT n.node_kind, n.node_subkind
                    FROM nodes n
                    JOIN mentions m ON n.id = m.target_id
                    WHERE n.dataset_id = %s
                      AND m.dataset_id = %s
                      AND m.anchor_ref = %s
                      AND n.node_layer = 'support'
                      AND n.status != 'deprecated'
                    """,
                    (self.dataset_id, self.dataset_id, self.scope),
                )
                support_types = cur.fetchall()

            support_kinds = {r["node_kind"] for r in support_types}

            # Informational: what types of support nodes exist
            if support_kinds:
                print(
                    f"  ℹ Support node types in lesson: {', '.join(sorted(support_kinds))}"
                )

        print(f"  ✓ Completeness check: {error_count} errors")
        return error_count

    def validate_graph_connectivity(self) -> int:
        """Check for isolated nodes and cycles. Returns error count."""
        print("\n[8/9] Validating graph connectivity...")

        error_count = 0

        # Check for isolated nodes (nodes with NO edges at all)
        with self.connection.cursor() as cur:
            cur.execute(
                """
                SELECT n.id, n.canonical_name, n.node_layer
                FROM nodes n
                LEFT JOIN edges e1 ON n.id = e1.from_id AND e1.dataset_id = %s AND e1.status != 'deprecated'
                LEFT JOIN edges e2 ON n.id = e2.to_id AND e2.dataset_id = %s AND e2.status != 'deprecated'
                WHERE n.dataset_id = %s
                  AND e1.id IS NULL
                  AND e2.id IS NULL
                  AND n.status != 'deprecated'
                """,
                (self.dataset_id, self.dataset_id, self.dataset_id),
            )
            isolated_nodes = cur.fetchall()

        if len(isolated_nodes) > 0:
            self._add_warning(
                "graph_connectivity",
                "general",
                f"{len(isolated_nodes)} isolated nodes found (no edges)",
                {
                    "sample_nodes": [
                        {"id": r["id"], "name": r["canonical_name"]}
                        for r in isolated_nodes[:5]
                    ],
                    "suggestion": "Review if these nodes should have relations or are intentionally isolated",
                },
            )

        # Check for hierarchical edges without proper structure
        hierarchical_types = [
            "is_a",
            "instance_of",
            "contains",
            "part_of",
            "prerequisite_for",
            "depends_on",
            "extends",
        ]

        # Simple check: count hierarchical edges
        with self.connection.cursor() as cur:
            cur.execute(
                f"""
                SELECT COUNT(*) as cnt
                FROM edges
                WHERE dataset_id = %s
                  AND edge_type IN ({",".join(["%s"] * len(hierarchical_types))})
                  AND status != 'deprecated'
                """,
                (self.dataset_id, *hierarchical_types),
            )
            hierarchical_count = cur.fetchone()["cnt"]

        if hierarchical_count > 0:
            print(f"  ℹ Found {hierarchical_count} hierarchical edges")
            print(
                f"    Use 'python scripts/check_graph_integrity.py' for detailed cycle detection"
            )

        if len(isolated_nodes) > 0:
            print(f"  ⚠ Found {len(isolated_nodes)} isolated nodes")

        print(f"  ✓ Connectivity check: {error_count} errors")
        return error_count

    def validate_edge_quality(self) -> int:
        """Check edge quality and validity. Returns error count."""
        print("\n[9/9] Validating edge quality...")

        error_count = 0

        # Check for self-loops
        with self.connection.cursor() as cur:
            cur.execute(
                """
                SELECT id, edge_type, from_id
                FROM edges
                WHERE dataset_id = %s AND from_id = to_id AND status != 'deprecated'
                """,
                (self.dataset_id,),
            )
            self_loops = cur.fetchall()

        for row in self_loops:
            self._add_warning(
                "edge_quality",
                row["id"],
                f"Self-loop detected: {row['edge_type']} from {row['from_id']} to itself",
            )

        # Check for duplicate edges
        with self.connection.cursor() as cur:
            cur.execute(
                """
                SELECT from_id, to_id, edge_type, COUNT(*) as cnt
                FROM edges
                WHERE dataset_id = %s AND status != 'deprecated'
                GROUP BY from_id, to_id, edge_type
                HAVING COUNT(*) > 1
                """,
                (self.dataset_id,),
            )
            duplicates = cur.fetchall()

        if duplicates:
            self._add_warning(
                "edge_quality",
                "general",
                f"{len(duplicates)} duplicate edge patterns found",
                {
                    "sample": [
                        f"{r['edge_type']}: {r['from_id']} -> {r['to_id']} ({r['cnt']} times)"
                        for r in duplicates[:3]
                    ]
                },
            )

        # Check edge confidence distribution
        with self.connection.cursor() as cur:
            cur.execute(
                """
                SELECT COUNT(*) as cnt
                FROM edges
                WHERE dataset_id = %s AND confidence < 0.5 AND status != 'deprecated'
                """,
                (self.dataset_id,),
            )
            low_confidence = cur.fetchone()["cnt"]

        if low_confidence > 10:
            self._add_warning(
                "edge_quality",
                "general",
                f"{low_confidence} edges have low confidence (<0.5)",
                {"suggestion": "Review low-confidence edges or consider removing them"},
            )

        if self_loops:
            print(f"  ⚠ Found {len(self_loops)} self-loops")
        if duplicates:
            print(f"  ⚠ Found {len(duplicates)} duplicate edge patterns")

        print(f"  ✓ Edge quality check: {error_count} errors")
        return error_count

    def run_all_validations(self) -> tuple[int, int]:
        """Run all validations. Returns (error_count, warning_count)."""
        total_errors = 0

        total_errors += self.validate_nodes()
        total_errors += self.validate_edges()
        total_errors += self.validate_profiles()
        total_errors += self.validate_textbook_sources()
        total_errors += self.validate_mentions()
        total_errors += self.validate_evidence()
        total_errors += self.validate_node_cards()
        total_errors += self.validate_completeness()
        total_errors += self.validate_graph_connectivity()
        total_errors += self.validate_edge_quality()

        return total_errors, len(self.warnings)

    def print_report(self):
        """Print validation report."""
        print("\n" + "=" * 60)
        print("QA VALIDATION REPORT")
        print("=" * 60)

        # Summary
        total_errors = len(self.errors)
        total_warnings = len(self.warnings)

        if total_errors == 0:
            print(f"\n✅ PASSED: {total_errors} errors, {total_warnings} warnings")
        else:
            print(f"\n❌ FAILED: {total_errors} errors, {total_warnings} warnings")

        # Errors by category
        if self.errors:
            print("\n--- ERRORS ---")
            by_category = {}
            for err in self.errors:
                cat = err["category"]
                by_category.setdefault(cat, []).append(err)

            for category, errors in sorted(by_category.items()):
                print(f"\n{category.upper()} ({len(errors)} errors):")
                for err in errors[:5]:  # Show first 5 per category
                    print(f"  • {err['id']}: {err['message']}")
                if len(errors) > 5:
                    print(f"  ... and {len(errors) - 5} more")

        # Warnings by category
        if self.warnings:
            print("\n--- WARNINGS ---")
            by_category = {}
            for warn in self.warnings:
                cat = warn["category"]
                by_category.setdefault(cat, []).append(warn)

            for category, warnings in sorted(by_category.items()):
                print(f"\n{category.upper()} ({len(warnings)} warnings):")
                for warn in warnings[:3]:  # Show first 3 per category
                    print(f"  • {warn['id']}: {warn['message']}")
                if len(warnings) > 3:
                    print(f"  ... and {len(warnings) - 3} more")

        print("\n" + "=" * 60)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Strict QA validation directly on PostgreSQL (no JSONL files)."
    )
    parser.add_argument(
        "--dataset-id",
        required=True,
        help="Dataset ID to validate (e.g., v4)",
    )
    parser.add_argument(
        "--db",
        default=None,
        help="PostgreSQL connection URL (default: $DATABASE_URL)",
    )
    parser.add_argument(
        "--scope",
        help="Limit validation to specific lesson anchor (e.g., struct:...:lesson:1-1-1)",
    )
    parser.add_argument(
        "--fail-on-warning",
        action="store_true",
        help="Treat warnings as failures",
    )
    parser.add_argument(
        "--output-json",
        help="Write detailed report to JSON file",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()

    # Connect to database
    db_url = args.db or os.environ.get("DATABASE_URL")
    if not db_url:
        print("Error: No database URL provided. Set DATABASE_URL or pass --db.")
        return 1

    connection = connect_db(db_url)
    ensure_pg_schema(connection)

    # Check dataset exists
    with connection.cursor() as cur:
        cur.execute(
            "SELECT COUNT(*) FROM datasets WHERE dataset_id = %s", (args.dataset_id,)
        )
        dataset_count = cur.fetchone()["count"]

    if dataset_count == 0:
        print(f"Error: Dataset '{args.dataset_id}' not found")
        return 1

    print(f"Running strict QA on dataset: {args.dataset_id}")
    print(f"Database: {db_url}")
    if args.scope:
        print(f"Scope: {args.scope}")

    # Run validation
    qa = StrictQA(
        connection=connection,
        dataset_id=args.dataset_id,
        scope=args.scope,
    )

    error_count, warning_count = qa.run_all_validations()
    qa.print_report()

    # Write JSON report if requested
    if args.output_json:
        report = {
            "dataset_id": args.dataset_id,
            "scope": args.scope,
            "summary": {
                "errors": error_count,
                "warnings": warning_count,
                "passed": error_count == 0,
            },
            "errors": qa.errors,
            "warnings": qa.warnings,
        }
        with open(args.output_json, "w", encoding="utf-8") as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
        print(f"\nReport written to: {args.output_json}")

    connection.close()

    # Exit code
    if error_count > 0:
        return 1
    if args.fail_on_warning and warning_count > 0:
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
