#!/usr/bin/env bash
# api/09-metrics.sh — API de Métricas de Sessão (v1.5)
# Módulo 9/9 do sistema hook-payload-api modular
# Carregado por: hook-payload-api.sh (loader principal)
#
# 🟧 CAMADA 3 — NOSSO SISTEMA (lê session.json via read_field de common.sh)
#
# Depende de: 01-vars.sh (variáveis HOOK_STAT_*, HOOK_COMPLIANCE_*)
#             common.sh  (read_field, STATE_FILE)
#
# DESIGN: getters lazy — leem session.json on-demand via read_field.
# Não poluem o ciclo de hook_api_parse() (que é de stdin/payload).
# Úteis para decisões baseadas em estado histórico da sessão atual.
#
# Estrutura do session.json que estes getters espelham:
#   .session_stats.turn_count
#   .session_stats.turn_authorized
#   .session_stats.turn_unauthorized
#   .session_stats.subturn_total
#   .session_stats.tools_total
#   .current_turn.number
#   .current_turn.ask_questions_called
#   .current_turn.started_at
#   .compliance.consecutive_unauthorized
#   .compliance.last_turn_authorized
#   .close_key

# ─── SEÇÃO 9A: GETTERS DE session_stats ──────────────────────────────────────

# 🟧 hook_stat_turn_count — número total de turnos na sessão
# Retorna integer (string) de .session_stats.turn_count; 0 se ausente
hook_stat_turn_count() {
    local val
    val=$(read_field '.session_stats.turn_count' 2> /dev/null || printf '0')
    printf '%s' "${val:-0}"
}

# 🟧 hook_stat_turn_authorized — turnos encerrados com vscode_askQuestions válido
# Retorna integer string de .session_stats.turn_authorized; 0 se ausente
hook_stat_turn_authorized() {
    local val
    val=$(read_field '.session_stats.turn_authorized' 2> /dev/null || printf '0')
    printf '%s' "${val:-0}"
}

# 🟧 hook_stat_turn_unauthorized — turnos encerrados SEM vscode_askQuestions
# Retorna integer string de .session_stats.turn_unauthorized; 0 se ausente
hook_stat_turn_unauthorized() {
    local val
    val=$(read_field '.session_stats.turn_unauthorized' 2> /dev/null || printf '0')
    printf '%s' "${val:-0}"
}

# 🟧 hook_stat_subturn_total — total de subturns acumulados na sessão
# Retorna integer string de .session_stats.subturn_total; 0 se ausente
hook_stat_subturn_total() {
    local val
    val=$(read_field '.session_stats.subturn_total' 2> /dev/null || printf '0')
    printf '%s' "${val:-0}"
}

# 🟧 hook_stat_tools_total — total de tool calls acumulados na sessão
# Retorna integer string de .session_stats.tools_total; 0 se ausente
hook_stat_tools_total() {
    local val
    val=$(read_field '.session_stats.tools_total' 2> /dev/null || printf '0')
    printf '%s' "${val:-0}"
}

# 🟧 hook_stat_session_duration_seconds — duração da sessão em segundos (UP-18)
# Retorna integer de (now - started_at); 0 se sessão não iniciada ou epoch indisponível
hook_stat_session_duration_seconds() {
    local started_at
    started_at=$(read_field '.started_at' 2> /dev/null || printf '')
    [[ -z "$started_at"  ]] || [[ "$started_at" = "null"  ]] && printf '0' && return 0
    local now epoch_start
    now=$(date +%s 2> /dev/null || printf '0')
    epoch_start=$(_iso_to_epoch "$started_at" 2> /dev/null || printf "$now")
    printf '%d' $((now - epoch_start))
}

# ─── SEÇÃO 9B: GETTERS DE current_turn ───────────────────────────────────────

# 🟧 hook_turn_number — número do turno atual
# Retorna integer string de .current_turn.number; 0 se ausente
hook_turn_number() {
    local val
    val=$(read_field '.current_turn.number' 2> /dev/null || printf '0')
    printf '%s' "${val:-0}"
}

