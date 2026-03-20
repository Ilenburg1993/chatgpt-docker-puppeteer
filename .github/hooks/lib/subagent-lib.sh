#!/usr/bin/env bash
# subagent-lib.sh — Lógica compartilhada para SubagentStart e SubagentStop hooks
#
# Responsabilidades:
#   SubagentStart:
#     1. Registrar início de execução de subagente no audit.jsonl
#     2. Incrementar contador de subagentes ativos
#   SubagentStop:
#     1. Registrar término do subagente
#     2. Decrementar contador de subagentes ativos
#     3. (Futuro) Verificar se subagente violou protocolo — DESATIVADO por ora
#
# Sourceado por scripts/subagent-start.sh e scripts/subagent-stop.sh
# O caller deve definir SUBAGENT_EVENT="start"|"stop" antes de chamar main()

# shellcheck source=common.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/common.sh"
# shellcheck source=hook-payload-api.sh
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/hook-payload-api.sh"

export_lang_utf8

# ---------------------------------------------------------------------------
# Contadores de subagentes na sessão
# ---------------------------------------------------------------------------

# Incrementa subagents_active e subagents_total no state
# Também incrementa current_turn.subagents_started (UP-U: campo antes nunca populado)
# Retorna o novo valor de subagents_active
# NEW-I: refatorado para usar increment_field (atômico, consistente com common.sh)
subagent_start_counters() {
    local new_active
    new_active=$(increment_field '.session_stats.subagents_active')
    increment_field '.session_stats.subagents_total' > /dev/null
    # UP-U: incrementa contador de subagentes por turno (alimenta hook_subagent_count_turn)
    increment_field '.current_turn.subagents_started' > /dev/null 2>&1 || true
    printf '%d' "${new_active:-1}"
}

# Decrementa subagents_active (floor 0)
# Retorna o novo valor de subagents_active
# NEW-I: refatorado para usar decrement_field_floor0 (atômico, consistente com common.sh)
subagent_stop_counters() {
    local new_active
    new_active=$(decrement_field_floor0 '.session_stats.subagents_active')
    printf '%d' "${new_active:-0}"
}

# ---------------------------------------------------------------------------
# Extração de metadados do subagente
# ---------------------------------------------------------------------------

# Extrai informações de identificação do subagente a partir do payload
# $1 = input JSON
extract_subagent_meta() {
    local input="$1"
    # Campos oficiais confirmados (doc VS Code mar/2026): agent_id, agent_type
    # Fallbacks defensivos para compatibilidade com variações de implementação
    SUBAGENT_ID=$(jq_field "$input" ".agent_id // .subagentId // .id // \"unknown\"")
    SUBAGENT_TYPE=$(jq_field "$input" ".agent_type // .subagentType // .type // \"unknown\"")
    SUBAGENT_PROMPT=$(jq_field "$input" ".prompt // .description // \"\"" | cut -c1-80) # GAP-12: cut preserva fronteiras UTF-8
    export SUBAGENT_ID SUBAGENT_TYPE SUBAGENT_PROMPT
}

# ---------------------------------------------------------------------------
# SubagentStart
# ---------------------------------------------------------------------------
subagent_start_main() {
    local input="$1"
    maybe_capture_debug "$input"
    extract_subagent_meta "$input"
    hook_api_parse "$input" # popula HOOK_SESSION_ID

    [ -z "${SESSION_ID:-}" ] && export SESSION_ID="${HOOK_SESSION_ID:-unknown}"

    if ! state_exists; then
        exit 0 # Sem state → não há nada a rastrear
    fi

    # GAP-24: carregar variáveis do módulo 12-subagent.sh e verificar budget
    hook_subagent_load
    if ! hook_subagent_budget_ok; then
        hook_log_audit "subagentStart_budget_exceeded" \
            "subagent_id" "${SUBAGENT_ID:-unknown}" \
            "limit" "${HOOK_SUBAGENT_BUDGET_LIMIT:-50}" \
            "count" "$(hook_subagent_count_session)"
        # Budget excedido: notifica mas não bloqueia (soft enforcement)
        hook_out_system_message "Atenção: limite de subagentes da sessão atingido (${HOOK_SUBAGENT_BUDGET_LIMIT:-50}). Evite lançar novos subagentes."
    fi

    local turn_num
    turn_num=$(read_field ".current_turn.number")
    local active_count
    active_count=$(subagent_start_counters)

    hook_log_audit "subagentStart" \
        "subagent_id" "${SUBAGENT_ID:-unknown}" \
        "subagent_type" "${SUBAGENT_TYPE:-unknown}" \
        "turn" "${turn_num:-0}" \
        "active_count" "${active_count:-1}"

    # GAP-29: injetar contexto de sessão no subagente ao iniciar
    local _session_id _close_key _turn_num _depth
    _session_id=$(read_field ".session_id")
    _close_key=$(read_field ".close_key")
    _turn_num=$(read_field ".current_turn.number")
    _depth=$(hook_subagent_depth)
    hook_out_subagent_start_context "Sessão: ${_session_id:-?}. Turno: ${_turn_num:-0}. Profundidade de subagente: ${_depth}. Protocolo de hooks ativo. Briefing em .github/hooks/state/session-briefing.md."

    exit 0
}

# ---------------------------------------------------------------------------
# SubagentStop
# ---------------------------------------------------------------------------
subagent_stop_main() {
    local input="$1"
    maybe_capture_debug "$input"
    extract_subagent_meta "$input"
    hook_api_parse "$input" # popula HOOK_SESSION_ID

    [ -z "${SESSION_ID:-}" ] && export SESSION_ID="${HOOK_SESSION_ID:-unknown}"

    if ! state_exists; then
        exit 0
    fi

    local turn_num
    turn_num=$(read_field ".current_turn.number")
    local active_count
    active_count=$(subagent_stop_counters)

    hook_log_audit "subagentStop" \
        "subagent_id" "${SUBAGENT_ID:-unknown}" \
        "subagent_type" "${SUBAGENT_TYPE:-unknown}" \
        "turn" "${turn_num:-0}" \
        "active_count" "${active_count:-0}"

    # NOTE: SubagentStop NÃO emite block — enforcement desativado por ora.
    # Futuro: verificar se o subagente seguiu protocolo antes de permitir retorno.

    exit 0
}

# O script wrapper define SUBAGENT_EVENT antes de chamar main()
main() {
    case "${SUBAGENT_EVENT:-start}" in
        start) subagent_start_main "$1" ;;
        stop) subagent_stop_main "$1" ;;
        *) subagent_start_main "$1" ;;
    esac
}
