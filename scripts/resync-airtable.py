#!/usr/bin/env python3
"""
Resync Airtable data into Baaton Supabase DB.
Matches issues by title (Nom), then syncs:
  - Type array → tags
  - Commentaires → TLDR records
  - PJ attachments → attachments JSONB
  - Priorité → priority mapping
Also ensures project_tags for FRONT/BACK/API/DB exist.
"""

import json
import os
import sys
import time
import requests

try:
    import psycopg2
    import psycopg2.extras
except ImportError:
    print("psycopg2 not installed. Run: pip install psycopg2-binary")
    sys.exit(1)

# ── Config (from environment) ─────────────────────

AIRTABLE_TOKEN = os.environ.get("AIRTABLE_TOKEN")
AIRTABLE_BASE = os.environ.get("AIRTABLE_BASE", "appwbIveN17qHssIe")
AIRTABLE_TABLE = os.environ.get("AIRTABLE_TABLE", "tblXNYMfwam5qXNkI")
AIRTABLE_URL = f"https://api.airtable.com/v0/{AIRTABLE_BASE}/{AIRTABLE_TABLE}"

DATABASE_URL = os.environ.get("DATABASE_URL")

if not AIRTABLE_TOKEN or not DATABASE_URL:
    print("Missing required env vars: AIRTABLE_TOKEN, DATABASE_URL")
    sys.exit(1)

PRIORITY_MAP = {
    "⚡ Urgent": "urgent",
    "🚨 Bloquant": "urgent",
    "🔴 Haute": "high",
    "🟡 Normale": "medium",
    "🟡 Moyenne": "medium",
    "🟢 Basse": "low",
    "💭 Plus tard": "low",
    "📋 Planifié": "medium",
}

# Category tag colors
TAG_COLORS = {
    "FRONT": "#3b82f6",
    "BACK": "#22c55e",
    "API": "#8b5cf6",
    "DB": "#f97316",
}


def get_db_connection():
    """Connect to Supabase via DATABASE_URL."""
    conn = psycopg2.connect(
        dsn=DATABASE_URL,
        options="-c statement_timeout=30000",
    )
    conn.autocommit = False
    return conn


def fetch_all_airtable():
    """Fetch all records from Airtable with pagination."""
    all_records = []
    offset = None
    page = 0
    while True:
        page += 1
        params = {"pageSize": "100"}
        if offset:
            params["offset"] = offset
        r = requests.get(
            AIRTABLE_URL,
            headers={"Authorization": f"Bearer {AIRTABLE_TOKEN}"},
            params=params,
        )
        r.raise_for_status()
        data = r.json()
        records = data.get("records", [])
        all_records.extend(records)
        print(f"  Page {page}: {len(records)} records")
        offset = data.get("offset")
        if not offset:
            break
        time.sleep(0.3)
    return all_records


def ensure_project_tags(cur):
    """Ensure FRONT/BACK/API/DB project_tags exist for all projects."""
    cur.execute("SELECT id FROM projects")
    projects = cur.fetchall()
    created = 0
    for (project_id,) in projects:
        for tag_name, color in TAG_COLORS.items():
            cur.execute(
                """
                INSERT INTO project_tags (project_id, name, color)
                VALUES (%s, %s, %s)
                ON CONFLICT (project_id, name) DO UPDATE SET color = EXCLUDED.color
                """,
                (project_id, tag_name, color),
            )
            if cur.statusmessage and "INSERT" in cur.statusmessage:
                created += 1
    return created


def find_issue_by_title(cur, title):
    """Find an issue by matching title exactly."""
    cur.execute(
        "SELECT id, tags, attachments, priority FROM issues WHERE title = %s LIMIT 1",
        (title,),
    )
    return cur.fetchone()


def update_issue_tags(cur, issue_id, airtable_types, existing_tags):
    """Merge airtable Type array into issue tags."""
    tags_set = set(existing_tags or [])
    for t in airtable_types:
        tags_set.add(t.upper())
    new_tags = list(tags_set)
    cur.execute(
        "UPDATE issues SET tags = %s, updated_at = now() WHERE id = %s",
        (new_tags, issue_id),
    )
    return new_tags


