#!/usr/bin/env bash
# shellcheck shell=bash
set -euo pipefail

# Helpers de observabilidade/output para session-start-lib.

session_start_emit_runtime_banner() {
    cat << 'EOF'
╔══════════════════════════════════════════════════════════════════╗
║           COPILOT — SESSÃO INICIADA — MODO ARQUITETO             ║
║  • Todos os prompts e ferramentas são auditados localmente        ║
║  • preToolUse: logging-only (nunca bloqueia)                      ║
║  • Briefing: .github/hooks/state/session-briefing.md             ║
╚══════════════════════════════════════════════════════════════════╝
EOF

    return 0
}

session_start_emit_backlog_summary() {
    local tasks_file="${1:-}"
    local count_alta="${2:-0}"
    local count_media="${3:-0}"
    local count_backlog="${4:-0}"
    local total_open="${5:-0}"
    local next_task="${6:-}"

    if [ -f "$tasks_file" ]; then
        echo ""
        echo "=== BACKLOG: ${count_alta} alta | ${count_media} média | ${count_backlog} backlog (total: ${total_open}) ==="
        if [ -n "$next_task" ]; then
            echo "→ Próxima (Alta): $next_task" | head -c 120
            echo ""
        fi
        echo "=== session-briefing.md gerado — LLM deve lê-lo como primeiro ato ==="
        echo ""
    fi

    return 0
}

session_start_emit_hook_output() {
    local briefing_file="${1:-}"
    local additional_context_limit="${HOOKS_SESSIONSTART_ADDITIONAL_CONTEXT_MAX_BYTES:-16000}"

    if ! [[ "$additional_context_limit" =~ ^[0-9]+$ ]] || [ "$additional_context_limit" -lt 1024 ]; then
        additional_context_limit=16000
    fi

    if [ -f "$briefing_file" ] && command -v jq > /dev/null 2>&1; then
        local briefing_condensed=""
        briefing_condensed="$(grep -v '^---$' "$briefing_file" 2> /dev/null \
            | grep -v '^$' \
            | head -150 \
            | grep -v 'Gerado automaticamente' || true)"

        local briefing_size="${#briefing_condensed}"
        if [ "$briefing_size" -gt "$additional_context_limit" ] 2> /dev/null; then
            briefing_condensed="${briefing_condensed:0:$additional_context_limit}"
            briefing_condensed+=$'\n\n[truncated: additionalContext limit reached]'
        fi

        if [ -n "$briefing_condensed" ]; then
            printf '%s\n' \
                "{\"hookSpecificOutput\":{\"hookEventName\":\"SessionStart\",\"additionalContext\":$(printf '%s' "$briefing_condensed" | jq -Rs .)}}" \
                >&3
        fi
    fi

    return 0
}
