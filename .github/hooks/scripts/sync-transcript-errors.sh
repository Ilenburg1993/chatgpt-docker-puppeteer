#!/usr/bin/env bash
# =============================================================================
# sync-transcript-errors.sh — Bridge: erros do log nativo → audit.jsonl nosso
# =============================================================================
# Lê o transcript JSONL nativo do Copilot e repassa falhas de ferramentas
# que não foram capturadas pelo nosso sistema (post-tool-use.sh).
#
# Uso:
#   bash sync-transcript-errors.sh            # sync da sessão atual
#   bash sync-transcript-errors.sh --since T  # apenas erros depois do timestamp T
#   bash sync-transcript-errors.sh --dry-run  # apenas exibe, não escreve
#
# Chamado por:
#   - start-turn.sh (início de cada turno) — modo silencioso
#   - session-start.sh (início da sessão) — modo silencioso
#   - Manualmente pelo agente para diagnóstico
#
# Saída: agenda eventos "transcript_error_synced" no audit.jsonl
# =============================================================================

set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOOK_DIR/logs"
STATE_DIR="$HOOK_DIR/state"
CTX_FILE="$STATE_DIR/session-context.json"
AUDIT_LOG="$LOG_DIR/audit.jsonl"
WS_STORAGE_ROOT="/home/node/.vscode-server/data/User/workspaceStorage"

# Arquivo que rastreia quais tool_call_ids já foram sincronizados (evita duplicatas)
SYNC_STATE_FILE="$STATE_DIR/.transcript-sync-state.json"

mkdir -p "$LOG_DIR" "$STATE_DIR"

# ---------------------------------------------------------------------------
# Parse de argumentos
# ---------------------------------------------------------------------------
DRY_RUN=false
SINCE_TS=""

while [[ $# -gt 0 ]]; do
    case "$1" in
        --dry-run) DRY_RUN=true ;;
        --since)
            SINCE_TS="${2:-}"
            shift
            ;;
    esac
    shift
done

# ---------------------------------------------------------------------------
# Localiza o transcript da sessão atual
# ---------------------------------------------------------------------------
SESSION_ID="$(jq -r '.session.id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
if [ -z "$SESSION_ID" ]; then
    echo "[sync-transcript-errors] session_id não encontrado em session-context.json — abortando" >&2
    exit 0
fi

