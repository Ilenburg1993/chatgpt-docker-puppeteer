#!/usr/bin/env bash
# shellcheck shell=bash
set -euo pipefail

# Lógica de domínio do hook subagentStop.
# Pré-requisito: common.sh carregado pelo script entrypoint.
run_subagent_stop_hook() {
    local hook_dir="${1:-}"
    local log_dir="${hook_dir}/logs"
    local state_dir="${hook_dir}/state"
    local session_id=""
    local ctx_file="${state_dir}/session-context.json"

    mkdir -p "$log_dir" && chmod 700 "$log_dir"

    # F1.2: runtime input padronizado via helper canônico
    if command -v resolve_hook_runtime_input > /dev/null 2>&1; then
        resolve_hook_runtime_input
    else
        INPUT="$(cat 2> /dev/null || true)"
        TIMESTAMP="$(echo "$INPUT" | jq -r '.timestamp // ""' 2> /dev/null || echo '')"
        NOW_ISO="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo '')"
        SESSION_ID_PAYLOAD="$(echo "$INPUT" | jq -r '.session_id // ""' 2> /dev/null || echo '')"
    fi
    [ -n "${NOW_ISO:-}" ] || NOW_ISO="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo '')"
    [ -n "$TIMESTAMP" ] || TIMESTAMP="$NOW_ISO"

    # UPG-AUDIT-01: resolve per-session files se SESSION_ID_PAYLOAD disponível
    apply_per_session_paths "${SESSION_ID_PAYLOAD:-}" 2> /dev/null || true
    if [ -f "$ctx_file" ]; then
        session_id="$(jq -r '.session.id // ""' "$ctx_file" 2> /dev/null || echo '')"
    fi

    # ── Guard canônico: reconcilia session_id no runtime comum ────────────────────
    if [ -f "$ctx_file" ] && [ ! -s "$ctx_file" ]; then
        echo "[guard] session-context.json vazio — guard desabilitado (aguardando auto-recovery)" >&2
    fi
    if [ -f "$ctx_file" ] && [ -s "$ctx_file" ] && [ -n "$SESSION_ID_PAYLOAD" ] \
        && command -v reconcile_session_id_guard_prepost > /dev/null 2>&1; then
        set +e
        _RECONCILED_SID="$(reconcile_session_id_guard_prepost "$SESSION_ID_PAYLOAD" "subagentStop" "${TIMESTAMP:-$NOW_ISO}" "subagent-stop.sh")"
        _RECONCILE_RC=$?
        set -e
        if [ "$_RECONCILE_RC" -eq 10 ]; then
            return 0
        fi
        if [ -n "${_RECONCILED_SID:-}" ]; then
            SESSION_ID_PAYLOAD="$_RECONCILED_SID"
        fi
    fi

    if [ -f "$ctx_file" ]; then
        session_id="$(jq -r '.session.id // ""' "$ctx_file" 2> /dev/null || echo '')"
    fi

    # Extrai campos do payload do subagente (schema não documentado — tratamento defensivo)
    SUBAGENT_NAME="$(echo "$INPUT" | jq -r '.agentName // .subagent_name // .name // ""' 2> /dev/null || echo '')"
    SUBAGENT_RESULT="$(echo "$INPUT" | jq -r '.result // .status // ""' 2> /dev/null || echo '')"
    TOOL_USE_ID="$(echo "$INPUT" | jq -r '.tool_use_id // .toolUseId // ""' 2> /dev/null || echo '')"

    # Calcula duração do subagent usando seu timestamp de início (não last_tool.ts do pai)
    # BUG-77 FIX: Use last_subagent_start_ts registrado por subagent-start.sh
    # BUG-62 FIX: date -d é GNU-only; fallback para BSD (macOS)
    DURATION_S=0
    if [ -f "$ctx_file" ]; then
        # Preferência: last_subagent_start_ts (timestamp preciso do início do subagent)
        # Fallback: last_tool.ts (menos preciso, mas disponível)
        SUBAGENT_START_TS="$(jq -r '.session_stats.last_subagent_start_ts // .last_tool.ts // ""' "$ctx_file" 2> /dev/null || echo '')"
        if [ -n "$SUBAGENT_START_TS" ] && [ -n "$NOW_ISO" ]; then
            if date -d "$SUBAGENT_START_TS" '+%s' > /dev/null 2>&1; then
                START_S="$(date -d "$SUBAGENT_START_TS" '+%s' 2> /dev/null || echo 0)"
            else
                START_S="$(date -j -f '%Y-%m-%dT%H:%M:%SZ' "$SUBAGENT_START_TS" '+%s' 2> /dev/null || echo 0)"
            fi
            if date -d "$NOW_ISO" '+%s' > /dev/null 2>&1; then
                NOW_S="$(date -d "$NOW_ISO" '+%s' 2> /dev/null || echo 0)"
            else
                NOW_S="$(date -j -f '%Y-%m-%dT%H:%M:%SZ' "$NOW_ISO" '+%s' 2> /dev/null || echo 0)"
            fi
            if [ "$NOW_S" -gt "$START_S" ] 2> /dev/null; then
                DURATION_S=$((NOW_S - START_S))
            fi
        fi
    fi

    jq -cn \
        --arg event "subagentStop" \
        --arg sid "$session_id" \
        --arg ts "${TIMESTAMP:-$NOW_ISO}" \
        --arg agent_name "$SUBAGENT_NAME" \
        --arg result "$SUBAGENT_RESULT" \
        --arg tool_use_id "$TOOL_USE_ID" \
        --argjson duration_s "$DURATION_S" \
        '{
            event:        $event,
            session_id:   $sid,
            timestamp:    $ts,
            agent_name:   (if $agent_name != "" then $agent_name else null end),
            result:       (if $result != "" then $result else null end),
            tool_use_id:  (if $tool_use_id != "" then $tool_use_id else null end),
            duration_s:   $duration_s
        }' >> "$AUDIT_FILE"

    # Incrementa subagent_completions no contexto da sessão
    # NOTE: subagent_calls é incrementado em subagent-start.sh (invocação).
    # F1: escrita transacional via ctx_update (com lock canônico)
    if [ -f "$ctx_file" ] && [ -s "$ctx_file" ] && command -v ctx_update > /dev/null 2>&1; then
        ctx_update '.session_stats.subagent_completions = (.session_stats.subagent_completions // 0) + 1' \
            2> /dev/null || true
    fi

    return 0
}
