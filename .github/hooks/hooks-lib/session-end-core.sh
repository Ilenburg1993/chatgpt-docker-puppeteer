#!/bin/bash
# shellcheck shell=bash
# session-end-core.sh — núcleo crítico de lifecycle do session-end

session_end_close_active_section() {
    local session_id="${1:-}"
    local ctx_file="${2:-}"
    local audit_file="${3:-}"

    [ -n "$session_id" ] || return 1
    [ -n "$ctx_file" ] || return 1
    [ -n "$audit_file" ] || return 1

    local close_section_name=""
    local close_section_started=""
    local close_section_turn_start=0
    local close_section_number=0
    local close_turn_count=0
    local close_section_id=""

    if [ -f "$ctx_file" ]; then
        close_section_name="$(jq -r '.current_section.name // ""' "$ctx_file" 2> /dev/null || echo '')"
        close_section_started="$(jq -r '.current_section.started_at // ""' "$ctx_file" 2> /dev/null || echo '')"
        close_section_turn_start="$(jq -r '.current_section.turn_start // 0' "$ctx_file" 2> /dev/null || echo 0)"
        close_section_number="$(jq -r '.current_section.section_number // 0' "$ctx_file" 2> /dev/null || echo 0)"
        close_turn_count="$(jq -r '.session_stats.turn_count // 0' "$ctx_file" 2> /dev/null || echo 0)"
        close_section_id="$(jq -r '.current_section.section_id // ""' "$ctx_file" 2> /dev/null || echo '')"
    fi

    if [ -z "$close_section_name" ]; then
        return 0
    fi

    local close_now_iso
    close_now_iso="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
    local close_current_turn=$((close_turn_count + 1))

    local close_duration_s=0
    if [ -n "$close_section_started" ]; then
        local ep_start
        if date -d "$close_section_started" '+%s' > /dev/null 2>&1; then
            ep_start="$(date -d "$close_section_started" '+%s' 2> /dev/null || echo 0)"
        else
            ep_start="$(date -j -f '%Y-%m-%dT%H:%M:%SZ' "$close_section_started" '+%s' 2> /dev/null || echo 0)"
        fi
        local ep_now
        ep_now="$(date -u '+%s' 2> /dev/null || echo 0)"
        if [ "$ep_now" -gt "$ep_start" ] 2> /dev/null; then
            close_duration_s=$((ep_now - ep_start))
        fi
    fi

    local close_turns_covered=$((close_current_turn - close_section_turn_start))
    if [ "$close_turns_covered" -lt 1 ]; then
        close_turns_covered=1
    fi

    jq -cn \
        --arg event "sectionEnd" \
        --arg sid "$session_id" \
        --arg ts "$close_now_iso" \
        --arg name "$close_section_name" \
        --arg reason "session_ended" \
        --arg started_at "$close_section_started" \
        --arg section_id "${close_section_id:-}" \
        --argjson turn_start "$close_section_turn_start" \
        --argjson turn_end "$close_current_turn" \
        --argjson turns_covered "$close_turns_covered" \
        --argjson duration_s "$close_duration_s" \
        --argjson section_number "$close_section_number" \
        '{
            event:          $event,
            session_id:     $sid,
            timestamp:      $ts,
            section_name:   $name,
            section_number: $section_number,
            section_id:     (if $section_id == "" then null else $section_id end),
            reason:         $reason,
            started_at:     $started_at,
            turn_start:     $turn_start,
            turn_end:       $turn_end,
            turns_covered:  $turns_covered,
            duration_s:     $duration_s
        }' >> "$audit_file"

    if [ -f "$ctx_file" ] && command -v sponge > /dev/null 2>&1; then
        jq '.current_section = {name: null, started_at: null, turn_start: null, description: null, section_number: null, section_id: null}' \
            "$ctx_file" | sponge "$ctx_file" 2> /dev/null || true
    fi

    return 0
}

