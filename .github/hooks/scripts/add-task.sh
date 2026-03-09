#!/bin/bash
# add-task.sh — Adiciona uma tarefa ao pending-tasks.md autonomamente
#
# Uso: bash .github/hooks/scripts/add-task.sh <prioridade> "<Título>" ["<Descrição>"]
#   prioridade: alta | media | backlog
#   título:     texto curto e descritivo (obrigatório)
#   descrição:  detalhes e gates de aceitação (opcional)
#
# Exemplo:
#   bash .github/hooks/scripts/add-task.sh alta \
#     "Corrigir race condition em browser_pool" \
#     "pool.acquire() pode retornar handle fechado sob carga. Gate: test:integration passa."
#
# A tarefa é inserida logo após o cabeçalho da seção correspondente,
# garantindo que novas tarefas LLM-geradas apareçam no topo da seção.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TASKS_FILE="$HOOK_DIR/state/pending-tasks.md"
LOG_DIR="$HOOK_DIR/logs"
STATE_DIR="$HOOK_DIR/state"

PRIORITY="${1:-backlog}"
TITLE="${2:-}"
DESCRIPTION="${3:-}"
DATE="$(date -u '+%Y%m%d')"
NOW_MS="$(date -u +%s000 2>/dev/null || echo 0)"

if [ -z "$TITLE" ]; then
    echo "Erro: título da tarefa é obrigatório." >&2
    echo "Uso: add-task.sh <alta|media|backlog> \"<Título>\" [\"<Descrição>\"]" >&2
    exit 1
fi

if [ ! -f "$TASKS_FILE" ]; then
    echo "Erro: arquivo pending-tasks.md não encontrado em $TASKS_FILE" >&2
    exit 1
fi

# Obtém session_id do contexto persistido
SESSION_ID=""
if [ -f "$STATE_DIR/session-context.json" ]; then
    SESSION_ID="$(jq -r '.session_id // ""' "$STATE_DIR/session-context.json" 2>/dev/null || echo '')"
fi

# Determina a âncora da seção-alvo
case "$PRIORITY" in
    alta)    ANCHOR="## Alta Prioridade" ;;
    media)   ANCHOR="## Média Prioridade" ;;
    backlog) ANCHOR="## Backlog Livre" ;;
    *)
        echo "Prioridade inválida: '$PRIORITY'. Use alta | media | backlog." >&2
        exit 1
        ;;
esac

# Monta a linha da tarefa
if [ -n "$DESCRIPTION" ]; then
    TASK_LINE="- [ ] **${TITLE}**: ${DESCRIPTION} <!-- auto:${DATE} -->"
else
    TASK_LINE="- [ ] **${TITLE}** <!-- auto:${DATE} -->"
fi

# Verifica se a tarefa já existe (evita duplicatas idênticas)
if grep -qF "$TITLE" "$TASKS_FILE" 2>/dev/null; then
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
    '{
        event:     $event,
        session_id: $sid,
        timestamp: $ts,
        priority:  $priority,
        title:     $title,
        description: $desc
    }' >> "$LOG_DIR/audit.jsonl"

echo "✓ Tarefa adicionada ($PRIORITY): $TITLE"
exit 0
