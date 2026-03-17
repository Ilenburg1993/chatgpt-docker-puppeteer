#!/bin/bash
# save-finding.sh — Registra um finding de auditoria em findings.jsonl
#
# Uso: bash .github/hooks/scripts/save-finding.sh \
#         "<módulo>" "<severity>" "<type>" "<descrição>" [--create-task <prioridade>]
#
#   módulo:         e.g. "src/kernel/", "src/driver/factory.js", "tests/unit/"
#   severity:       critical | high | medium | low | info
#   type:           bug | gap | improvement | vulnerability | performance | debt
#   descrição:      texto livre descrevendo o finding
#   --create-task:  cria automaticamente uma tarefa vinculada (prioridade: alta|media|backlog)
#
# Exemplos:
#   bash .github/hooks/scripts/save-finding.sh \
#       "src/infra/browser_pool/" "high" "bug" \
#       "pool.acquire() pode retornar handle fechado se o Chrome reiniciar durante acquire"
#
#   bash .github/hooks/scripts/save-finding.sh \
#       "src/kernel/execution_engine/" "medium" "gap" \
#       "Nenhum teste para o caminho de timeout de execução" \
#       --create-task media
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOOK_DIR/logs"
STATE_DIR="$HOOK_DIR/state"
AUDIT_FILE="$LOG_DIR/audit.jsonl"
# UPG-AUDIT-01: resolve per-session paths from current-session-id.txt
_UPG_CSI="${STATE_DIR}/current-session-id.txt"
if [ -f "$_UPG_CSI" ]; then
    _UPG_SID_FULL="$(cat "$_UPG_CSI" 2> /dev/null || true)"
    _UPG_SID_SHORT="${_UPG_SID_FULL:0:8}"
    if [ -n "$_UPG_SID_SHORT" ]; then
        AUDIT_FILE="${LOG_DIR}/audit-${_UPG_SID_SHORT}.jsonl"
        mkdir -p "$(dirname "$AUDIT_FILE")" 2> /dev/null || true
    fi
fi

MODULE="${1:-unknown}"
SEVERITY="${2:-medium}"
TYPE="${3:-bug}"
DESCRIPTION="${4:-}"
CREATE_TASK_PRIORITY=""

# Opções extras a partir do 5º argumento
shift 4 || true
while [ $# -gt 0 ]; do
    case "${1:-}" in
        --create-task)
            shift
            CREATE_TASK_PRIORITY="${1:-backlog}"
            ;;
    esac
    shift
done
NOW_MS="$(date -u +%s000 2> /dev/null || echo 0)"
DATE="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo 'unknown')"
# BUG-64 FIX: date +%s%3N não é suportado em BSD
# ID único: timestamp_s + RANDOM + PID (bash built-in + processo) garante unicidade
FINDING_ID="f_$(date +%s 2> /dev/null || echo 0)_${RANDOM}_$$"

# Valida severity
case "$SEVERITY" in
    critical | high | medium | low | info) ;;
    *)
        echo "Severity inválida: '$SEVERITY'. Use: critical | high | medium | low | info" >&2
        exit 1
        ;;
esac

# Valida type
case "$TYPE" in
    bug | gap | improvement | vulnerability | performance | debt) ;;
    *)
        echo "Type inválido: '$TYPE'. Use: bug | gap | improvement | vulnerability | performance | debt" >&2
        exit 1
        ;;
esac

if [ -z "$DESCRIPTION" ]; then
    echo "Erro: descrição é obrigatória." >&2
    exit 1
fi

# Obtém session_id, section_id e turn_id do contexto persistido
SESSION_ID=""
SECTION_ID=""
TURN_ID=""
if [ -f "$STATE_DIR/session-context.json" ]; then
    SESSION_ID="$(jq -r '.session.id // .session_id // ""' "$STATE_DIR/session-context.json" 2> /dev/null || echo '')"
    SECTION_ID="$(jq -r '.current_section.section_id // ""' "$STATE_DIR/session-context.json" 2> /dev/null || echo '')"
    TURN_ID="$(jq -r '.current_turn.turn_id // ""' "$STATE_DIR/session-context.json" 2> /dev/null || echo '')"
fi

mkdir -p "$LOG_DIR" && chmod 700 "$LOG_DIR"

# Grava em findings.jsonl (separado de audit.jsonl para facilitar queries)
jq -cn \
    --arg event "finding" \
    --arg sid "$SESSION_ID" \
    --arg ts "$NOW_MS" \
    --arg date "$DATE" \
    --arg fid "$FINDING_ID" \
    --arg mod "$MODULE" \
    --arg severity "$SEVERITY" \
    --arg type "$TYPE" \
    --arg desc "$DESCRIPTION" \
    --arg section_id "${SECTION_ID:-}" \
    --arg turn_id "${TURN_ID:-}" \
    '{event:$event,session_id:$sid,timestamp:$ts,date:$date,finding_id:$fid,module:$mod,severity:$severity,type:$type,description:$desc,section_id:(if $section_id=="" then null else $section_id end),turn_id:(if $turn_id=="" then null else $turn_id end)}' >> "$LOG_DIR/findings.jsonl"

# Também registra no audit.jsonl para visibilidade geral
jq -cn \
    --arg event "finding" \
    --arg sid "$SESSION_ID" \
    --arg ts "$NOW_MS" \
    --arg fid "$FINDING_ID" \
    --arg mod "$MODULE" \
    --arg severity "$SEVERITY" \
    --arg type "$TYPE" \
    --arg desc "$DESCRIPTION" \
    --arg section_id "${SECTION_ID:-}" \
    --arg turn_id "${TURN_ID:-}" \
    '{event:$event,session_id:$sid,timestamp:$ts,finding_id:$fid,module:$mod,severity:$severity,type:$type,description:$desc,section_id:(if $section_id=="" then null else $section_id end),turn_id:(if $turn_id=="" then null else $turn_id end)}' >> "$AUDIT_FILE"

# Indicador visual com ícone de severidade
case "$SEVERITY" in
    critical) ICON="🔴" ;;
    high) ICON="🟠" ;;
    medium) ICON="🟡" ;;
    low) ICON="🔵" ;;
    info) ICON="⚪" ;;
    *) ICON="⚫" ;;
esac

echo "${ICON} Finding registrado [${SEVERITY}/${TYPE}] ${FINDING_ID} em ${MODULE}: ${DESCRIPTION}"

# Se --create-task foi passado, cria tarefa vinculada automaticamente
if [ -n "$CREATE_TASK_PRIORITY" ]; then
    SCRIPT_DIR="$(dirname "${BASH_SOURCE[0]}")"
    TASK_TITLE="Fix [${SEVERITY}/${TYPE}] ${MODULE}: ${DESCRIPTION}"
    bash "$SCRIPT_DIR/add-task.sh" "$CREATE_TASK_PRIORITY" "$TASK_TITLE" "" --finding-id "$FINDING_ID"
fi

exit 0
