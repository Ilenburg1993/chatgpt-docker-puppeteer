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
        # HEAL v1: se source é manual_recovery ou inline_restart, sincroniza sem bloquear
        CTX_SOURCE="$(jq -r '.session.source // ""' "$CTX_FILE" 2> /dev/null || echo '')"
        if [ "$CTX_SOURCE" = "manual_recovery" ] || [ "$CTX_SOURCE" = "inline_restart" ]; then
            if command -v heal_v1 > /dev/null 2>&1; then
                if heal_v1 "$SESSION_ID" "$TIMESTAMP"; then
                    echo "[heal] HEAL v1 aplicado em pre-compact.sh" >&2
                fi
            fi
        fi
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
        # GAP-03: incrementa contador de mismatches
        if command -v increment_mismatch > /dev/null 2>&1; then
            increment_mismatch
        fi
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
if [ -f "$CTX_FILE" ] && [ -s "$CTX_FILE" ] && command -v sponge > /dev/null 2>&1; then
    jq '.session_stats.compaction_count = ((.session_stats.compaction_count // 0) + 1)' \
        "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
fi

echo "[compact] Compactação de contexto iminente — checkpoint criado" >&2
exit 0
