#!/bin/bash
# subagent-start.sh — Hook subagentStart do Copilot
# Executado quando um subagente é iniciado.
# Input JSON (stdin): {timestamp, session_id, ...}
# Complementa subagent-stop.sh para rastreio completo do ciclo de vida de subagentes.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOOK_DIR/logs"
STATE_DIR="$HOOK_DIR/state"
CTX_FILE="$STATE_DIR/session-context.json"
# Carrega biblioteca de funções compartilhadas (heal_v1, increment_mismatch, etc.)
if [ -f "$HOOK_DIR/hooks-lib/common.sh" ]; then
    # shellcheck source=../.github/hooks/hooks-lib/common.sh
    source "$HOOK_DIR/hooks-lib/common.sh" 2> /dev/null \
        || echo "[warn] common.sh falhou ao carregar em subagent-start.sh" >&2
else
    echo "[warn] common.sh não encontrado (subagent-start.sh) — heal_v1/increment_mismatch indisponíveis" >&2
fi
mkdir -p "$LOG_DIR"

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
if [ -f "$CTX_FILE" ] && [ ! -s "$CTX_FILE" ]; then
    echo "[guard] session-context.json vazio — guard desabilitado (aguardando auto-recovery)" >&2
fi
if [ -f "$CTX_FILE" ] && [ -s "$CTX_FILE" ] && [ -n "$SESSION_ID_PAYLOAD" ] \
    && command -v reconcile_session_id_guard_prepost > /dev/null 2>&1; then
    set +e
    _RECONCILED_SID="$(reconcile_session_id_guard_prepost "$SESSION_ID_PAYLOAD" "subagentStart" "$TIMESTAMP" "subagent-start.sh")"
    _RECONCILE_RC=$?
    set -e
    if [ "$_RECONCILE_RC" -eq 10 ]; then
        exit 0
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
if [ -f "$CTX_FILE" ] && [ -s "$CTX_FILE" ] && command -v ctx_update > /dev/null 2>&1; then
    _START_TS="${TIMESTAMP:-$NOW_ISO}"
    ctx_update ".session_stats.subagent_calls = ((.session_stats.subagent_calls // 0) + 1) | .session_stats.last_subagent_start_ts = \"${_START_TS}\"" \
        2> /dev/null || true
fi

echo "[subagent] Subagente iniciado" >&2
exit 0
