#!/usr/bin/env bash
# api/14-validate-events.sh — Strict Validation Schemas por Evento (v2.5)
# Módulo 14/14 do sistema hook-payload-api modular
# Carregado por: hook-payload-api.sh (loader principal)
#
# 🟧 CAMADA NOSSA
# Validação semântica enriquecida dos payloads por evento.
# Retorna JSON estruturado com erros e warnings — complementar a 03-validate.sh.
#
# Diferença de 03-validate.sh:
#   03: validação mínima de campos obrigatórios (bool pass/fail, string de erros)
#   14: validação rica por evento com JSON output, warnings semânticos, counts
#
# Depende de:
#   01-vars.sh         — HOOK_EVENT, HOOK_TOOL_NAME, HOOK_AGENT_TYPE, etc.
#   03-validate.sh     — _hook_api_require (validação de base; não re-exposta)
#   04-predicates.sh   — hook_is_ask_questions, hook_is_todo_event
#
# Variáveis populadas por hook_validate_load():
#   HOOK_VALIDATION_ERRORS_JSON   — JSON array de strings com erros semânticos
#   HOOK_VALIDATION_WARNINGS_JSON — JSON array de strings com warnings semânticos

# ─── SEÇÃO 14A: HELPERS INTERNOS ─────────────────────────────────────────────

# Adiciona um erro ao acumulador local (array via newline-separated string)
_hv_add_error() {
    if [[ -z "${_HV_ERRORS:-}" ]]; then
        _HV_ERRORS="$1"
    else
        _HV_ERRORS="${_HV_ERRORS}"$'\n'"$1"
    fi
}

# Adiciona um warning ao acumulador local
_hv_add_warning() {
    if [[ -z "${_HV_WARNINGS:-}" ]]; then
        _HV_WARNINGS="$1"
    else
        _HV_WARNINGS="${_HV_WARNINGS}"$'\n'"$1"
    fi
}

# Converte acumulador (newline-separated) para JSON array
_hv_to_json_array() {
    local input="${1:-}"
    if [[ -z "$input" ]]; then
        printf '[]'
        return 0
    fi
    # Usa jq para serializar com escaping correto
    printf '%s\n' "$input" | jq -R . | jq -s . 2>/dev/null || printf '[]'
}

# ─── SEÇÃO 14B: VALIDATORS POR EVENTO ────────────────────────────────────────

_hv_validate_session_start() {
    # source deve ser "new" ou "resume" se presente
    local src="${HOOK_SOURCE:-}"
    if [[ -n "$src" && "$src" != "new" && "$src" != "resume" ]]; then
        _hv_add_error "SessionStart: source inválido '${src}' (esperado: new|resume)"
    fi
    # session_id deve estar presente (aviso se ausente — não é erro fatal)
    if [[ -z "${HOOK_SESSION_ID:-}" || "${HOOK_SESSION_ID}" == "null" ]]; then
        _hv_add_warning "SessionStart: session_id ausente — rastreamento limitado"
    fi
}

_hv_validate_user_prompt() {
    # prompt não deve estar vazio
    if [[ -z "${HOOK_PROMPT:-}" || "${HOOK_PROMPT}" == "null" ]]; then
        _hv_add_error "UserPromptSubmit: prompt ausente ou vazio"
    fi
    # prompt muito longo não é erro, mas pode indicar problema
    local len="${#HOOK_PROMPT}"
    if [[ "$len" -gt 50000 ]]; then
        _hv_add_warning "UserPromptSubmit: prompt muito longo (${len} chars) — possível abuso"
    fi
}

_hv_validate_pre_tool_use() {
    # tool_name obrigatório
    if [[ -z "${HOOK_TOOL_NAME:-}" || "${HOOK_TOOL_NAME}" == "null" ]]; then
        _hv_add_error "PreToolUse: tool_name ausente"
    fi
    # tool_use_id obrigatório
    if [[ -z "${HOOK_TOOL_USE_ID:-}" || "${HOOK_TOOL_USE_ID}" == "null" ]]; then
        _hv_add_error "PreToolUse: tool_use_id ausente"
    fi
    # tool_input deve estar presente (ao menos {} vazio)
    if [[ -z "${HOOK_TOOL_INPUT:-}" ]]; then
        _hv_add_warning "PreToolUse: tool_input ausente — usando {}"
    fi
    # run_in_terminal: command não deve estar vazio se tool_name=run_in_terminal
    if [[ "${HOOK_TOOL_NAME:-}" == "run_in_terminal" && -z "${HOOK_TOOL_COMMAND:-}" ]]; then
        _hv_add_error "PreToolUse(run_in_terminal): command ausente no tool_input"
    fi
}

_hv_validate_post_tool_use() {
    # tool_name obrigatório
    if [[ -z "${HOOK_TOOL_NAME:-}" || "${HOOK_TOOL_NAME}" == "null" ]]; then
        _hv_add_error "PostToolUse: tool_name ausente"
    fi
    # tool_use_id obrigatório
    if [[ -z "${HOOK_TOOL_USE_ID:-}" || "${HOOK_TOOL_USE_ID}" == "null" ]]; then
        _hv_add_error "PostToolUse: tool_use_id ausente"
    fi
    # response deve estar presente
    if [[ -z "${HOOK_TOOL_RESPONSE:-}" ]]; then
        _hv_add_warning "PostToolUse: tool_response ausente"
    fi
}

