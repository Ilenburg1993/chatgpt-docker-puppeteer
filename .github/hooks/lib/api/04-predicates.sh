#!/usr/bin/env bash
# api/04-predicates.sh — Predicados semânticos e parsing adicional de resposta
# Módulo 4/6 do sistema hook-payload-api modular
# Carregado por: hook-payload-api.sh (loader principal)
#
# 🔵 CAMADA 2 — DERIVADA DA PLATAFORMA (predicados de tools e eventos)
# 🟧 CAMADA 3 — NOSSO SISTEMA (predicados que dependem de estado ou nossos protocolos)
#
# Depende de: 01-vars.sh, 02-parse.sh
# Usa de common.sh: (nenhuma dependência de state — funções 🟧 state movidas para 07-state.sh)

# ─── SEÇÃO 5: PREDICADOS SEMÂNTICOS ─────────────────────────────────────────
# Funções de alto nível para lógica de hook common

# 🟧 PostToolUse de vscode_askQuestions (= resposta do usuário ao nosso template)
hook_is_ask_questions() {
    [ "$HOOK_EVENT" = "PostToolUse" ] && [ "$HOOK_TOOL_NAME" = "vscode_askQuestions" ]
}

# 🔵 stop_hook_active=true → nunca emitir block (previne loop infinito)
hook_is_stop_active() {
    [ "$HOOK_STOP_HOOK_ACTIVE" = "true" ]
}

# 🔵 PreToolUse ou PostToolUse
hook_is_tool_event() {
    case "$HOOK_EVENT" in
        PreToolUse | PostToolUse) return 0 ;;
        *) return 1 ;;
    esac
}

# 🔵 SubagentStart ou SubagentStop
hook_is_subagent_event() {
    case "$HOOK_EVENT" in
        SubagentStart | SubagentStop) return 0 ;;
        *) return 1 ;;
    esac
}

# 🟧 PreToolUse tentando executar session-close.sh via terminal (bloqueado por segurança)
hook_is_session_close_cmd() {
    [ "$HOOK_EVENT" = "PreToolUse" ] || return 1
    printf '%s %s' "$HOOK_TOOL_COMMAND" "$HOOK_TOOL_INPUT" | grep -qF "session-close"
}

# 🟧 PreToolUse de manage_todo_list (nossa ferramenta de protocolo TODO)
hook_is_manage_todo() {
    [ "$HOOK_EVENT" = "PreToolUse" ] && [ "$HOOK_TOOL_NAME" = "manage_todo_list" ]
}

# 🟧 PostToolUse de manage_todo_list
hook_is_manage_todo_post() {
    [ "$HOOK_EVENT" = "PostToolUse" ] && [ "$HOOK_TOOL_NAME" = "manage_todo_list" ]
}

# 🔵 PreToolUse de runSubagent (subagente sendo lançado)
hook_is_runsubagent() {
    [ "$HOOK_EVENT" = "PreToolUse" ] && [ "$HOOK_TOOL_NAME" = "runSubagent" ]
}

# 🟧 Último TODO contém "vscode_askQuestions" (protocolo TODO v9.0)
hook_todo_last_is_ask() {
    printf '%s' "$HOOK_TODO_LAST_TITLE" | grep -qi "vscode_askQuestions\|vscode_ask"
}

# 🔵 run_in_terminal com isBackground=true
hook_is_background_cmd() {
    [ "$HOOK_EVENT" = "PreToolUse" ] \
        && [ "$HOOK_TOOL_NAME" = "run_in_terminal" ] \
        && [ "$HOOK_TOOL_IS_BG" = "true" ]
}

# ─── SEÇÃO 5B: PREDICADOS AVANÇADOS ────────────────────────────────────────
# Predicados semânticos para ferramentas específicas e padrões comuns

# 🔵 PreToolUse de qualquer ferramenta de escrita em disco
hook_is_file_write() {
    [ "$HOOK_EVENT" = "PreToolUse" ] || return 1
    case "$HOOK_TOOL_NAME" in
        create_file | replace_string_in_file | multi_replace_string_in_file | create_directory)
            return 0
            ;;
        *) return 1 ;;
    esac
}

# 🔵 PreToolUse de qualquer ferramenta de leitura
hook_is_file_read() {
    [ "$HOOK_EVENT" = "PreToolUse" ] || return 1
    case "$HOOK_TOOL_NAME" in
        read_file | grep_search | file_search | list_dir | get_errors)
            return 0
            ;;
        *) return 1 ;;
    esac
}

