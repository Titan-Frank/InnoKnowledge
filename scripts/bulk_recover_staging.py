#!/usr/bin/env python3
"""Bulk recover staging data for all lessons across 7 textbooks.
Reads from marked markdown files, extracts knowledge, writes to staging tables.
"""
import json, os, re, sys, subprocess
from pathlib import Path

# Add scripts dir to path
sys.path.insert(0, str(Path(__file__).parent))
from knowledge_store_common import connect_db, ensure_pg_schema

def get_lesson_content(marked_md_path: str, lesson_id: str) -> str:
    """Extract lesson content from marked markdown using start/end markers."""
    with open(marked_md_path, 'r', encoding='utf-8') as f:
        content = f.read()

    # Find the lesson block
    start_pat = f'LESSON_START id="{lesson_id}"'
    end_pat = f'LESSON_END id="{lesson_id}"'

    start_idx = content.find(start_pat)
    end_idx = content.find(end_pat)

    if start_idx == -1 or end_idx == -1:
        return None

    # Extract content between markers
    start_line_end = content.find('\n', start_idx) + 1
    end_line_start = content.rfind('\n', 0, end_idx)

    return content[start_line_end:end_line_start].strip()

def parse_outline_ids(outline_path: str):
    """Parse lesson IDs from outline JSON."""
    with open(outline_path, 'r', encoding='utf-8') as f:
        data = json.load(f)

    items = data.get('items', [])
    lesson_ids = []
    for item in items:
        if item.get('kind') in ('lesson', 'activity'):
            lesson_ids.append(item['id'])
    return lesson_ids

def get_db():
    """Get database connection."""
    db_url = os.environ.get('DATABASE_URL', 'postgresql://okm:okm@localhost:5432/knowledge')
    conn = connect_db(db_url)
    ensure_pg_schema(conn)
    return conn

def already_staged(conn, batch_anchor: str) -> bool:
    """Check if lesson already has staging data."""
    with conn.cursor() as cur:
        cur.execute("SELECT COUNT(*) FROM staging_nodes WHERE batch_anchor = %s", (batch_anchor,))
        return cur.fetchone()[0] > 0

def extract_simple_nodes(content: str, lesson_id: str, book_id: str) -> dict:
    """Simple extraction - extract potential concept/entity mentions as nodes."""
    # This is a fallback: extract all Chinese noun phrases that look like concepts
    # A proper implementation would use the LLM, but for recovery we'll use heuristics

    nodes = []
    edges = []
    profiles = []
    mentions = []
    evidence = []
    node_cards = []

    # Generate unique IDs
    import uuid
    node_id_prefix = book_id.replace('-', '_')

    # Very simple heuristic extraction - find bold/heading terms
    # In practice this should use the LLM, but for now create minimal valid records

    # Create evidence record for the lesson
    evidence_id = f"evidence:{node_id_prefix}:{len(content)}"
    evidence.append({
        'id': evidence_id,
        'source_type': 'textbook',
        'source_id': book_id,
        'anchor_ref': lesson_id,
        'excerpt': content[:500] if len(content) > 500 else content,
        'locator': 'OCR content',
        'modality': 'text',
        'extraction_method': 'heuristic',
        'properties': {}
    })

    return {
        'nodes': nodes,
        'edges': edges,
        'profiles': profiles,
        'mentions': mentions,
        'evidence': evidence,
        'node_cards': node_cards
    }

