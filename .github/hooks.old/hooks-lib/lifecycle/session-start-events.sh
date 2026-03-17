#!/usr/bin/env bash
# shellcheck shell=bash
set -euo pipefail

# Helpers de emissão de eventos para session-start-lib.

session_start_emit_bootstrap_events() {
    local audit_file="${1:-}"
    local session_id="${2:-}"
    local timestamp="${3:-}"
    local session_date="${4:-}"
    local source="${5:-new}"
    local trigger_kind="${6:-new_chat_or_panel_activation}"
    local cwd="${7:-}"
    local close_key="${8:-}"
    local initial_section_id="${9:-}"
    local logical_session_number="${10:-1}"
    local close_key_for_audit="$close_key"
    local close_key_hash=''

    if [ -n "$close_key" ]; then
        close_key_hash="$(printf '%s' "$close_key" | sha256sum 2> /dev/null | cut -c1-12 || true)"
    fi

    if [ "${HOOKS_AUDIT_LOG_CLOSE_KEY_PLAINTEXT:-false}" != "true" ] && [ -n "$close_key_for_audit" ]; then
        close_key_for_audit='ENCERRAR-********'
    fi

    jq -cn \
        --arg event "sessionStart" \
        --arg sid "$session_id" \
        --arg ts "${timestamp:-$session_date}" \
        --arg source "$source" \
        --arg trigger_kind "$trigger_kind" \
        --arg cwd "$cwd" \
        --arg close_key "$close_key_for_audit" \
        --arg close_key_hash "$close_key_hash" \
        --arg section_id "$initial_section_id" \
        --argjson logical_num "$logical_session_number" \
        '{
            event: $event,
            session_id: $sid,
            timestamp: $ts,
            source: $source,
            trigger_kind: $trigger_kind,
            semantic_note: "sessionStart representa abertura/reativacao de sessao, nao inicio de TURN",
            cwd: $cwd,
            close_key: $close_key,
            close_key_hash: (if $close_key_hash == "" then null else $close_key_hash end),
            section_id: $section_id,
            logical_session_number: $logical_num,
            message: "Hook sessionStart processado — sessão inicializada"
        }' >> "$audit_file"

    jq -cn \
        --arg event "sectionStart" \
        --arg sid "$session_id" \
        --arg ts "$timestamp" \
        --arg name "início" \
        --arg section_id "$initial_section_id" \
        '{event: $event, session_id: $sid, timestamp: $ts, section_name: $name,
          section_id: $section_id,
          section_number: 1, turn_number: 1, description: null, prev_section: null,
          auto_open: true}' \
        >> "$audit_file"

    return 0
}