session_end_finalize_core_termination() {
    local session_id="${1:-}"
    local reason="${2:-complete}"
    local ctx_file="${3:-}"
    local audit_file="${4:-}"
    local now_ms="${5:-0}"
    local cwd="${6:-}"
    local duration_s="${7:-0}"
    local tools_count="${8:-0}"
    local errors_count="${9:-0}"
    local state_dir="${10:-}"

    [ -n "$session_id" ] || return 1
    [ -n "$ctx_file" ] || return 1
    [ -n "$audit_file" ] || return 1
    [ -n "$state_dir" ] || return 1

    if [ -f "$ctx_file" ] && command -v sponge > /dev/null 2>&1; then
        jq --arg ts "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" --arg reason "$reason" \
            '.session.ended_at = $ts | .session.end_reason = $reason' \
            "$ctx_file" | sponge "$ctx_file" 2> /dev/null || true
    fi

    if [ -f "$ctx_file" ]; then
        local n4_close_validated
        n4_close_validated="$(jq -r '.session.close_key_validated // false' "$ctx_file" 2> /dev/null || echo 'false')"
        local n4_close_mode="$reason"
        local n4_detected_anomaly=false
        local n4_anomaly_type=""

        case "$reason" in
            complete)
                if [ "$n4_close_validated" = "true" ]; then
                    n4_close_mode="ok"
                else
                    n4_close_mode="complete_no_formality"
                fi
                ;;
            abort)
                if [ "$n4_close_validated" != "true" ]; then
                    n4_detected_anomaly=true
                    n4_anomaly_type="abrupt_abort_no_auth"
                    n4_close_mode="abrupt_abort_no_auth"
                else
                    n4_close_mode="abrupt_abort_authorized"
                fi
                ;;
            timeout)
                n4_detected_anomaly=true
                n4_anomaly_type="timeout_session_boundary"
                n4_close_mode="timeout"
                ;;
            error)
                if [ "$n4_close_validated" != "true" ]; then
                    n4_detected_anomaly=true
                    n4_anomaly_type="abrupt_error_no_auth"
                    n4_close_mode="abrupt_error_no_auth"
                else
                    n4_close_mode="error_authorized"
                fi
                ;;
            user_exit | *)
                if [ "$n4_close_validated" != "true" ]; then
                    n4_detected_anomaly=true
                    n4_anomaly_type="abrupt_user_exit_no_auth"
                    n4_close_mode="abrupt_user_exit_no_auth"
                else
                    n4_close_mode="user_exit_authorized"
                fi
                ;;
        esac

        jq --arg close_mode "$n4_close_mode" \
            '.session.close_mode = $close_mode' \
            "$ctx_file" | sponge "$ctx_file" 2> /dev/null || true

        if [ "$n4_detected_anomaly" = "true" ]; then
            jq -cn \
                --arg event "sessionEnd_unauthorized_termination_detected" \
                --arg sid "$session_id" \
                --arg ts "$now_ms" \
                --arg reason "$reason" \
                --arg close_mode "$n4_close_mode" \
                --arg anomaly_type "$n4_anomaly_type" \
                --arg close_validated "$n4_close_validated" \
                '{
                    event:              $event,
                    session_id:         $sid,
                    timestamp:          $ts,
                    reason:             $reason,
                    close_mode:         $close_mode,
                    anomaly_type:       $anomaly_type,
                    close_key_validated: $close_validated,
                    severity:           "CRITICAL",
                    message:            ("Session encerrada de forma não autorizada: " + $anomaly_type + " — recovery necessária na próxima sessão")
                }' >> "$audit_file" 2> /dev/null || true
        else
            jq -cn \
                --arg event "sessionEnd_validated" \
                --arg sid "$session_id" \
                --arg ts "$now_ms" \
                --arg close_mode "$n4_close_mode" \
                --arg reason "$reason" \
                '{
                    event:      $event,
                    session_id: $sid,
                    timestamp:  $ts,
                    reason:     $reason,
                    close_mode: $close_mode,
                    message:    ("Session encerrada normalmente com close_mode: " + $close_mode)
                }' >> "$audit_file" 2> /dev/null || true
        fi
    fi

    jq -cn \
        --arg event "sessionEnd" \
        --arg sid "$session_id" \
        --arg ts "$now_ms" \
        --arg cwd "$cwd" \
        --arg reason "$reason" \
        --argjson dur "$duration_s" \
        --argjson tools "$tools_count" \
        --argjson errors "$errors_count" \
        '{
            event:            $event,
            session_id:       $sid,
            timestamp:        $ts,
            cwd:              $cwd,
            reason:           $reason,
            duration_s:       $dur,
            tools_used_count: $tools,
            errors_count:     $errors
        }' >> "$audit_file"

    local no_key_flag_file="$state_dir/SESSION_CLOSE_NO_KEY.flag"
    local turn_count_now
    turn_count_now="$(jq -r '.session_stats.turn_count // 0' "$ctx_file" 2> /dev/null || echo 0)"
    local close_key_validated=false

    if [ -f "$ctx_file" ]; then
        close_key_validated="$(jq -r '.session.close_key_validated // false' "$ctx_file" 2> /dev/null || echo false)"
    fi

    if [ "$close_key_validated" = "true" ]; then
        rm -f "$no_key_flag_file" 2> /dev/null || true
        jq -cn \
            --arg sid "$session_id" \
            --arg ts "$now_ms" \
            --arg reason "$reason" \
            '{event: "sessionEnd_authorized_with_key", session_id: $sid, timestamp: $ts, reason: $reason}' \
            >> "$audit_file"
    else
        jq -cn \
            --arg sid "$session_id" \
            --arg ts "$now_ms" \
            --arg reason "$reason" \
            --argjson turns "$turn_count_now" \
            '{
                event:       "sessionEnd_no_key",
                session_id:  $sid,
                timestamp:   $ts,
                reason:      $reason,
                turn_count:  $turns
            }' > "$no_key_flag_file"

        jq -cn \
            --arg sid "$session_id" \
            --arg ts "$now_ms" \
            --arg reason "$reason" \
            --argjson turns "$turn_count_now" \
            '{event: "sessionEnd_no_key", session_id: $sid, timestamp: $ts, reason: $reason, turn_count: $turns}' \
            >> "$audit_file"
    fi

    return 0
}
