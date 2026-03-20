#!/usr/bin/env bash
# api/02-parse.sh — Funções de parsing de payload por evento
# Módulo 2/6 do sistema hook-payload-api modular
# Carregado por: hook-payload-api.sh (loader principal)
#
# 🔵 CAMADA 2 — DERIVADA DA PLATAFORMA
# Toda a lógica de extração de campos do JSON de entrada.
# Depende de: 01-vars.sh (_hook_api_reset)
# Usa de common.sh: (nenhuma — apenas jq puro)

# ─── SEÇÃO 2: PARSING UNIVERSAL ─────────────────────────────────────────────

_hook_api_parse_universal() {
    local raw="$1"

    # sessionId: campo oficial camelCase (mar/2026) com fallback snake_case
    HOOK_SESSION_ID=$(printf '%s' "$raw" | jq -r '.sessionId // .session_id // empty')
    HOOK_TIMESTAMP=$(printf '%s' "$raw" | jq -r '.timestamp // empty')
    HOOK_CWD=$(printf '%s' "$raw" | jq -r '.cwd // empty')
    HOOK_TRANSCRIPT=$(printf '%s' "$raw" | jq -r '.transcript_path // empty')

    # Normaliza hookEventName para PascalCase independente do formato de entrada
    # (VS Code usa PascalCase; Copilot CLI usa lowerCamelCase)
    local raw_event
    raw_event=$(printf '%s' "$raw" | jq -r '.hookEventName // empty')
    case "$raw_event" in
        sessionStart | SessionStart) HOOK_EVENT="SessionStart" ;;
        userPromptSubmit | UserPromptSubmit | userPromptSubmitted) HOOK_EVENT="UserPromptSubmit" ;;
        preToolUse | PreToolUse) HOOK_EVENT="PreToolUse" ;;
        postToolUse | PostToolUse) HOOK_EVENT="PostToolUse" ;;
        stop | Stop | agentStop | AgentStop) HOOK_EVENT="Stop" ;;
        preCompact | PreCompact) HOOK_EVENT="PreCompact" ;;
        subagentStart | SubagentStart) HOOK_EVENT="SubagentStart" ;;
        subagentStop | SubagentStop) HOOK_EVENT="SubagentStop" ;;
        sessionEnd | SessionEnd) HOOK_EVENT="SessionEnd" ;;
        "") HOOK_EVENT="Unknown" ;;
        *) HOOK_EVENT="$raw_event" ;;
    esac

    export HOOK_SESSION_ID HOOK_TIMESTAMP HOOK_CWD HOOK_TRANSCRIPT HOOK_EVENT
}

# ─── SEÇÃO 3: PARSING POR EVENTO ────────────────────────────────────────────

_hook_api_parse_session_start() {
    local raw="$1"
    HOOK_SOURCE=$(printf '%s' "$raw" | jq -r '.source // "new"')
    export HOOK_SOURCE
}

_hook_api_parse_user_prompt_submit() {
    local raw="$1"
    HOOK_PROMPT=$(printf '%s' "$raw" | jq -r '.prompt // empty')
    export HOOK_PROMPT
}

