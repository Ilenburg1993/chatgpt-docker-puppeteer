#!/bin/bash
# start-section.sh — Declara início de uma Seção Temática
#
# Uma Seção Temática é uma fase lógica nomeada dentro de uma sessão Copilot,
# declarada pelo próprio agente para marcar mudanças de contexto de trabalho.
# Exemplos: "planejamento", "implementação", "revisão", "debugging", "testes".
#
# Conceitos do sistema de hooks:
#   Sessão        — UUID gerado pelo Copilot (sessionStart → sessionEnd)
#   Turno         — Ciclo prompt→agentStop (userPromptSubmitted → agentStop)
#   Chamada       — Uso de ferramenta (preToolUse → postToolUse)
#   Seção Temática — Fase lógica declarada pelo agente via este script
#
# Uso: bash start-section.sh "<nome da seção>"
# Exemplo: bash start-section.sh "implementação do schema v2"
#
# Armazena em session-context.json: active_section.{name, started_at, turn_number}
# Logs em audit.jsonl: evento "sectionStart"
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOOK_DIR/logs"
STATE_DIR="$HOOK_DIR/state"
CTX_FILE="$STATE_DIR/session-context.json"

mkdir -p "$LOG_DIR" "$STATE_DIR"

SECTION_NAME="${1:-}"

if [ -z "$SECTION_NAME" ]; then
    echo "Uso: bash start-section.sh \"<nome da seção>\"" >&2
    echo "Exemplo: bash start-section.sh \"implementação do schema v2\"" >&2
    exit 1
fi

NOW_ISO="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"

# Lê contexto atual
SESSION_ID="unknown"
TURN_NUMBER=0
if [ -f "$CTX_FILE" ]; then
    SESSION_ID="$(jq -r '.session.id // "unknown"' "$CTX_FILE" 2>/dev/null || echo 'unknown')"
    TURN_NUMBER="$(jq -r '.session_stats.turn_count // 0' "$CTX_FILE" 2>/dev/null || echo 0)"
fi

# Calcula o número do turno atual (turn_count + 1, pois turn_count é incrementado no agentStop)
CURRENT_TURN=$((TURN_NUMBER + 1))

# Atualiza session-context.json com a seção ativa
if [ -f "$CTX_FILE" ] && command -v sponge &>/dev/null; then
    jq --arg name "$SECTION_NAME" \
       --arg ts "$NOW_ISO" \
       --argjson turn "$CURRENT_TURN" \
       '.active_section = {name: $name, started_at: $ts, turn_number: $turn}' \
       "$CTX_FILE" | sponge "$CTX_FILE" 2>/dev/null
elif [ -f "$CTX_FILE" ]; then
    TMP="$(mktemp)"
    jq --arg name "$SECTION_NAME" \
       --arg ts "$NOW_ISO" \
       --argjson turn "$CURRENT_TURN" \
       '.active_section = {name: $name, started_at: $ts, turn_number: $turn}' \
       "$CTX_FILE" > "$TMP" && mv "$TMP" "$CTX_FILE"
fi

# Registra evento sectionStart no audit.jsonl
jq -cn \
    --arg event "sectionStart" \
    --arg sid "$SESSION_ID" \
    --arg ts "$NOW_ISO" \
    --arg name "$SECTION_NAME" \
    --argjson turn "$CURRENT_TURN" \
    '{
        event:        $event,
        session_id:   $sid,
        timestamp:    $ts,
        section_name: $name,
        turn_number:  $turn
    }' >> "$LOG_DIR/audit.jsonl"

echo "[seção] Iniciando: \"$SECTION_NAME\" (turno ~$CURRENT_TURN)" >&2
exit 0
