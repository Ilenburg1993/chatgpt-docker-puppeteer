#!/usr/bin/env bash
# shellcheck shell=bash
set -euo pipefail

# Lógica de domínio do hook preCompact.
# Pré-requisito: common.sh carregado pelo script entrypoint.
run_pre_compact_hook() {
    local hook_dir="${1:-}"
    local log_dir="${hook_dir}/logs"
    local state_dir="${hook_dir}/state"
    local ctx_file="${state_dir}/session-context.json"

    mkdir -p "$log_dir"

    # F1.2: runtime input padronizado via helper canônico
    if command -v resolve_hook_runtime_input > /dev/null 2>&1; then
        resolve_hook_runtime_input
        SESSION_ID="${SESSION_ID_PAYLOAD:-}"
    else
        INPUT="$(cat 2> /dev/null || true)"
        TIMESTAMP="$(echo "$INPUT" | jq -r '.timestamp // ""' 2> /dev/null || echo '')"
        SESSION_ID="$(echo "$INPUT" | jq -r '.session_id // ""' 2> /dev/null || echo '')"
        NOW_ISO="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo "$TIMESTAMP")"
    fi
    [ -n "${NOW_ISO:-}" ] || NOW_ISO="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo "$TIMESTAMP")"
    [ -n "$TIMESTAMP" ] || TIMESTAMP="$NOW_ISO"

    # UPG-AUDIT-01: resolve per-session paths
    if command -v resolve_audit_file > /dev/null 2>&1 && [ -n "${SESSION_ID:-}" ]; then
        _SID_SHORT="${SESSION_ID:0:8}"
        ctx_file="$(resolve_ctx_file "$_SID_SHORT")"
        AUDIT_FILE="$(resolve_audit_file "$_SID_SHORT")"
        mkdir -p "$(dirname "$ctx_file")" "$(dirname "$AUDIT_FILE")" 2> /dev/null || true
    fi

    # ── Guard canônico: reconcilia session_id no runtime comum ────────────────────
    if [ -f "$ctx_file" ] && [ ! -s "$ctx_file" ]; then
        echo "[guard] session-context.json vazio — guard desabilitado (aguardando auto-recovery)" >&2
    fi
    if [ -f "$ctx_file" ] && [ -s "$ctx_file" ] && [ -n "$SESSION_ID" ] \
        && command -v reconcile_session_id_guard_prepost > /dev/null 2>&1; then
        set +e
        _RECONCILED_SID="$(reconcile_session_id_guard_prepost "$SESSION_ID" "preCompact" "$TIMESTAMP" "pre-compact.sh")"
        _RECONCILE_RC=$?
        set -e
        if [ "$_RECONCILE_RC" -eq 10 ]; then
            return 0
        fi
        if [ -n "${_RECONCILED_SID:-}" ]; then
            SESSION_ID="$_RECONCILED_SID"
        fi
    fi

    # Cria checkpoint ANTES da compactação (preserva estado atual)
    if [ -x "$hook_dir/scripts/session-checkpoint.sh" ]; then
        bash "$hook_dir/scripts/session-checkpoint.sh" 2> /dev/null || true
    fi

    # Loga evento de compactação no audit.jsonl
    jq -cn \
        --arg event "preCompact" \
        --arg sid "$SESSION_ID" \
        --arg ts "$NOW_ISO" \
        '{
            event:      $event,
            session_id: $sid,
            timestamp:  $ts,
            message:    "Contexto será compactado — possível perda de memória de curto prazo"
        }' >> "$AUDIT_FILE"

    # Incrementa contador de compactações no session-context.json
    # F1: escrita transacional via ctx_update (com lock canônico)
    if [ -f "$ctx_file" ] && [ -s "$ctx_file" ] && command -v ctx_update > /dev/null 2>&1; then
        ctx_update '.session_stats.compaction_count = ((.session_stats.compaction_count // 0) + 1)' \
            2> /dev/null || true
    fi

    echo "[compact] Compactação de contexto iminente — checkpoint criado" >&2
    return 0
}
