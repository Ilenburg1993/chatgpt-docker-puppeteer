#!/bin/bash
# rotate-audit.sh — Rotação de audit.jsonl quando ultrapassar o limiar de linhas.
#
# Uso:
#   bash rotate-audit.sh                  # rotaciona se > AUDIT_ROTATE_THRESHOLD linhas
#   bash rotate-audit.sh --force          # força rotação independente do tamanho
#   bash rotate-audit.sh --keep N         # mantém N linhas mais recentes no arquivo ativo
#
# Comportamento:
#   1. Verifica se audit.jsonl ultrapassa AUDIT_ROTATE_THRESHOLD (padrão: 5000 linhas).
#   2. Move audit.jsonl → logs/audit-YYYYMMDD_HHMMSS.jsonl (arquivo composto).
#   3. Recria audit.jsonl mantendo as N linhas mais recentes (padrão: AUDIT_KEEP_RECENT=500).
#   4. Registra evento "auditRotated" no novo audit.jsonl.
#   5. Retorna 0 em sucesso (mesmo sem rotação), 1 em erro.
#
# Variáveis de ambiente:
#   AUDIT_ROTATE_THRESHOLD  — limiar em linhas para rotação (padrão: 5000)
#   AUDIT_KEEP_RECENT       — linhas recentes a manter no arquivo ativo (padrão: 500)

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
HOOK_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
LOG_DIR="$HOOK_DIR/logs"
CTX_FILE="$HOOK_DIR/state/session-context.json"

AUDIT_FILE="$LOG_DIR/audit.jsonl"
AUDIT_ROTATE_THRESHOLD="${AUDIT_ROTATE_THRESHOLD:-5000}"
AUDIT_KEEP_RECENT="${AUDIT_KEEP_RECENT:-500}"

FORCE=false
while [[ $# -gt 0 ]]; do
    case "$1" in
        --force) FORCE=true ;;
        --keep)
            AUDIT_KEEP_RECENT="${2:-500}"
            shift
            ;;
        *) ;;
    esac
    shift
done

# Helpers
iso_now() { date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo 'unknown'; }
log() { echo "[rotate-audit] $*" >&2; }

# Verifica se audit.jsonl existe
if [ ! -f "$AUDIT_FILE" ]; then
    log "audit.jsonl não encontrado em $AUDIT_FILE — nada a fazer."
    exit 0
fi

CURRENT_LINES="$(wc -l < "$AUDIT_FILE" | tr -d ' ')"

# Decide se deve rotar
if [ "$FORCE" = false ] && [ "${CURRENT_LINES:-0}" -le "$AUDIT_ROTATE_THRESHOLD" ] 2> /dev/null; then
    log "audit.jsonl com ${CURRENT_LINES} linhas (limiar: ${AUDIT_ROTATE_THRESHOLD}) — sem rotação necessária."
    exit 0
fi

log "Iniciando rotação: ${CURRENT_LINES} linhas → threshold ${AUDIT_ROTATE_THRESHOLD}."

# Gera nome do arquivo de arquivo com timestamp
ARCHIVE_DATE="$(date -u '+%Y%m%d_%H%M%S' 2> /dev/null || date +%s)"
ARCHIVE_FILE="$LOG_DIR/audit-${ARCHIVE_DATE}.jsonl"

# Atômica: copia para arquivo e recria com últimas N linhas
# Usa sponge se disponível, senão mv + tail
if command -v sponge > /dev/null 2>&1; then
    cp "$AUDIT_FILE" "$ARCHIVE_FILE"
    tail -n "$AUDIT_KEEP_RECENT" "$AUDIT_FILE" | sponge "$AUDIT_FILE"
else
    cp "$AUDIT_FILE" "$ARCHIVE_FILE"
    tail -n "$AUDIT_KEEP_RECENT" "$AUDIT_FILE" > "${AUDIT_FILE}.tmp"
    mv "${AUDIT_FILE}.tmp" "$AUDIT_FILE"
fi

NEW_LINES="$(wc -l < "$AUDIT_FILE" | tr -d ' ')"
log "Rotação concluída. Arquivo: $ARCHIVE_FILE (${CURRENT_LINES} linhas). Ativo: ${NEW_LINES} linhas."

# Lê session_id atual para o evento de rotação
SESSION_ID="$(jq -r '.session.id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
NOW="$(iso_now)"

# Registra evento auditRotated no arquivo ativo
printf '{"event":"auditRotated","session_id":"%s","timestamp":"%s","archive_file":"%s","archived_lines":%d,"kept_lines":%d}\n' \
    "$SESSION_ID" "$NOW" "$ARCHIVE_FILE" "$CURRENT_LINES" "$NEW_LINES" \
    >> "$AUDIT_FILE"

log "Evento auditRotated registrado. Rotação completa."

# G9-05: Purge de logs de diagnóstico (raw-*.jsonl) — não são escritos pelos scripts em produção.
# São vestigios de sessões de diagnóstico anteriores; removidos automaticamente para manter logs limpos.
for _raw_file in "$LOG_DIR"/raw-*.jsonl; do
    [ -f "$_raw_file" ] || continue
    _raw_lines="$(wc -l < "$_raw_file" | tr -d ' ')"
    log "Purge de log de diagnóstico: $_raw_file (${_raw_lines} linhas)"
    rm -f "$_raw_file" 2> /dev/null || true
done

exit 0
