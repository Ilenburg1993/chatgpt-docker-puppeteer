#!/usr/bin/env bash
# hook-payload-api.sh — LOADER: carrega módulos api/ e expõe hook_api_parse
# v2.0-modular — 2026-03-18
#
# Ponto de entrada backward-compatible para o sistema modular de parsing.
# Scripts que fazem `source hook-payload-api.sh` continuam funcionando sem mudanças.
#
# ╔══════════════════════════════════════════════════════════════════════════╗
# ║ MÓDULOS CARREGADOS (em ordem):                                          ║
# ║   api/01-vars.sh       — HOOK_* declarations + _hook_api_reset()       ║
# ║   api/02-parse.sh      — _hook_api_parse_universal + parsers por evento ║
# ║   api/03-validate.sh   — _hook_api_validate_* + hook_api_validate()    ║
# ║   api/04-predicates.sh — hook_is_* + hook_response_has_error + meta    ║
# ║   api/05-output.sh     — hook_out_* output builders (protocolo 🟦)     ║
# ║   api/06-query.sh      — hook_get_* + hook_summary + hook_api_record   ║
# ╚══════════════════════════════════════════════════════════════════════════╝
#
# ENTRYPOINT PÚBLICO definido aqui (neste arquivo):
#   hook_api_parse [payload]   — lê stdin ou string, popula HOOK_*, retorna 0/1
#   hook_api_validate          — definido em 03-validate.sh
#   hook_api_dump              — definido em 06-query.sh
#   hook_api_from_file <f>     — definido em 06-query.sh
#   hook_api_list_captures     — definido em 06-query.sh
#
# DEPENDÊNCIA: common.sh (jq_field, detect_close_key_in_text, maybe_capture_debug)
# Se não estiver disponível, fallbacks inline são usados automaticamente.

# shellcheck source=common.sh
_HOOK_API_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$_HOOK_API_LIB_DIR/common.sh" ] && ! declare -f jq_field > /dev/null 2>&1; then
    # shellcheck disable=SC1091
    source "$_HOOK_API_LIB_DIR/common.sh"
fi
# Fallbacks inline se common.sh não estiver disponível
if ! declare -f jq_field > /dev/null 2>&1; then
    jq_field() { printf '%s' "$1" | jq -r "${2} // empty"; }
fi
if ! declare -f detect_close_key_in_text > /dev/null 2>&1; then
    detect_close_key_in_text() { return 1; }
fi
if ! declare -f maybe_capture_debug > /dev/null 2>&1; then
    maybe_capture_debug() { :; }
fi
if ! declare -f export_lang_utf8 > /dev/null 2>&1; then
    export_lang_utf8() { export LANG="C.UTF-8" LC_ALL="C.UTF-8"; }
fi

export_lang_utf8

# ─── CARREGA MÓDULOS ─────────────────────────────────────────────────────────
_HOOK_API_MODULES_DIR="$_HOOK_API_LIB_DIR/api"
# shellcheck disable=SC1091
source "$_HOOK_API_MODULES_DIR/01-vars.sh"
# shellcheck disable=SC1091
source "$_HOOK_API_MODULES_DIR/02-parse.sh"
# shellcheck disable=SC1091
source "$_HOOK_API_MODULES_DIR/03-validate.sh"
# shellcheck disable=SC1091
source "$_HOOK_API_MODULES_DIR/04-predicates.sh"
# shellcheck disable=SC1091
source "$_HOOK_API_MODULES_DIR/05-output.sh"
# shellcheck disable=SC1091
source "$_HOOK_API_MODULES_DIR/06-query.sh"
# shellcheck disable=SC1091
source "$_HOOK_API_MODULES_DIR/07-state.sh"
# shellcheck disable=SC1091
source "$_HOOK_API_MODULES_DIR/08-risk.sh"

# ─── ENTRYPOINT PRINCIPAL ────────────────────────────────────────────────────

# hook_api_parse — lê stdin (ou argumento) e popula todas as variáveis HOOK_*
# Retorna 0 se parse+validação OK, 1 se falhou.
# Uso:
#   hook_api_parse           (lê stdin)
#   hook_api_parse "$input"  (usa string — útil em testes)
hook_api_parse() {
    _hook_api_reset

    local raw
    if [ -n "${1:-}" ]; then
        raw="$1"
    else
        raw=$(cat /dev/stdin 2> /dev/null || true)
    fi

    # Guarda bruto antes de qualquer processamento
    HOOK_RAW="$raw"
    export HOOK_RAW

    # Garante que é JSON válido antes de prosseguir
    if [ -z "$raw" ] || ! printf '%s' "$raw" | jq -e . > /dev/null 2>&1; then
        HOOK_PARSE_OK="false"
        HOOK_RAW="{}"
        HOOK_VALIDATION_OK="false"
        HOOK_VALIDATION_ERR="payload vazio ou JSON inválido"
        export HOOK_PARSE_OK HOOK_VALIDATION_OK HOOK_VALIDATION_ERR HOOK_RAW
        return 1
    fi

    HOOK_PARSE_OK="true"
    export HOOK_PARSE_OK

    # Captura de debug automática (se flag ativo em state/debug/)
    maybe_capture_debug "$raw"

    # === Campos universais (todos os eventos) ===
    _hook_api_parse_universal "$raw"

    # === Campos específicos por evento ===
    case "$HOOK_EVENT" in
        SessionStart)
            _hook_api_parse_session_start "$raw"
            ;;
        UserPromptSubmit)
            _hook_api_parse_user_prompt_submit "$raw"
            ;;
        PreToolUse)
            _hook_api_parse_tool_fields "$raw"
            ;;
        PostToolUse)
            _hook_api_parse_post_tool_use "$raw"
            ;;
        Stop)
            _hook_api_parse_stop "$raw"
            ;;
        PreCompact)
            _hook_api_parse_pre_compact "$raw"
            ;;
        SubagentStart | SubagentStop)
            _hook_api_parse_subagent "$raw"
            ;;
            # SessionEnd, Unknown: apenas campos universais
    esac

    # === Validação de schema ===
    HOOK_VALIDATION_ERR=""
    _hook_api_validate_universal
    _hook_api_validate_by_event

    if [ -z "$HOOK_VALIDATION_ERR" ]; then
        HOOK_VALIDATION_OK="true"
    else
        HOOK_VALIDATION_OK="false"
    fi
    export HOOK_VALIDATION_OK HOOK_VALIDATION_ERR

    # === Cômputo de segurança (v1.2) ===
    _hook_security_compute

    # === Cômputo de risco e categoria (v1.3) ===
    _hook_risk_compute

    [ "$HOOK_VALIDATION_OK" = "true" ]
}
