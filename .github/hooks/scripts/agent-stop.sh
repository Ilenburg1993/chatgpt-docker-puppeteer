#!/bin/bash
# agent-stop.sh — Hook agentStop do Copilot
# Executado quando o agente termina de responder ao prompt (fim de turno).
# Input JSON (stdin): {timestamp, hook_event_name, session_id, ...}
# Output: ignorado pelo Copilot.
#
# PROTOCOLO DE ENCERRAMENTO: detecta fins de turno e verifica autorização.
# O agente DEVE usar vscode_askQuestions antes de encerrar — este hook faz a
# verificação post-hoc e registra conformidade ou violação.
#
# Schema v2:
#   - Calcula turn_duration a partir de current_turn.started_at (fix B3)
#   - session_summary usa métricas DO TURNO, não da sessão (fix B4)
#   - Reseta current_turn.* e incrementa session_stats.* após cada turno
#   - compliance.* controla o estado de autorização
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOOK_DIR/logs"
STATE_DIR="$HOOK_DIR/state"
CTX_FILE="$STATE_DIR/session-context.json"

mkdir -p "$LOG_DIR" && chmod 700 "$LOG_DIR"

INPUT="$(cat 2> /dev/null || true)"

# Extrai campos usando schema real
TIMESTAMP="$(echo "$INPUT" | jq -r '.timestamp // ""' 2>/dev/null || echo '')"
SESSION_ID_PAYLOAD="$(echo "$INPUT" | jq -r '.session_id // ""' 2>/dev/null || echo '')"
NOW_ISO="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || echo '')"

# session_id: prioriza payload; fallback para contexto
SESSION_ID="$SESSION_ID_PAYLOAD"
if [ -z "$SESSION_ID" ] && [ -f "$CTX_FILE" ]; then
    SESSION_ID="$(jq -r '.session.id // ""' "$CTX_FILE" 2>/dev/null || echo '')"
fi

# ── Calcula duração do turno — fix B3 ────────────────────────────────────────
# Usa current_turn.started_at (timestamp de userPromptSubmitted) em vez de
# last_tool_ts, que apenas reflete o último tool call (impreciso para o turno todo).
TURN_DURATION_S=0
TURN_STARTED_AT=""
if [ -f "$CTX_FILE" ]; then
    TURN_STARTED_AT="$(jq -r '.current_turn.started_at // ""' "$CTX_FILE" 2>/dev/null || echo '')"
    if [ -n "$TURN_STARTED_AT" ] && [ -n "$NOW_ISO" ]; then
        TURN_START_S="$(date -d "$TURN_STARTED_AT" '+%s' 2>/dev/null || echo 0)"
        NOW_S="$(date -d "$NOW_ISO" '+%s' 2>/dev/null || echo 0)"
        if [ "$NOW_S" -gt "$TURN_START_S" ] 2>/dev/null; then
            TURN_DURATION_S=$((NOW_S - TURN_START_S))
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

# ── Detecção de autorização ───────────────────────────────────────────────────
# Estratégia em camadas (do mais preciso ao mais tolerante):
#   1. Fronteira por userPromptSubmitted (preciso): busca após o último prompt
#   2. Fallback por recência (últimas 150 linhas): quando userPromptSubmitted ausente
#   3. Fallback de contexto: lê current_turn.auth_requested do session-context.json
AUTH_FLAG_FILE="$STATE_DIR/UNAUTHORIZED_CLOSE.flag"
AUTHORIZED_FLAG_FILE="$STATE_DIR/AUTHORIZED_CLOSE.flag"
AUTH_REQUESTED=false
AUDIT_FILE="$LOG_DIR/audit.jsonl"

if [ -f "$AUDIT_FILE" ]; then
    # Estratégia 1: fronteira por userPromptSubmitted
    LAST_PROMPT_LINE="$(awk '/"userPromptSubmitted"/{last=NR} END{print last+0}' "$AUDIT_FILE")"
    TOTAL_LINES="$(wc -l < "$AUDIT_FILE")"

    if [ "$LAST_PROMPT_LINE" -gt 0 ] && [ "$TOTAL_LINES" -gt "$LAST_PROMPT_LINE" ]; then
        LINES_SINCE_PROMPT=$((TOTAL_LINES - LAST_PROMPT_LINE))
        if tail -n "$LINES_SINCE_PROMPT" "$AUDIT_FILE" \
            | jq -re 'select(.tool_name == "vscode_askQuestions")' >/dev/null 2>&1; then
            AUTH_REQUESTED=true
        fi
    fi

    # Estratégia 2 (fallback): userPromptSubmitted ausente — verifica últimas 150 linhas
    if [ "$AUTH_REQUESTED" = "false" ] && [ "$LAST_PROMPT_LINE" -eq 0 ]; then
        RECENT_LINES=150
        if [ "$TOTAL_LINES" -lt "$RECENT_LINES" ]; then RECENT_LINES="$TOTAL_LINES"; fi
        if tail -n "$RECENT_LINES" "$AUDIT_FILE" \
            | jq -re 'select(.tool_name == "vscode_askQuestions")' >/dev/null 2>&1; then
            AUTH_REQUESTED=true
        fi
    fi
fi

# Estratégia 3 (fallback de contexto): lê flag do session-context.json
# Schema v2: current_turn.auth_requested; legado: auth_requested_this_turn
if [ "$AUTH_REQUESTED" = "false" ] && [ -f "$CTX_FILE" ]; then
    CTX_FLAG="$(jq -r '
        .current_turn.auth_requested //
        .auth_requested_this_turn //
        false' "$CTX_FILE" 2>/dev/null || echo false)"
    if [ "$CTX_FLAG" = "true" ]; then AUTH_REQUESTED=true; fi
