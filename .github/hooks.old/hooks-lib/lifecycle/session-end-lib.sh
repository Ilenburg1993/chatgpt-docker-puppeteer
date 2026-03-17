#!/usr/bin/env bash
# shellcheck shell=bash
set -euo pipefail

# Lógica de domínio do hook sessionEnd.
# Pré-requisito: common.sh carregado pelo script entrypoint.
run_session_end_hook() {
    local log_dir="${1:-}"
    local state_dir="${2:-}"
    local docs_sessions_dir="${3:-}"
    local scripts_dir="${4:-}"

    local hook_dir="${HOOK_DIR:-}"
    if [ -z "$hook_dir" ]; then
        hook_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
        HOOK_DIR="$hook_dir"
    fi

    if ! declare -F session_end_close_active_section > /dev/null 2>&1; then
        # shellcheck disable=SC1091
        source "$hook_dir/hooks-lib/lifecycle/session-end-core.sh"
    fi

    if ! declare -F session_end_generate_and_mirror_summary > /dev/null 2>&1; then
        # shellcheck disable=SC1091
        source "$hook_dir/hooks-lib/lifecycle/session-end-aux.sh"
    fi

    mkdir -p "$log_dir" && chmod 700 "$log_dir"
    mkdir -p "$state_dir"
    mkdir -p "$docs_sessions_dir"

    local ctx_file="$state_dir/session-context.json"

    # CRÍTICO-1 FIX: lê stdin e resolve per-session ANTES de abrir o flock (fd 9)
    INPUT="$(cat 2> /dev/null || true)"

    TIMESTAMP="$(echo "$INPUT" | jq -r '.timestamp // 0' 2> /dev/null || echo 0)"
    CWD="$(echo "$INPUT" | jq -r '.cwd // ""' 2> /dev/null || echo '')"
    REASON="$(echo "$INPUT" | jq -r '.reason // "complete"' 2> /dev/null || echo 'complete')"
    # GAP-S03 FIX: extrai session_id do payload (VS Code inclui em sessionEnd, como nos demais hooks).
    SESSION_ID_PAYLOAD="$(echo "$INPUT" | jq -r '.session_id // ""' 2> /dev/null || echo '')"

    # UPG-AUDIT-01: resolve per-session paths ANTES do flock (override CTX_FILE, AUDIT_FILE, _CTX_LOCK)
    if command -v resolve_audit_file > /dev/null 2>&1 && [ -n "${SESSION_ID_PAYLOAD:-}" ]; then
        _SID_SHORT="${SESSION_ID_PAYLOAD:0:8}"
        ctx_file="$(resolve_ctx_file "$_SID_SHORT")"
        AUDIT_FILE="$(resolve_audit_file "$_SID_SHORT")"
        mkdir -p "$(dirname "$ctx_file")" "$(dirname "$AUDIT_FILE")" 2> /dev/null || true
    fi

    # REV4-07: Lock exclusivo APÓS resolver CTX_FILE per-session
    _CTX_LOCK="${ctx_file}.lock"
    exec 9> "$_CTX_LOCK"
    if command -v flock > /dev/null 2>&1; then
        flock -x -w "${HOOKS_FLOCK_TIMEOUT:-5}" 9 2> /dev/null || true
    fi

    NOW_MS="$(date +%s000 2> /dev/null || echo "$TIMESTAMP")"
    SESSION_DATE_SHORT="$(date -u '+%Y%m%d_%H%M%S' 2> /dev/null || echo 'unknown')"
    SESSION_DATE_DAILY="$(date -u '+%Y-%m-%d' 2> /dev/null || echo 'unknown')"

    # ── B5: Salva checkpoint final antes de encerrar ─────────────────────────────
    CHECKPOINT_SCRIPT="$scripts_dir/session-checkpoint.sh"
    if [ -f "$CHECKPOINT_SCRIPT" ] && [ -x "$CHECKPOINT_SCRIPT" ]; then
        bash "$CHECKPOINT_SCRIPT" 2> /dev/null || true
    fi

    # ── Obtém dados da sessão do contexto persistido (schema v4) ─────────────────
    SESSION_ID="unknown"
    START_ISO=""
    if [ -f "$ctx_file" ]; then
        SESSION_ID="$(jq -r '.session.id // "unknown"' "$ctx_file" 2> /dev/null || echo 'unknown')"
        START_ISO="$(jq -r '.session.started_at // ""' "$ctx_file" 2> /dev/null || echo '')"
    fi

    # GAP-S03 FIX — HEAL v1: sincroniza session_id se payload difere do CTX.
    if [ -n "$SESSION_ID_PAYLOAD" ] && [ "$SESSION_ID_PAYLOAD" != "$SESSION_ID" ] && [ "$SESSION_ID" != "unknown" ]; then
        _CTX_SOURCE_SE="$(jq -r '.session.source // ""' "$ctx_file" 2> /dev/null || echo '')"
        if [ "$_CTX_SOURCE_SE" = "manual_recovery" ]; then
            _NOW_HEAL_SE="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
            if command -v sponge > /dev/null 2>&1; then
                jq --arg real_sid "$SESSION_ID_PAYLOAD" --arg ts "$_NOW_HEAL_SE" \
                    '.session.id = $real_sid | .session.vs_code_session_id = $real_sid | .session.source = "healed_from_real_session" | .session.healed_at = $ts' \
                    "$ctx_file" | sponge "$ctx_file" 2> /dev/null || true
            else
                _TMP_HEAL_SE="$(mktemp)"
                if jq --arg real_sid "$SESSION_ID_PAYLOAD" --arg ts "$_NOW_HEAL_SE" \
                    '.session.id = $real_sid | .session.vs_code_session_id = $real_sid | .session.source = "healed_from_real_session" | .session.healed_at = $ts' \
                    "$ctx_file" > "$_TMP_HEAL_SE" 2> /dev/null; then
                    mv "$_TMP_HEAL_SE" "$ctx_file" 2> /dev/null || rm -f "$_TMP_HEAL_SE"
                else
                    rm -f "$_TMP_HEAL_SE"
                fi
            fi
            SESSION_ID="$SESSION_ID_PAYLOAD"
            jq -cn \
                --arg event "session_id_healed" \
                --arg old "" \
                --arg new "$SESSION_ID" \
                --arg source "session-end.sh" \
                --arg ts "$_NOW_HEAL_SE" \
                '{event: $event, new_session_id: $new, source: $source, timestamp: $ts,
                  message: "HEAL v1 em sessionEnd: manual_recovery adotou session_id do payload"}' \
                >> "$AUDIT_FILE"
            echo "[heal] HEAL v1 aplicado em session-end.sh — session_id atualizado" >&2
        elif [ "$_CTX_SOURCE_SE" = "inline_restart" ]; then
            # inline_restart: CTX tem o session_id correto do VS Code.
            SESSION_ID_PAYLOAD="$SESSION_ID"
        fi
    fi

    # Hardening adicional: persiste strict_turn_close_requires_key em contextos legados.
    if command -v ensure_strict_turn_close_flag_default > /dev/null 2>&1; then
        ensure_strict_turn_close_flag_default "$ctx_file" > /dev/null 2>&1 || true
    fi

    # ── Fecha section ativa antes de encerrar sessão (Schema v4 — Fase C) ────────
    session_end_close_active_section "$SESSION_ID" "$ctx_file" "$AUDIT_FILE" || true

    # Calcula duração total da sessão (ISO → epoch → diff)
    DURATION_S=0
    START_EPOCH=0
    if [ -n "$START_ISO" ]; then
        if date -d "$START_ISO" '+%s' > /dev/null 2>&1; then
            START_EPOCH="$(date -d "$START_ISO" '+%s' 2> /dev/null || echo 0)"
        else
            START_EPOCH="$(date -j -f '%Y-%m-%dT%H:%M:%SZ' "$START_ISO" '+%s' 2> /dev/null || echo 0)"
        fi
        NOW_EPOCH="$(date -u '+%s' 2> /dev/null || echo 0)"
        if [ "$NOW_EPOCH" -gt "$START_EPOCH" ] 2> /dev/null; then
            DURATION_S=$((NOW_EPOCH - START_EPOCH))
        fi
    fi

    # Conta ferramentas e erros via audit.jsonl (defensivo)
    TOOLS_COUNT=0
    ERRORS_COUNT=0
    if [ -f "$AUDIT_FILE" ]; then
        TOOLS_COUNT="$(jq -r --arg sid "$SESSION_ID" \
            'select(.session_id == $sid and .event == "preToolUse")' \
            "$AUDIT_FILE" 2> /dev/null | jq -s 'length' 2> /dev/null || echo 0)"
        ERRORS_COUNT="$(jq -r --arg sid "$SESSION_ID" \
            'select(.session_id == $sid and .event == "toolUseFailure")' \
            "$AUDIT_FILE" 2> /dev/null | jq -s 'length' 2> /dev/null || echo 0)"
    fi

    # Finalização crítica de sessão (estado, close_mode, eventos core e validação de close_key)
    session_end_finalize_core_termination \
        "$SESSION_ID" \
        "$REASON" \
        "$ctx_file" \
        "$AUDIT_FILE" \
        "$NOW_MS" \
        "$CWD" \
        "$DURATION_S" \
        "$TOOLS_COUNT" \
        "$ERRORS_COUNT" \
        "$state_dir" \
        || true

    # ── Rotação do audit.jsonl (mantém últimas 5000 linhas) ──────────────────────
    AUDIT_MAX_LINES=5000
    if [ -f "$AUDIT_FILE" ]; then
        AUDIT_LINES="$(wc -l < "$AUDIT_FILE" | tr -d ' ')"
        if [ "$AUDIT_LINES" -gt "$AUDIT_MAX_LINES" ]; then
            AUDIT_ARCHIVE="$log_dir/audit-archive-$(date -u '+%Y%m%d%H%M%S').jsonl"
            head -n $((AUDIT_LINES - AUDIT_MAX_LINES)) "$AUDIT_FILE" > "$AUDIT_ARCHIVE" 2> /dev/null || true
            _AUDIT_BAK="${AUDIT_FILE}.bak"
            cp "$AUDIT_FILE" "$_AUDIT_BAK" 2> /dev/null || true
            if ! tail -n "$AUDIT_MAX_LINES" "$AUDIT_FILE" | sponge "$AUDIT_FILE" 2> /dev/null; then
                mv "$_AUDIT_BAK" "$AUDIT_FILE" 2> /dev/null || true
            else
                rm -f "$_AUDIT_BAK" 2> /dev/null || true
            fi
        fi
    fi

    # ── Pós-processamento auxiliar (summary + espelho em DOCUMENTAÇÃO) ──────────
    START_TS_MS="$((START_EPOCH * 1000))"
    run_aux_block "session-end:summary-mirror" "${HOOKS_AUX_TIMEOUT_S:-5}" \
        session_end_generate_and_mirror_summary \
        "$SESSION_ID" \
        "$SESSION_DATE_SHORT" \
        "$START_TS_MS" \
        "$NOW_MS" \
        "$REASON" \
        "$scripts_dir" \
        "$log_dir" \
        "$docs_sessions_dir" \
        "$SESSION_DATE_DAILY" \
        || true

    # ── Verifica conformidade de autorização no encerramento da sessão ────────────
    AUTH_FLAG_FILE="$state_dir/UNAUTHORIZED_CLOSE.flag"
    SESSION_AUTH_COMPLIANT=true

    if [ -f "$AUTH_FLAG_FILE" ]; then
        SESSION_AUTH_COMPLIANT=false
    fi

    if [ "$SESSION_AUTH_COMPLIANT" = "true" ] && [ -f "$AUDIT_FILE" ]; then
        SESSION_AUTHORIZED_COUNT="$(jq -r --arg sid "$SESSION_ID" \
            'select(.event == "turnEnd_authorized" and .session_id == $sid)' \
            "$AUDIT_FILE" 2> /dev/null | wc -l | tr -d ' ')"
        SESSION_VIOLATION_COUNT="$(jq -r --arg sid "$SESSION_ID" \
            'select(.event == "turnEnd_no_askQuestions" and .session_id == $sid)' \
            "$AUDIT_FILE" 2> /dev/null | wc -l | tr -d ' ')"
        jq -cn \
            --arg event "sessionEnd_compliance" \
            --arg sid "$SESSION_ID" \
            --arg ts "$NOW_MS" \
            --arg reason "$REASON" \
            --argjson authorized "$SESSION_AUTHORIZED_COUNT" \
            --argjson violations "$SESSION_VIOLATION_COUNT" \
            --argjson compliant "$SESSION_AUTH_COMPLIANT" \
            '{event: $event, session_id: $sid, timestamp: $ts, reason: $reason,
              authorized_turns: $authorized, violation_turns: $violations,
              fully_compliant: $compliant}' \
            >> "$AUDIT_FILE"
    fi

    # ── Pós-processamento auxiliar: nota em pending-tasks.md ─────────────────────
    run_aux_block "session-end:pending-note" "${HOOKS_AUX_TIMEOUT_S:-5}" \
        session_end_append_pending_task_note \
        "$state_dir" \
        "$SESSION_ID" \
        "$SESSION_DATE_DAILY" \
        "$REASON" \
        "$TOOLS_COUNT" \
        || true

    # ── Banner final ──────────────────────────────────────────────────────────────
    cat << EOF

╔══════════════════════════════════════════════════════════════════╗
║             SESSÃO ENCERRADA — ${REASON}
║  Session ID : ${SESSION_ID}
║  Duração    : $((DURATION_S / 60))m $((DURATION_S % 60))s
║  Ferramentas: ${TOOLS_COUNT} | Erros: ${ERRORS_COUNT}
║  Relatório  : DOCUMENTAÇÃO/RELATORIOS/SESSIONS/sessions-${SESSION_DATE_DAILY}.md
╚══════════════════════════════════════════════════════════════════╝
EOF

    return 0
}
