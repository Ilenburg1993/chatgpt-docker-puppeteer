#!/bin/bash
# start-turn.sh — Enriquecimento manual de início de TURN (Schema v4)
#
# O sistema registra automaticamente o início de todo turno via `userPromptSubmitted`
# (hook log-prompt.sh). Este script complementa esse registro com informações que
# apenas o agente possui: a INTENÇÃO declarada para o turno atual.
#
# QUANDO CHAMAR:
#   Como PRIMEIRO ATO do agente em cada turno, antes de qualquer ferramenta de trabalho.
#   Pode ser omitido em turnos puramente informativos (ex: responder uma pergunta simples).
#
# INVARIANTE (Schema v4):
#   Sempre deve haver SESSION + SECTION + TURN ativos.
#   Este script NÃO inicia o TURN (isso é automático via log-prompt.sh).
#   Este script DECLARA A INTENÇÃO do agente para o turno já em andamento.
#
# Uso: bash start-turn.sh ["<intenção do turno>"]
# Exemplos:
#   bash start-turn.sh
#   bash start-turn.sh "Implementar Fase A do plano de consolidação"
#   bash start-turn.sh "Corrigir bug no start-section.sh e rodar smoke-test"
#
# Loga em audit.jsonl: evento "turnStart_enriched"
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOOK_DIR/logs"
STATE_DIR="$HOOK_DIR/state"
CTX_FILE="$STATE_DIR/session-context.json"

mkdir -p "$LOG_DIR" "$STATE_DIR"

TURN_INTENT="${1:-}"

NOW_ISO="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

# Lê contexto atual
SESSION_ID="unknown"
TURN_NUMBER=1
SECTION_NAME=""

if [ -f "$CTX_FILE" ]; then
    SESSION_ID="$(jq -r '.session.id // "unknown"' "$CTX_FILE" 2> /dev/null || echo 'unknown')"
    TURN_NUMBER="$(jq -r '.current_turn.number // 1' "$CTX_FILE" 2> /dev/null || echo 1)"
    SECTION_NAME="$(jq -r '.current_section.name // ""' "$CTX_FILE" 2> /dev/null || echo '')"
fi

# Loga turnStart_enriched no audit.jsonl
jq -cn \
    --arg event "turnStart_enriched" \
    --arg sid "$SESSION_ID" \
    --arg ts "$NOW_ISO" \
    --argjson turn_number "$TURN_NUMBER" \
    --arg section_name "$SECTION_NAME" \
    --arg intent "$TURN_INTENT" \
    '{
        event:        $event,
        session_id:   $sid,
        timestamp:    $ts,
        turn_number:  $turn_number,
        section_name: (if $section_name == "" then null else $section_name end),
        intent:       (if $intent == "" then null else $intent end),
        auto_generated: false
    }' >> "$LOG_DIR/audit.jsonl"

# Sinaliza que a intenção foi declarada para o rastreamento de turno
if [ -f "$CTX_FILE" ] && command -v sponge &> /dev/null; then
    jq '.current_turn.intent_declared = true
         | .current_turn.intent = $intent' \
        --arg intent "$TURN_INTENT" \
        "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || true
elif [ -f "$CTX_FILE" ]; then
    TMP="$(mktemp)"
    jq '.current_turn.intent_declared = true
         | .current_turn.intent = $intent' \
        --arg intent "$TURN_INTENT" \
        "$CTX_FILE" > "$TMP" && mv "$TMP" "$CTX_FILE"
fi
