#!/usr/bin/env bash
# ─── The server Gemini key is never served to a caller (BAA-37) ───────────
# `GET /ai/key` used to return GEMINI_API_KEY to any authenticated caller, of
# any organization. This starts the API binary against a DISPOSABLE local
# PostgreSQL database with a marker value as GEMINI_API_KEY, then checks over
# HTTP that:
#
# - `GET /ai/key` answers 404 to a Clerk user and to an admin API key, and no
#   response carries the marker;
# - `POST /ai/chat`, the server-side proxy the frontend uses, is still mounted
#   for the same Clerk user (an empty body is refused by validation, before
#   any model call, so the test never reaches Gemini).
#
# A Clerk user is simulated with a throw-away RSA key served as JWKS on the aux
# port (CLERK_ISSUER points there).
#
# Usage:
#   DATABASE_URL_TEST=postgres://user:pass@127.0.0.1:55560/baaton_test \
#   PSQL="docker exec -i <container> psql -U user -d baaton_test" \
#   ./tests/ai_key_removed.sh [path/to/baaton-api]
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
API_PORT="${API_PORT:-4171}"
AUX_PORT="${AUX_PORT:-4172}"
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
b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }

# ─── Aux server: JWKS for the simulated Clerk user ─────────────────────────

openssl genrsa -out "$WORK/jwt.pem" 2048 2>/dev/null
MODULUS="$(openssl rsa -in "$WORK/jwt.pem" -noout -modulus | cut -d= -f2 | xxd -r -p | b64url)"
mkdir -p "$WORK/.well-known"
jq -cn --arg n "$MODULUS" \
  '{keys: [{kty: "RSA", kid: "ai-key-e2e", use: "sig", alg: "RS256", n: $n, e: "AQAB"}]}' \
  > "$WORK/.well-known/jwks.json"
(cd "$WORK" && exec python3 -I -m http.server "$AUX_PORT" --bind 127.0.0.1 >/dev/null 2>&1) &
AUX_PID=$!

# ─── API, with a marker in place of a real Gemini key ──────────────────────

MARKER="gemini-marker-$(openssl rand -hex 12)"
env -i PATH="$PATH" HOME="$HOME" \
  DATABASE_URL="$DB_URL" PORT="$API_PORT" RUST_LOG="baaton_api=warn" \
  CLERK_ISSUER="$AUX" UPLOAD_DIR="$WORK/uploads" GEMINI_API_KEY="$MARKER" \
  "$API_BIN" > "$WORK/api.log" 2>&1 &
API_PID=$!
for _ in $(seq 1 60); do
  curl -sf "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1 && break
  sleep 1
done
curl -sf "http://127.0.0.1:${API_PORT}/health" >/dev/null || { cat "$WORK/api.log"; exit 1; }

# ─── Fixtures ───────────────────────────────────────────────────────────────

RUN="$(openssl rand -hex 4)"
ORG="org_aikey_${RUN}"
KEY_ID="$(python3 -I -c 'import uuid; print(uuid.uuid4())')"
KEY="baa_$(openssl rand -hex 32)"
sql "
INSERT INTO organizations (id, name, slug, plan) VALUES ('$ORG', 'AI key org $RUN', 'aikey-$RUN', 'tester');
INSERT INTO api_keys (id, org_id, name, key_hash, key_prefix, permissions, project_ids) VALUES
  ('$KEY_ID', '$ORG', 'admin', encode(sha256('$KEY'::bytea), 'hex'), 'baa_k...', '{admin:full}', '{}');
" >/dev/null

NOW="$(date +%s)"
JWT_HEADER="$(printf '%s' '{"alg":"RS256","typ":"JWT","kid":"ai-key-e2e"}' | b64url)"
JWT_PAYLOAD="$(jq -cn --arg iss "$AUX" --arg org "$ORG" --arg sub "user_aikey_${RUN}" --argjson now "$NOW" \
  '{sub: $sub, iss: $iss, iat: $now, nbf: ($now - 5), exp: ($now + 3600), v: 2,
    o: {id: $org, rol: "member", slg: "aikey"}, first_name: "Key", last_name: "Probe",
    email: "ai-key-probe@example.invalid"}' | b64url)"
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
ok()  { printf '  ok    %s\n' "$1"; PASS=$((PASS + 1)); }
bad() { printf '  FAIL  %s — %s\n' "$1" "$2"; FAIL=$((FAIL + 1)); }
expect_code() { [[ "$CODE" == "$2" ]] && ok "$1 → $CODE" || bad "$1" "HTTP $CODE, expected $2"; }
expect_no_marker() { grep -q "$MARKER" "$WORK/body" && bad "$1" "the response carries GEMINI_API_KEY" || ok "$1"; }

echo "Server Gemini key — run $RUN (org $ORG)"

call "$HUMAN" GET /ai/key;  expect_code "Clerk user GET /ai/key" 404; expect_no_marker "Clerk user gets no Gemini key"
call "$KEY" GET /ai/key;    expect_code "admin API key GET /ai/key" 404; expect_no_marker "admin API key gets no Gemini key"
call "$HUMAN" POST /ai/chat '{}'; expect_code "Clerk user POST /ai/chat (proxy still mounted, body refused)" 422
expect_no_marker "POST /ai/chat answer carries no Gemini key"

echo
echo "Passed: $PASS  Failed: $FAIL"
(( FAIL == 0 ))