# 🔵 PreToolUse de run_in_terminal
hook_is_run_in_terminal() {
    [ "$HOOK_EVENT" = "PreToolUse" ] && [ "$HOOK_TOOL_NAME" = "run_in_terminal" ]
}

# 🔵 PreToolUse ou PostToolUse de read_file
hook_is_read_file() {
    hook_is_tool_event && [ "$HOOK_TOOL_NAME" = "read_file" ]
}

# 🔵 PreToolUse ou PostToolUse de create_file
hook_is_create_file() {
    hook_is_tool_event && [ "$HOOK_TOOL_NAME" = "create_file" ]
}

# 🔵 run_in_terminal cujo comando começa com "git"
hook_is_git_cmd() {
    hook_is_run_in_terminal || return 1
    printf '%s' "$HOOK_TOOL_COMMAND" | grep -qE '^\s*git\b'
}

# 🔵 run_in_terminal com "git push" (inclui force push, push com opções)
hook_is_git_push() {
    hook_is_run_in_terminal || return 1
    printf '%s' "$HOOK_TOOL_COMMAND" | grep -qE '\bgit\b.*\bpush\b'
}

# 🔵 run_in_terminal com "git commit"
hook_is_git_commit() {
    hook_is_run_in_terminal || return 1
    printf '%s' "$HOOK_TOOL_COMMAND" | grep -qE '\bgit\b.*\bcommit\b'
}

# 🔵 PreToolUse de ferramentas potencialmente destrutivas (precisa atenção especial)
# Inclui: rm -rf/-f, git reset --hard, git push --force/--force-with-lease/--force-if-includes,
#         git clean -f(d), DROP TABLE, truncate, dd
# NEW-C: padrão ampliado para capturar rm -f, git clean -f(d), dd if=/dev/...
# UP-08: adicionado --force-with-lease e --force-if-includes (reescrita de histórico equivalente)
hook_is_destructive_cmd() {
    hook_is_run_in_terminal || return 1
    printf '%s' "$HOOK_TOOL_COMMAND" \
        | grep -qE '\brm\s+-[a-zA-Z]*[fr][a-zA-Z]*\b|git\s+reset\s+--hard|git\s+push\s+.*(--force|--force-with-lease|--force-if-includes)|git\s+clean\s+.*-[a-zA-Z]*f|DROP\s+TABLE|truncate\s+/|\bdd\b.*\bof='
}

# 🔵 PreToolUse de semantic_search ou runSubagent (ferramentas com custo de IA)
hook_is_ai_tool() {
    [ "$HOOK_EVENT" = "PreToolUse" ] || return 1
    case "$HOOK_TOOL_NAME" in
        semantic_search | runSubagent) return 0 ;;
        *) return 1 ;;
    esac
}

# 🔵 PostToolUse: verifica se a resposta da ferramenta indica erro
# (run_in_terminal: contém "Error:", "error:", "FAIL"  / get_errors: array não-vazio)
# NEW-D: adicionados termos em pt-BR: erro, falha, falhou
hook_response_has_error() {
    [ "$HOOK_EVENT" = "PostToolUse" ] || return 1
    printf '%s' "$HOOK_TOOL_RESPONSE_TEXT" | grep -qiE '\berror\b|\bfail\b|\bexception\b|\bfatal\b|\berro\b|\bfalha\b|\bfalhou\b'
}

# ─── SEÇÃO 5C: PARSING ADICIONAL DO tool_response (PostToolUse) ─────────────
# Campos derivados do tool_response para ferramentas específicas

# 🔵 Extrai conteúdo de arquivo (read_file) ou saída de terminal (run_in_terminal)
# Popula HOOK_RESP_TEXT_CONTENT — alias conveniente de HOOK_TOOL_RESPONSE_TEXT
# Também popula HOOK_RESP_LINE_COUNT e HOOK_RESP_CHAR_COUNT para read_file
_hook_api_parse_response_meta() {
    if [ "$HOOK_TOOL_RESPONSE_IS_JSON" = "false" ] && [ -n "$HOOK_TOOL_RESPONSE_TEXT" ]; then
        HOOK_RESP_TEXT_CONTENT="$HOOK_TOOL_RESPONSE_TEXT"
        HOOK_RESP_LINE_COUNT=$(printf '%s' "$HOOK_TOOL_RESPONSE_TEXT" | wc -l)
        HOOK_RESP_CHAR_COUNT=$(printf '%s' "$HOOK_TOOL_RESPONSE_TEXT" | wc -c)
    else
        HOOK_RESP_TEXT_CONTENT=""
        HOOK_RESP_LINE_COUNT="0"
        HOOK_RESP_CHAR_COUNT="0"
    fi
    # Para get_errors: conta erros no array JSON
    if [ "$HOOK_TOOL_NAME" = "get_errors" ] && [ "$HOOK_TOOL_RESPONSE_IS_JSON" = "true" ]; then
        HOOK_RESP_ERROR_COUNT=$(printf '%s' "$HOOK_TOOL_RESPONSE" | jq -r 'if type=="array" then length else 0 end' 2> /dev/null || echo "0")
    else
        HOOK_RESP_ERROR_COUNT="0"
    fi
    export HOOK_RESP_TEXT_CONTENT HOOK_RESP_LINE_COUNT HOOK_RESP_CHAR_COUNT HOOK_RESP_ERROR_COUNT
}

