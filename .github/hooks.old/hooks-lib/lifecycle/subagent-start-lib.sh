#!/usr/bin/env bash
# shellcheck shell=bash
set -euo pipefail

# Lógica de domínio do hook subagentStart.
# Pré-requisito: common.sh carregado pelo script entrypoint.
run_subagent_start_hook() {
    local hook_dir="${1:-}"
    local log_dir="${hook_dir}/logs"
    local state_dir="${hook_dir}/state"
    local ctx_file="${state_dir}/session-context.json"

    mkdir -p "$log_dir"

    # F1.2: runtime input padronizado via helper canônico
    if command -v resolve_hook_runtime_input > /dev/null 2>&1; then
        resolve_hook_runtime_input
    else
        INPUT="$(cat 2> /dev/null || true)"
        TIMESTAMP="$(echo "$INPUT" | jq -r '.timestamp // ""' 2> /dev/null || echo '')"
        SESSION_ID_PAYLOAD="$(echo "$INPUT" | jq -r '.session_id // ""' 2> /dev/null || echo '')"
        NOW_ISO="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo '')"
        # UPG-AUDIT-01: resolve per-session files se SESSION_ID_PAYLOAD disponível
        apply_per_session_paths "${SESSION_ID_PAYLOAD:-}" 2> /dev/null || true
    fi
    [ -n "${NOW_ISO:-}" ] || NOW_ISO="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo '')"
    [ -n "$TIMESTAMP" ] || TIMESTAMP="$NOW_ISO"

    # ── Guard canônico: reconcilia session_id no runtime comum ────────────────────
    if [ -f "$ctx_file" ] && [ ! -s "$ctx_file" ]; then
        echo "[guard] session-context.json vazio — guard desabilitado (aguardando auto-recovery)" >&2
    fi
    if [ -f "$ctx_file" ] && [ -s "$ctx_file" ] && [ -n "$SESSION_ID_PAYLOAD" ] \
        && command -v reconcile_session_id_guard_prepost > /dev/null 2>&1; then
        set +e
        _RECONCILED_SID="$(reconcile_session_id_guard_prepost "$SESSION_ID_PAYLOAD" "subagentStart" "$TIMESTAMP" "subagent-start.sh")"
        _RECONCILE_RC=$?
        set -e
        if [ "$_RECONCILE_RC" -eq 10 ]; then
            return 0
        fi
        if [ -n "${_RECONCILED_SID:-}" ]; then
            SESSION_ID_PAYLOAD="$_RECONCILED_SID"
        fi
    fi

    # Loga evento no audit.jsonl
    log_event "$(jq -cn \
        --arg event "subagentStart" \
        --arg sid "$SESSION_ID_PAYLOAD" \
        --arg ts "$TIMESTAMP" \
        '{
            event:      $event,
            session_id: $sid,
            timestamp:  $ts
        }')"

    # Incrementa contagem de subagentes no session-context.json
    # Também registra o timestamp de início para cálculo posterior de duration_s
    # F1: escrita transacional via ctx_update (com lock canônico)
    if [ -f "$ctx_file" ] && [ -s "$ctx_file" ] && command -v ctx_update > /dev/null 2>&1; then
        _START_TS="${TIMESTAMP:-$NOW_ISO}"
        ctx_update ".session_stats.subagent_calls = ((.session_stats.subagent_calls // 0) + 1) | .session_stats.last_subagent_start_ts = \"${_START_TS}\"" \
            2> /dev/null || true
    fi

    echo "[subagent] Subagente iniciado" >&2
    return 0
}
