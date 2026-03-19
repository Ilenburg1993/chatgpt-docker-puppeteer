#!/usr/bin/env bash
# session-checkpoint.sh — Salva checkpoint manual do estado da sessão
#
# Uso: bash .github/hooks/scripts/session-checkpoint.sh ["motivo opcional"]
#
# Copia session.json para state/checkpoints/session-TIMESTAMP.json.
# Útil antes de mudanças críticas ou operações destrutivas.

set -euo pipefail

HOOK_DIR="$(cd "$(dirname "$0")/.." && pwd)"
# shellcheck source=../lib/common.sh
source "$HOOK_DIR/lib/common.sh"

REASON="${1:-manual}"
CHECKPOINT_DIR="$STATE_DIR/checkpoints"
MAX_CHECKPOINTS=10

if ! state_exists; then
    printf '[checkpoint] state não encontrado — nada a salvar.\n' >&2
    exit 0
fi

mkdir -p "$CHECKPOINT_DIR"

ts=$(now_iso | tr ':' '-')
filename="$CHECKPOINT_DIR/session-${ts}.json"
cp "$STATE_FILE" "$filename"

# Prune: mantém apenas os últimos MAX_CHECKPOINTS
count=$(find "$CHECKPOINT_DIR" -name 'session-*.json' | wc -l)
if [ "$count" -gt "$MAX_CHECKPOINTS" ]; then
    find "$CHECKPOINT_DIR" -name 'session-*.json' -printf '%T+ %p\n' \
        | sort | head -n "$(( count - MAX_CHECKPOINTS ))" | awk '{print $2}' | xargs rm -f
fi

SESSION_ID=$(read_field ".session_id")
export SESSION_ID
log_audit "manual_checkpoint_saved" "reason" "$REASON" "file" "$(basename "$filename")"

printf '[checkpoint] Salvo: %s\n' "$filename"
