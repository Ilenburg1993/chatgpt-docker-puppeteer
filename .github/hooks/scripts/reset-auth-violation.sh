#!/bin/bash
# reset-auth-violation.sh — Reseta manualmente o flag de violação de autorização
# Uso: bash reset-auth-violation.sh [--reason "motivo"]
# Use quando a violação foi gerada por teste ou foi resolvida manualmente.
# Requer motivo obrigatório — o reset é auditado em audit.jsonl.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOOK_DIR/logs"
STATE_DIR="$HOOK_DIR/state"

AUTH_FLAG_FILE="$STATE_DIR/UNAUTHORIZED_CLOSE.flag"
AUDIT_FILE="$LOG_DIR/audit.jsonl"
CTX_FILE="$STATE_DIR/session-context.json"

# Parse de argumentos
REASON=""
while [[ $# -gt 0 ]]; do
    case "$1" in
        --reason)
            REASON="$2"
            shift 2
            ;;
        -r)
            REASON="$2"
            shift 2
            ;;
        *)
            shift
            ;;
    esac
done

if [ -z "$REASON" ]; then
    echo "❌ Uso: bash reset-auth-violation.sh --reason \"motivo do reset\""
    echo "   Motivos válidos: teste manual, violação resolvida, falso positivo"
    exit 1
fi

NOW_ISO="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo '')"
SESSION_ID="$(jq -r '.session_id // "manual"' "$CTX_FILE" 2> /dev/null || echo 'manual')"

# Verifica se o flag existe
if [ ! -f "$AUTH_FLAG_FILE" ]; then
    echo "ℹ️  UNAUTHORIZED_CLOSE.flag não existe. Nada a resetar."
    exit 0
fi

echo "⚠️  Flag atual:"
cat "$AUTH_FLAG_FILE"
echo ""

# Lê dados do flag para o log
FLAG_TS="$(jq -r '.timestamp // ""' "$AUTH_FLAG_FILE" 2> /dev/null || echo '')"
FLAG_SID="$(jq -r '.session_id // ""' "$AUTH_FLAG_FILE" 2> /dev/null || echo '')"

# Remove o flag
rm -f "$AUTH_FLAG_FILE"

# Reseta contadores no contexto
if [ -f "$CTX_FILE" ] && command -v sponge &> /dev/null; then
    jq '.consecutive_unauthorized_closes = 0 | .last_close_authorized = true' \
        "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
fi

# Loga o reset no audit.jsonl
mkdir -p "$LOG_DIR"
jq -cn \
    --arg event "authViolation_reset" \
    --arg sid "$SESSION_ID" \
    --arg ts "$NOW_ISO" \
    --arg reason "$REASON" \
    --arg flag_ts "$FLAG_TS" \
    --arg flag_sid "$FLAG_SID" \
    '{
        event:           $event,
        session_id:      $sid,
        timestamp:       $ts,
        reason:          $reason,
        original_flag_ts:  $flag_ts,
        original_flag_sid: $flag_sid,
        reset_by:        "manual (reset-auth-violation.sh)"
    }' >> "$AUDIT_FILE"

echo "✅ Flag removido. Contexto resetado. Evento authViolation_reset registrado em audit.jsonl."
echo "   Motivo: $REASON"

exit 0