# 🟧 hook_turn_ask_called — true se vscode_askQuestions foi chamado no turno atual
# Retorna "true" ou "false"
hook_turn_ask_called() {
    local val
    val=$(read_field '.current_turn.ask_questions_called' 2> /dev/null || printf 'false')
    case "${val:-false}" in
        true) printf 'true' ;;
        *) printf 'false' ;;
    esac
}

# 🟧 hook_turn_started_at — ISO8601 de quando o turno atual começou
# Retorna string ou vazio se ausente
hook_turn_started_at() {
    read_field '.current_turn.started_at' 2> /dev/null || printf ''
}

# ─── SEÇÃO 9C: GETTERS DE compliance ─────────────────────────────────────────

# 🟧 hook_compliance_consecutive — número de turnos consecutivos sem autorização
# Retorna integer string de .compliance.consecutive_unauthorized; 0 se ausente
hook_compliance_consecutive() {
    local val
    val=$(read_field '.compliance.consecutive_unauthorized' 2> /dev/null || printf '0')
    printf '%s' "${val:-0}"
}

# 🟧 hook_compliance_last_authorized — último turno foi autorizado?
# Retorna "true" ou "false"
hook_compliance_last_authorized() {
    local val
    val=$(read_field '.compliance.last_turn_authorized' 2> /dev/null || printf 'false')
    case "${val:-false}" in
        true) printf 'true' ;;
        *) printf 'false' ;;
    esac
}

# ─── SEÇÃO 9D: GETTER DE close_key ───────────────────────────────────────────

# 🟧 hook_session_close_key — retorna a close_key armazenada no session.json
# Retorna string "ENCERRAR-XXXXXXXX" ou vazio se ausente
hook_session_close_key() {
    read_field '.close_key' 2> /dev/null || printf ''
}

# ─── SEÇÃO 9E: PREDICADOS DE SAÚDE ───────────────────────────────────────────

# 🟧 hook_compliance_ok — retorna 0 (sucesso) se consecutive_unauthorized == 0
# Útil como: if hook_compliance_ok; then ... fi
hook_compliance_ok() {
    [[ "$(hook_compliance_consecutive)" = "0"  ]]
}

# 🟧 hook_needs_askquestions — retorna 0 se turno está aberto e askQuestions NÃO foi chamado
# Turno aberto = current_turn.number > 0 && ask_questions_called == false
hook_needs_askquestions() {
    local turn_num ask_called
    turn_num=$(hook_turn_number)
    ask_called=$(hook_turn_ask_called)
    [ "${turn_num:-0}" -gt 0 ] && [[ "$ask_called" = "false"  ]]
}

# ─── UTILITÁRIO INTERNO: conversão epoch portável ────────────────────────────

# UP-07: helper portável para obter epoch de uma string ISO-8601.
# Tenta GNU date -d, depois BSD date -j, depois awk como último recurso POSIX.
# Retorna epoch em segundos (inteiro), ou "0" em caso de falha.
# Uso: epoch=$(_iso_to_epoch "2026-03-20T10:00:00Z")
_iso_to_epoch() {
    local ts="$1"
    local epoch

    # GNU date (Linux)
    epoch=$(date -d "$ts" '+%s' 2> /dev/null) && [[ -n "$epoch"  ]] && printf '%s' "$epoch" && return

    # BSD date (macOS)
    # Converte "2026-03-20T10:00:00Z" → "20260320100000" para -j -f
    local ts_bsd
    ts_bsd=$(printf '%s' "$ts" | tr -d ':-' | cut -c1-14)
    epoch=$(date -j -f '%Y%m%d%H%M%S' "$ts_bsd" '+%s' 2> /dev/null) \
        && [[ -n "$epoch"  ]] && printf '%s' "$epoch" && return

    # Fallback awk (POSIX puro — via mktime se disponível em gawk/nawk/mawk)
    epoch=$(awk -v ts="$ts" 'BEGIN {
        gsub(/[-T:Z]/, " ", ts)
        split(ts, a, " ")
        printf "%d\n", mktime(a[1]" "a[2]" "a[3]" "a[4]" "a[5]" "a[6]) + 0
    }' /dev/null 2> /dev/null)
    [[ -n "$epoch"  ]] && [[ "$epoch" != "0"  ]] && printf '%s' "$epoch" && return

    # Último recurso: retorna 0 (não será falso-positivo — só não vai detectar órfãos)
    printf '0'
}

