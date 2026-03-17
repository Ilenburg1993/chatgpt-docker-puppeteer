#!/usr/bin/env bash
# shellcheck shell=bash
set -euo pipefail

# Helpers de detecção de violações para session-start-lib.

session_start_load_previous_context_snapshot() {
    local state_dir="${1:-}"

    PREV_CONSEC_UNAUTH=0
    PREV_SESSION_ID_FROM_CTX=""
    PREV_LAST_TURN_TS_FROM_CTX=""
    PREV_TURN_NUMBER_FROM_CTX=0

    if [ -f "$state_dir/session-context.json" ] && [ -s "$state_dir/session-context.json" ]; then
        _raw="$(jq -r '
            .compliance.consecutive_unauthorized //
            .consecutive_unauthorized_closes //
            0' "$state_dir/session-context.json" 2> /dev/null || echo 0)"
        if [[ "$_raw" =~ ^[0-9]+$ ]]; then
            PREV_CONSEC_UNAUTH="$_raw"
        fi
        PREV_SESSION_ID_FROM_CTX="$(jq -r '.session.id // ""' "$state_dir/session-context.json" 2> /dev/null || echo '')"
        PREV_LAST_TURN_TS_FROM_CTX="$(jq -r '.last_turn_ts // ""' "$state_dir/session-context.json" 2> /dev/null || echo '')"
        PREV_TURN_NUMBER_FROM_CTX="$(jq -r '.current_turn.number // 0' "$state_dir/session-context.json" 2> /dev/null || echo 0)"
    fi

    export PREV_CONSEC_UNAUTH PREV_SESSION_ID_FROM_CTX PREV_LAST_TURN_TS_FROM_CTX PREV_TURN_NUMBER_FROM_CTX
    return 0
}

session_start_process_unauthorized_close_flag() {
    local state_dir="${1:-}"
    local audit_file="${2:-}"
    local session_id="${3:-}"
    local timestamp="${4:-}"
    local session_date="${5:-}"
    local prev_consec_unauth="${6:-0}"
    local prev_session_id_from_ctx="${7:-}"
    local prev_last_turn_ts_from_ctx="${8:-}"
    local prev_turn_number_from_ctx="${9:-0}"

    AUTH_FLAG_FILE="$state_dir/UNAUTHORIZED_CLOSE.flag"
    PREV_UNAUTH_CLOSE=false
    PREV_UNAUTH_FLAG_STALE=false
    PREV_UNAUTH_TS=""
    PREV_UNAUTH_SID=""
    PREV_UNAUTH_TURN=0

    if [ -f "$AUTH_FLAG_FILE" ]; then
        PREV_UNAUTH_TS="$(jq -r '.timestamp // ""' "$AUTH_FLAG_FILE" 2> /dev/null || echo '')"
        PREV_UNAUTH_SID="$(jq -r '.session_id // ""' "$AUTH_FLAG_FILE" 2> /dev/null || echo '')"
        PREV_UNAUTH_TURN="$(jq -r '.turn_count // 0' "$AUTH_FLAG_FILE" 2> /dev/null || echo 0)"

        if [ -n "$PREV_UNAUTH_SID" ] && [ "$PREV_UNAUTH_SID" != "$session_id" ]; then
            PREV_UNAUTH_FLAG_STALE=true
            PREV_UNAUTH_CLOSE=true
            rm -f "$AUTH_FLAG_FILE" 2> /dev/null || true
            jq -cn \
                --arg event "authViolation_stale_cleared" \
                --arg new_sid "$session_id" \
                --arg old_sid "$PREV_UNAUTH_SID" \
                --arg ts "${timestamp:-$session_date}" \
                --arg flag_ts "$PREV_UNAUTH_TS" \
                '{
                    event:       $event,
                    session_id:  $new_sid,
                    timestamp:   $ts,
                    old_session_id: $old_sid,
                    flag_timestamp: $flag_ts,
                    message:     "Flag UNAUTHORIZED_CLOSE de sessão diferente removido automaticamente"
                }' >> "$audit_file" 2> /dev/null || true
            prev_consec_unauth=0
        else
            PREV_UNAUTH_CLOSE=true
        fi
    fi

    if [ "$PREV_UNAUTH_CLOSE" = "false" ] && [ "${prev_consec_unauth:-0}" -gt 0 ]; then
        PREV_UNAUTH_CLOSE=true
        PREV_UNAUTH_FLAG_STALE=false
        PREV_UNAUTH_SID="${prev_session_id_from_ctx:-${PREV_SESSION_ID:-sessão anterior}}"
        PREV_UNAUTH_TS="${prev_last_turn_ts_from_ctx:-desconhecido}"
        PREV_UNAUTH_TURN="${prev_turn_number_from_ctx:-0}"
        jq -cn \
            --arg event "authViolation_detected_ctx_fallback" \
            --arg new_sid "$session_id" \
            --arg old_sid "$PREV_UNAUTH_SID" \
            --arg ts "${timestamp:-$session_date}" \
            --argjson consec "${prev_consec_unauth:-0}" \
            '{
                event:                    $event,
                session_id:               $new_sid,
                timestamp:                $ts,
                old_session_id:           $old_sid,
                consecutive_unauthorized: $consec,
                message:                  "Violação detectada via ctx fallback (sem flag file) — hardening v5.1"
            }' >> "$audit_file" 2> /dev/null || true
    fi

    CONSECUTIVE_VIOLATIONS="${prev_consec_unauth:-0}"

    export AUTH_FLAG_FILE PREV_UNAUTH_CLOSE PREV_UNAUTH_FLAG_STALE PREV_UNAUTH_TS PREV_UNAUTH_SID PREV_UNAUTH_TURN
    export CONSECUTIVE_VIOLATIONS
    return 0
}