# Sub-campos do tool_input extraídos por ferramenta
# Suporta: run_in_terminal, read_file, create_file, replace_string_in_file,
#          multi_replace_string_in_file, grep_search, file_search, semantic_search,
#          list_dir, runSubagent, vscode_askQuestions, manage_todo_list, get_errors
_hook_api_parse_tool_input_subfields() {
    local input="$1"

    # --- run_in_terminal ---
    HOOK_TOOL_COMMAND=$(printf '%s' "$input" | jq -r '.command // empty')
    HOOK_TOOL_EXPLANATION=$(printf '%s' "$input" | jq -r '.explanation // empty')
    HOOK_TOOL_GOAL=$(printf '%s' "$input" | jq -r '.goal // empty')
    HOOK_TOOL_IS_BG=$(printf '%s' "$input" | jq -r '.isBackground // false')
    HOOK_TOOL_TIMEOUT=$(printf '%s' "$input" | jq -r '.timeout // 30000')

    # --- read_file / create_file / replace_string_in_file / get_errors ---
    HOOK_TOOL_FILE_PATH=$(printf '%s' "$input" | jq -r '.filePath // empty')
    HOOK_TOOL_START_LINE=$(printf '%s' "$input" | jq -r '.startLine // empty')
    HOOK_TOOL_END_LINE=$(printf '%s' "$input" | jq -r '.endLine // empty')

    # --- replace_string_in_file ---
    HOOK_TOOL_OLD_STRING=$(printf '%s' "$input" | jq -r '.oldString // empty')
    HOOK_TOOL_NEW_STRING=$(printf '%s' "$input" | jq -r '.newString // empty')

    # --- grep_search / file_search / semantic_search ---
    HOOK_TOOL_QUERY=$(printf '%s' "$input" | jq -r '.query // empty')
    HOOK_TOOL_IS_REGEX=$(printf '%s' "$input" | jq -r '.isRegexp // false')
    HOOK_TOOL_INCLUDE_PAT=$(printf '%s' "$input" | jq -r '.includePattern // empty')

    # --- list_dir ---
    HOOK_TOOL_DIR_PATH=$(printf '%s' "$input" | jq -r '.path // empty')

    # --- runSubagent ---
    HOOK_TOOL_AGENT_NAME=$(printf '%s' "$input" | jq -r '.agentName // empty')
    # Trunca prompt/description a 200 chars para evitar variáveis gigantes
    HOOK_TOOL_AGENT_PROMPT=$(printf '%s' "$input" \
        | jq -r '(.prompt // .description // "") | .[0:200]')

    # --- vscode_askQuestions (PreToolUse) ---
    HOOK_ASK_QUESTIONS_JSON=$(printf '%s' "$input" | jq -c '.questions // []')

    # --- manage_todo_list ---
    HOOK_TODO_LIST_JSON=$(printf '%s' "$input" | jq -c '.todoList // []')
    HOOK_TODO_LAST_TITLE=$(printf '%s' "$input" | jq -r '(.todoList // [])[-1].title // empty')
    HOOK_TODO_LAST_STATUS=$(printf '%s' "$input" | jq -r '(.todoList // [])[-1].status // empty')
    HOOK_TODO_COUNT=$(printf '%s' "$input" | jq -r '(.todoList // []) | length')

    # --- v1.1: multi_replace_string_in_file ---
    HOOK_MR_REPLACEMENTS_COUNT=$(printf '%s' "$input" | jq -r '(.replacements // []) | length')
    HOOK_MR_FIRST_FILE_PATH=$(printf '%s' "$input" | jq -r '(.replacements // []) | first | .filePath // empty')

    # --- v1.1: get_errors ---
    HOOK_GET_ERRORS_PATHS_JSON=$(printf '%s' "$input" | jq -c '.filePaths // []')

    # --- v1.1: memory ---
    HOOK_MEMORY_COMMAND=$(printf '%s' "$input" | jq -r '.command // empty')
    HOOK_MEMORY_PATH=$(printf '%s' "$input" | jq -r '.path // empty')

    # --- v1.1: fetch_webpage ---
    HOOK_FETCH_URL=$(printf '%s' "$input" | jq -r '.url // empty')

    export HOOK_TOOL_COMMAND HOOK_TOOL_EXPLANATION HOOK_TOOL_GOAL
    export HOOK_TOOL_IS_BG HOOK_TOOL_TIMEOUT
    export HOOK_TOOL_FILE_PATH HOOK_TOOL_START_LINE HOOK_TOOL_END_LINE
    export HOOK_TOOL_OLD_STRING HOOK_TOOL_NEW_STRING
    export HOOK_TOOL_QUERY HOOK_TOOL_IS_REGEX HOOK_TOOL_INCLUDE_PAT
    export HOOK_TOOL_DIR_PATH
    export HOOK_TOOL_AGENT_NAME HOOK_TOOL_AGENT_PROMPT
    export HOOK_ASK_QUESTIONS_JSON
    export HOOK_TODO_LIST_JSON HOOK_TODO_LAST_TITLE HOOK_TODO_LAST_STATUS HOOK_TODO_COUNT
    export HOOK_MR_REPLACEMENTS_COUNT HOOK_MR_FIRST_FILE_PATH
    export HOOK_GET_ERRORS_PATHS_JSON
    export HOOK_MEMORY_COMMAND HOOK_MEMORY_PATH
    export HOOK_FETCH_URL
}

# Campos comuns a PreToolUse e PostToolUse
_hook_api_parse_tool_fields() {
    local raw="$1"

    # tool_name: doc oficial usa snake_case; aceita também camelCase como fallback
    HOOK_TOOL_NAME=$(printf '%s' "$raw" | jq -r '.tool_name // .toolName // empty')
    HOOK_TOOL_USE_ID=$(printf '%s' "$raw" | jq -r '.tool_use_id // .toolUseId // empty')
    # tool_input armazenado como JSON string compacta
    HOOK_TOOL_INPUT=$(printf '%s' "$raw" | jq -c '.tool_input // .toolInput // {}')

    export HOOK_TOOL_NAME HOOK_TOOL_USE_ID HOOK_TOOL_INPUT

    # Parseia sub-campos do tool_input
    _hook_api_parse_tool_input_subfields "$HOOK_TOOL_INPUT"
}

