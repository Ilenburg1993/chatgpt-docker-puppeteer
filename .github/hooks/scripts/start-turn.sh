#!/usr/bin/env bash
# start-turn.sh — Declara a intenção do turno atual
#
# Uso: bash .github/hooks/scripts/start-turn.sh "descrição da intenção"
#
# Deve ser chamado como PRIMEIRO ato de qualquer turno de trabalho.
# Registra a intenção no state (current_turn.intent) e no audit.jsonl.
# Não bloqueia e não emite nenhuma saída para stdout (script manual, não hook).

set -euo pipefail

HOOK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../lib/common.sh
source "$HOOK_DIR/lib/common.sh"

INTENT="${1:-}"

if [ -z "$INTENT" ]; then
    printf 'Uso: bash start-turn.sh "descrição da intenção"\n' >&2
    exit 1
fi

if ! state_exists; then
    printf '[start-turn] state não encontrado — sessão ainda não iniciada.\n' >&2
    exit 0
fi

# Atualiza intenção no state
update_nested_state "current_turn.intent" "$INTENT"

# Log no audit
SESSION_ID=$(read_field ".session_id")
export SESSION_ID
turn_num=$(read_field ".current_turn.number")
log_audit "turnIntent_declared" "turn" "${turn_num:-0}" "intent" "$INTENT"

printf '[start-turn] Intenção registrada: "%s"\n' "$INTENT"
