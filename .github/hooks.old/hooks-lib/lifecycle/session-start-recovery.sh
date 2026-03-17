#!/usr/bin/env bash
# shellcheck shell=bash
set -euo pipefail

# Helpers de recovery para session-start-lib.

session_start_find_previous_checkpoint() {
    local checkpoint_dir="${1:-}"
    local audit_file="${2:-}"
    local session_id="${3:-}"
    local timestamp="${4:-}"
    local session_date="${5:-}"

    PREV_CHECKPOINT=""
    PREV_SESSION_ID=""
    PREV_TURN_COUNT=0
    PREV_TASKS_OPEN=0
    PREV_CHECKPOINT_TS=""
    PREV_CLOSE_KEY_VALIDATED=false
    local checkpoint_scan_limit="${HOOKS_CHECKPOINT_SCAN_LIMIT:-100}"

    if ! [[ "$checkpoint_scan_limit" =~ ^[0-9]+$ ]] || [ "$checkpoint_scan_limit" -lt 1 ]; then
        checkpoint_scan_limit=100
    fi

    [ -d "$checkpoint_dir" ] || return 0

    while IFS= read -r _CP_FILE; do
        [ -z "$_CP_FILE" ] && continue

        _CP_BASENAME="$(basename "$_CP_FILE" 2> /dev/null || echo '')"
        _CP_SESSION_ID="$(jq -r '.session_id // ""' "$_CP_FILE" 2> /dev/null || echo '')"
        _CP_CHECKPOINT_TS="$(jq -r '.checkpoint_ts // ""' "$_CP_FILE" 2> /dev/null || echo '')"
        _CP_SKIP_REASON=""

        case "$_CP_BASENAME" in
            sess_test*) _CP_SKIP_REASON="synthetic_test_checkpoint" ;;
        esac

        if [ -z "$_CP_SKIP_REASON" ] && [ -z "$_CP_SESSION_ID" ]; then
            _CP_SKIP_REASON="missing_session_id"
        fi

        if [ -z "$_CP_SKIP_REASON" ] && [ -n "$_CP_CHECKPOINT_TS" ]; then
            _NOW_EPOCH="$(date -u +%s 2> /dev/null || echo 0)"
            _CP_EPOCH="$(date -u -d "$_CP_CHECKPOINT_TS" +%s 2> /dev/null || echo '')"
            if [ -z "$_CP_EPOCH" ]; then
                _CP_SKIP_REASON="invalid_checkpoint_ts"
            elif [ "$_CP_EPOCH" -gt $((_NOW_EPOCH + 300)) ]; then
                _CP_SKIP_REASON="future_checkpoint_ts"
            fi
        fi

        if [ -n "$_CP_SKIP_REASON" ]; then
            jq -cn \
                --arg event "recovery_checkpoint_ignored" \
                --arg sid "$session_id" \
                --arg ts "${timestamp:-$session_date}" \
                --arg file "$_CP_BASENAME" \
                --arg reason "$_CP_SKIP_REASON" \
                --arg prev_sid "$_CP_SESSION_ID" \
                '{
                    event: $event,
                    session_id: $sid,
                    timestamp: $ts,
                    checkpoint_file: $file,
                    reason: $reason,
                    ignored_session_id: $prev_sid
                }' >> "$audit_file" 2> /dev/null || true
            continue
        fi

        PREV_CHECKPOINT="$_CP_FILE"
        break
    done < <(find "$checkpoint_dir" -maxdepth 1 -name 'sess_*_turn*.json' -printf '%T@ %p\n' 2> /dev/null | sort -rn | head -n "$checkpoint_scan_limit" | cut -d' ' -f2-)

    if [ -n "$PREV_CHECKPOINT" ] && [ -f "$PREV_CHECKPOINT" ]; then
        PREV_SESSION_ID="$(jq -r '.session_id // ""' "$PREV_CHECKPOINT" 2> /dev/null || echo '')"
        PREV_TURN_COUNT="$(jq -r '.turn_count // 0' "$PREV_CHECKPOINT" 2> /dev/null || echo 0)"
        PREV_TASKS_OPEN="$(jq -r '.tasks.open_total // 0' "$PREV_CHECKPOINT" 2> /dev/null || echo 0)"
        PREV_CHECKPOINT_TS="$(jq -r '.checkpoint_ts // ""' "$PREV_CHECKPOINT" 2> /dev/null || echo '')"
        PREV_CLOSE_KEY_VALIDATED="$(jq -r '.session.close_key_validated // false' "$PREV_CHECKPOINT" 2> /dev/null || echo false)"
    fi

    export PREV_CHECKPOINT PREV_SESSION_ID PREV_TURN_COUNT PREV_TASKS_OPEN PREV_CHECKPOINT_TS PREV_CLOSE_KEY_VALIDATED
    return 0
}