_hook_api_parse_post_tool_use() {
    local raw="$1"
    _hook_api_parse_tool_fields "$raw"

    # tool_response: pode ser string, objeto JSON, array, ou null
    local resp_raw resp_type
    resp_raw=$(printf '%s' "$raw" | jq '.tool_response // null')
    resp_type=$(printf '%s' "$resp_raw" | jq -r 'type')

    case "$resp_type" in
        object | array)
            HOOK_TOOL_RESPONSE=$(printf '%s' "$resp_raw" | jq -c '.')
            HOOK_TOOL_RESPONSE_IS_JSON="true"
            # Versão texto: JSON serializado completo para buscas por grep
            HOOK_TOOL_RESPONSE_TEXT=$(printf '%s' "$resp_raw" | jq -r 'tostring')
            ;;
        string)
            HOOK_TOOL_RESPONSE=$(printf '%s' "$resp_raw" | jq -r '.')
            HOOK_TOOL_RESPONSE_IS_JSON="false"
            HOOK_TOOL_RESPONSE_TEXT="$HOOK_TOOL_RESPONSE"
            ;;
        null | *)
            HOOK_TOOL_RESPONSE="null"
            HOOK_TOOL_RESPONSE_IS_JSON="false"
            HOOK_TOOL_RESPONSE_TEXT=""
            ;;
    esac

    export HOOK_TOOL_RESPONSE HOOK_TOOL_RESPONSE_IS_JSON HOOK_TOOL_RESPONSE_TEXT
    export HOOK_RESP_TEXT_CONTENT HOOK_RESP_LINE_COUNT HOOK_RESP_CHAR_COUNT HOOK_RESP_ERROR_COUNT

    # Parsing adicional de metadados da resposta (definido em 04-predicates.sh)
    _hook_api_parse_response_meta

    # Se for resposta de vscode_askQuestions, extrai campos específicos
    # Suporta tanto objeto JSON direto quanto string contendo JSON serializado
    # (VS Code por vezes serializa a resposta como string JSON)
    if [ "$HOOK_TOOL_NAME" = "vscode_askQuestions" ]; then
        local resp_json=""
        if [ "$HOOK_TOOL_RESPONSE_IS_JSON" = "true" ]; then
            resp_json="$HOOK_TOOL_RESPONSE"
        elif [ -n "$HOOK_TOOL_RESPONSE" ] && printf '%s' "$HOOK_TOOL_RESPONSE" | jq -e . > /dev/null 2>&1; then
            # String contendo JSON serializado — promove para IS_JSON=true
            resp_json="$HOOK_TOOL_RESPONSE"
            HOOK_TOOL_RESPONSE_IS_JSON="true"
            export HOOK_TOOL_RESPONSE_IS_JSON
        fi
        if [ -n "$resp_json" ]; then
            _hook_api_parse_ask_questions_response "$resp_json"
        fi
    fi
}

# Extrai os campos das respostas do vscode_askQuestions (PostToolUse)
# Formato: {"answers": {"Header": {"selected":[], "freeText":"...", "skipped":false}}}
_hook_api_parse_ask_questions_response() {
    local resp="$1"

    # Todos os freeText (concatenados com newline, filtrando vazios)
    HOOK_ASK_FREE_TEXT=$(printf '%s' "$resp" \
        | jq -r '[(.answers // {}) | to_entries[] | .value.freeText // ""] |
               map(select(. != "")) | join("\n")')

    # Todas as opções selecionadas (expandindo arrays internos)
    HOOK_ASK_SELECTED=$(printf '%s' "$resp" \
        | jq -r '[(.answers // {}) | to_entries[] | .value.selected // [] | .[]] | join("\n")')

    # Texto unificado para busca de close_key (free + selected)
    HOOK_ASK_ALL_TEXT="${HOOK_ASK_FREE_TEXT}
${HOOK_ASK_SELECTED}"

    # Qualquer pergunta foi ignorada (skipped)?
    local any_skipped
    any_skipped=$(printf '%s' "$resp" \
        | jq -r '[(.answers // {}) | to_entries[] | .value.skipped // false] | any')
    HOOK_ASK_SKIPPED="${any_skipped:-false}"

    export HOOK_ASK_FREE_TEXT HOOK_ASK_SELECTED HOOK_ASK_ALL_TEXT HOOK_ASK_SKIPPED
}

_hook_api_parse_stop() {
    local raw="$1"
    # stop_hook_active é JSON boolean — normalizar para string "true"/"false"
    HOOK_STOP_HOOK_ACTIVE=$(printf '%s' "$raw" | jq -r '.stop_hook_active // false')
    export HOOK_STOP_HOOK_ACTIVE
}

_hook_api_parse_pre_compact() {
    local raw="$1"
    HOOK_COMPACT_TRIGGER=$(printf '%s' "$raw" | jq -r '.trigger // "auto"')
    export HOOK_COMPACT_TRIGGER
}

_hook_api_parse_subagent() {
    local raw="$1"
    # Campos oficiais (doc VS Code mar/2026): agent_id, agent_type
    # Fallbacks defensivos para variações de implementação
    HOOK_AGENT_ID=$(printf '%s' "$raw" | jq -r '.agent_id // .subagentId // .id // empty')
    HOOK_AGENT_TYPE=$(printf '%s' "$raw" | jq -r '.agent_type // .subagentType // .type // empty')

    # SubagentStop também carrega stop_hook_active
    if [ "$HOOK_EVENT" = "SubagentStop" ]; then
        HOOK_STOP_HOOK_ACTIVE=$(printf '%s' "$raw" | jq -r '.stop_hook_active // false')
        export HOOK_STOP_HOOK_ACTIVE
    fi

    export HOOK_AGENT_ID HOOK_AGENT_TYPE
}
