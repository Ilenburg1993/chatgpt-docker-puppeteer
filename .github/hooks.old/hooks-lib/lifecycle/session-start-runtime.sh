#!/usr/bin/env bash
# shellcheck shell=bash
set -euo pipefail

# Helpers de runtime para reduzir acoplamento inline em session-start-lib.

session_start_load_domain_modules() {
    local hook_dir="${1:-}"
    if [ -z "$hook_dir" ]; then
        return 1
    fi

    if ! declare -F session_start_compute_logical_session_number > /dev/null 2>&1; then
        # shellcheck disable=SC1091
        source "$hook_dir/hooks-lib/lifecycle/session-start-core.sh"
    fi

    if ! declare -F session_start_collect_backlog_and_findings > /dev/null 2>&1; then
        # shellcheck disable=SC1091
        source "$hook_dir/hooks-lib/lifecycle/session-start-aux.sh"
    fi

    return 0
}

session_start_run_housekeeping_scripts() {
    local hook_dir="${1:-}"
    if [ -z "$hook_dir" ]; then
        return 1
    fi

    if [ -x "$hook_dir/scripts/watchdog.sh" ]; then
        if command -v run_aux_block > /dev/null 2>&1; then
            run_aux_block "session-start:watchdog" "${HOOKS_AUX_TIMEOUT_S:-5}" \
                bash "$hook_dir/scripts/watchdog.sh" --quiet > /dev/null 2>&1 || true
        else
            bash "$hook_dir/scripts/watchdog.sh" --quiet 2> /dev/null || true
        fi
    fi

    if [ -x "$hook_dir/scripts/rotate-audit.sh" ]; then
        if command -v run_aux_block > /dev/null 2>&1; then
            run_aux_block "session-start:rotate-audit" "${HOOKS_AUX_TIMEOUT_S:-5}" \
                bash "$hook_dir/scripts/rotate-audit.sh" > /dev/null 2>&1 || true
        else
            bash "$hook_dir/scripts/rotate-audit.sh" 2> /dev/null || true
        fi
    fi

    return 0
}

session_start_load_support_modules() {
    local hook_dir="${1:-}"
    if [ -z "$hook_dir" ]; then
        return 1
    fi

    if ! declare -F session_start_find_previous_checkpoint > /dev/null 2>&1; then
        # shellcheck disable=SC1091
        source "$hook_dir/hooks-lib/lifecycle/session-start-recovery.sh"
    fi

    if ! declare -F session_start_parse_hook_input > /dev/null 2>&1; then
        # shellcheck disable=SC1091
        source "$hook_dir/hooks-lib/lifecycle/session-start-input.sh"
    fi

    if ! declare -F session_start_prepare_session_metadata > /dev/null 2>&1; then
        # shellcheck disable=SC1091
        source "$hook_dir/hooks-lib/lifecycle/session-start-bootstrap.sh"
    fi

    if ! declare -F session_start_emit_runtime_banner > /dev/null 2>&1; then
        # shellcheck disable=SC1091
        source "$hook_dir/hooks-lib/lifecycle/session-start-observability.sh"
    fi

    if ! declare -F session_start_write_briefing_base > /dev/null 2>&1; then
        # shellcheck disable=SC1091
        source "$hook_dir/hooks-lib/lifecycle/session-start-briefing.sh"
    fi

    if ! declare -F session_start_emit_bootstrap_events > /dev/null 2>&1; then
        # shellcheck disable=SC1091
        source "$hook_dir/hooks-lib/lifecycle/session-start-events.sh"
    fi

    if ! declare -F session_start_prepare_violation_state > /dev/null 2>&1; then
        # shellcheck disable=SC1091
        source "$hook_dir/hooks-lib/lifecycle/session-start-violations.sh"
    fi

    return 0
}