session_start_prepare_abrupt_close_state() {
    local state_dir="${1:-}"
    local log_dir="${2:-}"
    local session_id="${3:-}"
    local timestamp="${4:-}"
    local session_date="${5:-}"
    local sid_short="${6:-}"

    PREV_ABRUPT_CLOSE=false
    PREV_CLOSE_MODE="ok"
    PREV_RECONNECT_COUNT=0

    if [ -n "${PREV_SESSION_ID:-}" ] && [ "${PREV_SESSION_ID}" != "$session_id" ]; then
        _PREV_SID_SHORT="${PREV_SESSION_ID:0:8}"
        _AUDIT_TMP="${log_dir}/audit-${_PREV_SID_SHORT}.jsonl"
        [ -f "$_AUDIT_TMP" ] || _AUDIT_TMP="${log_dir}/audit.jsonl"
        _FOUND_SESSION_END=false

        if [ -f "$_AUDIT_TMP" ] && jq -s -e --arg sid "${PREV_SESSION_ID}" \
            'any(.[]; ((.event == "sessionEnd" or .event == "sessionCloseAuthorized") and ((.session_id // "") == $sid)))' \
            "$_AUDIT_TMP" > /dev/null 2> /dev/null; then
            _FOUND_SESSION_END=true
        fi

        if [ "$_FOUND_SESSION_END" = "false" ]; then
            _LATEST_ARCHIVE="$(find "$log_dir" -maxdepth 1 -name 'audit-????????.jsonl' \
                ! -name "audit-${sid_short}.jsonl" \
                -printf '%T@ %p\n' 2> /dev/null | sort -rn | head -1 | cut -d' ' -f2- || true)"
            if [ -n "$_LATEST_ARCHIVE" ] && [ -f "$_LATEST_ARCHIVE" ] \
                && jq -s -e --arg sid "${PREV_SESSION_ID}" \
                    'any(.[]; ((.event == "sessionEnd" or .event == "sessionCloseAuthorized") and ((.session_id // "") == $sid)))' \
                    "$_LATEST_ARCHIVE" > /dev/null 2> /dev/null; then
                _FOUND_SESSION_END=true
            fi
        fi

        _AUTH_FLAG="${state_dir}/SESSION_CLOSE_AUTHORIZED.flag"
        if [ "$_FOUND_SESSION_END" = "false" ] && [ -f "$_AUTH_FLAG" ]; then
            _FLAG_SID="$(jq -r '.session_id // ""' "$_AUTH_FLAG" 2> /dev/null || echo '')"
            if [ "$_FLAG_SID" = "${PREV_SESSION_ID}" ]; then
                _FOUND_SESSION_END=true
            fi
        fi

        [ "$_FOUND_SESSION_END" = "false" ] && PREV_ABRUPT_CLOSE=true
    fi

    if [ "$PREV_ABRUPT_CLOSE" = "true" ]; then
        if [ "${PREV_CLOSE_KEY_VALIDATED:-false}" = "true" ]; then
            PREV_CLOSE_MODE="key_validated"
        else
            PREV_CLOSE_MODE="abrupt_no_key"
        fi
    elif [ -n "${PREV_SESSION_ID:-}" ] && [ "${PREV_SESSION_ID}" != "$session_id" ]; then
        PREV_CLOSE_MODE="clean"
        _AUDIT_TMP="${log_dir}/audit-${PREV_SESSION_ID:0:8}.jsonl"
        [ -f "$_AUDIT_TMP" ] || _AUDIT_TMP="${log_dir}/audit.jsonl"
        if [ -f "$_AUDIT_TMP" ] && jq -e --arg sid "${PREV_SESSION_ID}" '
            select(.event == "sessionReconnect")
            | ((.old_session_id // .session_id // "") == $sid or ((.session_id // "") == $sid))
        ' "$_AUDIT_TMP" > /dev/null 2> /dev/null; then
            PREV_CLOSE_MODE="abrupt_reconnect"
            PREV_RECONNECT_COUNT="$(jq -r --arg sid "${PREV_SESSION_ID}" '
                select(.event == "sessionReconnect")
                | ((.old_session_id // .session_id // "") == $sid or ((.session_id // "") == $sid))
                | 1
            ' "$_AUDIT_TMP" 2> /dev/null | wc -l | tr -d ' ' || echo 0)"
        fi
    fi

    if [ -f "${state_dir}/SESSION_CLOSE_AUTHORIZED.flag" ]; then
        _AUTH_SID="$(jq -r '.session_id // ""' "${state_dir}/SESSION_CLOSE_AUTHORIZED.flag" 2> /dev/null || echo '')"
        if [ -n "$_AUTH_SID" ] && [ "$_AUTH_SID" != "$session_id" ]; then
            rm -f "${state_dir}/SESSION_CLOSE_AUTHORIZED.flag" 2> /dev/null || true
        fi
    fi

    export PREV_ABRUPT_CLOSE PREV_CLOSE_MODE PREV_RECONNECT_COUNT
    return 0
}

session_start_prepare_recovery_alerts() {
    local per_ctx_file="${1:-}"
    local timestamp="${2:-}"
    local session_date="${3:-}"
    local prev_close_mode="${4:-ok}"
    local prev_session_id="${5:-}"
    local prev_checkpoint_ts="${6:-}"
    local prev_reconnect_count="${7:-0}"

    RECOVERY_ALERTS=()
    RECOVERY_ALERTS_REQUIRE_KICKOFF="false"

    case "$prev_close_mode" in
        abrupt_no_key)
            RECOVERY_ALERTS+=("🚨 ANOMALY DETECTED: Previous session ended WITHOUT close-key authorization")
            RECOVERY_ALERTS+=("REASON: Either crash, timeout, or unauthorized closure attempt (BUG-79 pattern)")
            RECOVERY_ALERTS+=("IMPACT: Agent cannot resume from exact previous state; some context may be lost")
            RECOVERY_ALERTS+=("ACTION: Will require Template E+ (Multi-Decision Checkpoint) before proceeding")
            RECOVERY_ALERTS_REQUIRE_KICKOFF="true"
            ;;
        key_validated)
            RECOVERY_ALERTS+=("⚠️  WARNING: Previous session had close_key validated but session-close.sh incomplete")
            RECOVERY_ALERTS+=("REASON: BUG-80 pattern — key validation ordered incorrectly")
            RECOVERY_ALERTS+=("IMPACT: Session may have been marked authorized but final shutdown did not occur")
            RECOVERY_ALERTS+=("ACTION: Proceeding normally but monitoring for re-occurrence")
            RECOVERY_ALERTS_REQUIRE_KICKOFF="false"
            ;;
        abrupt_reconnect)
            RECOVERY_ALERTS+=("ℹ️   INFO: Previous session ended via network reconnection (${prev_reconnect_count} reconnects detected)")
            RECOVERY_ALERTS+=("REASON: Normal expected behavior during VS Code connection loss")
            RECOVERY_ALERTS+=("IMPACT: Context preserved automatically by inline_restart mechanism")
            RECOVERY_ALERTS+=("ACTION: No special action required — informational only")
            RECOVERY_ALERTS_REQUIRE_KICKOFF="false"
            ;;
        clean)
            RECOVERY_ALERTS_REQUIRE_KICKOFF="false"
            ;;
        ok)
            RECOVERY_ALERTS_REQUIRE_KICKOFF="false"
            ;;
    esac

    _ALERTS_JSON="[]"
    if [ ${#RECOVERY_ALERTS[@]} -gt 0 ]; then
        _ALERTS_JSON="$(printf '%s\n' "${RECOVERY_ALERTS[@]}" | jq -R '.' | jq -s '.' 2> /dev/null || echo '[]')"
    fi

    if [ -f "$per_ctx_file" ] && command -v jq > /dev/null 2>&1; then
        _RECOVERY_TMP="$(mktemp)"
        local recovery_lock="${per_ctx_file}.lock"
        _RECOVERY_TS="${timestamp:-$session_date}"
        {
            if command -v flock > /dev/null 2>&1; then
                exec 8> "$recovery_lock"
                flock -x -w "${HOOKS_FLOCK_TIMEOUT:-5}" 8 2> /dev/null || true
            fi

            if jq \
                --arg close_mode "${prev_close_mode:-ok}" \
                --arg prev_sid "${prev_session_id:-}" \
                --arg prev_ts "${prev_checkpoint_ts:-}" \
                --arg detected_at "$_RECOVERY_TS" \
                --arg alerts_req "$RECOVERY_ALERTS_REQUIRE_KICKOFF" \
                --argjson alerts "$_ALERTS_JSON" \
                '.recovery = ((.recovery // {}) + {
                    close_mode: $close_mode,
                    prev_session_id: $prev_sid,
                    prev_session_ts: $prev_ts,
                    alerts: $alerts,
                    alerts_require_kickoff: ($alerts_req == "true"),
                    detected_at: $detected_at
                })' \
                "$per_ctx_file" > "$_RECOVERY_TMP" 2> /dev/null; then
                mv "$_RECOVERY_TMP" "$per_ctx_file" 2> /dev/null \
                    || {
                        cp "$_RECOVERY_TMP" "$per_ctx_file" 2> /dev/null
                        rm -f "$_RECOVERY_TMP"
                    }
            else
                rm -f "$_RECOVERY_TMP"
            fi
        }
    fi

    export RECOVERY_ALERTS_REQUIRE_KICKOFF
    return 0
}
