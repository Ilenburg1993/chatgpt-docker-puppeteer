#!/bin/bash
# add-task.sh — Adiciona uma tarefa ao pending-tasks.md autonomamente
#
# Uso: bash .github/hooks/scripts/add-task.sh <prioridade> "<Título>" ["<Descrição>"] [--finding-id <id>]
#   prioridade:   alta | media | backlog
#   título:       texto curto e descritivo (obrigatório)
#   descrição:    detalhes e gates de aceitação (opcional)
#   --finding-id: vincula a tarefa a um finding (e.g. f_1741520123456_17832)
#
# Exemplos:
#   bash .github/hooks/scripts/add-task.sh alta \
#     "Corrigir race condition em browser_pool" \
#     "pool.acquire() pode retornar handle fechado sob carga. Gate: test:integration passa."
#
#   bash .github/hooks/scripts/add-task.sh alta \
#     "Fix [high/bug]: pool.acquire retorna handle fechado" \
#     "" --finding-id f_1741520123456_17832
#
# A tarefa é inserida logo após o cabeçalho da seção correspondente,
# garantindo que novas tarefas LLM-geradas apareçam no topo da seção.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TASKS_FILE="$HOOK_DIR/state/pending-tasks.md"
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

# Parsing de argumentos: posicionais + --finding-id opcional em qualquer posição
PRIORITY=""
TITLE=""
DESCRIPTION=""
FINDING_ID_TAG=""
POS_COUNT=0

while [ $# -gt 0 ]; do
    case "${1:-}" in
        --finding-id)
            shift
            FINDING_ID_TAG="${1:-}"
            ;;
        *)
            POS_COUNT=$((POS_COUNT + 1))
            case "$POS_COUNT" in
                1) PRIORITY="${1:-}" ;;
                2) TITLE="${1:-}" ;;
                3) DESCRIPTION="${1:-}" ;;
            esac
            ;;
    esac
    shift
done

[ -z "$PRIORITY" ] && PRIORITY="backlog"
DATE="$(date -u '+%Y%m%d')"
NOW_MS="$(date -u +%s000 2> /dev/null || echo 0)"

if [ -z "$TITLE" ]; then
    echo "Erro: título da tarefa é obrigatório." >&2
    echo "Uso: add-task.sh <alta|media|backlog> \"<Título>\" [\"<Descrição>\"] [--finding-id <id>]" >&2
    exit 1
fi

if [ ! -f "$TASKS_FILE" ]; then
    echo "Erro: arquivo pending-tasks.md não encontrado em $TASKS_FILE" >&2
    exit 1
fi

# Obtém session_id do contexto persistido
SESSION_ID=""
if [ -f "$STATE_DIR/session-context.json" ]; then
    SESSION_ID="$(jq -r '.session.id // ""' "$STATE_DIR/session-context.json" 2> /dev/null || echo '')"
fi

# Determina a âncora da seção-alvo
case "$PRIORITY" in
    alta) ANCHOR="## Alta Prioridade" ;;
    media) ANCHOR="## Média Prioridade" ;;
    backlog) ANCHOR="## Backlog Livre" ;;
    *)
        echo "Prioridade inválida: '$PRIORITY'. Use alta | media | backlog." >&2
        exit 1
        ;;
esac

# Monta a linha da tarefa (inclui finding_id se fornecido)
FINDING_TAG=""
[ -n "$FINDING_ID_TAG" ] && FINDING_TAG=" finding:${FINDING_ID_TAG}"
if [ -n "$DESCRIPTION" ]; then
    TASK_LINE="- [ ] **${TITLE}**: ${DESCRIPTION} <!-- auto:${DATE}${FINDING_TAG} -->"
else
    TASK_LINE="- [ ] **${TITLE}** <!-- auto:${DATE}${FINDING_TAG} -->"
fi

# Verifica se a tarefa já existe (evita duplicatas idênticas)
if grep -qF "$TITLE" "$TASKS_FILE" 2> /dev/null; then
    echo "⚠️  Atenção: tarefa com título similar já existe. Adicionando mesmo assim."
fi

# Insere a tarefa logo após a linha de âncora (e bloco blockquote opcional que a segue)
TMPFILE="$(mktemp)"
awk \
    -v anchor="$ANCHOR" \
    -v task="$TASK_LINE" \
    '
    $0 == anchor { print; found=1; next }
    found == 1 && /^>/ { print; next }
    found == 1 && /^$/ { print task; print ""; print; found=0; next }
    found == 1 { print task; print ""; print; found=0; next }
    { print }
    ' "$TASKS_FILE" > "$TMPFILE" && mv "$TMPFILE" "$TASKS_FILE"

# Loga o evento
mkdir -p "$LOG_DIR" && chmod 700 "$LOG_DIR"
jq -cn \
    --arg event "taskAdded" \
    --arg sid "$SESSION_ID" \
    --arg ts "$NOW_MS" \
    --arg priority "$PRIORITY" \
    --arg title "$TITLE" \
    --arg desc "$DESCRIPTION" \
    --arg fid "$FINDING_ID_TAG" \
    '{
        event:      $event,
        session_id: $sid,
        timestamp:  $ts,
        priority:   $priority,
        title:      $title,
        description: $desc,
        finding_id: (if $fid != "" then $fid else null end)
    }' >> "$AUDIT_FILE"

echo "✓ Tarefa adicionada ($PRIORITY): $TITLE"
exit 0
