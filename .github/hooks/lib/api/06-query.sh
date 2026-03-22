#!/usr/bin/env bash
# api/06-query.sh — Query API: getters, dump e listagem de capturas
# Módulo 6/7 do sistema hook-payload-api modular
# Carregado por: hook-payload-api.sh (loader principal)
#
# 🔵 CAMADA 2 — DERIVADA DA PLATAFORMA (getters, dump, from_file, list_captures)
# Obs: hook_api_record (🟧) foi movido para 07-state.sh
#
# Depende de: 01-vars.sh (variáveis), 02-parse.sh (hook_api_parse não está aqui —
#             fica no loader hook-payload-api.sh como entrypoint focal)
# Usa de common.sh: (nenhuma — hook_api_record movido para 07-state.sh)

# ─── SEÇÃO 9: QUERY API ──────────────────────────────────────────────────────
# Funções de alto nível "get_*" para acesso sem conhecer o nome exato da variável.
# Úteis quando o código recebe um evento genérico e precisa extrair campos por nome.

# 🔵 hook_get_session_id — retorna sessionId com fallback
hook_get_session_id() { printf '%s' "$HOOK_SESSION_ID"; }

# 🔵 hook_get_tool_name — retorna tool_name (PreToolUse/PostToolUse)
hook_get_tool_name() { printf '%s' "$HOOK_TOOL_NAME"; }

# 🔵 hook_get_agent_id — retorna agent_id (SubagentStart/SubagentStop)
hook_get_agent_id() { printf '%s' "$HOOK_AGENT_ID"; }

# 🔵 hook_get_prompt — retorna prompt completo (UserPromptSubmit)
hook_get_prompt() { printf '%s' "$HOOK_PROMPT"; }

# 🔵 hook_get_command — retorna command de run_in_terminal
hook_get_command() { printf '%s' "$HOOK_TOOL_COMMAND"; }

# 🔵 hook_get_tool_input_field — extrai um campo específico do tool_input via jq
# Uso: hook_get_tool_input_field ".command"
hook_get_tool_input_field() {
    printf '%s' "$HOOK_TOOL_INPUT" | jq -r "${1} // empty"
}

# 🔵 hook_get_response_field — extrai um campo específico do tool_response via jq
# Uso: hook_get_response_field ".answers.Template_A.freeText"
hook_get_response_field() {
    if [[ "$HOOK_TOOL_RESPONSE_IS_JSON" = "true"  ]]; then
        printf '%s' "$HOOK_TOOL_RESPONSE" | jq -r "${1} // empty"
    else
        printf ''
    fi
}

# ─── SEÇÃO 7: UTILITÁRIOS ────────────────────────────────────────────────────

# 🔵 hook_summary — retorna string concisa para logging (event + tool/agent se aplicável)
# Ex: "PreToolUse[run_in_terminal]" ou "SubagentStop[Explore]" ou "Stop"
hook_summary() {
    case "$HOOK_EVENT" in
        PreToolUse | PostToolUse)
            printf '%s[%s]' "$HOOK_EVENT" "$HOOK_TOOL_NAME"
            ;;
        SubagentStart | SubagentStop)
            printf '%s[%s]' "$HOOK_EVENT" "$HOOK_AGENT_TYPE"
            ;;
        UserPromptSubmit)
            printf 'UserPromptSubmit[%.40s]' "$HOOK_PROMPT"
            ;;
        *)
            printf '%s' "$HOOK_EVENT"
            ;;
    esac
}