fi

# ── Lê métricas do turno atual (para session_summary — fix B4) ───────────────
TURN_TOOLS_COUNT=0
TURN_NUMBER=0
if [ -f "$CTX_FILE" ]; then
    TURN_TOOLS_COUNT="$(jq -r '.current_turn.tools_count // 0' "$CTX_FILE" 2>/dev/null || echo 0)"
    TURN_NUMBER="$(jq -r '.current_turn.number // 0' "$CTX_FILE" 2>/dev/null || echo 0)"
fi

# ── Registra resultado do turno e atualiza compliance ────────────────────────
if [ "$AUTH_REQUESTED" = "true" ]; then
    rm -f "$AUTH_FLAG_FILE" 2>/dev/null || true
    # Cria flag de autorização (simétrico ao UNAUTHORIZED_CLOSE.flag para auditoria bidirecional)
    TURN_COUNT_NOW="$(jq -r '.session_stats.turn_count // 0' "$CTX_FILE" 2>/dev/null || echo 0)"
    jq -cn \
        --arg ts "$NOW_ISO" \
        --arg sid "$SESSION_ID" \
        --argjson turn "$TURN_COUNT_NOW" \
        '{
            timestamp:  $ts,
            session_id: $sid,
            turn_count: $turn,
            authorized: true
        }' > "$AUTHORIZED_FLAG_FILE"
    if [ -f "$CTX_FILE" ] && command -v sponge &>/dev/null; then
        jq '.compliance.last_turn_authorized     = true
             | .compliance.consecutive_unauthorized = 0
             | .compliance.flag_file_exists        = false' \
            "$CTX_FILE" | sponge "$CTX_FILE" 2>/dev/null || true
    fi
    jq -cn \
        --arg event "turnEnd_authorized" \
        --arg sid "$SESSION_ID" \
        --arg ts "$NOW_ISO" \
        '{event: $event, session_id: $sid, timestamp: $ts}' \
        >> "$LOG_DIR/audit.jsonl"
else
    TURN_COUNT_NOW="$(jq -r '.session_stats.turn_count // 0' "$CTX_FILE" 2>/dev/null || echo 0)"
    rm -f "$AUTHORIZED_FLAG_FILE" 2>/dev/null || true  # remove flag de autorização caso exista
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
    if [ -f "$CTX_FILE" ] && command -v sponge &>/dev/null; then
        jq '.compliance.last_turn_authorized = false
             | .compliance.consecutive_unauthorized = (.compliance.consecutive_unauthorized // 0) + 1
             | .compliance.flag_file_exists = true' \
            "$CTX_FILE" | sponge "$CTX_FILE" 2>/dev/null || true
    fi
    jq -cn \
        --arg event "turnEnd_UNAUTHORIZED" \
        --arg sid "$SESSION_ID" \
        --arg ts "$NOW_ISO" \
        --arg msg "VIOLAÇÃO: turno encerrado sem vscode_askQuestions. Flag gravada em UNAUTHORIZED_CLOSE.flag" \
        '{event: $event, session_id: $sid, timestamp: $ts, message: $msg}' \
        >> "$LOG_DIR/audit.jsonl"
fi

# ── Incrementa session_stats, constrói session_summary e reseta current_turn ──
# CRÍTICO: reseta current_turn.auth_requested para false APÓS processamento.
# Sem este reset, a Estratégia 3 produziria falsos positivos no turno seguinte.
# session_summary usa métricas DO TURNO ATUAL (fix B4), não totais da sessão.
if [ -f "$CTX_FILE" ] && command -v sponge &>/dev/null; then
    SESSION_SUMMARY="turn=${TURN_NUMBER} dur=${TURN_DURATION_S}s tools=${TURN_TOOLS_COUNT}"
    AUTH_INCR_FIELD="$([ "$AUTH_REQUESTED" = "true" ] && echo 'turn_authorized' || echo 'turn_unauthorized')"
    jq --arg now "$NOW_ISO" \
       --arg summary "$SESSION_SUMMARY" \
       --arg auth_field "$AUTH_INCR_FIELD" \
        '.session_stats.turn_count    = (.session_stats.turn_count // 0) + 1
         | .session_stats[$auth_field] = (.session_stats[$auth_field] // 0) + 1
         | .last_turn_ts              = $now
         | .session_summary           = $summary
         | .current_turn.auth_requested    = false
         | .current_turn.auth_requested_at = null' \
        "$CTX_FILE" | sponge "$CTX_FILE" 2>/dev/null || true
fi

# ── Checkpoint de estado do turno ────────────────────────────────────────────
CHECKPOINT_SCRIPT="$(dirname "${BASH_SOURCE[0]}")/session-checkpoint.sh"
if [ -f "$CHECKPOINT_SCRIPT" ]; then
    bash "$CHECKPOINT_SCRIPT" 2>/dev/null || true
fi

# ── Sync automático de tarefas para DOCUMENTACAO/ (a cada 5 turnos) ──────────
TURN_COUNT_SYNC="$(jq -r '.session_stats.turn_count // 0' "$CTX_FILE" 2>/dev/null || echo 0)"
SYNC_SCRIPT="$(dirname "${BASH_SOURCE[0]}")/sync-tasks-to-docs.sh"
if [ -f "$SYNC_SCRIPT" ] && [ $((TURN_COUNT_SYNC % 5)) -eq 0 ] && [ "$TURN_COUNT_SYNC" -gt 0 ]; then
    bash "$SYNC_SCRIPT" 2>/dev/null || true
fi
