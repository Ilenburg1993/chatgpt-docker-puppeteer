#!/usr/bin/env bash
# shellcheck shell=bash
set -euo pipefail

# Lógica de domínio do hook sessionStart.
# Pré-requisito: common.sh carregado pelo script entrypoint.
run_session_start_hook() {
    local hook_dir="${1:-${HOOK_DIR:-}}"
    if [ -z "$hook_dir" ]; then
        hook_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
    fi

    HOOK_DIR="$hook_dir"
    LOG_DIR="$HOOK_DIR/logs"
    STATE_DIR="$HOOK_DIR/state"

    mkdir -p "$LOG_DIR" && chmod 700 "$LOG_DIR"
    mkdir -p "$STATE_DIR"

    # Redireciona stdout → stderr para output visual (banner, logs ao dev).
    # O stdout original é preservado em fd 3 para resposta JSON do hook.
    exec 3>&1 1>&2

    if ! declare -F session_start_load_domain_modules > /dev/null 2>&1; then
        # shellcheck disable=SC1091
        source "$HOOK_DIR/hooks-lib/lifecycle/session-start-runtime.sh"
    fi

    session_start_load_domain_modules "$HOOK_DIR" || {
        echo "[session-start] erro: falha ao carregar módulos de domínio" >&2
        return 1
    }

    session_start_load_support_modules "$HOOK_DIR" || {
        echo "[session-start] erro: falha ao carregar módulos auxiliares" >&2
        return 1
    }

    INPUT="$(cat 2> /dev/null || true)"

    session_start_parse_hook_input "$INPUT"

    case "$SOURCE" in
        new | inline_restart | reconnect_rollover | manual_recovery | auto_recovery | healed_from_real_session | healed_from_consecutive_mismatch)
            ;;
        *)
            SOURCE='new'
            SESSIONSTART_TRIGGER_KIND='new_chat_or_panel_activation'
            ;;
    esac

    session_start_prepare_session_metadata "$SESSION_ID" "$STATE_DIR" "$LOG_DIR"
    export SESSION_DATE_SHORT

    session_start_load_previous_context_snapshot "$STATE_DIR"

    session_start_run_housekeeping_scripts "$HOOK_DIR" || true

    PREV_CLOSE_MODE="ok"
    PREV_RECONNECT_COUNT=0
    PREV_SESSION_ID=""
    PREV_CHECKPOINT_TS=""
    export INITIAL_TURN_ID

    LOGICAL_SESSION_NUMBER=1
    if declare -F session_start_compute_logical_session_number > /dev/null 2>&1; then
        session_start_compute_logical_session_number "$STATE_DIR" "$SOURCE" || LOGICAL_SESSION_NUMBER=1
    fi

    if declare -F session_start_persist_initial_context > /dev/null 2>&1; then
        session_start_persist_initial_context
    else
        echo "[session-start] erro: função session_start_persist_initial_context indisponível" >&2
        return 1
    fi

    CTX_FILE="$PER_CTX_FILE"
    AUDIT_FILE="$PER_AUDIT_FILE"
    touch "$AUDIT_FILE" 2> /dev/null || true

    if [ "${SESSION_ID_INVALID:-false}" = "true" ]; then
        jq -cn \
            --arg event "session_id_invalid_fallback" \
            --arg sid "$SESSION_ID" \
            --arg raw "$(printf '%s' "${SESSION_ID_RAW:-}" | head -c 120)" \
            --arg ts "${TIMESTAMP:-$SESSION_DATE}" \
            '{
                event: $event,
                session_id: $sid,
                timestamp: $ts,
                raw_session_id: (if $raw == "" then null else $raw end),
                message: "session_id inválido no payload — UUID de fallback gerado"
            }' >> "$AUDIT_FILE" 2> /dev/null || true
    fi

    rm -f "$STATE_DIR/.mismatch_track.json" 2> /dev/null || true

    CHECKPOINT_DIR="$HOOK_DIR/checkpoints"
    session_start_find_previous_checkpoint \
        "$CHECKPOINT_DIR" \
        "$AUDIT_FILE" \
        "$SESSION_ID" \
        "${TIMESTAMP:-$SESSION_DATE}" \
        "$SESSION_DATE" \
        || true

    session_start_prepare_abrupt_close_state \
        "$STATE_DIR" \
        "$LOG_DIR" \
        "$SESSION_ID" \
        "$TIMESTAMP" \
        "$SESSION_DATE" \
        "$SID_SHORT"

    session_start_prepare_recovery_alerts \
        "$PER_CTX_FILE" \
        "$TIMESTAMP" \
        "$SESSION_DATE" \
        "$PREV_CLOSE_MODE" \
        "$PREV_SESSION_ID" \
        "$PREV_CHECKPOINT_TS" \
        "$PREV_RECONNECT_COUNT"

    session_start_emit_bootstrap_events \
        "$AUDIT_FILE" \
        "$SESSION_ID" \
        "$TIMESTAMP" \
        "$SESSION_DATE" \
        "$SOURCE" \
        "$SESSIONSTART_TRIGGER_KIND" \
        "$CWD" \
        "$CLOSE_KEY" \
        "$INITIAL_SECTION_ID" \
        "$LOGICAL_SESSION_NUMBER"

    TASKS_FILE="$STATE_DIR/pending-tasks.md"
    FINDINGS_FILE="$LOG_DIR/findings.jsonl"
    BRIEFING_FILE="$STATE_DIR/session-briefing.md"

    if declare -F session_start_collect_backlog_and_findings > /dev/null 2>&1; then
        session_start_collect_backlog_and_findings "$TASKS_FILE" "$FINDINGS_FILE"
    else
        COUNT_ALTA=0
        COUNT_MEDIA=0
        COUNT_BACKLOG=0
        NEXT_TASK=""
        OPEN_FINDINGS=0
        CRITICAL_FINDINGS=0
        TOTAL_OPEN=0
    fi

    if declare -F session_start_compute_trends > /dev/null 2>&1; then
        session_start_compute_trends
    else
        TREND_SESSIONS="N/D"
        TREND_TOTAL_TOOLS="N/D"
        TREND_ERROR_RATE="N/D"
        TREND_TOP_TOOLS_TABLE="| N/D | 0 |"
        TREND_TOP_FAILURES="- (nenhuma falha registrada)"
        TREND_PERF_TABLE="| N/D | - | 0 |"
    fi

    if declare -F session_start_compute_health > /dev/null 2>&1; then
        session_start_compute_health
    else
        HEALTH_CRITICAL=""
        HEALTH_WARNINGS=""
        HEALTH_STATUS="✅ Sistema operacional"
        NET_CHECK_HOST="${HEALTH_CHECK_HOST:-140.82.112.22}"
        NET_OK=true
        RECENT_RECONNECT_COUNT=0
    fi

    # Contrato explícito de snapshot operacional consumido pelo renderer de briefing.
    export COUNT_ALTA COUNT_MEDIA COUNT_BACKLOG NEXT_TASK OPEN_FINDINGS CRITICAL_FINDINGS TOTAL_OPEN
    export TREND_SESSIONS TREND_TOTAL_TOOLS TREND_ERROR_RATE TREND_TOP_TOOLS_TABLE TREND_TOP_FAILURES TREND_PERF_TABLE
    export HEALTH_CRITICAL HEALTH_WARNINGS HEALTH_STATUS NET_CHECK_HOST NET_OK NET_CHECK_ENABLED RECENT_RECONNECT_COUNT

    session_start_prepare_violation_state \
        "$STATE_DIR" \
        "$AUDIT_FILE" \
        "$SESSION_ID" \
        "$TIMESTAMP" \
        "$SESSION_DATE" \
        "$PREV_CONSEC_UNAUTH" \
        "$PREV_SESSION_ID_FROM_CTX" \
        "$PREV_LAST_TURN_TS_FROM_CTX" \
        "$PREV_TURN_NUMBER_FROM_CTX"

    session_start_render_full_briefing \
        "$BRIEFING_FILE" \
        "$SESSION_DATE" \
        "$CLOSE_KEY" \
        "$SOURCE" \
        "$STATE_DIR" \
        "$CTX_FILE"

    session_start_emit_runtime_banner
    session_start_emit_backlog_summary \
        "$TASKS_FILE" \
        "$COUNT_ALTA" \
        "$COUNT_MEDIA" \
        "$COUNT_BACKLOG" \
        "$TOTAL_OPEN" \
        "$NEXT_TASK"
    session_start_emit_hook_output "$BRIEFING_FILE"

    return 0
}
