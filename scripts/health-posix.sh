#!/usr/bin/env bash
# =============================================================================
# Health Check Script for POSIX (Linux/macOS)
# =============================================================================
# Usage: bash health-posix.sh [PORT] [TIMEOUT]
# Default PORT: 2998, TIMEOUT: 2
# Exit codes: 0 = healthy, 1 = unhealthy
# =============================================================================

set -euo pipefail

PORT=${1:-2998}
TIMEOUT=${2:-2}

# ASCII fallback: set NO_UNICODE=1 to get ASCII icons
if [ "${NO_UNICODE:-}" = "1" ] || [ "${CI:-}" = "true" ]; then
  OK="[OK]"; FAIL="[FAIL]"; WARN="[WARN]"
else
  OK="✓"; FAIL="✗"; WARN="⚠"
fi

exit_code=0

echo ""

# helper: http_get_json <url> -> prints JSON or empty
http_get_json() {
  local url="$1"
  # use curl with timeout and fail silently
  curl -sS --max-time "$TIMEOUT" "$url" || return 1
}

# helper: parse status field using jq if present
parse_status() {
  local json="$1"
  if command -v jq >/dev/null 2>&1; then
    echo "$json" | jq -r 'if .status then .status else "" end' 2>/dev/null || echo ""
  else
    # fallback: crude extraction; not ideal but better than raw match
    echo "$json" | awk -F'"status"[[:space:]]*:[[:space:]]*' '{if (NF>1) {gsub(/^[[:space:]"'\''"]+|[[:space:]"'\''"',]+$/,"",$2); split($2,a,","); print a[1]} else { print "" }}' | tr -d '"'
  fi
}

# 1) PM2
if ! command -v pm2 >/dev/null 2>&1; then
  echo "  $WARN PM2 not installed"
  exit_code=1
else
  if pm2 jlist 2>/dev/null | jq -e '.[] | select(.pm2_env.status=="online")' >/dev/null 2>&1; then
    echo "  $OK PM2 processes running"
  else
    # fallback when jq missing: search for "status":"online"
    if pm2 jlist 2>/dev/null | grep -q '"status":"online"' >/dev/null 2>&1; then
      echo "  $OK PM2 processes running"
    else
      echo "  $FAIL PM2 processes offline"
      exit_code=1
    fi
  fi
fi

# 2) Root health
root_json=$(http_get_json "http://localhost:${PORT}/api/health" || true)
if [ -n "$root_json" ]; then
  status_val=$(parse_status "$root_json")
  if [ -n "$status_val" ]; then
    case "$status_val" in
      ok|healthy|online|true) echo "  $OK Server (${PORT})" ;;
      *) echo "  $WARN Server (${PORT}) - status: ${status_val}"; exit_code=1 ;;
    esac
  else
    echo "  $OK Server (${PORT})"
  fi
else
  echo "  $FAIL Server not responding (${PORT})"
  exit_code=1
fi

# 3) Endpoints
for ep in chrome pm2 kernel disk; do
  j=$(http_get_json "http://localhost:${PORT}/api/health/${ep}" || true)
  if [ -n "$j" ]; then
    s=$(parse_status "$j")
    if [ -n "$s" ]; then
      case "$s" in
        ok|healthy|online|true) echo "  $OK /health/${ep}" ;;
        *) echo "  $WARN /health/${ep} - status: ${s}"; exit_code=1 ;;
      esac
    else
      # No status field but returned JSON -> consider OK (or change policy)
      echo "  $OK /health/${ep} (no status field)"
    fi
  else
    echo "  $FAIL /health/${ep} unreachable"
    exit_code=1
  fi
done

echo ""
exit "$exit_code"
