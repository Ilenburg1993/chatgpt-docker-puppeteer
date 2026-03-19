#!/usr/bin/env bash
# session-close-lib.sh — Lógica de encerramento autorizado de sessão
# Chamado internamente por stop.sh (NÃO diretamente pelo agente via terminal)
# Sourceado por scripts/session-close.sh

# shellcheck source=common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
# shellcheck source=hook-payload-api.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hook-payload-api.sh"

export LANG=C.UTF-8

# ---------------------------------------------------------------------------
# Gera session-final-report.md a partir do state + tail do audit.jsonl
# ---------------------------------------------------------------------------
_generate_final_report() {
    local state
    state=$(cat "$STATE_FILE")

    local session_id started_at ended_at
    local turn_count turn_authorized turn_unauthorized subturn_total tools_total

    session_id=$(printf '%s' "$state" | jq -r '.vs_code_session_id // "unknown"')
    started_at=$(printf '%s' "$state" | jq -r '.started_at // "unknown"')
    ended_at=$(printf '%s' "$state" | jq -r '.ended_at // "unknown"')
    turn_count=$(printf '%s' "$state" | jq -r '.session_stats.turn_count // 0')
    turn_authorized=$(printf '%s' "$state" | jq -r '.session_stats.turn_authorized // 0')
    turn_unauthorized=$(printf '%s' "$state" | jq -r '.session_stats.turn_unauthorized // 0')
    subturn_total=$(printf '%s' "$state" | jq -r '.session_stats.subturn_total // 0')
    tools_total=$(printf '%s' "$state" | jq -r '.session_stats.tools_total // 0')
    local consec
    consec=$(printf '%s' "$state" | jq -r '.compliance.consecutive_unauthorized // 0')

    local report_file="$STATE_DIR/session-final-report.md"

    {
        printf '# Session Final Report — %s\n\n' "$(date -u +%Y-%m-%d)"
        printf '**Session ID**: %s\n' "$session_id"
        printf '**Iniciada em**: %s\n' "$started_at"
        printf '**Encerrada em**: %s\n\n' "$ended_at"
        printf '## Estatísticas\n\n'
        printf '- Turnos totais: %s\n' "$turn_count"
        printf '- Turnos autorizados: %s\n' "$turn_authorized"
        printf '- Turnos NÃO-autorizados: %s\n' "$turn_unauthorized"
        printf '- SUBTURNs totais: %s\n' "$subturn_total"
        printf '- Ferramentas invocadas: %s\n' "$tools_total"
        printf '- Violações consecutivas (no encerramento): %s\n\n' "$consec"
        printf '## Últimos 10 eventos (audit.jsonl)\n\n```\n'
        if [ -f "$AUDIT_FILE" ]; then
            tail -10 "$AUDIT_FILE"
        else
            printf '(nenhum evento registrado)\n'
        fi
        printf '```\n'
    } > "$report_file"
}

# ---------------------------------------------------------------------------
# main — encerramento autorizado de sessão
# Sem stdin (chamado internamente, não pela plataforma VS Code)
# ---------------------------------------------------------------------------
session_close_main() {
    if ! state_exists; then
        exit 0
    fi

    SESSION_ID=$(read_field ".session_id")
    export SESSION_ID

    # --- Passo 0: Idempotência — se já foi encerrada, nada a fazer ---
    local ended_at
    ended_at=$(read_field ".ended_at")
    if [ -n "$ended_at" ] && [ "$ended_at" != "null" ]; then
        hook_log_audit "session_close_noop"
        exit 0
    fi

    # --- Passo 1: Guard — pending_session_close deve ser true ---
    local pending
    pending=$(read_field ".pending_session_close")
    if [ "$pending" != "true" ]; then
        hook_log_audit "session_close_unexpected"
        exit 0
    fi

    # --- Passo 2: Registra ended_at ---
    update_state "ended_at" "$(now_iso)"

    # --- Passo 3: Reseta pending_session_close ---
    update_state_bool "pending_session_close" "false"

    # --- Passo 4: Loga sessionEnd ---
    local turn_count
    turn_count=$(read_field ".session_stats.turn_count")
    hook_log_audit "sessionEnd" "turn_count" "${turn_count:-0}"

    # --- Passo 5: Gera relatório final ---
    _generate_final_report

    exit 0
}

main() { session_close_main; }
