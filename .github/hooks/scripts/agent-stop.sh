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

# ── Detecção de autorização: verifica se vscode_askQuestions foi chamada neste turno ──
# Estratégia em camadas (do mais preciso ao mais tolerante):
#   1. Fronteira por userPromptSubmitted (preciso): busca após o último prompt do usuário
#   2. Fallback por contexto (via session-context.json): flag auth_requested_this_turn
#   3. Fallback por recência (últimas 150 linhas): se vscode_askQuestions aparece no final do log
# Se qualquer das três confirmar, o turno é considerado autorizado.
AUTH_FLAG_FILE="$STATE_DIR/UNAUTHORIZED_CLOSE.flag"
AUTH_REQUESTED=false
AUDIT_FILE="$LOG_DIR/audit.jsonl"

if [ -f "$AUDIT_FILE" ]; then
    # Estratégia 1: fronteira por userPromptSubmitted
    LAST_PROMPT_LINE="$(awk '/"userPromptSubmitted"/{last=NR} END{print last+0}' "$AUDIT_FILE")"
    TOTAL_LINES="$(wc -l < "$AUDIT_FILE")"

    if [ "$LAST_PROMPT_LINE" -gt 0 ] && [ "$TOTAL_LINES" -gt "$LAST_PROMPT_LINE" ]; then
        LINES_SINCE_PROMPT=$((TOTAL_LINES - LAST_PROMPT_LINE))
        if tail -n "$LINES_SINCE_PROMPT" "$AUDIT_FILE" \
            | jq -re 'select(.tool_name == "vscode_askQuestions")' > /dev/null 2>&1; then
            AUTH_REQUESTED=true
        fi
    fi

    # Estratégia 2 (fallback): userPromptSubmitted ausente — verifica últimas 150 linhas
    # Isso protege contra false-positives quando o hook userPromptSubmitted não disparou.
    if [ "$AUTH_REQUESTED" = "false" ] && [ "$LAST_PROMPT_LINE" -eq 0 ]; then
        RECENT_LINES=150
        if [ "$TOTAL_LINES" -lt "$RECENT_LINES" ]; then
            RECENT_LINES="$TOTAL_LINES"
        fi
        if tail -n "$RECENT_LINES" "$AUDIT_FILE" \
            | jq -re 'select(.tool_name == "vscode_askQuestions")' > /dev/null 2>&1; then
            AUTH_REQUESTED=true
        fi
    fi
fi

# Estratégia 3 (fallback de contexto): lê flag do session-context.json
if [ "$AUTH_REQUESTED" = "false" ] && [ -f "$CTX_FILE" ]; then
    CTX_FLAG="$(jq -r '.auth_requested_this_turn // false' "$CTX_FILE" 2> /dev/null || echo false)"
    if [ "$CTX_FLAG" = "true" ]; then
        AUTH_REQUESTED=true
    fi
fi

if [ "$AUTH_REQUESTED" = "true" ]; then
    # Turno encerrado com autorização: remove flag de violação anterior (se existir)
    rm -f "$AUTH_FLAG_FILE" 2> /dev/null || true
    if [ -f "$CTX_FILE" ] && command -v sponge &> /dev/null; then
        jq '.last_close_authorized = true | .consecutive_unauthorized_closes = 0' \
            "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
    fi
    jq -cn \
        --arg event "turnEnd_authorized" \
        --arg sid "$SESSION_ID" \
        --arg ts "$NOW_ISO" \
        '{event: $event, session_id: $sid, timestamp: $ts}' \
        >> "$LOG_DIR/audit.jsonl"
else
    # Turno encerrado SEM autorização: escreve flag persistente
    TURN_COUNT_NOW="$(jq -r '.turn_count // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
    jq -cn \
        --arg ts "$NOW_ISO" \
        --arg sid "$SESSION_ID" \
        --argjson turn "$TURN_COUNT_NOW" \
        '{
            timestamp:  $ts,
            session_id: $sid,
            turn_count: $turn,
            violation:  "Turno encerrado sem chamar vscode_askQuestions",
            severity:   "critical"
        }' > "$AUTH_FLAG_FILE"
    if [ -f "$CTX_FILE" ] && command -v sponge &> /dev/null; then
        jq '.last_close_authorized = false
             | .consecutive_unauthorized_closes = (.consecutive_unauthorized_closes // 0) + 1' \
            "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
    fi
    jq -cn \
        --arg event "turnEnd_UNAUTHORIZED" \
        --arg sid "$SESSION_ID" \
        --arg ts "$NOW_ISO" \
        --arg msg "VIOLAÇÃO: turno encerrado sem vscode_askQuestions. Flag gravada em UNAUTHORIZED_CLOSE.flag" \
        '{event: $event, session_id: $sid, timestamp: $ts, message: $msg}' \
        >> "$LOG_DIR/audit.jsonl"
fi

# Incrementa turn_count, reseta auth flag e salva session_summary no contexto da sessão
if [ -f "$CTX_FILE" ] && command -v sponge &> /dev/null; then
    # Contagem de tools usadas neste turno (via tools_used_total)
    TOOLS_USED_COUNT="$(jq -r '.tools_used_total // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
    SESSION_SUMMARY="turn=${TURN_DURATION_S}s tools=${TOOLS_USED_COUNT} last=${LAST_TOOL_TS:-N/D}"
    # CRÍTICO: reseta auth_requested_this_turn para false após processamento do turno.
    # Sem este reset, a Estratégia 3 produziria falsos positivos no turno seguinte
    # caso o agente não chamasse vscode_askQuestions mas o flag ficasse true do turno anterior.
    jq --arg now "$NOW_ISO" --arg summary "$SESSION_SUMMARY" \
        '.turn_count = (.turn_count // 0) + 1
         | .last_turn_ts = $now
         | .session_summary = $summary
         | .auth_requested_this_turn = false
         | .auth_requested_at = null' \
        "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
fi

# ── Checkpoint de estado do turno ──────────────────────────────────────────
# Salva snapshot incremental para persistência máxima entre sessões.
CHECKPOINT_SCRIPT="$(dirname "${BASH_SOURCE[0]}")/session-checkpoint.sh"
if [ -f "$CHECKPOINT_SCRIPT" ]; then
    bash "$CHECKPOINT_SCRIPT" 2> /dev/null || true
fi

# ── Sync automático de tarefas para DOCUMENTACAO/ (a cada 5 turnos) ──────────────
# Gera relatório de tarefas com cross-reference de findings sem bloquear o turno.
TURN_COUNT_SYNC="$(jq -r '.turn_count // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
SYNC_SCRIPT="$(dirname "${BASH_SOURCE[0]}")/sync-tasks-to-docs.sh"
if [ -f "$SYNC_SCRIPT" ] && [ $((TURN_COUNT_SYNC % 5)) -eq 0 ] && [ "$TURN_COUNT_SYNC" -gt 0 ]; then
    bash "$SYNC_SCRIPT" 2> /dev/null || true
fi

exit 0
