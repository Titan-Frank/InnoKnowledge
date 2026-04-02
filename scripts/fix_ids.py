#!/usr/bin/env python3
"""Fix IDs to use - instead of __ for schema compliance."""

import json
import sqlite3
from pathlib import Path

OUTPUT_ROOT = Path("data/v5")
DB_PATH = Path("storage/knowledge.sqlite")
DATASET_ID = "v5"


def fix_id_chars(id_str: str) -> str:
    """Replace __ with - in IDs for schema compliance."""
    return id_str.replace("__", "-")


def fix_jsonl_profiles():
    """Fix profile IDs in JSONL."""
    profiles_path = OUTPUT_ROOT / "profiles" / "knowledge.profiles.jsonl"
    if not profiles_path.exists():
        print("  Profiles file not found")
        return

    print("Fixing profile IDs in JSONL...")
    fixed_count = 0
    lines = []

    with open(profiles_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            profile = json.loads(line)
            changed = False

            # Fix ID: replace __ with -
            old_id = profile.get("id", "")
            if "__" in old_id:
                profile["id"] = fix_id_chars(old_id)
                changed = True

            if changed:
                fixed_count += 1
            lines.append(json.dumps(profile, ensure_ascii=False))

    with open(profiles_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    print(f"  Fixed {fixed_count} profile IDs")


def fix_jsonl_mentions():
    """Fix mention IDs in JSONL."""
    mentions_path = (
        OUTPUT_ROOT / "graph" / "chem-highschool-compulsory-1.mentions.jsonl"
    )
    if not mentions_path.exists():
        print("  Mentions file not found")
        return

    print("Fixing mention IDs in JSONL...")
    fixed_count = 0
    lines = []

    with open(mentions_path, "r", encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            mention = json.loads(line)
            changed = False

            # Fix ID: replace __ with -
            old_id = mention.get("id", "")
            if "__" in old_id:
                mention["id"] = fix_id_chars(old_id)
                changed = True

            if changed:
                fixed_count += 1
            lines.append(json.dumps(mention, ensure_ascii=False))

    with open(mentions_path, "w", encoding="utf-8") as f:
        f.write("\n".join(lines) + "\n")

    print(f"  Fixed {fixed_count} mention IDs")


def fix_jsonl_node_cards():
    """Fix node_card IDs and profile_refs in JSONL."""
    node_cards_dir = OUTPUT_ROOT / "node_cards"
    if not node_cards_dir.exists():
        print("  Node cards directory not found")
        return

    print("Fixing node_card IDs in JSONL...")
    fixed_count = 0

    for card_file in node_cards_dir.glob("*.json"):
        with open(card_file, "r", encoding="utf-8") as f:
            card = json.load(f)

        changed = False

        # Fix ID: replace __ with -
        old_id = card.get("id", "")
        if "__" in old_id:
            card["id"] = fix_id_chars(old_id)
            changed = True

        # Fix profile_refs: replace __ with -
        if "profile_refs" in card:
            new_refs = [
                fix_id_chars(ref) if "__" in ref else ref
                for ref in card["profile_refs"]
            ]
            if new_refs != card["profile_refs"]:
                card["profile_refs"] = new_refs
                changed = True

        if changed:
            fixed_count += 1
            with open(card_file, "w", encoding="utf-8") as f:
                json.dump(card, f, ensure_ascii=False, indent=2)

    print(f"  Fixed {fixed_count} node_card IDs")


def fix_sqlite():
    """Fix IDs in SQLite."""
    if not DB_PATH.exists():
        print("  SQLite database not found")
        return

    print("Fixing IDs in SQLite...")
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()
    fixed_count = 0

    # Fix profiles ID
    cursor.execute(
        "SELECT rowid, id FROM profiles WHERE dataset_id = ? AND id LIKE '%__%'",
        (DATASET_ID,),
    )
    profiles = cursor.fetchall()
    for row in profiles:
        new_id = fix_id_chars(row["id"])
        cursor.execute(
            "UPDATE profiles SET id = ? WHERE rowid = ?", (new_id, row["rowid"])
        )
        fixed_count += 1

    # Fix mentions ID
    cursor.execute(
        "SELECT rowid, id FROM mentions WHERE dataset_id = ? AND id LIKE '%__%'",
        (DATASET_ID,),
    )
    mentions = cursor.fetchall()
    for row in mentions:
        new_id = fix_id_chars(row["id"])
        cursor.execute(
            "UPDATE mentions SET id = ? WHERE rowid = ?", (new_id, row["rowid"])
        )
        fixed_count += 1

    # Fix node_cards ID and profile_refs
    cursor.execute(
        "SELECT rowid, id, profile_refs_json FROM node_cards WHERE dataset_id = ?",
        (DATASET_ID,),
    )
    cards = cursor.fetchall()
    for row in cards:
        updates = {}

        if row["id"] and "__" in row["id"]:
            updates["id"] = fix_id_chars(row["id"])

        profile_refs = json.loads(row["profile_refs_json"] or "[]")
        new_refs = [fix_id_chars(ref) if "__" in ref else ref for ref in profile_refs]
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
    print("Fixing IDs (replacing __ with -)")
    print("=" * 50)

    fix_jsonl_profiles()
    fix_jsonl_mentions()
    fix_jsonl_node_cards()
    fix_sqlite()

    print("\nDone! Run strict_qa.py to verify fixes.")


if __name__ == "__main__":
    main()
