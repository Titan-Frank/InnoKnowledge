#!/usr/bin/env python3
"""Fix schema validation issues in v5 dataset."""

import json
import sqlite3
import re
from pathlib import Path

OUTPUT_ROOT = Path("data/v5")
OUTLINE_PATH = Path("data/outlines/chem-highschool-compulsory-1.outline.json")
DB_PATH = Path("storage/knowledge.sqlite")

ALLOWED_BRIDGE_TAGS = {
    "system",
    "structure",
    "function",
    "change",
    "interaction",
    "energy",
    "matter",
    "evidence",
    "model",
    "representation",
    "measurement",
    "classification",
    "rule",
    "scale",
    "causality",
    "uncertainty",
}

ALLOWED_CURRICULUM_ROLES = {
    "introduced",
    "reinforced",
    "developed",
    "integrated",
    "transferred",
    "assessed",
}

DEFAULT_FRAMEWORK_REF = "framework:senior-secondary-chemistry-curriculum"
DATASET_ID = "v5"


def fix_id(id_str: str) -> str:
    """Replace / with - in IDs to match schema pattern (only allows a-z0-9:-)."""
    return id_str.replace("/", "-")


def fix_outline():
    """Fix outline schema issues."""
    print("Fixing outline...")
    with open(OUTLINE_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    changed = False
    for item in data.get("items", []):
        # Fix kind: intro -> topic, chapter -> theme
        if item.get("kind") == "intro":
            item["kind"] = "topic"
            changed = True
        elif item.get("kind") == "chapter":
            item["kind"] = "theme"
            changed = True

        # Add raw_line if missing
        if "raw_line" not in item:
            label = item.get("label", "")
            title = item.get("title", "")
            item["raw_line"] = f"{label} {title}".strip()
            changed = True

    if changed:
        with open(OUTLINE_PATH, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        print(f"  Fixed outline: {OUTLINE_PATH}")
    else:
        print("  No changes needed for outline")


def fix_profiles():
    """Fix profile schema issues."""
    profiles_path = OUTPUT_ROOT / "profiles" / "knowledge.profiles.jsonl"
    if not profiles_path.exists():
        print("  Profiles file not found")
        return

    print("Fixing profiles...")
    fixed_count = 0
    lines = []

    with open(profiles_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            profile = json.loads(line)
            changed = False

            # Fix ID format: replace / with __
            # Profile ID must match ^profile:[a-z0-9:-]+$ (no /)
            if "/" in profile.get("id", ""):
                profile["id"] = fix_id(profile["id"])
                changed = True

            # DO NOT fix node_id - it can contain / (pattern: ^[a-z0-9/_:-]+$)

            # Fix empty framework_refs
            if not profile.get("framework_refs"):
                profile["framework_refs"] = [DEFAULT_FRAMEWORK_REF]
                changed = True

            # Fix curriculum_role: reviewed -> integrated
            if profile.get("curriculum_role") == "reviewed":
                profile["curriculum_role"] = "integrated"
                changed = True

            if changed:
                fixed_count += 1
            lines.append(json.dumps(profile, ensure_ascii=False))

    with open(profiles_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    print(f"  Fixed {fixed_count} profiles")


def fix_mentions():
    """Fix mention schema issues."""
    mentions_path = (
        OUTPUT_ROOT / "graph" / "chem-highschool-compulsory-1.mentions.jsonl"
    )
    if not mentions_path.exists():
        print("  Mentions file not found")
        return

    print("Fixing mentions...")
    fixed_count = 0
    lines = []

    with open(mentions_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            mention = json.loads(line)
            changed = False

            # Fix ID format (mention ID must match ^mention:[a-z0-9:-]+$)
            if "/" in mention.get("id", ""):
                mention["id"] = fix_id(mention["id"])
                changed = True

            # DO NOT fix node_id/target_id - they can contain /

            if changed:
                fixed_count += 1
            lines.append(json.dumps(mention, ensure_ascii=False))

    with open(mentions_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    print(f"  Fixed {fixed_count} mentions")


def fix_nodes():
    """Fix node schema issues (bridge_tags)."""
    nodes_path = OUTPUT_ROOT / "graph" / "knowledge.nodes.jsonl"
    if not nodes_path.exists():
        print("  Nodes file not found")
        return

    print("Fixing nodes...")
    fixed_count = 0
    lines = []

    with open(nodes_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            node = json.loads(line)
            changed = False

            # Fix bridge_tags: remove invalid values
            if "bridge_tags" in node:
                valid_tags = [
                    tag for tag in node["bridge_tags"] if tag in ALLOWED_BRIDGE_TAGS
                ]
                if len(valid_tags) != len(node["bridge_tags"]):
                    node["bridge_tags"] = valid_tags
                    changed = True

            if changed:
                fixed_count += 1
            lines.append(json.dumps(node, ensure_ascii=False))

    with open(nodes_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    print(f"  Fixed {fixed_count} nodes")


def fix_node_cards():
    """Fix node card schema issues."""
    node_cards_dir = OUTPUT_ROOT / "node_cards"
    if not node_cards_dir.exists():
        print("  Node cards directory not found")
        return

    print("Fixing node cards...")
    fixed_count = 0

    for card_file in node_cards_dir.glob("*.json"):
        with open(card_file, "r", encoding="utf-8") as f:
            card = json.load(f)

        changed = False

        # Fix ID format (node-card ID must match ^node-card:[a-z0-9:-]+$)
        if "/" in card.get("id", ""):
            card["id"] = fix_id(card["id"])
            changed = True

        # DO NOT fix node_id - it can contain /

        # Fix profile_refs format (profile IDs also can't have /)
        if "profile_refs" in card:
            new_refs = [
                fix_id(ref) if "/" in ref else ref for ref in card["profile_refs"]
            ]
            if new_refs != card["profile_refs"]:
                card["profile_refs"] = new_refs
                changed = True

        if changed:
            fixed_count += 1
            with open(card_file, "w", encoding="utf-8") as f:
                json.dump(card, f, ensure_ascii=False, indent=2)

    print(f"  Fixed {fixed_count} node cards")


def fix_sqlite():
    """Fix schema issues in SQLite database."""
    if not DB_PATH.exists():
        print("  SQLite database not found")
        return

    print("Fixing SQLite database...")
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    fixed_count = 0

    # Fix profiles:
    # - profile ID must match ^profile:[a-z0-9:-]+$ (no /)
    # - profile node_id can have / (pattern: ^[a-z0-9/_:-]+$)
    # So we only fix the profile ID, NOT the node_id reference
    cursor.execute(
        "SELECT rowid, id, node_id, framework_refs_json, curriculum_role FROM profiles WHERE dataset_id = ?",
        (DATASET_ID,),
    )
    profiles = cursor.fetchall()
    for row in profiles:
        updates = {}
        # Only fix profile ID if it has /
        if "/" in (row["id"] or ""):
            updates["id"] = fix_id(row["id"])
        # DO NOT change node_id - it can contain /
        framework_refs = json.loads(row["framework_refs_json"] or "[]")
        if not framework_refs:
            updates["framework_refs_json"] = json.dumps([DEFAULT_FRAMEWORK_REF])
        if row["curriculum_role"] == "reviewed":
            updates["curriculum_role"] = "integrated"

        if updates:
            set_clauses = [f"{k} = ?" for k in updates.keys()]
            values = list(updates.values()) + [row["rowid"]]
            cursor.execute(
                f"UPDATE profiles SET {', '.join(set_clauses)} WHERE rowid = ?", values
            )
            fixed_count += 1

    # Fix mentions:
    # - mention ID must match ^mention:[a-z0-9:-]+$ (no /)
    # - mention target_id (node_id) can have /
    cursor.execute(
        "SELECT rowid, id, target_id FROM mentions WHERE dataset_id = ?", (DATASET_ID,)
    )
    mentions = cursor.fetchall()
    for row in mentions:
        updates = {}
        # Only fix mention ID
        if "/" in (row["id"] or ""):
            updates["id"] = fix_id(row["id"])
        # DO NOT change target_id - it can contain /

        if updates:
            set_clauses = [f"{k} = ?" for k in updates.keys()]
            values = list(updates.values()) + [row["rowid"]]
            cursor.execute(
                f"UPDATE mentions SET {', '.join(set_clauses)} WHERE rowid = ?", values
            )
            fixed_count += 1

    # Fix nodes (bridge_tags_json)
    cursor.execute(
        "SELECT rowid, id, bridge_tags_json FROM nodes WHERE dataset_id = ?",
        (DATASET_ID,),
    )
    nodes = cursor.fetchall()
    for row in nodes:
        updates = {}
        bridge_tags = json.loads(row["bridge_tags_json"] or "[]")
        valid_tags = [tag for tag in bridge_tags if tag in ALLOWED_BRIDGE_TAGS]
        if len(valid_tags) != len(bridge_tags):
            updates["bridge_tags_json"] = json.dumps(valid_tags)

        if updates:
            set_clauses = [f"{k} = ?" for k in updates.keys()]
            values = list(updates.values()) + [row["rowid"]]
            cursor.execute(
                f"UPDATE nodes SET {', '.join(set_clauses)} WHERE rowid = ?", values
            )
            fixed_count += 1

    # Fix node_cards:
    # - node-card ID must match ^node-card:[a-z0-9:-]+$ (no /)
    # - node-card node_id can have /
    cursor.execute(
        "SELECT rowid, id, node_id, profile_refs_json FROM node_cards WHERE dataset_id = ?",
        (DATASET_ID,),
    )
    cards = cursor.fetchall()
    for row in cards:
        updates = {}
        # Only fix node-card ID
        if "/" in (row["id"] or ""):
            updates["id"] = fix_id(row["id"])
        # DO NOT change node_id - it can contain /

        # Fix profile_refs (profile IDs also can't have /)
        profile_refs = json.loads(row["profile_refs_json"] or "[]")
        new_refs = [fix_id(ref) if "/" in ref else ref for ref in profile_refs]
        if new_refs != profile_refs:
            updates["profile_refs_json"] = json.dumps(new_refs)

        if updates:
            set_clauses = [f"{k} = ?" for k in updates.keys()]
            values = list(updates.values()) + [row["rowid"]]
            cursor.execute(
                f"UPDATE node_cards SET {', '.join(set_clauses)} WHERE rowid = ?",
                values,
            )
            fixed_count += 1

    conn.commit()
    conn.close()
    print(f"  Fixed {fixed_count} records in SQLite")


def main():
    print("=" * 50)
    print("Fixing schema validation issues")
    print("=" * 50)

    fix_outline()
    fix_profiles()
    fix_mentions()
    fix_nodes()
    fix_node_cards()
    fix_sqlite()

    print("\nDone! Run strict_qa.py to verify fixes.")


if __name__ == "__main__":
    main()
