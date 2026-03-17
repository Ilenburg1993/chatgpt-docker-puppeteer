#!/bin/bash
# migrate-per-session-audit.sh — UPG-AUDIT-01: migra estado global para per-session
# Converte a instalação existente (audit.jsonl global) para o modelo per-session.
# Deve ser executado UMA VEZ, antes de ativar os hooks per-session.
#
# O que este script faz:
#   1. Lê o session_id atual de session-context.json
#   2. Calcula SID_SHORT (primeiros 8 chars)
#   3. Copia audit.jsonl → audit-{SID_SHORT}.jsonl (se não existir)
#   4. Copia session-context.json → session-context-{SID_SHORT}.json (se não existir)
#   5. Escreve state/current-session-id.txt com o session_id atual
#   6. Cria symlinks backward-compat (audit.jsonl, session-context.json)
#
# Após executar este script, o sistema de hooks per-session estará ativo.
# É seguro executar múltiplas vezes (idempotente).
#
# Uso:
#   bash .github/hooks/scripts/migrate-per-session-audit.sh [--dry-run] [--verbose]
set -euo pipefail

HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$HOOK_DIR/logs"
STATE_DIR="$HOOK_DIR/state"
SCRIPT_NAME="migrate-per-session-audit"

DRY_RUN=false
VERBOSE=false
for arg in "$@"; do
    case $arg in
        --dry-run) DRY_RUN=true ;;
        --verbose) VERBOSE=true ;;
    esac
done

log() { echo "[$SCRIPT_NAME] $*" >&2; }
logv() { $VERBOSE && log "$*" || true; }
run() {
    if $DRY_RUN; then
        log "[DRY-RUN] $*"
    else
        "$@"
    fi
}

# ── 1. Verificar dependências ──────────────────────────────────────────────
if ! command -v jq > /dev/null 2>&1; then
    log "ERRO: jq não encontrado. Instale jq para continuar."
    exit 1
fi

# ── 2. Ler session_id atual ────────────────────────────────────────────────
CTX_GLOBAL="$STATE_DIR/session-context.json"

# Se session-context.json já é um symlink, resolve o alvo real
if [ -L "$CTX_GLOBAL" ]; then
    CTX_REAL="$(readlink -f "$CTX_GLOBAL" 2> /dev/null || echo "$CTX_GLOBAL")"
    logv "session-context.json é symlink → $CTX_REAL"
else
    CTX_REAL="$CTX_GLOBAL"
fi

if [ ! -f "$CTX_REAL" ] || [ ! -s "$CTX_REAL" ]; then
    log "AVISO: session-context.json não encontrado ou vazio em $CTX_REAL"
    log "Criando state/current-session-id.txt com um session_id placeholder."
    CURR_SID="migrate-placeholder-$(date +%s)"
else
    CURR_SID="$(jq -r '.session.id // ""' "$CTX_REAL" 2> /dev/null || echo '')"
    if [ -z "$CURR_SID" ] || [ "$CURR_SID" = "null" ]; then
        log "AVISO: session_id não encontrado em session-context.json."
        CURR_SID="migrate-placeholder-$(date +%s)"
    fi
fi

SID_SHORT="${CURR_SID:0:8}"
log "Session ID atual: $CURR_SID"
log "SID_SHORT: $SID_SHORT"

# ── 3. Caminhos per-session ────────────────────────────────────────────────
PER_AUDIT="$LOG_DIR/audit-${SID_SHORT}.jsonl"
PER_CTX="$STATE_DIR/session-context-${SID_SHORT}.json"
SID_FILE="$STATE_DIR/current-session-id.txt"

# ── 4. Copiar audit.jsonl → audit-{SID_SHORT}.jsonl ───────────────────────
AUDIT_GLOBAL="$LOG_DIR/audit.jsonl"
AUDIT_REAL="$AUDIT_GLOBAL"
if [ -L "$AUDIT_GLOBAL" ]; then
    AUDIT_REAL="$(readlink -f "$AUDIT_GLOBAL" 2> /dev/null || echo "$AUDIT_GLOBAL")"
