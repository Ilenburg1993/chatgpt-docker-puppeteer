#!/bin/bash
# resolve-finding.sh — Marca um finding como resolvido em findings.jsonl
#
# Adiciona um evento "findingResolved" no findings.jsonl e audit.jsonl referenciando
# o finding_id original. O arquivo é sempre append-only (JSONL canônico).
# Scripts que listam findings abertos devem filtrar IDs que possuem resolução.
#
# Uso: bash .github/hooks/scripts/resolve-finding.sh \
#         "<finding_id>" ["<observação>"]
#
#   finding_id:  ID único gerado por save-finding.sh (ex: f_1741520123456_17832)
#   observação:  texto livre descrevendo a resolução (ex: "Corrigido via PR #105")
#
# Exemplos:
#   bash .github/hooks/scripts/resolve-finding.sh "f_1741520123456_17832"
#   bash .github/hooks/scripts/resolve-finding.sh "f_1741520123456_17832" "Corrigido via PR #105"
#
# Para listar findings abertos:
#   jq -rs '[.[] | select(.event == "finding")] |
#           map(select(.finding_id as $id |
#               [.[] | select(.event == "findingResolved" and .finding_id == $id)] | length == 0
#           ))' .github/hooks/logs/findings.jsonl
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

FINDING_ID="${1:-}"
OBSERVATION="${2:-}"

if [ -z "$FINDING_ID" ]; then
    echo "Uso: bash resolve-finding.sh <finding_id> [observação]" >&2
    echo "Exemplo: bash resolve-finding.sh f_1741520123456_17832 'Corrigido via PR #105'" >&2
    echo "" >&2
    echo "Para listar IDs disponíveis:" >&2
    echo "  jq -r 'select(.event == \"finding\") | .finding_id' .github/hooks/logs/findings.jsonl" >&2
    exit 1
fi

DATE="$(date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo 'unknown')"
NOW_MS="$(date -u +%s000 2> /dev/null || echo 0)"

# Obtém session_id do contexto persistido
SESSION_ID=""
if [ -f "$STATE_DIR/session-context.json" ]; then
    SESSION_ID="$(jq -r '.session.id // ""' "$STATE_DIR/session-context.json" 2> /dev/null || echo '')"
fi

FINDINGS_FILE="$LOG_DIR/findings.jsonl"

# Verifica se findings.jsonl existe
if [ ! -f "$FINDINGS_FILE" ]; then
    echo "Erro: $FINDINGS_FILE não encontrado." >&2
    exit 1
fi

# Verifica se o finding_id existe no arquivo
FINDING_EXISTS="$(jq -rs --arg id "$FINDING_ID" \
    '[.[] | select(.event == "finding" and .finding_id == $id)] | length' \
    "$FINDINGS_FILE" 2> /dev/null || echo 0)"

if [ "$FINDING_EXISTS" -eq 0 ]; then
    echo "Erro: finding_id '$FINDING_ID' não encontrado em findings.jsonl." >&2
    echo "" >&2
    echo "IDs disponíveis:" >&2
    jq -r 'select(.event == "finding") | "\(.finding_id // "sem-id")  [\(.severity)] \(.description[:60])..."' \
        "$FINDINGS_FILE" 2> /dev/null | head -20 >&2 || true
    exit 1
fi

# Verifica se já foi resolvido (idempotente)
ALREADY_RESOLVED="$(jq -rs --arg id "$FINDING_ID" \
    '[.[] | select(.event == "findingResolved" and .finding_id == $id)] | length' \
    "$FINDINGS_FILE" 2> /dev/null || echo 0)"

if [ "$ALREADY_RESOLVED" -gt 0 ]; then
    echo "⚠️  Finding '$FINDING_ID' já foi marcado como resolvido anteriormente — nenhuma ação tomada." >&2
    exit 0
fi

mkdir -p "$LOG_DIR" && chmod 700 "$LOG_DIR"

# Append evento de resolução em findings.jsonl (append-only, JSONL imutável por design)
jq -cn \
    --arg event "findingResolved" \
    --arg sid "$SESSION_ID" \
    --arg ts "$NOW_MS" \
    --arg date "$DATE" \
    --arg id "$FINDING_ID" \
    --arg obs "$OBSERVATION" \
    '{event:$event, session_id:$sid, timestamp:$ts, date:$date, finding_id:$id, observation:$obs}' \
    >> "$FINDINGS_FILE"

# Também registra no audit.jsonl para visibilidade geral
jq -cn \
    --arg event "findingResolved" \
    --arg sid "$SESSION_ID" \
    --arg ts "$NOW_MS" \
    --arg id "$FINDING_ID" \
    --arg obs "$OBSERVATION" \
    '{event:$event, session_id:$sid, timestamp:$ts, finding_id:$id, observation:$obs}' \
    >> "$AUDIT_FILE"

# Recupera info do finding original para exibição amigável
FINDING_MOD="$(jq -rs --arg id "$FINDING_ID" \
    '.[] | select(.event == "finding" and .finding_id == $id) | .module' \
    "$FINDINGS_FILE" 2> /dev/null | head -1 || echo '')"
FINDING_SEV="$(jq -rs --arg id "$FINDING_ID" \
    '.[] | select(.event == "finding" and .finding_id == $id) | .severity' \
    "$FINDINGS_FILE" 2> /dev/null | head -1 || echo '')"
FINDING_DESC="$(jq -rs --arg id "$FINDING_ID" \
    '.[] | select(.event == "finding" and .finding_id == $id) | .description' \
    "$FINDINGS_FILE" 2> /dev/null | head -1 || echo '')"

echo "✅ Finding resolvido: [${FINDING_SEV:-?}] ${FINDING_ID}"
[ -n "$FINDING_MOD" ] && echo "   Módulo:    ${FINDING_MOD}"
[ -n "$FINDING_DESC" ] && echo "   Descrição: ${FINDING_DESC}" | cut -c1-110
[ -n "$OBSERVATION" ] && echo "   Resolução: ${OBSERVATION}"
exit 0
