#!/bin/bash
# agent-stop.sh — Hook agentStop do Copilot
# Executado quando o agente termina de responder ao prompt (fim de turno).
# Input JSON (stdin): {timestamp, hook_event_name, session_id, ...}
# Output: ignorado pelo Copilot.
#
# PROTOCOLO DE ENCERRAMENTO: este hook detecta fins de turno e registra um
# aviso no audit.jsonl para rastreabilidade. O agente DEVE usar vscode_askQuestions
# antes de qualquer encerramento — este hook é complementar, não substitui o protocolo.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOOK_DIR/logs"
STATE_DIR="$HOOK_DIR/state"

mkdir -p "$LOG_DIR" && chmod 700 "$LOG_DIR"

INPUT="$(cat 2> /dev/null || true)"

# Extrai campos usando schema real
TIMESTAMP="$(echo "$INPUT" | jq -r '.timestamp // ""' 2> /dev/null || echo '')"
SESSION_ID_PAYLOAD="$(echo "$INPUT" | jq -r '.session_id // ""' 2> /dev/null || echo '')"
NOW_ISO="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo '')"

# session_id: prioriza payload; fallback para contexto
SESSION_ID="$SESSION_ID_PAYLOAD"
CTX_FILE="$STATE_DIR/session-context.json"
if [ -z "$SESSION_ID" ] && [ -f "$CTX_FILE" ]; then
    SESSION_ID="$(jq -r '.session_id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
fi

# Calcula duração aproximada do turno usando last_tool_ts do contexto
TURN_DURATION_S=0
if [ -f "$CTX_FILE" ]; then
    LAST_TOOL_TS="$(jq -r '.last_tool_ts // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    if [ -n "$LAST_TOOL_TS" ] && [ -n "$NOW_ISO" ]; then
        LAST_MS="$(date -d "$LAST_TOOL_TS" '+%s' 2> /dev/null || echo 0)"
        NOW_S="$(date -d "$NOW_ISO" '+%s' 2> /dev/null || echo 0)"
        if [ "$NOW_S" -gt "$LAST_MS" ] 2> /dev/null; then
            TURN_DURATION_S=$((NOW_S - LAST_MS))
        fi
    fi
fi

# Append em audit.jsonl — registra o fim do turno
jq -cn \
    --arg event "agentStop" \
    --arg sid "$SESSION_ID" \
    --arg ts "${TIMESTAMP:-$NOW_ISO}" \
    --argjson dur "$TURN_DURATION_S" \
    '{
        event:           $event,
        session_id:      $sid,
        timestamp:       $ts,
        turn_duration_s: $dur
    }' >> "$LOG_DIR/audit.jsonl"

# AVISO DE ENCERRAMENTO: registra que o turno está encerrando
# O agente deve ter invocado vscode_askQuestions antes de chegar aqui;
# se turn_count > 0 e não houve vscode_askQuestions neste turno, é possível
# que o protocolo de encerramento não foi seguido. Registra para auditoria.
jq -cn \
    --arg event "turnEnd_warning" \
    --arg sid "$SESSION_ID" \
    --arg ts "${NOW_ISO}" \
    --arg msg "Turno encerrado. Agente DEVE ter solicitado autorização via vscode_askQuestions antes de encerrar." \
    '{
        event:   $event,
        session_id: $sid,
        timestamp: $ts,
        message: $msg
    }' >> "$LOG_DIR/audit.jsonl"

# Incrementa turn_count no contexto da sessão
if [ -f "$CTX_FILE" ] && command -v sponge &> /dev/null; then
    jq --arg now "$NOW_ISO" \
        '.turn_count = (.turn_count // 0) + 1 | .last_turn_ts = $now' \
        "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
fi

exit 0
