#!/usr/bin/env bash
# api/12-subagent.sh — API de Subagente e Grafo de Agentes (v2.2)
# Módulo 12/12 do sistema hook-payload-api modular
# Carregado por: hook-payload-api.sh (loader principal)
#
# 🟦+🟧 CAMADA MISTA
# 🟦 Platform: campos agent_id, agent_type, session_stats.subagents_*
# 🟧 Nosso:    budget tracking, depth de nesting, predicados de saúde
#
# Depende de:
#   common.sh         — read_field, update_nested_state
#   09-metrics.sh     — hook_stat_* (não acessa diretamente; pattern compartilhado)
#   01-vars.sh        — HOOK_SUBAGENT_DEPTH, HOOK_SUBAGENT_COUNT_SESSION,
#                       HOOK_SUBAGENT_BUDGET_LIMIT
#
# Estado lido do session.json:
#   .session_stats.subagents_total   — total acumulado desde o início da sessão
#   .session_stats.subagents_active  — subagentes em execução (incrementado em Start)
#   .current_turn.number             — turno atual (para count_turn)
#
# IMPORTANTE: as funções deste módulo são SOMENTE LEITURA do state.
# Escrita é responsabilidade de subagent-lib.sh (incremento de contadores).

# ─── SEÇÃO 12A: DEPTH E NESTING ──────────────────────────────────────────────

# 🟧 hook_subagent_depth — profundidade de nesting atual
# = número de subagentes ativos no momento (subagents_active no state)
# Retorna inteiro (0 = nenhum subagente ativo → agente principal)
hook_subagent_depth() {
    local active
    active=$(read_field ".session_stats.subagents_active")
    printf '%d' "${active:-0}"
}

# 🟧 hook_subagent_is_nested — true se depth > 0 (estamos dentro de um subagente)
# Retorna 0 (true) se depth > 0, 1 (false) caso contrário
hook_subagent_is_nested() {
    [[ "$(hook_subagent_depth)" -gt 0 ]]
}

# 🟦 hook_subagent_parent_id — agent_id do pai (do payload atual)
# Em SubagentStart/Stop, o HOOK_AGENT_ID é o ID do subagente sendo iniciado.
# O "pai" é o HOOK_SESSION_ID (agente principal) quando depth == 1.
# Retorna "root" quando não há aninhamento.
hook_subagent_parent_id() {
    if hook_subagent_is_nested; then
        # Pai = quem disparou runSubagent = agente principal (session_id)
        printf '%s' "${HOOK_SESSION_ID:-root}"
    else
        printf 'root'
    fi
}

# ─── SEÇÃO 12B: CONTADORES ───────────────────────────────────────────────────

# 🟧 hook_subagent_count_session — total acumulado de subagentes na sessão
# Lê .session_stats.subagents_total do state
# Retorna inteiro
hook_subagent_count_session() {
    local total
    total=$(read_field ".session_stats.subagents_total")
    printf '%d' "${total:-0}"
}

# 🟧 hook_subagent_count_turn — subagentes iniciados no turno atual
# Aproximação: lê .current_turn.subagents_started (se existir) ou fallback 0
# O subagent-lib.sh popula este campo opcionalmente
hook_subagent_count_turn() {
    local turn_count
    turn_count=$(read_field ".current_turn.subagents_started")
    printf '%d' "${turn_count:-0}"
}

# ─── SEÇÃO 12C: BUDGET TRACKING ──────────────────────────────────────────────

# 🟧 hook_subagent_budget_ok — verifica se ainda estamos abaixo do limite
# Compara hook_subagent_count_session() com HOOK_SUBAGENT_BUDGET_LIMIT
# Retorna 0 (true) se abaixo do limite, 1 (false) se atingiu/ultrapassou
hook_subagent_budget_ok() {
    local count limit
    count=$(hook_subagent_count_session)
    limit="${HOOK_SUBAGENT_BUDGET_LIMIT:-50}"
    [[ "$count" -lt "$limit" ]]
}

# 🟧 hook_subagent_budget_remaining — quantos subagentes ainda são permitidos
# Retorna inteiro (pode ser 0 ou negativo se ultrapassou o limite)
hook_subagent_budget_remaining() {
    local count limit
    count=$(hook_subagent_count_session)
    limit="${HOOK_SUBAGENT_BUDGET_LIMIT:-50}"
    printf '%d' "$((limit - count))"
}

# ─── SEÇÃO 12D: INFORMAÇÕES DO SUBAGENTE ATUAL ───────────────────────────────

# 🟦 hook_subagent_current_id — agent_id do subagente atual (payload)
# Retorna valor de HOOK_AGENT_ID (populado por hook_api_parse)
hook_subagent_current_id() {
    printf '%s' "${HOOK_AGENT_ID:-}"
}

# 🟦 hook_subagent_current_type — agent_type do subagente atual (payload)
# Retorna valor de HOOK_AGENT_TYPE (populado por hook_api_parse)
hook_subagent_current_type() {
    printf '%s' "${HOOK_AGENT_TYPE:-}"
}

# 🟧 hook_subagent_is_known_type — true se agent_type é um tipo reconhecido
# Tipos conhecidos (doc VS Code mar/2026): built-in e custom agents comuns
# - Plan, SWE, Explore, QA, RUG: tipos built-in do VS Code
# - Padrão custom: camelCase capitalizado (ex: "Planner", "Reviewer", "Implementer")
# String vazia é aceita (agente principal sem subagente)
hook_subagent_is_known_type() {
    local t
    t="${HOOK_AGENT_TYPE:-}"
    case "$t" in
        # Built-in VS Code agents
        Plan | SWE | Explore | QA | RUG) return 0 ;;
        # Custom agents (PascalCase single-word)
        Planner | Reviewer | Implementer | Architect | Researcher | Coder) return 0 ;;
        # String vazia = agente principal
        "") return 0 ;;
        # Qualquer outro tipo não é reconhecido
        *) return 1 ;;
    esac
}

# 🟧 hook_subagent_depth_ok — true se a profundidade atual está abaixo do limite
# Compara hook_subagent_depth() com HOOK_SUBAGENT_DEPTH_LIMIT
# Retorna 0 (true) se depth < limit, 1 (false) se atingiu/ultrapassou
hook_subagent_depth_ok() {
    local depth limit
    depth=$(hook_subagent_depth)
    limit="${HOOK_SUBAGENT_DEPTH_LIMIT:-3}"
    [[ "$depth" -lt "$limit" ]]
}

# 🟧 hook_subagent_depth_remaining — quantos níveis de nesting ainda são possíveis
# Retorna inteiro (pode ser 0 ou negativo se ultrapassou o limite)
hook_subagent_depth_remaining() {
    local depth limit
    depth=$(hook_subagent_depth)
    limit="${HOOK_SUBAGENT_DEPTH_LIMIT:-3}"
    printf '%d' "$((limit - depth))"
}

# ─── SEÇÃO 12E: LOADER (popula variáveis HOOK_SUBAGENT_*) ────────────────────

# 🟧 hook_subagent_load — popula variáveis HOOK_SUBAGENT_* a partir do state
# Deve ser chamado após hook_api_parse quando precisar das variáveis
hook_subagent_load() {
    HOOK_SUBAGENT_DEPTH="$(hook_subagent_depth)"
    HOOK_SUBAGENT_COUNT_SESSION="$(hook_subagent_count_session)"
    export HOOK_SUBAGENT_DEPTH HOOK_SUBAGENT_COUNT_SESSION
}
