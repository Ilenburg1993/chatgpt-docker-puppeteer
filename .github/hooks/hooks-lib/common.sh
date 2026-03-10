#!/bin/bash
# hooks-lib/common.sh — Biblioteca de funções compartilhadas para os scripts de hook.
#
# COMO USAR:
#   HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
#   source "$HOOK_DIR/hooks-lib/common.sh"
#
# Funções disponíveis:
#   iso_now            — retorna timestamp ISO-8601 UTC
#   get_session_id     — retorna session_id do contexto ativo
#   ctx_read <jq_path> — lê um campo do session-context.json
#   ctx_update <jq_expr> — atualiza session-context.json atomicamente (com flock)
#   log_event <json>   — appenda evento em audit.jsonl
#   with_lock <lockfile> <cmd...> — executa cmd com flock exclusivo
#   redact_credentials <string> — remove tokens/senhas do texto
#   log_info <msg>     — loga mensagem informativa em stderr
#   log_warn <msg>     — loga aviso em stderr
#   log_error <msg>    — loga erro em stderr
#
# Variáveis exportadas (disponíveis após source):
#   HOOK_LIB_VERSION   — versão da biblioteca
#   LOG_DIR, STATE_DIR, CTX_FILE, AUDIT_FILE — caminhos canônicos
#   HOOKS_FLOCK_TIMEOUT, HOOKS_HEAL_THRESHOLD, etc. — tunáveis de config.sh

HOOK_LIB_VERSION="1.1"
export HOOK_LIB_VERSION

# Resolve caminhos a partir de HOOK_DIR (deve ser definido pelo script chamador)
if [ -z "${HOOK_DIR:-}" ]; then
    HOOK_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
fi

LOG_DIR="${LOG_DIR:-$HOOK_DIR/logs}"
STATE_DIR="${STATE_DIR:-$HOOK_DIR/state}"
CTX_FILE="${CTX_FILE:-$STATE_DIR/session-context.json}"
AUDIT_FILE="${AUDIT_FILE:-$LOG_DIR/audit.jsonl}"

# Carrega tunáveis centralizados (idempotente via HOOKS_CONFIG_LOADED guard)
# shellcheck disable=SC1091
source "$HOOK_DIR/hooks-lib/config.sh" 2> /dev/null || true

# Garante diretórios
mkdir -p "$LOG_DIR" && chmod 700 "$LOG_DIR"
mkdir -p "$STATE_DIR"

# ── iso_now ──────────────────────────────────────────────────────────────────
# Retorna timestamp ISO-8601 UTC. Nunca falha — retorna 'unknown' em último caso.
#
# Uso: NOW="$(iso_now)"
iso_now() {
    date -u '+%Y-%m-%dT%H:%M:%SZ' 2> /dev/null || echo 'unknown'
}

# ── get_session_id ───────────────────────────────────────────────────────────
# Lê session_id do contexto ativo. Retorna string vazia se não disponível.
#
# Uso: SID="$(get_session_id)"
get_session_id() {
    if [ -f "$CTX_FILE" ] && [ -s "$CTX_FILE" ]; then
        jq -r '.session.id // ""' "$CTX_FILE" 2> /dev/null || echo ''
    else
        echo ''
    fi
}

# ── ctx_read ─────────────────────────────────────────────────────────────────
# Lê um campo do session-context.json.
# Parâmetros: $1 = expressão jq (ex: '.current_turn.number'), $2 = fallback
#
# Uso: TURN="$(ctx_read '.current_turn.number' 0)"
ctx_read() {
    local expr="${1:-.}" fallback="${2:-}"
    if [ -f "$CTX_FILE" ] && [ -s "$CTX_FILE" ]; then
        jq -r "${expr} // empty" "$CTX_FILE" 2> /dev/null || echo "$fallback"
    else
        echo "$fallback"
    fi
}

# ── with_lock ────────────────────────────────────────────────────────────────
# Executa um comando com flock exclusivo no lockfile.
# Garante que apenas uma instância do hook modifica session-context.json de cada vez.
#
# Parâmetros: $1 = arquivo de lock, $2... = comando a executar
# Retorno: código de saída do comando
#
# Uso: with_lock "$CTX_FILE.lock" jq '...' "$CTX_FILE" | sponge "$CTX_FILE"
with_lock() {
    local lockfile="$1"
    shift
    local _timeout="${HOOKS_FLOCK_TIMEOUT:-3}"
    if command -v flock > /dev/null 2>&1; then
        # shellcheck disable=SC2094
        (
            flock -x -w "$_timeout" 9 2> /dev/null
            "$@"
        ) 9> "$lockfile"
    else
        # flock não disponível — executa sem lock (degraded mode)
        "$@"
    fi
}

# ── ctx_update ───────────────────────────────────────────────────────────────
# Atualiza session-context.json atomicamente com flock.
# Parâmetros: $1 = expressão jq de transformação (ex: '.current_turn.number += 1')
# Retorno: 0 em sucesso, 1 em falha ou se CTX_FILE não existir
#
# Uso: ctx_update '.current_turn.tools_count += 1'
ctx_update() {
    local expr="$1"
    [ -f "$CTX_FILE" ] || return 1

    local lockfile="${CTX_FILE}.lock"

    if command -v sponge > /dev/null 2>&1; then
        with_lock "$lockfile" \
            sh -c "jq '${expr}' \"$CTX_FILE\" | sponge \"$CTX_FILE\"" 2> /dev/null || return 1
    else
        local tmp
        tmp="$(mktemp)"
        if with_lock "$lockfile" \
            sh -c "jq '${expr}' \"$CTX_FILE\" > \"$tmp\"" 2> /dev/null; then
            mv "$tmp" "$CTX_FILE" 2> /dev/null || {
                rm -f "$tmp"
                return 1
            }
        else
            rm -f "$tmp"
            return 1
        fi
    fi
    return 0
}

