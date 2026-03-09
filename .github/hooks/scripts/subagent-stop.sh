#!/bin/bash
# subagent-stop.sh — Hook subagentStop do Copilot
# Executado quando um subagente termina, antes de retornar ao agente pai.
# Input JSON (stdin): formato não totalmente documentado — tratamento defensivo.
# Output: ignorado pelo Copilot.
# Propósito: mínimo — subagentes são transitórios e de vida curta.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOOK_DIR/logs"
STATE_DIR="$HOOK_DIR/state"

mkdir -p "$LOG_DIR" && chmod 700 "$LOG_DIR"

INPUT="$(cat 2>/dev/null || true)"

TIMESTAMP="$(echo "$INPUT" | jq -r '.timestamp // 0' 2>/dev/null || echo 0)"
NOW_MS="$(date +%s000 2>/dev/null || echo 0)"

SESSION_ID=""
CTX_FILE="$STATE_DIR/session-context.json"
if [ -f "$CTX_FILE" ]; then
    SESSION_ID="$(jq -r '.session_id // ""' "$CTX_FILE" 2>/dev/null || echo '')"
fi

jq -cn \
    --arg event "subagentStop" \
    --arg sid "$SESSION_ID" \
    --arg ts "${TIMESTAMP:-$NOW_MS}" \
    '{
        event:      $event,
        session_id: $sid,
        timestamp:  $ts
    }' >> "$LOG_DIR/audit.jsonl"

exit 0
