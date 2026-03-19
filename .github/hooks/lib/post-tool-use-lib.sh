#!/usr/bin/env bash
# post-tool-use-lib.sh — Lógica do PostToolUse hook
# Responsabilidades:
#   - Detecta resposta de vscode_askQuestions → seta ask_questions_called=true
#   - Detecta close_key na resposta → seta pending_session_close=true
#   - Fecha current_subturn
# Sourceado por scripts/post-tool-use.sh

# shellcheck source=common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
# shellcheck source=hook-payload-api.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hook-payload-api.sh"

# ---------------------------------------------------------------------------
# main — entrada principal para o PostToolUse hook
# $1 = conteúdo do stdin (JSON completo enviado pelo VS Code)
# ---------------------------------------------------------------------------
post_tool_use_main() {
    local input="$1"
    maybe_capture_debug "$input"

    # Popula HOOK_* vars a partir do payload (session_id, tool_name, tool_response, etc.)
    hook_api_parse "$input"

    export SESSION_ID="${HOOK_SESSION_ID:-unknown}"

    local turn_num=0
    if state_exists; then
        turn_num=$(read_field ".current_turn.number")
        turn_num="${turn_num:-0}"
    fi

    # --- Detecta resposta de vscode_askQuestions (via API) ---
    if hook_is_ask_questions; then

        if state_exists; then
            # Fecha current_subturn
            update_nested_state "current_subturn.response_at" "$(now_iso)"

            # ** Seta ask_questions_called = true (pós-resposta, não no PreToolUse) **
            update_nested_state "current_turn.ask_questions_called" "true"

            log_audit "subturnEnd" "turn" "$turn_num"
            log_audit "askQuestions_responded" "turn" "$turn_num"

            # --- Detecta close_key na resposta (via API — elimina parse manual) ---
            if hook_close_key_in_response; then
                log_audit "sessionCloseAuthorized" "turn" "$turn_num"
                update_state_bool "pending_session_close" "true"
            fi
        fi
    fi

    exit 0
}

main() { post_tool_use_main "$1"; }
