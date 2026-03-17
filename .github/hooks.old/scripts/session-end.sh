#!/bin/bash
# session-end.sh — Hook sessionEnd do Copilot
# Executado quando a sessão do agente é encerrada (completa, erro, abort, timeout, user_exit).
# Input JSON (stdin): {timestamp, cwd, reason}
# Output: ignorado pelo Copilot.
# Entry-point fino: bootstrap + dispatch para entry-lib dedicada.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
REPO_ROOT="$(cd "$HOOK_DIR/../.." && pwd)"
# Suporte a override de diretórios (usado por smoke-test sandbox e session-close.sh)
LOG_DIR="${HOOKS_LOG_DIR:-$HOOK_DIR/logs}"
STATE_DIR="${HOOKS_STATE_DIR:-$HOOK_DIR/state}"
DOCS_SESSIONS_DIR="${HOOKS_DOCS_DIR:-$REPO_ROOT/DOCUMENTAÇÃO/RELATORIOS/SESSIONS}"
SCRIPTS_DIR="$HOOK_DIR/scripts"

COMMON_LIB="$HOOK_DIR/hooks-lib/common.sh"

ENTRY_LIB="$HOOK_DIR/hooks-lib/lifecycle/session-end-lib.sh"

if [ ! -f "$COMMON_LIB" ]; then
    echo "[session-end] ERROR: common.sh ausente: $COMMON_LIB" >&2
    exit 1
fi

if [ ! -f "$ENTRY_LIB" ]; then
    echo "[session-end] ERROR: entry-lib ausente: $ENTRY_LIB" >&2
    exit 1
fi

# shellcheck disable=SC1090,SC1091
source "$COMMON_LIB"
# shellcheck disable=SC1090,SC1091
source "$ENTRY_LIB"

if ! command -v run_session_end_hook > /dev/null 2>&1; then
    echo "[session-end] ERROR: função run_session_end_hook não encontrada" >&2
    exit 1
fi

run_session_end_hook "$LOG_DIR" "$STATE_DIR" "$DOCS_SESSIONS_DIR" "$SCRIPTS_DIR"
exit $?