fi

if [ -f "$PER_AUDIT" ]; then
    log "audit-${SID_SHORT}.jsonl já existe — ignorando cópia (idempotente)."
elif [ -f "$AUDIT_REAL" ] && [ -s "$AUDIT_REAL" ]; then
    log "Copiando audit.jsonl → audit-${SID_SHORT}.jsonl ..."
    run cp "$AUDIT_REAL" "$PER_AUDIT"
else
    log "audit.jsonl não encontrado ou vazio — criando arquivo per-session vazio."
    run touch "$PER_AUDIT"
fi

# ── 5. Copiar session-context.json → session-context-{SID_SHORT}.json ──────
if [ -f "$PER_CTX" ]; then
    log "session-context-${SID_SHORT}.json já existe — ignorando cópia (idempotente)."
elif [ -f "$CTX_REAL" ] && [ -s "$CTX_REAL" ]; then
    log "Copiando session-context.json → session-context-${SID_SHORT}.json ..."
    run cp "$CTX_REAL" "$PER_CTX"
else
    log "AVISO: session-context.json não disponível. session-context-${SID_SHORT}.json não criado."
fi

# ── 6. Criar/atualizar current-session-id.txt ──────────────────────────────
if [ -f "$SID_FILE" ]; then
    EXISTING_SID="$(cat "$SID_FILE" 2> /dev/null | tr -d '[:space:]')"
    if [ "$EXISTING_SID" = "$CURR_SID" ]; then
        logv "current-session-id.txt já contém o session_id correto."
    else
        log "Atualizando current-session-id.txt: $EXISTING_SID → $CURR_SID"
        if ! $DRY_RUN; then
            echo "$CURR_SID" > "$SID_FILE"
        else
            log "[DRY-RUN] echo '$CURR_SID' > $SID_FILE"
        fi
    fi
else
    log "Criando current-session-id.txt com session_id=$CURR_SID"
    if ! $DRY_RUN; then
        echo "$CURR_SID" > "$SID_FILE"
    else
        log "[DRY-RUN] echo '$CURR_SID' > $SID_FILE"
    fi
fi

# ── 7. Criar symlinks backward-compat ─────────────────────────────────────
log "Atualizando symlinks backward-compat..."
mkdir -p "$LOG_DIR" "$STATE_DIR"

# audit.jsonl → audit-{SID_SHORT}.jsonl
if ! $DRY_RUN; then
    (cd "$LOG_DIR" && ln -sfn "audit-${SID_SHORT}.jsonl" "audit.jsonl") 2> /dev/null \
        && logv "Symlink criado: logs/audit.jsonl → audit-${SID_SHORT}.jsonl" \
        || log "AVISO: falha ao criar symlink audit.jsonl"
else
    log "[DRY-RUN] ln -sfn audit-${SID_SHORT}.jsonl $LOG_DIR/audit.jsonl"
fi

# session-context.json → session-context-{SID_SHORT}.json
# Só cria symlink se o arquivo per-session existe
if [ -f "$PER_CTX" ]; then
    if ! $DRY_RUN; then
        (cd "$STATE_DIR" && ln -sfn "session-context-${SID_SHORT}.json" "session-context.json") 2> /dev/null \
            && logv "Symlink criado: state/session-context.json → session-context-${SID_SHORT}.json" \
            || log "AVISO: falha ao criar symlink session-context.json"
    else
        log "[DRY-RUN] ln -sfn session-context-${SID_SHORT}.json $STATE_DIR/session-context.json"
    fi
else
    log "AVISO: session-context-${SID_SHORT}.json não existe — symlink session-context.json não criado."
fi

# ── 8. Resumo ──────────────────────────────────────────────────────────────
log "Migração per-session concluída!"
log "  Session ID: $CURR_SID"
log "  SID_SHORT: $SID_SHORT"
log "  Audit file: $PER_AUDIT"
log "  CTX file: $PER_CTX"
log "  current-session-id.txt: $SID_FILE"

if $DRY_RUN; then
    log ""
    log "Execute sem --dry-run para aplicar as mudanças."
fi
