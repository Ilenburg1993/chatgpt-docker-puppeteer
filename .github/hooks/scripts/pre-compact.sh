#!/bin/bash
# pre-compact.sh — Hook preCompact do Copilot
# Executado ANTES do Copilot compactar o contexto da conversa.
# A compactação causa perda de memória de curto prazo do agente.
# Este hook registra o evento para que o agente saiba que houve compactação.
# Input JSON (stdin): {timestamp, session_id, ...}
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOOK_DIR/logs"
STATE_DIR="$HOOK_DIR/state"
CTX_FILE="$STATE_DIR/session-context.json"

mkdir -p "$LOG_DIR"
# Carrega biblioteca de funções compartilhadas (heal_v1, increment_mismatch, etc.)
if [ -f "$HOOK_DIR/hooks-lib/common.sh" ]; then
    # shellcheck source=../.github/hooks/hooks-lib/common.sh
    source "$HOOK_DIR/hooks-lib/common.sh" 2> /dev/null \
        || echo "[warn] common.sh falhou ao carregar em pre-compact.sh" >&2
else
    echo "[warn] common.sh não encontrado (pre-compact.sh) — heal_v1/increment_mismatch indisponíveis" >&2
fi
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
    CTX_FILE="$(resolve_ctx_file "$_SID_SHORT")"
    AUDIT_FILE="$(resolve_audit_file "$_SID_SHORT")"
    mkdir -p "$(dirname "$CTX_FILE")" "$(dirname "$AUDIT_FILE")" 2> /dev/null || true
fi

# ── Guard canônico: reconcilia session_id no runtime comum ────────────────────
if [ -f "$CTX_FILE" ] && [ ! -s "$CTX_FILE" ]; then
    echo "[guard] session-context.json vazio — guard desabilitado (aguardando auto-recovery)" >&2
fi
if [ -f "$CTX_FILE" ] && [ -s "$CTX_FILE" ] && [ -n "$SESSION_ID" ] \
    && command -v reconcile_session_id_guard_prepost > /dev/null 2>&1; then
    set +e
    _RECONCILED_SID="$(reconcile_session_id_guard_prepost "$SESSION_ID" "preCompact" "$TIMESTAMP" "pre-compact.sh")"
    _RECONCILE_RC=$?
    set -e
    if [ "$_RECONCILE_RC" -eq 10 ]; then
        exit 0
    fi
    if [ -n "${_RECONCILED_SID:-}" ]; then
        SESSION_ID="$_RECONCILED_SID"
    fi
fi

# Cria checkpoint ANTES da compactação (preserva estado atual)
if [ -x "$HOOK_DIR/scripts/session-checkpoint.sh" ]; then
    bash "$HOOK_DIR/scripts/session-checkpoint.sh" 2> /dev/null || true
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
if [ -f "$CTX_FILE" ] && [ -s "$CTX_FILE" ] && command -v ctx_update > /dev/null 2>&1; then
    ctx_update '.session_stats.compaction_count = ((.session_stats.compaction_count // 0) + 1)' \
        2> /dev/null || true
fi

echo "[compact] Compactação de contexto iminente — checkpoint criado" >&2
exit 0
