#!/bin/bash
# agent-stop.sh — Hook agentStop do Copilot
# Executado quando o agente principal termina de responder ao prompt (fim de turno).
# Input JSON (stdin): formato não totalmente documentado — tratamento defensivo.
# Output: ignorado pelo Copilot.
# Propósito: leve e rápido — apenas registra o fim do turno.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOOK_DIR/logs"
STATE_DIR="$HOOK_DIR/state"

mkdir -p "$LOG_DIR" && chmod 700 "$LOG_DIR"

INPUT="$(cat 2>/dev/null || true)"

# Tratamento defensivo — campo timestamp pode não existir neste hook
TIMESTAMP="$(echo "$INPUT" | jq -r '.timestamp // 0' 2>/dev/null || echo 0)"
NOW_MS="$(date +%s000 2>/dev/null || echo 0)"

# Obtém session_id e last_tool_ts do contexto persistido
SESSION_ID=""
LAST_TOOL_TS="$NOW_MS"
CTX_FILE="$STATE_DIR/session-context.json"
if [ -f "$CTX_FILE" ]; then
    SESSION_ID="$(jq -r '.session_id // ""' "$CTX_FILE" 2>/dev/null || echo '')"
    CTX_LAST_TS="$(jq -r '.last_tool_ts // 0' "$CTX_FILE" 2>/dev/null || echo 0)"
    if [ "$CTX_LAST_TS" != "0" ]; then
        LAST_TOOL_TS="$CTX_LAST_TS"
    fi
fi

# Calcula duração aproximada do turno em segundos
TURN_DURATION_S=0
if [ "$LAST_TOOL_TS" != "0" ] && [ "$NOW_MS" -gt "$LAST_TOOL_TS" ] 2>/dev/null; then
    TURN_DURATION_S="$(( (NOW_MS - LAST_TOOL_TS) / 1000 ))"
fi

# Append em audit.jsonl
jq -cn \
    --arg event "agentStop" \
    --arg sid "$SESSION_ID" \
    --arg ts "${TIMESTAMP:-$NOW_MS}" \
    --argjson dur "$TURN_DURATION_S" \
    '{
        event:           $event,
        session_id:      $sid,
        timestamp:       $ts,
        turn_duration_s: $dur
    }' >> "$LOG_DIR/audit.jsonl"

# Incrementa turn_count no contexto da sessão
if [ -f "$CTX_FILE" ] && command -v sponge &>/dev/null; then
    jq --argjson now "$NOW_MS" \
        '.turn_count = (.turn_count // 0) + 1 | .last_turn_ts = ($now | tostring)' \
        "$CTX_FILE" | sponge "$CTX_FILE" 2>/dev/null || true
fi

exit 0
