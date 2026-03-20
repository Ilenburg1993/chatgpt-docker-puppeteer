#!/usr/bin/env bash
# pre-tool-use-lib.sh — Lógica do PreToolUse hook
#
# Responsabilidades:
#   1. Abrir novo SUBTURN para rastrear a execução da ferramenta
#   2. Incrementar contador de ferramentas (tools_count do turno + tools_total da sessão)
#   3. Registrar evento no audit.jsonl (subturnStart + toolUse)
#   4. Proteção de segurança: bloquear chamada direta a session-close.sh via terminal
#
# Sourceado por scripts/pre-tool-use.sh

# shellcheck source=common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
# shellcheck source=hook-payload-api.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hook-payload-api.sh"

export_lang_utf8

# ---------------------------------------------------------------------------
# Detecção de tool especial: start-turn.sh (declara intenção do turno)
# ---------------------------------------------------------------------------

# Se o agente chamou start-turn.sh, extrai a intenção e atualiza state.
# $1 = tool_input (JSON string)
maybe_capture_turn_intent() {
    local tool_input="$1"
    local intent

    # Detecta padrão: bash .github/hooks/scripts/start-turn.sh "intenção"
    # NEW-F: usar ['"] em vez de ["\x27] — \x27 não é portável em bracket expressions POSIX
    intent=$(printf '%s' "$tool_input" | grep -oE "start-turn\\.sh[[:space:]]+[\"']([^\"']+)[\"']" \
        | sed -E "s/start-turn\\.sh[[:space:]]+[\"']([^\"']+)[\"']/\\1/" || true)

    if [ -n "$intent" ]; then
        update_nested_state "current_turn.intent" "$intent"
        hook_log_audit "turnIntent_declared" "intent" "$intent"
    fi
}

# ---------------------------------------------------------------------------
# Contagem de tool calls: garante state antes de contar
# ---------------------------------------------------------------------------

# Auto-init se o state não existe quando um tool é chamado (sem SessionStart anterior)
ensure_state_for_tool() {
    local session_id="${1:-unknown}"
    if ! state_exists; then
        init_state "$session_id" "auto-init"
        hook_log_audit "state_auto_init_on_tool"
        # Abre também um turn sintético para não deixar tools sem turno (GAP-17: source=synthetic)
        open_new_turn "synthetic" > /dev/null
        hook_log_audit "turnStart_synthetic"
    fi
}

# ---------------------------------------------------------------------------
# Entrypoint principal do PreToolUse
# ---------------------------------------------------------------------------
pre_tool_use_main() {
    local input="$1"
    maybe_capture_debug "$input"

    # Popula HOOK_* vars a partir do payload (session_id, tool_name, tool_input, etc.)
    hook_api_parse "$input"

    # Exporta SESSION_ID para compatibilidade com funções de state (common.sh)
    local session_id="${HOOK_SESSION_ID:-unknown}"
    export SESSION_ID="$session_id"

    # --- Passo 1: Proteção de segurança (via API) ---
    if hook_is_bypass_attempt; then
        # GAP-20: contabiliza tools bloqueadas por bypass
        if state_exists; then
            increment_field ".session_stats.tools_blocked" > /dev/null || true
        fi
        hook_log_audit "preToolUse_blocked_protected" \
            "tool" "${HOOK_TOOL_NAME:-}" \
            "reason" "chamada direta a script protegido"
        hook_out_pre_deny "session-close.sh não pode ser chamado diretamente. Use o fluxo: vscode_askQuestions (Template F) → usuário digita a close_key."
        exit 0
    fi

    # --- Passo 2: Garante state inicializado ---
    ensure_state_for_tool "$session_id"

    # --- Passo 3: Captura intenção do turno se start-turn.sh foi chamado ---
    maybe_capture_turn_intent "$HOOK_TOOL_INPUT"

    # --- Passo 4: Abre novo SUBTURN ---
    local subturn_num
    subturn_num=$(open_new_subturn)

    # --- Passo 5: Contabiliza tool use ---
    local tool_num
    tool_num=$(count_tool_use)

    # --- Passo 6: Log do subturnStart + toolUse ---
    local subturn_id turn_num
    subturn_id=$(read_field ".current_subturn.subturn_id")
    turn_num=$(read_field ".current_turn.number")

    hook_log_audit "subturnStart" \
        "subturn" "${subturn_num:-0}" \
        "subturn_id" "${subturn_id:-unknown}" \
        "turn" "${turn_num:-0}" \
        "tool" "${HOOK_TOOL_NAME:-unknown}" \
        "tool_call_num" "${tool_num:-0}"

    exit 0
}

main() { pre_tool_use_main "$1"; }
