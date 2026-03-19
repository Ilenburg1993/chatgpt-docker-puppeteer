#!/usr/bin/env bash
# api/08-risk.sh — Camada de Risco e Política (v1.3)
# Módulo 8/8 do sistema hook-payload-api modular
# Carregado por: hook-payload-api.sh (loader principal)
#
# 🔵 CAMADA 2 — DERIVADA DA PLATAFORMA (risk_level, category — deduzidos de tool_name/input)
# 🟧 CAMADA 3 — NOSSO SISTEMA (policy_allow — usa HOOK_SECURITY_SCORE)
#
# Depende de: 01-vars.sh (HOOK_TOOL_NAME, HOOK_TOOL_IS_BG, HOOK_MEMORY_COMMAND)
#             04-predicates.sh (hook_has_network_access)
#             v1.2 (HOOK_SECURITY_SCORE)

# ─── SEÇÃO 8A: CLASSIFICAÇÃO DE RISCO 🔵 ────────────────────────────────────
#
# Escala de risco (0..5):
#   0 — Leitura pura       (read_file, list_dir, semantic_search, grep_search)
#   1 — Leitura agressiva  (file_search, get_errors, get_terminal_output)
#   2 — Escrita reversível (create_file, edit_notebook, memory view/read)
#   3 — Escrita crítica    (replace_string, multi_replace, memory write, switch_agent)
#   4 — Execução local     (run_in_terminal, run_notebook_cell)
#   5 — Execução + rede    (run_in_terminal com rede, fetch_webpage)

# 🔵 Retorna o nível de risco (0..5) baseado em tool_name e tool_input
hook_tool_risk_level() {
    local tool="${HOOK_TOOL_NAME:-}"
    local level

    case "$tool" in
        # Nível 0 — leitura pura
        read_file | list_dir | semantic_search | grep_search | get_project_setup_info | \
            vscode_askQuestions | manage_todo_list | memory_view)
            level=0
            ;;

        # Nível 1 — leitura agressiva / consulta com efeito colateral potencial
        file_search | get_errors | tool_search_tool_regex | get_terminal_output)
            level=1
            ;;

        # Nível 2 — escrita reversível (criar arquivo novo, notebooks, memory read)
        create_file | edit_notebook_file | run_notebook_cell)
            level=2
            ;;
        memory)
            # memory view/read → nível 1; memory write → nível 3
            case "${HOOK_MEMORY_COMMAND:-}" in
                view) level=1 ;;
                *) level=3 ;; # create, str_replace, insert, delete, rename
            esac
            ;;

        # Nível 3 — escrita crítica / efeitos difíceis de reverter
        replace_string_in_file | multi_replace_string_in_file | create_directory | \
            switch_agent | runSubagent)
            level=3
            ;;

        # Nível 4/5 — execução (depende do contexto)
        run_in_terminal)
            if hook_has_network_access; then
                level=5
            else
                level=4
            fi
            ;;

        # Nível 5 — execução + rede sempre
        fetch_webpage)
            level=5
            ;;

        # Padrão — escrita reversível (conservador)
        *) level=2 ;;
    esac

    printf '%d' "$level"
}

# 🔵 Retorna categoria da ferramenta: "read"|"write"|"exec"|"ai"|"state"|"other"
hook_tool_category() {
    local tool="${HOOK_TOOL_NAME:-}"
    case "$tool" in
        read_file | list_dir | grep_search | file_search | get_errors | \
            get_terminal_output | tool_search_tool_regex | get_project_setup_info)
            printf 'read'
            ;;
        create_file | replace_string_in_file | multi_replace_string_in_file | \
            edit_notebook_file | create_directory | run_notebook_cell)
            printf 'write'
            ;;
        run_in_terminal | fetch_webpage)
            printf 'exec'
            ;;
        semantic_search | runSubagent | switch_agent)
            printf 'ai'
            ;;
        memory | manage_todo_list)
            printf 'state'
            ;;
        *)
            printf 'other'
            ;;
    esac
}

# 🔵 true se risk_level >= 4 (run_in_terminal ou fetch_webpage)
hook_is_high_risk() {
    [ "$(hook_tool_risk_level)" -ge 4 ]
}

# 🔵 true se risk_level == 3 (replace, multi_replace, runSubagent, switch_agent)
hook_is_medium_risk() {
    [ "$(hook_tool_risk_level)" -eq 3 ]
}

# 🔵 true se a tool é candidata a exigir confirmação explícita (risk >= 4)
hook_requires_confirmation() {
    hook_is_high_risk
}

# ─── SEÇÃO 8B: POLÍTICA PADRÃO 🟧 ────────────────────────────────────────────
# Política built-in simples: bloqueia se HOOK_SECURITY_SCORE >= 75
# Futura extensão: ler hooks-policy.json para políticas por tool/contexto

# 🟧 true se a tool call é permitida pela política padrão
hook_policy_allow() {
    [ "${HOOK_SECURITY_SCORE:-0}" -lt 75 ]
}

# 🟧 Razão da decisão de política (string legível)
hook_policy_reason() {
    if [ "${HOOK_SECURITY_SCORE:-0}" -ge 75 ]; then
        printf 'blocked: security score too high (%s)' "${HOOK_SECURITY_SCORE:-0}"
    else
        printf 'allowed: security score within threshold (%s)' "${HOOK_SECURITY_SCORE:-0}"
    fi
}

# ─── SEÇÃO 8D: BYPASS ATTEMPT DETECTION ─────────────────────────────────────

# Padrões de bypass proibidos: operações que o agente NÃO pode invocar via
# ferramenta de shell/terminal, pois contornariam o fluxo de encerramento de
# sessão ou validação da close_key.
# Usado por hook_is_bypass_attempt() e herdado por pre-tool-use-lib.sh.
_HOOK_BYPASS_PATTERNS=(
    "session-close.sh"
    "close_key_validated=true"
)

# 🔵 Retorna 0 se a chamada atual tenta contornar o ciclo de sessão.
# Verifica HOOK_TOOL_NAME (deve ser ferramenta de shell) e HOOK_TOOL_INPUT.
hook_is_bypass_attempt() {
    # Só aplica a ferramentas de execução de shell/terminal
    case "${HOOK_TOOL_NAME:-}" in
        *run_in_terminal* | *bash* | *shell* | *execute*) ;;
        *) return 1 ;;
    esac
    local pattern
    for pattern in "${_HOOK_BYPASS_PATTERNS[@]}"; do
        if printf '%s' "${HOOK_TOOL_INPUT:-}" | grep -qF "$pattern"; then
            return 0
        fi
    done
    return 1
}

# ─── SEÇÃO 8C: COMPUTE (chamada pelo loader) ─────────────────────────────────

# 🔵 Popula HOOK_RISK_LEVEL e HOOK_TOOL_CATEGORY — chamada após _hook_security_compute()
_hook_risk_compute() {
    HOOK_RISK_LEVEL=$(hook_tool_risk_level)
    HOOK_TOOL_CATEGORY=$(hook_tool_category)
    export HOOK_RISK_LEVEL HOOK_TOOL_CATEGORY
}
