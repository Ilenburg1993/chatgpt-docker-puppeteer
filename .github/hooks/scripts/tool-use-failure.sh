#!/bin/bash
# tool-use-failure.sh — Hook postToolUseFailure do Copilot
# Executado quando uma ferramenta falha durante execução.
# Substitui o inerte errorOccurred (que nunca disparava no SDK).
# Input JSON (stdin): {timestamp, session_id, tool_name, tool_use_id, error, ...}
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOOK_DIR/logs"
STATE_DIR="$HOOK_DIR/state"
CTX_FILE="$STATE_DIR/session-context.json"

mkdir -p "$LOG_DIR"

INPUT="$(cat 2>/dev/null || true)"

TIMESTAMP="$(echo "$INPUT" | jq -r '.timestamp // ""' 2>/dev/null || echo '')"
SESSION_ID="$(echo "$INPUT" | jq -r '.session_id // ""' 2>/dev/null || echo '')"
TOOL_NAME="$(echo "$INPUT" | jq -r '.tool_name // ""' 2>/dev/null || echo '')"
TOOL_USE_ID="$(echo "$INPUT" | jq -r '.tool_use_id // ""' 2>/dev/null || echo '')"
ERROR_MSG="$(echo "$INPUT" | jq -r '.error // .message // ""' 2>/dev/null || echo '')"

# Loga evento de falha no audit.jsonl
jq -cn \
    --arg event "toolUseFailure" \
    --arg sid "$SESSION_ID" \
    --arg ts "$TIMESTAMP" \
    --arg tool "$TOOL_NAME" \
    --arg tool_use_id "$TOOL_USE_ID" \
    --arg error "$ERROR_MSG" \
    '{
        event:       $event,
        session_id:  $sid,
        timestamp:   $ts,
        tool_name:   $tool,
        tool_use_id: $tool_use_id,
        error:       $error
    }' >> "$LOG_DIR/audit.jsonl"

# Loga em errors.jsonl para rastreio separado
jq -cn \
    --arg ts "$TIMESTAMP" \
    --arg tool "$TOOL_NAME" \
    --arg error "$ERROR_MSG" \
    '{ timestamp: $ts, tool: $tool, error: $error }' >> "$LOG_DIR/errors.jsonl"

# ── Guard: session_id ─────────────────────────────────────────────────────────
if [ -f "$CTX_FILE" ] && [ ! -s "$CTX_FILE" ]; then
    echo "[guard] session-context.json vazio — guard desabilitado (aguardando auto-recovery)" >&2
fi
if [ -f "$CTX_FILE" ] && [ -s "$CTX_FILE" ] && [ -n "$SESSION_ID" ]; then
    CTX_ACTIVE_SID="$(jq -r '.session.id // ""' "$CTX_FILE" 2>/dev/null || echo '')"
    if [ -n "$CTX_ACTIVE_SID" ] && [ "$SESSION_ID" != "$CTX_ACTIVE_SID" ]; then
        exit 0
    fi
fi

# Atualiza contadores no session-context.json
if [ -f "$CTX_FILE" ] && [ -s "$CTX_FILE" ] && command -v sponge &>/dev/null; then
    jq \
        '.current_turn.failures_count = ((.current_turn.failures_count // 0) + 1)
         | .session_stats.failures_detected = ((.session_stats.failures_detected // 0) + 1)
         | .session_stats.errors_total = ((.session_stats.errors_total // 0) + 1)' \
        "$CTX_FILE" | sponge "$CTX_FILE" 2>/dev/null || true
fi

echo "[tool-failure] Ferramenta '$TOOL_NAME' falhou: $ERROR_MSG" >&2
exit 0
