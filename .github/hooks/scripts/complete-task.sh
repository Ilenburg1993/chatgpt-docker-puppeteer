#!/usr/bin/env bash
# complete-task.sh — Marca tarefa como concluída no backlog
#
# Uso: bash .github/hooks/scripts/complete-task.sh "padrão do título"
#
# Busca por linhas contendo o padrão em pending-tasks.md e adiciona o marcador [✅ DONE].
# O padrão é case-insensitive e parcial (substring match).

set -euo pipefail

HOOK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../lib/common.sh
source "$HOOK_DIR/lib/common.sh"

PATTERN="${1:-}"

if [ -z "$PATTERN" ]; then
    printf 'Uso: bash complete-task.sh "padrão do título"\n' >&2
    exit 1
fi

if [ ! -f "$PENDING_TASKS_FILE" ]; then
    printf '[complete-task] Arquivo de tarefas não encontrado: %s\n' "$PENDING_TASKS_FILE" >&2
    exit 0
fi

# Verifica se o padrão existe (case-insensitive)
if ! grep -qi "$PATTERN" "$PENDING_TASKS_FILE"; then
    printf '[complete-task] Nenhuma tarefa encontrada com padrão: "%s"\n' "$PATTERN" >&2
    exit 0
fi

# Substitui a linha do cabeçalho da tarefa para marcar como concluída
# (adiciona ✅ DONE antes do padrão encontrado)
TMPFILE="$(mktemp "$STATE_DIR/.tasks.XXXXXX")"
sed -E "s/(##[^#].*${PATTERN}.*)/\1 [✅ DONE]/gI" "$PENDING_TASKS_FILE" > "$TMPFILE"
mv -f "$TMPFILE" "$PENDING_TASKS_FILE"

# Log no audit
if state_exists; then
    SESSION_ID=$(read_field ".session_id")
    export SESSION_ID
fi
log_audit "task_completed" "pattern" "$PATTERN"

printf '[complete-task] Tarefa marcada como concluída: "%s"\n' "$PATTERN"
