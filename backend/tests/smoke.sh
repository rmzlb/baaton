#!/usr/bin/env bash
# ─── Baaton API Smoke Tests ───────────────────────────────────
# Post-deploy validation. Run after each deployment.
# Usage: BAATON_API_KEY=baa_xxx ./tests/smoke.sh [base_url]
# ──────────────────────────────────────────────────────────────

set -euo pipefail

BASE="${1:-https://api.baaton.dev}/api/v1"
KEY="${BAATON_API_KEY:?Set BAATON_API_KEY}"
AUTH="Authorization: Bearer $KEY"
CT="Content-Type: application/json"

PASS=0
FAIL=0
CLEANUP_IDS=()

# ─── Helpers ──────────────────────────────────────────────────

check() {
  local name="$1" expected_code="$2" method="$3" endpoint="$4"
  shift 4
  local body="${1:-}"

  local args=(-s -o /tmp/smoke_body -w "%{http_code}" -X "$method" "${BASE}${endpoint}" -H "$AUTH")
  [[ -n "$body" ]] && args+=(-H "$CT" -d "$body")

  local code
  code=$(curl "${args[@]}" 2>/dev/null)

  if [[ "$code" == "$expected_code" ]]; then
    printf "  ✅ %-45s %s\n" "$name" "$code"
    PASS=$((PASS + 1))
  else
    printf "  ❌ %-45s %s (expected %s)\n" "$name" "$code" "$expected_code"
    cat /tmp/smoke_body 2>/dev/null | head -c 200
    echo
    FAIL=$((FAIL + 1))
  fi
}

# Return response body (for extracting IDs)
check_extract() {
  local name="$1" expected_code="$2" method="$3" endpoint="$4"
  shift 4
  local body="${1:-}"

  local args=(-s -o /tmp/smoke_body -w "%{http_code}" -X "$method" "${BASE}${endpoint}" -H "$AUTH")
  [[ -n "$body" ]] && args+=(-H "$CT" -d "$body")

  local code
  code=$(curl "${args[@]}" 2>/dev/null)

  if [[ "$code" == "$expected_code" ]]; then
    printf "  ✅ %-45s %s\n" "$name" "$code" >&2
    PASS=$((PASS + 1))
  else
    printf "  ❌ %-45s %s (expected %s)\n" "$name" "$code" "$expected_code" >&2
    FAIL=$((FAIL + 1))
  fi
  cat /tmp/smoke_body
}

# ─── Public endpoints (no auth) ──────────────────────────────

echo "── Public Endpoints ──"

pub_code=$(curl -s -o /tmp/smoke_body -w "%{http_code}" "${BASE}/public/docs" 2>/dev/null)
if [[ "$pub_code" == "200" ]]; then
  printf "  ✅ %-45s %s\n" "GET /public/docs" "$pub_code"
  PASS=$((PASS + 1))
else
  printf "  ❌ %-45s %s (expected 200)\n" "GET /public/docs" "$pub_code"
  FAIL=$((FAIL + 1))
fi

pub_code=$(curl -s -o /tmp/smoke_body -w "%{http_code}" "${BASE}/public/skill" 2>/dev/null)
if [[ "$pub_code" == "200" ]]; then
  printf "  ✅ %-45s %s\n" "GET /public/skill" "$pub_code"
  PASS=$((PASS + 1))
else
  printf "  ❌ %-45s %s (expected 200)\n" "GET /public/skill" "$pub_code"
  FAIL=$((FAIL + 1))
fi

# ─── Auth & Projects ─────────────────────────────────────────

echo "── Auth & Projects ──"

check "GET /projects (list)"               200 GET "/projects"

# Bad auth test (manual curl, override AUTH header)
bad_code=$(curl -s -o /dev/null -w "%{http_code}" -X GET "${BASE}/projects" -H "Authorization: Bearer baa_invalid_key" 2>/dev/null)
if [[ "$bad_code" == "401" ]]; then
  printf "  ✅ %-45s %s\n" "GET /projects (bad key → 401)" "$bad_code"
  PASS=$((PASS + 1))
