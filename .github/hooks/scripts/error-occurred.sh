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

# Obtém session_id do contexto persistido
SESSION_ID=""
CTX_FILE="$STATE_DIR/session-context.json"
if [ -f "$CTX_FILE" ]; then
    SESSION_ID="$(jq -r '.session.id // ""' "$CTX_FILE" 2>/dev/null || echo '')"
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

# Incrementa failures_total no contexto da sessão (schema v2)
if [ -f "$CTX_FILE" ] && command -v sponge &>/dev/null; then
    jq '.session_stats.failures_total = (.session_stats.failures_total // 0) + 1' \
        "$CTX_FILE" | sponge "$CTX_FILE" 2>/dev/null || true
fi

exit 0
