#!/usr/bin/env bash
# session-reminder.sh — Exibe resumo rápido da sessão atual
#
# Uso: bash .github/hooks/scripts/session-reminder.sh
#
# Exibe: session_id, close_key, turn stats, tarefas pendentes, consecutive violations.
# Útil para retomada de contexto após compactação ou pausa longa.

set -euo pipefail

HOOK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../lib/common.sh
source "$HOOK_DIR/lib/common.sh"

if ! state_exists; then
    printf '╔══════════════════════════════════════╗\n'
    printf '║  SESSION REMINDER — Sem sessão ativa ║\n'
    printf '╚══════════════════════════════════════╝\n'
    printf '\nNenhum state encontrado em: %s\n' "$STATE_FILE"
    exit 0
fi

session_id=$(read_field ".session_id")
close_key=$(read_field ".close_key")
started_at=$(read_field ".started_at")
source_type=$(read_field ".source")
turn_count=$(read_field ".session_stats.turn_count")
turn_auth=$(read_field ".session_stats.turn_authorized")
turn_unauth=$(read_field ".session_stats.turn_unauthorized")
consecutive=$(read_field ".compliance.consecutive_unauthorized")
last_auth=$(read_field ".compliance.last_turn_authorized")
pending_close=$(read_field ".pending_session_close")
current_turn_num=$(read_field ".current_turn.number")
current_intent=$(read_field ".current_turn.intent")

printf '\n'
printf '┌─────────────────────────────────────────────────────┐\n'
printf '│  SESSION REMINDER                                   │\n'
printf '├─────────────────────────────────────────────────────┤\n'
printf '│  ID        : %-37s│\n' "${session_id:-N/A}"
printf '│  Iniciada  : %-37s│\n' "${started_at:-N/A}"
printf '│  Fonte     : %-37s│\n' "${source_type:-N/A}"
printf '├─────────────────────────────────────────────────────┤\n'
printf '│  CHAVE DE ENCERRAMENTO (Template F):                │\n'
printf '│  > %-49s│\n' "${close_key:-N/A}"
printf '├─────────────────────────────────────────────────────┤\n'
printf '│  TURN ATUAL : #%-36s│\n' "${current_turn_num:-0}"
if [ -n "$current_intent" ] && [ "$current_intent" != "null" ]; then
printf '│  Intenção   : %-37s│\n' "${current_intent:0:37}"
fi
printf '├─────────────────────────────────────────────────────┤\n'
printf '│  ESTATÍSTICAS                                       │\n'
printf '│  Turnos: %-5s total │ %-5s autorizados │ %-5s não  │\n' \
    "${turn_count:-0}" "${turn_auth:-0}" "${turn_unauth:-0}"
printf '│  Consecutivos sem askQuestions: %-19s│\n' "${consecutive:-0}"
printf '│  Último turno autorizado: %-25s│\n' "${last_auth:-N/A}"

if [ "${pending_close:-false}" = "true" ]; then
printf '├─────────────────────────────────────────────────────┤\n'
printf '│  ⚠️  PENDING SESSION CLOSE = TRUE                   │\n'
fi

# Tarefas pendentes
if [ -f "$PENDING_TASKS_FILE" ] && [ -s "$PENDING_TASKS_FILE" ]; then
printf '├─────────────────────────────────────────────────────┤\n'
printf '│  TAREFAS PENDENTES                                  │\n'
while IFS= read -r line; do
    printf '│  %-51s│\n' "${line:0:51}"
done < "$PENDING_TASKS_FILE"
fi

printf '└─────────────────────────────────────────────────────┘\n'
printf '\n'