# 🟧 hook_is_orphan_turn — retorna 0 se turno está aberto há mais de ORPHAN_THRESHOLD segundos
# Turno órfão: started_at existe + elapsed > threshold (default: 3600 segundos = 1h)
# Uso: HOOK_ORPHAN_THRESHOLD=7200 hook_is_orphan_turn  (para customizar)
# UP-07: usa _iso_to_epoch() portável (GNU+BSD+awk) em vez de date -d literal
hook_is_orphan_turn() {
    local started_at threshold now elapsed epoch_start
    started_at=$(hook_turn_started_at)
    [[ -z "$started_at"  ]] && return 1 # sem started_at → não é órfão

    threshold="${HOOK_ORPHAN_THRESHOLD:-3600}"

    now=$(date '+%s' 2> /dev/null || printf '0')
    epoch_start=$(_iso_to_epoch "$started_at")
    elapsed=$((now - epoch_start))

    [ "$elapsed" -gt "$threshold" ]
}

# 🟧 hook_session_is_healthy — retorna 0 se a sessão está em estado saudável
# Falha se:
#   - compliance_consecutive > 0  (turno não autorizado recente)
#   - turn_count > 0 && turn_authorized == 0  (nunca houve turno autorizado)
#   - hook_is_orphan_turn == true (turno órfão detectado)
hook_session_is_healthy() {
    # compliance deve estar em dia
    hook_compliance_ok || return 1

    # se há turnos, ao menos um deve ter sido autorizado
    local tc ta
    tc=$(hook_stat_turn_count)
    ta=$(hook_stat_turn_authorized)
    if [ "${tc:-0}" -gt 0 ] && [ "${ta:-0}" -eq 0 ]; then
        return 1
    fi

    # turno atual não deve estar órfão
    if hook_is_orphan_turn; then
        return 1
    fi

    return 0
}

# ─── SEÇÃO 9F: POPULADOR DE VARIÁVEIS ────────────────────────────────────────

# 🟧 hook_metrics_load — popula variáveis HOOK_STAT_* / HOOK_COMPLIANCE_* a partir de session.json
# Uso: hook_metrics_load && echo "$HOOK_STAT_TURN_COUNT"
# Util quando o caller precisa de múltiplas métricas (evita múltiplos read_field)
hook_metrics_load() {
    HOOK_STAT_TURN_COUNT=$(hook_stat_turn_count)
    HOOK_STAT_TURN_AUTHORIZED=$(hook_stat_turn_authorized)
    HOOK_STAT_TURN_UNAUTHORIZED=$(hook_stat_turn_unauthorized)
    HOOK_STAT_SUBTURN_TOTAL=$(hook_stat_subturn_total)
    HOOK_STAT_TOOLS_TOTAL=$(hook_stat_tools_total)
    HOOK_COMPLIANCE_CONSECUTIVE=$(hook_compliance_consecutive)
    HOOK_COMPLIANCE_LAST_AUTHORIZED=$(hook_compliance_last_authorized)
    HOOK_TURN_NUMBER=$(hook_turn_number)
    HOOK_TURN_ASK_CALLED=$(hook_turn_ask_called)
    HOOK_SESSION_CLOSE_KEY=$(hook_session_close_key)
    export HOOK_STAT_TURN_COUNT HOOK_STAT_TURN_AUTHORIZED HOOK_STAT_TURN_UNAUTHORIZED
    export HOOK_STAT_SUBTURN_TOTAL HOOK_STAT_TOOLS_TOTAL
    export HOOK_COMPLIANCE_CONSECUTIVE HOOK_COMPLIANCE_LAST_AUTHORIZED
    export HOOK_TURN_NUMBER HOOK_TURN_ASK_CALLED HOOK_SESSION_CLOSE_KEY
}
