#!/usr/bin/env bash
# stop-lib.sh — Lógica do Stop hook (rastreamento de lifecycle + enforcement opcional)
# GAP-03: strict_turn_close agora é lido e enforcement é ativado quando =true.
# GAP-58: usa increment_field() em vez de aritmética manual.
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

    # Popula HOOK_* vars a partir do payload (tolera parse parcial)
    hook_api_parse "$input" || true

    export SESSION_ID="${HOOK_SESSION_ID:-unknown}"

    # --- Passo 1: Anti-loop — sai imediatamente se stop_hook_active=true ---
    if hook_is_stop_active; then
        hook_log_audit "turnEnd_loop"
        exit 0
    fi

    # --- Passo 2: Auto-init se state não existe ---
    if ! state_exists; then
        init_state "$SESSION_ID"
        hook_log_audit "state_auto_init"
        exit 0
    fi

    # --- Passo 3: Guard — sem turnos registrados ainda (edge case) ---
    local turn_count
    turn_count=$(read_field ".session_stats.turn_count")
    # NEW-G: usar comparação de string em vez de aritmética para turn_count
    # [ "$x" -eq 0 ] com $x="null" ou vazios pode ter comportamento imprevisível
    turn_count="${turn_count:-0}"
    if [[ "$turn_count" = "null" ]] || [[ "$turn_count" = "0" ]] || [[ "$turn_count" = "" ]]; then
        exit 0
    fi

    # --- Passo 4: Classifica o turno (autorizado vs não-autorizado) ---
    local ask_q turn_num
    ask_q=$(read_field ".current_turn.ask_questions_called")
    turn_num=$(read_field ".current_turn.number")

    if [[ "$ask_q" = "true" ]]; then
        # Turno autorizado: reseta flags e acumula contador
        update_nested_state "current_turn.ask_questions_called" "false"
        update_nested_state "current_turn.ended_at" "$(now_iso)" # GAP-13
        update_nested_state "compliance.consecutive_unauthorized" "0"
        update_nested_state "compliance.last_turn_authorized" "true"
        # GAP-ABRUPT-SUBTURN: fecha subturn ativo (se houver) antes de emitir turnEnd
        _close_active_subturn_if_open
        # GAP-SUBAGENT-ORPHAN: reseta subagents_active=0 ao fechar turno
        # (subagentes não cruzam fronteiras de turno; Stop limpa qualquer orphan)
        _reset_active_subagents_if_needed
        # UP-HEARTBEAT: registra timestamp de atividade para watchdog
        update_nested_state "last_activity_at" "$(now_iso)"
        # UP-DURATION: calcula e grava duração do turno em ms
        _record_turn_duration
        # GAP-58: usa increment_field() em vez de aritmética manual
        increment_field ".session_stats.turn_authorized" > /dev/null
        hook_log_audit "turnEnd_authorized" "turn" "${turn_num:-0}"
    else
        # Turno não-autorizado: rastreia e aplica enforcement se strict_turn_close=true
        update_nested_state "current_turn.ended_at" "$(now_iso)" # GAP-13
        # GAP-ABRUPT-SUBTURN: fecha subturn ativo (se houver) antes de emitir turnEnd
        _close_active_subturn_if_open
        # GAP-SUBAGENT-ORPHAN: reseta subagents_active=0 ao fechar turno
        _reset_active_subagents_if_needed
        # UP-HEARTBEAT: registra timestamp de atividade mesmo em turnos não-autorizados
        update_nested_state "last_activity_at" "$(now_iso)"
        # UP-DURATION: calcula e grava duração do turno em ms
        _record_turn_duration
        # GAP-58: usa increment_field() em vez de aritmética manual
        increment_field ".compliance.consecutive_unauthorized" > /dev/null
        update_nested_state "compliance.last_turn_authorized" "false"
        increment_field ".session_stats.turn_unauthorized" > /dev/null
        hook_log_audit "turnEnd_unauthorized" "turn" "${turn_num:-0}"

        # GAP-03: Enforcement — bloqueia fim de turno se strict_turn_close=true
        local strict
        strict=$(read_field ".strict_turn_close")
        if [[ "${strict:-false}" = "true" ]]; then
            hook_out_stop_safe_block \
                "Protocolo violado: turno encerrado sem chamar vscode_askQuestions" \
                "Chame vscode_askQuestions antes de encerrar o turno. Use Template A para tarefas concluídas ou Template D para checkpoint."
        fi
    fi

    # --- Passo 5: Se pending_session_close → chamar session-close.sh ---
    local pending
    pending=$(read_field ".pending_session_close")
    if [[ "$pending" = "true" ]]; then
        bash "$HOOK_DIR/scripts/session-close.sh" || true
    fi

    exit 0
}

