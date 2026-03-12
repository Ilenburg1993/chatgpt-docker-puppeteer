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
# Carrega biblioteca de funções compartilhadas (heal_v1, increment_mismatch, etc.)
if [ -f "$HOOK_DIR/hooks-lib/common.sh" ]; then
    # shellcheck source=../.github/hooks/hooks-lib/common.sh
    source "$HOOK_DIR/hooks-lib/common.sh" 2> /dev/null \
        || echo "[warn] common.sh falhou ao carregar em subagent-stop.sh" >&2
else
    echo "[warn] common.sh não encontrado (subagent-stop.sh) — heal_v1/increment_mismatch indisponíveis" >&2
fi
INPUT="$(cat 2> /dev/null || true)"

TIMESTAMP="$(echo "$INPUT" | jq -r '.timestamp // ""' 2> /dev/null || echo '')"
NOW_ISO="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo '')"
SESSION_ID_PAYLOAD="$(echo "$INPUT" | jq -r '.session_id // ""' 2> /dev/null || echo '')"

SESSION_ID=""
CTX_FILE="$STATE_DIR/session-context.json"
# UPG-AUDIT-01: resolve per-session files se SESSION_ID_PAYLOAD disponível
apply_per_session_paths "${SESSION_ID_PAYLOAD:-}" 2> /dev/null || true
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
        # HEAL v1: se source é manual_recovery ou inline_restart, sincroniza sem bloquear
        CTX_SOURCE="$(jq -r '.session.source // ""' "$CTX_FILE" 2> /dev/null || echo '')"
        if [ "$CTX_SOURCE" = "manual_recovery" ]; then
            # BUG-21 fix: manual_recovery sincroniza SID e continua (não sai)
            if command -v heal_v1 > /dev/null 2>&1; then
                if heal_v1 "$SESSION_ID_PAYLOAD" "$TIMESTAMP"; then
                    echo "[heal] HEAL v1 aplicado em subagent-stop.sh" >&2
                fi
            fi
            SESSION_ID_PAYLOAD="$CTX_ACTIVE_SID"
        elif [ "$CTX_SOURCE" = "inline_restart" ]; then
            # BUG-21 fix: inline_restart adota SID do contexto e continua (não sai)
            SESSION_ID_PAYLOAD="$CTX_ACTIVE_SID"
            echo "[guard] inline_restart: adotando SID do contexto em subagent-stop.sh" >&2
        else
            jq -cn \
                --arg event "session_id_mismatch" \
                --arg expected "$CTX_ACTIVE_SID" \
                --arg got "$SESSION_ID_PAYLOAD" \
                --arg source "subagent-stop.sh" \
                '{
                    event:   $event,
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
fi

# Extrai campos do payload do subagente (schema não documentado — tratamento defensivo)
SUBAGENT_NAME="$(echo "$INPUT" | jq -r '.agentName // .subagent_name // .name // ""' 2> /dev/null || echo '')"
SUBAGENT_RESULT="$(echo "$INPUT" | jq -r '.result // .status // ""' 2> /dev/null || echo '')"
TOOL_USE_ID="$(echo "$INPUT" | jq -r '.tool_use_id // .toolUseId // ""' 2> /dev/null || echo '')"

# Calcula duração aproximada usando last_tool_ts do contexto
# BUG-62 FIX: date -d é GNU-only; fallback para BSD (macOS)
DURATION_S=0
if [ -f "$CTX_FILE" ]; then
    LAST_TOOL_TS="$(jq -r '.last_tool.ts // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    if [ -n "$LAST_TOOL_TS" ] && [ -n "$NOW_ISO" ]; then
        if date -d "$LAST_TOOL_TS" '+%s' >/dev/null 2>&1; then
            LAST_S="$(date -d "$LAST_TOOL_TS" '+%s' 2> /dev/null || echo 0)"
        else
            LAST_S="$(date -j -f '%Y-%m-%dT%H:%M:%SZ' "$LAST_TOOL_TS" '+%s' 2> /dev/null || echo 0)"
        fi
        if date -d "$NOW_ISO" '+%s' >/dev/null 2>&1; then
            NOW_S="$(date -d "$NOW_ISO" '+%s' 2> /dev/null || echo 0)"
        else
            NOW_S="$(date -j -f '%Y-%m-%dT%H:%M:%SZ' "$NOW_ISO" '+%s' 2> /dev/null || echo 0)"
        fi
        if [ "$NOW_S" -gt "$LAST_S" ] 2> /dev/null; then
            DURATION_S=$((NOW_S - LAST_S))
        fi
    fi
fi

jq -cn \
    --arg event "subagentStop" \
    --arg sid "$SESSION_ID" \
    --arg ts "${TIMESTAMP:-$NOW_ISO}" \
    --arg agent_name "$SUBAGENT_NAME" \
    --arg result "$SUBAGENT_RESULT" \
    --arg tool_use_id "$TOOL_USE_ID" \
    --argjson duration_s "$DURATION_S" \
    '{
        event:        $event,
        session_id:   $sid,
        timestamp:    $ts,
        agent_name:   (if $agent_name != "" then $agent_name else null end),
        result:       (if $result != "" then $result else null end),
        tool_use_id:  (if $tool_use_id != "" then $tool_use_id else null end),
        duration_s:   $duration_s
    }' >> "$AUDIT_FILE"

# Incrementa subagent_completions no contexto da sessão
# NOTE: subagent_calls é incrementado em subagent-start.sh (invocação).
# Aqui incrementamos subagent_completions para rastrear conclusões separadamente.
# EBH-L01: fallback mktemp quando sponge não disponível
if [ -f "$CTX_FILE" ] && [ -s "$CTX_FILE" ]; then
    if command -v sponge &> /dev/null; then
        jq '.session_stats.subagent_completions = (.session_stats.subagent_completions // 0) + 1' \
            "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
    else
        # Valida mktemp antes de usar (fix Haiku S2.1: se mktemp falhar, _SA_STOP_TMP fica vazio)
        if _SA_STOP_TMP="$(mktemp 2> /dev/null)"; then
            jq '.session_stats.subagent_completions = (.session_stats.subagent_completions // 0) + 1' \
                "$CTX_FILE" > "$_SA_STOP_TMP" 2> /dev/null \
                && mv "$_SA_STOP_TMP" "$CTX_FILE" \
                || rm -f "$_SA_STOP_TMP" 2> /dev/null
        else
            echo "[warn] subagent-stop: mktemp falhou; subagent_completions não incrementado" >&2
        fi
    fi
fi

exit 0
