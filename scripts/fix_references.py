#!/usr/bin/env python3
"""Fix node_id references to use original format with / instead of __."""

import json
import sqlite3
from pathlib import Path
import re

OUTPUT_ROOT = Path("data/v5")
DB_PATH = Path("storage/knowledge.sqlite")
DATASET_ID = "v5"


def unfix_node_id(node_id: str) -> str:
    """Convert __ back to / for node_id references."""
    # Pattern: entity__substance:xxx -> entity/substance:xxx
    # Pattern: activity__experiment:xxx -> activity/experiment:xxx
    # etc.
    if node_id and "__" in node_id:
        # Check if this looks like a node_id that should have /
        # Format: prefix__subprefix:name
        parts = node_id.split(":")
        if len(parts) >= 2:
            prefix = parts[0]
            rest = ":".join(parts[1:])
            # Convert __ to / in the prefix part
            prefix = prefix.replace("__", "/")
            return f"{prefix}:{rest}"
    return node_id


def fix_jsonl_profiles():
    """Fix profile node_id references in JSONL."""
    profiles_path = OUTPUT_ROOT / "profiles" / "knowledge.profiles.jsonl"
    if not profiles_path.exists():
        print("  Profiles file not found")
        return

    print("Fixing profile node_id references in JSONL...")
    fixed_count = 0
    lines = []

    with open(profiles_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            profile = json.loads(line)
            changed = False

            # Fix node_id: convert __ back to /
            old_node_id = profile.get("node_id", "")
            new_node_id = unfix_node_id(old_node_id)
            if new_node_id != old_node_id:
                profile["node_id"] = new_node_id
                changed = True

            if changed:
                fixed_count += 1
            lines.append(json.dumps(profile, ensure_ascii=False))

    with open(profiles_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    print(f"  Fixed {fixed_count} profile node_id references")


def fix_jsonl_mentions():
    """Fix mention target_id references in JSONL."""
    mentions_path = (
        OUTPUT_ROOT / "graph" / "chem-highschool-compulsory-1.mentions.jsonl"
    )
    if not mentions_path.exists():
        print("  Mentions file not found")
        return

    print("Fixing mention target_id references in JSONL...")
    fixed_count = 0
    lines = []

    with open(mentions_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            mention = json.loads(line)
            changed = False

            # Fix target_id (node_id): convert __ back to /
            old_target_id = mention.get("target_id", "")
            new_target_id = unfix_node_id(old_target_id)
            if new_target_id != old_target_id:
                mention["target_id"] = new_target_id
                changed = True

            if changed:
                fixed_count += 1
            lines.append(json.dumps(mention, ensure_ascii=False))

    with open(mentions_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    print(f"  Fixed {fixed_count} mention target_id references")


def fix_jsonl_node_cards():
    """Fix node_card node_id references in JSONL."""
    node_cards_dir = OUTPUT_ROOT / "node_cards"
    if not node_cards_dir.exists():
        print("  Node cards directory not found")
        return

    print("Fixing node_card node_id references in JSONL...")
    fixed_count = 0

    for card_file in node_cards_dir.glob("*.json"):
        with open(card_file, "r", encoding="utf-8") as f:
            card = json.load(f)

        changed = False

        # Fix node_id: convert __ back to /
        old_node_id = card.get("node_id", "")
        new_node_id = unfix_node_id(old_node_id)
        if new_node_id != old_node_id:
            card["node_id"] = new_node_id
            changed = True

        if changed:
            fixed_count += 1
            with open(card_file, "w", encoding="utf-8") as f:
                json.dump(card, f, ensure_ascii=False, indent=2)

    print(f"  Fixed {fixed_count} node_card node_id references")


def fix_sqlite():
    """Fix node_id references in SQLite."""
    if not DB_PATH.exists():
        print("  SQLite database not found")
        return

    print("Fixing SQLite node_id references...")
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    fixed_count = 0

    # Fix profiles node_id
    cursor.execute(
        "SELECT rowid, node_id FROM profiles WHERE dataset_id = ?", (DATASET_ID,)
    )
    profiles = cursor.fetchall()
    for row in profiles:
        old_node_id = row["node_id"] or ""
        new_node_id = unfix_node_id(old_node_id)
        if new_node_id != old_node_id:
            cursor.execute(
                "UPDATE profiles SET node_id = ? WHERE rowid = ?",
                (new_node_id, row["rowid"]),
            )
            fixed_count += 1

    # Fix mentions target_id
    cursor.execute(
        "SELECT rowid, target_id FROM mentions WHERE dataset_id = ?", (DATASET_ID,)
    )
    mentions = cursor.fetchall()
    for row in mentions:
        old_target_id = row["target_id"] or ""
        new_target_id = unfix_node_id(old_target_id)
        if new_target_id != old_target_id:
            cursor.execute(
                "UPDATE mentions SET target_id = ? WHERE rowid = ?",
                (new_target_id, row["rowid"]),
            )
            fixed_count += 1

    # Fix node_cards node_id
    cursor.execute(
        "SELECT rowid, node_id FROM node_cards WHERE dataset_id = ?", (DATASET_ID,)
    )
    cards = cursor.fetchall()
    for row in cards:
        old_node_id = row["node_id"] or ""
        new_node_id = unfix_node_id(old_node_id)
        if new_node_id != old_node_id:
            cursor.execute(
                "UPDATE node_cards SET node_id = ? WHERE rowid = ?",
                (new_node_id, row["rowid"]),
            )
            fixed_count += 1

    conn.commit()
    conn.close()
    print(f"  Fixed {fixed_count} records in SQLite")


def main():
    print("=" * 50)
    print("Fixing node_id references (converting __ back to /)")
    print("=" * 50)

    fix_jsonl_profiles()
    fix_jsonl_mentions()
    fix_jsonl_node_cards()
    fix_sqlite()

    print("\nDone! Run strict_qa.py to verify fixes.")


if __name__ == "__main__":
    main()
