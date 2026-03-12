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
        # fix Haiku C6.1: valida mktemp antes de usar
        tmp="$(mktemp)" || return 1
        if with_lock "$lockfile" \
            sh -c "jq '${expr}' \"$CTX_FILE\" > \"$tmp\"" 2> /dev/null; then
            # UPG-AUDIT-01: resolve symlink antes de mv para não quebrar o pointeiro.
            local _real_ctx
            _real_ctx="$(readlink -f "$CTX_FILE" 2> /dev/null || echo "$CTX_FILE")"
            mv "$tmp" "$_real_ctx" 2> /dev/null || {
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

# ── strip_sensitive_json_keys ─────────────────────────────────────────────────
# G9-11: Redação estrutural por denylist de chaves JSON sensíveis.
# Remove recursivamente campos com nomes conhecidamente sensíveis de um objeto
# JSON, independente de nível de aninhamento. Complementa redact_credentials()
# que opera por regex em strings serializadas.
#
# Parâmetros: $1 = JSON string (ou stdin se omitido)
# Saída: JSON sem campos sensíveis (ou string original se jq indisponível)
#
# Chaves removidas: password, passwd, secret, token, api_key, apikey,
#   authorization, auth_token, access_token, refresh_token, private_key,
#   client_secret, close_key (nossa chave de encerramento de sessão)
#
# Uso: SAFE="$(strip_sensitive_json_keys "$TOOL_INPUT")"
#      echo "$JSON" | strip_sensitive_json_keys
strip_sensitive_json_keys() {
    local input
    if [ $# -gt 0 ]; then
        input="$1"
    else
        input="$(cat)"
    fi
    if ! command -v jq &> /dev/null; then
        echo "$input"
        return 0
    fi
    # Verifica se é JSON válido; se não, retorna como string (provavelmente conteúdo de arquivo)
    if ! echo "$input" | jq -e . &> /dev/null 2>&1; then
        echo "$input"
        return 0
    fi
    echo "$input" | jq 'walk(
        if type == "object" then
            with_entries(select(
                (.key | ascii_downcase) |
                test("^(password|passwd|secret|token|api_key|apikey|authorization|auth_token|access_token|refresh_token|private_key|client_secret|close_key)$") | not
            ))
        else . end
    )' 2> /dev/null || echo "$input"
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

# ════════════════════════════════════════════════════════════════════════════
# HEAL v1 — Adoção imediata de session_id real do VS Code (GAP-04 / BUG-06)
# ════════════════════════════════════════════════════════════════════════════
# Premissa-1: o session_id do VS Code é SEMPRE a fonte da verdade.
# Nunca geramos UUIDs próprios nem bloqueamos state writes por mismatch.
#
# Ativa quando:
#   - CTX source = "manual_recovery" → contexto criado manualmente (sem sessionStart real)
#   - CTX source = "inline_restart"  → reinício inline (budget de tokens esgotado)
#
# Parâmetros:
#   $1 = SESSION_ID_PAYLOAD  — session_id real recebido do VS Code
#   $2 = TIMESTAMP           — timestamp ISO-8601 atual
#
# Saída:
#   Retorna 0 se HEAL foi aplicado, 1 se não era necessário ou falhou.
#   Incrementa ctx session_stats.session_id_syncs_inline.
#
# Uso:
#   if heal_v1 "$SESSION_ID_PAYLOAD" "$TIMESTAMP"; then
#       SESSION_ID="$SESSION_ID_PAYLOAD"  # continua com o ID correto
#   fi
heal_v1() {
    local real_sid="${1:-}" ts="${2:-$(iso_now)}"
    [ -n "$real_sid" ] || return 1
    [ -f "$CTX_FILE" ] && [ -s "$CTX_FILE" ] || return 1

    local ctx_sid ctx_source
    ctx_sid="$(jq -r '.session.id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    ctx_source="$(jq -r '.session.source // ""' "$CTX_FILE" 2> /dev/null || echo '')"

    # Só ativa se há mismatch E source é elegível para HEAL v1 imediato
    [ "$real_sid" != "$ctx_sid" ] || return 1
    [ "$ctx_source" = "manual_recovery" ] || [ "$ctx_source" = "inline_restart" ] || return 1

    local heal_expr
    heal_expr=".session.id = \"$real_sid\"
               | .session.vs_code_session_id = \"$real_sid\"
               | .session.source = \"healed_from_real_session\"
               | .session.healed_at = \"$ts\"
               | .session_stats.session_id_syncs_inline = ((.session_stats.session_id_syncs_inline // 0) + 1)"

    if command -v sponge > /dev/null 2>&1; then
        # shellcheck disable=SC2016
        jq "$heal_expr" "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || return 1
    else
        local tmp
        # fix Haiku C6.2: valida mktemp antes de usar (heal_v1)
        tmp="$(mktemp)" || return 1
        # shellcheck disable=SC2016
        if jq "$heal_expr" "$CTX_FILE" > "$tmp" 2> /dev/null; then
            mv "$tmp" "$CTX_FILE" 2> /dev/null || {
                rm -f "$tmp"
                return 1
            }
        else
            rm -f "$tmp"
            return 1
        fi
    fi

    log_event "$(jq -cn \
        --arg event "heal_v1_applied" \
        --arg old "$ctx_sid" \
        --arg new "$real_sid" \
        --arg src "common.sh:heal_v1" \
        --arg ts "$ts" \
        '{event: $event, old_session_id: $old, new_session_id: $new, source: $src, timestamp: $ts,
          message: "HEAL v1: session_id atualizado para ID real do VS Code (manual_recovery/inline_restart)"}')"

    return 0
}

# ════════════════════════════════════════════════════════════════════════════
# HEAL v2 — Recuperação por threshold de mismatches (GAP-04)
# ════════════════════════════════════════════════════════════════════════════
# Ativa quando session_stats.session_id_mismatches >= HOOKS_HEAL_THRESHOLD.
# Mais conservador que HEAL v1: exige acúmulo de evidências antes de corrigir.
# Implementado originalmente em agent-stop.sh — extraído aqui para reutilização.
#
# Parâmetros:
#   $1 = SESSION_ID_PAYLOAD  — session_id real recebido do VS Code
#   $2 = TIMESTAMP           — timestamp ISO-8601 atual
#
# Saída:
#   Retorna 0 se HEAL v2 foi aplicado, 1 se threshold não atingido ou falhou.
#
# Uso:
#   MISMATCHES="$(ctx_read '.session_stats.session_id_mismatches' 0)"
#   if [ "$MISMATCHES" -ge "${HOOKS_HEAL_THRESHOLD:-3}" ]; then
#       heal_v2 "$SESSION_ID_PAYLOAD" "$TIMESTAMP"
#   fi
heal_v2() {
    local real_sid="${1:-}" ts="${2:-$(iso_now)}"
    [ -n "$real_sid" ] || return 1
    [ -f "$CTX_FILE" ] && [ -s "$CTX_FILE" ] || return 1

    local ctx_sid mismatches threshold
    ctx_sid="$(jq -r '.session.id // ""' "$CTX_FILE" 2> /dev/null || echo '')"
    mismatches="$(jq -r '.session_stats.session_id_mismatches // 0' "$CTX_FILE" 2> /dev/null || echo 0)"
    threshold="${HOOKS_HEAL_THRESHOLD:-3}"

    [ "$real_sid" != "$ctx_sid" ] || return 1
    [ "$mismatches" -ge "$threshold" ] 2> /dev/null || return 1

    local heal_expr
    heal_expr=".session.id = \"$real_sid\"
               | .session.vs_code_session_id = \"$real_sid\"
               | .session.source = \"healed_v2_threshold\"
               | .session.healed_at = \"$ts\"
               | .session_stats.session_id_mismatches = 0
               | .session_stats.session_id_syncs_inline = ((.session_stats.session_id_syncs_inline // 0) + 1)"

    if command -v sponge > /dev/null 2>&1; then
        # shellcheck disable=SC2016
        jq "$heal_expr" "$CTX_FILE" | sponge "$CTX_FILE" 2> /dev/null || return 1
    else
        local tmp
        # fix Haiku C6.3: valida mktemp antes de usar (heal_v2)
        tmp="$(mktemp)" || return 1
        # shellcheck disable=SC2016
        if jq "$heal_expr" "$CTX_FILE" > "$tmp" 2> /dev/null; then
            mv "$tmp" "$CTX_FILE" 2> /dev/null || {
                rm -f "$tmp"
                return 1
            }
        else
            rm -f "$tmp"
            return 1
        fi
    fi

    log_event "$(jq -cn \
        --arg event "heal_v2_applied" \
        --arg old "$ctx_sid" \
        --arg new "$real_sid" \
        --arg mismatches "$mismatches" \
        --arg threshold "$threshold" \
        --arg src "common.sh:heal_v2" \
        --arg ts "$ts" \
        '{event: $event, old_session_id: $old, new_session_id: $new,
          mismatches_at_trigger: ($mismatches | tonumber),
          threshold: ($threshold | tonumber),
          source: $src, timestamp: $ts,
          message: "HEAL v2: session_id corrigido por threshold de mismatches atingido"}')"

    return 0
}

# ── increment_mismatch ────────────────────────────────────────────────────────
# Incrementa o contador session_stats.session_id_mismatches no CTX.
# Chamado pelos hooks quando há mismatch mas nenhum HEAL ativou.
#
# Uso: increment_mismatch
increment_mismatch() {
    ctx_update '.session_stats.session_id_mismatches = ((.session_stats.session_id_mismatches // 0) + 1)' \
        2> /dev/null || true
}

# ════════════════════════════════════════════════════════════════════════════
# UPG-AUDIT-01 — Helpers per-session (v1.2)
# Funções para resolução de caminhos per-SESSION_ID e gestão de symlinks
# de compatibilidade retroativa.
# ════════════════════════════════════════════════════════════════════════════

# ── sid_short ────────────────────────────────────────────────────────────────
# Extrai os primeiros 8 caracteres de um session_id UUID (SID_SHORT).
# Usado como sufixo de arquivos per-session: audit-{SID_SHORT}.jsonl
#
# Uso: SID_SHORT="$(sid_short "$SESSION_ID")"
sid_short() {
    local sid="${1:-}"
    echo "${sid:0:8}"
}

# ── resolve_audit_file ────────────────────────────────────────────────────────
# Retorna o caminho do audit file para um SID_SHORT.
# Quando SID_SHORT está vazio, retorna o AUDIT_FILE global (backward compat).
#
# Uso: AUDIT="$(resolve_audit_file "$SID_SHORT")"
resolve_audit_file() {
    local sid_short="${1:-}"
    if [ -n "$sid_short" ]; then
        echo "${LOG_DIR}/audit-${sid_short}.jsonl"
    else
        echo "${AUDIT_FILE}"
    fi
}

# ── resolve_ctx_file ──────────────────────────────────────────────────────────
# Retorna o caminho do session-context para um SID_SHORT.
# Quando SID_SHORT está vazio, retorna o CTX_FILE global (backward compat).
#
# Uso: CTX="$(resolve_ctx_file "$SID_SHORT")"
resolve_ctx_file() {
    local sid_short="${1:-}"
    if [ -n "$sid_short" ]; then
        echo "${STATE_DIR}/session-context-${sid_short}.json"
    else
        echo "${CTX_FILE}"
    fi
}

# ── get_current_session_id ────────────────────────────────────────────────────
# Lê o session_id da sessão ativa de state/current-session-id.txt.
# Scripts manuais devem usar isso para descobrir a sessão ativa.
# Fallback: lê do CTX_FILE global (compatibilidade com versão anterior).
#
# Uso: SID="$(get_current_session_id)"
get_current_session_id() {
    local sid_file="${STATE_DIR}/current-session-id.txt"
    if [ -f "$sid_file" ] && [ -s "$sid_file" ]; then
        tr -d '[:space:]' < "$sid_file" 2> /dev/null || echo ''
    else
        get_session_id
    fi
}

# ── set_current_session_id ────────────────────────────────────────────────────
# Escreve atomicamente o session_id ativo em state/current-session-id.txt.
# Chamado por session-start.sh quando nova sessão começa.
#
# Uso: set_current_session_id "$SESSION_ID"
set_current_session_id() {
    local sid="${1:-}" sid_file="${STATE_DIR}/current-session-id.txt"
    [ -n "$sid" ] || return 1
    local tmp
    tmp="$(mktemp)" || return 1
    echo "$sid" > "$tmp"
    mv "$tmp" "$sid_file" 2> /dev/null || {
        rm -f "$tmp"
        return 1
    }
}

# ── update_compat_symlinks ────────────────────────────────────────────────────
# Atualiza/cria symlinks de compatibilidade retroativa para a sessão ativa.
# Garante que audit.jsonl aponta para audit-{SID_SHORT}.jsonl.
# Garante que session-context.json aponta para session-context-{SID_SHORT}.json,
# mas SÓ quando o arquivo per-session já existe (evita symlink quebrado).
#
# Uso: update_compat_symlinks "$SID_SHORT"
update_compat_symlinks() {
    local sid_short="${1:-}"
    [ -n "$sid_short" ] || return 1

    # audit.jsonl → audit-{SID_SHORT}.jsonl
    local audit_target="${LOG_DIR}/audit-${sid_short}.jsonl"
    touch "$audit_target" 2> /dev/null || true
    # ln -sfn usa caminho relativo para portabilidade
    (cd "$LOG_DIR" && ln -sfn "audit-${sid_short}.jsonl" "audit.jsonl" 2> /dev/null) || true

    # session-context.json → session-context-{SID_SHORT}.json
    # Só cria/atualiza o symlink quando o arquivo de destino já existe.
    local ctx_target="${STATE_DIR}/session-context-${sid_short}.json"
    if [ -f "$ctx_target" ]; then
        (cd "$STATE_DIR" && ln -sfn "session-context-${sid_short}.json" "session-context.json" 2> /dev/null) || true
    fi

    return 0
}

# ── apply_per_session_paths ───────────────────────────────────────────────────
# Resolve e sobreescreve CTX_FILE e AUDIT_FILE para caminhos per-session quando
# o arquivo per-session já existe (criado por session-start.sh).
# Operação segura: só troca se o arquivo per-session existir (backward compat).
# Para uso em hooks VS Code-invocados (recebem SESSION_ID_PAYLOAD por stdin).
#
# Parâmetros: $1 = SESSION_ID_PAYLOAD (session_id do VS Code)
# Saída: modifica CTX_FILE e AUDIT_FILE no escopo do chamador (via eval).
# Retorna 0 se usou per-session, 1 se manteve global.
#
# Uso:
#   apply_per_session_paths "$SESSION_ID_PAYLOAD"
apply_per_session_paths() {
    local sid_payload="${1:-}"
    [ -n "$sid_payload" ] || return 1

    local _ssh
    _ssh="${sid_payload:0:8}"
    local _per_ctx="${STATE_DIR}/session-context-${_ssh}.json"
    local _per_audit="${LOG_DIR}/audit-${_ssh}.jsonl"

    if [ -f "$_per_ctx" ]; then
        CTX_FILE="$_per_ctx"
        AUDIT_FILE="$_per_audit"
        return 0
    fi
    return 1
}
