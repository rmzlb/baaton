#!/usr/bin/env bash
# Baaton API helper — wraps curl with auth and error handling
#
# Usage:
#   ./baaton-api.sh GET /projects
#   ./baaton-api.sh POST /issues '{"title":"Fix login","project_id":"..."}'
#   ./baaton-api.sh PATCH /issues/UUID '{"status":"in_progress"}'
#   ./baaton-api.sh DELETE /issues/UUID
#
# Config: Set BAATON_API_KEY env var, or create .baaton file in project root:
#   api_url=https://api.baaton.dev
#   api_key=baa_your_key_here

set -euo pipefail

# ─── Load Config ───────────────────────────────────────

BAATON_URL="${BAATON_API_URL:-https://api.baaton.dev}"
BAATON_KEY="${BAATON_API_KEY:-}"

# Try .baaton config file if no env var
if [ -z "$BAATON_KEY" ]; then
  CONFIG_FILE=""
  # Search upward for .baaton file
  dir="$PWD"
  while [ "$dir" != "/" ]; do
    if [ -f "$dir/.baaton" ]; then
      CONFIG_FILE="$dir/.baaton"
      break
    fi
    dir="$(dirname "$dir")"
  done

  if [ -n "$CONFIG_FILE" ]; then
    BAATON_KEY=$(grep '^api_key=' "$CONFIG_FILE" | cut -d= -f2- | tr -d '[:space:]')
    url_from_config=$(grep '^api_url=' "$CONFIG_FILE" | cut -d= -f2- | tr -d '[:space:]')
    [ -n "$url_from_config" ] && BAATON_URL="$url_from_config"
  fi
fi

if [ -z "$BAATON_KEY" ]; then
  echo "Error: No API key found." >&2
  echo "Set BAATON_API_KEY env var or create .baaton file with api_key=baa_xxx" >&2
  exit 1
fi

# ─── Parse Args ───────────────────────────────────────

if [ $# -lt 2 ]; then
  echo "Usage: baaton-api.sh METHOD /endpoint [JSON_BODY]" >&2
  echo "" >&2
  echo "Examples:" >&2
  echo "  baaton-api.sh GET /projects" >&2
  echo "  baaton-api.sh POST /issues '{\"title\":\"Fix bug\",\"project_id\":\"...\"}'" >&2
  echo "  baaton-api.sh PATCH /issues/UUID '{\"status\":\"done\"}'" >&2
  exit 1
fi

METHOD="${1^^}"  # uppercase
ENDPOINT="$2"
BODY="${3:-}"

# Ensure endpoint starts with /api/v1
if [[ "$ENDPOINT" != /api/v1/* ]]; then
  ENDPOINT="/api/v1${ENDPOINT}"
fi

# ─── Make Request ─────────────────────────────────────

CURL_ARGS=(
  -s -w "\n%{http_code}"
  -X "$METHOD"
  "${BAATON_URL}${ENDPOINT}"
  -H "Authorization: Bearer ${BAATON_KEY}"
  -H "Content-Type: application/json"
)

if [ -n "$BODY" ]; then
  CURL_ARGS+=(-d "$BODY")
fi

RESPONSE=$(curl "${CURL_ARGS[@]}" 2>/dev/null)

# Split response body and status code
HTTP_CODE=$(echo "$RESPONSE" | tail -1)
BODY_CONTENT=$(echo "$RESPONSE" | sed '$d')

# ─── Handle Response ─────────────────────────────────

if [ "$HTTP_CODE" -ge 200 ] && [ "$HTTP_CODE" -lt 300 ]; then
  # Success — pretty print JSON
  if command -v jq &>/dev/null; then
    echo "$BODY_CONTENT" | jq .
  else
    echo "$BODY_CONTENT"
  fi
else
  echo "Error: HTTP $HTTP_CODE" >&2
  if command -v jq &>/dev/null; then
    echo "$BODY_CONTENT" | jq . >&2 2>/dev/null || echo "$BODY_CONTENT" >&2
  else
    echo "$BODY_CONTENT" >&2
  fi
  exit 1
fi
