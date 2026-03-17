#!/bin/bash
# pre-tool-use.sh — Entry-point fino (F14.2)
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

COMMON_LIB="$HOOK_DIR/hooks-lib/common.sh"
POLICY_LIB="$HOOK_DIR/hooks-lib/policy.sh"
ENTRY_LIB="$HOOK_DIR/hooks-lib/policy/pre-tool-use-lib.sh"

if [ ! -f "$COMMON_LIB" ]; then
    echo "[pre-tool-use] erro: common.sh ausente em $COMMON_LIB" >&2
    exit 1
fi

if [ ! -f "$POLICY_LIB" ]; then
    echo "[pre-tool-use] erro: policy.sh ausente em $POLICY_LIB" >&2
    exit 1
fi

if [ ! -f "$ENTRY_LIB" ]; then
    echo "[pre-tool-use] erro: pre-tool-use-lib.sh ausente em $ENTRY_LIB" >&2
    exit 1
fi

# shellcheck disable=SC1090,SC1091
source "$COMMON_LIB"
# shellcheck disable=SC1090,SC1091
source "$POLICY_LIB"
# shellcheck disable=SC1090,SC1091
source "$ENTRY_LIB"

if ! declare -F run_pre_tool_use_hook > /dev/null 2>&1; then
    echo "[pre-tool-use] erro: função run_pre_tool_use_hook não encontrada em $ENTRY_LIB" >&2
    exit 1
fi

run_pre_tool_use_hook "$HOOK_DIR"
exit $?