session_start_process_no_key_flag() {
    local state_dir="${1:-}"
    local audit_file="${2:-}"
    local session_id="${3:-}"
    local timestamp="${4:-}"
    local session_date="${5:-}"

    NO_KEY_FLAG_FILE="$state_dir/SESSION_CLOSE_NO_KEY.flag"
    PREV_NO_KEY_CLOSE=false
    PREV_NO_KEY_TS=""
    PREV_NO_KEY_SID=""
    PREV_NO_KEY_TURNS=0
    PREV_NO_KEY_FLAG_STALE=false

    if [ -f "$NO_KEY_FLAG_FILE" ]; then
        PREV_NO_KEY_CLOSE=true
        PREV_NO_KEY_TS="$(jq -r '.timestamp // ""' "$NO_KEY_FLAG_FILE" 2> /dev/null || echo '')"
        PREV_NO_KEY_SID="$(jq -r '.session_id // ""' "$NO_KEY_FLAG_FILE" 2> /dev/null || echo '')"
        PREV_NO_KEY_TURNS="$(jq -r '.turn_count // 0' "$NO_KEY_FLAG_FILE" 2> /dev/null || echo 0)"

        case "$PREV_NO_KEY_SID" in
            "")
                PREV_NO_KEY_FLAG_STALE=true
                ;;
            sess_test*)
                PREV_NO_KEY_FLAG_STALE=true
                ;;
        esac

        if [ "$PREV_NO_KEY_FLAG_STALE" = "true" ]; then
            PREV_NO_KEY_CLOSE=false
            jq -cn \
                --arg event "session_no_key_flag_stale_cleared" \
                --arg sid "$session_id" \
                --arg ts "${timestamp:-$session_date}" \
                --arg old_sid "$PREV_NO_KEY_SID" \
                --arg flag_ts "$PREV_NO_KEY_TS" \
                '{
                    event: $event,
                    session_id: $sid,
                    timestamp: $ts,
                    stale_session_id: $old_sid,
                    stale_flag_timestamp: $flag_ts,
                    message: "SESSION_CLOSE_NO_KEY.flag sintético/stale removido automaticamente"
                }' >> "$audit_file" 2> /dev/null || true
            rm -f "$NO_KEY_FLAG_FILE" 2> /dev/null || true
        else
            jq -cn \
                --arg event "session_no_key_flag_consumed" \
                --arg sid "$session_id" \
                --arg ts "${timestamp:-$session_date}" \
                --arg old_sid "$PREV_NO_KEY_SID" \
                --arg flag_ts "$PREV_NO_KEY_TS" \
                ' {
                    event: $event,
                    session_id: $sid,
                    timestamp: $ts,
                    previous_session_id: $old_sid,
                    previous_timestamp: $flag_ts,
                    message: "SESSION_CLOSE_NO_KEY.flag consumido (one-shot)"
                }' >> "$audit_file" 2> /dev/null || true
            rm -f "$NO_KEY_FLAG_FILE" 2> /dev/null || true
        fi
    fi

    export NO_KEY_FLAG_FILE PREV_NO_KEY_CLOSE PREV_NO_KEY_TS PREV_NO_KEY_SID PREV_NO_KEY_TURNS PREV_NO_KEY_FLAG_STALE
    return 0
}

session_start_compute_violation_severity() {
    local consecutive_violations="${1:-0}"

    if [ "${consecutive_violations}" -ge 3 ] 2> /dev/null; then
        VIOLATION_EMOJIS="⛔⛔⛔"
        VIOLATION_LEVEL="VIOLAÇÃO CRÍTICA REITERADA (${consecutive_violations}x consecutivas)"
    elif [ "${consecutive_violations}" -ge 2 ] 2> /dev/null; then
        VIOLATION_EMOJIS="⛔⛔"
        VIOLATION_LEVEL="SEGUNDA VIOLAÇÃO CONSECUTIVA"
    else
        VIOLATION_EMOJIS="⛔"
        VIOLATION_LEVEL="AVISO DE VIOLAÇÃO"
    fi

    export VIOLATION_EMOJIS VIOLATION_LEVEL
    return 0
}

session_start_prepare_violation_state() {
    local state_dir="${1:-}"
    local audit_file="${2:-}"
    local session_id="${3:-}"
    local timestamp="${4:-}"
    local session_date="${5:-}"
    local prev_consec_unauth="${6:-0}"
    local prev_session_id_from_ctx="${7:-}"
    local prev_last_turn_ts_from_ctx="${8:-}"
    local prev_turn_number_from_ctx="${9:-0}"

    session_start_process_unauthorized_close_flag \
        "$state_dir" \
        "$audit_file" \
        "$session_id" \
        "$timestamp" \
        "$session_date" \
        "$prev_consec_unauth" \
        "$prev_session_id_from_ctx" \
        "$prev_last_turn_ts_from_ctx" \
        "$prev_turn_number_from_ctx"

    session_start_process_no_key_flag \
        "$state_dir" \
        "$audit_file" \
        "$session_id" \
        "$timestamp" \
        "$session_date"

    session_start_compute_violation_severity "$CONSECUTIVE_VIOLATIONS"
    return 0
}
