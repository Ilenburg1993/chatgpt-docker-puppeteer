#!/bin/bash
# error-occurred.sh — Hook errorOccurred do Copilot
# Executado quando ocorre um erro durante a execução do agente.
# Input JSON (stdin): {timestamp, cwd, error:{message, name, stack}}
# Output: ignorado pelo Copilot.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOOK_DIR/logs"
STATE_DIR="$HOOK_DIR/state"

mkdir -p "$LOG_DIR" && chmod 700 "$LOG_DIR"

INPUT="$(cat 2> /dev/null || true)"

TIMESTAMP="$(echo "$INPUT" | jq -r '.timestamp // 0' 2> /dev/null || echo 0)"
ERROR_NAME="$(echo "$INPUT" | jq -r '.error.name // "Unknown"' 2> /dev/null || echo 'Unknown')"
ERROR_MSG="$(echo "$INPUT" | jq -r '.error.message // ""' 2> /dev/null || echo '')"
ERROR_STACK="$(echo "$INPUT" | jq -r '.error.stack // ""' 2> /dev/null | head -c 1000 || echo '')"
SESSION_ID_PAYLOAD="$(echo "$INPUT" | jq -r '.session_id // ""' 2> /dev/null || echo '')"

# Obtém session_id do contexto persistido
SESSION_ID=""
CTX_FILE="$STATE_DIR/session-context.json"
if [ -f "$CTX_FILE" ]; then
    SESSION_ID="$(jq -r '.session.id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
fi

# ── Guard: session_id deve corresponder ao contexto ativo ─────────────────────
# F0.3: detecta contexto vazio
if [ -f "$CTX_FILE" ] && [ ! -s "$CTX_FILE" ]; then
    echo "[guard] session-context.json vazio — guard desabilitado (aguardando auto-recovery)" >&2
fi
# HARDENING v5: previne contaminação cruzada entre SESSIONs.
if [ -f "$CTX_FILE" ] && [ -s "$CTX_FILE" ] && [ -n "$SESSION_ID_PAYLOAD" ]; then
    CTX_ACTIVE_SID="$(jq -r '.session.id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    if [ -n "$CTX_ACTIVE_SID" ] && [ "$SESSION_ID_PAYLOAD" != "$CTX_ACTIVE_SID" ]; then
        jq -cn \
            --arg event "session_id_mismatch" \
            --arg expected "$CTX_ACTIVE_SID" \
            --arg got "$SESSION_ID_PAYLOAD" \
            --arg source "error-occurred.sh" \
            '{
                event:   $event,
                expected: $expected,
                got:      $got,
                source:   $source,
                message:  "Payload session_id diferente do contexto ativo — state write bloqueado"
            }' >> "$LOG_DIR/audit.jsonl"
        exit 0
    fi
fi

# Append em audit.jsonl (resumido — sem stack)
jq -cn \
    --arg event "errorOccurred" \
    --arg sid "$SESSION_ID" \
    --arg ts "$TIMESTAMP" \
    --arg name "$ERROR_NAME" \
    --arg msg "$ERROR_MSG" \
    '{
        event:      $event,
        session_id: $sid,
        timestamp:  $ts,
        errorName:  $name,
        errorMsg:   $msg
    }' >> "$LOG_DIR/audit.jsonl"

# Append em errors.jsonl (com stack completo para debug)
jq -cn \
    --arg event "errorDetail" \
    --arg sid "$SESSION_ID" \
    --arg ts "$TIMESTAMP" \
    --arg name "$ERROR_NAME" \
    --arg msg "$ERROR_MSG" \
    --arg stack "$ERROR_STACK" \
    '{
        event:      $event,
        session_id: $sid,
        timestamp:  $ts,
        errorName:  $name,
        errorMsg:   $msg,
        stack:      $stack
    }' >> "$LOG_DIR/errors.jsonl"

# Incrementa failures_detected no contexto da sessão (schema v2)
if [ -f "$CTX_FILE" ] && command -v sponge &> /dev/null; then
    jq '.session_stats.failures_detected = (.session_stats.failures_detected // 0) + 1
         | .session_stats.errors_total = (.session_stats.errors_total // 0) + 1' \
        "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
fi

exit 0
