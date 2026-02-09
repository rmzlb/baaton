#!/usr/bin/env python3
"""Import Airtable tickets into Baaton"""

import json, requests, sys, time

AIRTABLE_TOKEN = "patkIXXWOuZuUj1Rg.823f32d588c361d3ba8aac3eae5ca2aa59e40097b64510545be06c027da59f3d"
AIRTABLE_BASE = "appwbIveN17qHssIe"
AIRTABLE_TABLE = "tblXNYMfwam5qXNkI"
AIRTABLE_URL = f"https://api.airtable.com/v0/{AIRTABLE_BASE}/{AIRTABLE_TABLE}"

BAATON_API = "https://api.baaton.dev/api/v1"

# Map Airtable Statut → Baaton status
STATUS_MAP = {
    "📥 À faire": "todo",
    "🔄 En cours": "in_progress",
    "👀 En révision": "in_review",
    "👀 À revoir": "in_review",
    "✅ Terminé": "done",
    "🚫 Annulé": "cancelled",
    "📋 Planifié": "backlog",
}

# Map Airtable Priorité → Baaton priority
PRIORITY_MAP = {
    "🚨 Bloquant": "urgent",
    "⚡ Urgent": "high",
    "🔴 Haute": "high",
    "🟡 Moyenne": "medium",
    "🟢 Basse": "low",
    "💭 Plus tard": "low",
    "📋 Planifié": "medium",
}

# Map Airtable Catégorie → Baaton type
TYPE_MAP = {
    "✨ Feature": "feature",
    "🐛 Bug": "bug",
    "🔧 Refactor": "improvement",
    "📚 Doc": "improvement",
    "🎨 UX/UI": "feature",
    "⚙️ Process": "improvement",
    "🔗 Intégration": "feature",
}

# Map Airtable Projet → Baaton project slug
PROJECT_MAP = {
    "SqareX": "sqarex",
    "Helmai": "helmai",
}

def fetch_all_airtable():
    """Fetch all records from Airtable (handle pagination)"""
    all_records = []
    offset = None
    page = 0
    while True:
        page += 1
        params = {"pageSize": "100"}
        if offset:
            params["offset"] = offset
        r = requests.get(AIRTABLE_URL, headers={
            "Authorization": f"Bearer {AIRTABLE_TOKEN}",
        }, params=params)
        r.raise_for_status()
        data = r.json()
        records = data.get("records", [])
        all_records.extend(records)
        print(f"  Page {page}: {len(records)} records")
        offset = data.get("offset")
        if not offset:
            break
        time.sleep(0.3)  # Rate limit
    return all_records

def baaton_post(path, data):
    r = requests.post(f"{BAATON_API}{path}", json=data, headers={
        "Content-Type": "application/json",
    })
    if r.status_code not in (200, 201):
        print(f"  ⚠️  POST {path} failed: {r.status_code} {r.text[:100]}")
        return None
    return r.json()

def main():
    print("🔄 Fetching Airtable tickets...")
    records = fetch_all_airtable()
    print(f"📋 Total: {len(records)} tickets\n")

    # Get existing Baaton projects
    existing = requests.get(f"{BAATON_API}/projects").json().get("data", [])
    project_ids = {p["slug"]: p["id"] for p in existing}
    
    if "helmai" not in project_ids or "sqarex" not in project_ids:
        print("❌ Projects helmai and sqarex must exist in Baaton first")
        sys.exit(1)

    print(f"📂 Projects: helmai={project_ids['helmai'][:8]}... sqarex={project_ids['sqarex'][:8]}...")

    # Stats
    imported = 0
    skipped = 0
    by_project = {"helmai": 0, "sqarex": 0, "unknown": 0}
    by_status = {}

    for rec in records:
        f = rec["fields"]
        nom = f.get("Nom", "").strip()
        if not nom:
            skipped += 1
            continue

        # Determine project
        projet_at = f.get("Projet", "")
        slug = PROJECT_MAP.get(projet_at)
        if not slug or slug not in project_ids:
            by_project["unknown"] += 1
            skipped += 1
            continue

        project_id = project_ids[slug]

        # Map fields
        statut = f.get("Statut", "")
        status = STATUS_MAP.get(statut, "backlog")
        by_status[status] = by_status.get(status, 0) + 1

        priorite = f.get("Priorité", "")
        priority = PRIORITY_MAP.get(priorite, "medium")

        categorie = f.get("Catégorie", "")
        issue_type = TYPE_MAP.get(categorie, "feature")

        description = f.get("Description", "") or ""
        types = f.get("Type", [])  # ["FRONT", "BACK"]
        commentaires = f.get("Commentaires", "") or ""

        # Build full description
        full_desc = description
        if types:
            full_desc += f"\n\n**Type:** {', '.join(types)}"
        if commentaires:
            full_desc += f"\n\n---\n## Commentaires\n{commentaires}"
        full_desc += f"\n\n---\n*Imported from Airtable: {rec['id']}*"

        # Tags from Type field
        tags = [t.lower() for t in types] if types else []
        if categorie:
            clean_cat = categorie.replace("✨ ", "").replace("🐛 ", "").replace("🔧 ", "").replace("📚 ", "").replace("🎨 ", "").replace("⚙️ ", "").replace("🔗 ", "").lower()
            if clean_cat not in tags:
                tags.append(clean_cat)

        data = {
            "project_id": project_id,
            "title": nom,
            "description": full_desc,
            "type": issue_type,
            "status": status,
            "priority": priority,
            "tags": tags,
        }

        result = baaton_post("/issues", data)
        if result and "data" in result:
            did = result["data"].get("display_id", "?")
            print(f"  ✅ {did} [{status}] {nom[:50]}")
            imported += 1
            by_project[slug] += 1
        else:
            skipped += 1

        # Rate limit (Airtable is done, but be gentle with Baaton)
        if imported % 20 == 0:
            time.sleep(0.5)

    print(f"\n{'='*60}")
    print(f"✅ Imported: {imported}")
    print(f"⏭️  Skipped: {skipped}")
    print(f"📊 Total: {len(records)}")
    print(f"\nPar projet:")
    for k, v in by_project.items():
        print(f"  {k}: {v}")
    print(f"\nPar status:")
    for k, v in sorted(by_status.items()):
        print(f"  {k}: {v}")

if __name__ == "__main__":
    main()
