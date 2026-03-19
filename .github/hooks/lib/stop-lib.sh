#!/usr/bin/env bash
# stop-lib.sh — Lógica do Stop hook (rastreamento de lifecycle, sem enforcement)
# NOTA: enforcement (emit_stop_block) desativado — stop registra turnos e encerra sessões,
#       mas não bloqueia o agente por ausência de vscode_askQuestions.
# Sourceado por scripts/stop.sh

# shellcheck source=common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
# shellcheck source=hook-payload-api.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hook-payload-api.sh"

# ---------------------------------------------------------------------------
# main — entrada principal para o Stop hook
# $1 = conteúdo do stdin (JSON completo enviado pelo VS Code)
# ---------------------------------------------------------------------------
stop_main() {
    local input="$1"
    maybe_capture_debug "$input"

    # Popula HOOK_* vars a partir do payload
    hook_api_parse "$input"

    export SESSION_ID="${HOOK_SESSION_ID:-unknown}"

    # --- Passo 1: Anti-loop — sai imediatamente se stop_hook_active=true ---
    if hook_is_stop_active; then
        log_audit "turnEnd_loop"
        exit 0
    fi

    # --- Passo 2: Auto-init se state não existe ---
    if ! state_exists; then
        init_state "$SESSION_ID"
        log_audit "state_auto_init"
        exit 0
    fi

    # --- Passo 3: Guard — sem turnos registrados ainda (edge case) ---
    local turn_count
    turn_count=$(read_field ".session_stats.turn_count")
    if [ -z "$turn_count" ] || [ "$turn_count" = "null" ] || [ "$turn_count" -eq 0 ] 2> /dev/null; then
        exit 0
    fi

    # --- Passo 4: Classifica o turno (autorizado vs não-autorizado) ---
    local ask_q turn_num
    ask_q=$(read_field ".current_turn.ask_questions_called")
    turn_num=$(read_field ".current_turn.number")

    if [ "$ask_q" = "true" ]; then
        # Turno autorizado: reseta flags e acumula contador
        update_nested_state "current_turn.ask_questions_called" "false"
        update_nested_state "compliance.consecutive_unauthorized" "0"
        update_nested_state "compliance.last_turn_authorized" "true"
        local auth
        auth=$(read_field ".session_stats.turn_authorized")
        auth=$((${auth:-0} + 1))
        update_nested_state "session_stats.turn_authorized" "$auth"
        log_audit "turnEnd_authorized" "turn" "${turn_num:-0}"
    else
        # Turno não-autorizado: rastreia sem bloquear
        # [ENFORCEMENT DESATIVADO — emit_stop_block não é chamado aqui]
        local consec
        consec=$(read_field ".compliance.consecutive_unauthorized")
        consec=$((${consec:-0} + 1))
        update_nested_state "compliance.consecutive_unauthorized" "$consec"
        update_nested_state "compliance.last_turn_authorized" "false"
        local unauth
        unauth=$(read_field ".session_stats.turn_unauthorized")
        unauth=$((${unauth:-0} + 1))
        update_nested_state "session_stats.turn_unauthorized" "$unauth"
        log_audit "turnEnd_unauthorized" "turn" "${turn_num:-0}"
    fi

    # --- Passo 5: Se pending_session_close → chamar session-close.sh ---
    local pending
    pending=$(read_field ".pending_session_close")
    if [ "$pending" = "true" ]; then
        bash "$HOOK_DIR/scripts/session-close.sh" || true
    fi

    exit 0
}

main() { stop_main "$1"; }
