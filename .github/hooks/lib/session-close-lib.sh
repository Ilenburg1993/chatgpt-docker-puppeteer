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

    # --- Passo 1b: GAP-32 — Revalida close_key: deve haver audit entry sessionCloseAuthorized ---
    local close_authorized=false
    if [ -f "$AUDIT_FILE" ]; then
        if grep -q '"sessionCloseAuthorized"' "$AUDIT_FILE" 2> /dev/null; then
            close_authorized=true
        fi
    fi
    if [ "$close_authorized" != "true" ]; then
        hook_log_audit "session_close_no_key_validation"
        # Limpa pending_session_close para evitar reentrada em loops futuros
        update_state_bool "pending_session_close" "false"
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

    # --- Passo 6: Rotação do audit.jsonl (GAP-52) ---
    _rotate_audit_log

    exit 0
}

# ---------------------------------------------------------------------------
# _rotate_audit_log — renomeia audit.jsonl para audit-YYYYMMDD-HHMMSS.jsonl (GAP-52)
# Mantém apenas os últimos HOOKS_AUDIT_MAX_FILES (padrão: 5) arquivos históricos.
# ---------------------------------------------------------------------------
_rotate_audit_log() {
    if [ ! -f "$AUDIT_FILE" ]; then
        return 0
    fi

    local ts
    ts=$(date +%Y%m%d-%H%M%S 2> /dev/null || date +%s)
    local rotated="${AUDIT_FILE%.jsonl}-${ts}.jsonl"

    if mv -f "$AUDIT_FILE" "$rotated" 2> /dev/null; then
        hook_log_audit "audit_log_rotated" "file" "$(basename "$rotated")" >> "$AUDIT_FILE" || true
    fi

    # Manter apenas os últimos N arquivos históricos (padrão: 5)
    local max_files="${HOOKS_AUDIT_MAX_FILES:-5}"
    local audit_dir
    audit_dir="$(dirname "$AUDIT_FILE")"
    # Lista ordenada do mais antigo para o mais novo; remove além do limite
    local count
    count=$(find "$audit_dir" -maxdepth 1 -name 'audit-*.jsonl' 2> /dev/null | wc -l)
    if [ "${count:-0}" -gt "$max_files" ]; then
        find "$audit_dir" -maxdepth 1 -name 'audit-*.jsonl' 2> /dev/null \
            | sort | head -n $((count - max_files)) \
            | while IFS= read -r old_log; do
                rm -f "$old_log" 2> /dev/null || true
            done
    fi
}

main() { session_close_main; }
