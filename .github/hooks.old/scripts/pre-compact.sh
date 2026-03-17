#!/bin/bash
# pre-compact.sh — Hook preCompact do Copilot
# Executado ANTES do Copilot compactar o contexto da conversa.
# A compactação causa perda de memória de curto prazo do agente.
# Este hook registra o evento para que o agente saiba que houve compactação.
# Input JSON (stdin): {timestamp, session_id, ...}
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
# Carrega biblioteca de funções compartilhadas (heal_v1, increment_mismatch, etc.)
if [ -f "$HOOK_DIR/hooks-lib/common.sh" ]; then
    # shellcheck source=../.github/hooks/hooks-lib/common.sh
    source "$HOOK_DIR/hooks-lib/common.sh" 2> /dev/null \
        || echo "[warn] common.sh falhou ao carregar em pre-compact.sh" >&2
else
    echo "[warn] common.sh não encontrado (pre-compact.sh) — heal_v1/increment_mismatch indisponíveis" >&2
fi

ENTRY_LIB="$HOOK_DIR/hooks-lib/lifecycle/pre-compact-lib.sh"
if [ -f "$ENTRY_LIB" ]; then
    # shellcheck source=../.github/hooks/hooks-lib/lifecycle/pre-compact-lib.sh
    source "$ENTRY_LIB" 2> /dev/null || echo "[warn] pre-compact-lib.sh falhou ao carregar" >&2
else
    echo "[error] entry-lib ausente: $ENTRY_LIB" >&2
    exit 1
fi

if ! command -v run_pre_compact_hook > /dev/null 2>&1; then
    echo "[error] função run_pre_compact_hook não encontrada em $ENTRY_LIB" >&2
    exit 1
fi

run_pre_compact_hook "$HOOK_DIR"
exit $?
