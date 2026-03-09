#!/bin/bash
# save-finding.sh — Registra um finding de auditoria em findings.jsonl
#
# Uso: bash .github/hooks/scripts/save-finding.sh \
#         "<módulo>" "<severity>" "<type>" "<descrição>"
#
#   módulo:   e.g. "src/kernel/", "src/driver/factory.js", "tests/unit/"
#   severity: critical | high | medium | low | info
#   type:     bug | gap | improvement | vulnerability | performance | debt
#   descrição: texto livre descrevendo o finding
#
# Exemplos:
#   bash .github/hooks/scripts/save-finding.sh \
#       "src/infra/browser_pool/" "high" "bug" \
#       "pool.acquire() pode retornar handle fechado se o Chrome reiniciar durante acquire"
#
#   bash .github/hooks/scripts/save-finding.sh \
#       "src/kernel/execution_engine/" "medium" "gap" \
#       "Nenhum teste para o caminho de timeout de execução"
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOOK_DIR/logs"
STATE_DIR="$HOOK_DIR/state"

MODULE="${1:-unknown}"
SEVERITY="${2:-medium}"
TYPE="${3:-bug}"
DESCRIPTION="${4:-}"
NOW_MS="$(date -u +%s000 2> /dev/null || echo 0)"
DATE="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo 'unknown')"
# ID único: timestamp_ms + RANDOM (bash built-in) garante unicidade mesmo no mesmo segundo
FINDING_ID="f_$(date +%s%3N 2> /dev/null || echo 0)_${RANDOM}"

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

# Obtém session_id do contexto persistido
SESSION_ID=""
if [ -f "$STATE_DIR/session-context.json" ]; then
    SESSION_ID="$(jq -r '.session_id // ""' "$STATE_DIR/session-context.json" 2> /dev/null || echo '')"
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
    '{event:$event,session_id:$sid,timestamp:$ts,date:$date,finding_id:$fid,module:$mod,severity:$severity,type:$type,description:$desc}' >> "$LOG_DIR/findings.jsonl"

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
    '{event:$event,session_id:$sid,timestamp:$ts,finding_id:$fid,module:$mod,severity:$severity,type:$type,description:$desc}' >> "$LOG_DIR/audit.jsonl"

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
exit 0
