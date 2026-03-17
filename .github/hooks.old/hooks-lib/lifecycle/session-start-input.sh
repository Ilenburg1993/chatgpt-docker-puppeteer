#!/usr/bin/env bash
# shellcheck shell=bash
set -euo pipefail

# Helpers de parsing de input para session-start-lib.

session_start_generate_uuid_fallback() {
    local generated=''
    generated="$(uuidgen 2> /dev/null | tr '[:upper:]' '[:lower:]' || true)"
    if [ -z "$generated" ] && command -v openssl > /dev/null 2>&1; then
        generated="$(openssl rand -hex 16 2> /dev/null | sed -E 's/^(.{8})(.{4})(.{4})(.{4})(.{12})$/\1-\2-\3-\4-\5/' || true)"
    fi
    if [ -z "$generated" ]; then
        generated="$(printf '%s-%s' "$(date +%s%N 2> /dev/null || date +%s)" "$$" | sha256sum | cut -c1-32 \
            | sed -E 's/^(.{8})(.{4})(.{4})(.{4})(.{12}).*$/\1-\2-\3-\4-\5/' || true)"
    fi

    printf '%s' "$generated"
    return 0
}

session_start_parse_hook_input() {
    local input_payload="${1:-}"

    TIMESTAMP="$(echo "$input_payload" | jq -r '.timestamp // ""' 2> /dev/null || echo '')"
    CWD="$(echo "$input_payload" | jq -r '.cwd // ""' 2> /dev/null || echo '')"
    SOURCE="$(echo "$input_payload" | jq -r '.source // "new"' 2> /dev/null || echo 'new')"

    SESSIONSTART_TRIGGER_KIND="new_chat_or_panel_activation"
    case "$SOURCE" in
        inline_restart)
            SESSIONSTART_TRIGGER_KIND="inline_restart_same_logical_session"
            ;;
        reconnect_rollover)
            SESSIONSTART_TRIGGER_KIND="reconnect_rollover_or_heal"
            ;;
        manual_recovery)
            SESSIONSTART_TRIGGER_KIND="manual_recovery"
            ;;
        auto_recovery)
            SESSIONSTART_TRIGGER_KIND="auto_recovery"
            ;;
    esac

    SESSION_ID_RAW="$(echo "$input_payload" | jq -r '.session_id // ""' 2> /dev/null || echo '')"
    SESSION_ID_INVALID=false
    SESSION_ID_SOURCE='payload'

    if [ -n "$SESSION_ID_RAW" ] && echo "$SESSION_ID_RAW" | grep -qiE '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'; then
        SESSION_ID="$(printf '%s' "$SESSION_ID_RAW" | tr '[:upper:]' '[:lower:]')"
    else
        [ -n "$SESSION_ID_RAW" ] && SESSION_ID_INVALID=true
        SESSION_ID_SOURCE='generated_uuid_fallback'
        SESSION_ID="$(session_start_generate_uuid_fallback)"
    fi

    export TIMESTAMP CWD SOURCE SESSIONSTART_TRIGGER_KIND SESSION_ID SESSION_ID_RAW SESSION_ID_INVALID SESSION_ID_SOURCE
    return 0
}
