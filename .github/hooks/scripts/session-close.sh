#!/usr/bin/env bash
# session-close.sh — Encerramento autorizado de sessão
# NÃO invocado diretamente pelo VS Code. Chamado internamente por stop.sh
# quando pending_session_close=true (após close_key validada).
# O pre-tool-use.sh bloqueia qualquer tentativa do agente de chamar este
# script diretamente via run_in_terminal.
set -euo pipefail
HOOK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../lib/common.sh
source "$HOOK_DIR/lib/common.sh"
# shellcheck source=../lib/session-close-lib.sh
source "$HOOK_DIR/lib/session-close-lib.sh"
main