# ── log_event ────────────────────────────────────────────────────────────────
# Appenda um objeto JSON como evento em audit.jsonl.
# Parâmetros: $1 = JSON object string (deve ser JSON válido)
# Retorno: 0 em sucesso
#
# Uso: log_event "$(jq -cn --arg event "myEvent" --arg sid "$SID" --arg ts "$NOW" \
#        '{event: $event, session_id: $sid, timestamp: $ts}')"
log_event() {
    local json="$1"
    mkdir -p "$LOG_DIR"
    printf '%s\n' "$json" >> "$AUDIT_FILE" 2> /dev/null || true
}

# ── redact_credentials ───────────────────────────────────────────────────────
# Remove tokens e senhas de uma string antes de log.
# Parâmetros: $1 = string a redactar (lida de stdin se omitido)
#
# Uso: CLEAN="$(redact_credentials "$TOOL_INPUT_RAW")"
#      echo "$DIRTY" | redact_credentials
redact_credentials() {
    local input
    if [ $# -gt 0 ]; then
        input="$1"
    else
        input="$(cat)"
    fi
    echo "$input" \
        | sed -E 's/ghp_[A-Za-z0-9]{20,}/[REDACTED_GHP]/g' \
        | sed -E 's/gho_[A-Za-z0-9]{20,}/[REDACTED_GHO]/g' \
        | sed -E 's/ghu_[A-Za-z0-9]{20,}/[REDACTED_GHU]/g' \
        | sed -E 's/ghs_[A-Za-z0-9]{20,}/[REDACTED_GHS]/g' \
        | sed -E 's/ghr_[A-Za-z0-9]{20,}/[REDACTED_GHR]/g' \
        | sed -E 's/github_pat_[A-Za-z0-9_]{20,}/[REDACTED_GITHUB_PAT]/g' \
        | sed -E 's/glpat-[A-Za-z0-9_-]{10,}/[REDACTED_GITLAB_PAT]/g' \
        | sed -E 's/AKIA[0-9A-Z]{16}/[REDACTED_AWS_KEY]/g' \
        | sed -E 's/sk-ant-[A-Za-z0-9_-]{20,}/[REDACTED_ANTHROPIC_KEY]/g' \
        | sed -E 's/sk-[A-Za-z0-9_-]{20,}/[REDACTED_OPENAI_KEY]/g' \
        | sed -E 's/xai-[A-Za-z0-9_-]{20,}/[REDACTED_XAI_KEY]/g' \
        | sed -E 's/hf_[A-Za-z0-9]{20,}/[REDACTED_HF_TOKEN]/g' \
        | sed -E 's/AIza[A-Za-z0-9_-]{35}/[REDACTED_GOOGLE_KEY]/g' \
        | sed -E 's/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/[REDACTED_JWT]/g' \
        | sed -E 's|https?://[^/@]+:[^@]+@[^"[:space:]]+|[REDACTED_URL_WITH_CREDS]|g' \
        | sed -E 's/[?&]token=[^&"[:space:]]*/\&token=[REDACTED]/g' \
        | sed -E 's/[?&]api_key=[^&"[:space:]]*/\&api_key=[REDACTED]/g' \
        | sed -E 's/Bearer [A-Za-z0-9_\-\.]+/Bearer [REDACTED]/g' \
        | sed -E 's/--password[=[:space:]][^[:space:]]+/--password=[REDACTED]/g' \
        | sed -E 's/--token[=[:space:]][^[:space:]]+/--token=[REDACTED]/g' \
        | sed -E 's/-p [A-Za-z0-9!@#$%^&*]{6,}/-p [REDACTED]/g' \
        | sed -E 's/"password"[[:space:]]*:[[:space:]]*"[^"]+"/\"password\":\"[REDACTED]\"/gi' \
        | sed -E 's/"api_key"[[:space:]]*:[[:space:]]*"[^"]+"/\"api_key\":\"[REDACTED]\"/gi' \
        | sed -E 's/"secret"[[:space:]]*:[[:space:]]*"[^"]+"/\"secret\":\"[REDACTED]\"/gi' \
        | sed -E 's/(PASSWORD|TOKEN|SECRET|API_KEY)=([^[:space:]"]{4,})/\1=[REDACTED]/g'
}

# ── log_info / log_warn / log_error ───────────────────────────────────────────
# Helpers de logging semântico para stderr. Produzem saída padronizada com
# prefixo [INFO], [WARN] ou [ERROR] e timestamp ISO.
# Parâmetros: $1 = mensagem, ... = campos extras (opcionais)
#
# Uso:
#   log_info "session iniciada" "session_id=$SID"
#   log_warn "flock timeout — modo degradado"
#   log_error "sessão corrompida" "ctx_file=$CTX_FILE"
log_info() {
    local msg="$1"
    shift
    echo "[INFO]  $(iso_now) ${msg}${*:+ | $*}" >&2
}

log_warn() {
    local msg="$1"
    shift
    echo "[WARN]  $(iso_now) ${msg}${*:+ | $*}" >&2
}

log_error() {
    local msg="$1"
    shift
    echo "[ERROR] $(iso_now) ${msg}${*:+ | $*}" >&2
}