def update_issue_attachments(cur, issue_id, pj_list):
    """Update attachments JSONB from Airtable PJ field."""
    attachments = []
    for pj in pj_list:
        attachments.append({
            "url": pj.get("url", ""),
            "name": pj.get("filename", "unknown"),
            "size": pj.get("size", 0),
            "mime_type": pj.get("type", "application/octet-stream"),
        })
    cur.execute(
        "UPDATE issues SET attachments = %s::jsonb, updated_at = now() WHERE id = %s",
        (json.dumps(attachments), issue_id),
    )
    return len(attachments)


def update_issue_priority(cur, issue_id, airtable_priority, current_priority):
    """Map and update priority if changed."""
    mapped = PRIORITY_MAP.get(airtable_priority)
    if mapped and mapped != current_priority:
        cur.execute(
            "UPDATE issues SET priority = %s, updated_at = now() WHERE id = %s",
            (mapped, issue_id),
        )
        return True
    return False


def create_tldr_if_needed(cur, issue_id, commentaires):
    """Create a TLDR record from Airtable Commentaires if one doesn't exist."""
    if not commentaires or not commentaires.strip():
        return False
    # Check if TLDR from airtable-import already exists
    cur.execute(
        "SELECT id FROM tldrs WHERE issue_id = %s AND agent_name = %s LIMIT 1",
        (issue_id, "airtable-import"),
    )
    if cur.fetchone():
        return False
    cur.execute(
        """
        INSERT INTO tldrs (issue_id, agent_name, summary, files_changed, tests_status)
        VALUES (%s, %s, %s, %s, %s)
        """,
        (issue_id, "airtable-import", commentaires.strip(), [], "none"),
    )
    return True


def main():
    print("🔄 Fetching Airtable records...")
    records = fetch_all_airtable()
    print(f"📋 Total: {len(records)} records\n")

    print("🔌 Connecting to Supabase...")
    conn = get_db_connection()
    cur = conn.cursor()

    # Ensure project_tags
    print("🏷️  Ensuring project tags (FRONT/BACK/API/DB)...")
    tags_created = ensure_project_tags(cur)
    print(f"   Created/updated {tags_created} project tags\n")

    # Stats
    updated = 0
    tldrs_created = 0
    attachments_synced = 0
    not_found = 0
    skipped = 0

    for i, rec in enumerate(records):
        f = rec.get("fields", {})
        nom = f.get("Nom", "").strip()
        if not nom:
            skipped += 1
            continue

        # Find matching issue
        row = find_issue_by_title(cur, nom)
        if not row:
            not_found += 1
            if not_found <= 10:
                print(f"  ⚠️  Not found: {nom[:60]}")
            continue

        issue_id, existing_tags, existing_attachments, current_priority = row
        changed = False

        # 1. Sync Type → tags
        airtable_types = f.get("Type", [])
        if airtable_types:
            update_issue_tags(cur, issue_id, airtable_types, existing_tags)
            changed = True

        # 2. Sync Commentaires → TLDR
        commentaires = f.get("Commentaires", "")
        if create_tldr_if_needed(cur, issue_id, commentaires):
            tldrs_created += 1
            changed = True

        # 3. Sync PJ → attachments
        pj_list = f.get("PJ", [])
        if pj_list:
            count = update_issue_attachments(cur, issue_id, pj_list)
            attachments_synced += count
            changed = True

        # 4. Sync Priorité → priority
        airtable_priority = f.get("Priorité", "")
        if airtable_priority:
            if update_issue_priority(cur, issue_id, airtable_priority, current_priority):
                changed = True

        if changed:
            updated += 1
            if updated <= 20 or updated % 10 == 0:
                print(f"  ✅ [{updated}] {nom[:60]}")

    conn.commit()
    cur.close()
    conn.close()

    print(f"\n{'='*60}")
    print(f"📊 Summary:")
    print(f"  ✅ Updated:    {updated} issues")
    print(f"  📝 TLDRs:      {tldrs_created} created")
    print(f"  📎 Attachments: {attachments_synced} synced")
    print(f"  ⚠️  Not found:  {not_found}")
    print(f"  ⏭️  Skipped:    {skipped} (no title)")
    print(f"  📋 Total:      {len(records)} Airtable records")


if __name__ == "__main__":
    main()
