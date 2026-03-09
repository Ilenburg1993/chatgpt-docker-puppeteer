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

INPUT="$(cat 2> /dev/null || true)"

TIMESTAMP="$(echo "$INPUT" | jq -r '.timestamp // ""' 2> /dev/null || echo '')"
NOW_ISO="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo '')"
SESSION_ID_PAYLOAD="$(echo "$INPUT" | jq -r '.session_id // ""' 2> /dev/null || echo '')"

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
            --arg source "subagent-stop.sh" \
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

# Extrai campos do payload do subagente (schema não documentado — tratamento defensivo)
SUBAGENT_NAME="$(echo "$INPUT" | jq -r '.agentName // .subagent_name // .name // ""' 2> /dev/null || echo '')"
SUBAGENT_RESULT="$(echo "$INPUT" | jq -r '.result // .status // ""' 2> /dev/null || echo '')"
TOOL_USE_ID="$(echo "$INPUT" | jq -r '.tool_use_id // .toolUseId // ""' 2> /dev/null || echo '')"

# Calcula duração aproximada usando last_tool_ts do contexto
DURATION_S=0
if [ -f "$CTX_FILE" ]; then
    LAST_TOOL_TS="$(jq -r '.last_tool.ts // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    if [ -n "$LAST_TOOL_TS" ] && [ -n "$NOW_ISO" ]; then
        LAST_S="$(date -d "$LAST_TOOL_TS" '+%s' 2> /dev/null || echo 0)"
        NOW_S="$(date -d "$NOW_ISO" '+%s' 2> /dev/null || echo 0)"
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
    }' >> "$LOG_DIR/audit.jsonl"

# Incrementa subagent_calls no contexto da sessão
if [ -f "$CTX_FILE" ] && command -v sponge &> /dev/null; then
    jq '.session_stats.subagent_calls = (.session_stats.subagent_calls // 0) + 1' \
        "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
fi

exit 0
