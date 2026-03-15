#!/bin/bash
# common.sh — utilitários compartilhados para suítes smoke por domínio.

set -euo pipefail

# shellcheck disable=SC2034
HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
# shellcheck disable=SC2034
SCRIPTS_DIR="$HOOK_DIR/scripts"
# shellcheck disable=SC2034
STATE_DIR="$HOOK_DIR/state"
# shellcheck disable=SC2034
LOG_DIR="$HOOK_DIR/logs"
# shellcheck disable=SC2034
CTX_FILE="$STATE_DIR/session-context.json"

PASS=0
FAIL=0
QUIET="${1:-}"

pass() {
    PASS=$((PASS + 1))
    [ "$QUIET" = "--quiet" ] || echo "  ✓ $1"
}

fail() {
    FAIL=$((FAIL + 1))
    echo "  ✗ $1"
}

section() {
    echo ""
    echo "$1"
}

require_cmd() {
    local cmd="$1"
    if command -v "$cmd" > /dev/null 2>&1; then
        pass "comando '$cmd' disponível"
    else
        fail "comando '$cmd' NÃO encontrado"
    fi
}

require_file() {
    local file_path="$1"
    local label="${2:-$1}"
    if [ -f "$file_path" ]; then
        pass "$label existe"
    else
        fail "$label não encontrado"
    fi
}

require_executable() {
    local file_path="$1"
    local label="${2:-$1}"
    if [ -x "$file_path" ]; then
        pass "$label executável"
    else
        fail "$label não é executável"
    fi
}

require_grep() {
    local pattern="$1"
    local file_path="$2"
    local ok_msg="$3"
    local fail_msg="$4"
    if grep -qE "$pattern" "$file_path" 2> /dev/null; then
        pass "$ok_msg"
    else
        fail "$fail_msg"
    fi
}

summary_and_exit() {
    echo ""
    echo "Resumo: PASS=$PASS | FAIL=$FAIL"
    exit "$FAIL"
}
