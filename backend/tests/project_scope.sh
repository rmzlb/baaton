#!/usr/bin/env bash
# ─── Project-scoped API keys: end-to-end isolation (BAA-36) ───────────────
# Starts the API binary against a DISPOSABLE PostgreSQL database, seeds one org
# with two projects (A and B) plus a second org, then checks over HTTP that:
#
# - a key limited to project A reads, lists, searches, publishes, streams,
#   subscribes to and comments on nothing of project B (404 or filtered list),
#   and cannot use the organization-wide surfaces (403);
# - a key limited to project A can only create webhooks and keys limited to A;
# - a webhook limited to a project only receives that project's events;
# - an unscoped key and a Clerk user keep the whole organization.
#
# A Clerk user is simulated with a throw-away RSA key served as JWKS on the aux
# port (CLERK_ISSUER points there); the same aux server records webhook calls.
#
# Usage:
#   DATABASE_URL_TEST=postgres://user:pass@127.0.0.1:55560/baaton_test \
#   PSQL="docker exec -i <container> psql -U user -d baaton_test" \
#   ./tests/project_scope.sh [path/to/baaton-api]
#
# Needs bash, curl, jq, openssl and python3. Writes only to DATABASE_URL_TEST
# (fresh ids on every run) and refuses a database that is not on localhost.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

