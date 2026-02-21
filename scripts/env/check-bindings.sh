#!/usr/bin/env bash
set -euo pipefail

# Version: 1.0 (2026-01-30)
# Usage: ./scripts/check-bindings.sh
# Env: CHECK_PORTS="3000,3001,3002,3008,9100,9224"

PORTS="${CHECK_PORTS:-3000,3001,3002,3008,9100,9224}"
IFS=',' read -r -a PORT_ARRAY <<< "$PORTS"

FAIL=0

detect_cmd(){
  if command -v ss >/dev/null 2>&1; then echo "ss"; return; fi
  if command -v netstat >/dev/null 2>&1; then echo "netstat"; return; fi
  echo ""
}

CMD=$(detect_cmd)
if [ -z "$CMD" ]; then
  echo "[FAIL] neither 'ss' nor 'netstat' found in PATH"
  exit 1
fi

for PORT in "${PORT_ARRAY[@]}"; do
  PORT=$(echo "$PORT" | tr -d '[:space:]')
  if [ -z "$PORT" ]; then continue; fi

  if [ "$CMD" = "ss" ]; then
    MAP=$(ss -ltn 2>/dev/null | awk -v p=":$PORT" '$4 ~ p {print $4}' || true)
  else
    MAP=$(netstat -ltn 2>/dev/null | awk -v p=":$PORT" '$4 ~ p {print $4}' || true)
  fi

  if [ -z "$MAP" ]; then
    echo "[FAIL] Port $PORT: not listening"
    FAIL=1
    continue
  fi

  LOCALHOST_ONLY=true
  while IFS= read -r ADDR; do
    [ -z "$ADDR" ] && continue
    # Normalize IPv6 [] wrappers
    ADDR_CLEAN=${ADDR#\[}
    ADDR_CLEAN=${ADDR_CLEAN%\]}
    # Extract host part (strip port)
    HOST="${ADDR_CLEAN%:*}"
    if echo "$HOST" | grep -E -q '(^127\\.0\\.0\\.1$)|(^::1$)|(^localhost$)'; then
      :
    else
      LOCALHOST_ONLY=false
      break
    fi
  done <<EOF
$MAP
EOF

  if [ "$LOCALHOST_ONLY" = true ]; then
    echo "[FAIL] Port $PORT: bound only to localhost"
    FAIL=1
  else
    echo "[OK] Port $PORT: binding acceptable"
  fi

done

exit $FAIL
