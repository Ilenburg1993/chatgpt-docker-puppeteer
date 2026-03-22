#!/usr/bin/env bash
# api/15-audit.sh — Audit system: logging, auto-enrichment, query API (v2.0 — U8)
# Módulo 15 do sistema hook-payload-api modular
# Carregado por: hook-payload-api.sh (loader principal)
#
# 🟧 CAMADA 3 — NOSSO SISTEMA
# Implementação canônica do audit system. Substitui o stub v1.0.
# common.sh → log_audit() delega para _audit_write_event() deste módulo
# quando disponível (via declaração de função).
#
# Depende de:
#   common.sh  — AUDIT_FILE, STATE_FILE, STATE_DIR, now_iso
#                _audit_event_is_suppressed(), _audit_cap_check()
#
# Performance: _audit_write_event() usa UM único jq call por evento
#              (vs 1+N forks da implementação legada em common.sh).
#
# Auto-enrichment: cada evento recebe automaticamente turn, turn_id,
#                  subturn_id e tool_name quando HOOK_AUDIT_ENRICH=true.
#
# Uso (API pública):
#   hook_log_audit "event" [key1 value1 ...]
#   hook_audit_count "event"                → integer (string)
#   hook_audit_has "event"                  → exit 0 se encontrado, 1 se não
#   hook_audit_last "event" [field]         → valor do campo (ou linha JSON)
#   hook_audit_events_since "ISO8601"       → linhas filtradas por timestamp
#
# ─── SEÇÃO 15C: WRITER CONSOLIDADO (U8 — performance + auto-enrichment) ─────