# ─── SEÇÃO 5D: PREDICADOS DE TOOLS v1.1 ─────────────────────────────────────
# 11 novos predicados baseados em tool_name puro (sem dependência de state)

# 🔵 Ferramenta get_errors foi chamada
hook_is_get_errors() {
    hook_is_tool_event && [ "$HOOK_TOOL_NAME" = "get_errors" ]
}

# 🔵 Ferramenta get_terminal_output foi chamada
hook_is_get_terminal_output() {
    hook_is_tool_event && [ "$HOOK_TOOL_NAME" = "get_terminal_output" ]
}

# 🔵 Ferramenta semantic_search foi chamada
hook_is_semantic_search() {
    hook_is_tool_event && [ "$HOOK_TOOL_NAME" = "semantic_search" ]
}

# 🔵 Ferramenta file_search foi chamada
hook_is_file_search() {
    hook_is_tool_event && [ "$HOOK_TOOL_NAME" = "file_search" ]
}

# 🔵 Ferramenta tool_search_tool_regex foi chamada
hook_is_tool_search_regex() {
    hook_is_tool_event && [ "$HOOK_TOOL_NAME" = "tool_search_tool_regex" ]
}

# 🔵 Ferramenta fetch_webpage foi chamada
hook_is_fetch_webpage() {
    hook_is_tool_event && [ "$HOOK_TOOL_NAME" = "fetch_webpage" ]
}

# 🔵 Ferramenta run_notebook_cell foi chamada
hook_is_run_notebook_cell() {
    hook_is_tool_event && [ "$HOOK_TOOL_NAME" = "run_notebook_cell" ]
}

# 🔵 Ferramenta edit_notebook_file foi chamada
hook_is_edit_notebook() {
    hook_is_tool_event && [ "$HOOK_TOOL_NAME" = "edit_notebook_file" ]
}

# 🔵 Ferramenta switch_agent foi chamada
hook_is_switch_agent() {
    hook_is_tool_event && [ "$HOOK_TOOL_NAME" = "switch_agent" ]
}

# 🔵 Ferramenta memory foi chamada (qualquer command)
hook_is_memory_op() {
    hook_is_tool_event && [ "$HOOK_TOOL_NAME" = "memory" ]
}

# 🔵 Ferramenta multi_replace_string_in_file foi chamada
hook_is_multi_replace() {
    hook_is_tool_event && [ "$HOOK_TOOL_NAME" = "multi_replace_string_in_file" ]
}

# ─── SEÇÃO 5E: RESPONSE PARSERS v1.1 (PostToolUse) ──────────────────────────

# 🔵 tool_response é array de erros (formato TSC/ESLint retornado por get_errors)
hook_response_is_error_array() {
    [ "$HOOK_EVENT" = "PostToolUse" ] || return 1
    [ "$HOOK_TOOL_RESPONSE_IS_JSON" = "true" ] || return 1
    printf '%s' "$HOOK_TOOL_RESPONSE" | jq -e 'arrays | length >= 0' > /dev/null 2>&1
}

# 🔵 Número de erros no array de resposta (0 se não for array)
hook_response_error_count() {
    if hook_response_is_error_array; then
        printf '%s' "$HOOK_TOOL_RESPONSE" | jq -r 'length'
    else
        printf '0'
    fi
}

# 🔵 Caminho do arquivo com mais erros no array (vazio se não for array)
hook_get_errors_first_file() {
    hook_response_is_error_array || return 1
    printf '%s' "$HOOK_TOOL_RESPONSE" \
        | jq -r '[.[] | .file // .filePath // ""] | group_by(.) | max_by(length) | first // empty'
}

# ─── SEÇÃO 5F: HARDENING DE SEGURANÇA v1.2 ──────────────────────────────────

# 🔵 Detecta path traversal (../) em campos de caminho do input
hook_input_is_path_traversal() {
    local paths="$HOOK_TOOL_FILE_PATH $HOOK_MR_FIRST_FILE_PATH $HOOK_TOOL_DIR_PATH"
    printf '%s' "$paths" | grep -qE '(\.\./|/\.\.)'
}