else
  printf "  ❌ %-45s %s (expected 401)\n" "GET /projects (bad key → 401)" "$bad_code"
  FAIL=$((FAIL + 1))
fi

# Extract project ID for subsequent tests
PROJECT_ID=$(curl -s "${BASE}/projects" -H "$AUTH" 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d['data'][0]['id'])" 2>/dev/null || echo "")

if [[ -z "$PROJECT_ID" ]]; then
  echo "  ⚠️  No project found — skipping project-dependent tests"
  echo
  echo "═══════════════════════════════════════════"
  printf "  Results: %d passed, %d failed\n" "$PASS" "$FAIL"
  exit $([[ $FAIL -gt 0 ]] && echo 1 || echo 0)
fi

echo "  ℹ️  Using project: $PROJECT_ID"

check "GET /projects/{id}"                 200 GET "/projects/$PROJECT_ID"

# ─── Issues CRUD ──────────────────────────────────────────────

echo "── Issues CRUD ──"

check "GET /issues (list all)"             200 GET "/issues"
check "GET /projects/{id}/issues"          200 GET "/projects/$PROJECT_ID/issues"
check "GET /issues/mine"                   200 GET "/issues/mine?assignee_id=smoke-test"

# Create a test issue
ISSUE_JSON=$(check_extract "POST /issues (create)" 200 POST "/issues" \
  "{\"project_id\":\"$PROJECT_ID\",\"title\":\"[SMOKE TEST] Auto-delete me\",\"issue_type\":\"bug\",\"priority\":\"low\",\"status\":\"backlog\"}")

ISSUE_ID=$(echo "$ISSUE_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])" 2>/dev/null || echo "")
DISPLAY_ID=$(echo "$ISSUE_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['display_id'])" 2>/dev/null || echo "")

if [[ -z "$ISSUE_ID" ]]; then
  echo "  ⚠️  Could not create test issue — skipping dependent tests"
else
  echo "  ℹ️  Created issue: $DISPLAY_ID ($ISSUE_ID)"
  CLEANUP_IDS+=("$ISSUE_ID")

  check "GET /issues/{id}"                200 GET "/issues/$ISSUE_ID"

  check "PATCH /issues/{id} (update)"     200 PATCH "/issues/$ISSUE_ID" \
    '{"status":"in_progress","priority":"medium"}'

  # ─── Comments ───────────────────────────────────────────────

  echo "── Comments ──"

  COMMENT_JSON=$(check_extract "POST /issues/{id}/comments" 200 POST "/issues/$ISSUE_ID/comments" \
    '{"body":"Smoke test comment — safe to delete"}')

  COMMENT_ID=$(echo "$COMMENT_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])" 2>/dev/null || echo "")

  check "GET /issues/{id}/comments"        200 GET "/issues/$ISSUE_ID/comments"

  if [[ -n "$COMMENT_ID" ]]; then
    check "DELETE comment"                 200 DELETE "/issues/$ISSUE_ID/comments/$COMMENT_ID"
  fi

  # ─── TLDRs ─────────────────────────────────────────────────

  echo "── TLDRs ──"

  check "POST /issues/{id}/tldr"           200 POST "/issues/$ISSUE_ID/tldr" \
    '{"agent_name":"smoke-test","summary":"Automated smoke test","tests_status":"passed"}'

  # ─── Activity ───────────────────────────────────────────────

  echo "── Activity ──"

  check "GET /issues/{id}/activity"        200 GET "/issues/$ISSUE_ID/activity"
  check "GET /activity (recent)"           200 GET "/activity"

  # ─── Children / Relations ───────────────────────────────────

  echo "── Relations ──"

  check "GET /issues/{id}/children"        200 GET "/issues/$ISSUE_ID/children"
  check "GET /issues/{id}/relations"       200 GET "/issues/$ISSUE_ID/relations"
fi

# ─── Search ───────────────────────────────────────────────────

echo "── Search ──"

