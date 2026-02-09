#!/usr/bin/env python3
"""Import Linear tickets into Baaton via API"""

import json
import requests
import sys
from datetime import datetime

BAATON_API = "https://api.baaton.dev/api/v1"
LINEAR_API = "https://api.linear.app/graphql"
LINEAR_TOKEN = "lin_api_P4szgAGrgI1MhtzQnr2PHbCN0dAhcv8bvjxM4KUP"
LINEAR_TEAM_ID = "e0794461-a5ab-4269-875b-8f13c71d48b7"

# Map Linear states to Baaton statuses
STATE_MAP = {
    "Triage": "backlog",
    "Backlog": "backlog",
    "Todo": "todo",
    "In Progress": "in_progress",
    "In Review": "in_review",
    "Done": "done",
    "Canceled": "cancelled",
    "Cancelled": "cancelled",
}

# Map Linear priority (1=urgent, 2=high, 3=medium, 4=low, 0=none)
PRIORITY_MAP = {
    1: "urgent",
    2: "high",
    3: "medium",
    4: "low",
    0: "low",
}

# Map labels to Baaton types
LABEL_TYPE_MAP = {
    "Bug": "bug",
    "Feature": "feature",
    "Improvement": "improvement",
}

def linear_query(query):
    """Execute a Linear GraphQL query"""
    r = requests.post(LINEAR_API, json={"query": query}, headers={
        "Authorization": LINEAR_TOKEN,
        "Content-Type": "application/json",
    })
    r.raise_for_status()
    return r.json()

def baaton_post(path, data):
    """POST to Baaton API"""
    r = requests.post(f"{BAATON_API}{path}", json=data, headers={
        "Content-Type": "application/json",
    })
    if r.status_code not in (200, 201):
        print(f"  ⚠️  POST {path} failed: {r.status_code} {r.text[:200]}")
        return None
    return r.json()

def fetch_all_linear_issues():
    """Fetch all issues with full details from Linear"""
    query = '''query {
        team(id: "%s") {
            issues(first: 250, orderBy: createdAt) {
                nodes {
                    id identifier title description
                    state { name }
                    priority priorityLabel
                    createdAt updatedAt
                    labels { nodes { name } }
                    project { name id }
                    assignee { name }
                    comments(first: 50) {
                        nodes {
                            body createdAt
                            user { name }
                        }
                    }
                }
            }
        }
    }''' % LINEAR_TEAM_ID
    
    data = linear_query(query)
    return data["data"]["team"]["issues"]["nodes"]

def create_project(name, slug, prefix, description=""):
    """Create a project in Baaton"""
    result = baaton_post("/projects", {
        "name": name,
        "slug": slug,
        "prefix": prefix,
        "description": description,
    })
    if result and "data" in result:
        print(f"✅ Created project: {name} ({prefix})")
        return result["data"]
    return None

def create_issue(project_id, linear_issue):
    """Create an issue in Baaton from a Linear issue"""
    labels = [l["name"] for l in linear_issue["labels"]["nodes"]]
    
    # Determine type from labels
    issue_type = "bug"
    for label, btype in LABEL_TYPE_MAP.items():
        if label in labels:
            issue_type = btype
            break
    
    # Map status
    state_name = linear_issue["state"]["name"]
    status = STATE_MAP.get(state_name, "backlog")
    
    # Map priority
    priority = PRIORITY_MAP.get(linear_issue["priority"], "low")
    
    # Clean title (remove [Bug], [Feature] etc prefixes)
    title = linear_issue["title"]
    for prefix in ["[Bug] ", "[Feature] ", "[Improvement] ", "[TEST] "]:
        if title.startswith(prefix):
            title = title[len(prefix):]
            break
    
    # Build description with history
    desc = linear_issue.get("description") or ""
    
    # Add comments to description
    comments = linear_issue.get("comments", {}).get("nodes", [])
    if comments:
        desc += "\n\n---\n## Comments\n"
        for c in comments:
            user = c.get("user", {}).get("name", "Unknown")
            date = c["createdAt"][:10]
            desc += f"\n**{user}** ({date}):\n{c['body']}\n"
    
    # Add Linear metadata
    desc += f"\n\n---\n*Imported from Linear: {linear_issue['identifier']} ({linear_issue['createdAt'][:10]})*"
    
    data = {
        "project_id": project_id,
        "title": title,
        "description": desc,
        "type": issue_type,
        "status": status,
        "priority": priority,
        "tags": [l.lower() for l in labels],
    }
    
    result = baaton_post("/issues", data)
    if result and "data" in result:
        return result["data"]
    return None

def main():
    print("🔄 Fetching Linear issues...")
    issues = fetch_all_linear_issues()
    print(f"📋 Found {len(issues)} issues")
    
    # Group by project
    projects = {}
    for issue in issues:
        proj = issue.get("project")
        pname = proj["name"] if proj else "Unassigned"
        if pname not in projects:
            projects[pname] = []
        projects[pname].append(issue)
    
    print(f"\n📂 Projects: {', '.join(projects.keys())}")
    
    # Create projects in Baaton
    project_map = {}
    
    # Check existing projects first
    existing = requests.get(f"{BAATON_API}/projects").json().get("data", [])
    existing_slugs = {p["slug"]: p for p in existing}
    
    # Create or reuse HelmAI
    if "helmai" in existing_slugs:
        project_map["Helmai"] = existing_slugs["helmai"]["id"]
        print(f"♻️  Reusing project: HelmAI ({existing_slugs['helmai']['id'][:8]}...)")
    else:
        helmai = create_project("HelmAI", "helmai", "HLM", "Voice agent platform for healthcare")
        if helmai:
            project_map["Helmai"] = helmai["id"]
    
    # Create or reuse SqareX
    if "sqarex" in existing_slugs:
        project_map["SqareX"] = existing_slugs["sqarex"]["id"]
        print(f"♻️  Reusing project: SqareX ({existing_slugs['sqarex']['id'][:8]}...)")
    else:
        sqarex = create_project("SqareX", "sqarex", "SQX", "Multi-tenant dental SaaS platform")
        if sqarex:
            project_map["SqareX"] = sqarex["id"]
    
    if not project_map:
        print("❌ No projects available")
        sys.exit(1)
    
    # Import issues
    imported = 0
    skipped = 0
    
    for issue in issues:
        proj = issue.get("project")
        pname = proj["name"] if proj else None
        
        project_id = project_map.get(pname)
        if not project_id:
            print(f"  ⏭️  Skipping {issue['identifier']}: no matching project ({pname})")
            skipped += 1
            continue
        
        result = create_issue(project_id, issue)
        if result:
            print(f"  ✅ {issue['identifier']} → {result.get('display_id', '?')}: {issue['title'][:50]}")
            imported += 1
        else:
            print(f"  ❌ Failed: {issue['identifier']}: {issue['title'][:50]}")
            skipped += 1
    
    print(f"\n{'='*50}")
    print(f"✅ Imported: {imported}")
    print(f"⏭️  Skipped: {skipped}")
    print(f"📊 Total: {len(issues)}")

if __name__ == "__main__":
    main()
