#!/usr/bin/env bash
# api/01-vars.sh — Declarações de variáveis HOOK_* e função de reset
# Módulo 1/6 do sistema hook-payload-api modular
# Carregado por: hook-payload-api.sh (loader principal)
#
# 🔵 CAMADA 2 — DERIVADA DA PLATAFORMA
# Variáveis espelham o schema oficial do VS Code Copilot Hooks.
# _hook_api_reset() zera tudo entre chamadas para evitar contaminação.

# ─── SEÇÃO 1: RESET ─────────────────────────────────────────────────────────
# Limpa todas as variáveis HOOK_* para evitar contaminação entre chamadas

_hook_api_reset() {
    # Universais
    HOOK_RAW=""
    HOOK_EVENT=""
    HOOK_SESSION_ID=""
    HOOK_TIMESTAMP=""
    HOOK_CWD=""
    HOOK_TRANSCRIPT=""
    HOOK_PARSE_OK="false"
    HOOK_VALIDATION_OK="false"
    HOOK_VALIDATION_ERR=""

    # SessionStart
    HOOK_SOURCE="new"

    # UserPromptSubmit
    HOOK_PROMPT=""

    # PreToolUse + PostToolUse (compartilhados)
    HOOK_TOOL_NAME=""
    HOOK_TOOL_USE_ID=""
    HOOK_TOOL_INPUT="{}"

    # sub-campos comuns de tool_input
    HOOK_TOOL_COMMAND=""
    HOOK_TOOL_EXPLANATION=""
    HOOK_TOOL_GOAL=""
    HOOK_TOOL_IS_BG="false"
    HOOK_TOOL_TIMEOUT="30000"
    HOOK_TOOL_FILE_PATH=""
    HOOK_TOOL_START_LINE=""
    HOOK_TOOL_END_LINE=""
    HOOK_TOOL_OLD_STRING=""
    HOOK_TOOL_NEW_STRING=""
    HOOK_TOOL_QUERY=""
    HOOK_TOOL_IS_REGEX="false"
    HOOK_TOOL_INCLUDE_PAT=""
    HOOK_TOOL_DIR_PATH=""
    HOOK_TOOL_AGENT_NAME=""
    HOOK_TOOL_AGENT_PROMPT=""
    HOOK_ASK_QUESTIONS_JSON="[]"
    HOOK_TODO_LIST_JSON="[]"
    HOOK_TODO_LAST_TITLE=""
    HOOK_TODO_LAST_STATUS=""
    HOOK_TODO_COUNT="0"

    # PostToolUse: response
    HOOK_TOOL_RESPONSE=""
    HOOK_TOOL_RESPONSE_IS_JSON="false"
    HOOK_TOOL_RESPONSE_TEXT=""
    HOOK_RESP_TEXT_CONTENT=""
    HOOK_RESP_LINE_COUNT="0"
    HOOK_RESP_CHAR_COUNT="0"
    HOOK_RESP_ERROR_COUNT="0"

    # PostToolUse: vscode_askQuestions response
    HOOK_ASK_FREE_TEXT=""
    HOOK_ASK_SELECTED=""
    HOOK_ASK_ALL_TEXT=""
    HOOK_ASK_SKIPPED="false"

    # Stop / SubagentStop
    HOOK_STOP_HOOK_ACTIVE="false"

    # PreCompact
    HOOK_COMPACT_TRIGGER="auto"

    # SubagentStart / SubagentStop
    HOOK_AGENT_ID=""
    HOOK_AGENT_TYPE=""

    # v1.1 — multi_replace_string_in_file
    HOOK_MR_REPLACEMENTS_COUNT="0"
    HOOK_MR_FIRST_FILE_PATH=""

    # v1.1 — get_errors
    HOOK_GET_ERRORS_PATHS_JSON="[]"

    # v1.1 — memory tool
    HOOK_MEMORY_COMMAND=""
    HOOK_MEMORY_PATH=""

    # v1.1 — fetch_webpage
    HOOK_FETCH_URL=""

    # v1.2 — segurança (derivadas do stdin)
    HOOK_SECURITY_SCORE="0"
    HOOK_SECURITY_FLAGS=""

    # v1.3 — risco e categoria (derivadas de tool_name + input)
    HOOK_RISK_LEVEL="0"
    HOOK_TOOL_CATEGORY=""

    # v1.5 — métricas de sessão (populadas lazily via hook_metrics_load)
    HOOK_STAT_TURN_COUNT="0"
    HOOK_STAT_TURN_AUTHORIZED="0"
    HOOK_STAT_TURN_UNAUTHORIZED="0"
    HOOK_STAT_SUBTURN_TOTAL="0"
    HOOK_STAT_TOOLS_TOTAL="0"
    HOOK_COMPLIANCE_CONSECUTIVE="0"
    HOOK_COMPLIANCE_LAST_AUTHORIZED="false"
    HOOK_TURN_NUMBER="0"
    HOOK_TURN_ASK_CALLED="false"
    HOOK_SESSION_CLOSE_KEY=""

    # v2.1 — close_key lifecycle (populadas via hook_close_key_load)
    HOOK_CLOSE_KEY_VALUE=""
    HOOK_CLOSE_KEY_IN_PAYLOAD=""

    # v2.3 — compact context builder
    HOOK_COMPACT_CONTEXT_BYTES="0"

    # v2.2 — subagent tracking (populadas via hook_subagent_load)
    HOOK_SUBAGENT_DEPTH="0"
    HOOK_SUBAGENT_COUNT_SESSION="0"
    HOOK_SUBAGENT_BUDGET_LIMIT="50"

    # v2.4 — state versioning (populadas via hook_state_version_load)
    HOOK_STATE_SCHEMA_CURRENT="3" # versão canônica atual do schema
    HOOK_STATE_VERSION="0"        # versão registrada no state (0 = legado)
    HOOK_STATE_MIGRATION_NEEDED="false"

    # v2.6 — rate limiting (UP-06)
    HOOKS_TOOLS_LIMIT="${HOOKS_TOOLS_LIMIT:-150}"

    # v2.5 — strict validation schemas (populadas via hook_validate_load)
    HOOK_VALIDATION_ERRORS_JSON="[]"
    HOOK_VALIDATION_WARNINGS_JSON="[]"

    export HOOK_RAW HOOK_EVENT HOOK_SESSION_ID HOOK_TIMESTAMP HOOK_CWD HOOK_TRANSCRIPT
    export HOOK_PARSE_OK HOOK_VALIDATION_OK HOOK_VALIDATION_ERR
    export HOOK_SOURCE
    export HOOK_PROMPT
    export HOOK_TOOL_NAME HOOK_TOOL_USE_ID HOOK_TOOL_INPUT
    export HOOK_TOOL_COMMAND HOOK_TOOL_EXPLANATION HOOK_TOOL_GOAL
    export HOOK_TOOL_IS_BG HOOK_TOOL_TIMEOUT
    export HOOK_TOOL_FILE_PATH HOOK_TOOL_START_LINE HOOK_TOOL_END_LINE
    export HOOK_TOOL_OLD_STRING HOOK_TOOL_NEW_STRING
    export HOOK_TOOL_QUERY HOOK_TOOL_IS_REGEX HOOK_TOOL_INCLUDE_PAT
    export HOOK_TOOL_DIR_PATH
    export HOOK_TOOL_AGENT_NAME HOOK_TOOL_AGENT_PROMPT
    export HOOK_ASK_QUESTIONS_JSON
    export HOOK_TODO_LIST_JSON HOOK_TODO_LAST_TITLE HOOK_TODO_LAST_STATUS HOOK_TODO_COUNT
    export HOOK_TOOL_RESPONSE HOOK_TOOL_RESPONSE_IS_JSON HOOK_TOOL_RESPONSE_TEXT
    export HOOK_RESP_TEXT_CONTENT HOOK_RESP_LINE_COUNT HOOK_RESP_CHAR_COUNT HOOK_RESP_ERROR_COUNT
    export HOOK_ASK_FREE_TEXT HOOK_ASK_SELECTED HOOK_ASK_ALL_TEXT HOOK_ASK_SKIPPED
    export HOOK_STOP_HOOK_ACTIVE
    export HOOK_COMPACT_TRIGGER
    export HOOK_AGENT_ID HOOK_AGENT_TYPE
    export HOOK_MR_REPLACEMENTS_COUNT HOOK_MR_FIRST_FILE_PATH
    export HOOK_GET_ERRORS_PATHS_JSON
    export HOOK_MEMORY_COMMAND HOOK_MEMORY_PATH
    export HOOK_FETCH_URL
    export HOOK_SECURITY_SCORE HOOK_SECURITY_FLAGS
    export HOOK_RISK_LEVEL HOOK_TOOL_CATEGORY
    export HOOK_STAT_TURN_COUNT HOOK_STAT_TURN_AUTHORIZED HOOK_STAT_TURN_UNAUTHORIZED
    export HOOK_STAT_SUBTURN_TOTAL HOOK_STAT_TOOLS_TOTAL
    export HOOK_COMPLIANCE_CONSECUTIVE HOOK_COMPLIANCE_LAST_AUTHORIZED
    export HOOK_TURN_NUMBER HOOK_TURN_ASK_CALLED HOOK_SESSION_CLOSE_KEY
    export HOOK_CLOSE_KEY_VALUE HOOK_CLOSE_KEY_IN_PAYLOAD
    export HOOK_COMPACT_CONTEXT_BYTES
    export HOOK_SUBAGENT_DEPTH HOOK_SUBAGENT_COUNT_SESSION HOOK_SUBAGENT_BUDGET_LIMIT
    export HOOK_STATE_SCHEMA_CURRENT HOOK_STATE_VERSION HOOK_STATE_MIGRATION_NEEDED
    export HOOK_VALIDATION_ERRORS_JSON HOOK_VALIDATION_WARNINGS_JSON
}
