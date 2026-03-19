#!/usr/bin/env bash
# add-task.sh — Adiciona tarefa ao backlog de tarefas pendentes
#
# Uso: bash .github/hooks/scripts/add-task.sh <prioridade> "Título" "Descrição + gate de aceitação"
#
# Prioridade: alta | media | baixa
# Arquivo destino: state/pending-tasks.md
# Também loga task_added no audit.jsonl.

set -euo pipefail

HOOK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../lib/common.sh
source "$HOOK_DIR/lib/common.sh"

PRIORITY="${1:-media}"
TITLE="${2:-}"
DESCRIPTION="${3:-}"

if [ -z "$TITLE" ]; then
    printf 'Uso: bash add-task.sh <prioridade> "Título" ["Descrição"]\n' >&2
    printf 'Prioridade: alta | media | baixa\n' >&2
    exit 1
fi

mkdir -p "$STATE_DIR"

# Cria o arquivo se não existir
if [ ! -f "$PENDING_TASKS_FILE" ]; then
    cat > "$PENDING_TASKS_FILE" << 'EOF'
# Tarefas Pendentes

EOF
fi

# Formata entrada de prioridade
case "$PRIORITY" in
    alta | high) PRIORITY_LABEL="🔴 Alta" ;;
    media | medium) PRIORITY_LABEL="🟡 Média" ;;
    baixa | low) PRIORITY_LABEL="🟢 Baixa" ;;
    *) PRIORITY_LABEL="⚪ ${PRIORITY}" ;;
esac

NOW=$(now_iso)

{
    printf '## [%s] %s (%s)\n' "$PRIORITY_LABEL" "$TITLE" "$NOW"
    if [ -n "$DESCRIPTION" ]; then
        printf '%s\n' "$DESCRIPTION"
    fi
    printf '\n'
} >> "$PENDING_TASKS_FILE"

# Log no audit
if state_exists; then
    SESSION_ID=$(read_field ".session_id")
    export SESSION_ID
fi
log_audit "task_added" "priority" "$PRIORITY" "title" "$TITLE"

printf '[add-task] Tarefa adicionada: [%s] %s\n' "$PRIORITY_LABEL" "$TITLE"
