#!/bin/bash
# complete-task.sh — Marca uma tarefa como concluída em pending-tasks.md
#
# Uso: bash .github/hooks/scripts/complete-task.sh "<padrão único do título>"
#
# Encontra a PRIMEIRA tarefa não concluída (- [ ]) cujo texto contém o padrão
# e a marca como concluída (- [x]) com anotação de sessão.
#
# Exemplo:
#   bash .github/hooks/scripts/complete-task.sh "race condition em browser_pool"
#   bash .github/hooks/scripts/complete-task.sh "TS8032"
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TASKS_FILE="$HOOK_DIR/state/pending-tasks.md"
LOG_DIR="$HOOK_DIR/logs"
STATE_DIR="$HOOK_DIR/state"

PATTERN="${1:-}"
DATE="$(date -u '+%Y%m%d')"
NOW_MS="$(date -u +%s000 2> /dev/null || echo 0)"

if [ -z "$PATTERN" ]; then
    echo "Erro: padrão de correspondência é obrigatório." >&2
    echo "Uso: complete-task.sh \"<padrão único do título>\"" >&2
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

# Conta tarefas abertas antes da operação
COUNT_BEFORE="$(grep -c '^\- \[ \]' "$TASKS_FILE" 2> /dev/null || echo 0)"

# Marca a PRIMEIRA ocorrência correspondente como concluída usando awk
TMPFILE="$(mktemp)"
MATCHED=0
awk \
    -v pat="$PATTERN" \
    -v date="$DATE" \
    -v matched_ref=0 \
    '
    !done && /^\- \[ \]/ && index($0, pat) {
        # Remove trailing whitespace then append session annotation
        sub(/[[:space:]]+$/, "")
        sub(/^\- \[ \]/, "- [x]")
        print $0 " <!-- session:" date " -->"
        done=1
        next
    }
    { print }
    ' "$TASKS_FILE" > "$TMPFILE"

COUNT_AFTER="$(grep -c '^\- \[ \]' "$TMPFILE" 2> /dev/null || echo 0)"

if [ "$COUNT_BEFORE" -gt "$COUNT_AFTER" ]; then
    mv "$TMPFILE" "$TASKS_FILE"
    MATCHED=1
else
    rm -f "$TMPFILE"
fi

mkdir -p "$LOG_DIR" && chmod 700 "$LOG_DIR"

if [ "$MATCHED" = "1" ]; then
    echo "✓ Tarefa marcada como concluída (padrão: '$PATTERN')"

    jq -cn \
        --arg event "taskCompleted" \
        --arg sid "$SESSION_ID" \
        --arg ts "$NOW_MS" \
        --arg pattern "$PATTERN" \
        --arg date "$DATE" \
        '{
            event:     $event,
            session_id: $sid,
            timestamp: $ts,
            pattern:   $pattern,
            date:      $date
        }' >> "$LOG_DIR/audit.jsonl"

    # Quantas tarefas abertas restam
    REMAINING="$(grep -c '^\- \[ \]' "$TASKS_FILE" 2> /dev/null || echo 0)"
    echo "   Tarefas abertas restantes: $REMAINING"
else
    echo "✗ Nenhuma tarefa aberta encontrada com o padrão: '$PATTERN'" >&2
    echo "   Tarefas disponíveis:" >&2
    grep '^\- \[ \]' "$TASKS_FILE" 2> /dev/null | head -5 >&2 || true
    exit 1
fi

exit 0