def write_staging(conn, lesson_id: str, book_id: str, data: dict) -> str:
    """Write lesson staging data to database. Returns lesson_run_id."""
    import uuid

    lesson_run_id = f"lesson-run:{uuid.uuid4().hex[:12]}"

    with conn.cursor() as cur:
        # Insert lesson_run
        cur.execute("""
            INSERT INTO lesson_runs (lesson_run_id, batch_anchor, status, dataset_id, created_at)
            VALUES (%s, %s, 'staged', 'main', NOW())
        """, (lesson_run_id, lesson_id))

        # Insert nodes
        nodes = data.get('nodes', [])
        for node in nodes:
            cur.execute("""
                INSERT INTO staging_nodes (dataset_id, lesson_run_id, batch_anchor, raw_node_id, canonical_name,
                    node_kind, node_subkind, node_layer, aliases_json, definition, properties_json, status)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'candidate')
            """, (
                'main', lesson_run_id, lesson_id,
                node.get('id', ''), node.get('canonical_name', ''),
                node.get('node_kind', 'concept'), node.get('node_subkind', ''),
                node.get('node_layer', 'backbone'),
                json.dumps(node.get('aliases', [])),
                node.get('definition', ''),
                json.dumps(node.get('properties', {}))
            ))

        # Insert edges
        for edge in data.get('edges', []):
            cur.execute("""
                INSERT INTO staging_edges (dataset_id, lesson_run_id, batch_anchor, raw_edge_id,
                    from_node_id, to_node_id, edge_type, edge_layer, properties_json, status)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'candidate')
            """, (
                'main', lesson_run_id, lesson_id,
                edge.get('id', ''), edge.get('from', ''), edge.get('to', ''),
                edge.get('edge_type', 'related_to'), edge.get('edge_layer', 'association'),
                json.dumps(edge.get('properties', {}))
            ))

        # Insert profiles
        for profile in data.get('profiles', []):
            cur.execute("""
                INSERT INTO staging_profiles (dataset_id, lesson_run_id, raw_profile_id,
                    node_id, subject, school_stage, grade_band, curriculum_role, mastery_level, status)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, 'draft')
            """, (
                'main', lesson_run_id, profile.get('id', ''),
                profile.get('node_id', ''), profile.get('subject', 'chemistry'),
                profile.get('school_stage', 'junior_secondary'),
                profile.get('grade_band', '8'), profile.get('curriculum_role', 'introduced'),
                profile.get('mastery_level', 'understand')
            ))

        # Insert evidence
        for ev in data.get('evidence', []):
            cur.execute("""
                INSERT INTO staging_evidence (dataset_id, lesson_run_id, raw_evidence_id,
                    source_type, source_id, anchor_ref, excerpt, locator, modality, properties_json)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                'main', lesson_run_id, ev.get('id', ''),
                ev.get('source_type', 'textbook'), ev.get('source_id', book_id),
                ev.get('anchor_ref', lesson_id), ev.get('excerpt', ''),
                ev.get('locator', ''), ev.get('modality', 'text'),
                json.dumps(ev.get('properties', {}))
            ))

        # Insert mentions
        for mention in data.get('mentions', []):
            cur.execute("""
                INSERT INTO staging_mentions (dataset_id, lesson_run_id, raw_mention_id,
                    source_type, source_id, anchor_ref, target_type, target_id, role, source_refs_json, confidence, properties_json)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """, (
                'main', lesson_run_id, mention.get('id', ''),
                mention.get('source_type', 'textbook'), mention.get('source_id', book_id),
                mention.get('anchor_ref', lesson_id), mention.get('target_type', 'node'),
                mention.get('target_id', ''), mention.get('role', 'focuses_on'),
                json.dumps(mention.get('source_refs', [])),
                mention.get('confidence', 0.9),
                json.dumps(mention.get('properties', {}))
            ))

        # Insert node_cards
        for card in data.get('node_cards', []):
            cur.execute("""
                INSERT INTO staging_node_cards (dataset_id, lesson_run_id, raw_card_id,
                    node_id, content_json, status)
                VALUES (%s, %s, %s, %s, %s, 'draft')
            """, (
                'main', lesson_run_id, card.get('id', ''),
                card.get('node_id', ''), json.dumps(card.get('content', {}))
            ))

    conn.commit()
    return lesson_run_id

def main():
    import argparse
    parser = argparse.ArgumentParser()
    parser.add_argument('--root', default='data/main')
    parser.add_argument('--check-only', action='store_true')
    args = parser.parse_args()

    base = Path('/Users/titan-frank/Documents/hsd/research/Open-Knowledge-Map')
    root = base / args.root

    # Book configurations
    books = [
        ('chem-grade8-hukj', '八年级', 'data/outlines/chem-grade8-hukj.outline.json',
         'data/outlines/chem-grade8-hukj.marked.md'),
        ('chem-grade9-hukj', '九年级', 'data/outlines/chem-grade9-hukj.outline.json',
         'data/outlines/chem-grade9-hukj.marked.md'),
        ('chem-senior1-hukj', '高中年级', 'data/outlines/chem-senior1-hukj.outline.json',
         'data/outlines/chem-senior1-hukj.marked.md'),
        ('chem-senior2-hukj', '高中年级', 'data/outlines/chem-senior2-hukj.outline.json',
         'data/outlines/chem-senior2-hukj.marked.md'),
        ('chem-senior-elective1', '高中年级', 'data/outlines/chem-senior-elective1.outline.json',
         'data/outlines/chem-senior-elective1.marked.md'),
        ('chem-senior-elective2', '高中年级', 'data/outlines/chem-senior-elective2.outline.json',
         'data/outlines/chem-senior-elective2.marked.md'),
        ('chem-senior-elective3', '高中年级', 'data/outlines/chem-senior-elective3.outline.json',
         'data/outlines/chem-senior-elective3.marked.md'),
    ]

    conn = get_db()

    total = 0
    already_done = 0
    to_process = []

    for book_id, _, outline_path, marked_path in books:
        full_outline = str(base / outline_path)
        full_marked = str(base / marked_path)

        if not Path(full_outline).exists():
            print(f"[SKIP] No outline: {full_outline}")
            continue

        lesson_ids = parse_outline_ids(full_outline)

        for lesson_id in lesson_ids:
            if already_staged(conn, lesson_id):
                already_done += 1
            else:
                to_process.append((lesson_id, book_id, full_marked))
            total += 1

    print(f"Total lessons: {total}, Already staged: {already_done}, Need processing: {len(to_process)}")

    if args.check_only:
        return

    print(f"\nProcessing {len(to_process)} lessons...")
    # For recovery, we'll just report what's missing
    # Actual extraction requires LLM, so let's save the list
    with open('/tmp/missing_lessons.json', 'w') as f:
        json.dump(to_process, f, ensure_ascii=False)
    print(f"Missing lesson list saved to /tmp/missing_lessons.json")

    conn.close()

if __name__ == '__main__':
    main()
