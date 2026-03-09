#!/bin/bash
# manual-session-init.sh — Inicialização manual de sessão
#
# Uso emergencial: quando o hook sessionStart não disparou e session-context.json
# está vazio. Este script detecta o session_id ativo no audit.jsonl e invoca
# session-start.sh com o ID correto.
#
# Uso:
#   bash manual-session-init.sh                 # auto-detecta session_id do audit.jsonl
#   bash manual-session-init.sh "UUID-AQUI"     # usa o session_id fornecido
#
# NOTA: Este é um procedimento de exceção. Em operação normal, session-start.sh
#       é invocado automaticamente pelo hook sessionStart do Copilot.
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOOK_DIR/logs"
STATE_DIR="$HOOK_DIR/state"
CTX_FILE="$STATE_DIR/session-context.json"
AUDIT_FILE="$LOG_DIR/audit.jsonl"

echo "╔══════════════════════════════════════════════════════════════════╗" >&2
echo "║       INICIALIZAÇÃO MANUAL DE SESSÃO — PROCEDIMENTO EXCEPCIONAL ║" >&2
echo "╚══════════════════════════════════════════════════════════════════╝" >&2

# Verifica se session-context.json já tem conteúdo
if [ -f "$CTX_FILE" ] && [ -s "$CTX_FILE" ]; then
    EXISTING_SID="$(jq -r '.session.id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    EXISTING_MODE="$(jq -r '.session.source // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    echo "[aviso] session-context.json já tem conteúdo (session_id=$EXISTING_SID, mode=$EXISTING_MODE)" >&2
    echo "[aviso] Para forçar reinicialização, limpe o arquivo primeiro: > $CTX_FILE" >&2
    exit 1
fi

# Detecta session_id: argumento fornecido ou último evento no audit.jsonl
SESSION_ID="${1:-}"

if [ -z "$SESSION_ID" ]; then
    echo "[info] Nenhum session_id fornecido — buscando no audit.jsonl..." >&2
    if [ -f "$AUDIT_FILE" ]; then
        SESSION_ID="$(tail -100 "$AUDIT_FILE" | jq -r 'select(.session_id != null and .session_id != "") | .session_id' 2> /dev/null | tail -1)"
    fi
fi

if [ -z "$SESSION_ID" ]; then
    echo "[erro] Não foi possível detectar session_id. Forneça como argumento:" >&2
    echo "  bash manual-session-init.sh \"UUID-DA-SESSAO\"" >&2
    exit 1
fi

echo "[info] session_id detectado: $SESSION_ID" >&2
echo "[info] Invocando session-start.sh com source=manual_recovery..." >&2

# Invoca session-start.sh com o session_id detectado
echo "{\"session_id\":\"$SESSION_ID\",\"timestamp\":\"$(date -u '+%Y-%m-%dT%H:%M:%SZ')\",\"source\":\"manual_recovery\",\"cwd\":\"$(pwd)\"}" \
    | bash "$HOOK_DIR/scripts/session-start.sh" 2>&1

# Loga o evento de recovery manual no audit.jsonl
jq -cn \
    --arg event "session_manual_recovery" \
    --arg sid "$SESSION_ID" \
    --arg ts "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
    '{
        event:   $event,
        session_id: $sid,
        timestamp: $ts,
        message: "Sessão iniciada manualmente — sessionStart hook provavelmente não disparou"
    }' >> "$AUDIT_FILE"

echo "" >&2
echo "[ok] Sessão $SESSION_ID inicializada manualmente." >&2
echo "[ok] Verifique: jq '.session.id' $CTX_FILE" >&2