# _audit_write_event — implementação canônica do escritor de eventos de auditoria.
#
# Constrói o JSON com UM único jq -cn call (vs 1+N do legado).
# Auto-enriquece com turn, turn_id, subturn_id, tool_name quando HOOK_AUDIT_ENRICH=true.
# Campos passados pelo chamador têm prioridade sobre auto-enrich (override por posição).
#
# @param {string} $1  event name
# @param {string} ... key value pairs (opcional)
# @returns {void}     grava linha JSON em $AUDIT_FILE; retorna 0 em caso de erro
_audit_write_event() {
    local event="$1"
    shift

    # Filtrar por nível antes de qualquer trabalho (USA _audit_event_is_suppressed de common.sh)
    _audit_event_is_suppressed "$event" && return 0

    local ts sid
    ts="$(now_iso)"
    sid="${SESSION_ID:-unknown}"

    # --- Auto-enrichment: UM jq call para ler todos os campos de contexto ---
    local _ae_turn="" _ae_turn_id="" _ae_subturn_id="" _ae_tool=""
    if [[ "${HOOK_AUDIT_ENRICH:-true}" = "true" ]] && [[ -f "${STATE_FILE:-}" ]]; then
        local _ae_tsv
        _ae_tsv=$(jq -rj '
            ((.current_turn.number // 0) | if . > 0 then tostring else "" end), "\t",
            (.current_turn.turn_id // ""), "\t",
            (.current_subturn.subturn_id // "")
        ' "${STATE_FILE}" 2> /dev/null || printf '\t\t')
        IFS=$'\t' read -r _ae_turn _ae_turn_id _ae_subturn_id <<< "${_ae_tsv}"
        # tool_name já populado pelo hook_api_parse (sem fork adicional)
        [[ -n "${HOOK_TOOL_NAME:-}" ]] && _ae_tool="${HOOK_TOOL_NAME}"
    fi

    # --- Coletar todos os pares key→value em arrays bash ---
    local -a _keys=("ts" "event" "session_id")
    local -a _vals=("${ts}" "${event}" "${sid}")

    # Auto-enrich (somente se não-vazio; caller pode override por reescrever o campo depois)
    if [[ "${HOOK_AUDIT_ENRICH:-true}" = "true" ]]; then
        [[ -n "${_ae_turn}" ]] && _keys+=("turn") && _vals+=("${_ae_turn}")
        [[ -n "${_ae_turn_id}" ]] && _keys+=("turn_id") && _vals+=("${_ae_turn_id}")
        [[ -n "${_ae_subturn_id}" ]] && _keys+=("subturn_id") && _vals+=("${_ae_subturn_id}")
        [[ -n "${_ae_tool}" ]] && _keys+=("tool_name") && _vals+=("${_ae_tool}")
    fi

    # Campos do caller (adicionados depois → sobrescrevem auto-enrich via jq .+{(...):...})
    while [[ "$#" -ge 2 ]]; do
        _keys+=("$1")
        _vals+=("$2")
        shift 2
    done

    # --- UM único jq -cn: constrói objeto com todos os pares indexados ---
    local -a _jq_args=()
    local _jq_body='{}'
    local i n
    n=${#_keys[@]}
    for ((i = 0; i < n; i++)); do
        _jq_args+=(--arg "_k${i}" "${_keys[$i]}" --arg "_v${i}" "${_vals[$i]}")
        _jq_body="${_jq_body}|.+{(\$_k${i}):\$_v${i}}"
    done

    mkdir -p "${STATE_DIR:-$(dirname "${AUDIT_FILE:-/tmp/audit.jsonl}")}" 2> /dev/null || true
    local _json_obj
    _json_obj=$(jq -cn "${_jq_args[@]}" "${_jq_body}" 2> /dev/null) || return 0
    printf '%s\n' "${_json_obj}" >> "${AUDIT_FILE:-/tmp/audit.jsonl}"

    # Cap check (USA _audit_cap_check de common.sh)
    _audit_cap_check || true
}

# ─── SEÇÃO 15A: API PÚBLICA — LOG ────────────────────────────────────────────

# hook_log_audit — registra evento no audit.jsonl
# API pública canônica. Delega para _audit_write_event (implementação otimizada).
#
# @param {string} $1  event name
# @param {string} ... key value pairs (opcional)
# @returns {void}
hook_log_audit() {
    _audit_write_event "$@"
}

# ─── SEÇÃO 15D: API PÚBLICA — QUERY ──────────────────────────────────────────

# hook_audit_count — conta ocorrências de um evento no audit.jsonl ativo.
#
# Usa grep -c para eficiência (evita carregar o arquivo inteiro).
# NOTA: funciona com formato jq compact ("event":"name").
#
# @param {string} $1  event name
# @returns {string}   integer (ex: "3"); "0" se não encontrado ou arquivo ausente
hook_audit_count() {
    local event="$1"
    [[ -f "${AUDIT_FILE:-}" ]] || {
        printf '0'
        return 0
    }
    local cnt
    cnt=$(grep -c "\"event\":\"${event}\"" "${AUDIT_FILE}" 2> /dev/null) || cnt="0"
    printf '%s' "${cnt:-0}"
}

# hook_audit_has — verifica se um evento existe no audit.jsonl ativo.
#
# @param {string} $1  event name
# @returns {int}      0 se encontrado, 1 se não encontrado ou arquivo ausente
hook_audit_has() {
    local event="$1"
    [[ -f "${AUDIT_FILE:-}" ]] || return 1
    grep -q "\"event\":\"${event}\"" "${AUDIT_FILE}" 2> /dev/null
}

# hook_audit_last — retorna o valor de um campo no ÚLTIMO evento de um dado tipo.
#
# @param {string} $1  event name
# @param {string} $2  field name (opcional; omitir retorna a linha JSON completa)
# @returns {string}   valor do campo, "" se evento ou campo ausente
hook_audit_last() {
    local event="$1" field="${2:-}"
    [[ -f "${AUDIT_FILE:-}" ]] || {
        printf ''
        return 0
    }
    local last_line
    last_line=$(grep "\"event\":\"${event}\"" "${AUDIT_FILE}" 2> /dev/null | tail -1)
    [[ -z "${last_line}" ]] && {
        printf ''
        return 0
    }
    if [[ -z "${field}" ]]; then
        printf '%s' "${last_line}"
    else
        printf '%s' "${last_line}" | jq -r --arg f "${field}" '.[$f] // ""' 2> /dev/null \
            || printf ''
    fi
}

# hook_audit_events_since — retorna todas as linhas de eventos após um timestamp ISO 8601.
#
# Filtra via jq (.ts >= $since) — comparação lexicográfica válida para ISO 8601.
#
# @param {string} $1  timestamp ISO 8601 (ex: "2026-01-01T00:00:00Z")
# @returns {string}   linhas JSONL filtradas (pode ser vazio)
hook_audit_events_since() {
    local since="$1"
    [[ -f "${AUDIT_FILE:-}" ]] || {
        printf ''
        return 0
    }
    jq -c --arg since "${since}" 'select(.ts >= $since)' "${AUDIT_FILE}" 2> /dev/null \
        || printf ''
}
