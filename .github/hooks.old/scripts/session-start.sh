#!/bin/bash
# session-start.sh — Entry-point fino (F14.2)
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

COMMON_LIB="$HOOK_DIR/hooks-lib/common.sh"
ENTRY_LIB="$HOOK_DIR/hooks-lib/lifecycle/session-start-lib.sh"

if [ ! -f "$COMMON_LIB" ]; then
    echo "[session-start] erro: common.sh ausente em $COMMON_LIB" >&2
    exit 1
fi

if [ ! -f "$ENTRY_LIB" ]; then
    echo "[session-start] erro: session-start-lib.sh ausente em $ENTRY_LIB" >&2
    exit 1
fi

# shellcheck disable=SC1090,SC1091
source "$COMMON_LIB"
# shellcheck disable=SC1090,SC1091
source "$ENTRY_LIB"

if ! declare -F run_session_start_hook > /dev/null 2>&1; then
    echo "[session-start] erro: função run_session_start_hook não encontrada em $ENTRY_LIB" >&2
    exit 1
fi

run_session_start_hook "$HOOK_DIR"
exit $?