DB_URL="${DATABASE_URL_TEST:?Set DATABASE_URL_TEST to a disposable local database}"
case "$DB_URL" in
  *@127.0.0.1:*|*@localhost:*|*@127.0.0.1/*|*@localhost/*) ;;
  *) echo "DATABASE_URL_TEST must point at 127.0.0.1 or localhost" >&2; exit 2 ;;
esac
read -r -a PSQL_CMD <<< "${PSQL:-psql $DB_URL}"
API_BIN="${1:-$(dirname "$0")/../target/debug/baaton-api}"
API_PORT="${API_PORT:-4161}"
AUX_PORT="${AUX_PORT:-4162}"
BASE="http://127.0.0.1:${API_PORT}/api/v1"
AUX="http://127.0.0.1:${AUX_PORT}"

WORK="$(mktemp -d)"
API_PID=""
AUX_PID=""
cleanup() {
  [[ -n "$API_PID" ]] && kill "$API_PID" 2>/dev/null || true
  [[ -n "$AUX_PID" ]] && kill "$AUX_PID" 2>/dev/null || true
  wait 2>/dev/null || true
  rm -rf "$WORK"
}
trap cleanup EXIT

PASS=0
FAIL=0
sql() { "${PSQL_CMD[@]}" -v ON_ERROR_STOP=1 -qAt -c "$1"; }
uuid() { python3 -I -c 'import uuid; print(uuid.uuid4())'; }
b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

# ─── Aux server: JWKS for the simulated Clerk user + webhook receiver ──────

openssl genrsa -out "$WORK/jwt.pem" 2048 2>/dev/null
MODULUS="$(openssl rsa -in "$WORK/jwt.pem" -noout -modulus | cut -d= -f2 | xxd -r -p | b64url)"
mkdir -p "$WORK/.well-known"
jq -cn --arg n "$MODULUS" \
  '{keys: [{kty: "RSA", kid: "scope-e2e", use: "sig", alg: "RS256", n: $n, e: "AQAB"}]}' \
  > "$WORK/.well-known/jwks.json"

cat > "$WORK/aux.py" <<'PY'
import json, os, sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

root, port = sys.argv[1], int(sys.argv[2])

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        with open(os.path.join(root, ".well-known", "jwks.json"), "rb") as f:
            body = f.read()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length).decode("utf-8", "replace")
        with open(os.path.join(root, "received.jsonl"), "a") as f:
            f.write(json.dumps({"path": self.path, "body": body}) + "\n")
        self.send_response(200)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, *args):
        pass

ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
PY
touch "$WORK/received.jsonl"
python3 -I "$WORK/aux.py" "$WORK" "$AUX_PORT" &
AUX_PID=$!

# ─── API ────────────────────────────────────────────────────────────────────

env -i PATH="$PATH" HOME="$HOME" \
  DATABASE_URL="$DB_URL" PORT="$API_PORT" RUST_LOG="baaton_api=warn" \
  CLERK_ISSUER="$AUX" UPLOAD_DIR="$WORK/uploads" \
  "$API_BIN" > "$WORK/api.log" 2>&1 &
API_PID=$!
for _ in $(seq 1 60); do
  curl -sf "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -sf "http://127.0.0.1:${API_PORT}/health" >/dev/null || { cat "$WORK/api.log"; exit 1; }

# ─── Fixtures ───────────────────────────────────────────────────────────────

RUN="$(openssl rand -hex 4)"
ORG="org_scope_${RUN}"
ORG2="org_other_${RUN}"
PA="$(uuid)"; PB="$(uuid)"; PC="$(uuid)"
A1="$(uuid)"; A2="$(uuid)"; B1="$(uuid)"; B2="$(uuid)"; C1="$(uuid)"
VIEW="$(uuid)"
KA_ID="$(uuid)"; KU_ID="$(uuid)"; K2_ID="$(uuid)"
KA="baa_$(openssl rand -hex 32)"
KU="baa_$(openssl rand -hex 32)"
K2="baa_$(openssl rand -hex 32)"
UP="$(printf %s "$RUN" | tr 'a-f' 'A-F')"
PREFIX_A="A${UP:0:4}"; PREFIX_B="B${UP:0:4}"; PREFIX_C="C${UP:0:4}"

sql "
INSERT INTO organizations (id, name, slug, plan) VALUES
  ('$ORG', 'Scope org $RUN', 'scope-$RUN', 'tester'),
  ('$ORG2', 'Other org $RUN', 'other-$RUN', 'tester');
INSERT INTO projects (id, org_id, name, slug, prefix) VALUES
  ('$PA', '$ORG', 'Alpha $RUN', 'alpha-$RUN', '$PREFIX_A'),
  ('$PB', '$ORG', 'Bravo $RUN', 'bravo-$RUN', '$PREFIX_B'),
  ('$PC', '$ORG2', 'Charlie $RUN', 'charlie-$RUN', '$PREFIX_C');
INSERT INTO issues (id, project_id, display_id, title, status, parent_id) VALUES
  ('$A1', '$PA', '$PREFIX_A-1', 'alpha scopeprobe', 'backlog', NULL),
  ('$A2', '$PA', '$PREFIX_A-2', 'alpha child scopeprobe', 'backlog', '$A1'),
  ('$B1', '$PB', '$PREFIX_B-1', 'bravo scopeprobe', 'backlog', NULL),
  ('$B2', '$PB', '$PREFIX_B-2', 'bravo child of alpha scopeprobe', 'backlog', '$A1'),
  ('$C1', '$PC', '$PREFIX_C-1', 'charlie scopeprobe', 'backlog', NULL);
INSERT INTO comments (issue_id, author_id, author_name, body) VALUES
  ('$B1', 'user_seed', 'Seed', 'bravo comment');
INSERT INTO activity_log (org_id, project_id, issue_id, user_id, action) VALUES
  ('$ORG', '$PA', '$A1', 'user_seed', 'created'),
  ('$ORG', '$PB', '$B1', 'user_seed', 'created');
INSERT INTO github_pr_links (issue_id, github_repo_id, pr_number, pr_id, pr_title, pr_url, head_branch, base_branch, author_login)
  VALUES ('$B1', 1, $((16#${RUN:0:6})), $((16#${RUN:0:7})), 'bravo pr', 'https://github.invalid/pr/$RUN', 'bravo', 'main', 'seed');
INSERT INTO agent_sessions (org_id, project_id, issue_id, agent_name)
  VALUES ('$ORG', '$PB', '$B1', 'seed-agent');
INSERT INTO custom_views (id, org_id, created_by, name, visibility)
  VALUES ('$VIEW', '$ORG', 'user_seed', 'Everything $RUN', 'shared');
INSERT INTO api_keys (id, org_id, name, key_hash, key_prefix, permissions, project_ids) VALUES
  ('$KA_ID', '$ORG', 'alpha only', encode(sha256('$KA'::bytea), 'hex'), 'baa_a...', '{admin:full,api-keys:read,api-keys:write}', '{$PA}'),
  ('$KU_ID', '$ORG', 'whole org', encode(sha256('$KU'::bytea), 'hex'), 'baa_u...', '{admin:full}', '{}'),
  ('$K2_ID', '$ORG2', 'other org', encode(sha256('$K2'::bytea), 'hex'), 'baa_2...', '{admin:full}', '{}');
" >/dev/null

# Simulated Clerk user, admin of $ORG.
NOW="$(date +%s)"
JWT_HEADER="$(printf '%s' '{"alg":"RS256","typ":"JWT","kid":"scope-e2e"}' | b64url)"
JWT_PAYLOAD="$(jq -cn --arg iss "$AUX" --arg org "$ORG" --arg sub "user_scope_${RUN}" --argjson now "$NOW" \
  '{sub: $sub, iss: $iss, iat: $now, nbf: ($now - 5), exp: ($now + 3600), v: 2,
    o: {id: $org, rol: "admin", slg: "scope"}, first_name: "Scope", last_name: "Probe",
    email: "scope-probe@example.invalid"}' | b64url)"
JWT_SIG="$(printf '%s.%s' "$JWT_HEADER" "$JWT_PAYLOAD" | openssl dgst -sha256 -sign "$WORK/jwt.pem" -binary | b64url)"
HUMAN="${JWT_HEADER}.${JWT_PAYLOAD}.${JWT_SIG}"

# ─── Helpers ────────────────────────────────────────────────────────────────

# call <token> <method> <path> [json-body] — sets CODE, response in $WORK/body
call() {
  local token="$1" method="$2" path="$3" body="${4:-}"
  local args=(-s -o "$WORK/body" -w '%{http_code}' -X "$method" "${BASE}${path}" -K -)
  [[ -n "$body" ]] && args+=(-H 'Content-Type: application/json' --data-binary "$body")
  CODE="$(printf 'header = "Authorization: Bearer %s"\n' "$token" | curl "${args[@]}" || true)"
}

# mcp <token> <tool> <arguments-json>
mcp() {
  local payload
  payload="$(jq -cn --arg name "$2" --argjson args "$3" \
    '{jsonrpc: "2.0", id: 1, method: "tools/call", params: {name: $name, arguments: $args}}')"
  CODE="$(printf 'header = "Authorization: Bearer %s"\n' "$1" | curl -s -o "$WORK/body" -w '%{http_code}' \
    -X POST "http://127.0.0.1:${API_PORT}/mcp" -K - -H 'Content-Type: application/json' \
    -H 'Accept: application/json, text/event-stream' --data-binary "$payload" || true)"
}

ok()  { printf '  ok    %s\n' "$1"; PASS=$((PASS + 1)); }
bad() { printf '  FAIL  %s — %s\n' "$1" "$2"; head -c 300 "$WORK/body" 2>/dev/null | tr '\n' ' '; echo; FAIL=$((FAIL + 1)); }

expect_code() { [[ "$CODE" == "$2" ]] && ok "$1 → $CODE" || bad "$1" "HTTP $CODE, expected $2"; }
# expect_list <name> <must-contain ids...> -- <must-not-contain ids...>
expect_list() {
  local name="$1"; shift
  local missing=() leaked=() seen_sep=0 id
  for id in "$@"; do
    if [[ "$id" == "--" ]]; then seen_sep=1; continue; fi
    if (( seen_sep )); then grep -q "$id" "$WORK/body" && leaked+=("$id")
    else grep -q "$id" "$WORK/body" || missing+=("$id"); fi
  done
  if [[ "$CODE" != "200" ]]; then bad "$name" "HTTP $CODE, expected 200"
  elif (( ${#leaked[@]} )); then bad "$name" "leaks ${leaked[*]}"
  elif (( ${#missing[@]} )); then bad "$name" "missing ${missing[*]}"
  else ok "$name"; fi
}
name_of() {
  case "$1" in
    "$PA") echo PA ;; "$PB") echo PB ;; "$A1") echo A1 ;; "$A2") echo A2 ;;
    "$B1") echo B1 ;; "$B2") echo B2 ;; *) echo "$1" ;;
  esac
}

echo "Project-scoped keys — run $RUN (org $ORG, A=$PA, B=$PB)"

# ─── 1. Key limited to project A, against project B ────────────────────────
echo "1. Key limited to project A"

call "$KA" GET /projects;                         expect_list "GET /projects lists A only" "$PA" -- "$PB"
call "$KA" GET "/projects/$PB";                   expect_code "GET /projects/B" 404
call "$KA" GET "/issues?limit=100";               expect_list "GET /issues" "$A1" -- "$B1" "$B2"
call "$KA" GET "/issues/$B1";                     expect_code "GET /issues/B1" 404
call "$KA" GET "/search?q=scopeprobe";            expect_list "GET /search" "$A1" -- "$B1" "$B2"
call "$KA" GET "/issues/$B1/comments";            expect_code "GET /issues/B1/comments" 404
call "$KA" POST "/issues/$B1/comments" '{"body":"probe"}'; expect_code "POST /issues/B1/comments" 404
call "$KA" GET "/issues/$B1/activity";            expect_code "GET /issues/B1/activity" 404
call "$KA" GET "/activity?limit=100";             expect_list "GET /activity" "$A1" -- "$B1"
call "$KA" GET "/issues/$B1/github";              expect_code "GET /issues/B1/github" 404
call "$KA" GET "/issues/$A1/children";            expect_list "GET /issues/A1/children" "$A2" -- "$B2"
call "$KA" GET "/issues/$B1/agent-sessions";      expect_code "GET /issues/B1/agent-sessions" 404
call "$KA" POST /agent-sessions "{\"issue_id\":\"$B1\",\"agent_name\":\"probe\"}"
expect_code "POST /agent-sessions on B1" 404
call "$KA" GET "/issues/$B1/share";               expect_code "GET /issues/B1/share" 404
call "$KA" POST "/issues/$B1/share";              expect_code "POST /issues/B1/share" 404
if [[ -z "$(sql "SELECT public_token FROM issues WHERE id = '$B1'")" ]]; then ok "B1 stays unpublished (SQL)"; else bad "B1 stays unpublished (SQL)" "public_token was minted"; fi
call "$KA" GET "/projects/$PB/share";             expect_code "GET /projects/B/share" 404
call "$KA" POST "/projects/$PB/share";            expect_code "POST /projects/B/share" 404
call "$KA" GET "/views/$VIEW/issues";             expect_list "GET /views/{org-wide}/issues" "$A1" -- "$B1" "$B2"
call "$KA" POST /views "{\"name\":\"probe\",\"project_id\":\"$PB\"}"; expect_code "POST /views bound to B" 404
call "$KA" GET /triage;                           expect_list "GET /triage" "$A1" -- "$B1" "$B2"
call "$KA" POST "/issues/$B1/triage";             expect_code "POST /issues/B1/triage" 404
call "$KA" POST /triage/batch "{\"issue_ids\":[\"$B1\"]}"; expect_code "POST /triage/batch with B1" 404
call "$KA" POST /issues "{\"project_id\":\"$PA\",\"title\":\"probe\",\"parent_id\":\"$B1\"}"
expect_code "POST /issues in A with parent B1" 400
call "$KA" POST /projects "{\"name\":\"Probe $RUN\",\"slug\":\"probe-$RUN\",\"prefix\":\"P${UP:0:4}\"}"
expect_code "POST /projects" 403

for route in "GET /dashboard/summary" "GET /metrics" "GET /initiatives" "GET /gamification/dashboard" \
             "GET /github/mappings" "GET /github/repos" "GET /github/installation" "GET /integrations/slack"; do
  call "$KA" ${route% *} "${route#* }";           expect_code "$route (organization-wide)" 403
done
call "$KA" POST /ai/chat '{"messages":[{"id":"m1","role":"user","parts":[{"type":"text","text":"probe"}]}]}'; expect_code "POST /ai/chat (organization-wide)" 403
call "$KA" POST /ai/agent '{"message":"probe"}';  expect_code "POST /ai/agent (organization-wide)" 403
call "$KA" POST /ai/pm-full-review '{}';          expect_code "POST /ai/pm-full-review (organization-wide)" 403

mcp "$KA" list_projects '{}';                     expect_list "MCP list_projects" "$PA" -- "$PB"
mcp "$KA" list_issues '{}';                       expect_list "MCP list_issues" "$A1" -- "$B1" "$B2"
mcp "$KA" search_issues '{"q":"scopeprobe"}';     expect_list "MCP search_issues" "$A1" -- "$B1" "$B2"

# API keys: a key limited to A only mints keys limited to A.
call "$KA" POST /api-keys '{"name":"probe-all","permissions":["issues:read"],"project_ids":[]}'
expect_code "POST /api-keys for the whole org" 403
call "$KA" POST /api-keys "{\"name\":\"probe-b\",\"permissions\":[\"issues:read\"],\"project_ids\":[\"$PB\"]}"
expect_code "POST /api-keys limited to B" 403
call "$KA" POST /api-keys "{\"name\":\"probe-a\",\"permissions\":[\"issues:read\"],\"project_ids\":[\"$PA\"]}"
expect_code "POST /api-keys limited to A" 200
NEW_KEY_ID="$(jq -r '.data.id // empty' "$WORK/body")"
if [[ -n "$NEW_KEY_ID" ]]; then
  call "$KA" PATCH "/api-keys/$NEW_KEY_ID" '{"project_ids":[]}'
  expect_code "PATCH /api-keys widening to the whole org" 403
else
  bad "PATCH /api-keys widening to the whole org" "no key was created"
fi

# ─── 2. Webhooks ────────────────────────────────────────────────────────────
echo "2. Webhooks"

call "$KU" POST /webhooks "{\"url\":\"$AUX/hook-all\",\"event_types\":[\"issue.updated\"]}"
expect_code "whole-org key creates an org-wide webhook" 200
W_ALL="$(jq -r '.data.id // empty' "$WORK/body")"
call "$KU" POST /webhooks "{\"url\":\"$AUX/hook-b\",\"event_types\":[\"issue.updated\"],\"project_ids\":[\"$PB\"]}"
expect_code "whole-org key creates a webhook limited to B" 200
call "$KA" GET /webhooks;                         expect_list "GET /webhooks hides org-wide and B hooks" -- "$W_ALL" "hook-b"
call "$KA" GET "/webhooks/$W_ALL";                expect_code "GET /webhooks/{org-wide}" 404
call "$KA" PATCH "/webhooks/$W_ALL" '{"enabled":false}'; expect_code "PATCH /webhooks/{org-wide}" 404
call "$KA" DELETE "/webhooks/$W_ALL";             expect_code "DELETE /webhooks/{org-wide}" 404
call "$KA" POST /webhooks "{\"url\":\"$AUX/hook-a\",\"event_types\":[\"issue.updated\"]}"
expect_code "POST /webhooks without project_ids" 403
call "$KA" POST /webhooks "{\"url\":\"$AUX/hook-a\",\"event_types\":[\"issue.updated\"],\"project_ids\":[\"$PB\"]}"
expect_code "POST /webhooks limited to B" 404
call "$KA" POST /webhooks "{\"url\":\"$AUX/hook-a\",\"event_types\":[\"issue.updated\"],\"project_ids\":[\"$PA\"]}"
expect_code "POST /webhooks limited to A" 200
if [[ "$(jq -c '.data.project_ids' "$WORK/body")" == "[\"$PA\"]" ]]; then ok "webhook stores project_ids [A]"; else bad "webhook stores project_ids [A]" "$(jq -c '.data.project_ids' "$WORK/body")"; fi
W_A="$(jq -r '.data.id // empty' "$WORK/body")"
call "$KA" GET /webhooks;                         expect_list "GET /webhooks lists the A hook" "${W_A:-missing-hook}"
call "$KA" PATCH "/webhooks/${W_A:-none}" '{"project_ids":[]}'; expect_code "PATCH own webhook to the whole org" 403

# ─── 3. Event stream ────────────────────────────────────────────────────────
echo "3. Event stream and webhook delivery"

stream() { printf 'header = "Authorization: Bearer %s"\n' "$1" | curl -s -N --max-time 6 -K - "${BASE}/events" > "$2" 2>/dev/null || true; }
stream "$KA" "$WORK/sse-a" & SSE_A=$!
stream "$KU" "$WORK/sse-u" & SSE_U=$!
stream "$HUMAN" "$WORK/sse-h" & SSE_H=$!
sleep 2
call "$KU" PATCH "/issues/$B1" '{"title":"bravo scopeprobe renamed"}'; expect_code "PATCH B1 (whole-org key)" 200
call "$KU" PATCH "/issues/$A1" '{"title":"alpha scopeprobe renamed"}'; expect_code "PATCH A1 (whole-org key)" 200
wait "$SSE_A" "$SSE_U" "$SSE_H" 2>/dev/null || true
cp "$WORK/sse-a" "$WORK/body"; CODE=200;         expect_list "SSE for key A" "$A1" -- "$B1"
cp "$WORK/sse-u" "$WORK/body"; CODE=200;         expect_list "SSE for whole-org key" "$A1" "$B1"
cp "$WORK/sse-h" "$WORK/body"; CODE=200;         expect_list "SSE for Clerk user" "$A1" "$B1"

sleep 2
hook_has() { jq -r --arg p "$1" 'select(.path == $p) | .body' "$WORK/received.jsonl" > "$WORK/body"; CODE=200; }
hook_has /hook-all; expect_list "org-wide webhook receives A and B" "$A1" "$B1"
hook_has /hook-a;   expect_list "webhook limited to A receives A only" "$A1" -- "$B1"
hook_has /hook-b;   expect_list "webhook limited to B receives B only" "$B1" -- "$A1"

# ─── 4. Unchanged: whole-org key and Clerk user ────────────────────────────
echo "4. Whole-org key and Clerk user keep the organization"

for who in KU HUMAN; do
  token="${!who}"
  call "$token" GET /projects;                    expect_list "$who GET /projects" "$PA" "$PB"
  call "$token" GET "/issues/$B1";                expect_code "$who GET /issues/B1" 200
  call "$token" GET "/issues/$B1/activity";       expect_list "$who GET /issues/B1/activity" "$B1"
  call "$token" GET "/activity?limit=100";        expect_list "$who GET /activity" "$A1" "$B1"
  call "$token" GET "/issues/$B1/github";         expect_code "$who GET /issues/B1/github" 200
  call "$token" GET "/issues/$A1/children";       expect_list "$who GET /issues/A1/children" "$A2" "$B2"
  call "$token" GET "/issues/$B1/agent-sessions"; expect_list "$who GET /issues/B1/agent-sessions" "$B1"
  call "$token" GET "/views/$VIEW/issues";        expect_list "$who GET /views/{org-wide}/issues" "$A1" "$B1"
  call "$token" GET /triage;                      expect_list "$who GET /triage" "$B1"
  call "$token" GET /dashboard/summary;           expect_code "$who GET /dashboard/summary" 200
  call "$token" GET /webhooks;                    expect_list "$who GET /webhooks" "$W_ALL" "${W_A:-missing-hook}"
done
mcp "$KU" list_projects '{}';                     expect_list "KU MCP list_projects" "$PA" "$PB"

# ─── 5. Another organization ────────────────────────────────────────────────
echo "5. Key of another organization"

call "$K2" GET "/issues/$B1";                     expect_code "other org GET /issues/B1" 404
call "$K2" GET "/issues/$B1/github";              expect_code "other org GET /issues/B1/github" 404

echo
echo "Passed: $PASS  Failed: $FAIL"
(( FAIL == 0 ))
