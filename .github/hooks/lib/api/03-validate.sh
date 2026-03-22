#!/usr/bin/env bash
# api/03-validate.sh — Validação de schema dos payloads
# Módulo 3/6 do sistema hook-payload-api modular
# Carregado por: hook-payload-api.sh (loader principal)
#
# 🔵 CAMADA 2 — DERIVADA DA PLATAFORMA
# Validação de campos obrigatórios por evento, seguindo o schema oficial.
# Política "collect all errors": não para no primeiro erro.
# Depende de: 01-vars.sh (variáveis HOOK_*)

# ─── SEÇÃO 4: VALIDAÇÃO ─────────────────────────────────────────────────────

_hook_api_add_error() {
    if [[ -z "$HOOK_VALIDATION_ERR"  ]]; then
        HOOK_VALIDATION_ERR="$1"
    else
        HOOK_VALIDATION_ERR="${HOOK_VALIDATION_ERR} | $1"
    fi
}

# Verifica que uma variável está preenchida (não vazia nem "null")
_hook_api_require() {
    local var_name="$1"
    local field_desc="${2:-$var_name}"
    # Expansão indireta nativa bash 4+ (sem eval)
    local val="${!var_name:-}"
    if [[ -z "$val"  ]] || [[ "$val" = "null"  ]]; then
        _hook_api_add_error "campo obrigatório ausente: ${field_desc}"
        return 1
    fi
    return 0
}

# Verifica que uma variável é "true" ou "false" (boolean serializado)
_hook_api_require_bool() {
    local var_name="$1"
    # Expansão indireta nativa bash 4+ (sem eval)
    local val="${!var_name:-}"
    case "$val" in
        true | false) return 0 ;;
        *) _hook_api_add_error "${var_name} deve ser true ou false, obtido: '${val}'" ;;
    esac
}

_hook_api_validate_universal() {
    _hook_api_require "HOOK_EVENT" "hookEventName"
    _hook_api_require "HOOK_SESSION_ID" "sessionId"
    # timestamp é recomendado mas não crítico — apenas warning implícito
}

_hook_api_validate_by_event() {
    case "$HOOK_EVENT" in
        SessionStart)
            # source é opcional (padrão "new")
            ;;
        UserPromptSubmit)
            _hook_api_require "HOOK_PROMPT" "prompt"
            ;;
        PreToolUse)
            _hook_api_require "HOOK_TOOL_NAME" "tool_name"
            _hook_api_require "HOOK_TOOL_USE_ID" "tool_use_id"
            ;;
        PostToolUse)
            _hook_api_require "HOOK_TOOL_NAME" "tool_name"
            _hook_api_require "HOOK_TOOL_USE_ID" "tool_use_id"
            ;;
        Stop)
            _hook_api_require_bool "HOOK_STOP_HOOK_ACTIVE"
            ;;
        PreCompact)
            # trigger é opcional (padrão "auto")
            ;;
        SubagentStart)
            _hook_api_require "HOOK_AGENT_ID" "agent_id"
            _hook_api_require "HOOK_AGENT_TYPE" "agent_type"
            ;;
        SubagentStop)
            _hook_api_require "HOOK_AGENT_ID" "agent_id"
            _hook_api_require "HOOK_AGENT_TYPE" "agent_type"
            _hook_api_require_bool "HOOK_STOP_HOOK_ACTIVE"
            ;;
        Unknown)
            _hook_api_add_error "hookEventName ausente ou desconhecido"
            ;;
    esac
}

# hook_api_validate — verifica estado atual das variáveis HOOK_*
# Retorna 0 somente se PARSE_OK=true E VALIDATION_OK=true
hook_api_validate() {
    [[ "$HOOK_PARSE_OK" = "true"  ]] && [[ "$HOOK_VALIDATION_OK" = "true"  ]]
}