check "GET /search?q=test"                 200 GET "/search?q=test"
check "GET /search/global?q=test"          200 GET "/search/global?q=test"

# ─── Tags & Milestones ───────────────────────────────────────

echo "── Tags & Milestones ──"

check "GET /projects/{id}/tags"            200 GET "/projects/$PROJECT_ID/tags"
check "GET /projects/{id}/milestones"      200 GET "/projects/$PROJECT_ID/milestones"

# ─── Sprints & Cycles ────────────────────────────────────────

echo "── Sprints & Cycles ──"

check "GET /projects/{id}/sprints"         200 GET "/projects/$PROJECT_ID/sprints"
check "GET /projects/{id}/cycles"          200 GET "/projects/$PROJECT_ID/cycles"

# ─── Templates ────────────────────────────────────────────────

echo "── Templates ──"

check "GET /projects/{id}/templates"       200 GET "/projects/$PROJECT_ID/templates"

# ─── Automations & SLA ────────────────────────────────────────

echo "── Automations & SLA ──"

check "GET /projects/{id}/automations"     200 GET "/projects/$PROJECT_ID/automations"
check "GET /projects/{id}/sla-rules"       200 GET "/projects/$PROJECT_ID/sla-rules"
check "GET /projects/{id}/sla-stats"       200 GET "/projects/$PROJECT_ID/sla-stats"

# ─── Recurring ────────────────────────────────────────────────

echo "── Recurring ──"

check "GET /projects/{id}/recurring"       200 GET "/projects/$PROJECT_ID/recurring"

# ─── Webhooks ─────────────────────────────────────────────────

echo "── Webhooks ──"

check "GET /webhooks"                      200 GET "/webhooks"

# ─── Metrics ──────────────────────────────────────────────────

echo "── Metrics ──"

check "GET /metrics"                       200 GET "/metrics"
check "GET /metrics?days=7"                200 GET "/metrics?days=7"

# ─── Billing ──────────────────────────────────────────────────

echo "── Billing ──"

check "GET /billing"                       200 GET "/billing"

# ─── Views ────────────────────────────────────────────────────

echo "── Views ──"

check "GET /views"                         200 GET "/views"

# ─── Notifications ────────────────────────────────────────────

echo "── Notifications ──"

check "GET /notifications"                 200 GET "/notifications"
check "GET /notifications/count"           200 GET "/notifications/count"

# ─── API Keys ─────────────────────────────────────────────────

echo "── API Keys ──"

check "GET /api-keys (403 from api key)"   403 GET "/api-keys"

# ─── Initiatives ──────────────────────────────────────────────

echo "── Initiatives ──"

check "GET /initiatives"                   200 GET "/initiatives"

# ─── Export ───────────────────────────────────────────────────

echo "── Export ──"

check "GET /projects/{id}/export"          200 GET "/projects/$PROJECT_ID/export"

# ─── Validation (expect errors) ───────────────────────────────

echo "── Validation ──"

check "POST /issues (missing title → 422)" 422 POST "/issues" \
  "{\"project_id\":\"$PROJECT_ID\"}"

check "POST /issues (bad status → 400)"   400 POST "/issues" \
  "{\"project_id\":\"$PROJECT_ID\",\"title\":\"test\",\"status\":\"invalid_status\"}"

check "GET /issues/00000000-0000-0000-0000-000000000000" 404 GET "/issues/00000000-0000-0000-0000-000000000000"

# ─── Cleanup ──────────────────────────────────────────────────

echo "── Cleanup ──"

for id in "${CLEANUP_IDS[@]}"; do
  check "DELETE test issue $DISPLAY_ID"    200 DELETE "/issues/$id"
done

# ─── Summary ──────────────────────────────────────────────────

echo
echo "═══════════════════════════════════════════"
printf "  Results: %d passed, %d failed\n" "$PASS" "$FAIL"
echo "═══════════════════════════════════════════"

exit $([[ $FAIL -gt 0 ]] && echo 1 || echo 0)
