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
# Carrega biblioteca de funções compartilhadas (heal_v1, increment_mismatch, etc.)
if [ -f "$HOOK_DIR/hooks-lib/common.sh" ]; then
    # shellcheck source=../.github/hooks/hooks-lib/common.sh
    source "$HOOK_DIR/hooks-lib/common.sh" 2> /dev/null \
        || echo "[warn] common.sh falhou ao carregar em subagent-start.sh" >&2
else
    echo "[warn] common.sh não encontrado (subagent-start.sh) — heal_v1/increment_mismatch indisponíveis" >&2
fi
mkdir -p "$LOG_DIR"

INPUT="$(cat 2> /dev/null || true)"

TIMESTAMP="$(echo "$INPUT" | jq -r '.timestamp // ""' 2> /dev/null || echo '')"
SESSION_ID_PAYLOAD="$(echo "$INPUT" | jq -r '.session_id // ""' 2> /dev/null || echo '')"
# UPG-AUDIT-01: resolve per-session files se SESSION_ID_PAYLOAD disponível
apply_per_session_paths "${SESSION_ID_PAYLOAD:-}" 2> /dev/null || true

# ── Guard: session_id deve corresponder ao contexto ativo ─────────────────────
# F0.3: detecta contexto vazio
if [ -f "$CTX_FILE" ] && [ ! -s "$CTX_FILE" ]; then
    echo "[guard] session-context.json vazio — guard desabilitado (aguardando auto-recovery)" >&2
fi
# HARDENING v5: previne contaminação cruzada entre SESSIONs.
if [ -f "$CTX_FILE" ] && [ -s "$CTX_FILE" ] && [ -n "$SESSION_ID_PAYLOAD" ]; then
    CTX_ACTIVE_SID="$(jq -r '.session.id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    if [ -n "$CTX_ACTIVE_SID" ] && [ "$SESSION_ID_PAYLOAD" != "$CTX_ACTIVE_SID" ]; then
        # HEAL v1: se source é manual_recovery ou inline_restart, sincroniza sem bloquear
        CTX_SOURCE="$(jq -r '.session.source // ""' "$CTX_FILE" 2> /dev/null || echo '')"
        if [ "$CTX_SOURCE" = "manual_recovery" ] || [ "$CTX_SOURCE" = "inline_restart" ]; then
            if command -v heal_v1 > /dev/null 2>&1; then
                if heal_v1 "$SESSION_ID_PAYLOAD" "$TIMESTAMP"; then
                    echo "[heal] HEAL v1 aplicado em subagent-start.sh" >&2
                fi
            fi
        fi
        jq -cn \
            --arg event "session_id_mismatch" \
            --arg expected "$CTX_ACTIVE_SID" \
            --arg got "$SESSION_ID_PAYLOAD" \
            --arg source "subagent-start.sh" \
            '{
                event:    $event,
                expected: $expected,
                got:      $got,
                source:   $source,
                message:  "Payload session_id diferente do contexto ativo — state write bloqueado"
            }' >> "$AUDIT_FILE"
        # GAP-03: incrementa contador de mismatches
        if command -v increment_mismatch > /dev/null 2>&1; then
            increment_mismatch
        fi
        exit 0
    fi
fi

# Loga evento no audit.jsonl
jq -cn \
    --arg event "subagentStart" \
    --arg sid "$SESSION_ID_PAYLOAD" \
    --arg ts "$TIMESTAMP" \
    '{
        event:      $event,
        session_id: $sid,
        timestamp:  $ts
    }' >> "$AUDIT_FILE"

# Incrementa contagem de subagentes no session-context.json
# EBH-L01: fallback mktemp quando sponge não disponível
if [ -f "$CTX_FILE" ] && [ -s "$CTX_FILE" ]; then
    if command -v sponge &> /dev/null; then
        jq '.session_stats.subagent_calls = ((.session_stats.subagent_calls // 0) + 1)' \
            "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
    else
        # Valida mktemp antes de usar (fix Haiku S1.1: se mktemp falhar, _SA_START_TMP fica vazio)
        if _SA_START_TMP="$(mktemp 2> /dev/null)"; then
            jq '.session_stats.subagent_calls = ((.session_stats.subagent_calls // 0) + 1)' \
                "$CTX_FILE" > "$_SA_START_TMP" 2> /dev/null \
                && mv "$_SA_START_TMP" "$CTX_FILE" \
                || rm -f "$_SA_START_TMP" 2> /dev/null
        else
            echo "[warn] subagent-start: mktemp falhou; subagent_calls não incrementado" >&2
        fi
    fi
fi

echo "[subagent] Subagente iniciado" >&2
exit 0
