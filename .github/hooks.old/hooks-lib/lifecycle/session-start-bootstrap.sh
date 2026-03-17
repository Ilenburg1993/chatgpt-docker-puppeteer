#!/usr/bin/env bash
# shellcheck shell=bash
set -euo pipefail

# Helpers de bootstrap de metadados de sessão para session-start-lib.

session_start_prepare_session_metadata() {
    local session_id="${1:-}"
    local state_dir="${2:-}"
    local log_dir="${3:-}"

    SESSION_DATE="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo 'unknown')"
    SESSION_DATE_SHORT="$(date -u '+%Y%m%d_%H%M%S' 2> /dev/null || echo 'unknown')"

    SID_SHORT="${session_id:0:8}"
    PER_CTX_FILE="$state_dir/session-context-${SID_SHORT}.json"
    PER_AUDIT_FILE="$log_dir/audit-${SID_SHORT}.jsonl"

    CLOSE_KEY="ENCERRAR-$(openssl rand -hex 4 2> /dev/null | tr '[:lower:]' '[:upper:]' || printf '%s%s' "$(date +%s%N 2> /dev/null || date +%s)" "$$" | sha256sum | head -c 8 | tr '[:lower:]' '[:upper:]')"

    INITIAL_SECTION_ID="$(uuidgen 2> /dev/null || printf 'sect_%s_%s' "$(date +%s)" "$$")"
    INITIAL_TURN_ID="$(uuidgen 2> /dev/null || printf 'turn_%s_%s' "$(date +%s)" "$$")"

    export SESSION_DATE SESSION_DATE_SHORT SID_SHORT PER_CTX_FILE PER_AUDIT_FILE
    export CLOSE_KEY INITIAL_SECTION_ID INITIAL_TURN_ID
    return 0
}
