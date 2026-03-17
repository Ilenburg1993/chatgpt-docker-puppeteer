#!/bin/bash

# F7.7 shim canônico: root delega para lifecycle/session-end-aux.sh.
if [[ "${HOOKS_LIB_BYPASS_SESSION_END_AUX_SHIM:-0}" != "1" ]]; then
    _hooks_lib_root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    # shellcheck disable=SC1091
    source "${_hooks_lib_root_dir}/lifecycle/session-end-aux.sh"
    return 0
fi

# shellcheck shell=bash
# session-end-aux.sh — pós-processamento auxiliar (fail-open) de session-end

session_end_generate_and_mirror_summary() {
    local session_id="${1:-}"
    local session_date_short="${2:-}"
    local start_ts_ms="${3:-0}"
    local end_ts_ms="${4:-0}"
    local session_reason="${5:-complete}"
    local scripts_dir="${6:-}"
    local log_dir="${7:-}"
    local docs_sessions_dir="${8:-}"
    local session_date_daily="${9:-}"

    [ -n "$scripts_dir" ] || return 1
    [ -n "$log_dir" ] || return 1
    [ -n "$docs_sessions_dir" ] || return 1
    [ -n "$session_date_daily" ] || return 1

    local summary_md=""
    local summary_script="$scripts_dir/generate-session-summary.sh"
    if [ -f "$summary_script" ] && [ -x "$summary_script" ]; then
        summary_md="$(SESSION_ID="$session_id" \
            SESSION_DATE_SHORT="$session_date_short" \
            START_TS="$start_ts_ms" \
            END_TS="$end_ts_ms" \
            SESSION_REASON="$session_reason" \
            bash "$summary_script" 2> /dev/null || echo '## Resumo indisponível (erro no helper)')"
    fi

    if [ -n "$summary_md" ]; then
        local local_summary="$log_dir/session-${session_date_short}.md"
        {
            echo "# Relatório de Sessão"
            echo ""
            echo "$summary_md"
        } > "$local_summary"
    fi

    local daily_report="$docs_sessions_dir/sessions-${session_date_daily}.md"
    if [ ! -f "$daily_report" ]; then
        cat > "$daily_report" << HEADER
# Sessões de ${session_date_daily}

> Gerado automaticamente pelo hook \`sessionEnd\` do Copilot.
> Cada entrada abaixo representa uma sessão encerrada neste dia.

HEADER
    fi

    if [ -n "$summary_md" ]; then
        echo "$summary_md" >> "$daily_report"
    fi

    return 0
}

session_end_append_pending_task_note() {
    local state_dir="${1:-}"
    local session_id="${2:-}"
    local session_date_daily="${3:-}"
    local reason="${4:-complete}"
    local tools_count="${5:-0}"

    [ -n "$state_dir" ] || return 1
    local tasks_file="$state_dir/pending-tasks.md"
    if [ -f "$tasks_file" ]; then
        local session_note="<!-- session-end: ${session_id} | ${session_date_daily} | ${reason} | ${tools_count} tools -->"
        if ! grep -qF "$session_id" "$tasks_file" 2> /dev/null; then
            {
                echo ""
                echo "$session_note"
            } >> "$tasks_file"
        fi
    fi

    return 0
}