TRANSCRIPT_PATH=""
# shellcheck disable=SC2227
if [ -d "$WS_STORAGE_ROOT" ]; then
    TRANSCRIPT_PATH="$(find "$WS_STORAGE_ROOT" -name "${SESSION_ID}.jsonl" \
        -path "*/GitHub.copilot-chat/transcripts/*" \
        2> /dev/null | head -1)"
fi

if [ -z "$TRANSCRIPT_PATH" ] || [ ! -f "$TRANSCRIPT_PATH" ]; then
    echo "[sync-transcript-errors] Transcript não encontrado para sessão '${SESSION_ID}' — abortando" >&2
    exit 0
fi

# ---------------------------------------------------------------------------
# Carrega IDs já sincronizados (evitar duplicatas)
# ---------------------------------------------------------------------------
ALREADY_SYNCED_JSON="{}"
if [ -f "$SYNC_STATE_FILE" ] && jq empty "$SYNC_STATE_FILE" 2> /dev/null; then
    ALREADY_SYNCED_JSON="$(cat "$SYNC_STATE_FILE")"
fi

# ---------------------------------------------------------------------------
# Processa o transcript via Python (robusto para JSONL grandes)
# ---------------------------------------------------------------------------
NOW_ISO="$(date -u '+%Y-%m-%dT%H:%M:%SZ')"
ERRORS_FOUND=0

SYNC_OUTPUT="$(
    python3 - << PYEOF
import json, sys

transcript_path = "$TRANSCRIPT_PATH"
since_ts = "$SINCE_TS"
already_synced = $ALREADY_SYNCED_JSON
session_id = "$SESSION_ID"

errors = []
with open(transcript_path, encoding="utf-8") as f:
    for line in f:
        line = line.strip()
        if not line:
            continue
        try:
            ev = json.loads(line)
        except json.JSONDecodeError:
            continue

        ev_type = ev.get("type", "")
        ev_ts = ev.get("timestamp", "")

        # Filtra por timestamp se --since foi passado
        if since_ts and ev_ts and ev_ts < since_ts:
            continue

        # Apenas tool.execution_complete com success=false
        if ev_type == "tool.execution_complete":
            data = ev.get("data", {})
            if not data.get("success", True):
                tool_call_id = data.get("toolCallId", ev.get("id", ""))
                # Evita duplicatas
                if tool_call_id in already_synced:
                    continue
                errors.append({
                    "event":         "transcript_error_synced",
                    "session_id":    session_id,
                    "timestamp":     ev_ts,
                    "source":        "transcript_native",
                    "tool_call_id":  tool_call_id,
                    "tool_success":  False,
                    "ev_id":         ev.get("id", ""),
                    "parent_id":     ev.get("parentId", ""),
                })

print(json.dumps(errors))
PYEOF
)"

if [ -z "$SYNC_OUTPUT" ] || [ "$SYNC_OUTPUT" = "null" ] || [ "$SYNC_OUTPUT" = "[]" ]; then
    echo "[sync-transcript-errors] Nenhuma falha nova encontrada no transcript." >&2
    exit 0
fi

# Valida JSON
if ! echo "$SYNC_OUTPUT" | python3 -c "import json,sys; json.load(sys.stdin)" 2> /dev/null; then
    echo "[sync-transcript-errors] Saída Python inválida — abortando." >&2
    exit 1
fi

# ---------------------------------------------------------------------------
# Escreve no audit.jsonl e atualiza o sync-state
# ---------------------------------------------------------------------------
NEW_SYNCED_IDS="{}"
while IFS= read -r ERROR_LINE; do
    if [ -z "$ERROR_LINE" ]; then continue; fi
    TOOL_CALL_ID="$(echo "$ERROR_LINE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('tool_call_id',''))")"
    ERRORS_FOUND=$((ERRORS_FOUND + 1))

    if [ "$DRY_RUN" = "true" ]; then
        echo "[DRY-RUN] Evento a ser gravado: $ERROR_LINE"
    else
        echo "$ERROR_LINE" >> "$AUDIT_LOG"
        # Adiciona ao set de sincronizados
        NEW_SYNCED_IDS="$(echo "$NEW_SYNCED_IDS" | python3 -c "
import json,sys
d = json.load(sys.stdin)
d['$TOOL_CALL_ID'] = '$NOW_ISO'
print(json.dumps(d))
")"
    fi
done < <(echo "$SYNC_OUTPUT" | python3 -c "
import json,sys
events = json.load(sys.stdin)
for ev in events:
    print(json.dumps(ev))
")

# Persiste os IDs sincronizados
if [ "$DRY_RUN" = "false" ] && [ "$ERRORS_FOUND" -gt 0 ]; then
    UPDATED_SYNC_STATE="$(echo "$ALREADY_SYNCED_JSON" | python3 -c "
import json,sys
old = json.load(sys.stdin)
new_ids = $NEW_SYNCED_IDS
old.update(new_ids)
# Cap: mantém apenas os últimos 500 IDs para evitar crescimento ilimitado
if len(old) > 500:
    items = list(old.items())
    old = dict(items[-500:])
print(json.dumps(old))
")"
    echo "$UPDATED_SYNC_STATE" > "$SYNC_STATE_FILE"
fi

if [ "$ERRORS_FOUND" -gt 0 ]; then
    echo "[sync-transcript-errors] ${ERRORS_FOUND} falha(s) do transcript sincronizada(s) → audit.jsonl" >&2
else
    echo "[sync-transcript-errors] Nenhuma falha nova para sincronizar." >&2
fi

exit 0
