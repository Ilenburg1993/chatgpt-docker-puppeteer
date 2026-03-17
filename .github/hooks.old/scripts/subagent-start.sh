#!/bin/bash
# subagent-start.sh — Hook subagentStart do Copilot
# Executado quando um subagente é iniciado.
# Input JSON (stdin): {timestamp, session_id, ...}
# Complementa subagent-stop.sh para rastreio completo do ciclo de vida de subagentes.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Carrega biblioteca de funções compartilhadas (heal_v1, increment_mismatch, etc.)
if [ -f "$HOOK_DIR/hooks-lib/common.sh" ]; then
    # shellcheck source=../.github/hooks/hooks-lib/common.sh
    source "$HOOK_DIR/hooks-lib/common.sh" 2> /dev/null \
        || echo "[warn] common.sh falhou ao carregar em subagent-start.sh" >&2
else
    echo "[warn] common.sh não encontrado (subagent-start.sh) — heal_v1/increment_mismatch indisponíveis" >&2
fi

ENTRY_LIB="$HOOK_DIR/hooks-lib/lifecycle/subagent-start-lib.sh"
if [ -f "$ENTRY_LIB" ]; then
    # shellcheck source=../.github/hooks/hooks-lib/lifecycle/subagent-start-lib.sh
    source "$ENTRY_LIB" 2> /dev/null || echo "[warn] subagent-start-lib.sh falhou ao carregar" >&2
else
    echo "[error] entry-lib ausente: $ENTRY_LIB" >&2
    exit 1
fi

if ! command -v run_subagent_start_hook > /dev/null 2>&1; then
    echo "[error] função run_subagent_start_hook não encontrada em $ENTRY_LIB" >&2
    exit 1
fi

run_subagent_start_hook "$HOOK_DIR"
exit $?