_hv_validate_stop() {
    # stop_hook_active deve ser booleano
    local sha="${HOOK_STOP_HOOK_ACTIVE:-}"
    case "$sha" in
        true|false) ;;
        "") _hv_add_error "Stop: stop_hook_active ausente" ;;
        *)  _hv_add_error "Stop: stop_hook_active deve ser true|false, obtido: '${sha}'" ;;
    esac
}

_hv_validate_subagent() {
    # agent_id obrigatório
    if [[ -z "${HOOK_AGENT_ID:-}" || "${HOOK_AGENT_ID}" == "null" ]]; then
        _hv_add_error "${HOOK_EVENT}: agent_id ausente"
    fi
    # agent_type obrigatório
    if [[ -z "${HOOK_AGENT_TYPE:-}" || "${HOOK_AGENT_TYPE}" == "null" ]]; then
        _hv_add_error "${HOOK_EVENT}: agent_type ausente"
    fi
    # SubagentStop: requer stop_hook_active
    if [[ "${HOOK_EVENT:-}" == "SubagentStop" ]]; then
        local sha="${HOOK_STOP_HOOK_ACTIVE:-}"
        case "$sha" in
            true|false) ;;
            *) _hv_add_error "SubagentStop: stop_hook_active ausente ou inválido" ;;
        esac
    fi
}

_hv_validate_pre_compact() {
    # trigger é opcional, mas deve ser "auto" ou "manual" se presente
    local trig="${HOOK_COMPACT_TRIGGER:-}"
    if [[ -n "$trig" && "$trig" != "auto" && "$trig" != "manual" ]]; then
        _hv_add_warning "PreCompact: trigger incomum '${trig}' (esperado: auto|manual)"
    fi
}

# ─── SEÇÃO 14C: DISPATCHER PRINCIPAL ─────────────────────────────────────────

# 🟧 hook_validate_payload — valida campos semânticos do evento atual
# Preenche _HV_ERRORS e _HV_WARNINGS; retorna 0 se sem erros, 1 se há erros.
# Uso: hook_validate_payload  (usa HOOK_EVENT atual)
hook_validate_payload() {
    _HV_ERRORS=""
    _HV_WARNINGS=""

    # Validação universal: event+session imprescindíveis
    if [[ -z "${HOOK_EVENT:-}" || "${HOOK_EVENT}" == "null" || "${HOOK_EVENT}" == "Unknown" ]]; then
        _hv_add_error "hookEventName ausente ou desconhecido"
    fi

    case "${HOOK_EVENT:-}" in
        SessionStart)       _hv_validate_session_start ;;
        UserPromptSubmit)   _hv_validate_user_prompt ;;
        PreToolUse)         _hv_validate_pre_tool_use ;;
        PostToolUse)        _hv_validate_post_tool_use ;;
        Stop)               _hv_validate_stop ;;
        SubagentStart|SubagentStop) _hv_validate_subagent ;;
        PreCompact)         _hv_validate_pre_compact ;;
        Unknown|"")         ;;   # já adicionado erro acima
    esac

    [[ -z "${_HV_ERRORS:-}" ]] && return 0
    return 1
}

# ─── SEÇÃO 14D: PREDICADOS E ACESSORES ───────────────────────────────────────

# 🟧 hook_validate_has_errors — true se hook_validate_payload detectou erros
hook_validate_has_errors() {
    [[ -n "${_HV_ERRORS:-}" ]] && return 0
    return 1
}

# 🟧 hook_validate_has_warnings — true se há warnings semânticos
hook_validate_has_warnings() {
    [[ -n "${_HV_WARNINGS:-}" ]] && return 0
    return 1
}

# 🟧 hook_validate_error_count — número de erros detectados
hook_validate_error_count() {
    if [[ -z "${_HV_ERRORS:-}" ]]; then
        printf '0'
        return 0
    fi
    local count
    count=$(printf '%s\n' "${_HV_ERRORS}" | grep -c .)
    printf '%s' "$count"
}

# 🟧 hook_validate_warning_count — número de warnings detectados
hook_validate_warning_count() {
    if [[ -z "${_HV_WARNINGS:-}" ]]; then
        printf '0'
        return 0
    fi
    local count
    count=$(printf '%s\n' "${_HV_WARNINGS}" | grep -c .)
    printf '%s' "$count"
}

# 🟧 hook_validate_errors_json — erros como JSON array de strings
hook_validate_errors_json() {
    _hv_to_json_array "${_HV_ERRORS:-}"
}

# 🟧 hook_validate_warnings_json — warnings como JSON array de strings
hook_validate_warnings_json() {
    _hv_to_json_array "${_HV_WARNINGS:-}"
}

# ─── SEÇÃO 14E: LOADER (popula variáveis HOOK_VALIDATION_*) ──────────────────

# 🟧 hook_validate_load — executa hook_validate_payload e popula HOOK_VALIDATION_*
# Deve ser chamado após hook_api_parse.
# Popula HOOK_VALIDATION_ERRORS_JSON e HOOK_VALIDATION_WARNINGS_JSON.
hook_validate_load() {
    hook_validate_payload || true    # ignora exit code; erros ficam em _HV_ERRORS
    HOOK_VALIDATION_ERRORS_JSON="$(hook_validate_errors_json)"
    HOOK_VALIDATION_WARNINGS_JSON="$(hook_validate_warnings_json)"
    export HOOK_VALIDATION_ERRORS_JSON HOOK_VALIDATION_WARNINGS_JSON
}
