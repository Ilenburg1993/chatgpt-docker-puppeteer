#!/bin/bash
# log-prompt.sh — Hook userPromptSubmitted do Copilot
# Executado quando o usuário submete um prompt ao agente.
# Input JSON (stdin): {timestamp, cwd, prompt}
# Output JSON (stdout): systemMessage com SESSION reminder obrigatório em cada TURN.
#
# ╔══════════════════════════════════════════════════════════════════════════╗
# ║  HARDENING v6.0 — SESSION REMINDER NO INÍCIO DE CADA TURN              ║
# ║                                                                          ║
# ║  SESSION  ≠  SECTION  ≠  TURN                                           ║
# ║  ─────────────────────────────────────────────────────────────────────   ║
# ║  TURN    → encerra com vscode_askQuestions (autorização obrigatória)    ║
# ║  SECTION → agente decide autonomamente via start-section.sh             ║
# ║  SESSION → Template F + KEY digitada + execução automática de close      ║
# ╚══════════════════════════════════════════════════════════════════════════╝
#
# PRIVACIDADE: o texto completo do prompt NÃO é logado.
# Apenas um hash SHA-256 truncado e o tamanho são registrados.
# Isso protege informações sensíveis que possam aparecer nos prompts.
#
# Schema v4: reseta current_turn.* (âmbito turno) no início de cada prompt.
# Campos v4 adicionados: current_turn.section_name, reset last_askquestions_response.
# Loga evento turnStart (automático) além de userPromptSubmitted.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [ -f "$HOOK_DIR/hooks-lib/common.sh" ]; then
    # shellcheck source=../.github/hooks/hooks-lib/common.sh
    source "$HOOK_DIR/hooks-lib/common.sh" 2> /dev/null \
        || echo "[warn] common.sh falhou ao carregar em log-prompt.sh" >&2
else
    echo "[warn] common.sh não encontrado (log-prompt.sh) — heal_v1/ctx functions indisponíveis" >&2
fi

ENTRY_LIB="$HOOK_DIR/hooks-lib/lifecycle/log-prompt-lib.sh"
if [ -f "$ENTRY_LIB" ]; then
    # shellcheck source=../.github/hooks/hooks-lib/lifecycle/log-prompt-lib.sh
    source "$ENTRY_LIB" 2> /dev/null || echo "[warn] log-prompt-lib.sh falhou ao carregar" >&2
else
    echo "[error] entry-lib ausente: $ENTRY_LIB" >&2
    exit 1
fi

if ! command -v run_log_prompt_hook > /dev/null 2>&1; then
    echo "[error] função run_log_prompt_hook não encontrada em $ENTRY_LIB" >&2
    exit 1
fi

run_log_prompt_hook "$HOOK_DIR"
exit $?
