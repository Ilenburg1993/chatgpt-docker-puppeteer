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
            --arg source "pre-compact.sh" \
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

# Cria checkpoint ANTES da compactação (preserva estado atual)
if [ -x "$HOOK_DIR/scripts/session-checkpoint.sh" ]; then
    bash "$HOOK_DIR/scripts/session-checkpoint.sh" 2> /dev/null || true
fi

# Loga evento de compactação no audit.jsonl
NOW_ISO="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo "$TIMESTAMP")"
jq -cn \
    --arg event "preCompact" \
    --arg sid "$SESSION_ID" \
    --arg ts "$NOW_ISO" \
    '{
        event:      $event,
        session_id: $sid,
        timestamp:  $ts,
        message:    "Contexto será compactado — possível perda de memória de curto prazo"
    }' >> "$LOG_DIR/audit.jsonl"

# Incrementa contador de compactações no session-context.json
if [ -f "$CTX_FILE" ] && [ -s "$CTX_FILE" ]; then
    TMP_CTX="$(mktemp)"
    if jq '.session_stats.compaction_count = ((.session_stats.compaction_count // 0) + 1)' \
        "$CTX_FILE" > "$TMP_CTX" 2> /dev/null; then
        mv "$TMP_CTX" "$CTX_FILE"
    else
        rm -f "$TMP_CTX"
    fi
fi

echo "[compact] Compactação de contexto iminente — checkpoint criado" >&2
exit 0