# 🔵 Detecta acesso a rede no comando (curl, wget, xh, nc, ssh, scp, rsync, etc.)
hook_has_network_access() {
    [ -n "$HOOK_TOOL_COMMAND" ] || return 1
    printf '%s' "$HOOK_TOOL_COMMAND" \
        | grep -qE '\b(curl|wget|xh|nc|ssh|scp|rsync|nmap|socat|fetch)\b'
}

# 🔵 Verifica se filePath está dentro do workspace (HOOK_CWD)
hook_is_within_workspace() {
    [ -n "$HOOK_TOOL_FILE_PATH" ] || return 1
    [ -n "$HOOK_CWD" ] || return 1
    case "$HOOK_TOOL_FILE_PATH" in
        "$HOOK_CWD"/*) return 0 ;;
        *) return 1 ;;
    esac
}

# 🔵 Remove control chars e escape sequences de uma string (safe for logging)
# Uso: safe=$(hook_sanitize_for_log "$input")
hook_sanitize_for_log() {
    local input="${1:-}"
    # Remove chars de controle (exceto tab e newline), trunca a 500 chars
    printf '%s' "$input" | tr -d '\000-\010\013-\037\177' | head -c 500
}

# 🔵 Detecta padrões de injeção shell no comando (eval, exec, $(), backticks, &&, ||)
hook_input_has_injection() {
    [ -n "$HOOK_TOOL_COMMAND" ] || return 1
    printf '%s' "$HOOK_TOOL_COMMAND" \
        | grep -qE '(\$\([^)]+\)|`[^`]+`|\beval[[:space:]]|\bexec[[:space:]])'
}

# 🔵🟧 Score heurístico de risco do comando (0..100; 0=seguro, 100=crítico)
hook_input_command_score() {
    local cmd="${HOOK_TOOL_COMMAND:-}"
    local score=0

    # +50: comandos destrutivos (rm -rf, dd, mkfs, shred, fork bomb)
    printf '%s' "$cmd" | grep -qE '\b(rm[[:space:]]+-[^[:space:]]*r[^[:space:]]*f|dd[[:space:]]+|mkfs\b|shred\b|wipefs\b|:\(\)\{)' \
        && score=$((score + 50))

    # +30: pipe para shell (curl|bash, wget|sh, etc.)
    printf '%s' "$cmd" | grep -qE '\|[[:space:]]*(bash|sh|zsh|ksh|fish)\b' \
        && score=$((score + 30))

    # +20: acesso a rede
    hook_has_network_access && score=$((score + 20))

    # +20: injection patterns
    hook_input_has_injection && score=$((score + 20))

    # +15: path traversal
    hook_input_is_path_traversal && score=$((score + 15))

    # +10: risco de exposição de segredos
    hook_is_secret_exposure_risk && score=$((score + 10))

    # Cap a 100
    [ "$score" -gt 100 ] && score=100

    printf '%d' "$score"
}

# 🔵🟧 Detecta risco de exposição de segredos no comando ou input
hook_is_secret_exposure_risk() {
    local haystack="$HOOK_TOOL_COMMAND $HOOK_TOOL_INPUT"
    [ -n "$haystack" ] || return 1
    printf '%s' "$haystack" \
        | grep -iqE '(password|passwd|token|secret|api[_-]?key|auth[_-]?token|bearer|credential|private[_-]?key|access[_-]?key)[[:space:]]*[=:]'
}

# 🔵🟧 Computa HOOK_SECURITY_SCORE e HOOK_SECURITY_FLAGS — chamada de hook_api_parse()
_hook_security_compute() {
    local flags=""

    hook_input_is_path_traversal && flags="$flags PATH_TRAVERSAL"
    hook_input_has_injection && flags="$flags INJECTION"
    hook_has_network_access && flags="$flags NETWORK"
    hook_is_secret_exposure_risk && flags="$flags SECRET"

    # Comando extremamente destrutivo
    printf '%s' "${HOOK_TOOL_COMMAND:-}" \
        | grep -qE '\b(rm[[:space:]]+-[^[:space:]]*r[^[:space:]]*f|dd[[:space:]]+|mkfs\b|shred\b)' \
        && flags="$flags DESTRUCTIVE"

    HOOK_SECURITY_FLAGS="${flags# }"
    HOOK_SECURITY_SCORE=$(hook_input_command_score)
    export HOOK_SECURITY_FLAGS HOOK_SECURITY_SCORE
}