# ---------------------------------------------------------------------------
# _record_turn_duration — calcula e grava current_turn.duration_ms + acumula
# UP-DURATION: duração do turno para métricas de desempenho (UP-U5)
# ---------------------------------------------------------------------------
_record_turn_duration() {
    local turn_started dur_ms prev_total new_total now_ts start_epoch now_epoch
    turn_started=$(read_field ".current_turn.started_at" 2> /dev/null)
    [[ -z "$turn_started" ]] || [[ "$turn_started" = "null" ]] && return 0

    now_ts=$(now_iso)
    start_epoch=$(date -u -d "$turn_started" +%s 2> /dev/null) || return 0
    now_epoch=$(date -u +%s 2> /dev/null) || return 0
    dur_ms=$(((now_epoch - start_epoch) * 1000))
    [ "$dur_ms" -lt 0 ] 2> /dev/null && return 0

    update_nested_state "current_turn.duration_ms" "$dur_ms"

    prev_total=$(read_field ".session_stats.turn_duration_total_ms" 2> /dev/null)
    prev_total="${prev_total:-0}"
    [[ "$prev_total" = "null" ]] && prev_total=0
    new_total=$((prev_total + dur_ms))
    update_nested_state "session_stats.turn_duration_total_ms" "$new_total"
}

# ---------------------------------------------------------------------------
# _close_active_subturn_if_open — fecha subturn ativo se ended_at = null
# GAP-ABRUPT-SUBTURN: garante que o audit trail tenha subturnEnd antes de turnEnd
# Emite evento subturnEnd_abrupt se o subturn não foi fechado normalmente
# ---------------------------------------------------------------------------
_close_active_subturn_if_open() {
    local subturn_num subturn_ended
    subturn_num=$(read_field ".current_subturn.number" 2> /dev/null || printf '0')
    subturn_num="${subturn_num:-0}"
    [[ "$subturn_num" = "0" ]] || [[ "$subturn_num" = "null" ]] && return 0

    subturn_ended=$(read_field ".current_subturn.ended_at" 2> /dev/null || printf '')
    # Se já tem ended_at, subturn foi fechado normalmente pelo post-tool-use
    if [[ -n "$subturn_ended" ]] && [[ "$subturn_ended" != "null" ]]; then
        return 0
    fi

    # Subturn ativo sem ended_at — fecha agora
    local now_ts
    now_ts=$(now_iso)
    update_nested_state "current_subturn.ended_at" "$now_ts"
    hook_log_audit "subturnEnd_abrupt" \
        "subturn" "${subturn_num}" \
        "reason" "stop_without_post_tool_use"
}

# ---------------------------------------------------------------------------
# _reset_active_subagents_if_needed — reseta subagents_active=0 se > 0 no Stop
# GAP-SUBAGENT-ORPHAN: subagentes não cruzam fronteiras de turno.
# Se subagents_active > 0 ao fechar o turno, um SubagentStop foi perdido.
# Emite evento subagentOrphan_turnclosed para cada subagente órfão.
# ---------------------------------------------------------------------------
_reset_active_subagents_if_needed() {
    local active
    active=$(read_field ".session_stats.subagents_active" 2> /dev/null || printf '0')
    active="${active:-0}"
    [[ "$active" = "0" ]] || [[ "$active" = "null" ]] && return 0

    # Há subagentes com SubagentStop perdido — reseta para evitar estado corrompido
    update_nested_state "session_stats.subagents_active" "0"
    hook_log_audit "subagentOrphan_turnclosed" \
        "orphaned_count" "${active}" \
        "reason" "SubagentStop_not_received_before_turn_end"
}

main() { stop_main "$1"; }