# 🔵 hook_api_dump — imprime estado atual das variáveis HOOK_* (para debug/stderr)
hook_api_dump() {
    {
        printf '┌─ hook_api_dump ──────────────────────────────────────┐\n'
        printf '│ HOOK_EVENT          = %-34s│\n' "$HOOK_EVENT"
        printf '│ HOOK_SESSION_ID     = %-34s│\n' "${HOOK_SESSION_ID:0:34}"
        printf '│ HOOK_TIMESTAMP      = %-34s│\n' "${HOOK_TIMESTAMP:0:34}"
        printf '│ HOOK_PARSE_OK       = %-34s│\n' "$HOOK_PARSE_OK"
        printf '│ HOOK_VALIDATION_OK  = %-34s│\n' "$HOOK_VALIDATION_OK"
        if [[ -n "$HOOK_VALIDATION_ERR"  ]]; then
            printf '│ HOOK_VALIDATION_ERR = %-34s│\n' "${HOOK_VALIDATION_ERR:0:34}"
        fi
        printf '├── campos do evento ────────────────────────────────────┤\n'
        case "$HOOK_EVENT" in
            SessionStart)
                printf '│ HOOK_SOURCE         = %-34s│\n' "$HOOK_SOURCE"
                ;;
            UserPromptSubmit)
                printf '│ HOOK_PROMPT         = %-34s│\n' "${HOOK_PROMPT:0:34}"
                ;;
            PreToolUse)
                printf '│ HOOK_TOOL_NAME      = %-34s│\n' "$HOOK_TOOL_NAME"
                printf '│ HOOK_TOOL_USE_ID    = %-34s│\n' "${HOOK_TOOL_USE_ID:0:34}"
                printf '│ HOOK_TOOL_COMMAND   = %-34s│\n' "${HOOK_TOOL_COMMAND:0:34}"
                printf '│ HOOK_TOOL_FILE_PATH = %-34s│\n' "${HOOK_TOOL_FILE_PATH:0:34}"
                printf '│ HOOK_TOOL_IS_BG     = %-34s│\n' "$HOOK_TOOL_IS_BG"
                printf '│ HOOK_TODO_COUNT     = %-34s│\n' "$HOOK_TODO_COUNT"
                if [[ -n "$HOOK_TODO_LAST_TITLE"  ]]; then
                    printf '│ HOOK_TODO_LAST      = [%s] %s\n' \
                        "$HOOK_TODO_LAST_STATUS" "${HOOK_TODO_LAST_TITLE:0:28}"
                fi
                ;;
            PostToolUse)
                printf '│ HOOK_TOOL_NAME      = %-34s│\n' "$HOOK_TOOL_NAME"
                printf '│ HOOK_RESP_IS_JSON   = %-34s│\n' "$HOOK_TOOL_RESPONSE_IS_JSON"
                if hook_is_ask_questions; then
                    printf '│ HOOK_ASK_FREE_TEXT  = %-34s│\n' "${HOOK_ASK_FREE_TEXT:0:34}"
                    printf '│ HOOK_ASK_SELECTED   = %-34s│\n' "${HOOK_ASK_SELECTED:0:34}"
                    printf '│ HOOK_ASK_SKIPPED    = %-34s│\n' "$HOOK_ASK_SKIPPED"
                fi
                ;;
            Stop)
                printf '│ HOOK_STOP_HOOK_ACT  = %-34s│\n' "$HOOK_STOP_HOOK_ACTIVE"
                ;;
            PreCompact)
                printf '│ HOOK_COMPACT_TRIG   = %-34s│\n' "$HOOK_COMPACT_TRIGGER"
                ;;
            SubagentStart | SubagentStop)
                printf '│ HOOK_AGENT_ID       = %-34s│\n' "${HOOK_AGENT_ID:0:34}"
                printf '│ HOOK_AGENT_TYPE     = %-34s│\n' "$HOOK_AGENT_TYPE"
                if [[ "$HOOK_EVENT" = "SubagentStop"  ]]; then
                    printf '│ HOOK_STOP_HOOK_ACT  = %-34s│\n' "$HOOK_STOP_HOOK_ACTIVE"
                fi
                ;;
        esac
        printf '└─────────────────────────────────────────────────────┘\n'
    } >&2
}

# 🔵 hook_api_from_file — carrega payload de arquivo de captura de debug
# Uso: hook_api_from_file ".github/hooks/state/debug/payloads/PreToolUse-...json"
hook_api_from_file() {
    local file="$1"
    if [[ ! -f "$file"  ]]; then
        printf 'hook_api_from_file: arquivo não encontrado: %s\n' "$file" >&2
        return 1
    fi
    hook_api_parse "$(cat "$file")"
}

# ─── SEÇÃO 10: COLETOR UNIVERSAL ────────────────────────────────────────────
# Nota: hook_api_record() foi movido para api/07-state.sh (depende de STATE_DIR)

# 🔵 hook_api_list_captures — lista arquivos de captura disponíveis
hook_api_list_captures() {
    local debug_dir
    if declare -f read_field > /dev/null 2>&1 && [[ -n "${STATE_DIR:-}"  ]]; then
        debug_dir="${STATE_DIR}/debug/payloads"
    else
        debug_dir="${HOOKS_TEST_STATE_DIR:-/tmp}/debug/payloads"
    fi
    if [[ ! -d "$debug_dir"  ]] || [[ -z "$(ls -A "$debug_dir" 2> /dev/null)"  ]]; then
        printf '(nenhum payload capturado — use: bash debug-capture.sh on)\n'
        return 0
    fi
    printf 'Payloads capturados em %s:\n' "$debug_dir"
    find "$debug_dir" -maxdepth 1 -name '*.json' -printf '%T@ %p\n' 2> /dev/null \
        | sort -rn | awk '{printf "  %s\n", $2}'
}
