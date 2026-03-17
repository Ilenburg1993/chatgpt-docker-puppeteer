#!/bin/bash
# subagent-stop.sh — Hook subagentStop do Copilot
# Executado quando um subagente termina, antes de retornar ao agente pai.
# Input JSON (stdin): formato não totalmente documentado — tratamento defensivo.
# Output: ignorado pelo Copilot.
# Propósito: mínimo — subagentes são transitórios e de vida curta.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Carrega biblioteca de funções compartilhadas (heal_v1, increment_mismatch, etc.)
if [ -f "$HOOK_DIR/hooks-lib/common.sh" ]; then
    # shellcheck source=../.github/hooks/hooks-lib/common.sh
    source "$HOOK_DIR/hooks-lib/common.sh" 2> /dev/null \
        || echo "[warn] common.sh falhou ao carregar em subagent-stop.sh" >&2
else
    echo "[warn] common.sh não encontrado (subagent-stop.sh) — heal_v1/increment_mismatch indisponíveis" >&2
fi

ENTRY_LIB="$HOOK_DIR/hooks-lib/lifecycle/subagent-stop-lib.sh"
if [ -f "$ENTRY_LIB" ]; then
    # shellcheck source=../.github/hooks/hooks-lib/lifecycle/subagent-stop-lib.sh
    source "$ENTRY_LIB" 2> /dev/null || echo "[warn] subagent-stop-lib.sh falhou ao carregar" >&2
else
    echo "[error] entry-lib ausente: $ENTRY_LIB" >&2
    exit 1
fi

if ! command -v run_subagent_stop_hook > /dev/null 2>&1; then
    echo "[error] função run_subagent_stop_hook não encontrada em $ENTRY_LIB" >&2
    exit 1
fi

run_subagent_stop_hook "$HOOK_DIR"
exit $?
