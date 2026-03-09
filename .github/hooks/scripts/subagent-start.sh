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

mkdir -p "$LOG_DIR"

INPUT="$(cat 2> /dev/null || true)"

TIMESTAMP="$(echo "$INPUT" | jq -r '.timestamp // ""' 2> /dev/null || echo '')"
SESSION_ID="$(echo "$INPUT" | jq -r '.session_id // ""' 2> /dev/null || echo '')"

# ── Guard: session_id deve corresponder ao contexto ativo ─────────────────────
# F0.3: detecta contexto vazio
if [ -f "$CTX_FILE" ] && [ ! -s "$CTX_FILE" ]; then
    echo "[guard] session-context.json vazio — guard desabilitado (aguardando auto-recovery)" >&2
fi
# HARDENING v5: previne contaminação cruzada entre SESSIONs.
if [ -f "$CTX_FILE" ] && [ -s "$CTX_FILE" ] && [ -n "$SESSION_ID" ]; then
    CTX_ACTIVE_SID="$(jq -r '.session.id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    if [ -n "$CTX_ACTIVE_SID" ] && [ "$SESSION_ID" != "$CTX_ACTIVE_SID" ]; then
        jq -cn \
            --arg event "session_id_mismatch" \
            --arg expected "$CTX_ACTIVE_SID" \
            --arg got "$SESSION_ID" \
            --arg source "subagent-start.sh" \
            '{
                event:    $event,
                expected: $expected,
                got:      $got,
                source:   $source,
                message:  "Payload session_id diferente do contexto ativo — state write bloqueado"
            }' >> "$LOG_DIR/audit.jsonl"
        exit 0
    fi
fi

# Loga evento no audit.jsonl
jq -cn \
    --arg event "subagentStart" \
    --arg sid "$SESSION_ID" \
    --arg ts "$TIMESTAMP" \
    '{
        event:      $event,
        session_id: $sid,
        timestamp:  $ts
    }' >> "$LOG_DIR/audit.jsonl"

# Incrementa contagem de subagentes no session-context.json
if [ -f "$CTX_FILE" ] && [ -s "$CTX_FILE" ] && command -v sponge &> /dev/null; then
    jq '.session_stats.subagent_calls = ((.session_stats.subagent_calls // 0) + 1)' \
        "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
fi

echo "[subagent] Subagente iniciado" >&2
exit 0
